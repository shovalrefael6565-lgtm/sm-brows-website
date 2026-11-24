import { courseDays } from '@/lib/course'
import CourseCta from './CourseCta'
import Reveal from './Reveal'

/**
 * תוכנית הקורס — יומיים, בכל יום ארבעה נושאים ובכל נושא ארבעה פריטים (32 בסך הכול).
 *
 * פריסה עריכתית ללא כרטיסים: כל יום הוא "פרק" — בדסקטופ כותרת היום (מספר,
 * שם, תקציר) בעמודה צרה ודביקה, וארבעת הנושאים בשתי עמודות לצידה; במובייל
 * הכול זה מתחת לזה. כל נושא נפתח בקו זהב דק, כמו העקרונות בסקשן "למה ללמוד אצלי".
 *
 * ⚠️ התוכן מ-courseDays — משותף לכרטיס הקורס בעמוד הטיפולים. לא נערך כאן.
 * כל הנושאים גלויים בכוונה (לא אקורדיון): התוכן המקצועי הוא ההוכחה.
 * סדר הכותרות: h2 לסקשן, h3 ליום, h4 לנושא.
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
          <div className="text-center mb-14 sm:mb-20">
            <div className="w-12 h-px bg-gold-gradient mx-auto mb-6 opacity-70" aria-hidden="true" />
            <h2
              id="course-program-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium text-brand-dark leading-tight text-balance mb-5"
            >
              מה תלמדי בקורס?
              <span className="block text-brand-rose-text text-2xl sm:text-3xl lg:text-[2.1rem] mt-3">
                יומיים. אחד לראש, אחד לידיים.
              </span>
            </h2>
            <div className="w-16 h-px bg-gold-gradient mx-auto mb-6" aria-hidden="true" />
            <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
              היום הראשון בונה את ההבנה, השני מתרגם אותה לעבודה אמיתית על מודליסטית.
              בלי לדלג על שלבים ובלי לצפות מהצד.
            </p>

            {/*
              קיצורי דרך לשני הימים — עוזרים בעיקר במובייל, שבו התוכנית ארוכה.
              קישורי עוגן רגילים: נגישים במקלדת, בלי JS, וגלילה חלקה רק כשאין
              prefers-reduced-motion (app/globals.css). כל 32 הנושאים נשארים גלויים.
            */}
            <nav aria-label="מעבר מהיר לימי הקורס" className="mt-8">
              <ul className="flex flex-wrap justify-center gap-3">
                {courseDays.map((day, i) => (
                  <li key={day.label}>
                    <a
                      href={`#course-day-${i + 1}-section`}
                      className="inline-flex items-center gap-2 min-h-11 px-5 py-2.5 rounded-full border border-brand-gold/50 bg-white/60 text-brand-dark text-sm sm:text-base font-medium hover:border-brand-gold hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
                    >
                      <span className="font-serif text-brand-gold-text">{String(i + 1).padStart(2, '0')}</span>
                      {day.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </Reveal>

        <ol className="space-y-16 sm:space-y-24">
          {courseDays.map((day, dayIndex) => (
            <li key={day.label}>
              <article
                id={`course-day-${dayIndex + 1}-section`}
                aria-labelledby={`course-day-${dayIndex + 1}`}
                className="scroll-mt-28 grid grid-cols-1 lg:grid-cols-[17rem_1fr] gap-8 sm:gap-10 lg:gap-16"
              >
                {/* כותרת היום */}
                <Reveal className="lg:sticky lg:top-28 lg:self-start">
                  <div className="flex items-baseline gap-4 lg:block">
                    <span
                      aria-hidden="true"
                      className="font-serif text-5xl sm:text-6xl lg:text-7xl font-medium text-brand-gold-dark leading-none lg:mb-4 lg:block"
                    >
                      {String(dayIndex + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <p className="text-xs sm:text-sm tracking-[0.12em] text-brand-gold-text font-semibold mb-1">
                        {day.label}
                      </p>
                      <h3
                        id={`course-day-${dayIndex + 1}`}
                        className="font-serif text-2xl sm:text-3xl font-medium text-brand-dark"
                      >
                        {day.title}
                      </h3>
                    </div>
                  </div>
                  <div className="w-12 h-px bg-gold-gradient my-5 opacity-70" aria-hidden="true" />
                  <p className="text-brand-medium text-sm sm:text-base leading-[1.8]">{day.summary}</p>
                </Reveal>

                {/* ארבעת הנושאים */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-9 sm:gap-y-12">
                  {day.blocks.map((block, blockIndex) => (
                    <Reveal key={block.title} delay={(blockIndex % 2) * 80}>
                      <div className="pt-5 border-t border-brand-gold/40">
                        <h4 className="font-serif text-lg sm:text-xl font-medium text-brand-dark mb-4">
                          {block.title}
                        </h4>
                        <ul className="space-y-3">
                          {block.items.map((item) => (
                            <li
                              key={item}
                              className="relative ps-4 text-brand-medium text-[0.95rem] sm:text-base leading-relaxed"
                            >
                              <span
                                aria-hidden="true"
                                className="absolute start-0 top-[0.7em] w-1.5 h-1.5 rounded-full bg-brand-rose"
                              />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </article>
            </li>
          ))}
        </ol>

        {/* הנעה לפעולה בסוף התוכנית */}
        <Reveal>
          <div className="mt-16 sm:mt-24 pt-12 border-t border-brand-gold/40 text-center">
            <p className="font-serif text-xl sm:text-2xl text-brand-dark leading-relaxed mb-7 text-balance">
              רוצה לשמוע עוד על הקורס? כתבי לי ואשלח לך את כל הפרטים.
            </p>
            {/*
              אותו קישור וואטסאפ של הקורס (COURSE_WHATSAPP_URL). המדידה עוברת דרך
              WhatsAppTracker הגלובלי, בכפוף להסכמה — אין כאן אירוע נוסף.
            */}
            <CourseCta
              label="לפרטים על הקורס"
              ariaLabel="לפרטים על הקורס — פתיחת שיחת וואטסאפ עם שובל"
              className="w-full sm:w-auto rounded-full px-8 py-3.5"
            />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
