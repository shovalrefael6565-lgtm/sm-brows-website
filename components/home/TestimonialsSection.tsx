'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

const REVIEWS = [
  '/wa-review-1.webp',
  '/wa-review-2.webp',
  '/wa-review-3.webp',
  '/wa-review-4.webp',
  '/wa-review-5.webp',
  '/wa-review-6.webp',
  '/wa-review-7.webp',
  '/wa-review-8.webp',
  '/wa-review-9.webp',
  '/wa-review-10.webp',
  '/wa-review-11.webp',
  '/wa-review-12.webp',
  '/wa-review-13.webp',
  '/wa-review-14.webp',
  '/wa-review-15.webp',
]

/**
 * Double-buffer crossfade: 2 stable <img> elements (face-a / face-b) swap
 * front/back roles on each navigation.  Only 2 images ever exist in the DOM
 * instead of the original 15 — eliminates ~13 unnecessary image downloads.
 *
 * CSS transitions fire because the elements never unmount (stable keys).
 */
export default function TestimonialsSection() {
  const [slotA, setSlotA] = useState(0)       // index shown in face-a
  const [slotB, setSlotB] = useState(1)       // index shown in face-b
  const [aIsFront, setAIsFront] = useState(true)
  const [displayIdx, setDisplayIdx] = useState(0)

  const aIsFrontRef   = useRef(true)
  const displayIdxRef = useRef(0)
  const pausedRef     = useRef(false)
  const navigating    = useRef(false)

  const navigate = useCallback((nextIdx: number) => {
    if (navigating.current) return
    navigating.current = true

    const toBack = aIsFrontRef.current ? 'b' : 'a'

    // Paint new image into the back (hidden) face first
    if (toBack === 'a') setSlotA(nextIdx)
    else                setSlotB(nextIdx)

    // After 2 frames (browser has started loading the new src) swap front/back
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const front = toBack === 'a'
        setAIsFront(front)
        setDisplayIdx(nextIdx)
        aIsFrontRef.current   = front
        displayIdxRef.current = nextIdx
        navigating.current    = false

        // Preload the image after nextIdx into the now-hidden face
        const afterNext   = (nextIdx + 1) % REVIEWS.length
        const newBack     = front ? 'b' : 'a'
        if (newBack === 'a') setSlotA(afterNext)
        else                 setSlotB(afterNext)
      })
    )
  }, [])

  const next = useCallback(() => navigate((displayIdxRef.current + 1) % REVIEWS.length), [navigate])
  const prev = useCallback(() => navigate((displayIdxRef.current - 1 + REVIEWS.length) % REVIEWS.length), [navigate])

  const goManual = useCallback((fn: () => void) => {
    pausedRef.current = true
    fn()
    setTimeout(() => { pausedRef.current = false }, 6000)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!pausedRef.current) next()
    }, 3000)
    return () => clearInterval(timer)
  }, [next])

  const faceStyle = (isFront: boolean): React.CSSProperties => ({
    gridColumn: 1,
    gridRow: 1,
    width: '100%',
    height: 'auto',
    display: 'block',
    borderRadius: '1rem',
    opacity: isFront ? 1 : 0,
    transition: 'opacity 0.9s ease-in-out',
  })

  return (
    <section
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="section-padding bg-brand-rose-bg relative overflow-hidden"
    >
      <div
        className="absolute inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: "url('/tools-bg.webp')", opacity: 0.4 }}
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="text-xs tracking-[0.25em] text-brand-gold-text font-semibold uppercase mb-3">
            מה אומרות עלינו
          </p>
          <h2
            id="testimonials-heading"
            className="font-serif text-4xl sm:text-5xl font-bold text-brand-dark mb-4"
          >
            לקוחות <span className="text-brand-rose">ממליצות</span>
          </h2>
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-px bg-brand-gold/50" />
            <span className="text-brand-gold font-serif text-2xl select-none" aria-hidden="true">✦</span>
            <div className="w-10 h-px bg-brand-gold/50" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-5">
          {/* Double-buffer: 2 images total, crossfade via CSS opacity transition */}
          <div className="w-full max-w-sm" style={{ display: 'grid' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={REVIEWS[slotA]}
              alt={aIsFront ? `ביקורת לקוחה ${displayIdx + 1}` : ''}
              aria-hidden={!aIsFront}
              width={384}
              height={480}
              style={faceStyle(aIsFront)}
              loading="lazy"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={REVIEWS[slotB]}
              alt={!aIsFront ? `ביקורת לקוחה ${displayIdx + 1}` : ''}
              aria-hidden={aIsFront}
              width={384}
              height={480}
              style={faceStyle(!aIsFront)}
              loading="lazy"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => goManual(prev)}
              aria-label="ביקורת קודמת"
              className="w-8 h-8 rounded-full bg-white/70 border border-brand-rose-light text-brand-rose hover:bg-white hover:border-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="flex items-center gap-1.5" role="tablist" aria-label="ביקורות">
              {REVIEWS.map((_, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === displayIdx}
                  aria-label={`ביקורת ${i + 1}`}
                  onClick={() => goManual(() => navigate(i))}
                  className="p-2 cursor-pointer flex items-center justify-center"
                >
                  <span className={`block rounded-full transition-colors duration-300 ${
                    i === displayIdx ? 'w-4 h-2 bg-brand-rose' : 'w-2 h-2 bg-brand-rose-light hover:bg-brand-rose/50'
                  }`} />
                </button>
              ))}
            </div>

            <button
              onClick={() => goManual(next)}
              aria-label="ביקורת הבאה"
              className="w-8 h-8 rounded-full bg-white/70 border border-brand-rose-light text-brand-rose hover:bg-white hover:border-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
