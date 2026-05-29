'use client'

import { useState, useEffect, useCallback } from 'react'

const REVIEWS = [
  '/wa-review-1.webp',
  '/wa-review-2.webp',
  '/wa-review-3.webp',
  '/wa-review-4.webp',
  '/wa-review-5.webp',
  '/wa-review-6.webp',
  '/wa-review-7.webp',
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
        style={{ backgroundImage: "url('/tools-bg.webp')", opacity: 0.4 }}
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

        {/* Crossfade screenshots */}
        <div className="flex justify-center">
          <div className="w-full max-w-sm" style={{ display: 'grid' }}>
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
                loading="eager"
              />
            ))}
          </div>
        </div>


      </div>
    </section>
  )
}
