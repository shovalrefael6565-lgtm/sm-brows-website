import type { Metadata } from 'next'
import BookingForm from '@/components/booking/BookingForm'

export const metadata: Metadata = {
  title: 'קביעת תור | S.M BROWS',
  description: 'קבעי תור לטיפול גבות מקצועי — מיקרובליידינג, עיצוב גבות טבעי, הרמת גבות וקורס מקצועי. S.M BROWS אשקלון.',
}

export default function BookingPage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-brand-cream pt-32 pb-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">

        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-3">
            S.M BROWS
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl font-bold text-brand-dark mb-4">
            קביעת תור
          </h1>
          <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
            מלאי את הפרטים ואחזור אלייך בהקדם לאישור התור. ייעוץ ראשוני חינם!
          </p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <span className="w-8 h-px bg-brand-rose-light" aria-hidden="true" />
            <span className="text-brand-rose text-sm">זמינות: ראשון–שישי | 09:00–18:00</span>
            <span className="w-8 h-px bg-brand-rose-light" aria-hidden="true" />
          </div>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-3xl shadow-soft-lg border border-brand-cream-dark/50 p-6 sm:p-10">
          <BookingForm />
        </div>

        {/* Note */}
        <p className="text-center text-brand-muted text-xs mt-6">
          לאחר השליחה תיפתח הודעת וואצאפ מוכנה עם כל הפרטים — פשוט שלחי אותה לאישור התור.
        </p>
      </div>
    </main>
  )
}
