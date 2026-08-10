import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  BUSINESS_START_MIN, BUSINESS_END_MIN, DAY_MIN,
  israelDateStr, israelMinutes, minToHHMM, dayBoundsUtc, israelWallTimeToUtc,
} from '@/lib/israelTime'
import { PUBLIC_BOOKING_MAX_PER_IP_PER_HOUR } from '@/lib/bookingRateLimit'

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
 * היצירה עצמה עוברת תמיד דרך RPC ולא דרך INSERT ישיר: הפונקציה מטפלת קודם
 * בתפוגת בקשות pending ישנות ורק אח"כ מנסה את ה-INSERT, הכול בטרנזקציה אחת —
 * כך שבקשה שפג תוקפה לא יכולה לחסום בקשה חדשה, וההגנה מפני חפיפה (EXCLUDE)
 * עדיין נבדקת כרגיל.
 *
 * שלושה מסלולי יצירה, שלוש פונקציות, כל אחת עם ה-booking_source שלה:
 *   • create_public_booking_request        (0018) — /booking הציבורי
 *   • create_personal_area_booking_request (0020) — האזור האישי
 *   • create_manual_appointment            (0018) — יצירה ידנית ע"י מנהלת
 *
 * ⚠️ create_pending_appointment (0003) **מוסרת ב-0021**. היא חישבה תפוגה
 * לפי business_settings.pending_expiration_hours (=12), כלל שהוחלף ב-15B
 * ב-lib/pendingExpiry.ts. אין להחזיר אותה: מועד התפוגה מחושב בשרת ומגיע
 * כפרמטר, כי הכלל נשען על ימי העבודה שמוגדרים ב-lib/bookingWindow.ts
 * ואינו ניתן לביטוי ב-SQL.
 */

export type AppointmentCreateError =
  | 'slot_taken'
  | 'pending_limit_reached'
  | 'blocked'
  | 'db_error'

