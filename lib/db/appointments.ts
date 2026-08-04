import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  BUSINESS_START_MIN, BUSINESS_END_MIN, DAY_MIN,
  israelDateStr, israelMinutes, minToHHMM, dayBoundsUtc, israelWallTimeToUtc,
} from '@/lib/israelTime'

/**
 * גישה ל-appointments — הצד שנוגע בבסיס הנתונים.
 *
 * שים לב: אין כאן שום בדיקת "האם הסלוט פנוי" ברמת אפליקציה לפני ה-INSERT.
 * זה מכוון — הבדיקה האמינה היחידה היא ה-EXCLUDE constraint שהוגדר במיגרציה
 * (appointments_no_overlap): שתי בקשות מקבילות על אותו זמן, אחת תיכשל
 * ב-DB עם קוד השגיאה 23P01. בדיקה מוקדמת ב-JS הייתה מספקת רק אשליית
 * בטיחות — יש חלון זמן (race) בין הבדיקה לכתיבה שבו שתי בקשות יכולות
 * לעבור אותה יחד.
 *
 * היצירה עצמה עוברת דרך create_pending_appointment (0002_pending_expiration),
 * לא INSERT ישיר: הפונקציה מטפלת קודם בתפוגת בקשות pending ישנות ורק
 * אח"כ מנסה את ה-INSERT, הכול בטרנזקציה אחת — כך שבקשה שפג תוקפה לא
 * יכולה לחסום בקשה חדשה, וההגנה מפני חפיפה (EXCLUDE) עדיין נבדקת כרגיל.
 */

export type AppointmentCreateError = 'slot_taken' | 'pending_limit_reached' | 'db_error'

export interface CreateAppointmentInput {
  customerId: string
  serviceKey: string
  variants: string[]
  priceTotal: number
  isoDate: string
  time: string
  durationMin: number
  notes: string | null
  policyVersion: string
}

export interface AppointmentSummary {
  id: string
  status: string
  starts_at: string
}

export interface CreateAppointmentResult {
  appointment?: AppointmentSummary
  error?: AppointmentCreateError
}

export async function createPendingAppointment(
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResult> {
  const db = createSupabaseAdminClient()
  const startsAt = israelWallTimeToUtc(input.isoDate, input.time)

  const { data, error } = await db.rpc('create_pending_appointment', {
    p_customer_id: input.customerId,
    p_service_key: input.serviceKey,
    p_variants: input.variants,
    p_price_total: input.priceTotal,
    p_starts_at: startsAt.toISOString(),
    p_duration_min: input.durationMin,
    p_notes: input.notes,
    p_policy_version: input.policyVersion,
  })

  if (error) {
    // 23P01 = exclusion_violation — התנגשות עם תור פעיל אחר על אותו טווח זמן
    if (error.code === '23P01') return { error: 'slot_taken' }
    if (error.message?.includes('PENDING_LIMIT_REACHED')) return { error: 'pending_limit_reached' }
    console.error('[appointments] create_pending_appointment failed', error.message)
    return { error: 'db_error' }
  }

  return { appointment: data as AppointmentSummary }
}

export type AppointmentCancelError = 'not_found' | 'db_error'

/**
 * ביטול בקשת pending ע"י הלקוחה שיצרה אותה. הבעלות והסטטוס נבדקים בתוך
 * cancel_pending_appointment עצמה (ב-DB) — לא כאן, כדי למנוע race.
 */
export async function cancelPendingAppointment(
  appointmentId: string,
  customerId: string,
): Promise<{ ok: true } | { ok: false; error: AppointmentCancelError }> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('cancel_pending_appointment', {
    p_appointment_id: appointmentId,
    p_customer_id: customerId,
  })

  if (error) {
    if (error.message?.includes('NOT_FOUND')) return { ok: false, error: 'not_found' }
    console.error('[appointments] cancel_pending_appointment failed', error.message)
    return { ok: false, error: 'db_error' }
  }
  return { ok: true }
}

/**
 * מסמנת בקשות pending שפג תוקפן כ-expired (+ היסטוריה). best-effort —
 * נקראת יזום לפני קריאה, כדי שסלוט ישתחרר ותור יוצג כ-expired גם בלי
 * שמישהי מנסה לקבוע תור חדש באותו רגע.
 */
export async function expireStalePendingAppointments(): Promise<void> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('expire_stale_pending_appointments')
  if (error) {
    console.error('[appointments] expire sweep failed', error.message)
  }
}

export interface AppointmentRow {
  id: string
  service_key: string
  variants: string[]
  price_total: number | null
  starts_at: string
  duration_min: number
  status: string
  created_at: string
}

export interface AdminAppointmentRow extends AppointmentRow {
  customer_id: string
  customer_full_name: string
  customer_phone_e164: string
}

