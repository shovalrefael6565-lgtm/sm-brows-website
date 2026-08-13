import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import type { Customer } from '@/lib/db/customers'

/**
 * מיהי הלקוחה שמבצעת את הבקשה הנוכחית (שלב 10).
 *
 * זו הנקודה **היחידה** שממירה session לזהות לקוחה. עד שלב 10 ההמרה הייתה
 * `customerId = userId`, כי customers.id היה FK ל-auth.users. אחרי הפרדת
 * הישויות ההנחה הזו שקרית, ואסור להעביר auth user id כ-customer id רק
 * משום שבעבר הם היו שווים.
 *
 * ─── למה lookup בכל בקשה ולא cid חתום ────────────────────────────────────
 *
 * חתימה מונעת זיוף, אך אינה מונעת התיישנות. ה-cookie תקף 30 יום, ובתוכם:
 * ה-auth user יכול להימחק (ואז ON DELETE SET NULL מאפס את auth_user_id),
 * או שהקישור ינותק מסיבה אחרת — בעוד ה-cid הישן ממשיך להצביע על שורת
 * לקוחה קיימת לחלוטין. כל ה-routes האלה עובדים עם service_role שעוקף RLS,
 * ולכן ה-DB לא היה עוצר אותם. הבעלות חייבת להיות מוכחת מחדש בכל בקשה.
 *
 * ה-cid משמש כאן אך ורק כבדיקת עקביות: אם הוא קיים וסותר את מה שנמצא
 * לפי auth_user_id — לא מנחשים ולא בוחרים אחד מהם, אלא דוחים את ה-session.
 */

/**
 * מחזירה את מזהה הלקוחה המאומת, או null.
 *
 * null מוחזר גם למנהלת: ל-session של מנהלת אין בעלות על לקוחה, גם אם
 * קיימת לה שורת customers (שובל ורפאל קיימות שם כדי להתחבר). בלי הבדיקה
 * הזו, מנהלת מחוברת הייתה יכולה לבטל או להזיז תור דרך ה-routes של האזור
 * האישי כאילו הייתה הלקוחה עצמה.
 */
export async function getCurrentCustomerId(): Promise<string | null> {
  const session = await getSession()
  if (!session) return null
  if (session.role !== 'customer') return null

  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('customers')
    .select('id')
    .eq('auth_user_id', session.userId)
    .maybeSingle()

  if (error) {
    console.error('[currentCustomer] lookup failed', error.message)
    return null
  }
  // אין שורה מקושרת: ה-auth user נמחק, הקישור נותק, או שה-session שייך
  // לזהות שאין לה כרטיס לקוחה. בכל המקרים — אין גישה.
  if (!data) return null

  if (session.cid && session.cid !== data.id) {
    console.error('[currentCustomer] session cid does not match linked customer — rejecting')
    return null
  }

  return data.id as string
}

/**
 * זהה ל-getCurrentCustomerId, אבל מחזירה את שורת הלקוחה המלאה במקום רק
 * את המזהה — לקוראים שהיו קוראים ל-getCurrentCustomerId ואז מיד ל-
 * getCustomerById(id) על אותה שורה בדיוק (כמו app/account/page.tsx).
 * שאילתה אחת במקום שתיים לאותה טבלה על כל טעינת עמוד.
 *
 * אותה הוכחת בעלות בדיוק (auth_user_id + בדיקת עקביות cid) — רק העמודות
 * הנבחרות שונות. קוראים שצריכים אך ורק את המזהה ימשיכו להשתמש ב-
 * getCurrentCustomerId, כדי לא לשנות את מספר הקריאות ב-routes שלא זקוקים
 * לשאר השדות.
 */
export async function getCurrentCustomer(): Promise<Customer | null> {
  const session = await getSession()
  if (!session) return null
  if (session.role !== 'customer') return null

  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('customers')
    .select('id, phone_e164, full_name, created_at, is_blocked')
    .eq('auth_user_id', session.userId)
    .maybeSingle()

  if (error) {
    console.error('[currentCustomer] lookup failed', error.message)
    return null
  }
  if (!data) return null

  if (session.cid && session.cid !== data.id) {
    console.error('[currentCustomer] session cid does not match linked customer — rejecting')
    return null
  }

  return data as Customer
}
