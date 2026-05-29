'use client'

import { useState, useEffect, useCallback } from 'react'

const REVIEWS = [
  '/wa-review-1.png',
  '/wa-review-2.png',
  '/wa-review-3.png',
  '/wa-review-4.png',
  '/wa-review-5.png',
  '/wa-review-6.png',
  '/wa-review-7.png',
]

export default function TestimonialsSection() {
  const [current, setCurrent] = useState(0)

  const next = useCallback(() => setCurrent((c) => (c + 1) % REVIEWS.length), [])

  useEffect(() => {
    const timer = setInterval(next, 5000)
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
        style={{ backgroundImage: "url('/tools-bg.png')", opacity: 0.4 }}
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6">

        {/* Heading */}
        <div className="text-center mb-12">
          <p className="text-xs tracking-[0.25em] text-brand-gold font-semibold uppercase mb-3">
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

        {/* Phone frame + crossfade screenshots */}
        <div className="flex justify-center">
          {/* Phone outer shell */}
          <div
            className="relative rounded-[2.8rem] shadow-2xl p-2"
            style={{
              background: 'linear-gradient(145deg, #2a2a2a, #1a1a1a)',
              boxShadow: '0 30px 60px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.08)',
              width: '100%',
              maxWidth: '320px',
            }}
          >
            {/* Side buttons (decoration) */}
            <div className="absolute -end-1 top-24 w-1 h-10 rounded-e-sm" style={{ background: '#333' }} aria-hidden="true" />
            <div className="absolute -start-1 top-20 w-1 h-7 rounded-s-sm" style={{ background: '#333' }} aria-hidden="true" />
            <div className="absolute -start-1 top-32 w-1 h-7 rounded-s-sm" style={{ background: '#333' }} aria-hidden="true" />

            {/* Screen bezel */}
            <div className="rounded-[2.2rem] overflow-hidden bg-black">
              {/* Notch / dynamic island */}
              <div className="flex justify-center pt-3 pb-1 bg-black" aria-hidden="true">
                <div className="w-24 h-5 rounded-full bg-black border border-gray-800" />
              </div>

              {/* All screenshots stacked — CSS crossfade */}
              <div
                className="relative w-full"
                style={{ display: 'grid' }}
              >
                {REVIEWS.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={src}
                    src={src}
                    alt={i === current ? `ביקורת לקוחה ${i + 1}` : ''}
                    aria-hidden={i !== current}
                    className="w-full h-auto block"
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

              {/* Home bar */}
              <div className="flex justify-center py-2 bg-black" aria-hidden="true">
                <div className="w-28 h-1 rounded-full bg-gray-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Dots indicator */}
        <div className="flex justify-center gap-1.5 mt-8" role="tablist" aria-label="ביקורות">
          {REVIEWS.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === current}
              aria-label={`ביקורת ${i + 1}`}
              onClick={() => setCurrent(i)}
              className="transition-all duration-300 rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
              style={{
                width: i === current ? '1.5rem' : '0.5rem',
                height: '0.5rem',
                backgroundColor: i === current ? '#C4847A' : 'rgba(196,132,122,0.35)',
              }}
            />
          ))}
        </div>

      </div>
    </section>
  )
}
