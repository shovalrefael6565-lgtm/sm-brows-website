import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Check, CalendarDays, MapPin, Users } from 'lucide-react'
import { course, courseDays, courseOutcomes } from '@/lib/course'
import CourseCta from '@/components/course/CourseCta'
import Reveal from '@/components/course/Reveal'

const META = [
  { icon: CalendarDays, label: course.duration },
  { icon: Users, label: course.format },
  { icon: MapPin, label: course.location },
]

/**
 * כרטיס הקורס בעמוד הטיפולים — תצוגה מלאה יותר מזו שבעמוד הבית, אבל
 * עדיין טיזר: כל הפירוט יושב ב-/course.
 *
 * ⚠️ Server Component. הגרסה הקודמת הייתה client עם מתג פרונטלי/אונליין
 * ומחיר שאינו בתוקף; היום ההצעה היא קורס פרונטלי אחד של יומיים.
 */
export default function CourseCard() {
  return (
    <Reveal>
      <article
        aria-labelledby="course-card-heading"
        className="relative overflow-hidden rounded-[1.75rem] bg-brand-linen shadow-soft-lg border border-brand-cream-dark/60"
      >
        <div className="absolute top-0 inset-x-0 h-1 bg-gold-gradient" aria-hidden="true" />

        <div className="grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr]">
          {/* Image */}
          <div className="relative min-h-[16rem] lg:min-h-full">
            <Image
              src={course.image}
              alt="קורס עיצוב גבות טבעיות של שובל"
              fill
              loading="lazy"
              sizes="(max-width: 1024px) 100vw, 40vw"
              className="object-cover"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-brand-dark/45 to-transparent lg:bg-gradient-to-l lg:from-brand-linen/90 lg:via-brand-linen/10 lg:to-transparent"
              aria-hidden="true"
            />
          </div>

          {/* Content */}
          <div className="p-8 sm:p-11">
            <div className="w-12 h-px bg-gold-gradient mb-5 opacity-70" aria-hidden="true" />
            <h3
              id="course-card-heading"
              className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark leading-tight mb-3"
            >
              {course.name}
              <span className="block text-brand-rose-text text-2xl sm:text-3xl mt-1.5">
                {course.tagline}
              </span>
            </h3>

            <div className="w-14 h-px bg-gold-gradient mb-6" aria-hidden="true" />

            <p className="text-brand-medium text-base leading-relaxed mb-7 max-w-2xl">
              {course.promise}
            </p>

            {/* Two days */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-7">
              {courseDays.map((day, i) => (
                <div
                  key={day.label}
                  className="bg-white/70 border border-brand-cream-dark rounded-2xl p-5"
                >
                  <p className="text-[0.7rem] tracking-[0.2em] text-brand-gold-text font-semibold uppercase mb-1.5">
                    {day.label}
                  </p>
                  <h4 className="font-serif text-lg font-bold text-brand-dark mb-2">{day.title}</h4>
                  <p className="text-brand-medium text-sm leading-relaxed">
                    {i === 0
                      ? 'קריאת פנים, A-B-C ו-mapping, איזון והרמוניה, שיקום, עבודה בטוחה והיגיינה.'
                      : 'שעווה, חוט, פינצטה, גזירה, צביעה ופינישים — ותהליך מלא על מודליסטית.'}
                  </p>
                </div>
              ))}
            </div>

            {/* Outcomes preview */}
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mb-7">
              {courseOutcomes.slice(0, 4).map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span
                    className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-gold/20 border border-brand-gold/40 flex items-center justify-center mt-0.5"
                    aria-hidden="true"
                  >
                    <Check className="w-3 h-3 text-brand-gold-dark" />
                  </span>
                  <span className="text-brand-medium text-sm leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>

            <ul className="flex flex-wrap gap-x-6 gap-y-3 mb-8" aria-label="פרטי הקורס">
              {META.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-brand-gold-dark flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm text-brand-dark font-medium">{label}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <Link
                href="/course"
                aria-label="לעמוד הקורס המלא של עיצוב גבות טבעיות"
                className="inline-flex items-center justify-center gap-2 bg-brand-dark text-white font-bold text-base px-6 py-3 rounded hover:bg-brand-dark/90 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark focus-visible:ring-offset-2 w-full sm:w-auto"
              >
                לתוכנית המלאה
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              </Link>
              <CourseCta label="לפרטים בוואצאפ" variant="outline" className="w-full sm:w-auto" />
            </div>
          </div>
        </div>
      </article>
    </Reveal>
  )
}
