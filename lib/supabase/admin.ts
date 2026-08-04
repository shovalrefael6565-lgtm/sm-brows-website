import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * ⚠️ לקוח מנהלתי — עוקף RLS לחלוטין.
 *
 * 'server-only' בראש הקובץ גורם לשגיאת בנייה אם מישהו ינסה לייבא אותו
 * לקומפוננטת לקוח, כך שה-service_role key לא יכול להגיע לדפדפן בטעות.
 *
 * מותר להשתמש בו רק ל:
 *   • יצירת/עדכון תורים אחרי בדיקת בעלות מפורשת בקוד ה-route.
 *   • כתיבה ל-appointment_history ול-otp_attempts.
 *   • פעולות מנהלה מאומתות.
 *
 * אסור להשתמש בו לקריאת נתונים שמוחזרים ללקוחה בלי סינון לפי customer_id —
 * זו בדיוק הדרך שבה נחשף מידע של לקוחות אחרות.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
