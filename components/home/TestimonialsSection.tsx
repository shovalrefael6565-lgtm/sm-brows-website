'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useInView } from 'framer-motion'
import Image from 'next/image'

const TESTIMONIALS = [
  {
    id: 1,
    bubbles: [
      'חיים שלייי 🙏',
      'תודההה',
      'יצא מושלםםםם',
      'אין לך מושג איזה מרוצה אני 😍',
    ],
    time: '17:10',
    service: 'עיצוב גבות טבעי',
    image: '/ba-new-1.jpg',
  },
  {
    id: 2,
    bubbles: [
      'שמעי אחותי מרוב שהגבות שלי דלות הייתי מורטת לבד!!',
      'עכשיו אני רואה את ההבדל המשמעותי הזה!!!!',
      'אין על הידיים שלך בעולם 🙏❤️❤️',
      'והגל החדש נדיר — תזמני לי 2 שיהיה לי גם לבסיס',
    ],
    time: '15:21',
    service: 'מיקרובליידינג',
    image: '/ba-new-2.jpg',
  },
  {
    id: 3,
    bubbles: [
      'לא נרגעת מהגבותתתת',
      'אלופה שלי אין כמוך ❤️',
    ],
    time: '10:50',
    service: 'הרמת גבות',
    image: '/ba-new-3.jpg',
  },
  {
    id: 4,
    bubbles: [
      'אמאלה שובל חיים שלי תודה!!! את לא מבינה!!!',
      'אני אחרי מקלחת הרטבתי את הגבות והן מורמות ונדירות ומסודרות כאילו',
      'אין גבות מושלם כזה בעולם ❤️❤️❤️❤️',
    ],
    time: '21:28',
    service: 'הרמת גבות',
    image: '/ba-new-4.jpg',
  },
  {
    id: 5,
    bubbles: [
      'מה זה הגבות האלללווו??????????',
      'אמאלה שרטוט 🤩',
    ],
    time: '9:20',
    service: 'עיצוב גבות',
    image: '/ba-new-5.jpg',
  },
]

/* ────────────────────────────────────────────────
   WhatsApp-style card
   ──────────────────────────────────────────────── */
