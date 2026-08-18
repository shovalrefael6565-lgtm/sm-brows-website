'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useConsent } from '@/lib/consentContext'

type CategoryId = 'essential' | 'analytics' | 'marketing'

interface Category {
  id: CategoryId
  title: string
  description: string
  sharedWith: string
  locked: boolean
}

const CATEGORIES: Category[] = [
  {
    id: 'essential',
    title: 'עוגיות חיוניות',
    description: 'נדרשות לתפעול הבסיסי של האתר — למשל שמירת הבחירה שלך לגבי עוגיות. אי אפשר לכבות אותן, והן לא כוללות מדידה או שיווק.',
    sharedWith: 'לא מועבר לגורם חיצוני',
    locked: true,
  },
  {
    id: 'analytics',
    title: 'מדידה וניתוח (Analytics)',
    description: 'עוזרות לנו להבין כמה מבקרות יש באתר ואילו עמודים נצפים, כדי לשפר את החוויה. פעילות רק אם תאשרי.',
    sharedWith: 'המידע מועבר ל-Google (Google Analytics)',
    locked: false,
  },
  {
    id: 'marketing',
    title: 'שיווק',
    description: 'משמשות למדידת אפקטיביות של פרסום ברשתות. פעילות רק אם תאשרי.',
    sharedWith: 'המידע מועבר ל-Meta (פייסבוק / אינסטגרם)',
    locked: false,
  },
]

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export default function ConsentPreferencesModal() {
  const { ready, preferencesOpen, closePreferences, analytics, marketing, acceptAll, rejectAll, savePreferences } = useConsent()
  const [draftAnalytics, setDraftAnalytics] = useState(analytics)
  const [draftMarketing, setDraftMarketing] = useState(marketing)
  const dialogRef = useRef<HTMLDivElement>(null)

  const visible = ready && preferencesOpen

  // בכל פתיחה, ה-draft מתחיל מהמצב השמור בפועל — לא מדגמנים "כבר מסומן".
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- מתאפס בכוונה בכל פתיחה, כדי לשקף את המצב השמור בפועל ולא ערך מיושן.
      setDraftAnalytics(analytics)
      setDraftMarketing(marketing)
    }
  }, [visible, analytics, marketing])

  // focus management: focus ראשוני לתוך הדיאלוג, Escape סוגר, Tab/Shift+Tab לכודים בפנים.
  useEffect(() => {
    if (!visible) return
    const dialog = dialogRef.current
    const opener = document.activeElement as HTMLElement | null
    const firstFocusable = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    firstFocusable?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePreferences()
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      /*
       * ⚠️ החזרת focus למי שפתח את החלון. בלעדיה focus נפל ל-<body> אחרי
       * הסגירה, ומשתמשת שפתחה את ההעדפות מקישור הפוטר נזרקה לראש הדף
       * וצריכה לעבור שוב בכל האתר ב-Tab (WCAG 2.4.3 — Focus Order).
       */
      if (opener && opener.isConnected) opener.focus()
    }
  }, [visible, closePreferences])

  if (!visible) return null

  return (
    <>
      {/*
        🔒 בלי AnimatePresence: exit animation של framer-motion 11 +
        React 19 לפעמים לא משלים unmount (נבדק ושוחזר גם ב-AccessibilityWidget
        הקיים, לא קשור לקוד הזה) — ומכולת ה-modal הזו מכסה את כל המסך
        (fixed inset-0), אז אלמנט "תקוע" עם opacity:0 היה חוסם קליקים בכל
        האתר. רינדור מותנה רגיל מסיר את האלמנט מה-DOM באופן מיידי ואמין;
        האנימציה (initial/animate) עדיין רצה בכניסה, רק בלי exit.
      */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-brand-dark/50 backdrop-blur-sm z-[60]"
        onClick={closePreferences}
        aria-hidden="true"
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-prefs-heading"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="fixed inset-0 z-[61] flex items-end sm:items-center justify-center p-0 sm:p-4"
        dir="rtl"
      >
            <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-soft-lg max-h-[90vh] flex flex-col">
              <div className="border-b border-brand-linen-dark px-5 py-4 flex items-center justify-between gap-3 shrink-0">
                <h2 id="consent-prefs-heading" className="font-serif text-lg font-bold text-brand-dark">
                  הגדרות פרטיות ועוגיות
                </h2>
                <button
                  type="button"
                  onClick={closePreferences}
                  aria-label="סגירת חלון ההעדפות"
                  className="p-1.5 -m-1.5 text-brand-muted hover:text-brand-dark cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4 overflow-y-auto">
                <p className="text-sm text-brand-muted leading-relaxed">
                  אפשר לבחור בדיוק אילו עוגיות לאשר. עוגיות חיוניות תמיד פעילות. אפשר לשנות את הבחירה בכל עת מקישור
                  &quot;הגדרות פרטיות ועוגיות&quot; בפוטר, ולקרוא עוד ב
                  <Link href="/privacy" className="underline underline-offset-2 hover:text-brand-dark transition-colors"> מדיניות הפרטיות</Link>.
                </p>

                {CATEGORIES.map((cat) => {
                  const checked = cat.id === 'essential' ? true : cat.id === 'analytics' ? draftAnalytics : draftMarketing
                  const onToggle = () => {
                    if (cat.locked) return
                    if (cat.id === 'analytics') setDraftAnalytics((v) => !v)
                    if (cat.id === 'marketing') setDraftMarketing((v) => !v)
                  }
                  return (
                    <div key={cat.id} className="bg-brand-cream/60 border border-brand-cream-dark rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-brand-dark text-sm">{cat.title}</p>
                          <p className="text-xs text-brand-medium leading-relaxed mt-1">{cat.description}</p>
                          <p className="text-xs text-brand-muted leading-relaxed mt-1.5">{cat.sharedWith}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-label={cat.locked ? `${cat.title} — פעיל תמיד` : cat.title}
                          disabled={cat.locked}
                          onClick={onToggle}
                          className={cn(
                            'flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
                            cat.locked ? 'bg-brand-dark/40 cursor-not-allowed' : checked ? 'bg-brand-gold cursor-pointer' : 'bg-brand-linen-dark cursor-pointer'
                          )}
                        >
                          <span
                            className={cn(
                              'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200',
                              checked ? 'left-[1.375rem]' : 'left-0.5'
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="border-t border-brand-linen-dark px-5 py-4 flex flex-col gap-2.5 shrink-0">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="button"
                    onClick={rejectAll}
                    className="flex-1 text-sm font-semibold bg-white border border-brand-dark/30 text-brand-dark px-4 py-2.5 rounded-full hover:bg-brand-linen transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold cursor-pointer"
                  >
                    דחיית הכול
                  </button>
                  <button
                    type="button"
                    onClick={acceptAll}
                    className="flex-1 text-sm font-semibold bg-white border border-brand-dark/30 text-brand-dark px-4 py-2.5 rounded-full hover:bg-brand-linen transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold cursor-pointer"
                  >
                    אישור הכול
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => savePreferences({ analytics: draftAnalytics, marketing: draftMarketing })}
                  className="w-full text-sm font-semibold bg-brand-gold text-brand-dark px-4 py-2.5 rounded-full hover:bg-brand-gold-dark hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold cursor-pointer"
                >
                  שמירת ההעדפות שלי
                </button>
              </div>
            </div>
      </motion.div>
    </>
  )
}
