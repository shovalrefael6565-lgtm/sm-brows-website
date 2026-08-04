import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * לקוח Supabase לצד השרת, פועל בזהות הלקוחה המחוברת.
 *
 * משתמש ב-anon key בלבד, ולכן **כפוף ל-RLS**: כל שאילתה דרכו רואה רק את
 * מה שמדיניות ה-RLS מתירה למשתמשת הנוכחית. זו ברירת המחדל לקריאות באזור
 * האישי — היא נותנת הגנה בשכבה השנייה גם אם נשכחה בדיקת בעלות בקוד.
 *
 * לכתיבות שמצריכות עקיפת RLS יש להשתמש ב-lib/supabase/admin.ts, ורק אחרי
 * בדיקת בעלות מפורשת.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // נקרא מתוך Server Component — הרענון מטופל ב-middleware.
          }
        },
      },
    },
  )
}

/**
 * מחזיר את המשתמשת המחוברת, או null.
 *
 * משתמש ב-getUser() ולא ב-getSession(): getSession קורא את ה-cookie כפי
 * שהוא, בלי לאמת חתימה מול השרת. בצד השרת זה לא מספיק — cookie ניתן לזיוף.
 */
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}
