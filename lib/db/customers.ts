import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { verifyAuthUserPhone, findAuthUserIdByPhone } from '@/lib/auth/adminUserResolver'

/**
 * כרטיס הלקוחה — יצירה, קישור וקריאה.
 *
 * ─── המודל מאז שלב 10 ─────────────────────────────────────────────────────
 *
 * customer היא ישות עסקית עצמאית. חשבון ההתחברות (auth.users) מקושר אליה
 * דרך customers.auth_user_id, והקישור **אופציונלי**: לקוחה שנוצרה ידנית
 * ב-CRM קיימת בלי חשבון כלל, וכשהיא תתחבר בעתיד עם OTP החשבון ייקשר
 * לשורה הקיימת שלה לפי הטלפון — בלי כפילות ובלי לאבד היסטוריה.
 *
 * ⚠️ customers.id אינו auth user id. אין להעביר את אחד מהם במקום השני.
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

export type LoginResolutionError =
  | 'auth_ambiguous'      // יותר מ-auth user אחד לאותו טלפון — מצב נתונים פגום
  | 'auth_phone_mismatch' // ה-auth user קיים אך הטלפון שלו אינו זה שאומת
  | 'auth_create_failed'
  | 'auth_race_unresolved'
  | 'link_conflict'       // ה-auth user מקושר ללקוחה אחרת, או הטלפון ל-auth אחר
  | 'lookup_failed'

export interface LoginResolution {
  customer: Customer
  /** ה-auth user שאותר/נוצר — זהו userId של ה-session, ולא מזהה הלקוחה */
  authUserId: string
  created: boolean
  linked: boolean
}

/** כמה פעמים לנסות לאתר את ה-auth user שנוצר ע"י בקשה מקבילה */
const RACE_RETRIES = 4
const RACE_DELAY_MS = 200

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * מאתרת (או יוצרת) את חשבון ההתחברות לטלפון שאומת, ומקשרת אותו ללקוחה.
 *
 * זו הזרימה המלאה שמפעילה /api/auth/otp/verify אחרי אימות מוצלח של הקוד.
 * הטלפון מגיע אך ורק מזרימת ה-OTP המאומתת — לעולם לא ממזהה שנשלח מהדפדפן.
 *
 * ─── סדר הפעולות ולמה דווקא הוא ───────────────────────────────────────────
 *
 *   1. לקוחה לפי טלפון. אם היא כבר מקושרת — יש לנו את ה-auth user מיד,
 *      וזה המסלול של כל התחברות רגילה (בלי listUsers בכלל).
 *   2. אחרת: resolver ב-Auth Admin API לפי טלפון. זה מה שפותר את המצב שבו
 *      auth user קיים מדור קודם אך אף לקוחה אינה מקושרת אליו — המתנה על
 *      customers.auth_user_id לבדה הייתה נכשלת שם לנצח.
 *   3. אין auth user → יוצרים.
 *   4. createUser החזיר duplicate: בקשה מקבילה ניצחה. מריצים את ה-resolver
 *      שוב עם retry קצר ומוגבל — **לא** ממתינים על customers.auth_user_id,
 *      כי ייתכן שה-auth user קיים בלי לקוחה מקושרת.
 *   5. מאמתים שהטלפון של ה-auth user הוא באמת זה שאומת, לפני כל קישור.
 *   6. ה-RPC מקשר או יוצר — אטומית, עם נעילות מול התחברויות מקבילות.
 *
 * ⚠️ auth user יתום (נוצר, אך הקישור נכשל) אינו נמחק אוטומטית: ייתכן
 * שטרנזקציה מקבילה כבר קישרה אותו. ההתחברות הבאה מתאוששת דרך שלב 2 בלי
 * ליצור חשבון נוסף.
 */
