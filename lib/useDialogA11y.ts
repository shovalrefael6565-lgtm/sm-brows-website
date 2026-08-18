'use client'

import { useEffect, useRef } from 'react'

/**
 * ניהול focus לדיאלוגים מודאליים — תקן ישראלי 5568 / WCAG 2.1 (2.1.2, 2.4.3).
 *
 * ⚠️ עד לשלב הזה כל הדיאלוגים באתר הכריזו `role="dialog" aria-modal="true"`
 * אבל **לא לכדו focus בפועל**. משתמשת מקלדת שפתחה "ביטול תור" יכלה להמשיך
 * ב-Tab אל הניווט ואל הפוטר שמאחורי השכבה, בלי לראות איפה היא נמצאת —
 * ה-overlay מכסה אותם ויזואלית אבל לא מסיר אותם מסדר ה-Tab. הכיוון ההפוך
 * גרוע לא פחות: הדיאלוג נפתח ו-focus נשאר על הכפתור שמאחוריו, כך שקורא מסך
 * לא הכריז את הדיאלוג כלל.
 *
 * ⚠️ ההחזרה ב-unmount חיונית באותה מידה: בלעדיה focus חוזר ל-<body> אחרי
 * סגירה, והמשתמשת מאבדת את מקומה ומתחילה Tab מראש הדף.
 *
 * הלוגיקה כאן זהה לזו שכבר הוכחה ב-ConsentPreferencesModal — היא פשוט
 * הוצאה לשימוש חוזר במקום להיכתב מחדש בכל דיאלוג.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
  )
}

export interface DialogA11yOptions {
  /** האם הדיאלוג פתוח כרגע. כשהוא false ההוק לא עושה דבר. */
  open: boolean
  /** נקרא ב-Escape. אם לא הועבר — Escape לא סוגר. */
  onClose?: () => void
  /** חסימת גלילת הרקע כל עוד הדיאלוג פתוח. */
  lockScroll?: boolean
}

export function useDialogA11y<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  lockScroll = false,
}: DialogA11yOptions) {
  const ref = useRef<T>(null)
  /*
   * ⚠️ ה-ref לפונקציית הסגירה, ולא תלות ישירה ב-effect: onClose מגיע
   * מהרבה קריאות כפונקציה חדשה בכל רינדור. תלות ישירה הייתה מפרקת ומרכיבה
   * את המאזין בכל הקלדה בתוך הדיאלוג — ובדרך גם מאפסת את focus ההתחלתי.
   */
  const onCloseRef = useRef(onClose)
  // ⚠️ סנכרון ב-effect ולא בזמן הרינדור: כתיבה ל-ref במהלך render היא
  // side effect ונחסמת ע"י react-hooks. ה-ref נקרא רק מתוך מטפל אירוע,
  // שרץ הרבה אחרי שה-effects הושלמו — ולכן העדכון כאן תמיד בזמן.
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // focus ראשוני לתוך הדיאלוג — אחרת קורא מסך לא מכריז אותו.
    const initial = focusable(node)[0] ?? node
    if (initial === node && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
    initial.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!onCloseRef.current) return
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable(node)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      /*
       * ⚠️ `!node.contains(active)` נחוץ בנוסף לבדיקות הקצה: אם focus הצליח
       * לברוח (למשל אחרי שהאלמנט שהיה בפוקוס הוסר מה-DOM), Tab היה ממשיך
       * לשוטט מחוץ לדיאלוג ולעולם לא חוזר פנימה.
       */
      if (!node.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    const prevOverflow = lockScroll ? document.body.style.overflow : null
    if (lockScroll) document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (lockScroll) document.body.style.overflow = prevOverflow ?? ''
      // החזרת focus למי שפתח את הדיאלוג. isConnected — האלמנט עשוי כבר
      // לא להיות ב-DOM (כרטיס שנעלם אחרי ביטול), ואז אין למה לחזור.
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [open, lockScroll])

  return ref
}
