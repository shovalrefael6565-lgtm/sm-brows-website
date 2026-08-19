'use client'

import { useState, useEffect, useCallback } from 'react'
import { useDialogA11y } from '@/lib/useDialogA11y'
import { motion } from 'framer-motion'
import { X, Accessibility, Minus, Plus, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

type A11yOption = {
  id: string
  label: string
  description: string
  cssClass: string
  icon: React.ReactNode
}

/*
 * 🔴 גודל הטקסט אינו מתג — הוא סקאלה.
 *
 * ⚠️ הגרסה הקודמת הייתה מתג יחיד "הגדלת טקסט" שהוסיף מחלקה עם
 * `body { font-size: 120% }`. כל גדלי הטקסט באתר הם rem (Tailwind),
 * כלומר יחסיים ל-<html> — ולכן המתג לא הגדיל שום דבר. אומת: body עבר
 * ל-19.2px וכל אלמנט טקסט בפועל נשאר בדיוק כשהיה.
 *
 * ⚠️ 150% הוא הגג. מעליו מתחילה גלישה אופקית ב-360px, וזו בדיוק
 * התקלה שהגדלת טקסט אמורה למנוע ולא ליצור.
 */
const TEXT_SCALES = [1, 1.15, 1.3, 1.5] as const
const DEFAULT_SCALE_INDEX = 0

const A11Y_OPTIONS: A11yOption[] = [
  {
    id: 'high-contrast',
    label: 'ניגודיות גבוהה',
    description: 'הגברת הניגודיות לראייה טובה יותר',
    cssClass: 'a11y-high-contrast',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'grayscale',
    label: 'גווני אפור',
    description: 'הצגת האתר בגוני אפור',
    cssClass: 'a11y-grayscale',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 0 20" stroke="none" fill="currentColor" opacity="0.4" />
        <path d="M12 7a5 5 0 0 1 0 10" stroke="none" fill="currentColor" opacity="0.8" />
      </svg>
    ),
  },
  {
    id: 'highlight-links',
    label: 'הדגשת קישורים',
    description: 'הדגשת כל הקישורים בדף',
    cssClass: 'a11y-highlight-links',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        <line x1="5" y1="21" x2="19" y2="21" strokeWidth="3" />
      </svg>
    ),
  },
  {
    id: 'stop-animations',
    label: 'עצירת אנימציות',
    description: 'ביטול כל האנימציות בדף',
    cssClass: 'a11y-stop-animations',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
        <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
        <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  /*
   * ⚠️ המתג "קריינות מסך" הוסר. הוא הוסיף לגוף המסמך את המחלקה
   * `a11y-screen-reader` — מחלקה שאין לה שום כלל ב-app/globals.css ואף
   * קוד אינו קורא אותה. כלומר הוא נדלק, נשמר ב-localStorage, ולא עשה
   * דבר, תוך שהוא מבטיח "הפעלת תמיכה בקורא מסך (ARIA)". תמיכת ה-ARIA
   * באתר פעילה תמיד ואינה ניתנת להפעלה מהדפדפן; מתג ריק שמבטיח אותה
   * מטעה בדיוק את המשתמשות שהווידג'ט נועד לשרת.
   */
]

const STORAGE_KEY = 'sm-brows-a11y'

/*
 * 🔴 המחלקות מוחלות על <html> ולא על <body>.
 *
 * ⚠️ `filter` על אלמנט הופך אותו ל-containing block עבור כל צאצא
 * `position: fixed`. כשהמחלקות ישבו על <body>, "ניגודיות גבוהה" או
 * "גווני אפור" ניתקו את כל האלמנטים ה-fixed מה-viewport — כולל כפתור
 * הנגישות עצמו, שקפץ אל מחוץ למסך. כלומר המשתמשת הפעילה מצב נגישות
 * ואיבדה את היכולת לכבות אותו. הפירוט המלא ב-app/globals.css.
 */
const root = () => document.documentElement

function applyScale(scale: number) {
  // ⚠️ setProperty ולא style.fontSize: הכלל ב-globals.css הוא
  // `font-size: calc(100% * var(--a11y-text-scale, 1))`, כדי שהעדפת
  // גודל הגופן של המשתמשת בדפדפן תישמר ותוכפל, ולא תידרס בערך קבוע.
  if (scale === 1) root().style.removeProperty('--a11y-text-scale')
  else root().style.setProperty('--a11y-text-scale', String(scale))
}

