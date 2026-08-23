import type { Metadata } from 'next'
import Link from 'next/link'
import BookingForm from '@/components/booking/BookingForm'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'
import { SITE_URL } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'קביעת תור',
  description: 'קבעי תור לטיפול גבות מקצועי — מיקרובליידינג, עיצוב גבות טבעיות, הרמת גבות וקורס מקצועי. S.M BROWS אשקלון.',
  alternates: { canonical: '/booking' },
  openGraph: {
    title: 'קביעת תור | S.M BROWS',
    description: 'קבעי תור לטיפול גבות מקצועי — מיקרובליידינג, עיצוב גבות טבעיות והרמת גבות באשקלון.',
    url: `${SITE_URL}/booking`,
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [
      { url: '/hero.webp', width: 1200, height: 630, alt: 'S.M BROWS — קביעת תור' },
    ],
  },
}

export default function BookingPage() {
  // ⚠️ לא <main>: app/layout.tsx כבר עוטף את התוכן ב-<main id="main-content">.
  // main מקונן יצר landmark כפול ו-id="main-content" כפול, וקישור
  // "דלגי לתוכן הראשי" קפץ לאלמנט הלא נכון.
  return (
    <div className="min-h-screen bg-brand-cream pt-32 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">

        {/* Header */}
        <div className="text-center mb-12">
          <div className="w-8 h-px bg-brand-gold mx-auto mb-8" aria-hidden="true" />
          <h1 className="font-serif text-5xl sm:text-6xl font-medium text-brand-dark mb-5 leading-[1.1]">
            קביעת תור
          </h1>
          <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-xl mx-auto mb-4">
            מלאי את הפרטים ואחזור אלייך בהקדם לאישור התור. ייעוץ ראשוני חינם!
          </p>
          <p className="text-brand-muted text-sm">
            ראשון–חמישי | 09:00–11:00 ו-15:00–19:00
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-3xl shadow-soft-lg border border-brand-cream-dark/50 p-6 sm:p-10">
          <BookingForm newBookingSystemEnabled={isNewBookingSystemEnabled()} />
        </div>

        {/* Note */}
        <p className="text-center text-brand-muted text-xs mt-6">
          לאחר השליחה תיפתח הודעת וואצאפ מוכנה עם כל הפרטים — פשוט שלחי אותה לאישור התור.
        </p>
        <p className="text-center text-brand-muted text-xs mt-2">
          <Link
            href="/booking-policy"
            className="underline hover:text-brand-rose-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
          >
            מדיניות קביעת תורים, שינויים וביטולים
          </Link>
        </p>
      </div>
    </div>
  )
}
