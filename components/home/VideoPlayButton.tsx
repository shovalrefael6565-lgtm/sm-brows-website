'use client'

import { Play } from 'lucide-react'

interface Props {
  onClick: () => void
  /** מה מופעל — נכנס ל-aria-label כדי שכל כפתור בעמוד יהיה מובחן */
  label: string
  /**
   * 'center' — הכפתור באמצע הסרטון (כשאין מעליו שום תוכן).
   * 'corner' — פינה עליונה, לסרטון שיש מעליו כותרת/כפתורים בתחתית.
   */
  placement?: 'center' | 'corner'
  className?: string
}

/**
 * כפתור ההפעלה של סרטוני הרקע בעמוד הבית.
 *
 * הסרטונים האלה מושתקים ורצים בלולאה — הם אווירה, לא תוכן — ולכן
 * הכפתור מכוון להיות נוכח אבל לא לגנוב את הסקשן: עיגול לבן קטן בשפה
 * של הנגן בעמוד הקורס, בלי הכהיית הרקע ובלי כיתוב.
 *
 * ⚠️ ה-placement אינו העדפה עיצובית אלא אילוץ: בסקשן הטיפולים יושבים
 * על הסרטון שם הטיפול ושני ה-CTA, וכפתור שפרוס על כל השטח היה חוסם
 * אותם. שם 'corner', ובטיזר — שאין מעליו כלום — 'center'.
 */
export default function VideoPlayButton({
  onClick,
  label,
  placement = 'center',
  className = '',
}: Props) {
  const position =
    placement === 'center'
      ? 'inset-0 flex items-center justify-center'
      : 'top-4 start-4 sm:top-5 sm:start-5'

  return (
    <div className={`absolute ${position} z-20 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="group relative flex items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-gold transition-transform duration-300 ease-out hover:scale-107 hover:bg-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 w-14 h-14 sm:w-16 sm:h-16"
      >
        <span
          aria-hidden="true"
          className="absolute -inset-[5px] rounded-full border border-white/45"
        />
        <Play
          className="w-5 h-5 sm:w-6 sm:h-6 text-brand-dark translate-x-[2px]"
          fill="currentColor"
          strokeWidth={0}
        />
      </button>
    </div>
  )
}
