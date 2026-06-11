'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import Image from 'next/image'

const IMAGES = [
  { src: '/ba-new-1.webp?v=3', alt: 'מיקרובליידינג לפני ואחרי 1',  pos: '50% 30%', mobilePos: '50% 30%' },
  { src: '/ba-new-3.webp',     alt: 'מיקרובליידינג לפני ואחרי 3',  pos: '50% 30%', mobilePos: '50% 30%' },
  { src: '/ba-new-5.webp',     alt: 'מיקרובליידינג לפני ואחרי 5',  pos: '50% 30%', mobilePos: '50% 30%' },
  { src: '/ba-new-6.webp?v=4', alt: 'מיקרובליידינג לפני ואחרי 6',  pos: '50% 30%', mobilePos: '50% 30%' },
  { src: '/ba-new-7.webp',     alt: 'מיקרובליידינג לפני ואחרי 7',  pos: '50% 30%', mobilePos: '50% 30%' },
  { src: '/ba-new-8.webp',     alt: 'מיקרובליידינג לפני ואחרי 8',  pos: '50% 30%', mobilePos: '50% 30%' },
  { src: '/ba-new-9.webp',     alt: 'מיקרובליידינג לפני ואחרי 9',  pos: '50% 30%', mobilePos: '50% 30%' },
  { src: '/ba-new-10.webp',    alt: 'מיקרובליידינג לפני ואחרי 10', pos: '50% 30%', mobilePos: '50% 30%' },
]

const ITEM_W = 440   // px — width of each card
const ITEM_H = 230   // px — height of each card
const GAP    = 20    // px — gap between cards
const SPEED  = 0.6   // px per frame @ 60fps ≈ 36px/s → ~115s per full loop
const INTERVAL = 4000

// Triple items so the loop reset is always invisible
const STRIP_ITEMS = [...IMAGES, ...IMAGES, ...IMAGES]
const SINGLE_SET  = IMAGES.length * (ITEM_W + GAP) // 9 × 460 = 4140px — distance before reset