function WhatsAppCard({
  bubbles,
  time,
  image,
}: {
  bubbles: string[]
  time: string
  image: string
}) {
  return (
    <div
      className="rounded-[2rem] overflow-hidden shadow-2xl"
      style={{ direction: 'rtl', border: '3px solid rgba(0,0,0,0.06)' }}
    >
      {/* Header */}
      <div style={{ backgroundColor: '#075E54' }} className="px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-brand-gold flex-shrink-0 flex items-center justify-center text-brand-dark font-bold text-base">
            S
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">S.M BROWS</p>
            <p style={{ color: 'rgba(255,255,255,0.65)' }} className="text-xs">online</p>
          </div>
          {/* Search icon */}
          <svg className="w-5 h-5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.75)' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
          </svg>
        </div>
      </div>

      {/* Chat body */}
      <div
        className="relative px-3 pb-5 pt-3 flex flex-col gap-1.5"
        style={{ backgroundColor: '#ece5dd', minHeight: '260px' }}
      >
        {/* Background image — very subtle */}
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <Image
            src={image}
            alt=""
            fill
            className="object-cover"
            style={{ opacity: 0.12, filter: 'blur(1px)' }}
          />
        </div>

        {/* Bubbles */}
        {bubbles.map((bubble, i) => (
          <div key={i} className="relative flex justify-start">
            <div
              className={`bg-white px-3 py-2 max-w-[88%] shadow-sm ${
                i === 0 ? 'rounded-b-2xl rounded-bl-2xl rounded-tl-none rounded-tr-2xl' : 'rounded-2xl'
              }`}
            >
              <p className="text-gray-800 text-sm leading-relaxed">{bubble}</p>
              {i === bubbles.length - 1 && (
                <p className="text-gray-400 text-[10px] mt-0.5 text-start">{time}</p>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator dots */}
        <div className="relative flex justify-start mt-1" aria-hidden="true">
          <div className="bg-white rounded-2xl px-3.5 py-2.5 shadow-sm">
            <div className="flex gap-1 items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────
   Main section
   ──────────────────────────────────────────────── */
export default function TestimonialsSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)

  const next = useCallback(() => setCurrent((c) => (c + 1) % TESTIMONIALS.length), [])
  const prev = useCallback(
    () => setCurrent((c) => (c - 1 + TESTIMONIALS.length) % TESTIMONIALS.length),
    []
  )

  useEffect(() => {
    if (paused) return
    const timer = setInterval(next, 5000)
    return () => clearInterval(timer)
  }, [paused, next])

  const t = TESTIMONIALS[current]

  return (
    <section
      ref={ref}
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="section-padding bg-brand-rose-bg overflow-hidden"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div
          className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >

          {/* ── Column 1 (RTL = RIGHT): Text content ── */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7 }}
          >
            <p className="text-xs tracking-[0.2em] text-brand-gold font-semibold uppercase mb-2">
              ביקורות אמיתיות
            </p>
            <h2
              id="testimonials-heading"
              className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark mb-3"
            >
              לקוחות{' '}
              <span className="text-brand-rose">ממליצות</span>
            </h2>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-14 h-1 rounded-full bg-brand-gold" />
              <span className="text-brand-gold font-serif text-xl select-none">✦</span>
            </div>

            {/* Animated testimonial body */}
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.38 }}
                className="mb-8"
              >
                {/* Service badge */}
                <span className="inline-block bg-white border border-brand-rose-light text-brand-rose text-xs font-semibold px-3 py-1 rounded-full mb-5">
                  {t.service}
                </span>

                {/* Quote */}
                <blockquote
                  className="text-brand-dark text-lg sm:text-xl leading-relaxed font-medium mb-5"
                  lang="he"
                >
                  ״{t.bubbles.join(' ')}״
                </blockquote>

                {/* Stars */}
                <div className="flex gap-1" aria-label="דירוג 5 מתוך 5 כוכבים" role="img">
                  {[...Array(5)].map((_, i) => (
                    <svg
                      key={i}
                      className="w-5 h-5 text-brand-gold"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Navigation: dots + arrows */}
            <div className="flex items-center gap-5">
              {/* Dots */}
              <div className="flex gap-2" role="tablist" aria-label="ביקורות">
                {TESTIMONIALS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === current}
                    aria-label={`ביקורת ${i + 1}`}
                    onClick={() => { setCurrent(i); setPaused(true) }}
                    className={`transition-all duration-300 rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose ${
                      i === current
                        ? 'w-7 h-2.5 bg-brand-rose'
                        : 'w-2.5 h-2.5 bg-brand-rose/30 hover:bg-brand-rose/60'
                    }`}
                  />
                ))}
              </div>

              {/* Arrow buttons */}
              <div className="flex gap-2 me-1">
                <button
                  type="button"
                  onClick={() => { prev(); setPaused(true) }}
                  aria-label="ביקורת קודמת"
                  className="w-9 h-9 rounded-full border border-brand-rose-light flex items-center justify-center text-brand-rose hover:bg-brand-rose hover:text-white hover:border-brand-rose transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => { next(); setPaused(true) }}
                  aria-label="ביקורת הבאה"
                  className="w-9 h-9 rounded-full border border-brand-rose-light flex items-center justify-center text-brand-rose hover:bg-brand-rose hover:text-white hover:border-brand-rose transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              </div>
            </div>
          </motion.div>

          {/* ── Column 2 (RTL = LEFT): WhatsApp Card ── */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.18 }}
            className="max-w-sm mx-auto lg:mx-0 w-full"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.38 }}
              >
                <WhatsAppCard bubbles={t.bubbles} time={t.time} image={t.image} />
              </motion.div>
            </AnimatePresence>
          </motion.div>

        </div>
      </div>
    </section>
  )
}
