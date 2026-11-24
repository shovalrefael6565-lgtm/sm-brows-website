import { courseAudience, courseOutcomes } from '@/lib/course'
import Reveal from './Reveal'

/**
 * למי הקורס מתאים — שני קהלים, ומה יוצאים איתו בסוף היומיים.
 *
 * פריסה עריכתית ללא כרטיסים וללא אייקונים: שני אזורי טקסט זה לצד זה,
 * מופרדים בקו זהב דק (במובייל — זה מעל זה). מתחת, רשימת התוצרים
 * (courseOutcomes — משותף ל-JSON-LD ולעמוד הטיפולים, לא נערך כאן).
 *
 * ⚠️ תמונת הטיפול natural-6 הוסרה מהסקשן הזה בשלב ו' (הקובץ עצמו נשאר —
 * הוא בשימוש גם ב-lib/data.ts). Server Component; תנועה רק דרך Reveal.
 */
export default function CourseAudience() {
  const { heading, groups } = courseAudience

  return (
    <section
      id="course-audience"
      aria-labelledby="course-audience-heading"
      className="relative overflow-hidden bg-brand-linen py-20 sm:py-28 scroll-mt-24"
    >
      <div aria-hidden="true" className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-50" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <Reveal>
          <div className="text-center mb-12 sm:mb-16">
            <div className="w-12 h-px bg-gold-gradient mx-auto mb-6 opacity-70" aria-hidden="true" />
            <h2
              id="course-audience-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-[2.75rem] font-medium text-brand-dark leading-[1.25] text-balance"
            >
              {heading}
            </h2>
          </div>
        </Reveal>

        {/* שני הקהלים */}
        <ul className="grid grid-cols-1 md:grid-cols-2">
          {groups.map((group, i) => (
            <li
              key={group.title}
              className={
                i === 0
                  ? 'pb-10 md:pb-0 md:pe-12 lg:pe-16'
                  : 'pt-10 md:pt-0 md:ps-12 lg:ps-16 border-t md:border-t-0 md:border-s border-brand-gold/40'
              }
            >
              <Reveal delay={i * 100}>
                <h3 className="font-serif text-2xl sm:text-[1.75rem] font-medium text-brand-rose-text leading-snug mb-4 text-balance">
                  {group.title}
                </h3>
                <p className="text-brand-medium text-base sm:text-lg leading-[1.85]">{group.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>

        {/* מה יוצאים איתו */}
        <Reveal>
          <div className="mt-10 md:mt-20 pt-10 sm:pt-12 border-t border-brand-gold/40">
            <h3 className="font-serif text-2xl sm:text-3xl font-medium text-brand-dark leading-snug mb-7 text-center text-balance">
              מה תלמדי לעשות במהלך הקורס?
            </h3>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4 max-w-4xl mx-auto">
              {courseOutcomes.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-brand-gold mt-2.5" aria-hidden="true" />
                  <span className="text-brand-medium text-sm sm:text-base leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