export default function BeforeAfterSection() {
  const ref     = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  /* ── Mobile carousel ── */
  const [current, setCurrent]   = useState(0)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ── Desktop strip (RAF-based) ── */
  const stripRef  = useRef<HTMLDivElement>(null)
  const posRef    = useRef(0)
  const rafRef    = useRef<number>()
  const pausedRef = useRef(false)
  const [stripPaused, setStripPaused] = useState(false)

  /* keep pausedRef in sync so RAF doesn't need to close over state */
  useEffect(() => { pausedRef.current = stripPaused }, [stripPaused])

  /* RAF loop — runs only on desktop (strip hidden on mobile) */
  useEffect(() => {
    const tick = () => {
      if (!pausedRef.current) {
        posRef.current += SPEED
        if (posRef.current >= SINGLE_SET) posRef.current -= SINGLE_SET
        if (stripRef.current)
          stripRef.current.style.transform = `translateX(-${posRef.current}px)`
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  /* Mobile timer */
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setCurrent(p => (p + 1) % IMAGES.length), INTERVAL)
  }, [])
  useEffect(() => {
    startTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [startTimer])
  useEffect(() => {
    lightbox !== null ? timerRef.current && clearInterval(timerRef.current) : startTimer()
  }, [lightbox, startTimer])

  /* Keyboard for lightbox */
  useEffect(() => {
    if (lightbox === null) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      setLightbox(null)
      if (e.key === 'ArrowRight')  setLightbox(p => p !== null ? (p - 1 + IMAGES.length) % IMAGES.length : p)
      if (e.key === 'ArrowLeft')   setLightbox(p => p !== null ? (p + 1) % IMAGES.length : p)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox])

  const goTo  = (i: number) => { setCurrent(i); startTimer() }
  const prev  = () => goTo((current - 1 + IMAGES.length) % IMAGES.length)
  const next  = () => goTo((current + 1) % IMAGES.length)

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
            <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold-text font-semibold uppercase mb-3">
              תוצאות אמיתיות
            </p>
            <h2 id="ba-heading" className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-brand-dark mb-4">
              לפני <span className="text-brand-rose">ואחרי</span>
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
        </div>

        {/* ── Desktop: RAF infinite strip ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 0.2, duration: 0.7 }}
          className="hidden md:block"
        >
          <div
            dir="ltr"
            className="relative overflow-hidden"
            style={{
              maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
            }}
            onMouseEnter={() => setStripPaused(true)}
            onMouseLeave={() => setStripPaused(false)}
          >
            {/* RAF-animated track — dir=ltr so flex starts from left; translateX(-X) scrolls right→left seamlessly */}
            <div
              ref={stripRef}
              dir="ltr"
              className="flex py-3"
              style={{ gap: `${GAP}px`, width: 'max-content' }}
            >
              {STRIP_ITEMS.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setLightbox(i % IMAGES.length)}
                  aria-label={`הגדל תמונה ${(i % IMAGES.length) + 1}`}
                  className="group relative flex-shrink-0 rounded-2xl overflow-hidden shadow-soft cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
                  style={{ width: `${ITEM_W}px`, height: `${ITEM_H}px` }}
                >
                  <Image
                    src={img.src}
                    alt={img.alt}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    sizes={`${ITEM_W}px`}
                    loading="lazy"
                    quality={75}
                  />
                  <div className="absolute inset-0 bg-brand-dark/0 group-hover:bg-brand-dark/10 transition-colors duration-300" />
                  <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/25 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200" aria-hidden="true">
                    <ExpandIcon className="w-3.5 h-3.5 text-white" />
                  </div>
                </button>
              ))}
            </div>
          </div>
          <p className="text-center text-xs text-brand-muted mt-4 tracking-wide" aria-hidden="true">
            לחצי על תמונה להגדלה
          </p>
        </motion.div>

        {/* ── Mobile: single crossfade carousel ── */}
        <div className="md:hidden max-w-4xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="relative"
          >
            <div
              className="relative rounded-3xl shadow-soft overflow-hidden aspect-[16/9] cursor-zoom-in group"
              onClick={() => setLightbox(current)}
              role="button" aria-label="הגדל תמונה" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setLightbox(current)}
            >
              {IMAGES.map((img, i) => (
                <div
                  key={img.src}
                  className="absolute inset-0"
                  style={{ opacity: i === current ? 1 : 0, transition: 'opacity 0.7s ease-in-out', willChange: 'opacity' }}
                >
                  <Image src={img.src} alt={img.alt} fill className="object-cover"
                    style={{ objectPosition: img.mobilePos ?? img.pos }}
                    sizes="(max-width: 768px) 100vw, 896px" priority={i === 0} loading={i === 0 ? 'eager' : 'lazy'} quality={80} />
                </div>
              ))}
              <div className="absolute top-3 left-3 z-10 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">
                <ExpandIcon className="w-4 h-4 text-white" />
              </div>
            </div>

            <div className="flex items-center justify-center gap-4 mt-5">
              <button onClick={prev} aria-label="תמונה קודמת" className="w-9 h-9 rounded-full border border-brand-rose-light bg-white hover:bg-brand-rose hover:border-brand-rose hover:text-white text-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <div className="flex gap-2" role="tablist" aria-label="בחירת תמונה">
                {IMAGES.map((_, i) => (
                  <button key={i} role="tab" aria-selected={i === current} aria-label={`תמונה ${i + 1}`}
                    onClick={() => goTo(i)}
                    className={`h-2 rounded-full transition-all duration-300 ${i === current ? 'w-6 bg-brand-rose' : 'w-2 bg-brand-rose-light'}`} />
                ))}
              </div>
              <button onClick={next} aria-label="תמונה הבאה" className="w-9 h-9 rounded-full border border-brand-rose-light bg-white hover:bg-brand-rose hover:border-brand-rose hover:text-white text-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background: 'linear-gradient(135deg,rgba(250,247,245,.97) 0%,rgba(247,235,232,.97) 40%,rgba(240,216,213,.97) 70%,rgba(234,216,181,.97) 100%)' }}
            onClick={() => setLightbox(null)}
            role="dialog" aria-modal="true" aria-label="תצוגת תמונה מוגדלת"
          >
            <motion.div
              key={lightbox}
              initial={{ opacity: 0, scale: 0.93 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.93 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-3xl max-h-[85vh] aspect-[16/9] rounded-2xl overflow-hidden shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <Image src={IMAGES[lightbox].src} alt={IMAGES[lightbox].alt} fill className="object-cover" sizes="(max-width:768px) 100vw,1200px" quality={90} />
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand-dark/30 backdrop-blur-sm text-white text-xs font-medium">
                {lightbox + 1} / {IMAGES.length}
              </div>
            </motion.div>

            <button onClick={() => setLightbox(null)} aria-label="סגור"
              className="absolute top-4 left-4 w-10 h-10 rounded-full bg-brand-dark/10 hover:bg-brand-dark/20 border border-brand-dark/15 flex items-center justify-center text-brand-dark transition-colors">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <button onClick={e => { e.stopPropagation(); setLightbox(p => p !== null ? (p - 1 + IMAGES.length) % IMAGES.length : p) }} aria-label="תמונה קודמת"
              className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white hover:bg-brand-rose hover:text-white hover:border-brand-rose border border-brand-rose-light text-brand-rose flex items-center justify-center shadow-sm transition-all duration-200">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button onClick={e => { e.stopPropagation(); setLightbox(p => p !== null ? (p + 1) % IMAGES.length : p) }} aria-label="תמונה הבאה"
              className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white hover:bg-brand-rose hover:text-white hover:border-brand-rose border border-brand-rose-light text-brand-rose flex items-center justify-center shadow-sm transition-all duration-200">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
