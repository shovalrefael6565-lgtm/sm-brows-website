'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import BeforeAfterSlider from '@/components/gallery/BeforeAfterSlider'

interface Pair {
  id: string
  label: string
  beforeSrc: string
  afterSrc: string
  alt: string
  leftObjectPosition?: string
  rightObjectPosition?: string
}

const PAIRS: Pair[] = [
  {
    id: 'ba6',
    label: 'עיצוב גבות טבעי',
    beforeSrc: '/natural-before-1.webp',
    afterSrc: '/natural-after-1.webp',
    alt: 'השוואת לפני ואחרי עיצוב גבות טבעי',
    leftObjectPosition: '50% 20%',
    rightObjectPosition: '50% 15%',
  },
  {
    id: 'ba1',
    label: 'מיקרובליידינג',
    beforeSrc: '/microblading-10.webp',
    afterSrc: '/microblading-11.webp',
    alt: 'השוואת לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 30%',
    rightObjectPosition: '50% 30%',
  },
  {
    id: 'ba2',
    label: 'מיקרובליידינג',
    beforeSrc: '/microblading-12.webp',
    afterSrc: '/microblading-13.webp',
    alt: 'השוואת לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 25%',
    rightObjectPosition: '50% 25%',
  },
  {
    id: 'ba3',
    label: 'מיקרובליידינג',
    beforeSrc: '/microblading-14.webp',
    afterSrc: '/microblading-15.webp',
    alt: 'השוואת לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 25%',
    rightObjectPosition: '50% 25%',
  },
  {
    id: 'ba4',
    label: 'מיקרובליידינג',
    beforeSrc: '/microblading-16.webp',
    afterSrc: '/microblading-17.webp',
    alt: 'השוואת לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 25%',
    rightObjectPosition: '50% 25%',
  },
  {
    id: 'ba5',
    label: 'מיקרובליידינג',
    beforeSrc: '/microblading-18.webp',
    afterSrc: '/microblading-19.webp',
    alt: 'השוואת לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 25%',
    rightObjectPosition: '50% 25%',
  },
]

export default function BeforeAfterSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section
      id="before-after"
      ref={ref}
      aria-labelledby="ba-heading"
      className="section-padding bg-white"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-3">
            מיקרובליידינג
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
            כל תמונה היא לקוחה אמיתית — תוצאות שמדברות בעד עצמן.
          </p>
        </motion.div>

        <ul
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
          role="list"
          aria-label="השוואות לפני ואחרי"
        >
          {PAIRS.map((pair, i) => (
            <motion.li
              key={pair.id}
              initial={{ opacity: 0, y: 32 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.15, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="rounded-3xl overflow-hidden shadow-soft border border-brand-cream-dark/50">
                <div className="h-64 sm:h-72">
                  <BeforeAfterSlider
                    beforeSrc={pair.beforeSrc}
                    afterSrc={pair.afterSrc}
                    alt={pair.alt}
                    leftLabel=""
                    rightLabel=""
                    leftObjectPosition={pair.leftObjectPosition}
                    rightObjectPosition={pair.rightObjectPosition}
                  />
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  )
}
