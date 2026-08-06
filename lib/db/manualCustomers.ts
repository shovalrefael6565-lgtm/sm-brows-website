import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { customerCreateFingerprint, canonicalFullName, type IdempotencyScope } from '@/lib/adminIdempotency'

/**
 * יצירת לקוחה ידנית מתוך מערכת הניהול, וחיפוש לקוחה לצורך תור (שלב 10).
 *
 * ⚠️ שני גבולות:
 *
 * 1. **actor_admin_id לעולם לא מגיע מהדפדפן.** הוא נלקח מ-requireAdminApi
 *    בשרת, וה-RPC מאמת אותו שוב מול טבלת admins.
 *
 * 2. **יצירה כאן אינה נוגעת ב-Auth בכלל.** אין auth user, אין OTP, אין SMS
 *    ואין WhatsApp. auth_user_id נשאר NULL עד שהלקוחה תתחבר בעצמה.
 */

export type ManualCustomerError =
  | 'not_admin'
  | 'invalid_name'
  | 'invalid_phone'
  | 'invalid_status'
  | 'invalid_source'
  | 'source_inactive'
  | 'idempotency_key_reused'
  | 'missing_request_id'
  | 'bad_fingerprint'
  | 'unknown'

/** התוצאה שנרשמת ב-admin_idempotency ומוחזרת שוב, זהה, בכל retry */
export type ManualCustomerResult =
  | { result: 'customer_created';   customerId: string; replayed: boolean }
  | { result: 'existing_customer';  customerId: string; replayed: boolean }
  /** הטלפון שייך לחשבון מנהל — בלי מזהה ובלי שם, רק העובדה שהוא תפוס */
  | { result: 'admin_phone_exists'; customerId: null;   replayed: boolean }

function mapError(message: string): ManualCustomerError {
  const m = message.toUpperCase()
  if (m.includes('NOT_ADMIN'))              return 'not_admin'
  if (m.includes('INVALID_NAME'))           return 'invalid_name'
  if (m.includes('INVALID_PHONE'))          return 'invalid_phone'
  if (m.includes('INVALID_STATUS'))         return 'invalid_status'
  if (m.includes('SOURCE_INACTIVE'))        return 'source_inactive'
  if (m.includes('INVALID_SOURCE'))         return 'invalid_source'
  if (m.includes('IDEMPOTENCY_KEY_REUSED')) return 'idempotency_key_reused'
  if (m.includes('MISSING_REQUEST_ID'))     return 'missing_request_id'
  if (m.includes('BAD_FINGERPRINT'))        return 'bad_fingerprint'
  return 'unknown'
}

export interface CreateManualCustomerInput {
  fullName: string
  /** כבר מנורמל ל-E.164 ע"י lib/phone.ts */
  phoneE164: string
  sourceKey: string
  crmStatus: 'active' | 'inactive'
  adminUserId: string
  clientRequestId: string
}

/**
 * יוצרת לקוחה ידנית, או מחזירה את הלקוחה הקיימת עם אותו טלפון.
 *
 * ⚠️ טלפון קיים אינו שגיאה ואינו הזדמנות לעדכן: השם, ה-source וה-status
 * של הלקוחה הקיימת נשארים כפי שהם, גם כשמגיע client_request_id חדש.
 */
