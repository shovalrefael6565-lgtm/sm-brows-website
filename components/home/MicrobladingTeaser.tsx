'use client'

import { useRef, useState, useEffect } from 'react'
import { motion, useInView } from 'framer-motion'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'

const TARGET = '/services#microblading'

const HIGHLIGHTS = [
  'מראה טבעי ועדין',
  'נשאר עד שנה',
  'התאמה אישית מלאה',
]

export default function MicrobladingTeaser() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  // מתנגן רק כשגוללים אליו (מושתק, בלופ) — כדי לא להעמיס על טעינת העמוד
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) v.play().then(() => setPlaying(true)).catch(() => {})
        else v.pause()
      },
      { threshold: 0.4 },
    )
    io.observe(v)
    return () => io.disconnect()
  }, [])

  return (
    <section
      ref={ref}
      aria-labelledby="micro-teaser-heading"
      className="relative overflow-hidden bg-brand-linen py-16 sm:py-20"
    >
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-60" />
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-brand-gold/8 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-brand-rose/8 blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 sm:gap-12 items-center">

          {/* Reel — clickable, leads to the full section on the services page */}
          <motion.div
            initial={{ opacity: 0, x: 32 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="flex justify-center sm:justify-start"
          >
            <Link
              href={TARGET}
              aria-label="לצפייה בכל הפרטים והסרטונים של מיקרובליידינג"
              className="group relative block w-full max-w-[280px] rounded-3xl overflow-hidden shadow-soft-lg ring-2 ring-brand-gold/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-gold"
            >
              <video
                ref={videoRef}
                src="/micro-1.mp4"
                poster="/micro-1-poster.webp"
                muted
                loop
                playsInline
                preload="metadata"
                className="w-full h-full object-cover aspect-[9/16]"
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-brand-dark/30 via-transparent to-transparent"
              />
              <span className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-1.5 text-white text-sm font-semibold opacity-90 group-hover:opacity-100 transition-opacity">
                לצפייה בעוד
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" aria-hidden="true" />
              </span>
            </Link>
          </motion.div>

          {/* Content */}
          <motion.div
            initial={{ opacity: 0, x: -32 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="text-center sm:text-right"
          >
            <span className="inline-flex items-center gap-1.5 bg-brand-gold/20 border border-brand-gold/40 text-brand-gold-text text-xs font-bold px-3 py-1.5 rounded-full tracking-wider uppercase mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-gold animate-pulse" aria-hidden="true" />
              הטיפול המבוקש ביותר
            </span>
            <h2
              id="micro-teaser-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-brand-dark mb-3"
            >
              מיקרובליידינג
            </h2>
            <p className="text-brand-medium text-base sm:text-lg leading-relaxed mb-6 max-w-md mx-auto sm:mx-0 sm:me-0">
              גבות מושלמות מהרגע שקמים בבוקר — הדמיית שערה עדינה וטבעית שנשארת עד שנה.
            </p>

            <ul className="flex flex-wrap justify-center sm:justify-start gap-x-5 gap-y-2 mb-7" aria-label="יתרונות מיקרובליידינג">
              {HIGHLIGHTS.map((h) => (
                <li key={h} className="inline-flex items-center gap-1.5 text-brand-medium text-sm">
                  <Check className="w-4 h-4 text-brand-gold-dark flex-shrink-0" aria-hidden="true" />
                  {h}
                </li>
              ))}
            </ul>

            <Link
              href={TARGET}
              className="inline-flex items-center gap-2 bg-brand-gold text-brand-dark font-bold text-base px-8 py-4 rounded-full hover:bg-brand-gold-dark transition-all duration-200 shadow-gold hover:-translate-y-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-linen"
            >
              לכל הפרטים והסרטונים
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </Link>
          </motion.div>

        </div>
      </div>
    </section>
  )
}
