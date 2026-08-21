import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { course, coursePillars } from '@/lib/course'
import CourseCta from '@/components/course/CourseCta'
import Reveal from '@/components/course/Reveal'

/**
 * סקשן הקורס בעמוד הבית — טיזר לעמוד הייעודי /course.
 *
 * Server Component: תוכן מגיע מהשרת ל-SEO; הנעה דרך Reveal.
 */
export default function CourseBanner() {
  return (
    <section
      id="course"
      aria-labelledby="course-banner-heading"
      className="relative overflow-hidden bg-brand-linen py-20 sm:py-28 scroll-mt-24"
    >
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-60" />
        <div className="absolute bottom-0 inset-x-0 h-px bg-gold-gradient opacity-30" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-center">

          {/* Text */}
          <Reveal>
            <h2
              id="course-banner-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium text-brand-dark leading-[1.2] mb-3 text-balance"
            >
              {course.name}
            </h2>
            <p className="font-serif text-xl sm:text-2xl text-brand-rose-text italic mb-5">
              {course.tagline}
            </p>

            <div className="w-16 h-px bg-gold-gradient mb-7" aria-hidden="true" />

            <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-xl mb-8">
              {course.short}
            </p>

            {/* Editorial pillar list — no bullet icons */}
            <ul className="divide-y divide-brand-linen-dark mb-10" aria-label="עקרונות הקורס">
              {coursePillars.map((pillar) => (
                <li key={pillar.title} className="py-4 first:pt-0 last:pb-0">
                  <p className="text-brand-dark text-sm sm:text-base leading-relaxed">
                    <span className="font-bold">{pillar.title}</span>
                    {' — '}
                    <span className="text-brand-medium">{pillar.body}</span>
                  </p>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <Link
                href="/course"
                aria-label="לעמוד הקורס המלא של עיצוב גבות טבעיות"
                className="inline-flex items-center justify-center gap-2 bg-brand-gold text-brand-dark font-bold text-base px-8 py-4 rounded-full hover:bg-brand-gold-dark hover:-translate-y-0.5 transition-all duration-200 shadow-gold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 w-full sm:w-auto"
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
