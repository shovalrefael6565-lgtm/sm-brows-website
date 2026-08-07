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

/** אורך מינימלי ל-OTP_PEPPER בפרודקשן. `openssl rand -hex 32` נותן 64. */
export const OTP_PEPPER_MIN_LENGTH = 32

/** נזרקת כאשר אין pepper תקין. ⚠️ לעולם אינה מכילה את הערך עצמו. */
export class OtpPepperError extends Error {
  constructor(problem: string) {
    super(`OTP_PEPPER ${problem}`)
    this.name = 'OtpPepperError'
  }
}

/**
 * בדיקת ה-pepper בלי לזרוק — ל-health checks ולבדיקות.
 *
 * ⚠️ מחזירה את *שם* הבעיה בלבד. הערך אינו מוחזר, אינו נרשם ואינו נמדד.
 */
export function checkOtpPepper(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; problem: string } {
  const pepper = env.OTP_PEPPER ?? ''
  const isProd = env.NODE_ENV === 'production'

  if (pepper.trim() === '') {
    return { ok: false, problem: 'חסר' }
  }
  if (isProd && pepper.length < OTP_PEPPER_MIN_LENGTH) {
    return { ok: false, problem: `קצר מ-${OTP_PEPPER_MIN_LENGTH} תווים` }
  }
  return { ok: true }
}

/**
 * גיבוב הקוד לפני שמירה. הקוד עצמו לעולם לא נשמר בבסיס הנתונים, כך
 * שדליפת DB לא מאפשרת להתחזות ללקוחה.
 *
 * ה-pepper (OTP_PEPPER) הוא סוד שנמצא רק במשתני הסביבה — בלעדיו לא ניתן
 * לבנות טבלת קשת של 10^6 הקודים האפשריים גם אם ה-DB דלף.
 *
 * ⚠️ **pepper חסר אינו נבלע יותר.** הקוד הקודם כתב `process.env.OTP_PEPPER ?? ''`,
 * כלומר משתנה סביבה חסר בפרודקשן הוריד את הגיבוב בשקט ל-sha256(phone:code) —
 * טבלת קשת של מיליון ערכים, בלי אזהרה אחת. עכשיו זו חריגה, ומסלול ה-OTP
 * נכשל בבטחה במקום להמשיך לעבוד עם הגנה מדומה.
 *
 * ⚠️ בפיתוח pepper חסר עדיין זורק — אבל הבדיקות והסקריפטים מגדירים אותו
 * (`process.env.OTP_PEPPER ??= 'test-pepper'`), ולכן ההתנהגות אחידה בכל סביבה.
 */
export function hashOtpCode(code: string, phoneE164: string): string {
  const check = checkOtpPepper()
  if (!check.ok) throw new OtpPepperError(check.problem)

  const pepper = process.env.OTP_PEPPER!
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

/**
 * הנוסח שמוצג ללקוחה לכל סיבת חסימה — מקור אמת יחיד.
 *
 * ⚠️ מאז שלב 12B ההחלטה עצמה מתקבלת ב-issue_otp_atomic (SQL), אך הנוסח
 * נשאר כאן: תרגום ההחלטה לעברית הוא עניין של ממשק ולא של בסיס הנתונים,
 * ושכפולו ל-SQL היה מפצל את הטקסט לשני מקומות שיתפצלו בהמשך.
 */
export function rateLimitMessage(reason: RateLimitReason, retryAfterSec?: number): string {
  switch (reason) {
    case 'cooldown':
      return `אפשר לבקש קוד חדש בעוד ${Math.max(1, retryAfterSec ?? OTP_RESEND_COOLDOWN_SEC)} שניות.`
    case 'hourly_limit':
      return 'נשלחו יותר מדי קודים למספר הזה. נסי שוב בעוד שעה.'
    case 'daily_limit':
      return 'נשלחו יותר מדי קודים למספר הזה היום. נסי שוב מחר או צרי קשר בוואטסאפ.'
    case 'ip_limit':
      return 'בוצעו יותר מדי בקשות. נסי שוב מאוחר יותר.'
  }
}

export interface OtpRateInput {
  /** חותמות הזמן של הקודים שנשלחו למספר הזה, מהחדש לישן */
  recentForPhone: Date[]
  /** כמה קודים נשלחו מאותה כתובת IP בשעה האחרונה */
  countForIpLastHour: number
}

/** בונה החלטת חסימה עם הנוסח המתאים */
function deny(reason: RateLimitReason, retryAfterSec: number): RateLimitDecision {
  return { allowed: false, reason, retryAfterSec, message: rateLimitMessage(reason, retryAfterSec) }
}

/**
 * מחליט אם מותר לשלוח קוד נוסף. פונקציה טהורה — הקורא אחראי לספק את
 * הנתונים מה-DB, וכך אפשר לבדוק אותה בלי בסיס נתונים.
 *
 * ⚠️ **מאז שלב 12B היא אינה מקבלת את ההחלטה בפרודקשן.** ההחלטה עברה
 * ל-issue_otp_atomic ב-0013, כי החלטה שמתקבלת כאן מחייבת קריאה ואז כתיבה
 * כשתי פעולות נפרדות — וזה בדיוק המרוץ ששלח שני SMS.
 *
 * היא נשארת בתור **האורקל של הבדיקות**: scripts/test-otp-atomic.mjs מריצה
 * את אותם קלטים דרך שתי המימושים ומשווה את התוצאות. מימוש שני שנבדק
 * דיפרנציאלית מול ה-SQL שווה יותר מקוד מת שנמחק — הוא זה שיתפוס את היום
 * שבו מישהו ישנה תקרה במקום אחד ולא בשני.
 */
export function checkOtpRateLimit(
  input: OtpRateInput,
  now: Date = new Date(),
): RateLimitDecision {
  const { recentForPhone, countForIpLastHour } = input

  if (countForIpLastHour >= OTP_MAX_PER_IP_PER_HOUR) {
    return deny('ip_limit', 3600)
  }

  const [latest] = recentForPhone
  if (latest) {
    const sinceSec = (now.getTime() - latest.getTime()) / 1000
    if (sinceSec < OTP_RESEND_COOLDOWN_SEC) {
      return deny('cooldown', Math.ceil(OTP_RESEND_COOLDOWN_SEC - sinceSec))
    }
  }

  const hourAgo = now.getTime() - 3_600_000
  const dayAgo = now.getTime() - 86_400_000

  const inLastHour = recentForPhone.filter(d => d.getTime() > hourAgo).length
  if (inLastHour >= OTP_MAX_PER_HOUR) {
    return deny('hourly_limit', 3600)
  }

  const inLastDay = recentForPhone.filter(d => d.getTime() > dayAgo).length
  if (inLastDay >= OTP_MAX_PER_DAY) {
    return deny('daily_limit', 86_400)
  }

  return { allowed: true }
}
