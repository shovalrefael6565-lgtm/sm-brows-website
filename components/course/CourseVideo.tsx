'use client'

import Image from 'next/image'
import { useCallback, useRef, useState } from 'react'
import { Play } from 'lucide-react'

const VIDEO_SRC  = '/videos/course-intro.mp4'
const POSTER_SRC = '/videos/course-intro-poster.jpg'

/**
 * הסרטון של הקורס — האלמנט הויזואלי של ההירו בעמוד /course.
 *
 * 🔒 `preload="none"` הוא הלב של הקומפוננטה: כל עוד לא לחצו על כפתור
 * ההפעלה הדפדפן לא מוריד אפילו בייט אחד מהווידאו (5MB), כך שהעמוד נטען
 * בדיוק כמו קודם. מי שלא לוחצת — לא משלמת על הסרטון בכלל.
 *
 * ⚠️ הפוסטר מרונדר כ-next/image ולא דרך תכונת ה-poster של <video>:
 * ככה הוא עובר אופטימיזציה (AVIF/WebP, גדלים לפי מסך) ונשאר מועמד LCP
 * תקין — בדיוק כמו התמונה שהייתה כאן קודם. תכונת poster הייתה מגישה
 * JPEG מלא של 180KB לכל מכשיר.
 *
 * אין autoplay בכוונה: הסרטון מתחיל אך ורק בלחיצה מפורשת.
 */
export default function CourseVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)

  const start = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    setStarted(true)
    // הלחיצה עצמה היא מחוות המשתמשת שמתירה ניגון עם קול.
    v.play().catch(() => setStarted(false))
  }, [])

  /* בסיום — חזרה לפוסטר, כדי שאפשר יהיה להפעיל שוב מאותה נקודה. */
  const reset = useCallback(() => {
    const v = videoRef.current
    setStarted(false)
    if (v) v.currentTime = 0
  }, [])

  return (
    <div className="relative mx-auto w-full max-w-[300px] sm:max-w-[340px] lg:max-w-[370px]">
      {/* טבעת הזהב — אותה שפה ויזואלית של מסגרת התמונה בשאר האתר */}
      <div
        aria-hidden="true"
        className="absolute -inset-3 sm:-inset-4 rounded-[2rem] border border-brand-gold/25"
      />

      <div className="relative aspect-[804/1440] rounded-[1.75rem] overflow-hidden shadow-soft-lg bg-brand-dark">
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          preload="none"
          playsInline
          controls={started}
          onEnded={reset}
          className="w-full h-full object-cover"
        />

        {/* שכבת הפוסטר + כפתור ההפעלה — נעלמת ברגע שהסרטון מתחיל */}
        {!started && (
          <button
            type="button"
            onClick={start}
            aria-label="הפעלת הסרטון של הקורס"
            className="absolute inset-0 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-cream"
          >
            <Image
              src={POSTER_SRC}
              alt="שובל מאירה מציגה את חוברת קורס עיצוב הגבות הטבעיות"
              fill
              priority
              sizes="(max-width: 640px) 300px, (max-width: 1024px) 340px, 370px"
              quality={80}
              className="object-cover"
            />

            {/* הכהיה עדינה כדי שהכפתור יישב בניגודיות מלאה על כל פריים */}
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-brand-dark/45 via-brand-dark/10 to-brand-dark/15 transition-colors duration-300 group-hover:from-brand-dark/55"
            />

            {/* עיגול ההפעלה */}
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center"
            >
              <span className="relative flex items-center justify-center w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-full bg-white/95 shadow-gold transition-transform duration-300 ease-out group-hover:scale-107">
                {/* הטבעת הדקה סביב העיגול */}
                <span className="absolute -inset-[6px] rounded-full border border-white/50" />
                <Play
                  className="w-7 h-7 sm:w-8 sm:h-8 text-brand-dark translate-x-[2px]"
                  fill="currentColor"
                  strokeWidth={0}
                />
              </span>
            </span>

            {/* כיתוב קטן מתחת לכפתור */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-6 text-center text-white text-sm font-medium tracking-wide drop-shadow"
            >
              צפייה בסרטון הקורס
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