export interface CreateAppointmentInput {
  /**
   * ⚠️ **אך ורק מ-getCurrentCustomerId.** אין לקבל אותו מגוף הבקשה בשום
   * מסלול: ה-RPC סומך על כך שהבעלות כבר הוכחה מול customers.auth_user_id.
   */
  customerId: string
  serviceKey: string
  variants: string[]
  priceTotal: number
  isoDate: string
  time: string
  durationMin: number
  notes: string | null
  policyVersion: string
  /** מחושב ב-lib/pendingExpiry.ts — אותו כלל בדיוק כמו במסלול הציבורי */
  expiresAt: Date
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

/**
 * בקשת תור מהאזור האישי — **קריאה אחת, טרנזקציה אחת** (שלב 15D).
 *
 * ⚠️ מחליפה את createPendingAppointment, שקראה ל-RPC שמוסר ב-0021. שלושה
 * הבדלים מהותיים, וכולם מכוונים:
 *   • התפוגה מחושבת בשרת (computePendingExpiresAt) ומגיעה כפרמטר, במקום
 *     12 השעות שה-RPC הישן חישב בעצמו
 *   • booking_source נכתב כ-'personal_area'
 *   • הספירה מול max_active_pending_per_customer מוגנת בנעילת namespace 5,
 *     אותה נעילה שהמסלול הציבורי אוחז בה
 *
 * 🔒 ההגנה מפני חפיפה נשארת ה-EXCLUDE constraint, כמו בכל מסלול אחר.
 */
export async function createPersonalAreaBookingRequest(
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResult> {
  const db = createSupabaseAdminClient()
  const startsAt = israelWallTimeToUtc(input.isoDate, input.time)

  const { data, error } = await db.rpc('create_personal_area_booking_request', {
    p_customer_id: input.customerId,
    p_service_key: input.serviceKey,
    p_variants: input.variants,
    p_price_total: input.priceTotal,
    p_starts_at: startsAt.toISOString(),
    p_duration_min: input.durationMin,
    p_notes: input.notes,
    p_policy_version: input.policyVersion,
    p_expires_at: input.expiresAt.toISOString(),
  })

  if (error) {
    // 23P01 = exclusion_violation — התנגשות עם תור פעיל אחר על אותו טווח זמן
    if (error.code === '23P01') return { error: 'slot_taken' }
    if (error.message?.includes('PENDING_LIMIT_REACHED')) return { error: 'pending_limit_reached' }
    /*
     * הלקוחה נחסמה בין אימות ה-session לכתיבה. ה-route בודק חסימה גם
     * בעצמו — הבדיקה כאן היא זו שרצה בתוך הטרנזקציה, ולכן היא הקובעת.
     */
    if (error.message?.includes('CUSTOMER_BLOCKED')) return { error: 'blocked' }
    /*
     * ⚠️ קלט שה-RPC דחה (לקוחה שלא נמצאה, תפוגה לא סבירה, מועד בעבר) הוא
     * באג אצלנו ולא טעות של הלקוחה — ה-route כבר ולידט את המועד, ואת
     * הלקוחה הוא קיבל מ-getCurrentCustomerId. נרשם במפורש כדי שלא ייבלע
     * בתוך 'db_error' גנרי.
     */
    if (
      error.message?.includes('MISSING_CUSTOMER') ||
      error.message?.includes('CUSTOMER_NOT_FOUND') ||
      error.message?.includes('BAD_EXPIRY') ||
      error.message?.includes('START_IN_PAST')
    ) {
      console.error('[appointments] personal area booking rejected input', error.message)
      return { error: 'db_error' }
    }
    console.error('[appointments] create_personal_area_booking_request failed', error.message)
    return { error: 'db_error' }
  }

  return { appointment: data as AppointmentSummary }
}

export type PublicBookingError =
  | 'slot_taken'
  | 'pending_limit_reached'
  | 'rate_limited'
  | 'blocked'
  | 'invalid_details'
  | 'db_error'

export interface CreatePublicBookingInput {
  /** מנורמל ל-E.164 לפני הקריאה (lib/phone.ts) */
  phoneE164: string
  fullName: string
  serviceKey: string
  variants: string[]
  priceTotal: number
  isoDate: string
  time: string
  durationMin: number
  notes: string | null
  policyVersion: string
  /** כתובת מהימנה בלבד — ראה lib/clientIp.ts. הקורא כבר אכף fail-closed. */
  ip: string
  /** מחושב ב-lib/pendingExpiry.ts. ה-RPC אוכף שהוא סביר, לא משכפל את הכלל. */
  expiresAt: Date
}

/**
 * בקשת תור מהמסלול הציבורי — **קריאה אחת, טרנזקציה אחת**.
 *
 * ⚠️ מקבלת טלפון ולא customerId, בכוונה. הזהות נפתרת בתוך ה-RPC, ולכן:
 *   • אין חלון שבו נוצרה לקוחה והתור נכשל (partial write)
 *   • מגבלת הקצב נאכפת **לפני** יצירת הלקוחה, ולכן אי אפשר לייצר שורות
 *     customers ע"י בקשות שנחסמות
 *   • ספירת ה-pending של הלקוחה אטומית (נעילת namespace 5)
 *
 * 🔒 ההגנה מפני חפיפה נשארת ה-EXCLUDE constraint, כמו בכל מסלול אחר.
 */
export async function createPublicBookingRequest(
  input: CreatePublicBookingInput,
): Promise<{ appointment?: AppointmentSummary; error?: PublicBookingError }> {
  const db = createSupabaseAdminClient()
  const startsAt = israelWallTimeToUtc(input.isoDate, input.time)

  const { data, error } = await db.rpc('create_public_booking_request', {
    p_phone_e164: input.phoneE164,
    p_full_name: input.fullName,
    p_service_key: input.serviceKey,
    p_variants: input.variants,
    p_price_total: input.priceTotal,
    p_starts_at: startsAt.toISOString(),
    p_duration_min: input.durationMin,
    p_notes: input.notes,
    p_policy_version: input.policyVersion,
    p_expires_at: input.expiresAt.toISOString(),
    p_ip: input.ip,
    p_max_per_ip_per_hour: PUBLIC_BOOKING_MAX_PER_IP_PER_HOUR,
  })

  if (error) {
    // 23P01 = exclusion_violation — השעה נתפסה ע"י תור פעיל אחר
    if (error.code === '23P01') return { error: 'slot_taken' }
    if (error.message?.includes('RATE_LIMITED')) return { error: 'rate_limited' }
    if (error.message?.includes('PENDING_LIMIT_REACHED')) return { error: 'pending_limit_reached' }
    /*
     * ⚠️ לקוחה חסומה. הקוד הזה קיים כדי שהשרת יידע מה קרה — ה-route
     * **חייב** להחזיר עליו תשובה גנרית, זהה לכשל שרת. ראה שם.
     */
    if (error.message?.includes('CUSTOMER_BLOCKED')) return { error: 'blocked' }
    if (error.message?.includes('BAD_PHONE') || error.message?.includes('BAD_NAME')) {
      return { error: 'invalid_details' }
    }
    // קלט שנדחה ע"י ה-RPC (IP חסר, תפוגה לא סבירה, מועד בעבר) — באג אצלנו.
    if (
      error.message?.includes('MISSING_IP') ||
      error.message?.includes('BAD_EXPIRY') ||
      error.message?.includes('START_IN_PAST')
    ) {
      console.error('[appointments] public booking rejected input', error.message)
      return { error: 'db_error' }
    }
    console.error('[appointments] create_public_booking_request failed', error.message)
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

const ADMIN_APPOINTMENT_COLUMNS =
  'id, service_key, variants, price_total, starts_at, ends_at, duration_min, status, created_at, ' +
  'notes, pending_expires_at, google_event_id, calendar_sync_status, calendar_sync_operation, ' +
  'calendar_sync_error, calendar_sync_started_at, calendar_synced_at, calendar_sync_attempt_count, ' +
  'booking_source, reschedule_of_appointment_id, reschedule_count, customer_id, ' +
  'customers(full_name, phone_e164)'

export type CalendarSyncOperation = 'upsert' | 'delete'

export type BookingSource = 'public_booking' | 'personal_area' | 'admin_manual'

export interface AdminAppointmentRow extends AppointmentRow {
  ends_at: string
  customer_id: string
  customer_full_name: string
  customer_phone_e164: string
  pending_expires_at: string | null
  google_event_id: string | null
  calendar_sync_status: string
  calendar_sync_operation: CalendarSyncOperation
  calendar_sync_error: string | null
  calendar_sync_started_at: string | null
  calendar_synced_at: string | null
  calendar_sync_attempt_count: number
  /** null = נוצר לפני 0017 ולא נרשם. אין backfill. */
  booking_source: BookingSource | null
  /** הערה חופשית שהלקוחה הקלידה בטופס. null = לא הוזנה. */
  notes: string | null
  /**
   * 🔒 15E — לא null ⟹ **זו שורת בקשת שינוי מועד**, והערך הוא מזהה התור
   * המקורי שנשאר confirmed וחוסם את שעתו עד ההכרעה.
   */
  reschedule_of_appointment_id: string | null
  reschedule_count: number
}

type JoinedAdminRow = AppointmentRow & {
  ends_at: string
  notes: string | null
  pending_expires_at: string | null
  google_event_id: string | null
  calendar_sync_status: string
  calendar_sync_operation: CalendarSyncOperation
  calendar_sync_error: string | null
  calendar_sync_started_at: string | null
  calendar_synced_at: string | null
  calendar_sync_attempt_count: number
  booking_source: BookingSource | null
  reschedule_of_appointment_id: string | null
  reschedule_count: number
  customer_id: string
  customers: { full_name: string; phone_e164: string } | null
}

function toAdminRow(r: JoinedAdminRow): AdminAppointmentRow {
  return {
    id: r.id,
    service_key: r.service_key,
    variants: r.variants,
    price_total: r.price_total,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    duration_min: r.duration_min,
    status: r.status,
    created_at: r.created_at,
    pending_expires_at: r.pending_expires_at,
    google_event_id: r.google_event_id,
    calendar_sync_status: r.calendar_sync_status,
    calendar_sync_operation: r.calendar_sync_operation,
    calendar_sync_error: r.calendar_sync_error,
    calendar_sync_started_at: r.calendar_sync_started_at,
    calendar_synced_at: r.calendar_synced_at,
    calendar_sync_attempt_count: r.calendar_sync_attempt_count,
    booking_source: r.booking_source ?? null,
    notes: r.notes ?? null,
    reschedule_of_appointment_id: r.reschedule_of_appointment_id ?? null,
    reschedule_count: r.reschedule_count ?? 0,
    customer_id: r.customer_id,
    customer_full_name: r.customers?.full_name ?? '',
    customer_phone_e164: r.customers?.phone_e164 ?? '',
  }
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
    .select(ADMIN_APPOINTMENT_COLUMNS, { count: 'exact' })
    .order('starts_at', { ascending: false })
    .range(from, to)

  if (opts.status) query = query.eq('status', opts.status)

  const { data, error, count } = await query
  if (error) {
    console.error('[appointments] admin list failed', error.message)
    return { rows: [], total: 0, page, pageSize: ADMIN_PAGE_SIZE }
  }

  const rows = ((data ?? []) as unknown as JoinedAdminRow[]).map(toAdminRow)

  return { rows, total: count ?? 0, page, pageSize: ADMIN_PAGE_SIZE }
}

/**
 * בקשות pending שממתינות למנהלת, ובנוסף תורים שהסנכרון שלהם ליומן לא
 * הושלם (calendar_sync_status pending/failed/syncing) — כדי שכפתור "נסה
 * לסנכרן שוב" יהיה נגיש גם אחרי שהבקשה כבר עזבה את סטטוס pending (ראה
 * חלק 3 בהנחיות שלב 6: כשל Google לא יכול "לאבד" תור).
 *
 * משלב 7 זה כולל שני כיוונים: confirmed שממתין ליצירה/עדכון של האירוע,
 * ו-cancelled_by_customer שממתין למחיקתו. השני חשוב לא פחות — אירוע
 * שנשאר ביומן אחרי ביטול ממשיך לחסום שעה שכבר התפנתה.
 *
 * ללא דפדוף — במינוח מספרי הסטודיו כמות כזו קטנה מאוד תמיד.
 *
 * ⚠️ **מחזירה תוצאה מובחנת ולא מערך.** עד 15C כשל בשאילתה החזיר `[]`,
 * כלומר שובל ראתה "אין כרגע בקשות ממתינות" בזמן שהיו בקשות אמיתיות. זה
 * קרה בפועל ב-15B (`column appointments.booking_source does not exist`).
 * זהו בדיוק הכשל מסוג "היום פנוי" של resolveAvailability: במסך שכל
 * תכליתו לומר *מה דורש טיפול*, רשימה ריקה היא טענה — ואסור לטעון אותה
 * כשלא ידוע. הקורא חייב להבדיל בין "אין" לבין "לא הצלחנו לדעת".
 */
export type NeedsActionResult =
  | { ok: true; rows: AdminAppointmentRow[] }
  | { ok: false }

export async function listAppointmentsNeedingAdminAction(): Promise<NeedsActionResult> {
  await expireStalePendingAppointments()

  try {
    const db = createSupabaseAdminClient()

    const { data, error } = await db
      .from('appointments')
      .select(ADMIN_APPOINTMENT_COLUMNS)
      // 🔒 15E — 'rescheduled' חייב להיות כאן. תור מקורי שהוזז ממתין
      // למחיקת האירוע ביומן; בלי השורה הזו כשל מחיקה היה נעלם מהמסך
      // ושובל לא הייתה יודעת שאירוע ישן ממשיך לחסום שעה שהתפנתה.
      .or(
        'status.eq.pending,' +
          'and(status.eq.confirmed,calendar_sync_status.in.(pending,failed,syncing)),' +
          'and(status.eq.cancelled_by_customer,calendar_sync_status.in.(pending,failed,syncing)),' +
          'and(status.eq.rescheduled,calendar_sync_status.in.(pending,failed,syncing))',
      )
      .order('starts_at', { ascending: true })

    if (error) {
      console.error('[appointments] needs-action list failed', error.message)
      return { ok: false }
    }

    return { ok: true, rows: ((data ?? []) as unknown as JoinedAdminRow[]).map(toAdminRow) }
  } catch (err) {
    // createSupabaseAdminClient זורק על משתנה סביבה חסר. בלי ה-catch הזה
    // העמוד כולו היה קורס, ושובל לא הייתה מקבלת שום מסך שימושי.
    console.error('[appointments] needs-action list threw',
      err instanceof Error ? err.message : String(err))
    return { ok: false }
  }
}

/** תור בודד לתצוגת/פעולת ניהול, עם פרטי הלקוחה */
export async function getAppointmentForAdmin(appointmentId: string): Promise<AdminAppointmentRow | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('appointments')
    .select(ADMIN_APPOINTMENT_COLUMNS)
    .eq('id', appointmentId)
    .maybeSingle()

  if (error) {
    console.error('[appointments] admin detail failed', error.message)
    return null
  }
  if (!data) return null
  return toAdminRow(data as unknown as JoinedAdminRow)
}

/**
 * טעינה מרוכזת של תורים לפי מזהים — לתצוגת תקלות הסנכרון, שבה כל תקלה
 * מצביעה על תור אחר. שאילתה אחת במקום אחת לכל שורה.
 */
export async function listAppointmentsForAdminByIds(
  ids: string[],
): Promise<Map<string, AdminAppointmentRow>> {
  const map = new Map<string, AdminAppointmentRow>()
  if (ids.length === 0) return map

  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('appointments')
    .select(ADMIN_APPOINTMENT_COLUMNS)
    .in('id', ids)

  if (error) {
    console.error('[appointments] batch admin lookup failed', error.message)
    return map
  }
  for (const row of (data ?? []) as unknown as JoinedAdminRow[]) {
    map.set(row.id, toAdminRow(row))
  }
  return map
}

export type AdminLookupResult =
  | { ok: true; appointment: AdminAppointmentRow }
  | { ok: false; reason: 'not_found' | 'db_error' }

/**
 * זהה ל-getAppointmentForAdmin, אבל *מבדילה* בין "לא קיים" לבין "השאילתה
 * נכשלה" — אותו לקח של שלב 7.1 (ראה getAppointmentForCustomer).
 *
 * בסנכרון הנכנס ההבחנה הזו קריטית במיוחד: מיזוג ל-null היה גורם לתקלת DB
 * חולפת להיראות כמו "האירוע יתום", כלומר לסמן שינוי אמיתי כ-ignored
 * לצמיתות במקום להשאיר אותו ל-retry. שינוי שנזרק כך אבוד — Google לא
 * יחזיר אותו שוב לעולם.
 */
export async function getAppointmentForInboundSync(
  appointmentId: string,
): Promise<AdminLookupResult> {
  const db = createSupabaseAdminClient()
  try {
    const { data, error } = await db
      .from('appointments')
      .select(ADMIN_APPOINTMENT_COLUMNS)
      .eq('id', appointmentId)
      .maybeSingle()

    if (error) {
      console.error('[appointments] inbound sync detail failed', error.message)
      return { ok: false, reason: 'db_error' }
    }
    if (!data) return { ok: false, reason: 'not_found' }
    return { ok: true, appointment: toAdminRow(data as unknown as JoinedAdminRow) }
  } catch (err) {
    console.error('[appointments] inbound sync detail threw',
      err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'db_error' }
  }
}

export type ApprovalRpcError = 'not_pending' | 'db_error'

/** מאשרת בקשת pending → confirmed. אין כאן שום אינטראקציה עם Calendar. */
export async function approvePendingAppointment(
  appointmentId: string,
  adminId: string,
): Promise<{ ok: true } | { ok: false; error: ApprovalRpcError }> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('approve_pending_appointment', {
    p_appointment_id: appointmentId,
    p_admin_id: adminId,
  })
  if (error) {
    if (error.message?.includes('NOT_PENDING')) return { ok: false, error: 'not_pending' }
    console.error('[appointments] approve failed', error.message)
    return { ok: false, error: 'db_error' }
  }
  return { ok: true }
}

/**
 * דוחה בקשת pending → rejected (0019). אין כאן אינטראקציה עם Calendar —
 * בקשה שלא אושרה מעולם לא קיבלה אירוע ביומן.
 *
 * ⚠️ 'rejected' ולא 'cancelled_by_business': השני נשאר לביטול תור שכבר
 * היה מאושר. ראה 0019.
 */
export async function rejectPendingAppointment(
  appointmentId: string,
  adminId: string,
): Promise<{ ok: true } | { ok: false; error: ApprovalRpcError }> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('reject_pending_appointment', {
    p_appointment_id: appointmentId,
    p_admin_id: adminId,
  })
  if (error) {
    if (error.message?.includes('NOT_PENDING')) return { ok: false, error: 'not_pending' }
    console.error('[appointments] reject failed', error.message)
    return { ok: false, error: 'db_error' }
  }
  return { ok: true }
}

export type SyncClaimError = 'not_claimable' | 'db_error'

/**
 * תופסת claim לסנכרון היומן (pending/failed/syncing-שפג → syncing).
 * ראה claim_calendar_sync ב-0004 — ה-WHERE שם, לא כאן, הוא ההגנה האמיתית
 * מפני שני ניסיונות סנכרון מקבילים.
 */
export async function claimCalendarSync(
  appointmentId: string,
): Promise<{ ok: true; appointment: AppointmentRow } | { ok: false; error: SyncClaimError }> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('claim_calendar_sync', { p_appointment_id: appointmentId })
  if (error) {
    if (error.message?.includes('NOT_CLAIMABLE')) return { ok: false, error: 'not_claimable' }
    console.error('[appointments] claim_calendar_sync failed', error.message)
    return { ok: false, error: 'db_error' }
  }
  return { ok: true, appointment: data as AppointmentRow }
}

