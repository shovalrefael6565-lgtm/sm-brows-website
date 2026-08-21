'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

const PILLARS = [
  {
    heading: 'רק אני, כל הזמן',
    body: 'זה לא סלון עם כמה טכנאיות. מי שמקבלת אותך בפגישת הייעוץ, עושה את הטיפול, ועונה לוואצאפ אחר כך — זה אני. שובל. אחת.',
  },
  {
    heading: 'קוראת פנים לפני שמציירת קו',
    body: 'לפני כל טיפול אני לוקחת את הזמן לראות אותך — את הסימטריה, הגוון, הבעה הטבעית של הפנים. הגבות שמצוירות בסוף נראות כאילו תמיד היו שם.',
  },
  {
    heading: 'תוצאה שאי אפשר לאתר',
    body: 'אני עובדת בטכניקה שהתוצאה שלה נראית כל כך טבעית עד שאנשים לא מצליחים להבין מה השתנה — הם פשוט יגידו לך שאת נראית מדהים.',
  },
]

export default function WhyChooseUs() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section
      ref={ref}
      id="why-us"
      aria-labelledby="why-heading"
      className="relative overflow-hidden bg-brand-dark py-20 sm:py-28"
    >
      <div aria-hidden="true" className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-30 pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        {/* Editorial statement — left-aligned in RTL (leading side) */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl mb-16 sm:mb-20"
        >
          <h2
            id="why-heading"
            className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium text-white leading-[1.25] text-balance"
          >
            כל לקוחה מקבלת את שובל.{' '}
            <span className="text-brand-gold">לא עוזרת, לא תחליף — אני.</span>
          </h2>
        </motion.div>

        {/* Three prose columns — no icons, no cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 lg:gap-16">
          {PILLARS.map(({ heading, body }, i) => (
            <motion.div
              key={heading}
              initial={{ opacity: 0, y: 32 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.1 + i * 0.12, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="w-8 h-px bg-brand-gold mb-5" aria-hidden="true" />
              <h3 className="font-serif text-lg sm:text-xl font-medium text-white mb-3 leading-snug">
                {heading}
              </h3>
              <p className="text-white/55 text-sm sm:text-base leading-relaxed">{body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
