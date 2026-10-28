'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  images: string[]
  /** תיאור מילולי לכל תמונה, לפי אותו סדר. ראה Product.imageAlts. */
  alts?: string[]
  productName: string
  /** מציג תווית "בקרוב" על התמונה הראשית. */
  comingSoon?: boolean
}

/** משך ה-crossfade. 🔒 חייב להישאר תואם ל-duration-200 שבמחלקה. */
const FADE_MS = 200

/**
 * גלריית תמונות המוצר — תמונה ראשית + בחירה מתוך רצועת ממוזערות.
 *
 * ⚠️ **אינה קרוסלה מתחלפת מעצמה.** ה-ImageSlider של ServiceCard מתקדם
 * לבד כל 3.5 שניות כי הוא ויטרינה; כאן המבקרת בוחנת מוצר, ותמונה שמתחלפת
 * תוך כדי התבוננות היא הפרעה. ההחלפה נעשית רק ביוזמתה.
 *
 * ═══ 🔒 object-cover, בהחלטה מודעת ═══
 *
 * תמונות המוצר אינן באותו יחס: hero ו-packaging הן 3:2, closed ו-tip הן
 * 2:3, ו-branding ריבועית. `object-contain` בתוך מסגרת ריבועית הותיר
 * פס רקע של כשליש מהמסגרת — למעלה ולמטה בתמונות הרוחב, ובצדדים בתמונות
 * הגובה — וכיוון שגוון הקרם (#FAF7F5) כמעט לבן, הפס נראה כמסגרת לבנה
 * סביב התמונה. `cover` ממלא את המסגרת.
 *
 * ⚠️ **המחיר, בעיניים פקוחות:** בכל תמונה שאינה ריבועית נחתך כשליש —
 * בצדדים או למעלה ולמטה. אושר במכוון לטובת מסגרת מלאה.
 *
 * 🔒 **`object-top` ולא ברירת המחדל `center`, וזה כלל אחד ולא חריג לכל
 * תמונה.** בתמונות הפורטרט (2:3) הכותרת — "SHOVAL MIARA / Micro Brow
 * Pen" — יושבת בשישית העליונה, ו-`center` חתך אותה באמצע האותיות.
 * עיגון למעלה מזיז את כל החיתוך (33%) לתחתית.
 *
 * ⚠️ מדוע זה בטוח כהגדרה גורפת: בתמונות הרוחב (3:2) החיתוך הוא **אופקי
 * בלבד**, ולכן רכיב ה-Y של object-position אינו משפיע עליהן כלל, ו-1:1
 * אינה נחתכת. כלומר הכלל נוגע בדיוק לשתי התמונות שהוא נועד להן.
 *
 * 🔴 המחיר של העיגון: בתמונות הפורטרט נחתך השליש התחתון — חלק מגוף
 * העט והכיתוב בעברית שמתחתיו. תמונה חדשה שנושאת מידע בתחתיתה צריכה
 * להיות ריבועית או לקבל טיפול נפרד.
 *
 * 🔒 **המסגרת הריבועית קבועה (aspect-square) ולכן אין layout shift**:
 * המקום נתפס לפני שהתמונה נטענת, והחלפת תמונה אינה משנה את גובה העמוד
 * גם כשהיחס של הבאה שונה.
 *
 * ═══ 🔒 למה חמש שכבות ולא תמונה אחת שמחליפה src ═══
 *
 * קודם היה כאן `<Image key={current} src={current} …>` יחיד. `key`
 * שמשתנה מאלץ את React לפרק את הצומת ולבנות חדש, כלומר הקונטיינר נשאר
 * **ריק** עד שהתמונה הבאה מפוענחת — וזה ההבהוב: רגע אחד של רקע חשוף.
 *
 * כאן כל חמש התמונות מורכבות ב-DOM מהרינדור הראשון וכולן נטענות מיד
 * (`priority` לראשונה, `loading="eager"` לשאר), ולכן בלחיצה אין מה
 * להמתין לו. המעבר הוא opacity בלבד.
 *
 * 🔴 **ולמה `prev` ולא פשוט fade הדדי:** אם היוצאת מתעמעמת בזמן שהנכנסת
 * מתבהרת, שתיהן שקופות למחצה באמצע הדרך והרקע הבהיר מבצבץ ביניהן — אותו
 * הבהוב, רק עדין יותר. לכן היוצאת נשארת **אטומה לחלוטין** בשכבה
 * שמתחת, והנכנסת מתבהרת מעליה. הרקע אינו נחשף באף נקודת זמן.
 *
 * 🔒 ChevronRight = הקודם ו-ChevronLeft = הבא, בדיוק כמו ב-ServiceCard:
 * באתר RTL החץ ימינה מצביע אחורה. היפוך כאן היה שובר את אחידות הניווט.
 */