/** סוגרת claim בהצלחה — שומרת google_event_id ומסמנת synced. */
export async function completeCalendarSync(appointmentId: string, googleEventId: string): Promise<boolean> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('complete_calendar_sync', {
    p_appointment_id: appointmentId,
    p_google_event_id: googleEventId,
  })
  if (error) {
    console.error('[appointments] complete_calendar_sync failed', error.message)
    return false
  }
  return true
}

/**
 * סוגרת claim של *מחיקה* בהצלחה. אין google_event_id חדש לשמור — המזהה
 * הישן נשאר בשורה כתיעוד של מה נמחק (ראה complete_calendar_delete ב-0005).
 */
export async function completeCalendarDelete(appointmentId: string): Promise<boolean> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('complete_calendar_delete', { p_appointment_id: appointmentId })
  if (error) {
    console.error('[appointments] complete_calendar_delete failed', error.message)
    return false
  }
  return true
}

/** סוגרת claim בכישלון — שומרת הודעת שגיאה מסוננת בלבד (ראה sanitizeGoogleError). */
export async function failCalendarSync(appointmentId: string, errorMessage: string): Promise<boolean> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('fail_calendar_sync', {
    p_appointment_id: appointmentId,
    p_error: errorMessage,
  })
  if (error) {
    console.error('[appointments] fail_calendar_sync failed', error.message)
    return false
  }
  return true
}

