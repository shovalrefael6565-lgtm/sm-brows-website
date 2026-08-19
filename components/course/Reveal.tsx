'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** השהיה קלה כדי ליצור מדרגה בין אלמנטים סמוכים (במילישניות) */
  delay?: number
  className?: string
}

/**
 * חשיפה עדינה בגלילה — IntersectionObserver + CSS בלבד.
 *
 * ⚠️ בכוונה לא framer-motion: העמוד הזה כולו Server Components, וה-children
 * מגיעים מהשרת. עטיפה קלה כזו שומרת על כך שרק ה-wrapper עצמו הוא קוד לקוח
 * (כמה עשרות בתים) במקום להפוך את כל תוכן הקורס ל-client bundle.
 *
 * `prefers-reduced-motion` מטופל ב-CSS (app/globals.css) שמאפס את ה-transition.
 */
export default function Reveal({ children, delay = 0, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    /*
     * דפדפן בלי IntersectionObserver — פשוט מציגים.
     * ⚠️ דרך ה-DOM ולא דרך setState: קריאת setState סינכרונית בתוך effect
     * מפעילה רינדור מדורג (ו-eslint חוסם אותה), ואין כאן מה לרנדר מחדש —
     * המחלקה היא כל מה שמשתנה.
     */
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('reveal-in')
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -60px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`reveal${shown ? ' reveal-in' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  )
}
