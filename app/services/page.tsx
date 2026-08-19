import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import ServiceCard from '@/components/services/ServiceCard'
import MicrobladingSpotlight from '@/components/services/MicrobladingSpotlight'
import CourseCard from '@/components/services/CourseCard'
import ServiceFaqSection from '@/components/services/ServiceFaqSection'
import BookingSection from '@/components/home/BookingSection'
import { services } from '@/lib/data'

// מיקרובליידינג מקבל סקשן ספוטלייט ייעודי עם סרטונים — לכן מוסר מהרשימה הרגילה
const listedServices = services.filter((s) => s.id !== 'microblading')

export const metadata: Metadata = {
  title: 'טיפולים',
  description:
    'טיפולי עיצוב גבות מקצועיים: מיקרובליידינג, עיצוב גבות טבעיות והרמת גבות. קורס עיצוב גבות מקצועי. S.M BROWS אשקלון.',
  alternates: { canonical: '/services' },
}

export default function ServicesPage() {
  return (
    <>
      <PageHero
        tag="מה אני מציעה"
        title="הטיפולים"
        titleHighlight="שלי"
        description="טיפולים מקצועיים לגבות מושלמות וקורס פרימיום להפוך את התשוקה למקצוע."
      />

      {/* מיקרובליידינג — סקשן ספוטלייט עם סרטונים, מעל שאר הטיפולים */}
      <MicrobladingSpotlight />

      <section
        aria-labelledby="services-list-heading"
        className="section-padding bg-brand-cream"
      >
        <h2 id="services-list-heading" className="sr-only">
          רשימת טיפולים
        </h2>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-24">
          {listedServices.map((service, i) => (
            <ServiceCard key={service.id} service={service} index={i} />
          ))}
        </div>
      </section>

      {/* Course — premium section */}
      <section
        id="course"
        aria-labelledby="course-heading"
        className="py-20 sm:py-28 bg-brand-cream scroll-mt-24"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="text-[0.7rem] sm:text-xs tracking-[0.28em] text-brand-gold-text font-semibold uppercase mb-4">
              השקעה בעצמך
            </p>
            <h2
              id="course-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-brand-dark leading-tight text-balance"
            >
              הפכי את התשוקה
              <span className="text-brand-rose-text"> למקצוע</span>
            </h2>
            <div className="w-16 h-px bg-gold-gradient mx-auto my-6" aria-hidden="true" />
            <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
              יומיים שבהם את לא מקבלת תבנית אחת לכל לקוחה, אלא עין מקצועית
              שיודעת להתאים גבה נכונה לכל פנים.
            </p>
          </div>
          <CourseCard />
        </div>
      </section>

      <ServiceFaqSection />
      <BookingSection />
    </>
  )
}
