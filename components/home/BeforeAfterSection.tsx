'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import Image from 'next/image'

const IMAGES = [
  { src: '/ba-new-1.webp', alt: 'מיקרובליידינג לפני ואחרי 1' },
  { src: '/ba-new-2.webp', alt: 'מיקרובליידינג לפני ואחרי 2' },
  { src: '/ba-new-3.webp', alt: 'מיקרובליידינג לפני ואחרי 3' },
  { src: '/ba-new-4.webp', alt: 'מיקרובליידינג לפני ואחרי 4' },
  { src: '/ba-new-5.webp', alt: 'מיקרובליידינג לפני ואחרי 5' },
  { src: '/ba-new-6.webp', alt: 'מיקרובליידינג לפני ואחרי 6' },
  { src: '/ba-new-7.webp', alt: 'מיקרובליידינג לפני ואחרי 7' },
  { src: '/ba-new-8.webp', alt: 'מיקרובליידינג לפני ואחרי 8' },
  { src: '/ba-new-9.webp', alt: 'מיקרובליידינג לפני ואחרי 9' },
  { src: '/ba-new-10.webp', alt: 'מיקרובליידינג לפני ואחרי 10' },
]

const INTERVAL = 4000

export default function BeforeAfterSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })
  const [current, setCurrent] = useState(0)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCurrent((p) => (p + 1) % IMAGES.length)
    }, INTERVAL)
  }, [])

  useEffect(() => {
    startTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [startTimer])

  // Pause auto-advance when lightbox is open
  useEffect(() => {
    if (lightbox !== null) {
      if (timerRef.current) clearInterval(timerRef.current)
    } else {
      startTimer()
    }
  }, [lightbox, startTimer])

  // Keyboard navigation
  useEffect(() => {
    if (lightbox === null) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox((p) => p !== null ? (p - 1 + IMAGES.length) % IMAGES.length : p)
      if (e.key === 'ArrowLeft') setLightbox((p) => p !== null ? (p + 1) % IMAGES.length : p)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [lightbox])

  const goTo = (i: number) => {
    setCurrent(i)
    startTimer()
  }

  const prev = () => goTo((current - 1 + IMAGES.length) % IMAGES.length)
  const next = () => goTo((current + 1) % IMAGES.length)

  const lightboxPrev = () => setLightbox((p) => p !== null ? (p - 1 + IMAGES.length) % IMAGES.length : p)
  const lightboxNext = () => setLightbox((p) => p !== null ? (p + 1) % IMAGES.length : p)

  return (
    <>
      <section
        id="before-after"
        ref={ref}
        aria-labelledby="ba-heading"
        className="section-padding bg-white"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="text-center mb-10"
          >
            <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-3">
              תוצאות אמיתיות
            </p>
            <h2
              id="ba-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-brand-dark mb-4"
            >
              לפני
              <span className="text-brand-rose"> ואחרי</span>
            </h2>
            <div className="flex items-center justify-center gap-2 mb-4" aria-hidden="true">
              <span className="w-10 h-px bg-brand-rose-light" />
              <span className="w-1.5 h-1.5 rounded-full bg-brand-rose" />
              <span className="w-10 h-px bg-brand-rose-light" />
            </div>
            <p className="text-brand-medium max-w-xl mx-auto leading-relaxed">
              מיקרובליידינג — תוצאות שמדברות בעד עצמן.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="relative"
          >
            {/* Carousel — images stacked, crossfade */}
            <div
              className="relative rounded-3xl shadow-soft overflow-hidden aspect-[16/9] cursor-zoom-in group"
              onClick={() => setLightbox(current)}
              role="button"
              aria-label="הגדל תמונה"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setLightbox(current)}
            >
              {IMAGES.map((img, i) => (
                <div
                  key={img.src}
                  className="absolute inset-0"
                  style={{
                    opacity: i === current ? 1 : 0,
                    transition: 'opacity 0.7s ease-in-out',
                    willChange: 'opacity',
                  }}
                >
                  <Image
                    src={img.src}
                    alt={img.alt}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 896px"
                    priority={i === 0}
                    loading={i === 0 ? 'eager' : 'lazy'}
                    quality={80}
                  />
                </div>
              ))}

              {/* Expand hint */}
              <div className="absolute top-3 left-3 z-10 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200" aria-hidden="true">
                <ExpandIcon className="w-4 h-4 text-white" />
              </div>

            </div>

            {/* Controls row: prev — dots — next */}
            <div className="flex items-center justify-center gap-4 mt-5">
              {/* Prev */}
              <button
                onClick={prev}
                aria-label="תמונה קודמת"
                className="w-9 h-9 rounded-full border border-brand-rose-light bg-white hover:bg-brand-rose hover:border-brand-rose hover:text-white text-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                  <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Dots */}
              <div className="flex gap-2" role="tablist" aria-label="בחירת תמונה">
                {IMAGES.map((_, i) => (
                  <button
                    key={i}
                    role="tab"
                    aria-selected={i === current}
                    aria-label={`תמונה ${i + 1}`}
                    onClick={() => goTo(i)}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      i === current ? 'w-6 bg-brand-rose' : 'w-2 bg-brand-rose-light'
                    }`}
                  />
                ))}
              </div>

              {/* Next */}
              <button
                onClick={next}
                aria-label="תמונה הבאה"
                className="w-9 h-9 rounded-full border border-brand-rose-light bg-white hover:bg-brand-rose hover:border-brand-rose hover:text-white text-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Lightbox ── */}
      <AnimatePresence>
        {lightbox !== null && (
          <motion.div
            key="lightbox-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background: 'linear-gradient(135deg, rgba(250,247,245,0.97) 0%, rgba(247,235,232,0.97) 40%, rgba(240,216,213,0.97) 70%, rgba(234,216,181,0.97) 100%)' }}
            onClick={() => setLightbox(null)}
            role="dialog"
            aria-modal="true"
            aria-label="תצוגת תמונה מוגדלת"
          >
            {/* Image container */}
            <motion.div
              key={lightbox}
              initial={{ opacity: 0, scale: 0.93 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.93 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-3xl max-h-[85vh] aspect-[16/9] rounded-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <Image
                src={IMAGES[lightbox].src}
                alt={IMAGES[lightbox].alt}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 1200px"
                quality={90}
              />

              {/* Counter */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand-dark/30 backdrop-blur-sm text-white text-xs font-medium">
                {lightbox + 1} / {IMAGES.length}
              </div>
            </motion.div>

            {/* Close button */}
            <button
              onClick={() => setLightbox(null)}
              aria-label="סגור"
              className="absolute top-4 left-4 w-10 h-10 rounded-full bg-brand-dark/10 hover:bg-brand-dark/20 border border-brand-dark/15 flex items-center justify-center text-brand-dark transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            {/* Lightbox prev */}
            <button
              onClick={(e) => { e.stopPropagation(); lightboxPrev() }}
              aria-label="תמונה קודמת"
              className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white hover:bg-brand-rose hover:text-white hover:border-brand-rose border border-brand-rose-light text-brand-rose flex items-center justify-center shadow-sm transition-all duration-200"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Lightbox next */}
            <button
              onClick={(e) => { e.stopPropagation(); lightboxNext() }}
              aria-label="תמונה הבאה"
              className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white hover:bg-brand-rose hover:text-white hover:border-brand-rose border border-brand-rose-light text-brand-rose flex items-center justify-center shadow-sm transition-all duration-200"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  )
}