export async function createManualCustomer(
  input: CreateManualCustomerInput,
): Promise<{ ok: true; data: ManualCustomerResult } | { ok: false; error: ManualCustomerError }> {
  const db = createSupabaseAdminClient()

  // ה-fingerprint מחושב על הערך שבאמת ייכתב (השם אחרי נרמול), כדי
  // ש-retry לגיטימי לא ייחשב "payload שונה" בגלל רווח כפול.
  const fullName = canonicalFullName(input.fullName)
  const fingerprint = customerCreateFingerprint({
    actorAdminId: input.adminUserId,
    fullName,
    phoneE164: input.phoneE164,
    sourceKey: input.sourceKey,
    crmStatus: input.crmStatus,
  })

  const { data, error } = await db.rpc('create_manual_customer', {
    p_full_name: fullName,
    p_phone_e164: input.phoneE164,
    p_source_key: input.sourceKey,
    p_crm_status: input.crmStatus,
    p_admin_id: input.adminUserId,
    p_client_request_id: input.clientRequestId,
    p_payload_fingerprint: fingerprint,
  })

  if (error) {
    const mapped = mapError(error.message)
    if (mapped === 'unknown') console.error('[manualCustomers] create failed', error.message)
    return { ok: false, error: mapped }
  }

  const row = data as { result: string; customer_id: string | null; replayed: boolean }
  return { ok: true, data: row as unknown as ManualCustomerResult }
}

/** רשומת idempotency קיימת — נקראת *לפני* כל בדיקת זמינות (ראה lib/adminBooking.ts) */
export interface IdempotencyRecord {
  payload_fingerprint: string
  target_id: string | null
  result_code: string | null
}

export async function lookupIdempotency(
  scope: IdempotencyScope,
  adminUserId: string,
  clientRequestId: string,
): Promise<{ ok: true; record: IdempotencyRecord | null } | { ok: false }> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('admin_idempotency')
    .select('payload_fingerprint, target_id, result_code')
    .eq('scope', scope)
    .eq('actor_admin_id', adminUserId)
    .eq('client_request_id', clientRequestId)
    .maybeSingle()

  if (error) {
    console.error('[manualCustomers] idempotency lookup failed', error.message)
    return { ok: false }
  }
  return { ok: true, record: (data as IdempotencyRecord | null) ?? null }
}

/** לקוחה כפי שהיא מוצגת בבורר של טופס התור — בלי שום שדה מיותר */
export interface BookingCustomer {
  id: string
  full_name: string
  phone_e164: string
  has_login_account: boolean
}

/**
 * חיפוש לקוחה לצורך שיוך תור. עובר דרך list_crm_customers ולא דרך שאילתה
 * חדשה, כדי לרשת ממנה את שלושת הדברים שכבר נבדקו בשלב 9: החרגת המנהלות,
 * נירמול הספרות של הטלפון, והבריחה מ-wildcards של ilike.
 */
export async function searchBookingCustomers(query: string, limit = 10): Promise<BookingCustomer[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('list_crm_customers', {
    p_search: query.trim() || null,
    p_filter: 'all',
    p_source_key: null,
    p_sort: 'last_activity',
    p_created_from: null,
    p_created_to: null,
    p_limit: limit,
    p_offset: 0,
  })

  if (error) {
    console.error('[manualCustomers] search failed', error.message)
    return []
  }

  const result = data as { items: BookingCustomer[] } | null
  // רק ארבעת השדות האלה עוברים הלאה — הרשימה מחזירה גם מדדי CRM שאין
  // להם מה לעשות בטופס קביעת תור.
  return (result?.items ?? []).map(i => ({
    id: i.id,
    full_name: i.full_name,
    phone_e164: i.phone_e164,
    has_login_account: i.has_login_account,
  }))
}

/**
 * טעינת לקוחה יחידה לטופס התור. מחזירה null גם למזהה שאינו קיים וגם
 * לחשבון מנהל — get_crm_customer כבר מחריגה מנהלות, ולכן אי אפשר להגיע
 * דרך כאן לקביעת תור על חשבון ניהולי.
 */
export async function getBookingCustomer(customerId: string): Promise<BookingCustomer | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('get_crm_customer', { p_customer_id: customerId })

  if (error) {
    console.error('[manualCustomers] customer load failed', error.message)
    return null
  }
  if (!data) return null

  const c = data as BookingCustomer
  return {
    id: c.id,
    full_name: c.full_name,
    phone_e164: c.phone_e164,
    has_login_account: c.has_login_account,
  }
}
