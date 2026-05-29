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
  },
  {
    id: 3,
    bubbles: [
      'לא נרגעת מהגבותתתת',
      'אלופה שלי אין כמוך ❤️',
    ],
    time: '10:50',
    service: 'הרמת גבות',
  },
  {
    id: 4,
    bubbles: [
      'אמאלה שובל חיים שלי תודה!!! את לא מבינה!!!',
      'הרטבתי את הגבות והן מורמות ונדירות ומסודרות כאילו',
      'אין גבות מושלם כזה בעולם ❤️❤️❤️❤️',
    ],
    time: '21:28',
    service: 'הרמת גבות',
  },
  {
    id: 5,
    bubbles: [
      'מה זה הגבות האלללווו??????????',
      'אמאלה שרטוט 🤩',
    ],
    time: '9:20',
    service: 'עיצוב גבות',
  },
]

/* ────────────────────────────────────────────────
   Simple chat-style card — plain beige, no WA header
   ──────────────────────────────────────────────── */
function ChatCard({ bubbles, time }: { bubbles: string[]; time: string }) {
  return (
    <div
      className="rounded-[2rem] overflow-hidden shadow-xl"
      style={{
        direction: 'rtl',
        backgroundColor: '#ece5dd',
        border: '2px solid rgba(0,0,0,0.06)',
      }}
    >
      <div className="px-5 pt-5 pb-6 flex flex-col gap-2">
        {bubbles.map((bubble, i) => (
          <div key={i} className="flex justify-start">
            <div
              className="bg-white px-4 py-2.5 max-w-[90%] shadow-sm"
              style={{
                borderRadius: i === 0 ? '0 1rem 1rem 1rem' : '1rem',
              }}
            >
              <p className="text-gray-800 text-sm leading-relaxed">{bubble}</p>
              {i === bubbles.length - 1 && (
                <p className="text-gray-400 text-[10px] mt-1 text-start">{time}</p>
              )}
            </div>
          </div>
        ))}
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

  const next = useCallback(() => setCurrent((c) => (c + 1) % TESTIMONIALS.length), [])

  useEffect(() => {
    const timer = setInterval(next, 3000)
    return () => clearInterval(timer)
  }, [next])

  const t = TESTIMONIALS[current]

  return (
    <section
      ref={ref}
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="section-padding relative overflow-hidden"
    >
      {/* Base background */}
      <div className="absolute inset-0 bg-brand-rose-bg" aria-hidden="true" />

      {/* Tools background image — 20 % opacity, no blur */}
      <div className="absolute inset-0" aria-hidden="true">
        <Image
          src="/tools-bg.jpg"
          alt=""
          fill
          className="object-cover"
          style={{ opacity: 0.2 }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">

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
              <span className="text-brand-gold font-serif text-xl select-none" aria-hidden="true">✦</span>
            </div>

            {/* Animated testimonial body */}
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.35 }}
                className="mb-8"
              >
                <span className="inline-block bg-white/70 backdrop-blur-sm border border-brand-rose-light text-brand-rose text-xs font-semibold px-3 py-1 rounded-full mb-5">
                  {t.service}
                </span>

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

            {/* Progress bar — thin animated line, resets every 3s */}
            <div
              className="w-24 h-0.5 rounded-full overflow-hidden"
              style={{ backgroundColor: 'rgba(0,0,0,0.1)' }}
              aria-hidden="true"
            >
              <motion.div
                key={`progress-${current}`}
                className="h-full bg-brand-rose rounded-full"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 3, ease: 'linear' }}
              />
            </div>
          </motion.div>

          {/* ── Column 2 (RTL = LEFT): Chat card ── */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
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
              >
                <ChatCard bubbles={t.bubbles} time={t.time} />
              </motion.div>
            </AnimatePresence>
          </motion.div>

        </div>
      </div>
    </section>
  )
}