/**
 * תור של לקוחה, כפי שהוא נראה באזור האישי. מרחיב את AppointmentRow בשדות
 * שנדרשים כדי לחשב הרשאות פעולה (מדיניות, מונה הזזות) ולהציג מצב סנכרון.
 */
export interface CustomerAppointmentRow extends AppointmentRow {
  ends_at: string
  reschedule_count: number
  original_starts_at: string | null
  has_deposit: boolean
  google_event_id: string | null
  calendar_sync_status: string
  calendar_sync_operation: CalendarSyncOperation
  /**
   * 🔒 15E — לא null ⟹ זו שורת **בקשת שינוי מועד** ולא תור בפני עצמו.
   * האזור האישי אינו מציג אותה ככרטיס נפרד אלא כהודעה על התור המקורי.
   */
  reschedule_of_appointment_id: string | null
}

const CUSTOMER_APPOINTMENT_COLUMNS =
  'id, service_key, variants, price_total, starts_at, ends_at, duration_min, status, created_at, ' +
  'reschedule_count, original_starts_at, has_deposit, google_event_id, ' +
  'calendar_sync_status, calendar_sync_operation, reschedule_of_appointment_id'

/** כל התורים של לקוחה, מהחדש לישן — לשימוש באזור האישי */
export async function listAppointmentsForCustomer(
  customerId: string,
): Promise<CustomerAppointmentRow[]> {
  await expireStalePendingAppointments()
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('appointments')
    .select(CUSTOMER_APPOINTMENT_COLUMNS)
    .eq('customer_id', customerId)
    .order('starts_at', { ascending: false })

  if (error) {
    console.error('[appointments] list failed', error.message)
    return []
  }
  return (data ?? []) as unknown as CustomerAppointmentRow[]
}

