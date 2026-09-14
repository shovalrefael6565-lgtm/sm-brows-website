import { CalendarDays, MapPin, Users } from 'lucide-react'
import { course } from '@/lib/course'
import CourseCta from './CourseCta'
import CourseVideo from './CourseVideo'

const META = [
  { icon: CalendarDays, label: course.duration },
  { icon: Users, label: course.format },
  { icon: MapPin, label: course.location },
]

/**
 * הירו של עמוד הקורס — Server Component בלבד ובלי אנימציית כניסה:
 * הכותרת כאן היא אלמנט ה-LCP של העמוד וחייבת להיות מצוירת בציור הראשון.
 */
export default function CourseHero() {
  return (
    <section
      aria-labelledby="course-hero-heading"
      className="relative overflow-hidden bg-hero-gradient pt-32 pb-16 sm:pt-40 sm:pb-24"
    >
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 inset-x-0 h-px bg-gold-gradient opacity-40" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        {/*
          פריסה: במובייל הסדר הוא כותרת → סרטון → גוף הטקסט, כך שהסרטון
          נמצא גבוה בעמוד ולא מתחת לכל ה-CTA. בדסקטופ חוזרים לשתי עמודות
          והסרטון תופס את העמודה השנייה לכל גובהה — בדיוק כמו התמונה קודם.
          ⚠️ הסדר ב-DOM נשאר כותרת-ראשונה; רק המיקום בגריד משתנה.
        */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] lg:grid-rows-[auto_auto] gap-8 lg:gap-x-16 lg:gap-y-0 items-center lg:items-stretch">
          {/* כותרת */}
          <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
            <div className="w-12 h-px bg-gold-gradient mb-6 opacity-70" aria-hidden="true" />
            <h1
              id="course-hero-heading"
              className="font-serif text-4xl sm:text-5xl lg:text-6xl font-medium text-brand-dark leading-[1.15] mb-4 text-balance"
            >
              {course.name}
              <span className="block text-brand-rose-text mt-2">{course.tagline}</span>
            </h1>
          </div>

          {/* Video — הסרטון הוא הפנים של העמוד */}
          <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-center">
            <CourseVideo />
          </div>

          {/* גוף הטקסט + קריאות לפעולה */}
          <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
            <div className="w-16 h-px bg-gold-gradient mb-6" aria-hidden="true" />

            <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-xl mb-8">
              {course.promise}
            </p>

            <ul className="flex flex-wrap gap-x-6 gap-y-3 mb-9" aria-label="פרטי הקורס">
              {META.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-brand-gold-dark flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm text-brand-dark font-medium">{label}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <CourseCta className="w-full sm:w-auto" />
              <a
                href="#course-program"
                className="inline-flex items-center justify-center gap-2 text-brand-medium font-medium text-base px-5 py-3 rounded border border-brand-medium/25 hover:border-brand-medium/60 hover:text-brand-dark transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark w-full sm:w-auto"
              >
                לתוכנית הקורס
              </a>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
