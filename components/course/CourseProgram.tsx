import { courseDays } from '@/lib/course'
import Reveal from './Reveal'

/**
 * תוכנית הקורס — יומיים, כל יום עם ארבעה גושי תוכן.
 * המבנה נשאר רשימה סמנטית (h3 ליום, h4 לגוש) כדי שסדר הכותרות יישמר.
 */
export default function CourseProgram() {
  return (
    <section
      id="course-program"
      aria-labelledby="course-program-heading"
      className="relative bg-brand-cream py-20 sm:py-28 scroll-mt-24"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <Reveal>
          <div className="text-center mb-16">
            <div className="w-12 h-px bg-gold-gradient mx-auto mb-6 opacity-70" aria-hidden="true" />
            <h2
              id="course-program-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium text-brand-dark leading-tight text-balance mb-5"
            >
              יומיים. אחד לראש,
              <span className="text-brand-rose-text"> אחד לידיים.</span>
            </h2>
            <div className="w-16 h-px bg-gold-gradient mx-auto mb-6" aria-hidden="true" />
            <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
              היום הראשון בונה את ההבנה, השני מתרגם אותה לעבודה אמיתית על מודליסטית.
              בלי לדלג על שלבים ובלי לצפות מהצד.
            </p>
          </div>
        </Reveal>

        <div className="space-y-16 sm:space-y-20">
          {courseDays.map((day, dayIndex) => (
            <Reveal key={day.label}>
              <article className="relative">
                {/* Day header */}
                <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-8 mb-9 pb-7 border-b border-brand-cream-dark">
                  <div className="flex items-baseline gap-4">
                    <span
                      className="font-serif text-5xl sm:text-6xl font-bold text-brand-gold/50 leading-none"
                      aria-hidden="true"
                    >
                      {String(dayIndex + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <p className="text-[0.7rem] tracking-[0.24em] text-brand-gold-text font-semibold uppercase mb-1">
                        {day.label}
                      </p>
                      <h3 className="font-serif text-2xl sm:text-3xl font-medium text-brand-dark">
                        {day.title}
                      </h3>
                    </div>
                  </div>
                  <p className="text-brand-medium text-sm sm:text-base leading-relaxed sm:flex-1 sm:max-w-2xl">
                    {day.summary}
                  </p>
                </div>

                {/* Blocks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                  {day.blocks.map((block) => (
                    <div
                      key={block.title}
                      className="bg-white/70 border border-brand-cream-dark rounded-2xl p-6 sm:p-7 shadow-soft"
                    >
                      <h4 className="font-serif text-lg sm:text-xl font-medium text-brand-dark mb-4 flex items-center gap-2.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-brand-gold flex-shrink-0"
                          aria-hidden="true"
                        />
                        {block.title}
                      </h4>
                      <ul className="space-y-2.5">
                        {block.items.map((item) => (
                          <li
                            key={item}
                            className="text-brand-medium text-sm leading-relaxed ps-4 relative"
                          >
                            <span
                              className="absolute start-0 top-2 w-1 h-1 rounded-full bg-brand-rose"
                              aria-hidden="true"
                            />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
