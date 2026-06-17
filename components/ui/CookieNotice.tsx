'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'

const STORAGE_KEY = 'cookie-notice-accepted'

export default function CookieNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true)
    }
  }, [])

  const accept = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          role="region"
          aria-label="הודעת עוגיות"
          className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4"
        >
          <div className="max-w-3xl mx-auto bg-brand-cream border border-brand-linen rounded-2xl shadow-soft-lg px-5 py-4 flex flex-col sm:flex-row items-center gap-3 sm:gap-6">
            <p className="text-sm text-brand-muted flex-1 text-center sm:text-right leading-relaxed">
              כדי לשפר את חוויית הגלישה ולמדוד את ביצועי האתר, אנו משתמשים בקובצי Cookies.
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <Link
                href="/privacy"
                className="text-sm text-brand-muted underline underline-offset-2 hover:text-brand-dark transition-colors whitespace-nowrap"
              >
                מדיניות פרטיות
              </Link>
              <button
                onClick={accept}
                className="text-sm font-semibold bg-brand-gold text-brand-dark px-5 py-2 rounded-full hover:bg-brand-gold-dark hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 whitespace-nowrap cursor-pointer"
              >
                הבנתי
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
