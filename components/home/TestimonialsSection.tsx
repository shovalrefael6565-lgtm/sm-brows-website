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
  const [fading, setFading] = useState(false)

  const next = useCallback(() => {
    setFading(true)
    setTimeout(() => {
      setCurrent((c) => (c + 1) % REVIEWS.length)
      setFading(false)
    }, 300)
  }, [])

  useEffect(() => {
    const timer = setInterval(next, 3000)
    return () => clearInterval(timer)
  }, [next])

  return (
    <section
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="section-padding bg-brand-rose-bg relative overflow-hidden"
    >
      {/* Tools background — 20% opacity */}
      <div
        className="absolute inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: "url('/tools-bg.png')", opacity: 0.2 }}
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

        {/* Screenshot */}
        <div className="flex justify-center">
          <div className="w-full max-w-sm rounded-[2rem] overflow-hidden shadow-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current}
              src={REVIEWS[current]}
              alt={`ביקורת לקוחה ${current + 1}`}
              className="w-full h-auto block"
              style={{
                opacity: fading ? 0 : 1,
                transition: 'opacity 0.3s ease-in-out',
              }}
              loading="eager"
            />
          </div>
        </div>

      </div>
    </section>
  )
}
