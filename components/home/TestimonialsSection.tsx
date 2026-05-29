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
  },
  {
    id: 3,
    bubbles: [
      'לא נרגעת מהגבותתתת',
      'אלופה שלי אין כמוך ❤️',
    ],
    time: '10:50',
  },
  {
    id: 4,
    bubbles: [
      'אמאלה שובל חיים שלי תודה!!! את לא מבינה!!!',
      'הרטבתי את הגבות והן מורמות ונדירות ומסודרות כאילו',
      'אין גבות מושלם כזה בעולם ❤️❤️❤️❤️',
    ],
    time: '21:28',
  },
  {
    id: 5,
    bubbles: [
      'מה זה הגבות האלללווו??????????',
      'אמאלה שרטוט 🤩',
    ],
    time: '9:20',
  },
]

/* ─────────────────────────────────────────
   Chat card — plain WA beige + white bubbles
   ───────────────────────────────────────── */
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
              style={{ borderRadius: i === 0 ? '0 1rem 1rem 1rem' : '1rem' }}
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

/* ─────────────────────────────────────────
   Section
   ───────────────────────────────────────── */
export default function TestimonialsSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })
  const [current, setCurrent] = useState(0)

  const next = useCallback(() => setCurrent((c) => (c + 1) % TESTIMONIALS.length), [])

  useEffect(() => {
    const timer = setInterval(next, 3000)
    return () => clearInterval(timer)
  }, [next])

  return (
    <section
      ref={ref}
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="section-padding relative overflow-hidden"
    >
      {/* Base */}
      <div className="absolute inset-0 bg-brand-rose-bg" aria-hidden="true" />

      {/* Section background image — 20% opacity, no blur */}
      <div className="absolute inset-0" aria-hidden="true">
        <Image
          src="/tools-bg.png"
          alt=""
          fill
          className="object-cover"
          style={{ opacity: 0.2 }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">

          {/* Column 1 (RTL = RIGHT): heading only */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
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
            <div className="flex items-center gap-3">
              <div className="w-14 h-1 rounded-full bg-brand-gold" />
              <span className="text-brand-gold font-serif text-xl select-none" aria-hidden="true">✦</span>
            </div>
          </motion.div>

          {/* Column 2 (RTL = LEFT): chat card */}
          <motion.div
            initial={{ opacity: 0, y: 28 }}
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
                <ChatCard bubbles={TESTIMONIALS[current].bubbles} time={TESTIMONIALS[current].time} />
              </motion.div>
            </AnimatePresence>
          </motion.div>

        </div>
      </div>
    </section>
  )
}
