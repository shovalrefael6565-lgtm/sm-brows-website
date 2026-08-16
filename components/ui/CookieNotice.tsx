'use client'

import { useRef } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useConsent } from '@/lib/consentContext'

/**
 * באנר ההסכמה הראשוני. שלוש הפעולות (אישור הכול / דחייה / התאמה אישית)
 * מוצגות באותה שכבה, באותו גודל כפתור — אין דגש חזותי שדוחף לכיוון "אישור".
 * דחייה אינה חוסמת את השימוש באתר: הבאנר נסגר בדיוק כמו אישור.
 */
export default function CookieNotice() {
  const { ready, bannerOpen, acceptAll, rejectAll, openPreferences } = useConsent()
  const customizeBtnRef = useRef<HTMLButtonElement>(null)

  const visible = ready && bannerOpen

  // 🔒 בלי AnimatePresence: ראה ההערה המפורטת ב-ConsentPreferencesModal.tsx —
  // exit animation לפעמים לא משלים unmount ב-framer-motion 11 + React 19.
  // רינדור מותנה רגיל מבטיח שהבאנר באמת יורד מה-DOM (ולא רק visually) ברגע
  // שההחלטה נשמרת.
  if (!visible) return null

  return (
        <motion.section
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          aria-labelledby="cookie-consent-heading"
          className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4"
        >
          <div className="max-w-3xl mx-auto bg-brand-cream border border-brand-linen rounded-2xl shadow-soft-lg px-5 py-4 flex flex-col gap-4">
            <div>
              <h2 id="cookie-consent-heading" className="sr-only">הסכמה לשימוש בעוגיות</h2>
              <p className="text-sm text-brand-muted text-center sm:text-right leading-relaxed">
                אנחנו משתמשים בעוגיות חיוניות לתפעול האתר, ובעוגיות מדידה ושיווק רק אם תאשרי זאת.
                אפשר לשנות את הבחירה בכל עת דרך{' '}
                <Link href="/privacy" className="underline underline-offset-2 hover:text-brand-dark transition-colors">
                  מדיניות הפרטיות
                </Link>
                {' '}או קישור &quot;הגדרות פרטיות ועוגיות&quot; בפוטר.
              </p>
            </div>
            {/*
              🔒 שלושת הכפתורים באותו גודל, אותו משקל גופן ואותו סגנון מסגרת
              בכוונה — אין כפתור "מודגש" ואין dark pattern שמנווט לכיוון אחד.
            */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={rejectAll}
                className="text-sm font-semibold bg-white border border-brand-dark/30 text-brand-dark px-5 py-2.5 rounded-full hover:bg-brand-linen transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 whitespace-nowrap cursor-pointer"
              >
                דחיית עוגיות לא חיוניות
              </button>
              <button
                ref={customizeBtnRef}
                type="button"
                onClick={() => openPreferences(customizeBtnRef.current)}
                className="text-sm font-semibold bg-white border border-brand-dark/30 text-brand-dark px-5 py-2.5 rounded-full hover:bg-brand-linen transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 whitespace-nowrap cursor-pointer"
              >
                התאמה אישית
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="text-sm font-semibold bg-white border border-brand-dark/30 text-brand-dark px-5 py-2.5 rounded-full hover:bg-brand-linen transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 whitespace-nowrap cursor-pointer"
              >
                אישור הכול
              </button>
            </div>
          </div>
        </motion.section>
  )
}
