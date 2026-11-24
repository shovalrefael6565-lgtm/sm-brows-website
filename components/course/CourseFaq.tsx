import { courseFaq } from '@/lib/course'
import Reveal from './Reveal'

/**
 * שאלות לפני הרשמה — details/summary מקורי:
 * נפתח, נגיש ונשלט במקלדת (Enter/Space) בלי שורת JavaScript אחת,
 * והתשובה נמצאת ב-DOM גם כשהשאלה סגורה (סריקה + FAQPage JSON-LD תואם).
 *
 * עיצוב: רשימה עריכתית עם קווי זהב דקים בין השאלות — בלי כרטיסים.
 * ⚠️ התוכן מ-courseFaq (עמוד /course בלבד) — ה-JSON-LD ב-app/course/page.tsx
 * נבנה מאותו מערך בדיוק.
 */
export default function CourseFaq() {
  return (
    <section
      id="course-faq"
      aria-labelledby="course-faq-heading"
      className="bg-brand-linen py-20 sm:py-28 scroll-mt-24"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <Reveal>
          <div className="text-center mb-10 sm:mb-14">
            <div className="w-12 h-px bg-gold-gradient mx-auto mb-6 opacity-70" aria-hidden="true" />
            <h2
              id="course-faq-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-[2.75rem] font-medium text-brand-dark leading-[1.25]"
            >
              שאלות שחוזרות אליי
            </h2>
          </div>
        </Reveal>

        <Reveal>
          <div className="border-t border-brand-gold/40">
            {courseFaq.map((item) => (
              <details key={item.q} className="group border-b border-brand-gold/40">
                <summary className="flex items-center justify-between gap-5 py-5 sm:py-6 cursor-pointer list-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-4 focus-visible:ring-offset-brand-linen">
                  <span className="font-serif text-lg sm:text-xl font-medium text-brand-dark leading-snug">
                    {item.q}
                  </span>
                  <span
                    aria-hidden="true"
                    className="flex-shrink-0 w-8 h-8 rounded-full border border-brand-gold/50 flex items-center justify-center text-brand-gold-dark transition-transform duration-200 group-open:rotate-45"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </summary>
                <p className="pb-6 -mt-1 pe-12 text-brand-medium text-base leading-[1.85]">{item.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
