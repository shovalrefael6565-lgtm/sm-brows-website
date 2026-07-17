'use client'

import { useRef, useState, useEffect } from 'react'
import { motion, useInView } from 'framer-motion'
import { Check, Play, Clock } from 'lucide-react'
import { WHATSAPP_URL } from '@/lib/utils'

const REELS = [
  { src: '/micro-1.mp4', poster: '/micro-1-poster.webp' },
  { src: '/micro-2.mp4', poster: '/micro-2-poster.webp' },
  { src: '/micro-3.mp4', poster: '/micro-3-poster.webp' },
  { src: '/micro-4.mp4', poster: '/micro-4-poster.webp' },
]

const FEATURES = [
  'מראה טבעי ועדין',
  'התאמה אישית לכל לקוחה',
  'תוצאה שנמשכת עד שנה',
  'כולל טיפול חיזוק אחרי 6 שבועות',
]

/**
 * ריל בודד — מושתק, בלופ, מתנגן רק כשהוא בתוך המסך ונעצר כשיוצאים ממנו
 * (IntersectionObserver). preload="none" — שום בייט לא נטען עד שגוללים לכאן,
 * כך שמהירות הטעינה של העמוד לא נפגעת.
 */
function Reel({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  const play = () => {
    const v = ref.current
    if (!v) return
    v.play().then(() => setPlaying(true)).catch(() => {})
  }

  useEffect(() => {
    const v = ref.current
    if (!v) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) v.play().then(() => setPlaying(true)).catch(() => {})
        else v.pause()
      },
      { threshold: 0.35 },
    )
    io.observe(v)
    return () => io.disconnect()
  }, [])

  return (
    <div className="relative rounded-3xl overflow-hidden shadow-soft-lg bg-brand-cream-dark cursor-pointer group ring-1 ring-brand-gold/30">
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        onClick={play}
        aria-label="סרטון מיקרובליידינג"
        className="w-full h-full object-cover aspect-[9/16]"
      />
      {!playing && (
        <button
          type="button"
          onClick={play}
          aria-label="נגני סרטון"
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-brand-dark/25 to-transparent transition-opacity group-hover:from-brand-dark/35"
        >
          <span className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg transition-transform group-hover:scale-105">
            <Play className="w-5 h-5 sm:w-6 sm:h-6 text-brand-rose translate-x-0.5" fill="currentColor" aria-hidden="true" />
          </span>
        </button>
      )}
    </div>
  )
}

export default function MicrobladingSpotlight() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section
      ref={ref}
      id="microblading"
      aria-labelledby="microblading-spotlight-heading"
      className="relative overflow-hidden bg-brand-linen py-16 sm:py-20 scroll-mt-24"
    >
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-60" />
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-brand-gold/8 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-brand-rose/8 blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-10"
        >
          <span className="inline-flex items-center gap-1.5 bg-brand-gold/20 border border-brand-gold/40 text-brand-gold-text text-xs font-bold px-3 py-1.5 rounded-full tracking-wider uppercase mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-gold animate-pulse" aria-hidden="true" />
            הטיפול המבוקש ביותר
          </span>
          <h2
            id="microblading-spotlight-heading"
            className="font-serif text-4xl sm:text-5xl font-bold text-brand-dark mb-3"
          >
            מיקרובליידינג
          </h2>
          <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
            גבות מושלמות מהרגע שקמים בבוקר — הדמיית שערה עדינה, טבעית ומותאמת אישית, שנשארת עד שנה.
          </p>
        </motion.div>

        {/* Reels */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="grid grid-cols-2 gap-3 sm:gap-5 max-w-md mx-auto mb-10"
        >
          {REELS.map((reel) => (
            <Reel key={reel.src} src={reel.src} poster={reel.poster} />
          ))}
        </motion.div>

        {/* Features + CTA */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl mx-auto"
        >
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mb-8" aria-label="יתרונות מיקרובליידינג">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-brand-medium text-sm">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-gold/20 flex items-center justify-center mt-0.5" aria-hidden="true">
                  <Check className="w-3 h-3 text-brand-gold-dark" />
                </span>
                {f}
              </li>
            ))}
          </ul>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="לשיחת ייעוץ למיקרובליידינג בוואצאפ"
              className="inline-flex items-center gap-2 bg-brand-gold text-brand-dark font-bold text-base px-8 py-4 rounded-full hover:bg-brand-gold-dark transition-all duration-200 shadow-gold hover:-translate-y-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-linen w-full sm:w-auto justify-center"
            >
              <WhatsAppIcon className="w-5 h-5" />
              לשיחת ייעוץ ללא התחייבות
            </a>
            <span className="inline-flex items-center gap-1.5 text-brand-medium text-sm">
              <Clock className="w-4 h-4 text-brand-rose" aria-hidden="true" />
              משך הטיפול 2–3 שעות
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