export type CustomerLookupResult =
  | { ok: true; appointment: CustomerAppointmentRow }
  | { ok: false; reason: 'not_found' | 'db_error' }

/**
 * תור בודד של הלקוחה המחוברת. ה-customer_id הוא חלק מהשאילתה ולא נבדק
 * אחריה — תור של לקוחה אחרת פשוט לא נמצא, ולכן אין דרך להסיק מהתשובה
 * שהוא קיים בכלל.
 *
 * ⚠️ "לא נמצא" ו-"השאילתה נכשלה" מוחזרים בנפרד ולא מתמזגים ל-null.
 * מיזוג כזה היה הופך תקלת DB ל-404 "התור לא נמצא" — הודעה שקרית ללקוחה,
 * ובמסלול הביטול גם נפילה שקטה חזרה למסלול ה-pending. כשל אמיתי חייב
 * להיראות ככשל (503).
 */
export async function getAppointmentForCustomer(
  appointmentId: string,
  customerId: string,
): Promise<CustomerLookupResult> {
  const db = createSupabaseAdminClient()
  try {
    const { data, error } = await db
      .from('appointments')
      .select(CUSTOMER_APPOINTMENT_COLUMNS)
      .eq('id', appointmentId)
      .eq('customer_id', customerId)
      .maybeSingle()

    if (error) {
      console.error('[appointments] customer detail failed', error.message)
      return { ok: false, reason: 'db_error' }
    }
    if (!data) return { ok: false, reason: 'not_found' }
    return { ok: true, appointment: data as unknown as CustomerAppointmentRow }
  } catch (err) {
    console.error('[appointments] customer detail threw',
      err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'db_error' }
  }
}

