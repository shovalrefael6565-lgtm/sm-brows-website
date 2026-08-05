import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/**
 * שכבת הנתונים של ה-CRM (שלב 9).
 *
 * ─── שני גבולות שאסור לשבור ────────────────────────────────────────────────
 *
 * 1. **המזהה העסקי הוא customers.id ותמיד רק הוא.** אף פונקציה כאן אינה
 *    מקבלת session user id כמזהה לקוחה. כיום customers.id הוא גם ה-FK
 *    ל-auth.users(id) — ראה ההערה על hasLoginAccount למטה — אבל הקוד לא
 *    נשען על כך, כדי ששינוי הסכמה העתידי לא יחייב הגירה.
 *
 * 2. **actor_admin_id לעולם לא מגיע מהדפדפן.** כל פונקציה שמשנה מצב מקבלת
 *    adminUserId שנלקח מ-requireAdminApi בשרת, וה-RPC עצמו מאמת שוב שהוא
 *    קיים בטבלת admins. גוף הבקשה לא יכול להשפיע על מי נרשם כמבצע.
 *
 * כל המדדים מחושבים ב-DB (public.customer_crm_metrics) ואינם נשמרים, כדי
 * שהרשימה והפרופיל לא יוכלו להתפצל בהגדרה של "התור הבא" או "בקשה ממתינה".
 */

// ─── טיפוסים ────────────────────────────────────────────────────────────────

/** גודל עמוד ברשימת ה-CRM. ה-DB חותך ל-100 בכל מקרה. */
export const CRM_PAGE_SIZE = 25

export const CRM_FILTERS = [
  'all', 'active', 'inactive', 'has_future', 'no_future',
  'returning', 'no_show', 'cancelled',
] as const
export type CrmFilter = (typeof CRM_FILTERS)[number]

export const CRM_SORTS = [
  'last_activity', 'created_desc', 'created_asc', 'next_appointment', 'name',
] as const
export type CrmSort = (typeof CRM_SORTS)[number]

export interface CrmMetrics {
  completed_count: number
  no_show_count: number
  cancelled_by_customer_count: number
  cancelled_by_business_count: number
  active_pending_count: number
  /** סכום reschedule_count — הזזות עצמיות של הלקוחה, מזין את max_reschedules */
  self_reschedule_total: number
  /** כלל אירועי ההזזה, כולל מנהליים ומ-Google. מספר אחר מ-self_reschedule_total */
  all_reschedule_events: number
  first_completed_at: string | null
  last_completed_at: string | null
  next_confirmed_starts_at: string | null
  next_confirmed_service_key: string | null
  next_confirmed_variants: string[] | null
  open_notes_count: number
  last_activity_at: string
}

export interface CrmCustomerRow extends CrmMetrics {
  id: string
  full_name: string
  phone_e164: string
  created_at: string
  crm_status: 'active' | 'inactive'
  source_key: string
}

export interface CrmCustomerProfile extends CrmCustomerRow {
  crm_status_changed_at: string | null
  source_changed_at: string | null
}

export interface CrmNote {
  id: string
  body: string
  created_at: string
  updated_at: string
  created_by_admin_id: string
}

export interface CrmActivityRow {
  id: number
  action: string
  old_value: string | null
  new_value: string | null
  related_note_id: string | null
  created_at: string
}

export interface CrmSource {
  key: string
  label_he: string
  is_active: boolean
}

export interface CrmListParams {
  search?: string
  filter?: CrmFilter
  sourceKey?: string | null
  sort?: CrmSort
  createdFrom?: string | null
  createdTo?: string | null
  page?: number
}

export interface CrmListResult {
  items: CrmCustomerRow[]
  total: number
  page: number
  pageSize: number
}

// ─── קריאות ─────────────────────────────────────────────────────────────────

/**
 * רשימת ה-CRM. שאילתה אחת שמחזירה items ו-total_count מאותו CTE מסונן,
 * כך שאין N+1 ואין דרך שפילטר יחול על אחד ולא על השני.
 *
 * שובל ורפאל מוחרגות ב-DB דרך טבלת admins, ולכן הן אינן נספרות ב-total
 * ואינן מופיעות בחיפוש — לא כאן ולא בשום פילטר.
 */
