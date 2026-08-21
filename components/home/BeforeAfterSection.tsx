'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { motion, useInView } from 'framer-motion'
import Image from 'next/image'
import { useDialogA11y } from '@/lib/useDialogA11y'

const IMAGES = [
  { src: '/images/before-after/before-after-01.PNG', alt: 'עיצוב גבות לפני ואחרי 1' },
  { src: '/images/before-after/before-after-02.PNG', alt: 'עיצוב גבות לפני ואחרי 2' },
  { src: '/images/before-after/before-after-03.PNG', alt: 'עיצוב גבות לפני ואחרי 3' },
  { src: '/images/before-after/before-after-04.PNG', alt: 'עיצוב גבות לפני ואחרי 4' },
  { src: '/images/before-after/before-after-05.PNG', alt: 'עיצוב גבות לפני ואחרי 5' },
  { src: '/images/before-after/before-after-06.PNG', alt: 'עיצוב גבות לפני ואחרי 6' },
  { src: '/images/before-after/before-after-07.PNG', alt: 'עיצוב גבות לפני ואחרי 7' },
  { src: '/images/before-after/before-after-08.PNG', alt: 'עיצוב גבות לפני ואחרי 8' },
]

const INTERVAL = 3500

export default function BeforeAfterSection() {
  const ref      = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  const [current, setCurrent] = useState(0)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentRef = useRef(0)

  /*
    Virtual mount window: keep current ± 1 in the DOM so crossfade has
    images ready, but nothing else is fetched (lazy). Never unmounts already-
    seen slides so back-navigation is instant.
  */
  const [mounted, setMounted] = useState<number[]>(
    () => [0, 1 % IMAGES.length, (IMAGES.length - 1) % IMAGES.length]
  )

  const select = useCallback((i: number) => {
    currentRef.current = i
    setCurrent(i)
    setMounted(prev => {
      const want = [
        i,
        (i + 1) % IMAGES.length,
        (i - 1 + IMAGES.length) % IMAGES.length,
      ].filter(x => !prev.includes(x))
      return want.length ? [...prev, ...want] : prev
    })
  }, [])

  const lightboxRef = useDialogA11y<HTMLDivElement>({
    open: lightbox !== null,
    onClose: () => setLightbox(null),
    lockScroll: true,
  })

  /* ── Viewport-aware autoplay ── */
  const carouselRef = useRef<HTMLDivElement>(null)
  const [carouselInView, setCarouselInView] = useState(false)

  useEffect(() => {
    const el = carouselRef.current
    if (!el) return
    let io: IntersectionObserver | undefined
    const start = () => {
      io = new IntersectionObserver(
        ([entry]) => setCarouselInView(entry.isIntersecting),
        { rootMargin: '100px' },
      )
      io.observe(el)
    }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => { io?.disconnect(); window.removeEventListener('load', start) }
  }, [])

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(
      () => select((currentRef.current + 1) % IMAGES.length),
      INTERVAL,
    )
  }, [select])

  useEffect(() => {
    if (!carouselInView) return
    startTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [carouselInView, startTimer])

  /* Pause during lightbox; resume when closed (if still in view) */
  useEffect(() => {
    if (lightbox !== null) {
      if (timerRef.current) clearInterval(timerRef.current)
    } else if (carouselInView) {
      startTimer()
    }
  }, [lightbox, carouselInView, startTimer])

  /* Keyboard navigation for lightbox */
  useEffect(() => {
    if (lightbox === null) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape')     setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox(p => p !== null ? (p - 1 + IMAGES.length) % IMAGES.length : p)
      if (e.key === 'ArrowLeft')  setLightbox(p => p !== null ? (p + 1) % IMAGES.length : p)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox])

  /*
    Use currentRef (not current) in prev/next so repeated rapid clicks always
    compute from the latest committed index, not a stale closure.
  */
  const goTo = useCallback((i: number) => { select(i); startTimer() }, [select, startTimer])
  const prev = useCallback(() => goTo((currentRef.current - 1 + IMAGES.length) % IMAGES.length), [goTo])
  const next = useCallback(() => goTo((currentRef.current + 1) % IMAGES.length), [goTo])

  /* ── Touch / swipe ── */
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const swipedRef   = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    swipedRef.current = false
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    // Trigger only on predominantly horizontal swipes (>30px, more horiz than vert)
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
      swipedRef.current = true
      // RTL: swipe left → next, swipe right → prev
      if (dx < 0) next()
      else prev()
    }
    touchStartX.current = null
    touchStartY.current = null
  }, [next, prev])

  return (
    <>
      <section
        id="before-after"
        ref={ref}
        aria-labelledby="ba-heading"
        className="section-padding bg-white"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6">

          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="text-center mb-10"
          >
            <h2 id="ba-heading" className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium text-brand-dark mb-4">
              לפני <span className="text-brand-rose-text">ואחרי</span>
            </h2>
            <div className="w-16 h-px bg-gold-gradient mx-auto mb-5" aria-hidden="true" />
            <p className="text-brand-medium max-w-xl mx-auto leading-relaxed">
              תוצאות אמיתיות מלקוחות אמיתיות — כל עיצוב מותאם אישית לפנים.
            </p>
          </motion.div>

          {/* ── Carousel ── */}
          <motion.div
            ref={carouselRef}
            initial={{ opacity: 0, y: 32 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.2, duration: 0.6 }}
          >

            {/*
              Image wrapper — max-w-2xl keeps desktop images from becoming
              excessively large. Desktop arrows are absolute within this wrapper
              (outside overflow-hidden so they aren't clipped by the rounded
              image container).
            */}
            <div className="relative max-w-2xl mx-auto">

              {/* Desktop: right arrow (RTL = previous) */}
              <button
                onClick={prev}
                aria-label="תמונה קודמת"
                className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-10
                           w-10 h-10 items-center justify-center rounded-full
                           bg-white/80 backdrop-blur-sm border border-brand-rose-light
                           text-brand-rose hover:bg-brand-rose hover:border-brand-rose hover:text-white
                           shadow-sm transition-all duration-200"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                  <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Desktop: left arrow (RTL = next) */}
              <button
                onClick={next}
                aria-label="תמונה הבאה"
                className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-10
                           w-10 h-10 items-center justify-center rounded-full
                           bg-white/80 backdrop-blur-sm border border-brand-rose-light
                           text-brand-rose hover:bg-brand-rose hover:border-brand-rose hover:text-white
                           shadow-sm transition-all duration-200"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/* Image stage — 4:3, object-contain so the full composite is always visible */}
              <div
                className="relative rounded-3xl shadow-soft overflow-hidden aspect-[4/3] bg-brand-cream cursor-zoom-in group"
                onClick={() => { if (!swipedRef.current) setLightbox(current) }}
                role="button"
                aria-label="הגדל תמונה"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox(current) }
                }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {IMAGES.map((img, i) => (
                  <div
                    key={img.src}
                    className="absolute inset-0"
                    style={{
                      opacity: i === current ? 1 : 0,
                      transition: 'opacity 0.3s ease-in-out',
                      willChange: 'opacity',
                    }}
                  >
                    {mounted.includes(i) && (
                      <Image
                        src={img.src}
                        alt={img.alt}
                        fill
                        className="object-contain"
                        sizes="(max-width: 768px) 100vw, 672px"
                        priority={i === 0}
                        loading={i === 0 ? 'eager' : 'lazy'}
                        quality={80}
                      />
                    )}
                  </div>
                ))}

                {/* Expand hint — desktop hover only */}
                <div
                  className="absolute top-3 left-3 z-10 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-hidden="true"
                >
                  <ExpandIcon className="w-4 h-4 text-white" />
                </div>
              </div>
            </div>

            {/* Navigation row — mobile arrows flanking the dots */}
            <div className="flex items-center justify-center gap-4 mt-5">

              {/* Mobile: right arrow (RTL = previous) */}
              <button
                onClick={prev}
                aria-label="תמונה קודמת"
                className="md:hidden w-9 h-9 rounded-full border border-brand-rose-light bg-white
                           hover:bg-brand-rose hover:border-brand-rose hover:text-white
                           text-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                  <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {/*
                Dots — same flex-wrap pattern as before to prevent horizontal
                overflow at large font sizes (WCAG 2.1.1).
              */}
              <div className="flex flex-wrap justify-center gap-0" role="tablist" aria-label="בחירת תמונה">
                {IMAGES.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === current}
                    aria-label={`תמונה ${i + 1}`}
                    onClick={() => goTo(i)}
                    className="h-6 px-2 flex items-center justify-center rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                  >
                    <span
                      aria-hidden="true"
                      className={`block h-2 rounded-full transition-all duration-300 ${
                        i === current ? 'w-6 bg-brand-rose' : 'w-2 bg-brand-rose-light'
                      }`}
                    />
                  </button>
                ))}
              </div>

              {/* Mobile: left arrow (RTL = next) */}
              <button
                onClick={next}
                aria-label="תמונה הבאה"
                className="md:hidden w-9 h-9 rounded-full border border-brand-rose-light bg-white
                           hover:bg-brand-rose hover:border-brand-rose hover:text-white
                           text-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm"
              >
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

          </motion.div>
        </div>
      </section>

      {/*
        Lightbox — conditional render (no AnimatePresence) to avoid the
        exit-animation unmount bug documented in the original implementation.
      */}
      {lightbox !== null && (
        <motion.div
          key="lightbox-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22 }}
          ref={lightboxRef}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'linear-gradient(135deg,rgba(250,247,245,.97) 0%,rgba(247,235,232,.97) 40%,rgba(240,216,213,.97) 70%,rgba(234,216,181,.97) 100%)' }}
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label="תצוגת תמונה מוגדלת"
        >
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {`תמונה ${lightbox + 1} מתוך ${IMAGES.length}: ${IMAGES[lightbox].alt}`}
          </p>

          <motion.div
            key={lightbox}
            initial={{ opacity: 0, scale: 0.93 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-3xl max-h-[85vh] aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <Image
              src={IMAGES[lightbox].src}
              alt={IMAGES[lightbox].alt}
              fill
              className="object-contain"
              sizes="(max-width:768px) 100vw,1200px"
              quality={90}
            />
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand-dark/30 backdrop-blur-sm text-white text-xs font-medium">
              {lightbox + 1} / {IMAGES.length}
            </div>
          </motion.div>

          <button
            onClick={() => setLightbox(null)}
            aria-label="סגור"
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-brand-dark/10 hover:bg-brand-dark/20 border border-brand-dark/15 flex items-center justify-center text-brand-dark transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          <button
            onClick={e => { e.stopPropagation(); setLightbox(p => p !== null ? (p - 1 + IMAGES.length) % IMAGES.length : p) }}
            aria-label="תמונה קודמת"
            className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white hover:bg-brand-rose hover:text-white hover:border-brand-rose border border-brand-rose-light text-brand-rose flex items-center justify-center shadow-sm transition-all duration-200"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            onClick={e => { e.stopPropagation(); setLightbox(p => p !== null ? (p + 1) % IMAGES.length : p) }}
            aria-label="תמונה הבאה"
            className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white hover:bg-brand-rose hover:text-white hover:border-brand-rose border border-brand-rose-light text-brand-rose flex items-center justify-center shadow-sm transition-all duration-200"
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </motion.div>
      )}
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
