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
    id: 'ba1',
    label: 'מיקרובליידינג',
    beforeSrc: '/microblading-1.jpg',
    afterSrc: '/microblading-2.jpg',
    alt: 'השוואת זוויות מיקרובליידינג',
    leftObjectPosition: '50% 30%',
    rightObjectPosition: '50% 18%',
  },
  {
    id: 'ba2',
    label: 'עיצוב גבות טבעי',
    beforeSrc:
      'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=700&h=500&q=80&auto=format&fit=crop&fp-y=0.3',
    afterSrc:
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=700&h=500&q=80&auto=format&fit=crop&fp-y=0.35',
    alt: 'לפני ואחרי עיצוב גבות טבעי',
  },
  {
    id: 'ba3',
    label: 'הרמת גבות',
    beforeSrc: '/brow-lifting-before.jpg',
    afterSrc: '/brow-lifting-after.jpg',
    alt: 'לפני ואחרי הרמת גבות',
    leftObjectPosition: '50% 14%',
    rightObjectPosition: '50% 20%',
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
            התוצאות מדברות
          </p>
          <h2
            id="ba-heading"
            className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-brand-dark mb-4"
          >
            לפני
            <span className="text-brand-rose"> ואחרי</span>
          </h2>
          <p className="text-brand-medium max-w-xl mx-auto leading-relaxed">
            גררי את המחוון ותגלי את ההבדל. כל תמונה היא לקוחה אמיתית — תוצאות שמדברות בעד עצמן.
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
                    leftLabel={pair.id === 'ba1' || pair.id === 'ba3' ? '' : 'לפני'}
                    rightLabel={pair.id === 'ba1' || pair.id === 'ba3' ? '' : 'אחרי'}
                    leftObjectPosition={pair.leftObjectPosition}
                    rightObjectPosition={pair.rightObjectPosition}
                    objectPosition={pair.id === 'ba2' ? 'center' : undefined}
                  />
                </div>
                <div className="px-4 py-3 bg-brand-cream flex items-center justify-between">
                  <span className="text-sm font-semibold text-brand-dark">{pair.label}</span>
                  <span className="text-xs text-brand-muted">גרררי את המחוון</span>
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  )
}
