'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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

export default function TestimonialsSection() {
  const [current, setCurrent] = useState(0)
  const pausedRef = useRef(false)

  const next = useCallback(() => setCurrent((c) => (c + 1) % REVIEWS.length), [])
  const prev = useCallback(() => setCurrent((c) => (c - 1 + REVIEWS.length) % REVIEWS.length), [])

  const goManual = useCallback((fn: () => void) => {
    pausedRef.current = true
    fn()
    // resume auto-scroll after 6 seconds of inactivity
    setTimeout(() => { pausedRef.current = false }, 6000)
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!pausedRef.current) next()
    }, 3000)
    return () => clearInterval(timer)
  }, [next])

  return (
    <section
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="section-padding bg-brand-rose-bg relative overflow-hidden"
    >
      {/* Tools background — 40% opacity */}
      <div
        className="absolute inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: "url('/tools-bg.webp')", opacity: 0.4 }}
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6">

        {/* Heading */}
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

        {/* Crossfade screenshots */}
        <div className="flex flex-col items-center gap-5">
          <div className="w-full max-w-sm" style={{ display: 'grid' }}>
            {REVIEWS.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={i === current ? `ביקורת לקוחה ${i + 1}` : ''}
                aria-hidden={i !== current}
                width={384}
                height={480}
                className="w-full h-auto block rounded-2xl"
                style={{
                  gridColumn: 1,
                  gridRow: 1,
                  opacity: i === current ? 1 : 0,
                  transition: 'opacity 0.9s ease-in-out',
                }}
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => goManual(prev)}
              aria-label="ביקורת קודמת"
              className="w-8 h-8 rounded-full bg-white/70 border border-brand-rose-light text-brand-rose hover:bg-white hover:border-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <div className="flex items-center gap-1.5" role="tablist" aria-label="ביקורות">
              {REVIEWS.map((_, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === current}
                  aria-label={`ביקורת ${i + 1}`}
                  onClick={() => goManual(() => setCurrent(i))}
                  className="p-2 cursor-pointer flex items-center justify-center"
                >
                  <span className={`block rounded-full transition-colors duration-300 ${
                    i === current ? 'w-4 h-2 bg-brand-rose' : 'w-2 h-2 bg-brand-rose-light hover:bg-brand-rose/50'
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
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

      </div>
    </section>
  )
}
