'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion, AnimatePresence, useInView } from 'framer-motion'
import { useRef, useState, useEffect } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { galleryItems } from '@/lib/data'

const CAROUSEL_ITEMS = galleryItems.filter((g) => g.type !== 'before-after' && g.image)

export default function GalleryPreview() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)
  const [direction, setDirection] = useState(1)

  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => {
      setDirection(1)
      setCurrent((c) => (c + 1) % CAROUSEL_ITEMS.length)
    }, 3000)
    return () => clearInterval(timer)
  }, [paused])

  const go = (idx: number) => {
    setDirection(idx > current ? 1 : -1)
    setCurrent(idx)
  }

  const prev = () => {
    const idx = (current - 1 + CAROUSEL_ITEMS.length) % CAROUSEL_ITEMS.length
    go(idx)
  }

  const next = () => {
    const idx = (current + 1) % CAROUSEL_ITEMS.length
    go(idx)
  }

  const item = CAROUSEL_ITEMS[current]

  return (
    <section
      ref={ref}
      id="gallery"
      aria-labelledby="gallery-preview-heading"
      className="section-padding bg-brand-cream"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="flex items-end justify-between mb-10 flex-wrap gap-4"
        >
          <div>
            <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-2">
              הגלריה שלנו
            </p>
            <h2
              id="gallery-preview-heading"
              className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark"
            >
              עבודות שאנחנו
              <span className="text-brand-rose"> גאות בהן</span>
            </h2>
          </div>
          <Link
            href="/gallery"
            aria-label="לגלריה המלאה"
            className="inline-flex items-center gap-1.5 text-brand-rose font-semibold hover:text-brand-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            לכל הגלריה
          </Link>
        </motion.div>

        {/* Carousel */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.2 }}
        >
          <div
            className="relative rounded-3xl overflow-hidden bg-brand-dark shadow-[0_20px_60px_-12px_rgba(44,24,16,0.3)]"
            style={{ aspectRatio: '16/7' }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            aria-label="גלריית תמונות"
            aria-roledescription="carousel"
          >
            {/* Images */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={current}
                initial={{ opacity: 0, x: direction * 60 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -60 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
                aria-label={item.alt}
              >
                <Image
                  src={item.image!}
                  alt={item.alt}
                  fill
                  sizes="100vw"
                  className="object-cover"
                  priority
                />
                {/* Gradient overlay */}
                <div
                  className="absolute inset-0 bg-gradient-to-t from-brand-dark/70 via-transparent to-brand-dark/10"
                  aria-hidden="true"
                />
              </motion.div>
            </AnimatePresence>

            {/* Caption */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`cap-${current}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="absolute bottom-14 start-6 sm:start-10"
              >
                {item.caption && (
                  <p className="text-white font-semibold text-sm sm:text-base drop-shadow-md">
                    {item.caption}
                  </p>
                )}
                <p className="text-white/60 text-xs sm:text-sm">{item.alt}</p>
              </motion.div>
            </AnimatePresence>

            {/* Dots */}
            <div
              className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2"
              role="tablist"
              aria-label="בחרי תמונה"
            >
              {CAROUSEL_ITEMS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === current}
                  aria-label={`תמונה ${i + 1}`}
                  onClick={() => go(i)}
                  className={`transition-all duration-300 rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                    i === current
                      ? 'w-6 h-2 bg-brand-gold'
                      : 'w-2 h-2 bg-white/50 hover:bg-white/80'
                  }`}
                />
              ))}
            </div>

            {/* Arrows */}
            <button
              type="button"
              onClick={prev}
              aria-label="תמונה קודמת"
              className="absolute top-1/2 -translate-y-1/2 start-4 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/40 transition-all duration-200 cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:opacity-100 hover:opacity-100"
              style={{ opacity: paused ? 1 : undefined }}
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="תמונה הבאה"
              className="absolute top-1/2 -translate-y-1/2 end-4 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/40 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ opacity: paused ? 1 : undefined }}
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>

            {/* Counter */}
            <div className="absolute top-5 end-5 bg-black/40 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full" aria-hidden="true">
              {current + 1} / {CAROUSEL_ITEMS.length}
            </div>

            {/* Link overlay */}
            <Link
              href="/gallery"
              aria-label="פתח גלריה מלאה"
              className="absolute inset-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-gold focus-visible:ring-inset"
              tabIndex={-1}
            />
          </div>
        </motion.div>
      </div>
    </section>
  )
}
