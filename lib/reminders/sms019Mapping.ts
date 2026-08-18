/**
 * שלב 12A — הידע הטהור על 019, בלי רשת ובלי סודות.
 *
 * הקובץ הזה אינו מייבא 'server-only' ואינו פותח שום חיבור. כל מה שיש בו הוא
 * המרות ומיפויים — כדי שאפשר יהיה להוכיח את ההחלטות המסוכנות ביותר של השלב
 * בבדיקות שאינן נוגעות ברשת, בסודות או בבסיס הנתונים.
 *
 * ═══ הכלל שאסור לשבור ═══
 *
 * **אחרי שהבקשה יצאה, כל תוצאה שאין בה הוכחה מפורשת שהשליחה נדחתה היא
 * delivery_unknown.**
 *
 * ל-019 אין idempotency מוכחת. השדה `id` (external_id) הוא client reference
 * לצורכי DLR בלבד; התיעוד אינו טוען שהוא ייחודי ואינו טוען שהוא מונע כפילות.
 * לכן אין כאן exactly-once, ואין להציג את המערכת ככזו. retry אוטומטי על
 * תוצאה עמומה אינו "ניסיון נוסף" אלא הימור על SMS שני ללקוחה.
 *
 * retryable_error שמור **אך ורק** לכשל שהוכח שהתרחש לפני שהבקשה יצאה.
 */

import type { ReminderDeliveryResult } from './types'

/**
 * 🔒 שתי הכתובות, כקבועים בקוד ולא כמשתני סביבה.
 *
 * ⚠️ אין `SMS019_BASE_URL`. כתובת חופשית מה-env הייתה אומרת שה-token נשלח
 * לכל מקום ששורה ב-.env תצביע עליו, ושטעות הקלדה אחת יכולה להפוך dry-run
 * לשליחה אמיתית — או לשלוח credentials ליעד זר.
 *
 * הפרדת התפקידים מוחלטת:
 *   SMS019_API_URL      — הספק ב-runtime בלבד. שולח באמת.
 *   SMS019_TEST_API_URL — scripts/probe-019.mjs בלבד. אינו מבצע את הפעולה.
 *
 * ⚠️ אין דרך להפעיל את הספק האמיתי מול כתובת ה-test, ואין דרך לגרום ל-probe
 * לשלוח באמת. שני המסלולים אינם נפגשים, וההצלחה של dry-run לעולם אינה
 * מסומנת 'sent' — ה-probe אינו נוגע במסד בכלל.
 */
export const SMS019_API_URL = 'https://019sms.co.il/api'
export const SMS019_TEST_API_URL = 'https://019sms.co.il/api/test'

/** מתועד: `message` מקסימום 1005 תווים. */
export const SMS019_MAX_MESSAGE_CHARS = 1005

/**
 * `source` — מקסימום 11 תווים.
 *
 * ⚠️ **הכלל כאן רחב מהתיעוד, במכוון.** התיעוד כותב "only numeric value
 * (no +sign) and English letters", כלומר בלי רווח. בפועל שם השולח המאושר
 * בחשבון הוא בעל רווח, ו-sender ID תקני של GSM אכן מתיר רווח (הוא חלק
 * מא"ב ה-7-bit). ולידציה שדוחה רווח הייתה חוסמת את השם היחיד שאפשר לשלוח
 * ממנו — כלומר מכבה את הספק בגלל דיוק-יתר בקריאת התיעוד.
 *
 * ⚠️ רווח בתחילת או בסוף **אינו חלק מהשם**, ולכן הרגקס דוחה אותו.
 * readSms019Config גוזם (trim) לפני הבדיקה, כך שהדבקה עם רווח מיותר
 * מנורמלת ולא נכשלת — והרגקס נשאר כחגורה שנייה למסלול שלא יגזום.
 *
 * ⚠️ מה שעדיין אינו מתועד: כיצד שם אלפאנומרי נרשם מלכתחילה. verify_phone
 * מכסה **מספרים** בלבד, ושגיאה 515 "Unverified source" היא מנגנון האכיפה.
 * לכן 515 ממופה ל-permanent_error ולא ל-retryable — retry לא ירשום שם.
 */
