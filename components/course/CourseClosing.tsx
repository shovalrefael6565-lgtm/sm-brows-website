import { course } from '@/lib/course'
import CourseCta from './CourseCta'
import Reveal from './Reveal'

/**
 * סיום העמוד — מסר אישי של שובל והנעה אחת ברורה לפעולה.
 *
 * רקע hero-gradient — אותו רקע של פתיחת העמוד, כך שהעמוד "נסגר" בטבעיות.
 * בלי תמונות (תמונות הטיפול natural-8/9/10 הוסרו מכאן בשלב י'; הקבצים נשארים —
 * הם בשימוש ב-lib/data.ts) ובלי רשימת "מה כלול" — יש לה סקשן משלה.
 * 🔒 בלי לחץ מלאכותי, מקומות אחרונים או מבצעים.
 *
 * הכפתור: קישור הוואטסאפ של הקורס (COURSE_WHATSAPP_URL דרך CourseCta);
 * המדידה דרך WhatsAppTracker הגלובלי, בכפוף להסכמה — אין כאן אירוע נוסף.
 */
export default function CourseClosing() {
  return (
    <section
      id="course-register"
      aria-labelledby="course-closing-heading"
      className="relative overflow-hidden bg-hero-gradient py-24 sm:py-32 scroll-mt-24"
    >
      <div aria-hidden="true" className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-50" />

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <Reveal>
          <div className="w-12 h-px bg-gold-gradient mx-auto mb-6 opacity-70" aria-hidden="true" />
          <p className="text-[0.7rem] sm:text-xs tracking-[0.24em] text-brand-gold-text font-semibold uppercase mb-5">
            S.M BROWS ACADEMY
          </p>
          <h2
            id="course-closing-heading"
            className="font-serif text-4xl sm:text-5xl lg:text-6xl font-medium text-brand-dark leading-[1.15] text-balance mb-7"
          >
            הצעד הראשון שלך
            <span className="block text-brand-rose-text mt-2">מתחיל כאן.</span>
          </h2>
          <div className="w-16 h-px bg-gold-gradient mx-auto mb-7" aria-hidden="true" />
          <p className="text-brand-medium text-lg sm:text-xl leading-[1.85] max-w-2xl mx-auto mb-4">
            אם עולם הגבות תמיד עניין אותך, או שאת מרגישה שהגיע הזמן לקחת את הידע שלך צעד אחד
            קדימה — אשמח להכיר אותך ולספר לך עוד על הקורס שלי.
          </p>
          <p className="text-sm font-medium text-brand-muted mb-10">— שובל מאירה</p>

          <CourseCta
            label="בואי נדבר על הקורס"
            ariaLabel="בואי נדבר על הקורס — פתיחת שיחת וואטסאפ עם שובל"
            className="w-full sm:w-auto rounded-full px-9 py-4 text-lg"
          />

          <p className="text-brand-muted text-sm leading-relaxed mt-8">
            {course.format} · {course.location}
          </p>
        </Reveal>
      </div>
    </section>
  )
}
