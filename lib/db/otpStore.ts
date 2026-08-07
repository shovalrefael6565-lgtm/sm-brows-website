import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  generateOtpCode,
  hashOtpCode,
  otpExpiryDate,
  rateLimitMessage,
  OtpPepperError,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_DAY,
  OTP_MAX_PER_HOUR,
  OTP_MAX_PER_IP_PER_HOUR,
  OTP_RESEND_COOLDOWN_SEC,
  OTP_TTL_MINUTES,
  type RateLimitDecision,
  type RateLimitReason,
} from '@/lib/otp'

/**
 * גישה לטבלת otp_attempts — הצד שנוגע בבסיס הנתונים.
 *
 * ═══ שלב 12B: הכול עבר ל-RPC אטומי ═══
 *
 * הקובץ הזה כבר אינו קורא ואינו כותב את הטבלה ישירות. שתי הפעולות
 * (`issue_otp_atomic`, `verify_otp_atomic`, מיגרציה 0013) עושות את כל
 * העבודה בטרנזקציה אחת, מאחורי advisory lock.
 *
 * ⚠️ **הסיבה אינה סגנון.** המימוש הקודם קרא את ההיסטוריה ואז הכניס שורה
 * כשתי פעולות נפרדות. שתי בקשות מקבילות לאותו מספר עברו שתיהן את בדיקת
 * ה-cooldown, הכניסו שתי שורות, ושלחו שני SMS — ומכיוון ש-verifyOtp בוחר
 * את השורה **האחרונה**, הקוד הראשון שהגיע ללקוחה נדחה. זה שבר כניסה בפועל,
 * לא רק כפל חיוב.
 *
 * ⚠️ **ולא ניתן היה לתקן את זה כאן.** הפתרון המתבקש — INSERT ואז קריאה
 * חוזרת, כשבעל ה-id הנמוך שולח — אינו בטוח: nextval() אינו טרנזקציוני,
 * ולכן סדר ה-id אינו סדר ה-commit. בקשה שקיבלה id נמוך יכולה לעשות commit
 * *אחרי* בקשה עם id גבוה, ואז שתיהן רואות את עצמן כמנצחות. ההכרעה היחידה
 * שמחזיקה היא נעילה שנלקחת לפני הקריאה — כלומר, בתוך בסיס הנתונים.
 *
 * הטבלה נגישה רק ל-service_role — אין עליה שום RLS policy — ולכן הקובץ
 * הזה חייב להישאר server-only.
 */

export type OtpPurpose = 'login' | 'booking'

export interface IssueResult {
  ok: boolean
  code?: string          // מוחזר לקורא כדי שישלח ב-SMS; לא נשמר בשום מקום
  expiresAt?: Date
  /**
   * מזהה שורת ההנפקה — הקלט היחיד ל-discardOtp.
   *
   * ⚠️ מוחזר **רק** כשההנפקה הצליחה. בקשה שנחסמה במגבלת קצב לא יצרה שורה,
   * ולכן אין לה מה לבטל — וזה מה שמונע ממנה למחוק את השורה של הבקשה
   * המקבילה שכן הצליחה.
   */
  otpId?: number
  limit?: RateLimitDecision
}

const RATE_LIMIT_REASONS: readonly string[] = ['cooldown', 'hourly_limit', 'daily_limit', 'ip_limit']

/**
 * ⚠️ רק `code`. לא `message`, לא `details` ולא `hint`.
 *
 * PostgREST מחזיר ב-`details` את השורה שגרמה לשגיאה בחלק מהמקרים (למשל
 * הפרת UNIQUE), וזה היה מכניס מספר טלפון וגיבוב ללוג. `code` הוא SQLSTATE
 * ותו לא.
 */
function safeErrorCode(error: { code?: string | null } | null): string {
  return error?.code ?? 'unknown'
}

/**
 * מייצר קוד חדש ושומר את הגיבוב שלו — אחרי בדיקת הגבלות קצב.
 *
 * ⚠️ הגיבוב מחושב **כאן**, עם OTP_PEPPER שאינו קיים בבסיס הנתונים. הקוד
 * הגלוי אינו עובר ל-RPC ואינו נשמר בשום מקום — הוא מוחזר לקורא בזיכרון
 * בלבד, לצורך השליחה.
 */
