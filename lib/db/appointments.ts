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
 */

export type AppointmentCreateError = 'slot_taken' | 'db_error'

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

  const { data, error } = await db
    .from('appointments')
    .insert({
      customer_id: input.customerId,
      service_key: input.serviceKey,
      variants: input.variants,
      price_total: input.priceTotal,
      starts_at: startsAt.toISOString(),
      duration_min: input.durationMin,
      status: 'pending',
      notes: input.notes,
      policy_version: input.policyVersion,
    })
    .select('id, status, starts_at')
    .single()

  if (error) {
    // 23P01 = exclusion_violation — התנגשות עם תור פעיל אחר על אותו טווח זמן
    if (error.code === '23P01') return { error: 'slot_taken' }
    console.error('[appointments] insert failed', error.message)
    return { error: 'db_error' }
  }

  // רישום בהיסטוריה — best-effort. כישלון כאן לא אמור להפוך תור שכבר
  // נשמר בהצלחה לכישלון עבור הלקוחה; זה יומן ביקורת, לא ערובה עסקית.
  const { error: historyErr } = await db.from('appointment_history').insert({
    appointment_id: data.id,
    action: 'created',
    from_status: null,
    to_status: 'pending',
    actor: 'customer',
    actor_id: input.customerId,
  })
  if (historyErr) {
    console.error('[appointments] history insert failed', historyErr.message)
  }

  return { appointment: data as AppointmentSummary }
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

/** כל התורים של לקוחה, מהחדש לישן — לשימוש באזור האישי */
export async function listAppointmentsForCustomer(customerId: string): Promise<AppointmentRow[]> {
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