/**
 * שגיאות שתי ה-RPC של שלב 7. כל אחת מגיעה כחריגה מתוך הפונקציה ב-DB
 * (ראה 0005) — כלומר הטרנזקציה נפלה ושום דבר לא נכתב.
 */
export type SelfServiceError =
  | 'not_found'          // לא קיים, או לא שייך ללקוחה המחוברת
  | 'not_allowed_status' // הסטטוס הנוכחי לא מאפשר את הפעולה
  | 'sync_in_progress'   // פעולת סנכרון פעילה על אותו תור
  | 'in_past'            // התור (או המועד המבוקש) כבר עבר
  | 'max_reschedules'    // מיצתה את מספר ההזזות
  | 'deposit_locked'     // תור עם מקדמה — 🔒 לא נוצר יותר; ראה למטה
  | 'too_late'           // מחוץ לחלון המדיניות
  | 'slot_taken'         // ה-EXCLUDE constraint חסם — מישהי אחרת תפסה
  // ── 15E ──
  | 'no_change'          // נבחר בדיוק המועד הקיים
  | 'self_overlap'       // היעד חופף לתור המקורי, שנשאר מוחזק
  | 'request_exists'     // כבר יש בקשת שינוי פתוחה לתור הזה
  | 'customer_blocked'
  | 'db_error'