export async function listCrmCustomers(params: CrmListParams): Promise<CrmListResult> {
  const db = createSupabaseAdminClient()
  const page = Math.max(1, Math.floor(params.page ?? 1) || 1)

  const { data, error } = await db.rpc('list_crm_customers', {
    p_search:       params.search?.trim() || null,
    p_filter:       params.filter ?? 'all',
    p_source_key:   params.sourceKey ?? null,
    p_sort:         params.sort ?? 'last_activity',
    p_created_from: params.createdFrom ?? null,
    p_created_to:   params.createdTo ?? null,
    p_limit:        CRM_PAGE_SIZE,
    p_offset:       (page - 1) * CRM_PAGE_SIZE,
  })

  if (error) {
    console.error('[crm] list failed', error.message)
    return { items: [], total: 0, page, pageSize: CRM_PAGE_SIZE }
  }

  const result = data as { items: CrmCustomerRow[]; total_count: number } | null
  return {
    items: result?.items ?? [],
    total: result?.total_count ?? 0,
    page,
    pageSize: CRM_PAGE_SIZE,
  }
}

/**
 * פרופיל לקוחה. מחזיר null גם כשהמזהה אינו קיים וגם כשהוא חשבון מנהל —
 * העמוד מתרגם את שניהם לאותו 404, בלי להסגיר שחשבון מנהל קיים.
 */
export async function getCrmCustomer(customerId: string): Promise<CrmCustomerProfile | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('get_crm_customer', { p_customer_id: customerId })

  if (error) {
    console.error('[crm] profile load failed', error.message)
    return null
  }
  return (data as CrmCustomerProfile | null) ?? null
}

/** הערות פעילות בלבד. הערה מאורכבת אינה מוצגת כברירת מחדל. */
export async function listCustomerNotes(customerId: string): Promise<CrmNote[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('customer_notes')
    .select('id, body, created_at, updated_at, created_by_admin_id')
    .eq('customer_id', customerId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[crm] notes load failed', error.message)
    return []
  }
  return (data ?? []) as CrmNote[]
}

export async function listCrmActivity(customerId: string, limit = 50): Promise<CrmActivityRow[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('customer_crm_activity')
    .select('id, action, old_value, new_value, related_note_id, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[crm] activity load failed', error.message)
    return []
  }
  return (data ?? []) as CrmActivityRow[]
}

/**
 * רשימת המקורות. נטענת בשרת דרך service_role — customer_sources חסומה
 * ל-anon ול-authenticated כמו שאר טבלאות ה-CRM.
 */
export async function listCrmSources(): Promise<CrmSource[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('customer_sources')
    .select('key, label_he, is_active')
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[crm] sources load failed', error.message)
    return []
  }
  return (data ?? []) as CrmSource[]
}

export interface CrmAppointmentRow {
  id: string
  service_key: string
  variants: string[]
  price_total: number | null
  starts_at: string
  duration_min: number
  status: string
  reschedule_count: number
  original_starts_at: string | null
  created_at: string
  pending_expires_at: string | null
  calendar_sync_status: string
}

export interface CrmHistoryRow {
  id: number
  action: string
  from_status: string | null
  to_status: string | null
  from_starts_at: string | null
  to_starts_at: string | null
  actor: string
  source: string | null
  created_at: string
}

/**
 * התורים של הלקוחה ל-timeline, מהחדש לישן.
 *
 * ⚠️ google_event_id ו-calendar_sync_error אינם נבחרים כאן בכוונה. ה-timeline
 * הוא client component, ו-Next.js מסרלל *כל* prop שמועבר אליו לתוך ה-RSC
 * payload שמוטמע ב-HTML — גם prop שלא מרונדר. שדה שנשלף כאן היה נחשף במקור
 * העמוד גם בלי להופיע על המסך. מצב הסנכרון מוצג כתווית מילולית בלבד.
 */
export async function listCustomerAppointments(customerId: string): Promise<CrmAppointmentRow[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('appointments')
    .select(
      'id, service_key, variants, price_total, starts_at, duration_min, status, ' +
      'reschedule_count, original_starts_at, created_at, pending_expires_at, ' +
      'calendar_sync_status',
    )
    .eq('customer_id', customerId)
    .order('starts_at', { ascending: false })

  if (error) {
    console.error('[crm] appointments load failed', error.message)
    return []
  }
  return (data ?? []) as unknown as CrmAppointmentRow[]
}

