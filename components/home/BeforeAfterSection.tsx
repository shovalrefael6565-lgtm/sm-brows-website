'use client'

import { useRef, useState, useEffect } from 'react'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import Image from 'next/image'

const IMAGES = [
  { src: '/ba-new-1.webp', alt: 'מיקרובליידינג לפני ואחרי 1' },
  { src: '/ba-new-2.webp', alt: 'מיקרובליידינג לפני ואחרי 2' },
  { src: '/ba-new-3.webp', alt: 'מיקרובליידינג לפני ואחרי 3' },
  { src: '/ba-new-4.webp', alt: 'מיקרובליידינג לפני ואחרי 4' },
  { src: '/ba-new-5.webp', alt: 'מיקרובליידינג לפני ואחרי 5' },
  { src: '/ba-new-6.webp', alt: 'מיקרובליידינג לפני ואחרי 6' },
  { src: '/ba-new-7.webp', alt: 'מיקרובליידינג לפני ואחרי 7' },
  { src: '/ba-new-8.webp', alt: 'מיקרובליידינג לפני ואחרי 8' },
]

const INTERVAL = 4000

export default function BeforeAfterSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })
  const [current, setCurrent] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCurrent((p) => (p + 1) % IMAGES.length)
    }, INTERVAL)
  }

  useEffect(() => {
    startTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goTo = (i: number) => {
    setCurrent(i)
    startTimer()
  }

  const prev = () => goTo((current - 1 + IMAGES.length) % IMAGES.length)
  const next = () => goTo((current + 1) % IMAGES.length)

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
          {/* Carousel — crossfade, no background gap */}
          <div className="relative rounded-3xl shadow-soft overflow-hidden aspect-[16/9]">
            {/* All images stacked; only current is visible */}
            {IMAGES.map((img, i) => (
              <div
                key={img.src}
                className="absolute inset-0"
                style={{
                  opacity: i === current ? 1 : 0,
                  transition: 'opacity 0.7s ease-in-out',
                  willChange: 'opacity',
                }}
              >
                <Image
                  src={img.src}
                  alt={img.alt}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 896px"
                  priority={i === 0}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  quality={80}
                />
              </div>
            ))}

            {/* Prev arrow (RTL: right side) */}
            <button
              onClick={prev}
              aria-label="תמונה קודמת"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/80 hover:bg-white shadow-soft flex items-center justify-center transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-brand-dark" aria-hidden="true">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Next arrow */}
            <button
              onClick={next}
              aria-label="תמונה הבאה"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white/80 hover:bg-white shadow-soft flex items-center justify-center transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-brand-dark" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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
                onClick={() => goTo(i)}
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
