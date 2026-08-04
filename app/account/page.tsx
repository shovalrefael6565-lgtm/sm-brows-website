import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PageHero from '@/components/ui/PageHero'
import LogoutButton from '@/components/account/LogoutButton'
import { getSession } from '@/lib/auth/session'
import { getCustomerById } from '@/lib/db/customers'
import { formatPhoneForDisplay } from '@/lib/phone'

export const metadata: Metadata = {
  title: 'האזור האישי שלי',
  robots: { index: false, follow: false },
}

/**
 * שלד האזור האישי — כרגע מאשר שההתחברות עובדת בלבד.
 * רשימת התורים, השינוי והביטול נבנים בשלבים הבאים.
 */
export default async function AccountPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  // הנתונים נשלפים לפי המזהה מה-session בלבד — לעולם לא מפרמטר ב-URL
  const customer = await getCustomerById(session.customerId)
  if (!customer) redirect('/login')

  return (
    <>
      <PageHero tag="אזור אישי" title="שלום," titleHighlight={customer.full_name} />
      <section className="py-14 sm:py-20 px-4 sm:px-6">
        <div className="w-full max-w-md mx-auto">
          <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 shadow-soft">
            <h2 className="font-serif text-xl font-bold text-brand-dark mb-4">הפרטים שלך</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-brand-muted">שם</dt>
                <dd className="text-brand-dark font-medium">{customer.full_name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-brand-muted">טלפון</dt>
                <dd className="text-brand-dark font-medium" dir="ltr">
                  {formatPhoneForDisplay(customer.phone_e164)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-6 bg-brand-rose-bg border border-brand-rose-light rounded-2xl p-5 text-sm text-brand-medium leading-relaxed">
            רשימת התורים שלך, שינוי מועד וביטול יתווספו כאן בקרוב. בינתיים ניתן
            לקבוע תור כרגיל דרך עמוד קביעת התור.
          </div>

          <div className="mt-8 text-center">
            <LogoutButton />
          </div>
        </div>
      </section>
    </>
  )
}
