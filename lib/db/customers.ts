import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/**
 * כרטיס הלקוחה — יצירה וקריאה.
 *
 * הזהות עצמה נשמרת ב-auth.users של Supabase, ו-customers.id מצביע אליה.
 * כך יש מאגר זהויות אחד, והמעבר בעתיד ל-session מקורי של Supabase לא ידרוש
 * הגירת נתונים.
 *
 * ⚠️ המספר שמגיע לכאן חייב להיות מנורמל כבר (lib/phone.ts). ה-CHECK בבסיס
 * הנתונים יחסום פורמט אחר, אבל עדיף להיכשל מוקדם.
 */

export interface Customer {
  id: string
  phone_e164: string
  full_name: string
  created_at: string
  is_blocked: boolean
}

/**
 * מוצא לקוחה לפי טלפון, או יוצר אותה אם אינה קיימת.
 *
 * זו הנקודה שמונעת חשבונות כפולים: החיפוש הוא לפי phone_e164 שהוא UNIQUE,
 * וכל הפורמטים כבר התכנסו למחרוזת אחת לפני שהגיעו לכאן.
 */
export async function findOrCreateCustomer(
  phoneE164: string,
  fullName?: string,
): Promise<{ customer: Customer | null; created: boolean; error?: string }> {
  const db = createSupabaseAdminClient()

  const { data: existing, error: findErr } = await db
    .from('customers')
    .select('id, phone_e164, full_name, created_at, is_blocked')
    .eq('phone_e164', phoneE164)
    .maybeSingle()

  if (findErr) {
    console.error('[customers] lookup failed', findErr.message)
    return { customer: null, created: false, error: 'lookup_failed' }
  }

  if (existing) {
    return { customer: existing as Customer, created: false }
  }

  // לקוחה חדשה — קודם זהות ב-auth.users, כי customers.id מצביע אליה
  const { data: authUser, error: authErr } = await db.auth.admin.createUser({
    phone: phoneE164.replace('+', ''), // Supabase שומר טלפון בלי ה-+
    phone_confirm: true,               // אימתנו אותו בעצמנו דרך ה-OTP
  })

  if (authErr || !authUser?.user) {
    console.error('[customers] auth user creation failed', authErr?.message)
    return { customer: null, created: false, error: 'auth_create_failed' }
  }

  const { data: created, error: insertErr } = await db
    .from('customers')
    .insert({
      id: authUser.user.id,
      phone_e164: phoneE164,
      full_name: (fullName ?? '').trim() || 'לקוחה',
    })
    .select('id, phone_e164, full_name, created_at, is_blocked')
    .single()

  if (insertErr) {
    console.error('[customers] insert failed', insertErr.message)
    return { customer: null, created: false, error: 'insert_failed' }
  }

  return { customer: created as Customer, created: true }
}

/** קריאת כרטיס לקוחה לפי מזהה — לשימוש אחרי אימות session בלבד */
export async function getCustomerById(id: string): Promise<Customer | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('customers')
    .select('id, phone_e164, full_name, created_at, is_blocked')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[customers] getById failed', error.message)
    return null
  }
  return (data as Customer) ?? null
}

export interface PagedCustomers {
  rows: Customer[]
  total: number
  page: number
  pageSize: number
}

/** גודל עמוד קבוע לרשימת הלקוחות בניהול */
export const ADMIN_PAGE_SIZE = 20

/**
 * מנקה קלט חיפוש חופשי לפני הכנסתו לתוך .or() של PostgREST: פסיקים
 * וסוגריים הם תווי syntax בפורמט ה-filter (מפרידים בין תנאים), ו-%/_/\
 * הם wildcards של ilike. בלי הניקוי הזה חיפוש עם פסיק היה יכול לשנות
 * את תנאי השאילתה בפועל ולא רק את הערך שמחפשים.
 */
function sanitizeSearchTerm(input: string): string {
  return input
    .trim()
    .replace(/[,()]/g, '')
    .replace(/[%_\\]/g, '\\$&')
}

/**
 * חיפוש לקוחות לפי שם או טלפון, מדופדף. חיפוש ריק מחזיר את כל הלקוחות
 * מהחדשה לישנה.
 */
export async function searchCustomers(query: string, page = 1): Promise<PagedCustomers> {
  const db = createSupabaseAdminClient()
  const p = Math.max(1, page)
  const from = (p - 1) * ADMIN_PAGE_SIZE
  const to = from + ADMIN_PAGE_SIZE - 1

  let q = db
    .from('customers')
    .select('id, phone_e164, full_name, created_at, is_blocked', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  const term = sanitizeSearchTerm(query)
  if (term) {
    q = q.or(`full_name.ilike.%${term}%,phone_e164.ilike.%${term}%`)
  }

  const { data, error, count } = await q
  if (error) {
    console.error('[customers] search failed', error.message)
    return { rows: [], total: 0, page: p, pageSize: ADMIN_PAGE_SIZE }
  }
  return { rows: (data ?? []) as Customer[], total: count ?? 0, page: p, pageSize: ADMIN_PAGE_SIZE }
}

/** עדכון שם — הפעולה היחידה שלקוחה יכולה לבצע על הכרטיס שלה */
export async function updateCustomerName(id: string, fullName: string): Promise<boolean> {
  const db = createSupabaseAdminClient()
  const { error } = await db
    .from('customers')
    .update({ full_name: fullName.trim() })
    .eq('id', id)

  if (error) {
    console.error('[customers] name update failed', error.message)
    return false
  }
  return true
}