export async function resolveCustomerForLogin(
  phoneE164: string,
  fullName?: string,
): Promise<{ ok: true; data: LoginResolution } | { ok: false; error: LoginResolutionError }> {
  const db = createSupabaseAdminClient()

  const { data: existing, error: findErr } = await db
    .from('customers')
    .select('auth_user_id')
    .eq('phone_e164', phoneE164)
    .maybeSingle()

  if (findErr) {
    console.error('[customers] lookup failed', findErr.message)
    return { ok: false, error: 'lookup_failed' }
  }

  let authUserId: string | null = (existing?.auth_user_id as string | null) ?? null

  if (!authUserId) {
    const found = await findAuthUserIdByPhone(phoneE164)
    if (!found.ok) {
      return { ok: false, error: found.error === 'ambiguous' ? 'auth_ambiguous' : 'lookup_failed' }
    }
    authUserId = found.id
  }

  if (!authUserId) {
    const { data: authUser, error: authErr } = await db.auth.admin.createUser({
      phone: phoneE164.replace('+', ''), // Supabase שומר טלפון בלי ה-+
      phone_confirm: true,               // אימתנו אותו בעצמנו דרך ה-OTP
    })

    if (authUser?.user) {
      authUserId = authUser.user.id
    } else {
      // ייתכן מאוד שזו בקשה מקבילה שהספיקה לפנינו, ולא תקלה. אסור להציג
      // זאת ללקוחה כשגיאת התחברות כשהחשבון בעצם כבר קיים.
      console.error('[customers] auth user creation failed', authErr?.message)
      for (let attempt = 0; attempt < RACE_RETRIES && !authUserId; attempt++) {
        await sleep(RACE_DELAY_MS)
        const retry = await findAuthUserIdByPhone(phoneE164)
        if (!retry.ok) {
          return { ok: false, error: retry.error === 'ambiguous' ? 'auth_ambiguous' : 'lookup_failed' }
        }
        authUserId = retry.id
      }
      if (!authUserId) return { ok: false, error: 'auth_race_unresolved' }
    }
  }

  const verified = await verifyAuthUserPhone(authUserId, phoneE164)
  if (verified !== 'ok') {
    console.error('[customers] auth user phone verification failed:', verified)
    return { ok: false, error: verified === 'not_found' ? 'lookup_failed' : 'auth_phone_mismatch' }
  }

  const { data: linked, error: rpcErr } = await db.rpc('link_or_create_customer_for_auth', {
    p_auth_user_id: authUserId,
    p_phone_e164: phoneE164,
    p_full_name: fullName ?? null,
  })

  if (rpcErr || !linked) {
    const msg = rpcErr?.message ?? ''
    if (msg.includes('AUTH_CUSTOMER_CONFLICT') || msg.includes('PHONE_LINKED_TO_OTHER_AUTH')) {
      console.error('[customers] link conflict', msg)
      return { ok: false, error: 'link_conflict' }
    }
    console.error('[customers] link_or_create failed', msg)
    return { ok: false, error: 'lookup_failed' }
  }

  const row = linked as {
    customer_id: string; phone_e164: string; full_name: string
    is_blocked: boolean; created: boolean; linked: boolean
  }

  return {
    ok: true,
    data: {
      customer: {
        id: row.customer_id,
        phone_e164: row.phone_e164,
        full_name: row.full_name,
        created_at: '',
        is_blocked: row.is_blocked,
      },
      authUserId,
      created: row.created,
      linked: row.linked,
    },
  }
}

export type PhoneResolutionError = 'bad_phone' | 'bad_name' | 'db_error'

/**
 * לקוחה לפי טלפון מנורמל — למסלול ההזמנה **הציבורי**, ללא OTP.
 *
 * ⚠️ אין לבלבל בין זו ל-resolveCustomerForLogin. ההבדל אינו טכני אלא
 * מהותי: שם הטלפון **אומת** בקוד חד-פעמי, וכאן הוא רק **הוקלד**. לכן:
 *
 *   • כאן לא נוצר auth user, לא נשלח OTP, ולא נוצר session.
 *   • הלקוחה שנוצרת כאן היא רשומה עסקית בלבד. היא לא יכולה להתחבר
 *     ולא לראות שום דבר — עד שתתחבר בעצמה עם אותו מספר, ואז
 *     resolveCustomerForLogin תקשר את החשבון לשורה הזו בדיוק.
 *   • שם של לקוחה קיימת **אינו נדרס** (נאכף ב-RPC עצמו).
 *
 * ⚠️ הקורא לא יקבל שום רמז לשאלה אם הלקוחה כבר הייתה קיימת. ההבחנה הזו
 * לא מוחזרת בכוונה — היא הייתה הופכת את הטופס הציבורי לכלי שמאפשר לברר
 * אילו מספרים הם לקוחות של העסק.
 */
export async function linkOrCreateCustomerByPhone(
  phoneE164: string,
  fullName: string,
): Promise<{ ok: true; customer: Customer } | { ok: false; error: PhoneResolutionError }> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('link_or_create_customer_by_phone', {
    p_phone_e164: phoneE164,
    p_full_name: fullName,
  })

  if (error) {
    if (error.message?.includes('BAD_PHONE')) return { ok: false, error: 'bad_phone' }
    if (error.message?.includes('BAD_NAME')) return { ok: false, error: 'bad_name' }
    // ⚠️ לא נרשם כאן הטלפון ולא השם — רק ההודעה של Postgres.
    console.error('[customers] link_or_create_by_phone failed', error.message)
    return { ok: false, error: 'db_error' }
  }

  const row = data as unknown as {
    id: string
    phone_e164: string
    full_name: string
    created_at: string
    is_blocked: boolean
  } | null

  if (!row?.id) {
    console.error('[customers] link_or_create_by_phone returned no row')
    return { ok: false, error: 'db_error' }
  }

  return {
    ok: true,
    customer: {
      id: row.id,
      phone_e164: row.phone_e164,
      full_name: row.full_name,
      created_at: row.created_at,
      is_blocked: row.is_blocked,
    },
  }
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