export async function issueOtp(
  phoneE164: string,
  purpose: OtpPurpose,
  ip: string | null,
): Promise<IssueResult> {
  const code = generateOtpCode()

  let codeHash: string
  try {
    codeHash = hashOtpCode(code, phoneE164)
  } catch (err) {
    // ⚠️ pepper חסר או קצר מדי. נכשל בבטחה, בלי לייצר קוד "מוגן" למראית עין
    // ובלי להדפיס את הערך. err.message מכיל שם משתנה ותיאור בעיה בלבד.
    if (err instanceof OtpPepperError) {
      console.error('[otp] תצורה פסולה —', err.message)
      return { ok: false }
    }
    throw err
  }

  const db = createSupabaseAdminClient()

  // 🔒 הפעולה כולה — נעילה, בדיקת כל המגבלות, והכנסת שורה אחת — מתבצעת
  // בטרנזקציה אחת בצד השרת. אין כאן read-then-write.
  const { data, error } = await db.rpc('issue_otp_atomic', {
    p_phone_e164: phoneE164,
    p_purpose: purpose,
    p_code_hash: codeHash,
    p_ip: ip,
    p_ttl_seconds: OTP_TTL_MINUTES * 60,
    p_cooldown_seconds: OTP_RESEND_COOLDOWN_SEC,
    p_max_per_hour: OTP_MAX_PER_HOUR,
    p_max_per_day: OTP_MAX_PER_DAY,
    p_max_per_ip_per_hour: OTP_MAX_PER_IP_PER_HOUR,
  })

  if (error) {
    console.error('[otp] issue_otp_atomic נכשלה, sqlstate=', safeErrorCode(error))
    return { ok: false }
  }

  const result = data as {
    allowed?: boolean
    reason?: string
    retry_after_sec?: number
    expires_at?: string
    otp_id?: number
  } | null

  if (!result || typeof result.allowed !== 'boolean') {
    console.error('[otp] issue_otp_atomic החזירה תשובה לא צפויה')
    return { ok: false }
  }

  if (!result.allowed) {
    const reason = RATE_LIMIT_REASONS.includes(result.reason ?? '')
      ? (result.reason as RateLimitReason)
      : null

    if (!reason) {
      console.error('[otp] סיבת חסימה לא מוכרת מ-issue_otp_atomic')
      return { ok: false }
    }

    return {
      ok: false,
      limit: {
        allowed: false,
        reason,
        retryAfterSec: result.retry_after_sec,
        message: rateLimitMessage(reason, result.retry_after_sec),
      },
    }
  }

  return {
    ok: true,
    code,
    otpId: typeof result.otp_id === 'number' ? result.otp_id : undefined,
    // ⚠️ ה-RPC מחזירה את התפוגה שנכתבה בפועל, כדי שהמסך לא יציג זמן שנגזר
    // משעון אחר מזה שאכף אותו. otpExpiryDate נשאר כגיבוי בלבד.
    expiresAt: result.expires_at ? new Date(result.expires_at) : otpExpiryDate(),
  }
}

export type DiscardOutcome =
  | 'discarded'   // השורה נמחקה
  | 'not_found'   // אין שורה כזו למספר ול-purpose האלה
  | 'consumed'    // הקוד כבר נוצל — ראיה, לא נוגעים
  | 'superseded'  // קיימת שורה חדשה יותר — שלנו כבר אינה האחרונה
  /**
   * ⚠️ ערך מדור 0013 בלבד. 0014 הסירה אותו: ניסיונות מול קוד שהוכח שלא
   * נמסר אינם ראיה, והחזקת השורה בגללם הותירה את הלקוחה בלי קוד שמיש.
   *
   * נשאר ברשימה המותרת בכוונה — בין פריסת הקוד להרצת 0014 יש חלון שבו
   * המסד עדיין מחזיר אותו, ושם עדיף לרשום שורת לוג מאשר להחזיר 'error'.
   */
  | 'attempted'
  | 'error'

