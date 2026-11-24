'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { WHATSAPP_URL, COURSE_WHATSAPP_URL } from '@/lib/utils'

/*
  בעמוד הקורס הכפתור הצף פותח שיחה על הקורס, ובכל שאר האתר — על קביעת תור.
  ⚠️ השוואה מדויקת ל-'/course' בלבד, בכוונה: אין תת-נתיבים לקורס, ו-startsWith
  היה תופס גם נתיב עתידי כמו '/courses-…' בלי שהתכוונו.
  מעקב הקליקים לא נוגע כאן: WhatsAppTracker מאזין לכל קישור wa.me בעמוד,
  בכפוף להסכמה, כך שהכפתור נמדד בדיוק כמו קודם ופעם אחת.
*/
const COURSE_PATH = '/course'

/*
  בעמוד הקורס בלבד: כשכפתור וואטסאפ אחר (ב-Hero, בסוף התוכנית, בסיום או בפוטר)
  נראה על המסך, הכפתור הצף מוסתר — אין צורך בשניים, והוא לא מתחרה בתוכן.
  ⚠️ visibility:hidden (ולא הסרה מה-DOM): אין קפיצת עימוד, והכפתור המוסתר יוצא
  אוטומטית מסדר הטאב ומעץ הנגישות. כפתור שנמצא בפוקוס לעולם לא מוסתר.
  rootMargin התחתון מנכה את רצועת המעגן, כדי שקישור שמתחתיה לא ייחשב "נראה".
*/
function useOtherWhatsAppVisible(enabled: boolean, self: React.RefObject<HTMLAnchorElement | null>) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return
    const shown = new Set<Element>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) shown.add(e.target)
          else shown.delete(e.target)
        }
        setVisible(shown.size > 0)
      },
      { threshold: [0, 0.6, 1], rootMargin: '0px 0px -80px 0px' },
    )
    document.querySelectorAll<HTMLAnchorElement>('a[href*="wa.me"]').forEach((a) => {
      if (a !== self.current) io.observe(a)
    })
    return () => io.disconnect()
  }, [enabled, self])
  return enabled && visible
}

export default function WhatsAppButton() {
  const isCourse = usePathname() === COURSE_PATH
  const reduce = useReducedMotion()
  const ref = useRef<HTMLAnchorElement>(null)
  const [focused, setFocused] = useState(false)
  const otherVisible = useOtherWhatsAppVisible(isCourse, ref)
  const hidden = otherVisible && !focused

  return (
    <motion.a
      ref={ref}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      href={isCourse ? COURSE_WHATSAPP_URL : WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={
        isCourse
          ? 'פתיחת שיחת וואטסאפ לקבלת פרטים על קורס עיצוב גבות טבעיות'
          : 'פתיחת שיחת וואצאפ עם S.M BROWS לקביעת תור'
      }
      initial={reduce ? false : { scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={reduce ? { duration: 0 } : { delay: 1.5, type: 'spring', stiffness: 200, damping: 20 }}
      whileHover={reduce ? undefined : { scale: 1.1 }}
      whileTap={reduce ? undefined : { scale: 0.95 }}
      /* מתחת ל-1440px: בתוך רצועת המעגן (MobileDock); מעל — עיגול צף בפינה. */
      className={`${hidden ? 'invisible ' : ''}fixed bottom-[calc(0.5rem+env(safe-area-inset-bottom))] left-4 min-[1440px]:bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))] min-[1440px]:left-6 z-40 flex items-center justify-center w-12 h-12 min-[1440px]:w-14 min-[1440px]:h-14 bg-brand-whatsapp-dark text-white rounded-full shadow-lg hover:shadow-xl transition-shadow cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-whatsapp-dark focus-visible:ring-offset-2`}
    >
      <span className="sr-only">{isCourse ? 'וואטסאפ – פרטים על הקורס' : 'וואצאפ – קבעי תור'}</span>
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-6 h-6 min-[1440px]:w-7 min-[1440px]:h-7"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>

      {/* Pulse ring */}
      <span
        className="absolute inset-0 rounded-full bg-[#25D366] motion-safe:animate-ping opacity-20"
        aria-hidden="true"
      />
    </motion.a>
  )
}
