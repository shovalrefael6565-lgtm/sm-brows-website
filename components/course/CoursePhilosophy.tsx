import { coursePillars } from '@/lib/course'
import Reveal from './Reveal'

/**
 * המסר המרכזי של הקורס — הדבר היחיד שחשוב שיישאר אצל מי שקוראת:
 * לא לומדים כאן טכניקה בלבד, לומדים לראות.
 */
export default function CoursePhilosophy() {
  return (
    <section
      aria-labelledby="course-philosophy-heading"
      className="relative bg-brand-cream py-20 sm:py-28"
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <Reveal>
          <div className="w-12 h-px bg-gold-gradient mx-auto mb-6 opacity-70" aria-hidden="true" />
          <h2
            id="course-philosophy-heading"
            className="font-serif text-3xl sm:text-4xl lg:text-[2.75rem] font-medium text-brand-dark text-center leading-[1.25] text-balance mb-7"
          >
            טכניקה אפשר ללמוד מסרטון.
            <span className="block text-brand-rose-text mt-2">עין מקצועית לומדים אצל מישהי.</span>
          </h2>

          <div className="w-16 h-px bg-gold-gradient mx-auto mb-8" aria-hidden="true" />

          <p className="text-brand-medium text-lg sm:text-xl leading-[1.9] text-center max-w-3xl mx-auto">
            אני לא מלמדת צורה אחת שמתאימה לכל אחת. אני מלמדת אותך להסתכל על הפנים שמולך
            ולהבין מה הן צריכות — איפה הגבה מתחילה, איפה היא נשברת, מה מאזן את הפנים
            ומה יהרוס אותן. זה ההבדל בין מי שמעצבת גבות לבין מי שיודעת <span className="text-brand-dark font-semibold">למה</span> היא
            מעצבת אותן ככה.
          </p>
        </Reveal>

        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 mt-16">
          {coursePillars.map((pillar, i) => (
            <li key={pillar.title}>
              <Reveal delay={i * 90}>
                <div className="h-full bg-white/70 border border-brand-cream-dark rounded-2xl p-7 shadow-soft">
                  <p
                    className="font-serif text-2xl text-brand-gold-dark mb-3"
                    aria-hidden="true"
                  >
                    {String(i + 1).padStart(2, '0')}
                  </p>
                  <h3 className="font-serif text-xl font-medium text-brand-dark mb-2">
                    {pillar.title}
                  </h3>
                  <p className="text-brand-medium text-sm leading-relaxed">{pillar.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
