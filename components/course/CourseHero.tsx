import Image from 'next/image'
import { CalendarDays, MapPin, Users } from 'lucide-react'
import { course } from '@/lib/course'
import { COURSE_HERO_MAIN, COURSE_HERO_TOP, COURSE_HERO_BOTTOM, type CoursePhoto } from '@/lib/coursePhotos'
import CourseCta from './CourseCta'

const META = [
  { icon: CalendarDays, label: course.duration },
  { icon: Users, label: course.format },
  { icon: MapPin, label: course.location },
]

/**
 * הירו של עמוד הקורס — Server Component בלבד ובלי אנימציית כניסה:
 * הכותרת והתמונה הראשית הן אלמנטי ה-LCP וחייבות להיות מצוירות בציור הראשון.
 *
 * סדר ה-DOM הוא גם סדר המובייל: כותרת → טקסט → כפתור הרשמה → תמונות,
 * כך שכפתור הוואטסאפ נמצא במסך הראשון לפני הגלריה. בדסקטופ הטקסט בעמודה
 * הראשונה (ימין, RTL) והקומפוזיציה בשנייה.
 *
 * הקומפוזיציה: שלוש תמונות בוגרות (lib/coursePhotos.ts). אין סרטון בעמוד —
 * הוחלט 24.11.2026; CourseVideo נשמר לשימוש עתידי בלבד.
 */
export default function CourseHero() {
  return (
    <section
      aria-labelledby="course-hero-heading"
      className="relative overflow-hidden bg-hero-gradient pt-24 pb-14 sm:pt-40 sm:pb-24"
    >
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 inset-x-0 h-px bg-gold-gradient opacity-40" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-9 sm:gap-12 lg:gap-16 items-center">
          {/* טקסט + קריאות לפעולה */}
          <div>
            <div className="w-12 h-px bg-gold-gradient mb-5 sm:mb-6 opacity-70" aria-hidden="true" />
            {/*
              שם האקדמיה + שם המלמדת. האנגלית באותיות רישיות ומרווח רחב (כמו בשאר האתר);
              העברית בלי מרווח אותיות — עברית לא נקראת טוב עם tracking רחב.
              ב-12px במובייל (היה 11.2px) ובצבע gold-text הנגיש (5:1 ומעלה).
            */}
            <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-brand-gold-text font-semibold mb-4">
              <span className="text-xs tracking-[0.2em] sm:tracking-[0.24em] uppercase">S.M BROWS ACADEMY</span>
              <span aria-hidden="true" className="text-brand-gold">·</span>
              <span className="text-sm sm:text-[0.95rem]">עם שובל מאירה</span>
            </p>
            <h1
              id="course-hero-heading"
              className="font-serif text-4xl sm:text-5xl lg:text-6xl font-medium text-brand-dark leading-[1.15] mb-5 sm:mb-6 text-balance"
            >
              {course.name}
              <span className="block text-brand-rose-text mt-2">{course.tagline}</span>
            </h1>

            {/* הקו השני מוסתר במובייל — חוסך גובה בלי לוותר על תוכן */}
            <div className="hidden sm:block w-16 h-px bg-gold-gradient mb-6" aria-hidden="true" />

            <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-xl mb-6 sm:mb-8">
              {course.promise}
            </p>

            <ul className="flex flex-wrap gap-x-6 gap-y-2.5 sm:gap-y-3 mb-7 sm:mb-9" aria-label="פרטי הקורס">
              {META.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-brand-gold-dark flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm text-brand-dark font-medium">{label}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              <CourseCta className="w-full sm:w-auto rounded-full px-8 py-3.5" />
              <a
                href="#course-program"
                className="inline-flex items-center justify-center gap-2 text-brand-medium font-medium text-base px-7 py-3.5 rounded-full border border-brand-medium/25 hover:border-brand-medium/60 hover:text-brand-dark transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark focus-visible:ring-offset-2 w-full sm:w-auto"
              >
                לתוכנית הקורס
              </a>
            </div>
          </div>

          {/* קומפוזיציית הבוגרות */}
          <TrioComposition main={COURSE_HERO_MAIN} top={COURSE_HERO_TOP} bottom={COURSE_HERO_BOTTOM} />
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   מסגרות — אותה שפה של שאר האתר: פינות 1.75rem לתמונה הדומיננטית, טבעת זהב
   דקה מסביב (כמו מסגרת הסרטון/התמונה בעמוד הבית), צל חם soft-lg.
   ───────────────────────────────────────────────────────────────────────── */

function MainFrame({ photo, sizes, className = '' }: { photo: CoursePhoto; sizes: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div aria-hidden="true" className="absolute -inset-3 sm:-inset-4 rounded-[2rem] border border-brand-gold/25" />
      <div className="relative h-full rounded-[1.75rem] overflow-hidden shadow-soft-lg bg-brand-cream-dark">
        {/*
          ⚡ אלמנט ה-LCP: eager + fetchPriority high, ולא preload — אותה תמונה
          בכל המסכים, אבל במידות שונות לפי מסך.
        */}
        <Image
          src={photo.src}
          alt={photo.alt}
          fill
          loading="eager"
          fetchPriority="high"
          quality={80}
          sizes={sizes}
          className="object-cover"
          style={{ objectPosition: photo.position }}
        />
      </div>
    </div>
  )
}

function SmallFrame({ photo, sizes, className = '' }: { photo: CoursePhoto; sizes: string; className?: string }) {
  return (
    <div className={`relative rounded-[1.25rem] overflow-hidden shadow-soft-lg bg-brand-cream-dark ${className}`}>
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        sizes={sizes}
        className="object-cover"
        style={{ objectPosition: photo.position }}
      />
    </div>
  )
}

/**
 * שלוש תמונות: בדסקטופ — ראשית גדולה ושתי משניות
 * זו מעל זו בגובה שלה. במובייל — ראשית ברוחב מלא ושתי משניות זו לצד זו מתחתיה.
 */
function TrioComposition({ main, top, bottom }: { main: CoursePhoto; top: CoursePhoto; bottom: CoursePhoto }) {
  return (
    /*
      ⚠️ המרווח בין הראשית למשניות (gap-y במובייל, gap-x בדסקטופ) גדול בכוונה
      מהמרווח בין שתי המשניות: טבעת הזהב של הראשית יוצאת 12–16px מעבר לתמונה,
      ובמרווח קטן יותר היא נוגעת במשניות.
    */
    <div className="mx-auto w-full max-w-[30rem] lg:max-w-none pt-3 sm:pt-4 grid grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-4 sm:gap-y-9 lg:grid-cols-[1fr_0.62fr] lg:grid-rows-2 lg:gap-x-9 lg:gap-y-4">
      <MainFrame
        photo={main}
        className="col-span-2 aspect-[4/5] lg:col-span-1 lg:row-span-2"
        sizes="(min-width: 1280px) 330px, (min-width: 1024px) 26vw, (min-width: 640px) 480px, calc(100vw - 32px)"
      />
      <SmallFrame
        photo={top}
        className="aspect-[4/5] lg:aspect-auto"
        sizes="(min-width: 1280px) 205px, (min-width: 1024px) 16vw, (min-width: 640px) 234px, 50vw"
      />
      <SmallFrame
        photo={bottom}
        className="aspect-[4/5] lg:aspect-auto"
        sizes="(min-width: 1280px) 205px, (min-width: 1024px) 16vw, (min-width: 640px) 234px, 50vw"
      />
    </div>
  )
}
