import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import ServiceCard from '@/components/services/ServiceCard'
import MicrobladingSpotlight from '@/components/services/MicrobladingSpotlight'
import CourseCard from '@/components/services/CourseCard'
import ServiceFaqSection from '@/components/services/ServiceFaqSection'
import BookingSection from '@/components/home/BookingSection'
import { services } from '@/lib/data'
import { SITE_URL } from '@/lib/utils'
import { breadcrumbJsonLd } from '@/lib/breadcrumbs'

// מיקרובליידינג מקבל סקשן ספוטלייט ייעודי עם סרטונים — לכן מוסר מהרשימה הרגילה
const listedServices = services.filter((s) => s.id !== 'microblading')

/*
  ⚠️ openGraph מוחלף ולא ממוזג: Next ממזג metadata בין סגמנטים בצורה
  רדודה בלבד, ולכן שדה openGraph שמוגדר כאן דורס לגמרי את זה שב-app/layout.
  siteName/locale/type חוזרים כאן בכוונה — בלעדיהם הם פשוט נעלמים מהעמוד.
*/
export const metadata: Metadata = {
  title: 'טיפולי גבות באשקלון',
  description:
    'מיקרובליידינג, עיצוב גבות טבעיות והרמת גבות — הקליניקה של שובל בעיר היין, אשקלון. מגיעות אליי לקוחות גם מאשדוד, קריית גת, שדרות ונתיבות.',
  alternates: { canonical: '/services' },
  openGraph: {
    title: 'טיפולי גבות באשקלון | S.M BROWS',
    description:
      'מיקרובליידינג, עיצוב גבות טבעיות והרמת גבות בקליניקה בעיר היין, אשקלון.',
    url: `${SITE_URL}/services`,
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [
      { url: '/hero.webp', width: 1200, height: 630, alt: 'S.M BROWS — טיפולי גבות באשקלון' },
    ],
  },
}

export default function ServicesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([{ name: 'טיפולים', path: '/services' }]),
          ),
        }}
      />
      <PageHero

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
            <div className="w-8 h-px bg-brand-gold mx-auto mb-8" aria-hidden="true" />
            <h2
              id="course-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium text-brand-dark leading-tight text-balance"
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