/**
 * ביטול שורת הנפקה שהשליחה שלה **נדחתה בוודאות**.
 *
 * ═══ למה זה קיים ═══
 *
 * הקוד נשמר לפני שהוא נשלח — אין ברירה, אחרת יכול היה לצאת SMS עם קוד
 * שאינו קיים במסד. אבל כשהשליחה נדחית בוודאות, השורה שנוצרה היא "הקוד
 * האחרון", ולכן היא:
 *
 *   • מבטלת קוד קודם שאולי כבר הגיע ללקוחה ותקף בידה.
 *   • מפעילה cooldown של דקה על כשל שאינו באשמתה.
 *   • נספרת במכסת השעה ובמכסת היום.
 *
 * ⚠️ נקראת **אך ורק** כאשר `SmsResult.notDelivered` דלוק. תוצאה עמומה
 * (`uncertain`) אינה עילה: שם ייתכן שההודעה בדרך, ומחיקת השורה הייתה
 * משאירה את הלקוחה עם SMS ובו קוד שהמערכת כבר אינה מכירה.
 *
 * ⚠️ הקוד הגלוי אינו מגיע לכאן. הקלט הוא מזהה, מספר ו-purpose בלבד.
 */
export async function discardOtp(
  otpId: number,
  phoneE164: string,
  purpose: OtpPurpose,
): Promise<DiscardOutcome> {
  const db = createSupabaseAdminClient()

  const { data, error } = await db.rpc('discard_otp_issue_atomic', {
    p_otp_id: otpId,
    p_phone_e164: phoneE164,
    p_purpose: purpose,
  })

  if (error) {
    // ⚠️ sqlstate בלבד. אין כאן מספר, אין מזהה, ואין פרטי ספק.
    console.error('[otp] discard_otp_issue_atomic נכשלה, sqlstate=', safeErrorCode(error))
    return 'error'
  }

  const result = (data as { result?: string } | null)?.result

  if (!result || !DISCARD_OUTCOMES.includes(result)) {
    console.error('[otp] discard_otp_issue_atomic החזירה תוצאה לא מוכרת')
    return 'error'
  }

  return result as DiscardOutcome
}

const DISCARD_OUTCOMES: readonly string[] =
  ['discarded', 'not_found', 'consumed', 'attempted', 'superseded']

export type VerifyOutcome =
  | 'ok'
  | 'no_code'        // לא נשלח קוד למספר הזה
  | 'expired'        // פג תוקף
  | 'too_many'       // מוצו הניסיונות
  | 'wrong'          // קוד שגוי
  | 'error'

const VERIFY_OUTCOMES: readonly string[] = ['ok', 'no_code', 'expired', 'too_many', 'wrong']

/**
 * מאמת קוד מול הרשומה הפעילה האחרונה.
 *
 * ⚠️ הקוד הגלוי **אינו עוזב את התהליך הזה.** מה שנשלח ל-RPC הוא הגיבוב
 * בלבד, שמחושב כאן עם ה-pepper. בסיס הנתונים לעולם אינו רואה את הקוד.
 *
 * ⚠️ אין פרמטר זמן. התוקף נבדק מול now() של השרת בתוך ה-RPC — זמן שהקורא
 * מעביר הוא זמן שאפשר לזייף.
 *
 * שריפת הקוד (consumed_at) קורית באותה טרנזקציה שהחזיקה את נעילת השורה,
 * ולכן שני אימותים נכונים מקבילים לא יכולים להצליח שניהם.
 */
export async function verifyOtp(
  phoneE164: string,
  purpose: OtpPurpose,
  code: string,
): Promise<VerifyOutcome> {
  let candidateHash: string
  try {
    candidateHash = hashOtpCode(code, phoneE164)
  } catch (err) {
    if (err instanceof OtpPepperError) {
      console.error('[otp] תצורה פסולה —', err.message)
      return 'error'
    }
    throw err
  }

  const db = createSupabaseAdminClient()

  const { data, error } = await db.rpc('verify_otp_atomic', {
    p_phone_e164: phoneE164,
    p_purpose: purpose,
    p_candidate_hash: candidateHash,
    p_max_attempts: OTP_MAX_ATTEMPTS,
  })

  if (error) {
    console.error('[otp] verify_otp_atomic נכשלה, sqlstate=', safeErrorCode(error))
    return 'error'
  }

  const result = (data as { result?: string } | null)?.result

  if (!result || !VERIFY_OUTCOMES.includes(result)) {
    console.error('[otp] verify_otp_atomic החזירה תוצאה לא מוכרת')
    return 'error'
  }

  return result as VerifyOutcome
}
