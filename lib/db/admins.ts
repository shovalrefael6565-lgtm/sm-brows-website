import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/**
 * גישה לטבלת admins — מקור האמת היחיד להרשאת ניהול.
 *
 * נקראת מחדש מול ה-DB בכל בדיקת הרשאה (ראה lib/auth/adminGuard.ts) —
 * לעולם לא מוסקת מ-role שב-session, כדי שהסרת מנהלת מהטבלה תיחסם כבר
 * בבקשה הבאה שלה, בלי תלות בתפוגת ה-cookie.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[admins] lookup failed', error.message)
    return false
  }
  return !!data
}