export interface PagedResult<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

/** גודל עמוד קבוע לרשימות הניהול — עצירה מכוונת לפני שהעמוד גדל בלי סוף */
export const ADMIN_PAGE_SIZE = 20

/**
 * כל התורים לתצוגת מנהלת, עם שם וטלפון הלקוחה, מדופדף. סינון סטטוס
 * אופציונלי (למשל 'pending' לרשימת הבקשות הממתינות).
 *
 * read-only בלבד — אין כאן שום עדכון סטטוס. אישור/דחייה/הזזה מגיעים
 * בשלב הבא.
 */
export async function listAppointmentsAdmin(opts: {
  status?: string
  page?: number
}): Promise<PagedResult<AdminAppointmentRow>> {
  await expireStalePendingAppointments()
  const db = createSupabaseAdminClient()
  const page = Math.max(1, opts.page ?? 1)
  const from = (page - 1) * ADMIN_PAGE_SIZE
  const to = from + ADMIN_PAGE_SIZE - 1

  let query = db
    .from('appointments')
    .select(
      'id, service_key, variants, price_total, starts_at, duration_min, status, created_at, customer_id, customers(full_name, phone_e164)',
      { count: 'exact' },
    )
    .order('starts_at', { ascending: false })
    .range(from, to)

  if (opts.status) query = query.eq('status', opts.status)

  const { data, error, count } = await query
  if (error) {
    console.error('[appointments] admin list failed', error.message)
    return { rows: [], total: 0, page, pageSize: ADMIN_PAGE_SIZE }
  }

  type JoinedRow = AppointmentRow & {
    customer_id: string
    customers: { full_name: string; phone_e164: string } | null
  }

  const rows = ((data ?? []) as unknown as JoinedRow[]).map(r => ({
    id: r.id,
    service_key: r.service_key,
    variants: r.variants,
    price_total: r.price_total,
    starts_at: r.starts_at,
    duration_min: r.duration_min,
    status: r.status,
    created_at: r.created_at,
    customer_id: r.customer_id,
    customer_full_name: r.customers?.full_name ?? '',
    customer_phone_e164: r.customers?.phone_e164 ?? '',
  }))

  return { rows, total: count ?? 0, page, pageSize: ADMIN_PAGE_SIZE }
}

/** כל התורים של לקוחה, מהחדש לישן — לשימוש באזור האישי */
export async function listAppointmentsForCustomer(customerId: string): Promise<AppointmentRow[]> {
  await expireStalePendingAppointments()
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('appointments')
    .select('id, service_key, variants, price_total, starts_at, duration_min, status, created_at')
    .eq('customer_id', customerId)
    .order('starts_at', { ascending: false })

  if (error) {
    console.error('[appointments] list failed', error.message)
    return []
  }
  return (data ?? []) as AppointmentRow[]
}

/**
 * טווחי תפוסה (HH:MM ישראל) מתוך תורים פעילים (pending/confirmed) ב-DB
 * לתאריך נתון — מיועד להתמזג עם טווחי התפוסה מ-Google Calendar כדי
 * שבקשה שממתינה לאישור תיחסם מהצגה כפנויה ללקוחה אחרת. מראה בדיוק את
 * לוגיקת ה-clamping של getBusyRanges ב-lib/googleCalendar.ts.
 */
export async function getDbBusyRangesForDate(isoDate: string): Promise<{ start: string; end: string }[]> {
  await expireStalePendingAppointments()
  const db = createSupabaseAdminClient()
  const { timeMin, timeMax } = dayBoundsUtc(isoDate)

  const { data, error } = await db
    .from('appointments')
    .select('starts_at, ends_at')
    .in('status', ['pending', 'confirmed'])
    .gte('starts_at', timeMin)
    .lt('starts_at', timeMax)

  if (error) {
    console.error('[appointments] busy lookup failed', error.message)
    return []
  }

  const ranges: { start: string; end: string }[] = []
  for (const row of data ?? []) {
    const start = new Date(row.starts_at as string)
    const end = new Date(row.ends_at as string)

    const startDate = israelDateStr(start)
    const endDate = israelDateStr(end)

    let startMin: number
    if (startDate < isoDate) startMin = 0
    else if (startDate === isoDate) startMin = israelMinutes(start)
    else continue

    let endMin: number
    if (endDate > isoDate) endMin = DAY_MIN
    else if (endDate === isoDate) endMin = israelMinutes(end)
    else continue

    const s = Math.max(startMin, BUSINESS_START_MIN)
    const e = Math.min(endMin, BUSINESS_END_MIN)
    if (s < e) ranges.push({ start: minToHHMM(s), end: minToHHMM(e) })
  }
  return ranges
}
