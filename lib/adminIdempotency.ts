import { createHash } from 'crypto'

/**
 * טביעות אצבע ל-idempotency של פעולות ניהול (שלב 10).
 *
 * למה בשרת ולא ב-DB: pgcrypto אינה זמינה ב-PGlite שבו רצות כל הבדיקות
 * המקומיות, ו-Supabase אינה מבטיחה אותה. חשוב מכך — חישוב כאן מבטיח
 * canonicalization **אחת** לשני ה-routes, במקום שתי גרסאות (TS ו-SQL)
 * שיכולות להתבדר בשקט ולשבור retry דווקא כשצריך אותו.
 *
 * ה-fingerprint אינו מנגנון authorization: ה-RPCs ממילא service_role-only
 * וה-actor נלקח מה-session. הוא מזהה "האם זו אותה בקשה" — ולכן הוא חייב
 * לכלול **כל** שדה שמשפיע על התוצאה, ורק אותם.
 *
 * ⚠️ הסריאליזציה היא JSON עם keys בסדר קבוע, ולא שרשור מחרוזות עם מפריד.
 * שרשור היה יוצר ambiguity: שם שמכיל את תו המפריד יכול להתחזות לצירוף
 * שדות אחר. JSON.stringify בורח מהתווים בעצמו.
 */

/** גרסת פורמט. שינוי בסריאליזציה חייב להעלות אותה, כדי שמפתחות ישנים לא ייחשבו זהים לחדשים. */
export const FINGERPRINT_VERSION = 1

export type IdempotencyScope =
  | 'customer_create'
  | 'appointment_create'
  | 'manual_reminder_send'

function sha256Hex(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * מנרמל שם בדיוק כפי שהוא נשמר ב-DB (trim + כיווץ רצפי רווחים).
 *
 * אותה פונקציה משמשת גם את ה-payload שנשלח ל-RPC, ולכן ה-fingerprint
 * מחושב על הערך שבאמת ייכתב — לא על הקלט הגולמי. בלי זה, "רותי  כהן"
 * ו-"רותי כהן" היו מקבלים fingerprints שונים ומייצרים
 * IDEMPOTENCY_KEY_REUSED מזויף על retry לגיטימי.
 */
export function canonicalFullName(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

export interface CustomerCreateFingerprintInput {
  actorAdminId: string
  fullName: string
  phoneE164: string
  sourceKey: string
  crmStatus: 'active' | 'inactive'
}

export function customerCreateFingerprint(i: CustomerCreateFingerprintInput): string {
  return sha256Hex(
    JSON.stringify({
      version: FINGERPRINT_VERSION,
      scope: 'customer_create',
      actorAdminId: i.actorAdminId,
      fullName: canonicalFullName(i.fullName),
      phoneE164: i.phoneE164,
      sourceKey: i.sourceKey,
      crmStatus: i.crmStatus,
    }),
  )
}

export interface AppointmentCreateFingerprintInput {
  actorAdminId: string
  customerId: string
  serviceKey: string
  variants: string[]
  /** רגע ההתחלה. תמיד מומר ל-UTC ISO, ולכן זהה משני clients באזורי זמן שונים */
  startsAt: Date
  durationMin: number
  /**
   * null = טיפול ניהולי שהמחיר שלו לא נקבע מראש (שלב 12). ערך מובחן
   * מ-0, וכלול בטביעת האצבע בדיוק כמו כל מחיר אחר: הוספת מחיר ב-retry
   * היא בקשה אחרת, לא אותה בקשה.
   */
  priceTotal: number | null
  policyVersion: string
}

export function appointmentCreateFingerprint(i: AppointmentCreateFingerprintInput): string {
  return sha256Hex(
    JSON.stringify({
      version: FINGERPRINT_VERSION,
      scope: 'appointment_create',
      actorAdminId: i.actorAdminId,
      customerId: i.customerId,
      serviceKey: i.serviceKey,
      // מיון קנוני: הסדר שבו המנהלת סימנה את התוספות אינו אמור לשנות
      // את זהות הבקשה. ה-DB ממילא שומר את המערך בסדר של lib/services.ts.
      variants: [...i.variants].sort(),
      startsAt: i.startsAt.toISOString(),
      durationMin: i.durationMin,
      priceTotal: i.priceTotal,
      policyVersion: i.policyVersion,
    }),
  )
}

export interface ManualReminderFingerprintInput {
  actorAdminId: string
  appointmentId: string
  /** ה-snapshot של מועד התור. תמיד UTC ISO, ולכן זהה משני clients */
  appointmentStartsAt: Date
  templateVersion: string
}

/**
 * טביעת אצבע לשליחה ידנית של תזכורת (שלב 11).
 *
 * ⚠️ appointmentStartsAt הוא חלק מהזהות ולא קישוט: אם התור הוזז בין שתי
 * הלחיצות, זו כבר **בקשה אחרת** — אותה תזכורת הייתה מתארת מועד שכבר אינו
 * נכון. הכללתו כאן היא מה שהופך retry על תור שהוזז ל-IDEMPOTENCY_KEY_REUSED
 * במקום לשליחה שקטה של מועד ישן.
 *
 * templateVersion נכלל מאותו טעם: נוסח אחר = הודעה אחרת.
 */
export function manualReminderFingerprint(i: ManualReminderFingerprintInput): string {
  return sha256Hex(
    JSON.stringify({
      version: FINGERPRINT_VERSION,
      scope: 'manual_reminder_send',
      actorAdminId: i.actorAdminId,
      appointmentId: i.appointmentId,
      appointmentStartsAt: i.appointmentStartsAt.toISOString(),
      templateVersion: i.templateVersion,
    }),
  )
}

/** 64 תווי hex — אותה תבנית שה-RPC אוכף (BAD_FINGERPRINT) */
export const FINGERPRINT_RE = /^[0-9a-f]{64}$/
