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
  '/wa-review-7.png',
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

      <div style={{ position: 'relative', zIndex: 1 }} className="max-w-4xl mx-auto px-4 sm:px-6">

        {/* ── Centered heading ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="text-center mb-12"
        >
          <p className="text-xs tracking-[0.25em] text-brand-gold font-semibold uppercase mb-3">
            מה אומרות עלינו
          </p>
          <h2
            id="testimonials-heading"
            className="font-serif text-4xl sm:text-5xl font-bold text-brand-dark mb-4"
          >
            לקוחות{' '}
            <span className="text-brand-rose">ממליצות</span>
          </h2>
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-px bg-brand-gold/50" />
            <span className="text-brand-gold font-serif text-2xl select-none" aria-hidden="true">✦</span>
            <div className="w-10 h-px bg-brand-gold/50" />
          </div>
        </motion.div>

        {/* ── Screenshot card — centered ── */}
        <div className="flex justify-center">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.18 }}
            className="w-full max-w-sm"
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
