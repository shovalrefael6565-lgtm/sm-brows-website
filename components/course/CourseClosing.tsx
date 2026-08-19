import Image from 'next/image'
import { Check } from 'lucide-react'
import { course, courseIncludes } from '@/lib/course'
import CourseCta from './CourseCta'
import Reveal from './Reveal'

const STRIP = [
  { src: '/natural-8.webp', alt: 'תוצאת עיצוב גבות טבעיות' },
  { src: '/natural-9.webp', alt: 'גבה מעוצבת בהתאמה למבנה הפנים' },
  { src: '/natural-10.webp', alt: 'סיום ופיניש של עיצוב גבות' },
]

/** סגירת העמוד — מה כלול, ולאן פונים כשמתעניינים. */
export default function CourseClosing() {
  return (
    <section
      id="course-register"
      aria-labelledby="course-closing-heading"
      className="relative overflow-hidden bg-brand-cream py-20 sm:py-28 scroll-mt-24"
    >
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 -end-32 w-[26rem] h-[26rem] rounded-full bg-brand-gold/10 blur-3xl" />
        <div className="absolute -bottom-32 -start-32 w-[22rem] h-[22rem] rounded-full bg-brand-rose/10 blur-3xl" />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        {/* Image strip */}
        <Reveal>
          <ul className="grid grid-cols-3 gap-3 sm:gap-5 mb-16">
            {STRIP.map(({ src, alt }) => (
              <li key={src} className="relative aspect-[3/4] rounded-2xl overflow-hidden shadow-soft">
                <Image
                  src={src}
                  alt={alt}
                  fill
                  loading="lazy"
                  sizes="(max-width: 640px) 33vw, 300px"
                  className="object-cover"
                />
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal>
          <div className="relative bg-white/80 border border-brand-cream-dark rounded-[1.75rem] shadow-soft-lg overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gold-gradient" aria-hidden="true" />

            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-10 p-8 sm:p-12">
              <div>
                <p className="text-[0.7rem] sm:text-xs tracking-[0.28em] text-brand-gold-text font-semibold uppercase mb-4">
                  הצעד הבא
                </p>
                <h2
                  id="course-closing-heading"
                  className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark leading-tight mb-5 text-balance"
                >
                  אם את מרגישה שזה הזמן —
                  <span className="block text-brand-rose-text mt-1">בואי נדבר.</span>
                </h2>
                <p className="text-brand-medium text-base leading-relaxed mb-8 max-w-lg">
                  {course.short} מספר המקומות מוגבל בכוונה. כתבי לי בוואצאפ, נבדוק יחד
                  אם הקורס מתאים לך ואיפה את נמצאת היום — בלי התחייבות.
                </p>
                <CourseCta label="לפרטים והרשמה" />
              </div>

              <div className="lg:border-s lg:border-brand-cream-dark lg:ps-10">
                <h3 className="font-serif text-xl font-bold text-brand-dark mb-5">מה כלול</h3>
                <ul className="space-y-3.5">
                  {courseIncludes.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span
                        className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-gold/20 border border-brand-gold/40 flex items-center justify-center mt-0.5"
                        aria-hidden="true"
                      >
                        <Check className="w-3 h-3 text-brand-gold-dark" />
                      </span>
                      <span className="text-brand-medium text-sm leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>

                <p className="text-brand-muted text-xs leading-relaxed mt-6 pt-6 border-t border-brand-cream-dark">
                  {course.format} · {course.location}
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