export default function AccessibilityWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [active, setActive] = useState<Record<string, boolean>>({})
  const [scaleIndex, setScaleIndex] = useState(DEFAULT_SCALE_INDEX)

  /*
   * ⚠️ הפאנל הכריז aria-modal="true" בלי לממש דבר מזה: Escape לא סגר אותו,
   * Tab יצא ממנו אל הדף שמאחוריו, ואחרי סגירה focus נזרק ל-<body>. דווקא
   * בווידג'ט הנגישות זו התקלה הכואבת ביותר — הוא הכלי הראשון שמשתמשת
   * מקלדת מגיעה אליו.
   */
  const panelRef = useDialogA11y<HTMLDivElement>({
    open: isOpen,
    onClose: () => setIsOpen(false),
  })

  // קריאת localStorage חייבת לקרות אחרי mount (לא ב-lazy initializer של
  // useState): הקוד הזה רץ גם ב-SSR, ו-localStorage אינו קיים שם — קריאה
  // אליו מחוץ ל-effect הייתה קורסת ברינדור השרת.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const parsed = JSON.parse(saved) as Record<string, boolean | number>

      const toggles: Record<string, boolean> = {}
      A11Y_OPTIONS.forEach((opt) => {
        if (parsed[opt.id] === true) {
          toggles[opt.id] = true
          root().classList.add(opt.cssClass)
        }
      })
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive(toggles)

      /*
       * ⚠️ הגירה מהמצב השמור הישן: עד כה גודל הטקסט נשמר כמתג בוליאני
       * בשם `increase-text`. מי שהדליקה אותו בעבר (וקיבלה 0 שינוי בפועל,
       * כי הכלל ישב על body) תקבל עכשיו את הרמה הראשונה במקום שהערך
       * השמור יידחה בשקט.
       */
      const savedIndex = typeof parsed['text-scale'] === 'number'
        ? (parsed['text-scale'] as number)
        : parsed['increase-text'] === true ? 1 : DEFAULT_SCALE_INDEX
      const clamped = Math.min(Math.max(savedIndex, 0), TEXT_SCALES.length - 1)
      if (clamped !== DEFAULT_SCALE_INDEX) {
        setScaleIndex(clamped)
        applyScale(TEXT_SCALES[clamped])
      }
    } catch {}
  }, [])

  /** שמירה אחת ואחידה — המתגים והסקאלה חיים באותה רשומה. */
  const persist = useCallback((toggles: Record<string, boolean>, index: number) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...toggles, 'text-scale': index }))
    } catch {}
  }, [])

  const toggle = useCallback((option: A11yOption) => {
    setActive((prev) => {
      const next = { ...prev, [option.id]: !prev[option.id] }
      if (next[option.id]) root().classList.add(option.cssClass)
      else root().classList.remove(option.cssClass)
      setScaleIndex((i) => { persist(next, i); return i })
      return next
    })
  }, [persist])

  const setScale = useCallback((index: number) => {
    const clamped = Math.min(Math.max(index, 0), TEXT_SCALES.length - 1)
    setScaleIndex(clamped)
    applyScale(TEXT_SCALES[clamped])
    setActive((cur) => { persist(cur, clamped); return cur })
  }, [persist])

  const resetAll = useCallback(() => {
    A11Y_OPTIONS.forEach((opt) => root().classList.remove(opt.cssClass))
    applyScale(TEXT_SCALES[DEFAULT_SCALE_INDEX])
    setActive({})
    setScaleIndex(DEFAULT_SCALE_INDEX)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [])

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="פתיחת תפריט נגישות"
        aria-expanded={isOpen}
        aria-controls="a11y-panel"
        className="fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 bg-brand-dark text-white rounded-full shadow-lg hover:bg-brand-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
        title="נגישות – תקן ישראלי 5568"
      >
        <Accessibility className="w-6 h-6" aria-hidden="true" />
      </button>

      {/*
        🔴 בלי AnimatePresence — באג פרודקשן אמיתי, אומת ב-hit-test.

        ⚠️ exit animation של framer-motion 11 עם React 19 לא תמיד משלים
        unmount. הפאנל נשאר ב-DOM עם opacity:0 אבל pointer-events:auto
        ו-visibility:visible, יחד עם ה-overlay שלו (fixed inset-0).
        התוצאה: אחרי פתיחה־וסגירה **אחת** של תפריט הנגישות, כל לחיצה
        באזור של ~365×460 פיקסלים בפינה התחתונה נבלעה ע"י פאנל בלתי נראה,
        בכל עמוד באתר — הווידג'ט גלובלי. אומת: elementFromPoint(1100,700)
        החזיר כפתור מתוך הפאנל הסגור במקום את תוכן העמוד.

        ⚠️ בנוסף, אלמנט תקוע עם role="dialog" aria-modal="true" נשאר חשוף
        לקורא מסך כדיאלוג פתוח — כלומר דווקא תפריט הנגישות היה זה שפגע
        בנגישות של כל שאר הדף.

        ⚠️ ההחלטה הזו כבר התקבלה במקום אחר במערכת מאותה סיבה בדיוק:
        components/ui/ConsentPreferencesModal.tsx מתעד את אותו כשל.
        רינדור מותנה רגיל מסיר את האלמנט מיידית ואמין; אנימציית הכניסה
        (initial/animate) ממשיכה לעבוד, רק בלי exit.
      */}
      {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              ref={panelRef}
              id="a11y-panel"
              role="dialog"
              aria-label="אפשרויות נגישות"
              aria-modal="true"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              /*
                ⚠️ max-h + overflow-y-auto: הפאנל עצמו מודד ב-rem, ולכן הוא
                גדל יחד עם סקאלת הטקסט. ב-150% על מסך נמוך הוא היה חורג
                מגובה ה-viewport, וכפתור "איפוס כל ההגדרות" שבתחתיתו היה
                יוצא מהמסך בלי דרך להגיע אליו — כלומר בדיוק אותו מלכוד
                שהתיקון הזה נועד לסגור.
              */
              className="fixed bottom-24 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] max-w-sm max-h-[calc(100dvh-8rem)] overflow-y-auto bg-white rounded-2xl shadow-soft-lg border border-brand-rose-light"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 bg-brand-cream border-b border-brand-rose-light">
                <div>
                  <h2 className="font-semibold text-brand-dark text-base">הגדרות נגישות</h2>
                  <p className="text-xs text-brand-muted mt-0.5">תקן ישראלי 5568</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="סגירת תפריט נגישות"
                  className="p-1.5 rounded-lg text-brand-medium hover:bg-brand-rose-light transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {/*
                גודל טקסט — פקד סקאלה, לא מתג.

                ⚠️ ה-aria-live מכריז את הרמה החדשה: משתמשת קורא מסך לא
                "רואה" שהטקסט גדל, ובלי הכרזה הלחיצה על + הייתה חסרת משוב.
                ⚠️ הכפתורים 40×40 — הרבה מעל מינימום 24×24, כי זה בדיוק
                הפקד שמשתמשות עם קושי מוטורי או ראייתי ילחצו עליו.
              */}
              <div className="px-3 pt-3">
                <div className="rounded-xl border border-brand-cream-dark bg-brand-cream/50 px-3 py-3">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="text-sm font-medium text-brand-dark">גודל טקסט</span>
                    <span className="text-xs font-semibold text-brand-muted tabular-nums">
                      {Math.round(TEXT_SCALES[scaleIndex] * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setScale(scaleIndex - 1)}
                      disabled={scaleIndex === 0}
                      aria-label="הקטנת גודל הטקסט"
                      className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-brand-linen-dark bg-white text-brand-dark hover:bg-brand-linen disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                    >
                      <Minus className="w-4 h-4" aria-hidden="true" />
                    </button>

                    {/* מד רמות ויזואלי — קישוט בלבד, הערך מוכרז בטקסט למטה */}
                    <div className="flex-1 flex items-center gap-1" aria-hidden="true">
                      {TEXT_SCALES.map((_, i) => (
                        <span
                          key={i}
                          className={cn(
                            'h-1.5 flex-1 rounded-full transition-colors duration-200',
                            i <= scaleIndex ? 'bg-brand-rose' : 'bg-brand-linen-dark'
                          )}
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setScale(scaleIndex + 1)}
                      disabled={scaleIndex === TEXT_SCALES.length - 1}
                      aria-label="הגדלת גודל הטקסט"
                      className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-brand-linen-dark bg-white text-brand-dark hover:bg-brand-linen disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setScale(DEFAULT_SCALE_INDEX)}
                      disabled={scaleIndex === DEFAULT_SCALE_INDEX}
                      aria-label="החזרת גודל הטקסט לברירת המחדל"
                      className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-brand-linen-dark bg-white text-brand-muted hover:bg-brand-linen hover:text-brand-dark disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                    >
                      <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                  <p className="sr-only" aria-live="polite" aria-atomic="true">
                    {`גודל הטקסט: ${Math.round(TEXT_SCALES[scaleIndex] * 100)} אחוז`}
                  </p>
                </div>
              </div>

              {/* Options */}
              <ul className="p-3 space-y-1" role="list">
                {A11Y_OPTIONS.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!active[option.id]}
                      aria-label={option.label}
                      onClick={() => toggle(option)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 cursor-pointer text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                        active[option.id]
                          ? 'bg-brand-rose-bg border border-brand-rose/30 text-brand-rose'
                          : 'hover:bg-brand-cream text-brand-dark border border-transparent'
                      )}
                    >
                      <span
                        className={cn(
                          'flex-shrink-0 transition-colors',
                          active[option.id] ? 'text-brand-rose' : 'text-brand-muted'
                        )}
                        aria-hidden="true"
                      >
                        {option.icon}
                      </span>
                      <div className="flex-1 min-w-0 text-start">
                        <span className="block text-sm font-medium leading-snug">{option.label}</span>
                        <span className="block text-xs text-brand-muted leading-snug mt-0.5">
                          {option.description}
                        </span>
                      </div>
                      <span
                        className={cn(
                          'flex-shrink-0 w-10 h-5 rounded-full transition-colors duration-200 relative',
                          active[option.id] ? 'bg-brand-rose' : 'bg-brand-rose-light'
                        )}
                        aria-hidden="true"
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200',
                            active[option.id] ? 'left-5' : 'left-0.5'
                          )}
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {/* Reset */}
              <div className="px-3 pb-3">
                <button
                  type="button"
                  onClick={resetAll}
                  aria-label="איפוס כל הגדרות הנגישות"
                  className="w-full py-2 text-sm text-brand-muted hover:text-brand-dark transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded-lg"
                >
                  איפוס כל ההגדרות
                </button>
              </div>
            </motion.div>
          </>
        )}
    </>
  )
}