export const SMS019_SOURCE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9 ]{0,9}[A-Za-z0-9])?$/

/**
 * המרת E.164 לפורמט שהתיעוד דורש: `5xxxxxxx` או `05xxxxxxx`.
 *
 * ⚠️ 019 אינו מקבל E.164. ה-DB שלנו מחזיק E.164 בלבד, ולכן ההמרה הזו היא
 * נקודת מפגש חובה — וגם המקום שבו יעד לא ישראלי חייב להיעצר.
 *
 * ⚠️ יעד שאינו +972 מוחזר null **בכוונה**. התיעוד מזכיר את הדגל
 * includes_international אך אינו מגדיר את הפורמט הבינלאומי הנדרש, וניחוש
 * כאן היה שולח הודעה למספר שגוי או שורף קרדיט על כלום. עדיף permanent_error
 * גלוי במסך הניהול.
 */
export function toLocalIsraeliPhone(e164: string): string | null {
  if (typeof e164 !== 'string') return null
  const trimmed = e164.trim()
  // מספר נייד ישראלי: +9725XXXXXXXX — קידומת 5 ואחריה 8 ספרות.
  const m = /^\+9725(\d{8})$/.exec(trimmed)
  if (!m) return null
  return `05${m[1]}`
}

/** מיסוך ללוגים ולפלט ה-probe. לעולם לא מדפיסים מספר מלא. */
export function maskPhone(phone: string): string {
  if (typeof phone !== 'string' || phone.length < 4) return '***'
  return `${'*'.repeat(Math.max(0, phone.length - 3))}${phone.slice(-3)}`
}

/**
 * גוף הבקשה, בדיוק לפי המבנה המתועד.
 *
 * ⚠️ המבנה `{"$":{...},"_":"..."}` אינו טעות בתיעוד — זהו JSON שנגזר מ-XML:
 * `$` הם האטריביוטים ו-`_` הוא תוכן האלמנט. שינוי המבנה לצורה "נקייה" יותר
 * פשוט לא יתקבל.
 *
 * ⚠️ `timing` אינו נשלח. התזמון הוא של מנוע התזכורות שלנו; מסירת התזמון
 * ל-019 הייתה יוצרת תור שני שאיננו רואים ואיננו יכולים לבטל.
 *
 * ⚠️ `add_unsubscribe: '0'` — אלה הודעות תפעוליות ללקוחה שקבעה תור, ולא
 * דיוור. לינק הסרה בתזכורת לתור הוא הצעה להסיר את עצמה מהתור.
 */
export interface Sms019SendPayloadInput {
  username: string
  source: string
  /** בפורמט 019 המקומי, אחרי toLocalIsraeliPhone */
  localPhone: string
  message: string
  /** ⚠️ reminder.id — יציב בכל retry. משמש כ-external_id לשאילתת DLR עתידית. */
  externalId: string
}

export function buildSms019Payload(input: Sms019SendPayloadInput): unknown {
  return {
    sms: {
      user: { username: input.username },
      source: input.source,
      destinations: {
        phone: [{ $: { id: input.externalId }, _: input.localPhone }],
      },
      message: input.message,
      add_unsubscribe: '0',
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// מיפוי כשלי תעבורה
// ════════════════════════════════════════════════════════════════════════════

/**
 * 🔒 הרשימה **הסגורה** של כשלים שהוכח שהתרחשו לפני שהבקשה יצאה.
 *
 * רק אלה רשאים להיות retryable_error. כל דבר אחר — כולל ECONNRESET, שמשמעו
 * שהחיבור כבר נוצר ואולי הספיק להעביר את הבקשה — הוא delivery_unknown.
 */
const PRE_FLIGHT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',    // ה-DNS לא נפתר — שום בייט לא יצא
  'EAI_AGAIN',    // כשל DNS זמני — שום בייט לא יצא
  'ECONNREFUSED', // הצד השני סירב לחיבור — אין חיבור, אין בקשה
])

/** כשל TLS מתרחש לפני שגוף הבקשה נשלח: ה-handshake קודם לכל בייט אפליקטיבי. */
function isTlsHandshakeFailure(code: string): boolean {
  return (
    code.startsWith('ERR_TLS_') ||
    code.startsWith('ERR_SSL_') ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID'
  )
}

/** שליפת קוד השגיאה מ-undici, שעוטף את השגיאה האמיתית ב-cause. */
function errorCodeOf(err: unknown): string {
  const seen = new Set<unknown>()
  let cur: unknown = err
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur)
    const code = (cur as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
    cur = (cur as { cause?: unknown }).cause
  }
  return ''
}

function errorNameOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const name = (err as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return ''
}

/**
 * סיווג חריגה שנזרקה מ-fetch.
 *
 * ⚠️ AbortError הוא **תמיד** delivery_unknown. timeout אינו מעיד על כלום:
 * הבקשה יכולה הייתה להתקבל, להישלח, ורק התשובה איחרה. זו בדיוק התוצאה
 * העמומה שהמנוע נבנה כדי לא לנסות שוב.
 */
export function classifySms019TransportError(err: unknown): ReminderDeliveryResult {
  const name = errorNameOf(err)
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { outcome: 'delivery_unknown', errorCode: 'sms019_timeout' }
  }

  const code = errorCodeOf(err)
  if (code === 'ABORT_ERR' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return { outcome: 'delivery_unknown', errorCode: 'sms019_timeout' }
  }
  if (PRE_FLIGHT_ERROR_CODES.has(code) || isTlsHandshakeFailure(code)) {
    return { outcome: 'retryable_error', errorCode: 'sms019_connect_failed' }
  }

  // ⚠️ כולל ECONNRESET, EPIPE, ETIMEDOUT ו"socket hang up": כולם מתרחשים
  // אחרי שהחיבור כבר עמד, ולכן ייתכן שהבקשה הספיקה לצאת.
  return { outcome: 'delivery_unknown', errorCode: 'sms019_transport_unknown' }
}

// ════════════════════════════════════════════════════════════════════════════
// מיפוי קוד HTTP
// ════════════════════════════════════════════════════════════════════════════

/**
 * מחזיר null כאשר יש לקרוא את גוף התשובה (HTTP 200), אחרת את התוצאה הסופית.
 *
 * ⚠️ כל 5xx הוא delivery_unknown, גם 500 וגם 503. שרת שקרס אחרי שהכניס את
 * ההודעה לתור נראה בדיוק כמו שרת שקרס לפני כן, ואין לנו דרך להבחין.
 */
export function classifySms019HttpStatus(status: number): ReminderDeliveryResult | null {
  if (status === 200) return null

  if (status === 429) {
    return { outcome: 'retryable_error', errorCode: 'sms019_http_429' }
  }
  if (status >= 500) {
    return { outcome: 'delivery_unknown', errorCode: `sms019_http_${status}` }
  }
  if (status >= 400) {
    // 401/403 כוללים גם חסימת IP allowlist. שניהם דורשים אדם, לא retry.
    return { outcome: 'permanent_error', errorCode: `sms019_http_${status}` }
  }

  // 1xx/2xx-אחר/3xx: לא מתועד, לא מוכר, ולכן לא מוכח שנדחה.
  return { outcome: 'delivery_unknown', errorCode: `sms019_http_${status}` }
}

// ════════════════════════════════════════════════════════════════════════════
// מיפוי קודי הספק
// ════════════════════════════════════════════════════════════════════════════

type NonAcceptedOutcome = 'retryable_error' | 'permanent_error' | 'delivery_unknown'

/**
 * הטבלה הרשמית של 019, ממופה לארבע התוצאות של המנוע.
 *
 * ⚠️ כל errorCode כאן עומד ב-`^[a-z0-9_]{1,60}$` שה-DB אוכף (ראה 0011).
 * המספר נשמר בתוך ה-slug כדי שאפשר יהיה לאתר את הקוד המקורי בתיעוד —
 * ובלי לשמור אף מילה מהטקסט שהספק החזיר.
 */
