'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useInView } from 'framer-motion'
import Image from 'next/image'

const REVIEWS = [
  '/wa-review-1.png',
  '/wa-review-2.png',
  '/wa-review-3.png',
  '/wa-review-4.png',
  '/wa-review-5.png',
  '/wa-review-6.png',
]

export default function TestimonialsSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })
  const [current, setCurrent] = useState(0)

  const next = useCallback(() => setCurrent((c) => (c + 1) % REVIEWS.length), [])

  useEffect(() => {
    const timer = setInterval(next, 3000)
    return () => clearInterval(timer)
  }, [next])

  return (
    <section
      ref={ref}
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="section-padding"
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {/* Base colour */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundColor: 'var(--color-brand-rose-bg, #fdf6f3)',
        }}
        aria-hidden="true"
      />

      {/* Tools background image — 20 % opacity, no blur */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: "url('/tools-bg.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.2,
        }}
        aria-hidden="true"
      />

      <div style={{ position: 'relative', zIndex: 1 }} className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">

          {/* ── Column 1 (RTL = RIGHT): heading ── */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7 }}
          >
            <h2
              id="testimonials-heading"
              className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark mb-3"
            >
              לקוחות{' '}
              <span className="text-brand-rose">ממליצות</span>
            </h2>
            <div className="flex items-center gap-3">
              <div className="w-14 h-1 rounded-full bg-brand-gold" />
              <span className="text-brand-gold font-serif text-xl select-none" aria-hidden="true">✦</span>
            </div>
          </motion.div>

          {/* ── Column 2 (RTL = LEFT): real WA screenshot ── */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.18 }}
            className="max-w-sm mx-auto lg:mx-0 w-full"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.35 }}
                className="rounded-[2rem] overflow-hidden shadow-xl"
              >
                <Image
                  src={REVIEWS[current]}
                  alt={`ביקורת לקוחה ${current + 1}`}
                  width={560}
                  height={560}
                  className="w-full h-auto block"
                  style={{ objectFit: 'contain' }}
                />
              </motion.div>
            </AnimatePresence>
          </motion.div>

        </div>
      </div>
    </section>
  )
}
