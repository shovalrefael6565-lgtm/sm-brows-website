'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Accessibility } from 'lucide-react'
import { cn } from '@/lib/utils'

type A11yOption = {
  id: string
  label: string
  description: string
  cssClass: string
  icon: React.ReactNode
}

const A11Y_OPTIONS: A11yOption[] = [
  {
    id: 'increase-text',
    label: 'הגדלת טקסט',
    description: 'הגדלת גודל הגופן לנוחות קריאה',
    cssClass: 'a11y-increase-text',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
        <text x="2" y="16" fontSize="12" fill="currentColor" stroke="none" fontWeight="bold">A</text>
        <text x="13" y="20" fontSize="16" fill="currentColor" stroke="none" fontWeight="bold">A</text>
      </svg>
    ),
  },
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
  {
    id: 'screen-reader',
    label: 'קריינות מסך',
    description: 'הפעלת תמיכה בקורא מסך (ARIA)',
    cssClass: 'a11y-screen-reader',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
  },
]

const STORAGE_KEY = 'sm-brows-a11y'

export default function AccessibilityWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [active, setActive] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed: Record<string, boolean> = JSON.parse(saved)
        setActive(parsed)
        Object.entries(parsed).forEach(([id, enabled]) => {
          const opt = A11Y_OPTIONS.find((o) => o.id === id)
          if (opt && enabled) {
            document.body.classList.add(opt.cssClass)
          }
        })
      }
    } catch {}
  }, [])

  const toggle = useCallback((option: A11yOption) => {
    setActive((prev) => {
      const next = { ...prev, [option.id]: !prev[option.id] }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {}
      if (next[option.id]) {
        document.body.classList.add(option.cssClass)
      } else {
        document.body.classList.remove(option.cssClass)
      }
      return next
    })
  }, [])

  const resetAll = useCallback(() => {
    A11Y_OPTIONS.forEach((opt) => document.body.classList.remove(opt.cssClass))
    setActive({})
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

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              id="a11y-panel"
              role="dialog"
              aria-label="אפשרויות נגישות"
              aria-modal="true"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="fixed bottom-24 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] max-w-sm bg-white rounded-2xl shadow-soft-lg border border-brand-rose-light overflow-hidden"
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
      </AnimatePresence>
    </>
  )
}
