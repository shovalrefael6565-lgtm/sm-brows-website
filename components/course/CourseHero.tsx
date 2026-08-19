import Image from 'next/image'
import { CalendarDays, MapPin, Users } from 'lucide-react'
import { course } from '@/lib/course'
import CourseCta from './CourseCta'

const META = [
  { icon: CalendarDays, label: course.duration },
  { icon: Users, label: course.format },
  { icon: MapPin, label: course.location },
]

/**
 * הירו של עמוד הקורס — Server Component בלבד ובלי אנימציית כניסה:
 * הכותרת כאן היא אלמנט ה-LCP של העמוד וחייבת להיות מצוירת בציור הראשון.
 */
export default function CourseHero() {
  return (
    <section
      aria-labelledby="course-hero-heading"
      className="relative overflow-hidden bg-hero-gradient pt-32 pb-16 sm:pt-40 sm:pb-24"
    >
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 -start-32 w-[28rem] h-[28rem] rounded-full bg-brand-gold/10 blur-3xl" />
        <div className="absolute -bottom-40 -end-24 w-[24rem] h-[24rem] rounded-full bg-brand-rose/10 blur-3xl" />
        <div className="absolute bottom-0 inset-x-0 h-px bg-gold-gradient opacity-50" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-16 items-center">
          {/* Text */}
          <div>
            <p className="text-[0.7rem] sm:text-xs tracking-[0.28em] text-brand-gold-text font-semibold uppercase mb-5">
              {course.eyebrow}
            </p>

            <h1
              id="course-hero-heading"
              className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold text-brand-dark leading-[1.15] mb-4 text-balance"
            >
              {course.name}
              <span className="block text-brand-rose-text mt-2">{course.tagline}</span>
            </h1>

            <div className="w-16 h-px bg-gold-gradient mb-6" aria-hidden="true" />

            <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-xl mb-8">
              {course.promise}
            </p>

            <ul className="flex flex-wrap gap-x-6 gap-y-3 mb-9" aria-label="פרטי הקורס">
              {META.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-brand-gold-dark flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm text-brand-dark font-medium">{label}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <CourseCta className="w-full sm:w-auto" />
              <a
                href="#course-program"
                className="inline-flex items-center justify-center gap-2 text-brand-medium font-medium text-base px-6 py-4 rounded-full border border-brand-medium/25 hover:border-brand-medium/60 hover:text-brand-dark transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold w-full sm:w-auto"
              >
                לתוכנית הקורס
              </a>
            </div>
          </div>

          {/* Image */}
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute -inset-3 sm:-inset-4 rounded-[2rem] border border-brand-gold/25"
            />
            <div className="relative aspect-[4/5] sm:aspect-[5/5] lg:aspect-[4/5] rounded-[1.75rem] overflow-hidden shadow-soft-lg">
              <Image
                src={course.image}
                alt="עיצוב גבות טבעיות בקורס של שובל"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 45vw"
                quality={80}
                className="object-cover"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-brand-dark/25 via-transparent to-transparent"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
