import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { israelWallTimeToUtc } from '@/lib/israelTime'
import { PUBLIC_BOOKING_MAX_PER_IP_PER_HOUR } from '@/lib/bookingRateLimit'

/**
 * שכבת ה-DB של רשימת ההמתנה (0037).
 *
 * 🔒 **אין כאן שום נגיעה ב-`appointments`.** הטבלה `waitlist_requests`
 * נפרדת לחלוטין, אין עליה טריגרים, ו-`getDbBusyRangesForDate` (הפונקציה
 * היחידה שמזינה תפוסה מה-DB) קוראת אך ורק מ-`appointments`. לכן בקשת
 * המתנה אינה יכולה לחסום זמן, ליצור תזכורת או להגיע ליומן — לא בגלל
 * שהקוד נזהר, אלא בגלל שאין מסלול שמוביל לשם.
 */

export type WaitlistError =
  | 'rate_limited'
  | 'open_limit_reached'
  | 'hourly_limit_reached'
  | 'duplicate'
  | 'blocked'
  | 'privacy_not_acknowledged'
  | 'invalid_details'
  | 'db_error'

export type WaitlistStatus = 'open' | 'contacted' | 'closed'

export interface CreateWaitlistInput {
  phoneE164: string
  fullName: string
  serviceKey: string
  variants: string[]
  /** 🔒 נגזר בשרת מ-lib/services.ts. לעולם לא מגיע מהדפדפן. */
  durationMin: number
  isoDate: string
  time: string
  ip: string
  privacyNoticeVersion: string
  privacyAcknowledged: boolean
}

/**
 * יצירת בקשת המתנה.
 *
 * ⚠️ **אינה בודקת פנויות.** ה-revalidation מול Google Calendar ומול
 * `appointments` נעשה ב-route, על נתונים טריים, מיד לפני הקריאה הזו —
 * Postgres אינו יכול לראות את היומן.
 */
export async function createWaitlistRequest(
  input: CreateWaitlistInput,
): Promise<{ id?: string; error?: WaitlistError }> {
  const db = createSupabaseAdminClient()
  const requestedAt = israelWallTimeToUtc(input.isoDate, input.time)

  const { data, error } = await db.rpc('create_waitlist_request', {
    p_phone_e164: input.phoneE164,
    p_full_name: input.fullName,
    p_service_key: input.serviceKey,
    p_variants: input.variants,
    p_duration_min: input.durationMin,
    p_requested_at: requestedAt.toISOString(),
    p_ip: input.ip,
    // 🔒 מונה ה-IP משותף עם ההזמנות הציבוריות — אותה טבלה, אותה תקרה.
    p_max_per_ip_per_hour: PUBLIC_BOOKING_MAX_PER_IP_PER_HOUR,
    p_privacy_notice_version: input.privacyNoticeVersion,
    p_privacy_notice_acknowledged: input.privacyAcknowledged,
  })

  if (error) {
    if (error.message?.includes('RATE_LIMITED')) return { error: 'rate_limited' }
    if (error.message?.includes('WAITLIST_OPEN_LIMIT')) return { error: 'open_limit_reached' }
    if (error.message?.includes('WAITLIST_HOURLY_LIMIT')) return { error: 'hourly_limit_reached' }
    if (error.message?.includes('WAITLIST_DUPLICATE')) return { error: 'duplicate' }
    if (error.message?.includes('PRIVACY_NOT_ACKNOWLEDGED')) return { error: 'privacy_not_acknowledged' }
    /*
     * ⚠️ לקוחה חסומה — הקוד קיים כדי שהשרת יידע. ה-route **חייב** להחזיר
     * עליו תשובה גנרית וזהה לכשל שרת, בדיוק כמו במסלול ההזמנה: אחרת
     * ה-endpoint הופך לאורקל שממפה אילו מספרים חסומים.
     */
    if (error.message?.includes('CUSTOMER_BLOCKED')) return { error: 'blocked' }
    if (error.message?.includes('BAD_PHONE') || error.message?.includes('BAD_NAME')) {
      return { error: 'invalid_details' }
    }
    // ⚠️ ללא error.message המלא: הודעת שגיאה של הספק עלולה לשאת טלפון.
    console.error('[waitlist] create failed', error.code ?? 'unknown')
    return { error: 'db_error' }
  }

  const row = data as { id?: string } | null
  return row?.id ? { id: row.id } : { error: 'db_error' }
}

export interface WaitlistRow {
  id: string
  created_at: string
  requested_at: string
  service_key: string
  variants: string[]
  duration_min: number
  status: WaitlistStatus
  customer_id: string
  customer_name: string | null
  customer_phone: string | null
}

/**
 * הרשימה למסך הניהול — הבקשות החדשות ראשונות.
 *
 * ⚠️ שם וטלפון נשלפים מ-`customers` בזמן הקריאה ואינם שמורים על השורה
 * (ראה 0037). שינוי פרטים בכרטיס הלקוחה משתקף כאן מיד, ואין שני עותקים
 * של אותו PII שיכולים להתבדר.
 */
export async function listWaitlistRequests(limit = 100): Promise<WaitlistRow[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('waitlist_requests')
    .select('id, created_at, requested_at, service_key, variants, duration_min, status, customer_id, customers(full_name, phone_e164)')
    .order('requested_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[waitlist] list failed', error.message)
    return []
  }

  return (data ?? []).map(r => {
    const row = r as typeof r & { customers?: { full_name?: string | null; phone_e164?: string | null } | null }
    return {
      id: row.id as string,
      created_at: row.created_at as string,
      requested_at: row.requested_at as string,
      service_key: row.service_key as string,
      variants: (row.variants ?? []) as string[],
      duration_min: row.duration_min as number,
      status: row.status as WaitlistStatus,
      customer_id: row.customer_id as string,
      customer_name: row.customers?.full_name ?? null,
      customer_phone: row.customers?.phone_e164 ?? null,
    }
  })
}

/** שינוי סטטוס בלבד. אין מחיקה, ואין המרה לתור. */
export async function setWaitlistRequestStatus(
  id: string, status: WaitlistStatus,
): Promise<{ ok: boolean }> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('set_waitlist_request_status', {
    p_request_id: id,
    p_status: status,
  })
  if (error) {
    console.error('[waitlist] status update failed', error.code ?? 'unknown')
    return { ok: false }
  }
  return { ok: true }
}
