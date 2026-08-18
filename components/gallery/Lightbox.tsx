'use client'

import { useEffect, useCallback } from 'react'
import { useDialogA11y } from '@/lib/useDialogA11y'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'

interface LightboxImage {
  src: string
  alt: string
  caption?: string
}

interface Props {
  images: LightboxImage[]
  currentIndex: number | null
  onClose: () => void
  onNext: () => void
  onPrev: () => void
}

export default function Lightbox({ images, currentIndex, onClose, onNext, onPrev }: Props) {
  const isOpen = currentIndex !== null
  const current = currentIndex !== null ? images[currentIndex] : null

  /*
   * ⚠️ ה-ESC כאן כבר טופל ב-handleKey למטה, ולכן ההוק מקבל onClose=undefined:
   * שני מטפלים היו קוראים ל-onClose פעמיים. מה שההוק מוסיף זה מה שחסר —
   * לכידת Tab בתוך הלייטבוקס והחזרת focus לתמונה הממוזערת שנפתחה ממנה.
   * נעילת הגלילה נשארת ב-effect הקיים שכבר עושה בדיוק את זה.
   */
  const dialogRef = useDialogA11y<HTMLDivElement>({ open: isOpen })

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onNext()
      if (e.key === 'ArrowRight') onPrev()
    },
    [isOpen, onClose, onNext, onPrev]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  return (
    /*
      ⚠️ בלי AnimatePresence, מאותה סיבה שמתועדת ב-ConsentPreferencesModal,
      ב-AccessibilityWidget וב-BeforeAfterSection: exit animation של
      framer-motion 11 עם React 19 לא תמיד משלים unmount, והשכבה הזו היא
      `fixed inset-0 z-[100]` — כלומר אלמנט תקוע היה בולע כל לחיצה בדף.
      (הרכיב הזה אינו מחווט כרגע לאף עמוד, אבל אין טעם להשאיר בו את הדפוס
      שכבר הפיל שלושה מקומות אחרים.)
    */
    <>
      {isOpen && current && (
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`תמונה מוגדלת: ${current.alt}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4"
          onClick={onClose}
        >
          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירת תמונה מוגדלת"
            className="absolute top-4 end-4 z-10 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="w-6 h-6" aria-hidden="true" />
          </button>

          {/* Prev */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPrev() }}
            aria-label="תמונה קודמת"
            className="absolute end-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronRight className="w-6 h-6" aria-hidden="true" />
          </button>

          {/* Next */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNext() }}
            aria-label="תמונה הבאה"
            className="absolute start-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronLeft className="w-6 h-6" aria-hidden="true" />
          </button>

          {/* Image */}
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="relative max-w-4xl max-h-[85vh] w-full aspect-[4/3]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={current.src}
              alt={current.alt}
              fill
              sizes="(max-width: 1024px) 100vw, 896px"
              className="object-contain"
              priority
            />
            {current.caption && (
              <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-sm text-center py-3 px-4 rounded-b-lg backdrop-blur-sm">
                {current.caption}
              </div>
            )}
          </motion.div>

          {/*
            ⚠️ אזור ה-live היה עטוף סביב נקודות עם aria-hidden בלבד — כלומר
            הכריז מחרוזת ריקה, ומעבר בין תמונות לא נשמע כלל בקורא מסך.
            ההכרזה עברה לטקסט sr-only אמיתי; הנקודות נשארות קישוט.
          */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {`תמונה ${(currentIndex ?? 0) + 1} מתוך ${images.length}: ${current.alt}`}
          </p>
          {currentIndex !== null && (
            <div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2"
              aria-hidden="true"
            >
              {images.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === currentIndex ? 'bg-white' : 'bg-white/30'
                  }`}
                  aria-hidden="true"
                />
              ))}
            </div>
          )}
        </motion.div>
      )}
    </>
  )
}