/**
 * ⚠️ 'deposit_locked' נשאר בטיפוס אך **אינו מיוצר יותר**: 0022 הסירה את
 * ענף המקדמה מ-cancel_confirmed_appointment_by_customer, ו-
 * create_reschedule_request מעולם לא כלל אותו. הוא נשמר כדי שקוד ישן
 * שממפה הודעות לא יישבר, ומפני שה-RPC הישן (0005) עדיין חי עד 0023.
 */
function mapSelfServiceError(err: { code?: string; message?: string }): SelfServiceError {
  // 23P01 = exclusion_violation — הסלוט נתפס בין הבדיקה המוקדמת לכתיבה
  if (err.code === '23P01') return 'slot_taken'
  // 23505 = unique_violation — האינדקס appointments_one_open_reschedule_per_appt
  if (err.code === '23505') return 'request_exists'
  const m = err.message ?? ''
  if (m.includes('NOT_FOUND') || m.includes('CUSTOMER_NOT_FOUND')) return 'not_found'
  if (m.includes('NOT_RESCHEDULABLE') || m.includes('NOT_CANCELLABLE')) return 'not_allowed_status'
  if (m.includes('SYNC_IN_PROGRESS')) return 'sync_in_progress'
  if (m.includes('NEW_IN_PAST') || m.includes('IN_PAST')) return 'in_past'
  if (m.includes('MAX_RESCHEDULES')) return 'max_reschedules'
  if (m.includes('DEPOSIT_LOCKED')) return 'deposit_locked'
  if (m.includes('TOO_LATE')) return 'too_late'
  if (m.includes('SELF_OVERLAP')) return 'self_overlap'
  if (m.includes('NO_CHANGE')) return 'no_change'
  if (m.includes('REQUEST_EXISTS')) return 'request_exists'
  if (m.includes('CUSTOMER_BLOCKED')) return 'customer_blocked'
  return 'db_error'
}

export type RescheduleOutcome = 'applied' | 'no_change' | 'already_applied'
export type CancelOutcome = 'applied' | 'already_cancelled'

interface RpcEnvelope<T extends string> {
  outcome: T
  appointment: Record<string, unknown>
}

function toCustomerRow(raw: Record<string, unknown>): CustomerAppointmentRow {
  return raw as unknown as CustomerAppointmentRow
}

/**
 * 🔒 שלב 15E — יצירת **בקשת** שינוי מועד.
 *
 * ⚠️ עד 15E ישבה כאן rescheduleAppointmentByCustomer, שקראה ל-
 * reschedule_appointment_by_customer (0005) והזיזה תור **מיידית** —
 * UPDATE ישיר על starts_at, בלי אישור ובלי שלב ביניים. הפונקציה הזו
 * נמחקה מהקוד, וה-RPC שמאחוריה נמחק מהמסד ב-0023. **אין להחזיר אותה:**
 * היא עוקפת את מודל האישור, ומחזיקה עותק שני של כלל 6 השעות ושל
 * max_reschedules — כולל ענף המקדמה ש-15E ביטל.
 *
 * כאן לא זז שום דבר. נוצרת שורת appointments **שנייה** בסטטוס pending
 * שמצביעה על התור המקורי, והמקורי נשאר confirmed וחוסם את שעתו עד
 * ששובל מכריעה. ה-EXCLUDE constraint חוסם את שעת היעד בזכות עצם היות
 * השורה pending.
 *
 * כל האכיפה — בעלות, סטטוס, חפיפה עצמית, כלל 6 השעות, מונה ההזזות
 * ובקשה-פתוחה-אחת — נמצאת בתוך create_reschedule_request (0022),
 * בטרנזקציה אחת עם ה-INSERT.
 */
export async function createRescheduleRequest(params: {
  appointmentId: string
  customerId: string
  newStartsAt: Date
  expiresAt: Date
}): Promise<
  | { ok: true; request: CustomerAppointmentRow }
  | { ok: false; error: SelfServiceError }
> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('create_reschedule_request', {
    p_appointment_id: params.appointmentId,
    p_customer_id: params.customerId,
    p_new_starts_at: params.newStartsAt.toISOString(),
    p_expires_at: params.expiresAt.toISOString(),
  })

  if (error) {
    const mapped = mapSelfServiceError(error)
    if (mapped === 'db_error') {
      console.error('[appointments] create reschedule request failed', error.message)
    }
    return { ok: false, error: mapped }
  }

  return { ok: true, request: toCustomerRow(data as unknown as Record<string, unknown>) }
}

export type RescheduleAdminError = 'not_a_request' | 'not_pending' | 'original_not_confirmed'
  | 'sync_in_progress' | 'not_found' | 'slot_taken' | 'in_past' | 'db_error'