const PROVIDER_STATUS_MAP: ReadonlyMap<number, { outcome: NonAcceptedOutcome; errorCode: string }> =
  new Map([
    // ── זמני אמיתי: הרשאת שעת שליחה. יחלוף מעצמו. ──
    [5, { outcome: 'retryable_error' as const, errorCode: 'sms019_send_time_not_permitted_5' }],

    // ── תצורה/אימות. retry לא יתקן, וצריך אדם. ──
    [3, { outcome: 'permanent_error' as const, errorCode: 'sms019_auth_invalid_token_3' }],
    [10, { outcome: 'permanent_error' as const, errorCode: 'sms019_auth_expired_token_10' }],
    [11, { outcome: 'permanent_error' as const, errorCode: 'sms019_auth_token_user_mismatch_11' }],
    [504, { outcome: 'permanent_error' as const, errorCode: 'sms019_auth_token_not_found_504' }],
    [515, { outcome: 'permanent_error' as const, errorCode: 'sms019_unverified_source_515' }],
    [511, { outcome: 'permanent_error' as const, errorCode: 'sms019_no_permission_511' }],
    [503, { outcome: 'permanent_error' as const, errorCode: 'sms019_username_not_exist_503' }],
    [502, { outcome: 'permanent_error' as const, errorCode: 'sms019_action_not_valid_502' }],

    // ── יתרה. ⚠️ permanent במכוון: ה-backoff הוא 3/9/27 דקות, וטעינת יתרה
    //    אינה קורית בטווח הזה. 'retrying' היה מסתיר את התקלה עד שהחלון
    //    ייסגר; 'failed' עם קוד ברור נראה מייד במסך הניהול.
    [4, { outcome: 'permanent_error' as const, errorCode: 'sms019_insufficient_credit_4' }],
    [12, { outcome: 'permanent_error' as const, errorCode: 'sms019_insufficient_credit_12' }],

    // ── היעד עצמו. שליחה חוזרת תיכשל באותה צורה. ──
    [8, { outcome: 'permanent_error' as const, errorCode: 'sms019_all_destinations_blocked_8' }],
    [9, { outcome: 'permanent_error' as const, errorCode: 'sms019_bad_destination_9' }],
    [715, { outcome: 'permanent_error' as const, errorCode: 'sms019_temporarily_blocked_715' }],
    [714, { outcome: 'permanent_error' as const, errorCode: 'sms019_bad_temp_bl_714' }],

    // ── ולידציה שנדחתה לפני שליחה. מוכח שלא נשלח. ──
    [1, { outcome: 'permanent_error' as const, errorCode: 'sms019_parse_error_1' }],
    [2, { outcome: 'permanent_error' as const, errorCode: 'sms019_missing_field_2' }],
    [7, { outcome: 'permanent_error' as const, errorCode: 'sms019_wrong_format_bulk_7' }],
    [510, { outcome: 'permanent_error' as const, errorCode: 'sms019_no_phones_510' }],
    [980, { outcome: 'permanent_error' as const, errorCode: 'sms019_invalid_link_980' }],
    [981, { outcome: 'permanent_error' as const, errorCode: 'sms019_hash_error_981' }],
    [986, { outcome: 'permanent_error' as const, errorCode: 'sms019_bad_unsubscribe_986' }],
    [988, { outcome: 'permanent_error' as const, errorCode: 'sms019_contact_list_missing_988' }],
    [989, { outcome: 'permanent_error' as const, errorCode: 'sms019_message_length_989' }],
    [992, { outcome: 'permanent_error' as const, errorCode: 'sms019_source_length_992' }],
    [997, { outcome: 'permanent_error' as const, errorCode: 'sms019_bad_command_997' }],

    // ── 🔒 עמום. 019 אינו מגדיר אם ההודעה כבר נכנסה לתור. ──
    [6, { outcome: 'delivery_unknown' as const, errorCode: 'sms019_process_failure_6' }],
    [998, { outcome: 'delivery_unknown' as const, errorCode: 'sms019_unknown_error_998' }],
    [999, { outcome: 'delivery_unknown' as const, errorCode: 'sms019_contact_support_999' }],
  ])

