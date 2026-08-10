import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { NotificationEvent, RecipientRole } from '@/lib/messageTemplates'

/**
 * שלב 15F — גישת ה-DB להתראות הטרנזקציוניות.
 *
 * ⚠️ אין כאן שום יצירה של התראה. הרישום נעשה **אך ורק** ע"י הטריגר
 * שב-0025, בתוך הטרנזקציה של הפעולה העסקית. פונקציית enqueue מהאפליקציה
 * הייתה מסלול שני לאותה עובדה — ובדיוק המסלול שנשכח כשמוסיפים אירוע חדש.
 */

export type NotificationStatus =
  | 'queued'
  | 'sending'
  | 'retrying'
  | 'sent'
  | 'simulated'
  | 'failed'
  | 'delivery_unknown'
  | 'skipped'

export type NotificationAttemptOutcome =
  | 'accepted'
  | 'simulated'
  | 'retryable_error'
  | 'permanent_error'
  | 'delivery_unknown'
  | 'lease_expired'

export interface NotificationRow {
  id: string
  appointment_id: string
  event: NotificationEvent
  recipient_role: RecipientRole
  status: NotificationStatus
  attempt_count: number
  provider: string
  last_error_code: string | null
  created_at: string
}

/**
 * ⚠️ 120 שניות, זהה ל-REMINDER_LEASE_SECONDS. ה-lease חייב להיות ארוך
 * מ-timeout של 019 (10 שניות כברירת מחדל) בפער משמעותי, אחרת שורה שנתפסה
 * ע"י worker חי הייתה נראית נטושה ונחטפת תחתיו — כלומר SMS כפול.
 */
export const NOTIFICATION_LEASE_SECONDS = 120

/**
 * ⚠️ 4 ניסיונות, כמו בתזכורות. חשוב מה **לא** נספר כאן: `delivery_unknown`
 * הוא סופי ואינו חוזר למחזור בכלל, ולכן המונה מגביל אך ורק שגיאות זמניות
 * מוכחות.
 */
export const NOTIFICATION_MAX_ATTEMPTS = 4

/**
 * תפיסת ההתראה הבאה של תור נתון.
 *
 * ⚠️ מחזירה null כשאין מה לתפוס. ה-RPC מחזירה שורת composite שכל שדותיה
 * null במקרה כזה (התנהגות plpgsql), ולכן הבדיקה היא על `id` — לא על
 * הימצאות האובייקט.
 */
export async function claimNotification(
  appointmentId: string,
  leaseToken: string,
  provider: string,
): Promise<NotificationRow | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('claim_appointment_notification', {
    p_appointment_id: appointmentId,
    p_lease_token: leaseToken,
    p_lease_seconds: NOTIFICATION_LEASE_SECONDS,
    p_max_attempts: NOTIFICATION_MAX_ATTEMPTS,
    p_provider: provider,
  })

  if (error) {
    console.error('[notifications] claim failed', error.message)
    return null
  }
  const row = data as NotificationRow | null
  return row?.id ? row : null
}

export async function finishNotificationAttempt(params: {
  notificationId: string
  leaseToken: string
  outcome: NotificationAttemptOutcome
  errorCode: string | null
  providerMessageId: string | null
  provider: string
}): Promise<NotificationRow | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('finish_notification_attempt', {
    p_notification_id: params.notificationId,
    p_lease_token: params.leaseToken,
    p_outcome: params.outcome,
    p_error_code: params.errorCode,
    p_provider_message_id: params.providerMessageId,
    p_provider: params.provider,
    p_max_attempts: NOTIFICATION_MAX_ATTEMPTS,
  })

  if (error) {
    console.error('[notifications] finish failed', error.message)
    return null
  }
  const row = data as NotificationRow | null
  return row?.id ? row : null
}

/**
 * סימון "אין למי לשלוח" / "אין נוסח מאושר".
 *
 * ⚠️ `reason` חייב לעמוד ב-`^[a-z0-9_]{1,60}$` (CHECK על העמודה). זו אינה
 * קפדנות סרק: העמודה הזו היא היעד הטבעי שאליו מישהו ידחוף בעתיד הודעת
 * שגיאה חופשית של ספק, ואיתה טלפון או גוף הודעה.
 */
export async function skipNotification(
  notificationId: string,
  leaseToken: string,
  reason: string,
): Promise<NotificationRow | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('skip_notification', {
    p_notification_id: notificationId,
    p_lease_token: leaseToken,
    p_reason: reason,
  })

  if (error) {
    console.error('[notifications] skip failed', error.message)
    return null
  }
  const row = data as NotificationRow | null
  return row?.id ? row : null
}

/**
 * מספר הטלפון של הנמען, ותו לא.
 *
 * 🔒 **אין כאן שם, טיפול, מועד או מחיר** — בניגוד ל-`loadReminderRecipient`,
 * שטוענת `service_key` ו-`variants` כדי לבנות את שם הטיפול. נוסחי ה-SMS של
 * 15F סטטיים ואינם נושאים PII, ולכן טעינת הנתונים האלה הייתה שולפת מידע
 * שאיש לא ביקש — ומעמידה אותו במרחק שורת לוג אחת מדליפה.
 *
 * מחזירה null כשאין נמען: לקוחה בלי טלפון, או `admin_notification_phone`
 * שטרם הוגדר.
 */
export async function loadNotificationRecipient(
  appointmentId: string,
  role: RecipientRole,
): Promise<string | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('notification_recipient_phone', {
    p_appointment_id: appointmentId,
    p_recipient_role: role,
  })

  if (error) {
    console.error('[notifications] recipient lookup failed', error.message)
    return null
  }
  return (data as string | null) ?? null
}
