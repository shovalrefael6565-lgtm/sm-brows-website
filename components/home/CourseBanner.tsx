import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, CalendarDays, MapPin, Users } from 'lucide-react'
import { course, coursePillars } from '@/lib/course'
import CourseCta from '@/components/course/CourseCta'
import Reveal from '@/components/course/Reveal'

const META = [
  { icon: CalendarDays, label: course.duration },
  { icon: Users, label: course.format },
  { icon: MapPin, label: course.location },
]

/**
 * סקשן הקורס בעמוד הבית — טיזר לעמוד הייעודי /course.
 *
 * ⚠️ Server Component: הגרסה הקודמת הייתה 'use client' עם framer-motion
 * ומתג פרונטלי/אונליין, ונטענה ssr:false — כלומר תוכן הקורס לא הופיע כלל
 * ב-HTML. עכשיו התוכן מגיע מהשרת, וההנעה היחידה היא Reveal קל בגלילה.
 */
export default function CourseBanner() {
  return (
    <section
      id="course"
      aria-labelledby="course-banner-heading"
      className="relative overflow-hidden bg-brand-linen py-20 sm:py-28 scroll-mt-24"
    >
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 -end-24 w-[26rem] h-[26rem] rounded-full bg-brand-gold/10 blur-3xl" />
        <div className="absolute -bottom-32 -start-24 w-[22rem] h-[22rem] rounded-full bg-brand-rose/10 blur-3xl" />
        <div className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-60" />
        <div className="absolute bottom-0 inset-x-0 h-px bg-gold-gradient opacity-30" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-center">
          {/* Text */}
          <Reveal>
            <p className="text-[0.7rem] sm:text-xs tracking-[0.28em] text-brand-gold-text font-semibold uppercase mb-5">
              {course.eyebrow}
            </p>

            <h2
              id="course-banner-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-brand-dark leading-[1.2] mb-4 text-balance"
            >
              {course.name}
              <span className="block text-brand-rose-text mt-2">{course.tagline}</span>
            </h2>

            <div className="w-16 h-px bg-gold-gradient mb-6" aria-hidden="true" />

            <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-xl mb-7">
              {course.short}
            </p>

            <ul className="space-y-3 mb-8">
              {coursePillars.map((pillar) => (
                <li key={pillar.title} className="flex items-start gap-3">
                  <span
                    className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-brand-gold mt-2.5"
                    aria-hidden="true"
                  />
                  <p className="text-brand-medium text-sm sm:text-base leading-relaxed">
                    <span className="text-brand-dark font-semibold">{pillar.title}</span>
                    {' — '}
                    {pillar.body}
                  </p>
                </li>
              ))}
            </ul>

            <ul className="flex flex-wrap gap-x-6 gap-y-3 mb-9" aria-label="פרטי הקורס">
              {META.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-brand-gold-dark flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm text-brand-dark font-medium">{label}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <Link
                href="/course"
                aria-label="לעמוד הקורס המלא של עיצוב גבות טבעיות"
                className="inline-flex items-center justify-center gap-2 bg-brand-gold text-brand-dark font-bold text-base px-8 py-4 rounded-full hover:bg-brand-gold-light transition-all duration-200 shadow-gold hover:-translate-y-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 w-full sm:w-auto"
              >
                לעמוד הקורס
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              </Link>
              <CourseCta label="לפרטים בוואצאפ" variant="outline" className="w-full sm:w-auto" />
            </div>
          </Reveal>

          {/* Image */}
          <Reveal delay={120}>
            <div className="relative">
              <div
                aria-hidden="true"
                className="absolute -inset-3 sm:-inset-4 rounded-[2rem] border border-brand-gold/25"
              />
              <div className="relative aspect-[4/5] rounded-[1.75rem] overflow-hidden shadow-soft-lg">
                <Image
                  src={course.image}
                  alt="קורס עיצוב גבות טבעיות של שובל"
                  fill
                  loading="lazy"
                  sizes="(max-width: 1024px) 100vw, 45vw"
                  className="object-cover"
                />
                <div
                  className="absolute inset-0 bg-gradient-to-t from-brand-dark/25 via-transparent to-transparent"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
