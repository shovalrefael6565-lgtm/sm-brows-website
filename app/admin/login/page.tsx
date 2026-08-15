import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import PageHero from '@/components/ui/PageHero'
import LoginForm from '@/components/account/LoginForm'
import { getSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'

export const metadata: Metadata = {
  title: 'כניסת מנהלים',
  robots: { index: false, follow: false },
}

// 🔒 שלב 2 (מידע פרטי) — מחוץ ל-(protected), אז לא מכוסה ע"י ה-layout שם.
export const dynamic = 'force-dynamic'

/**
 * כניסת מנהלים — אותה תשתית OTP בדיוק כמו /login. אין כאן שדה סיסמה
 * ואין ניתוב שונה בטופס עצמו: ה-role נקבע בשרת לפי טבלת admins
 * (app/api/auth/otp/verify), והטופס מנתב לפי redirectTo שמוחזר משם.
 */
export default async function AdminLoginPage() {
  if (!isNewBookingSystemEnabled()) notFound()

  const session = await getSession()
  if (session) {
    const admin = await isAdmin(session.userId)
    redirect(admin ? '/admin' : '/account')
  }

  return (
    <>
      <PageHero
        tag="ניהול"
        title="כניסת"
        titleHighlight="מנהלים"
        description="התחברות עם מספר הטלפון וקוד אימות — בדיוק כמו כניסת לקוחות."
      />
      <section className="py-14 sm:py-20 px-4 sm:px-6">
        <LoginForm />
      </section>
    </>
  )
}
