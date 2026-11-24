import { courseIncluded } from '@/lib/course'
import Reveal from './Reveal'

/**
 * "מה מקבלים בקורס" — ארבעת הדברים שהתלמידה מקבלת, אחרי תוכנית הלימודים.
 *
 * פריסה: ארבעה רביעים המופרדים בצלב של קווי זהב דקים (במובייל — זה מתחת לזה,
 * עם קו בין פריט לפריט). מספר סריף גדול לצד כל פריט; בלי כרטיסים ובלי אייקונים.
 * רקע rose-bg (טוקן קיים) — מבדיל את הסקשן מהתוכנית (cream) ומהשאלות (linen).
 *
 * ⚠️ התוכן מ-courseIncluded — ייחודי לעמוד הזה. COURSE_KIT (/faq) לא נוגע.
 * Server Component; תנועה רק דרך Reveal.
 */

/* קווי ההפרדה לפי מיקום: במובייל קו עליון לכל פריט חוץ מהראשון; ב-sm ומעלה
   צלב — קו תחתון לשורה הראשונה וקו צדדי (end) לעמודה הראשונה. */
const CELL_BORDERS = [
  'sm:border-b sm:border-e',
  'border-t sm:border-t-0 sm:border-b',
  'border-t sm:border-t-0 sm:border-e',
  'border-t sm:border-t-0',
] as const

const BRAND = 'S.M BROWS ACADEMY'

/** שם האקדמיה לא נשבר בין שורות (ב-320px הוא נחתך ל-"S.M BROWS / ACADEMY") */
function KeepBrandTogether({ text }: { text: string }) {
  const parts = text.split(BRAND)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <span dir="ltr" className="whitespace-nowrap">
              {BRAND}
            </span>
          )}
        </span>
      ))}
    </>
  )
}

export default function CourseIncludes() {
  const { heading, items } = courseIncluded

  return (
    <section
      id="course-included"
      aria-labelledby="course-included-heading"
      className="relative bg-brand-rose-bg py-20 sm:py-28 scroll-mt-24"
    >
      <div aria-hidden="true" className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-50" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <Reveal>
          {/*
            כותרת מיושרת לצד (ולא ממורכזת עם קו מעליה) — גיוון מינימלי מול
            התוכנית והשאלות הנפוצות שלפניה ואחריה, שתיהן ממורכזות.
          */}
          <div className="mb-10 sm:mb-14">
            <h2
              id="course-included-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-[2.75rem] font-medium text-brand-dark leading-[1.25] text-balance"
            >
              {heading}
            </h2>
            <div className="w-16 h-px bg-gold-gradient mt-5" aria-hidden="true" />
          </div>
        </Reveal>

        <ol className="grid grid-cols-1 sm:grid-cols-2">
          {items.map((item, i) => (
            <li key={item.title} className={`border-brand-gold/40 py-8 sm:p-10 lg:p-12 ${CELL_BORDERS[i]}`}>
              <Reveal delay={(i % 2) * 90}>
                <div className="flex items-start gap-5 sm:gap-6">
                  <span
                    aria-hidden="true"
                    className="font-serif text-4xl sm:text-5xl font-medium text-brand-gold-dark leading-none flex-shrink-0 w-12 sm:w-16"
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="font-serif text-xl sm:text-2xl font-medium text-brand-dark leading-snug mb-2.5">
                      {item.title}
                    </h3>
                    <p className="text-brand-medium text-base leading-[1.8]">
                      <KeepBrandTogether text={item.body} />
                    </p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