function mapRescheduleAdminError(err: { code?: string; message?: string }): RescheduleAdminError {
  if (err.code === '23P01') return 'slot_taken'
  const m = err.message ?? ''
  if (m.includes('NOT_A_REQUEST')) return 'not_a_request'
  if (m.includes('NOT_PENDING')) return 'not_pending'
  if (m.includes('ORIGINAL_NOT_CONFIRMED')) return 'original_not_confirmed'
  // 🔒 15E — אחד משני המועדים כבר חלף. ראה הגוארדים ב-0022.
  if (m.includes('ORIGINAL_IN_PAST') || m.includes('TARGET_IN_PAST')) return 'in_past'
  if (m.includes('SYNC_IN_PROGRESS')) return 'sync_in_progress'
  if (m.includes('NOT_FOUND')) return 'not_found'
  return 'db_error'
}

/**
 * 🔒 אישור בקשת שינוי מועד — הפעולה הקריטית של 15E.
 *
 * מחזירה את **מזהי** שתי השורות, כי לשתיהן יש עבודת סנכרון פתוחה:
 * החדשה צריכה upsert ליומן, והישנה צריכה delete.
 *
 * ⚠️ **מזהים בלבד, לא שורות מלאות — וזה מכוון.** ה-RPC מחזיר
 * to_jsonb(appointments_row), כלומר את שורת הטבלה בלי ה-join ל-customers.
 * החזרת האובייקט הזה כ-AdminAppointmentRow הייתה שקר טיפוסי:
 * customer_full_name ו-customer_phone_e164 היו undefined, ו-
 * runCalendarUpsert היה יוצר ביומן אירוע בלי שם ובלי טלפון — כשל שקט
 * שנראה כהצלחה. הקורא חייב לטעון מחדש דרך getAppointmentForAdmin.
 */
export async function approveRescheduleRequest(
  requestId: string,
  adminId: string,
): Promise<
  | { ok: true; requestId: string; originalId: string }
  | { ok: false; error: RescheduleAdminError }
> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('approve_reschedule_request', {
    p_request_id: requestId,
    p_admin_id: adminId,
  })

  if (error) {
    const mapped = mapRescheduleAdminError(error)
    if (mapped === 'db_error') {
      console.error('[appointments] approve reschedule failed', error.message)
    }
    return { ok: false, error: mapped }
  }

  const payload = data as unknown as {
    request: { id: string }
    original: { id: string }
  }
  return { ok: true, requestId: payload.request.id, originalId: payload.original.id }
}

/** דחיית בקשת שינוי מועד. 🔒 התור המקורי אינו נגוע — ראה 0022. */
export async function rejectRescheduleRequest(
  requestId: string,
  adminId: string,
): Promise<
  | { ok: true; originalId: string | null }
  | { ok: false; error: RescheduleAdminError }
> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('reject_reschedule_request', {
    p_request_id: requestId,
    p_admin_id: adminId,
  })

  if (error) {
    const mapped = mapRescheduleAdminError(error)
    if (mapped === 'db_error') {
      console.error('[appointments] reject reschedule failed', error.message)
    }
    return { ok: false, error: mapped }
  }

  /*
   * 🔒 15F — מזהה **התור המקורי**, מתוך שורת הבקשה שה-RPC מחזירה.
   *
   * ⚠️ נחוץ להודעת הדחייה: הנוסח המאושר מציג את המועד שנשאר שמור, כלומר
   * של התור המקורי — ולא את המועד שהתבקש ולא אושר. שאילתה נוספת הייתה
   * מיותרת; ה-RPC כבר מחזיר את השורה.
   */
  const row = data as { reschedule_of_appointment_id?: string | null } | null
  return { ok: true, originalId: row?.reschedule_of_appointment_id ?? null }
}

/** ביטול תור confirmed ע"י הלקוחה. אותו עיקרון: הכול נאכף ב-RPC. */
export async function cancelConfirmedAppointmentByCustomer(
  appointmentId: string,
  customerId: string,
): Promise<
  | { ok: true; outcome: CancelOutcome; appointment: CustomerAppointmentRow }
  | { ok: false; error: SelfServiceError }
> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('cancel_confirmed_appointment_by_customer', {
    p_appointment_id: appointmentId,
    p_customer_id: customerId,
  })

  if (error) {
    const mapped = mapSelfServiceError(error)
    if (mapped === 'db_error') {
      console.error('[appointments] cancel confirmed failed', error.message)
    }
    return { ok: false, error: mapped }
  }

  const envelope = data as unknown as RpcEnvelope<CancelOutcome>
  return { ok: true, outcome: envelope.outcome, appointment: toCustomerRow(envelope.appointment) }
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
