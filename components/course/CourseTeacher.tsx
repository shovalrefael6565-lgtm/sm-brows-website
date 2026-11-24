import { courseTeacher } from '@/lib/course'
import Reveal from './Reveal'

/**
 * "למה ללמוד אצלי" — מחליף את CoursePhilosophy בעמוד /course.
 *
 * מבנה: כותרת + פסקה אישית בעמודה אחת, והמשפט המרכזי של שובל כציטוט
 * בעמודה השנייה (במובייל — מתחת לפסקה). מתחת — ארבעה עקרונות בפריסה
 * עריכתית: קו זהב עליון, מספר, כותרת ושורה. בלי כרטיסים ובלי אייקונים.
 *
 * ⚠️ התוכן מ-courseTeacher (ייחודי לעמוד הזה). coursePillars לא נוגעים —
 * הם ממשיכים לשמש את סקשן הקורס בעמוד הבית.
 * Server Component; התנועה היחידה היא חשיפה בגלילה דרך Reveal.
 */
export default function CourseTeacher() {
  const { label, heading, headingAccent, intro, quote, points } = courseTeacher

  return (
    <section
      aria-labelledby="course-teacher-heading"
      className="relative bg-brand-cream py-20 sm:py-28"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <Reveal>
            <div className="w-12 h-px bg-gold-gradient mb-6 opacity-70" aria-hidden="true" />
            <p className="text-xs sm:text-sm tracking-[0.12em] text-brand-gold-text font-semibold mb-4">
              {label}
            </p>
            <h2
              id="course-teacher-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-[2.75rem] font-medium text-brand-dark leading-[1.25] text-balance mb-7"
            >
              {heading}
              <span className="block text-brand-rose-text mt-2">{headingAccent}</span>
            </h2>
            <p className="text-brand-medium text-base sm:text-lg leading-[1.9] max-w-xl">{intro}</p>
          </Reveal>

          {/* המשפט המרכזי — אותו דפוס ציטוט כמו ב-Hero של עמוד הבית */}
          <Reveal delay={120}>
            <figure className="ps-7 sm:ps-9 border-s border-brand-gold/50">
              <span
                aria-hidden="true"
                className="block h-9 sm:h-11 font-serif text-7xl sm:text-8xl leading-none text-brand-gold/40 select-none"
              >
                &rdquo;
              </span>
              <blockquote>
                <p className="font-serif text-[1.7rem] sm:text-3xl lg:text-[2.25rem] font-medium text-brand-dark leading-[1.4] text-balance lg:text-wrap">
                  {quote[0]}
                  <span className="block text-brand-rose-text mt-1">{quote[1]}</span>
                </p>
              </blockquote>
              <figcaption className="mt-5 text-sm font-medium text-brand-muted">— שובל מאירה</figcaption>
            </figure>
          </Reveal>
        </div>

        {/* בלי מספור (שלב התיקונים): המספור נשאר רק בתוכנית ובסקשן "מה מקבלים" */}
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-7 sm:gap-y-10 mt-14 sm:mt-20">
          {points.map((point, i) => (
            <li key={point.title}>
              <Reveal delay={i * 80}>
                <div className="pt-5 sm:pt-6 border-t border-brand-gold/40">
                  <h3 className="font-serif text-xl font-medium text-brand-dark mb-2">{point.title}</h3>
                  <p className="text-brand-medium text-sm sm:text-[0.95rem] leading-relaxed">{point.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
