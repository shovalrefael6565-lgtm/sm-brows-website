import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import ServiceCard from '@/components/services/ServiceCard'
import CourseCard from '@/components/services/CourseCard'
import BookingSection from '@/components/home/BookingSection'
import { services } from '@/lib/data'

export const metadata: Metadata = {
  title: 'טיפולים | S.M BROWS',
  description:
    'טיפולי עיצוב גבות מקצועיים: מיקרובליידינג, עיצוב גבות טבעי והרמת גבות. קורס עיצוב גבות מקצועי. S.M BROWS אשקלון.',
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

      <section
        aria-labelledby="services-list-heading"
        className="section-padding bg-brand-cream"
      >
        <h2 id="services-list-heading" className="sr-only">
          רשימת טיפולים
        </h2>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-24">
          {services.map((service, i) => (
            <ServiceCard key={service.id} service={service} index={i} />
          ))}
        </div>
      </section>

      {/* Course — premium section */}
      <section
        id="course"
        aria-labelledby="course-heading"
        className="py-16 sm:py-20 bg-brand-cream"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-2">
              השקעה בעצמך
            </p>
            <h2
              id="course-heading"
              className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark"
            >
              הפכי את התשוקה
              <span className="text-brand-rose"> למקצוע</span>
            </h2>
          </div>
          <CourseCard />
        </div>
      </section>

      <BookingSection />
    </>
  )
}
