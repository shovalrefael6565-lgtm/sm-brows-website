import Image from 'next/image'
import { Check } from 'lucide-react'
import { courseAudience, courseOutcomes } from '@/lib/course'
import Reveal from './Reveal'

/** למי הקורס מתאים — ומה בדיוק יוצאים איתו ביום השני בערב. */
export default function CourseAudience() {
  return (
    <section
      id="course-audience"
      aria-labelledby="course-audience-heading"
      className="relative overflow-hidden bg-brand-linen py-20 sm:py-28 scroll-mt-24"
    >
      <div aria-hidden="true" className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-50" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-16 items-start">
          {/* Image column */}
          <Reveal className="lg:sticky lg:top-28">
            <div className="relative aspect-[4/5] rounded-[1.75rem] overflow-hidden shadow-soft-lg">
              <Image
                src="/natural-6.webp"
                alt="עיצוב גבה מותאם למבנה הפנים"
                fill
                loading="lazy"
                sizes="(max-width: 1024px) 100vw, 40vw"
                className="object-cover"
              />
            </div>
            <p className="text-brand-medium text-sm leading-relaxed mt-5 max-w-sm">
              קבוצות קטנות בכוונה — כדי שיהיה זמן להסתכל על העבודה שלך, לתקן ולהסביר.
            </p>
          </Reveal>

          {/* Lists column */}
          <div className="space-y-14">
            <Reveal>
              <p className="text-[0.7rem] sm:text-xs tracking-[0.28em] text-brand-gold-text font-semibold uppercase mb-4">
                למי זה מתאים
              </p>
              <h2
                id="course-audience-heading"
                className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark leading-snug mb-7"
              >
                הקורס נבנה בשבילך אם...
              </h2>
              <ul className="space-y-4">
                {courseAudience.map((item) => (
                  <li key={item} className="flex items-start gap-3.5">
                    <span
                      className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-brand-gold mt-2.5"
                      aria-hidden="true"
                    />
                    <span className="text-brand-medium text-base leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal>
              <div className="bg-white/75 border border-brand-cream-dark rounded-2xl p-7 sm:p-9 shadow-soft">
                <p className="text-[0.7rem] sm:text-xs tracking-[0.28em] text-brand-gold-text font-semibold uppercase mb-4">
                  מה יוצאים עם זה
                </p>
                <h3 className="font-serif text-2xl sm:text-3xl font-bold text-brand-dark leading-snug mb-6">
                  בסוף היומיים את יודעת לעשות את זה לבד
                </h3>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                  {courseOutcomes.map((item) => (
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
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}