/** היסטוריית הפעולות של תור בודד. */
export async function listAppointmentHistory(appointmentId: string): Promise<CrmHistoryRow[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('appointment_history')
    .select('id, action, from_status, to_status, from_starts_at, to_starts_at, actor, source, created_at')
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[crm] history load failed', error.message)
    return []
  }
  return (data ?? []) as unknown as CrmHistoryRow[]
}

// ─── כתיבות ─────────────────────────────────────────────────────────────────
//
// כולן דרך RPC, שמאמת שוב את ה-actor מול admins ומבצע את השינוי ואת רישום
// ה-activity באותה טרנזקציה. כל אחת אידמפוטנטית: פעולה שלא שינתה דבר לא
// כותבת שורת activity נוספת.

/** שגיאות שה-RPC מחזיר בשמן, לתרגום להודעה מסוננת בעברית */
export type CrmMutationError =
  | 'not_admin' | 'invalid_status' | 'invalid_source' | 'source_inactive'
  | 'customer_not_found' | 'note_not_found' | 'note_archived'
  | 'note_empty' | 'note_too_long' | 'idempotency_key_reused'
  | 'missing_request_id' | 'unknown'

function toMutationError(message: string): CrmMutationError {
  const m = message.toUpperCase()
  if (m.includes('NOT_ADMIN'))               return 'not_admin'
  if (m.includes('INVALID_STATUS'))          return 'invalid_status'
  if (m.includes('SOURCE_INACTIVE'))         return 'source_inactive'
  if (m.includes('INVALID_SOURCE'))          return 'invalid_source'
  if (m.includes('CUSTOMER_NOT_FOUND'))      return 'customer_not_found'
  if (m.includes('NOTE_NOT_FOUND'))          return 'note_not_found'
  if (m.includes('NOTE_ARCHIVED'))           return 'note_archived'
  if (m.includes('NOTE_TOO_LONG'))           return 'note_too_long'
  if (m.includes('NOTE_EMPTY'))              return 'note_empty'
  if (m.includes('IDEMPOTENCY_KEY_REUSED'))  return 'idempotency_key_reused'
  if (m.includes('MISSING_REQUEST_ID'))      return 'missing_request_id'
  return 'unknown'
}

export type CrmResult<T> = { ok: true; data: T } | { ok: false; error: CrmMutationError }

async function callCrmRpc<T>(fn: string, args: Record<string, unknown>): Promise<CrmResult<T>> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc(fn, args)

  if (error) {
    // רק שם השגיאה נרשם. לעולם לא גוף הערה, לא טלפון ולא payload.
    const mapped = toMutationError(error.message)
    console.error(`[crm] ${fn} failed`, mapped)
    return { ok: false, error: mapped }
  }
  return { ok: true, data: data as T }
}

export function setCustomerCrmStatus(customerId: string, status: 'active' | 'inactive', adminUserId: string) {
  return callCrmRpc<{ changed: boolean; crm_status: string }>('set_customer_crm_status', {
    p_customer_id: customerId, p_status: status, p_admin_id: adminUserId,
  })
}

export function setCustomerSource(customerId: string, sourceKey: string, adminUserId: string) {
  return callCrmRpc<{ changed: boolean; source_key: string }>('set_customer_source', {
    p_customer_id: customerId, p_source_key: sourceKey, p_admin_id: adminUserId,
  })
}

export function createCustomerNote(
  customerId: string, body: string, adminUserId: string, clientRequestId: string,
) {
  return callCrmRpc<{ note_id: string; created: boolean }>('create_customer_note', {
    p_customer_id: customerId, p_body: body,
    p_admin_id: adminUserId, p_client_request_id: clientRequestId,
  })
}

export function updateCustomerNote(noteId: string, customerId: string, body: string, adminUserId: string) {
  return callCrmRpc<{ changed: boolean; note_id: string }>('update_customer_note', {
    p_note_id: noteId, p_customer_id: customerId, p_body: body, p_admin_id: adminUserId,
  })
}

export function archiveCustomerNote(noteId: string, customerId: string, adminUserId: string) {
  return callCrmRpc<{ changed: boolean; note_id: string }>('archive_customer_note', {
    p_note_id: noteId, p_customer_id: customerId, p_admin_id: adminUserId,
  })
}
