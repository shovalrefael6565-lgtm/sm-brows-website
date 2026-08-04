import type { Metadata } from 'next'
import { requireAdminPage } from '@/lib/auth/adminGuard'
import AdminNav from '@/components/admin/AdminNav'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * כל דף מתחת ל-(protected) עובר קודם דרך requireAdminPage — שער הגישה
 * היחיד לאזור הניהול. /admin/login נמצא מחוץ ל-route group הזה בכוונה,
 * כדי שלא ייווצר redirect loop בין ה-layout לעמוד ההתחברות עצמו.
 */
export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage()

  return (
    <div className="min-h-screen bg-brand-cream/30">
      <AdminNav />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">{children}</main>
    </div>
  )
}