/**
 * סיווג גוף התשובה של 019 (HTTP 200).
 *
 * ⚠️ `status: 0` פירושו **"הבקשה התקבלה למשלוח"** ולא "ההודעה הגיעה לטלפון".
 * זו הסיבה שהתווית במסך הניהול היא "נמסרה לספק השליחה". אישור מסירה אמיתי
 * מגיע רק מ-DLR, שאינו ממומש בשלב 12A.
 *
 * ⚠️ גוף שאין בו `status` מספרי, או קוד שאינו בטבלה — delivery_unknown.
 * תשובה שאיננו מבינים אינה תשובה שמוכיחה דחייה.
 */
export function classifySms019Body(body: unknown): ReminderDeliveryResult {
  if (body === null || typeof body !== 'object') {
    return { outcome: 'delivery_unknown', errorCode: 'sms019_malformed_response' }
  }

  const raw = (body as { status?: unknown }).status
  const status = typeof raw === 'string' && /^-?\d+$/.test(raw.trim()) ? Number(raw) : raw
  if (typeof status !== 'number' || !Number.isFinite(status)) {
    return { outcome: 'delivery_unknown', errorCode: 'sms019_malformed_response' }
  }

  if (status === 0) {
    const shipment = (body as { shipment_id?: unknown }).shipment_id
    const providerMessageId =
      typeof shipment === 'string' && shipment.trim() !== ''
        ? shipment.trim()
        : typeof shipment === 'number' && Number.isFinite(shipment)
          ? String(shipment)
          : undefined

    /*
     * 🔒 hotfix — **`status: 0` לבדו אינו הצלחה.**
     *
     * ⚠️ החוזה של 019 לקבלת בקשה למשלוח הוא **שני** שדות: `status: 0`
     * ו-`shipment_id`. עד כאן נבדק רק הראשון, ו-`shipment_id` נחשב
     * "נחמד שיהיה" — כלומר תשובת HTTP 200 שיש בה `status: 0` ואין בה
     * מזהה משלוח נרשמה כ-accepted, וה-RPC הפכה אותה ל-`sent`.
     *
     * ⚠️ זהו בדיוק המצב שנצפה בפרודקשן: שורות `sent` שאין להן
     * `provider_message_id`, ושאין להן שום זכר בדוח ההודעות היוצאות של
     * 019. `sent` בלי מזהה משלוח הוא הצהרה שאין מאחוריה שום ראיה.
     *
     * 🔒 הסיווג הוא `delivery_unknown` ולא כשל: הבקשה **כן** יצאה,
     * ו-019 **כן** ענה 200. אין הוכחה שההודעה נדחתה, ולכן אין לנסות
     * שוב — ל-019 אין idempotency מוכחת, ו-retry כאן הוא הימור על SMS
     * שני על חשבון הלקוחה. זה בדיוק הכלל שבראש הקובץ.
     *
     * ⚠️ המסלול משותף ל-OTP, לתזכורות ולהתראות **בכוונה**, וזה מה
     * שמקיים את הדרישה "אותו serializer, בלי מימוש מקביל". התנהגות
     * המסלולים שעובדים אינה משתנה: תשובת הצלחה אמיתית של 019 נושאת
     * `shipment_id`, ולכן היא ממשיכה להיות accepted בדיוק כמו קודם.
     * ב-OTP `delivery_unknown` מתורגם ל-`{ok:true, uncertain:true}` —
     * שורת הקוד נשארת תקפה והלקוחה אינה נענשת.
     */
    if (providerMessageId === undefined) {
      return { outcome: 'delivery_unknown', errorCode: 'sms019_accepted_without_shipment_id' }
    }

    return { outcome: 'accepted', providerMessageId }
  }

  const mapped = PROVIDER_STATUS_MAP.get(status)
  if (mapped) return { outcome: mapped.outcome, errorCode: mapped.errorCode }

  // 🔒 ברירת המחדל אינה permanent ואינה retryable.
  return { outcome: 'delivery_unknown', errorCode: 'sms019_unmapped_status' }
}

/** נחשף לבדיקות בלבד — כדי לאמת שכל קוד מתועד ממופה. */
export const SMS019_MAPPED_STATUS_CODES: readonly number[] =
  Array.from(PROVIDER_STATUS_MAP.keys())
