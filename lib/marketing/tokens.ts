import 'server-only'
import { createHmac, createHash, timingSafeEqual } from 'crypto'
import { OPT_OUT_TOKEN_LENGTH } from './message'

/**
 * 🔒 ה-token של קישור ההסרה, והחותם שנשמר במסד.
 *
 * ═══ למה נגזר ולא מוגרל ═════════════════════════════════════════════════
 *
 * token מוגרל היה מחייב לשמור אותו כדי להשתמש בו שוב — וזה בדיוק מה
 * שאסור. token נגזר נותן את שני הדברים יחד:
 *
 *   • **יציבות** — אותה לקוחה מקבלת אותו token בכל קמפיין, ולכן קישור
 *     הסרה מהודעה של לפני חצי שנה עדיין עובד.
 *   • **סודיות** — במסד יושב רק SHA-256 של ה-token. ה-token עצמו נבנה
 *     מחדש בכל שליחה מהסוד, ואינו נשמר בשום מקום: לא בטבלה, לא בלוג
 *     הקמפיין, ולא בתשובת ה-API.
 *
 * ⚠️ 128 סיביות: HMAC-SHA256 חתוך ל-16 בתים. חיתוך של HMAC הוא פעולה
 * מקובלת ובטוחה, ו-16 בתים הם 22 תווי base64url — קצר מספיק לשרוד בתקציב
 * של 70 תווים, וארוך מספיק שניחוש אינו אפשרות.
 *
 * ⚠️ הסוד **ייעודי ומגורסת**: MARKETING_OPT_OUT_SECRET_V1. אינו SESSION_SECRET
 * ואינו OTP_PEPPER — דליפה של אחד מהם לא אמורה לחשוף קישורי הסרה, ולהפך.
 */

/** גרסת הסוד שממנה נגזרים token-ים חדשים היום */
export const CURRENT_OPT_OUT_TOKEN_VERSION = 1

const SECRET_ENV_BY_VERSION: Record<number, string> = {
  1: 'MARKETING_OPT_OUT_SECRET_V1',
}

export type OptOutSecretError = 'missing_secret' | 'unknown_version'

function readSecret(version: number): { ok: true; secret: string } | { ok: false; error: OptOutSecretError } {
  const envName = SECRET_ENV_BY_VERSION[version]
  if (!envName) return { ok: false, error: 'unknown_version' }
  const raw = process.env[envName]
  // ⚠️ שם המשתנה בלבד בשגיאה. הערך לעולם לא יוצא מכאן.
  if (typeof raw !== 'string' || raw.trim().length < 32) return { ok: false, error: 'missing_secret' }
  return { ok: true, secret: raw.trim() }
}

/** האם הסוד של הגרסה הנוכחית מוגדר — לבדיקת מוכנות לפני קמפיין */
export function optOutSecretReady(version = CURRENT_OPT_OUT_TOKEN_VERSION): boolean {
  return readSecret(version).ok
}

/**
 * גזירת ה-token של לקוחה.
 *
 * ⚠️ מקבל **גרסה** ולא סתם משתמש בנוכחית: לקוחה שכבר יש לה חותם שמור
 * מגרסה 1 חייבת להמשיך לקבל token של גרסה 1, אחרת הקישור הישן שלה מת.
 * הגרסה נשמרת ב-customers.marketing_opt_out_token_version בדיוק לשם כך.
 */
export function deriveOptOutToken(
  customerId: string,
  version = CURRENT_OPT_OUT_TOKEN_VERSION,
): { ok: true; token: string } | { ok: false; error: OptOutSecretError } {
  const s = readSecret(version)
  if (!s.ok) return s

  const digest = createHmac('sha256', s.secret).update(customerId).digest()
  const token = digest.subarray(0, 16).toString('base64url')
  return { ok: true, token }
}

/** החותם שנשמר — SHA-256 בהקסה, אותו פורמט של payload_fingerprint ב-0010 */
export function optOutTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * ⚠️ ולידציה של צורת ה-token **לפני** כל פנייה למסד: base64url באורך קבוע.
 * חוסמת ניסיונות הזרקה ומונעת שאילתה על כל מחרוזת שמישהו שם ב-URL.
 */
const TOKEN_RE = new RegExp(`^[A-Za-z0-9_-]{${OPT_OUT_TOKEN_LENGTH}}$`)

export function isWellFormedOptOutToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token)
}

/**
 * 🔒 חותם הטלפון לצורך dedup בלוג הקמפיין.
 *
 * ⚠️ הטלפון עצמו לעולם אינו נשמר ב-sms_campaign_recipients. החותם משמש רק
 * להשוואה: אותו מספר מנורמל ⟹ אותו חותם ⟹ נמען אחד. ה-pepper מונע בניית
 * טבלת מעבר מכל מספרי הטלפון בישראל, שהם מרחב קטן דיו לחישוב מלא.
 */
export function phoneHash(phoneE164: string): { ok: true; hash: string } | { ok: false; error: 'missing_secret' } {
  const s = readSecret(CURRENT_OPT_OUT_TOKEN_VERSION)
  if (!s.ok) return { ok: false, error: 'missing_secret' }
  return { ok: true, hash: createHmac('sha256', s.secret).update(`phone:${phoneE164}`).digest('hex') }
}

/** השוואה בזמן קבוע, לחותמים שמגיעים מבחוץ */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}
