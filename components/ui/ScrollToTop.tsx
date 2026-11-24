'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ChevronUp } from 'lucide-react'

/**
 * חזרה לראש הדף.
 * מתחת ל-1440px הכפתור יושב ברצועת המעגן התחתונה (MobileDock), ליד כפתור
 * הנגישות; מעל — עיגול צף מעליו. 44px — יעד לחיצה מינימלי.
 * prefers-reduced-motion: בלי אנימציית כניסה/יציאה.
 *
 * ⚠️ הימנעות מחפיפה (מ-1440px בלבד, שם הכפתור צף מעל התוכן): בעמוד הבית יש
 * טקסט שמגיע עד 47px מקצה המסך, וכפתור של 44px לא יכול להימנע ממנו בשום מיקום.
 * לכן כשיש טקסט ממש מתחת לכפתור — הוא מוסתר זמנית, וחוזר כשהאזור מתפנה.
 * ביצועים: הבדיקה רצה רק כשהגלילה נעצרת (debounce של 120ms), ומשתמשת
 * ב-elementsFromPoint בחמש נקודות בתוך הכפתור — hit-test מקורי של הדפדפן,
 * בלי סריקת DOM. מתחת ל-1440px היא לא רצה בכלל (הכפתור בתוך הרצועה האטומה).
 * 🔒 כפתור בפוקוס לעולם לא מוסתר.
 */

const WIDE = '(min-width: 1440px)'

/** האם יש שורת טקסט גלויה מתחת למלבן הכפתור (מלבד הכפתור עצמו) */
function textUnder(btn: HTMLElement): boolean {
  const b = btn.getBoundingClientRect()
  const inset = 6
  const points: [number, number][] = [
    [b.left + b.width / 2, b.top + b.height / 2],
    [b.left + inset, b.top + inset],
    [b.right - inset, b.top + inset],
    [b.left + inset, b.bottom - inset],
    [b.right - inset, b.bottom - inset],
  ]
  const seen = new Set<Element>()
  for (const [x, y] of points) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === btn || btn.contains(el) || seen.has(el)) continue
      seen.add(el)
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const r of range.getClientRects()) {
          if (r.left < b.right - 2 && r.right > b.left + 2 && r.top < b.bottom - 2 && r.bottom > b.top + 2) return true
        }
      }
    }
  }
  return false
}

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false)
  const [overText, setOverText] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const wide = window.matchMedia(WIDE)
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      const btn = ref.current
      if (!btn || !wide.matches) { setOverText(false); return }
      setOverText(textUnder(btn))
    }
    const onScroll = () => {
      setVisible(window.scrollY > 400)
      if (!wide.matches) return
      clearTimeout(timer)
      timer = setTimeout(check, 120)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    wide.addEventListener('change', check)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
      wide.removeEventListener('change', check)
    }
  }, [])

  const scrollUp = () => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  const hidden = overText && !focused

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          ref={ref}
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 16 }}
          transition={{ duration: reduce ? 0 : 0.25 }}
          onClick={scrollUp}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="חזרה לראש הדף"
          /* ring-1 בזהב: קו מתאר עדין שמפריד את הכפתור הכהה מתמונות כהות. */
          className={`${hidden ? 'invisible ' : ''}fixed bottom-[calc(0.625rem+env(safe-area-inset-bottom))] right-[4.75rem] min-[1440px]:bottom-24 min-[1440px]:right-8 z-40 w-11 h-11 rounded-full bg-brand-dark/80 backdrop-blur-sm text-white shadow-soft ring-1 ring-brand-gold/70 flex items-center justify-center hover:bg-brand-dark transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold`}
        >
          <ChevronUp className="w-5 h-5" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
