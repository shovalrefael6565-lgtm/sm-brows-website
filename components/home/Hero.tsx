'use client'

import { useRef, useState, useEffect } from 'react'
import Image from 'next/image'
import { motion, useScroll, useTransform, useReducedMotion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { WHATSAPP_URL } from '@/lib/utils'

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.15, duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  }),
}

export default function Hero() {
  const ref = useRef<HTMLElement>(null)
  const prefersReduced = useReducedMotion()
  const [bookingOpen, setBookingOpen] = useState(false)
  const bookingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bookingRef.current && !bookingRef.current.contains(e.target as Node)) {
        setBookingOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  })
  const y = useTransform(scrollYProgress, [0, 1], ['0%', prefersReduced ? '0%' : '20%'])

  return (
    <section
      id="hero"
      ref={ref}
      aria-label="עמוד הבית – S.M BROWS"
      className="relative min-h-screen flex items-center overflow-hidden bg-hero-gradient"
    >
      {/* Decorative blobs */}
      <div
        aria-hidden="true"
        className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-brand-rose/10 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full bg-brand-gold/10 blur-3xl pointer-events-none"
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-28 pb-16 w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Text content */}
        <div className="order-2 lg:order-1 text-center lg:text-start">
          {/* Pre-title */}
          <motion.p
            custom={0}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="inline-flex items-center gap-2 text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-4"
          >
            <span
              className="w-8 h-px bg-brand-gold flex-shrink-0 hidden lg:inline-block"
              aria-hidden="true"
            />
            קליניקת גבות מקצועי באשקלון
          </motion.p>

          {/* Brand name */}
          <motion.h1
            custom={1}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="font-serif text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-bold text-brand-dark leading-none tracking-wide mb-2"
          >
            S.M BROWS
          </motion.h1>

          {/* Tagline */}
          <motion.p
            custom={2}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="font-serif text-xs sm:text-sm tracking-[0.25em] text-brand-gold font-medium uppercase mb-8 lg:mb-10"
            lang="en"
          >
            IT&apos;S ALL ABOUT YOUR EYEBROWS
          </motion.p>

          {/* Description */}
          <motion.p
            custom={3}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="text-brand-medium text-base sm:text-lg leading-relaxed mb-8 max-w-lg mx-auto lg:mx-0"
          >
            מיקרובליידינג, עיצוב גבות טבעי והרמת גבות – הגבות המושלמות שחלמת עליהן
            מחכה לך בקליניקה שלי באשקלון.
          </motion.p>

          {/* CTA buttons */}
          <motion.div
            custom={4}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="flex flex-col sm:flex-row items-center lg:items-start gap-3 justify-center lg:justify-start"
          >
            {/* Single booking button with dropdown */}
            <div ref={bookingRef} className="relative">
              <button
                type="button"
                onClick={() => setBookingOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={bookingOpen}
                aria-label="קביעת תור"
                className="inline-flex items-center gap-3 bg-brand-gold text-brand-dark font-bold text-base px-8 py-4 rounded-full shadow-gold hover:bg-brand-gold-dark transition-all duration-200 hover:-translate-y-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 select-none"
              >
                <CalendarIcon className="w-5 h-5" />
                קבעי תור
                <motion.span
                  animate={{ rotate: bookingOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-4 h-4" />
                </motion.span>
              </button>

              <AnimatePresence>
                {bookingOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute top-full mt-3 right-0 lg:right-auto lg:left-0 z-30 bg-white rounded-2xl shadow-[0_8px_40px_-8px_rgba(44,24,16,0.18)] border border-brand-cream-dark/60 overflow-hidden min-w-[220px]"
                    role="menu"
                  >
                    {/* WhatsApp option */}
                    <a
                      href={WHATSAPP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      role="menuitem"
                      onClick={() => setBookingOpen(false)}
                      className="flex items-center gap-3 px-5 py-4 hover:bg-brand-cream transition-colors cursor-pointer group border-b border-brand-cream-dark/40"
                    >
                      <span className="w-9 h-9 rounded-xl bg-[#25D366]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#25D366]/20 transition-colors">
                        <WhatsAppIcon className="w-4.5 h-4.5 text-[#25D366]" />
                      </span>
                      <div className="text-right">
                        <p className="text-sm font-bold text-brand-dark">תור בוואצאפ</p>
                        <p className="text-xs text-brand-muted">מענה מהיר</p>
                      </div>
                    </a>

                    {/* Calendar option */}
                    <Link
                      href="/booking"
                      role="menuitem"
                      onClick={() => setBookingOpen(false)}
                      className="flex items-center gap-3 px-5 py-4 hover:bg-brand-cream transition-colors cursor-pointer group"
                    >
                      <span className="w-9 h-9 rounded-xl bg-brand-rose/10 flex items-center justify-center flex-shrink-0 group-hover:bg-brand-rose/20 transition-colors">
                        <CalendarIcon className="w-4 h-4 text-brand-rose" />
                      </span>
                      <div className="text-right">
                        <p className="text-sm font-bold text-brand-dark">תור ביומן</p>
                        <p className="text-xs text-brand-muted">בחרי תאריך ושעה</p>
                      </div>
                    </Link>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Course button */}
            <Link
              href="/services#course"
              aria-label="לקורס עיצוב גבות המקצועי"
              className="inline-flex items-center gap-2 bg-brand-dark text-brand-gold font-bold text-base px-6 py-4 rounded-full border-2 border-brand-gold/60 hover:bg-brand-gold hover:text-brand-dark hover:border-brand-gold transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
            >
              לקורס המקצועי ←
            </Link>
          </motion.div>

          {/* Trust badges */}
          <motion.div
            custom={5}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="flex items-center gap-6 mt-10 justify-center lg:justify-start"
            role="list"
            aria-label="יתרונות S.M BROWS"
          >
            {[
              { num: '500+', label: 'לקוחות מרוצות' },
              { num: '5+', label: 'שנות ניסיון' },
              { num: '100%', label: 'שביעות רצון' },
            ].map(({ num, label }) => (
              <div key={num} className="text-center" role="listitem">
                <p className="font-serif text-xl font-bold text-brand-rose">{num}</p>
                <p className="text-xs text-brand-muted">{label}</p>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Hero image */}
        <motion.div
          className="order-1 lg:order-2 relative mx-auto lg:mx-0"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.div style={{ y }} className="relative">
            {/* Logo brand seal */}
            <div className="absolute top-4 start-4 z-10 hidden sm:block">
              <Image
                src="/logo.png"
                alt="S.M BROWS"
                width={72}
                height={72}
                className="rounded-2xl shadow-soft opacity-90"
              />
            </div>

            {/* Main image container */}
            <div className="relative w-80 h-96 sm:w-[430px] sm:h-[560px] lg:w-[540px] lg:h-[660px] rounded-[2rem] overflow-hidden shadow-soft-lg">
              <Image
                src="/hero.webp"
                alt="לקוחה עם גבות מושלמות – תוצאת מיקרובליידינג ב-S.M BROWS"
                fill
                priority
                sizes="(max-width: 640px) 320px, (max-width: 1024px) 430px, 540px"
                className="object-cover object-center scale-105"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-brand-dark/20 to-transparent"
                aria-hidden="true"
              />
            </div>

            {/* Bio card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="mt-4 relative bg-white rounded-3xl overflow-hidden shadow-[0_8px_40px_-8px_rgba(44,24,16,0.13)] border border-brand-rose-light/30"
            >
              <div className="px-6 py-5">
                {/* Name + tag */}
                <div className="flex flex-col items-center gap-1 mb-3">
                  <h3 className="font-serif text-xl font-bold text-brand-dark tracking-wide">
                    שובל מאירה
                  </h3>
                  <p className="text-brand-muted text-xs font-medium">אמא של לוי משה 🤍</p>
                </div>

                {/* Divider with title */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-brand-gold/30" />
                  <span className="text-[10px] text-brand-gold font-semibold tracking-[0.2em] uppercase whitespace-nowrap">
                    מומחית גבות · 5 שנות ניסיון
                  </span>
                  <div className="flex-1 h-px bg-brand-gold/30" />
                </div>

                {/* Quote */}
                <div className="relative">
                  <span className="absolute -top-2 -right-1 font-serif text-5xl text-brand-rose/20 leading-none select-none" aria-hidden="true">"</span>
                  <p className="text-brand-medium text-sm leading-relaxed text-center relative z-10 px-2">
                    תמיד הייתה לי משהו עם גבות — שלי תמיד היו עבות, טבעיות, מסודרות. אנשים היו עוצרים אותי ברחוב ושואלים מה עשיתי להן. מתישהו הבנתי שזה לא סתם מחמאה — זו התשוקה שלי.
                  </p>
                </div>

                {/* Closing line */}
                <div className="mt-3 pt-3 border-t border-brand-cream-dark/60 text-center">
                  <p className="text-brand-dark text-base font-serif">
                    כל טיפול הוא שילוב של דיוק, טבעיות וקלאסיות —
                    <span className="text-brand-rose"> גבות שמדברות בעד עצמן.</span>
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
        aria-hidden="true"
      >
        <span className="text-xs text-brand-muted tracking-wider">גלול למטה</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
          className="w-4 h-4 rounded-full border-2 border-brand-rose/40 flex items-center justify-center"
        >
          <div className="w-1 h-1 rounded-full bg-brand-rose" />
        </motion.div>
      </motion.div>
    </section>
  )
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
