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
          className="fixed bottom-0 inset-x-0 z-50 max-[1440px]:bottom-[var(--dock-h)] p-2 sm:p-4 pointer-events-none"
        >
          <div className="pointer-events-auto max-w-3xl mx-auto bg-brand-cream border border-brand-linen rounded-2xl shadow-soft-lg px-3.5 py-3 gap-2.5 sm:px-5 sm:py-4 flex flex-col sm:gap-4">
            <div>
              <h2 id="cookie-consent-heading" className="sr-only">הסכמה לשימוש בעוגיות</h2>
              <p className="text-sm max-sm:text-[13.5px] max-sm:leading-[1.55] text-brand-muted text-right leading-relaxed">
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
            {/*
              📱 במובייל (מתחת ל-640px): שלושת הכפתורים זה לצד זה בשלוש עמודות שוות
              (grid-cols-3) — אותו טקסט, אותו גודל ואותו סגנון לכולם, כך שהשוויון
              נשמר והבאנר נמוך בכ-120px. ב-640px ומעלה — בדיוק כמו קודם.
            */}
            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-row items-stretch sm:items-center justify-center sm:gap-2.5">
              <button
                type="button"
                onClick={rejectAll}
                className="text-sm max-sm:text-[13px] max-sm:leading-tight font-semibold bg-white border border-brand-dark/30 text-brand-dark px-5 py-2.5 max-sm:px-2 max-sm:py-1.5 max-sm:min-h-11 rounded-full hover:bg-brand-linen transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 whitespace-nowrap max-sm:whitespace-normal cursor-pointer"
              >
                דחיית עוגיות לא חיוניות
              </button>
              <button
                ref={customizeBtnRef}
                type="button"
                onClick={() => openPreferences(customizeBtnRef.current)}
                className="text-sm max-sm:text-[13px] max-sm:leading-tight font-semibold bg-white border border-brand-dark/30 text-brand-dark px-5 py-2.5 max-sm:px-2 max-sm:py-1.5 max-sm:min-h-11 rounded-full hover:bg-brand-linen transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 whitespace-nowrap max-sm:whitespace-normal cursor-pointer"
              >
                התאמה אישית
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="text-sm max-sm:text-[13px] max-sm:leading-tight font-semibold bg-white border border-brand-dark/30 text-brand-dark px-5 py-2.5 max-sm:px-2 max-sm:py-1.5 max-sm:min-h-11 rounded-full hover:bg-brand-linen transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 whitespace-nowrap max-sm:whitespace-normal cursor-pointer"
              >
                אישור הכול
              </button>
            </div>
          </div>
        </motion.section>
  )
}
