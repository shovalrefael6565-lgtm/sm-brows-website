'use client'

import { useRef, useState, useCallback } from 'react'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import Image from 'next/image'

const IMAGES = [
  { src: '/ba-new-1.jpg', alt: 'מיקרובליידינג לפני ואחרי 1' },
  { src: '/ba-new-2.jpg', alt: 'מיקרובליידינג לפני ואחרי 2' },
  { src: '/ba-new-3.jpg', alt: 'מיקרובליידינג לפני ואחרי 3' },
  { src: '/ba-new-4.jpg', alt: 'מיקרובליידינג לפני ואחרי 4' },
  { src: '/ba-new-5.jpg', alt: 'מיקרובליידינג לפני ואחרי 5' },
  { src: '/ba-new-6.jpg', alt: 'מיקרובליידינג לפני ואחרי 6' },
]

export default function BeforeAfterSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })
  const [current, setCurrent] = useState(0)
  const [direction, setDirection] = useState(0)

  const go = useCallback((dir: number) => {
    setDirection(dir)
    setCurrent((prev) => (prev + dir + IMAGES.length) % IMAGES.length)
  }, [])

  const variants = {
    enter: (d: number) => ({ x: d > 0 ? '100%' : '-100%', opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? '-100%' : '100%', opacity: 0 }),
  }

  return (
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
          {/* Image container */}
          <div className="relative overflow-hidden rounded-3xl shadow-soft aspect-[16/9] bg-brand-cream">
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              <motion.div
                key={current}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
              >
                <Image
                  src={IMAGES[current].src}
                  alt={IMAGES[current].alt}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 896px"
                  priority={current === 0}
                />
              </motion.div>
            </AnimatePresence>

            {/* Prev arrow */}
            <button
              onClick={() => go(-1)}
              aria-label="תמונה קודמת"
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/80 hover:bg-white shadow-soft flex items-center justify-center transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-dark" aria-hidden="true">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Next arrow */}
            <button
              onClick={() => go(1)}
              aria-label="תמונה הבאה"
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/80 hover:bg-white shadow-soft flex items-center justify-center transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-dark" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Dots */}
          <div className="flex justify-center gap-2 mt-5" role="tablist" aria-label="בחירת תמונה">
            {IMAGES.map((_, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === current}
                aria-label={`תמונה ${i + 1}`}
                onClick={() => { setDirection(i > current ? 1 : -1); setCurrent(i) }}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === current ? 'w-6 bg-brand-rose' : 'w-2 bg-brand-rose-light'
                }`}
              />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
