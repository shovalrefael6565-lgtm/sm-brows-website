'use client'

import { useRef, useEffect } from 'react'
import { motion, useInView } from 'framer-motion'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { WHATSAPP_BASE } from '@/lib/utils'

const CONSULT_URL = `${WHATSAPP_BASE}?text=${encodeURIComponent('היי שובל 🤍 רציתי לקבל פרטים ולייעוץ על מיקרובליידינג')}`

export default function MicrobladingTeaser() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) v.play().catch(() => {})
        else v.pause()
      },
      { threshold: 0.3 },
    )
    io.observe(v)
    return () => io.disconnect()
  }, [])

  return (
    <section
      ref={ref}
      aria-labelledby="micro-teaser-heading"
      className="relative overflow-hidden bg-brand-dark"
    >
      <div aria-hidden="true" className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-30 pointer-events-none" />

      {/*
        flex-col-reverse: on mobile the second DOM child (video) appears at top,
        first DOM child (text) appears below.
        lg:grid RTL auto-placement: first child → rightmost column (text), second → left (video).
      */}
      <div className="flex flex-col-reverse lg:grid lg:grid-cols-[0.46fr_0.54fr] lg:min-h-[680px]">

        {/* Text — first DOM child → right column in RTL grid */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col justify-center px-6 sm:px-10 lg:px-14 py-14 lg:py-24"
        >
          <h2
            id="micro-teaser-heading"
            className="font-serif text-4xl sm:text-5xl lg:text-6xl font-medium text-white leading-tight mb-4"
          >
            מיקרובליידינג
          </h2>
          <div className="w-12 h-px bg-brand-gold mb-7" aria-hidden="true" />
          <p className="text-white/75 text-base sm:text-lg leading-relaxed mb-3">
            גבות מושלמות מהרגע שקמים בבוקר. הדמיית שערה ידנית, עדינה ומדויקת — תוצאה שנראית
            טבעית כל כך שאף אחד לא יצליח לזהות שהן מצוירות.
          </p>
          <p className="text-white/50 text-sm sm:text-base leading-relaxed mb-10">
            כל קו מצויר בהתאמה אישית לצורת הפנים, לגוון ולסגנון שלך. התוצאה נשארת עד שנה.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/services#microblading"
              aria-label="לכל פרטי הטיפול של מיקרובליידינג"
              className="inline-flex items-center justify-center gap-2 bg-brand-cream text-brand-dark font-bold text-base px-6 py-3 rounded hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark"
            >
              לכל הפרטים
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </Link>
            <a
              href={CONSULT_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="ייעוץ חינם על מיקרובליידינג בוואצאפ"
              className="inline-flex items-center justify-center gap-2 border border-white/30 text-white font-semibold text-base px-6 py-3 rounded hover:bg-white/10 hover:border-white/50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark"
            >
              לייעוץ חינם בוואצאפ
            </a>
          </div>
        </motion.div>

        {/* Video — second DOM child → left column in RTL grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="relative aspect-[3/4] lg:aspect-auto lg:h-full overflow-hidden"
        >
          <video
            ref={videoRef}
            src="/tizer-1.mp4"
            poster="/tizer-1-poster.webp"
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            className="w-full h-full object-cover"
          />
          {/* Mobile: bottom fade into section below. Desktop: right edge fades into text column. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-brand-dark/80 lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-brand-dark pointer-events-none"
          />
        </motion.div>
      </div>
    </section>
  )
}
