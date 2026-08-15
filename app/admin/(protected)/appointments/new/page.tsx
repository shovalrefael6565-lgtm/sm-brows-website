import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getBookingCustomer } from '@/lib/db/manualCustomers'
import NewAppointmentForm from '@/components/admin/NewAppointmentForm'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * יצירת תור ידני.
 *
 * כשמגיעים מפרופיל לקוחה (?customerId=…) היא נטענת בשרת ומוצגת נבחרת
 * מראש. מזהה שאינו קיים — או שהוא חשבון מנהל — פשוט נופל לבורר החיפוש
 * הרגיל, בלי להסגיר מה הסיבה (getBookingCustomer מחריגה מנהלות).
 *
 * ⚠️ הבחירה המוקדמת היא נוחות בלבד. השרת טוען את הלקוחה מחדש בעת היצירה
 * ואינו סומך על מה שהגיע מהדפדפן.
 */
export default async function NewAppointmentPage(
  props: {
    searchParams: Promise<{ customerId?: string }>
  }
) {
  const searchParams = await props.searchParams;
  const requested = searchParams.customerId
  const initialCustomer =
    requested && UUID_RE.test(requested) ? await getBookingCustomer(requested) : null

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/appointments"
        className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-dark mb-4"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
        חזרה לרשימת התורים
      </Link>

      <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">תור חדש</h1>
      <p className="text-sm text-brand-muted mb-6">
        התור נקבע מאושר מיד. אפשר לקבוע גם מחוץ לשעות הפעילות.
      </p>

      <NewAppointmentForm initialCustomer={initialCustomer} />
    </div>
  )
}
