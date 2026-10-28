'use client'

import { useState } from 'react'
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

/**
 * גלריית תמונות המוצר — תמונה ראשית + בחירה מתוך רצועת ממוזערות.
 *
 * ⚠️ **אינה קרוסלה מתחלפת מעצמה.** ה-ImageSlider של ServiceCard מתקדם
 * לבד כל 3.5 שניות כי הוא ויטרינה; כאן המבקרת בוחנת מוצר, ותמונה שמתחלפת
 * תוך כדי התבוננות היא הפרעה. ההחלפה נעשית רק ביוזמתה.
 *
 * ═══ 🔒 object-contain, ולא object-cover ═══
 *
 * תמונות המוצר אינן באותו יחס: חלקן לרוחב (3:2), חלקן לגובה (2:3) וחלקן
 * ריבועיות. `object-cover` בתוך מסגרת ריבועית היה חותך כשליש מכל תמונה
 * שאינה ריבועית — כלומר חותך את המוצר עצמו, ובתמונות שנושאות טקסט מוטבע
 * גם את הכיתוב. `contain` על רקע קרם מציג כל תמונה בשלמותה.
 *
 * 🔒 **המסגרת הריבועית קבועה (aspect-square) ולכן אין layout shift**:
 * המקום נתפס לפני שהתמונה נטענת, והחלפת תמונה אינה משנה את גובה העמוד
 * גם כשהיחס של הבאה שונה.
 *
 * 🔒 ChevronRight = הקודם ו-ChevronLeft = הבא, בדיוק כמו ב-ServiceCard:
 * באתר RTL החץ ימינה מצביע אחורה. היפוך כאן היה שובר את אחידות הניווט.
 */
export default function ProductGallery({ images, alts, productName, comingSoon }: Props) {
  const [index, setIndex] = useState(0)
  const count = images.length
  const current = images[index] ?? images[0]

  const go = (next: number) => setIndex((next + count) % count)

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
        <Image
          key={current}
          src={current}
          alt={altFor(index)}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-contain"
        />

        {comingSoon && (
          <span className="absolute top-4 end-4 inline-flex items-center gap-1.5 bg-brand-gold text-brand-dark text-xs font-bold px-3 py-1.5 rounded-full tracking-wider z-10">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-dark/70" aria-hidden="true" />
            בקרוב
          </span>
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="תמונה קודמת"
              className="absolute top-1/2 -translate-y-1/2 start-3 z-10 w-9 h-9 rounded-full bg-brand-dark/45 backdrop-blur-sm flex items-center justify-center text-white transition-opacity duration-200 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
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
                onClick={() => setIndex(i)}
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
                  className="object-contain"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
