import 'server-only'
import { createHash, randomInt, timingSafeEqual } from 'crypto'

/**
 * קודי אימות חד־פעמיים — לוגיקה טהורה, בלי תלות בבסיס הנתונים.
 *
 * הכללים שמיושמים כאן הם דרישת אבטחה **וגם** הגנה תקציבית: כל SMS עולה
 * כסף, ובלי הגבלת קצב אפשר לשרוף מאות שקלים בדקות ע"י בקשות אוטומטיות.
 */

/** אורך הקוד שהלקוחה מקבלת */
export const OTP_LENGTH = 6
/** תוקף הקוד בדקות — קצר בכוונה */
export const OTP_TTL_MINUTES = 5
/** מספר ניסיונות הזנה מקסימלי לקוד אחד לפני שהוא נשרף */
export const OTP_MAX_ATTEMPTS = 5
/** המתנה מינימלית בין שתי בקשות קוד לאותו מספר (שניות) */
export const OTP_RESEND_COOLDOWN_SEC = 60
/** מקסימום קודים שניתן לשלוח לאותו מספר בחלון זמן */
export const OTP_MAX_PER_HOUR = 5
export const OTP_MAX_PER_DAY = 10
/** מקסימום קודים מאותה כתובת IP בשעה — מונע סריקה על פני מספרים רבים */
export const OTP_MAX_PER_IP_PER_HOUR = 15

/**
 * מייצר קוד אקראי קריפטוגרפית.
 * randomInt ולא Math.random — Math.random ניתן לחיזוי ולא מתאים לאבטחה.
 */
export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH
  return randomInt(0, max).toString().padStart(OTP_LENGTH, '0')
}

/**
 * גיבוב הקוד לפני שמירה. הקוד עצמו לעולם לא נשמר בבסיס הנתונים, כך
 * שדליפת DB לא מאפשרת להתחזות ללקוחה.
 *
 * ה-pepper (OTP_PEPPER) הוא סוד שנמצא רק במשתני הסביבה — בלעדיו לא ניתן
 * לבנות טבלת קשת של 10^6 הקודים האפשריים גם אם ה-DB דלף.
 */
export function hashOtpCode(code: string, phoneE164: string): string {
  const pepper = process.env.OTP_PEPPER ?? ''
  return createHash('sha256').update(`${phoneE164}:${code}:${pepper}`).digest('hex')
}

/**
 * השוואה בזמן קבוע — מונעת timing attack שבו תוקף לומד את הקוד
 * לפי כמה זמן לקחה ההשוואה.
 */
export function verifyOtpHash(expectedHash: string, code: string, phoneE164: string): boolean {
  const actual = Buffer.from(hashOtpCode(code, phoneE164), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export function otpExpiryDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_MINUTES * 60_000)
}

export type RateLimitReason =
  | 'cooldown'      // מוקדם מדי לבקש קוד נוסף
  | 'hourly_limit'  // מיצתה את מכסת השעה
  | 'daily_limit'   // מיצתה את מכסת היום
  | 'ip_limit'      // יותר מדי בקשות מאותו מקור

export interface RateLimitDecision {
  allowed: boolean
  reason?: RateLimitReason
  /** כמה שניות להמתין עד שניתן לנסות שוב — להצגה ללקוחה */
  retryAfterSec?: number
  message?: string
}

export interface OtpRateInput {
  /** חותמות הזמן של הקודים שנשלחו למספר הזה, מהחדש לישן */
  recentForPhone: Date[]
  /** כמה קודים נשלחו מאותה כתובת IP בשעה האחרונה */
  countForIpLastHour: number
}

/**
 * מחליט אם מותר לשלוח קוד נוסף. פונקציה טהורה — הקורא אחראי לספק את
 * הנתונים מה-DB, וכך אפשר לבדוק אותה בלי בסיס נתונים.
 */
export function checkOtpRateLimit(
  input: OtpRateInput,
  now: Date = new Date(),
): RateLimitDecision {
  const { recentForPhone, countForIpLastHour } = input

  if (countForIpLastHour >= OTP_MAX_PER_IP_PER_HOUR) {
    return {
      allowed: false,
      reason: 'ip_limit',
      retryAfterSec: 3600,
      message: 'בוצעו יותר מדי בקשות. נסי שוב מאוחר יותר.',
    }
  }

  const [latest] = recentForPhone
  if (latest) {
    const sinceSec = (now.getTime() - latest.getTime()) / 1000
    if (sinceSec < OTP_RESEND_COOLDOWN_SEC) {
      return {
        allowed: false,
        reason: 'cooldown',
        retryAfterSec: Math.ceil(OTP_RESEND_COOLDOWN_SEC - sinceSec),
        message: `אפשר לבקש קוד חדש בעוד ${Math.ceil(OTP_RESEND_COOLDOWN_SEC - sinceSec)} שניות.`,
      }
    }
  }

  const hourAgo = now.getTime() - 3_600_000
  const dayAgo = now.getTime() - 86_400_000

  const inLastHour = recentForPhone.filter(d => d.getTime() > hourAgo).length
  if (inLastHour >= OTP_MAX_PER_HOUR) {
    return {
      allowed: false,
      reason: 'hourly_limit',
      retryAfterSec: 3600,
      message: 'נשלחו יותר מדי קודים למספר הזה. נסי שוב בעוד שעה.',
    }
  }

  const inLastDay = recentForPhone.filter(d => d.getTime() > dayAgo).length
  if (inLastDay >= OTP_MAX_PER_DAY) {
    return {
      allowed: false,
      reason: 'daily_limit',
      retryAfterSec: 86_400,
      message: 'נשלחו יותר מדי קודים למספר הזה היום. נסי שוב מחר או צרי קשר בוואטסאפ.',
    }
  }

  return { allowed: true }
}
