import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import PageHero from '@/components/ui/PageHero'
import LoginForm from '@/components/account/LoginForm'
import { getSession } from '@/lib/auth/session'
import { getCurrentCustomerId } from '@/lib/auth/currentCustomer'
import { isAdmin } from '@/lib/db/admins'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'

export const metadata: Metadata = {
  // הסיומת "| S.M BROWS" מגיעה מה-template ב-app/layout.tsx
  title: 'כניסה לאזור האישי',
  description: 'כניסה לאזור האישי לניהול התורים שלך — צפייה, שינוי מועד וביטול.',
  // עמוד אישי — אין סיבה שיופיע במנועי חיפוש
  robots: { index: false, follow: false },
}

export default async function LoginPage() {
  /*
   * 🔒 שלב 13 — הדגל חוסם לפני הכול, בדיוק כמו ב-requireAdminPage.
   *
   * ⚠️ עד שלב 13 העמוד הזה לא היה מגודר, ולכן `NEW_BOOKING_SYSTEM_ENABLED=false`
   * לא היה kill-switch אמיתי: `/admin` אמנם החזיר 404, אבל `/login` המשיך
   * לעבוד, לשלוח SMS בתשלום דרך 019, ולייצר session תקף לאזור אישי ריק.
   *
   * 404 ולא הודעת שגיאה — עמוד שמסביר שהוא כבוי הוא עדיין עמוד שמעיד על
   * קיומה של מערכת שהוחלט לא לחשוף.
   */
  if (!isNewBookingSystemEnabled()) notFound()

  // כבר מחוברת — אין טעם להציג מסך התחברות
  const session = await getSession()

  // ה-cookie עצמו יכול להיות חתום ותקף גם אחרי שהחשבון שמאחוריו נמחק
  // (למשל ניקוי נתוני בדיקה ב-Supabase). בלי הבדיקה הזו, /login מפנה
  // ל-/account וזה מפנה בחזרה ל-/login — לולאה אינסופית. cookie כזה
  // מטופל כלא מאומת: פשוט לא מפנים החוצה, ומציגים את מסך ההתחברות
  // (מחיקת ה-cookie אפשרית רק ב-Route Handler/Server Action, לא כאן —
  // הוא יוחלף בעצמו בכניסה הבאה).
  if (session?.role === 'admin') {
    if (await isAdmin(session.userId)) redirect('/admin')
  } else if (session?.role === 'customer') {
    // getCurrentCustomerId מוכיחה את הקישור מול customers.auth_user_id,
    // ולכן היא גם מכסה את המקרה שה-cookie שרד את מחיקת החשבון.
    if (await getCurrentCustomerId()) redirect('/account')
  }

  return (
    <>
      <PageHero

        title="כניסה"
        titleHighlight="לאזור האישי"
        description="כאן תוכלי לראות את התורים שלך, לשנות מועד או לבטל — בלי להמתין לתשובה."
      />
      <section className="py-14 sm:py-20 px-4 sm:px-6">
        <LoginForm />
      </section>
    </>
  )
}
