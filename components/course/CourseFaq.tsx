import { courseFaq } from '@/lib/course'
import Reveal from './Reveal'

/**
 * שאלות לפני הרשמה — details/summary מקורי:
 * נפתח, נגיש ונשלט במקלדת בלי שורת JavaScript אחת.
 */
export default function CourseFaq() {
  return (
    <section
      aria-labelledby="course-faq-heading"
      className="bg-brand-linen py-20 sm:py-24"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <Reveal>
          <div className="text-center mb-11">
            <div className="w-12 h-px bg-gold-gradient mx-auto mb-6 opacity-70" aria-hidden="true" />
            <h2
              id="course-faq-heading"
              className="font-serif text-3xl sm:text-4xl font-medium text-brand-dark"
            >
              שאלות שחוזרות אליי
            </h2>
          </div>
        </Reveal>

        <div className="space-y-3">
          {courseFaq.map((item, i) => (
            <Reveal key={item.q} delay={i * 60}>
              <details className="group bg-white/75 border border-brand-cream-dark rounded-2xl overflow-hidden">
                <summary className="flex items-center justify-between gap-4 p-5 sm:p-6 cursor-pointer list-none font-semibold text-brand-dark text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded-2xl">
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="flex-shrink-0 w-7 h-7 rounded-full border border-brand-gold/40 flex items-center justify-center text-brand-gold-dark transition-transform duration-200 group-open:rotate-45"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </summary>
                <p className="px-5 sm:px-6 pb-5 sm:pb-6 -mt-1 text-brand-medium text-sm leading-relaxed">
                  {item.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