export default function ProductGallery({ images, alts, productName, comingSoon }: Props) {
  const [index, setIndex] = useState(0)
  /** התמונה היוצאת, שנשארת גלויה מתחת לנכנסת עד שה-fade נגמר. */
  const [prev, setPrev] = useState<number | null>(null)
  const count = images.length

  const show = (next: number) => {
    const target = (next + count) % count
    if (target === index) return
    setPrev(index)
    setIndex(target)
  }

  /*
   * ⚠️ שחרור השכבה היוצאת בטיימר ולא ב-onTransitionEnd: האירוע אינו
   * מובטח (prefers-reduced-motion מבטל את המעבר, וטאב ברקע עשוי לא
   * לירות אותו), ושכבה שלא שוחררה הייתה נשארת אטומה מתחת לנכנסת —
   * כלומר התמונה הנכונה למעלה ועוד אחת מתחתיה לנצח.
   */
  useEffect(() => {
    if (prev === null) return
    const t = setTimeout(() => setPrev(null), FADE_MS + 40)
    return () => clearTimeout(t)
  }, [prev, index])

  /**
   * ⚠️ נופל ל-"תמונה N מתוך M" רק כשאין תיאור כתוב — תיאור אמיתי תמיד
   * עדיף, ולכן ההיעדר לא אמור להיות המצב הרגיל.
   */
  const altFor = (i: number) =>
    alts?.[i] ??
    (count > 1
      ? `${productName} — תמונה ${i + 1} מתוך ${count}`
      : `${productName} — תמונת המוצר`)

  return (
    <div>
      <div className="relative aspect-square rounded-3xl overflow-hidden bg-brand-cream shadow-soft-lg group">
        {images.map((src, i) => {
          const isCurrent = i === index
          const isLeaving = i === prev
          return (
            <Image
              key={src}
              src={src}
              /*
               * 🔒 רק לתמונה הנוכחית יש alt. חמש שכבות עם חמישה תיאורים
               * היו נקראות כולן ברצף בקורא מסך, כאילו העמוד מציג חמש
               * תמונות במקביל.
               */
              alt={isCurrent ? altFor(i) : ''}
              aria-hidden={isCurrent ? undefined : true}
              fill
              /*
               * 🔒 `loading="eager"` על **כל** החמש — זה מה שמונע את
               * ההבהוב: תמונה שעדיין לא ירדה אין לה למה להתבהר.
               *
               * ⚠️ ולא `priority`: מ-Next 16 הוא deprecated לטובת
               * `preload`, ובפועל לא הפיק `loading="eager"` — ה-console
               * התלונן שתמונת ה-LCP נטענת עצלה. `preload` גם אינו מתאים
               * כאן (התיעוד שולל אותו כשמשתמשים ב-loading או
               * ב-fetchPriority); הראשונה מקבלת עדיפות רשת דרך
               * fetchPriority, והשאר נטענות ברקע.
               */
              loading="eager"
              fetchPriority={i === 0 ? 'high' : 'auto'}
              sizes="(max-width: 1024px) 100vw, 50vw"
              className={cn(
                'object-cover object-top transition-opacity duration-200 ease-out motion-reduce:transition-none',
                isCurrent
                  ? 'opacity-100 z-[2]'
                  : isLeaving
                    ? 'opacity-100 z-[1] pointer-events-none'
                    : 'opacity-0 z-0 pointer-events-none',
              )}
            />
          )
        })}

        {/*
          🔒 **למטה, ולא בפינה העליונה.** אחרי שהחיתוך עוגן למעלה
          (object-top) הכותרת המוטבעת בתמונות הפורטרט עלתה לראש המסגרת,
          והתווית כיסתה את האות הראשונה של "SHOVAL". קודם זה לא נראה רק
          משום שהכותרת הייתה חתוכה ממילא.

          ⚠️ הפינה התחתונה בצד ה-end נבחרה מפני שהיא היחידה שפנויה בכל
          חמש התמונות: הכיתוב המשני בתמונת ה-tip יושב בצד ה-start, ושאר
          התמונות נושאות שם רקע בלבד.
        */}
        {comingSoon && (
          <span className="absolute bottom-4 end-4 inline-flex items-center gap-1.5 bg-brand-gold text-brand-dark text-xs font-bold px-3 py-1.5 rounded-full tracking-wider z-10">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-dark/70" aria-hidden="true" />
            בקרוב
          </span>
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => show(index - 1)}
              aria-label="תמונה קודמת"
              className="absolute top-1/2 -translate-y-1/2 start-3 z-10 w-9 h-9 rounded-full bg-brand-dark/45 backdrop-blur-sm flex items-center justify-center text-white transition-opacity duration-200 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => show(index + 1)}
              aria-label="תמונה הבאה"
              className="absolute top-1/2 -translate-y-1/2 end-3 z-10 w-9 h-9 rounded-full bg-brand-dark/45 backdrop-blur-sm flex items-center justify-center text-white transition-opacity duration-200 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {/*
        ⚠️ קורא מסך מקבל את תיאור התמונה הנבחרת דרך ה-alt של התמונה
        הראשית (שמשתנה עם הבחירה), ולכן אין כאן aria-live נוסף שהיה
        מכריז פעמיים.
      */}
      {count > 1 && (
        <ul
          className="mt-4 grid grid-cols-5 gap-2 sm:gap-3"
          aria-label={`תמונות של ${productName}`}
        >
          {images.map((src, i) => (
            <li key={src}>
              <button
                type="button"
                onClick={() => show(i)}
                aria-pressed={i === index}
                aria-label={`הצגת תמונה ${i + 1}`}
                className={cn(
                  'relative block w-full aspect-square rounded-2xl overflow-hidden border-2 bg-brand-cream transition-colors cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
                  i === index
                    ? 'border-brand-rose'
                    : 'border-brand-cream-dark/60 hover:border-brand-rose/50',
                )}
              >
                {/* alt ריק: שם הכפתור כבר מתאר את הפעולה, והתמונה כאן
                    דקורטיבית בתוכו — אחרת קורא המסך שומע את שניהם ברצף. */}
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 20vw, 10vw"
                  // אותו עיגון כמו הראשית — אחרת הממוזערת מראה חלק אחר
                  // של התמונה ממה שייפתח בלחיצה.
                  className="object-cover object-top"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
