'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'hero', label: 'ראשי' },
  { id: 'services', label: 'שירותים' },
  { id: 'before-after', label: 'לפני ואחרי' },
  { id: 'gallery', label: 'גלריה' },
  { id: 'why-us', label: 'למה אנחנו' },
  { id: 'blog', label: 'מאמרים' },
  { id: 'booking', label: 'קביעת תור' },
]

export default function SectionDots() {
  const [active, setActive] = useState('hero')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const observers: IntersectionObserver[] = []

    const showTimer = setTimeout(() => setVisible(true), 500)

    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (!el) return

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActive(id)
        },
        { threshold: 0.4, rootMargin: '-10% 0px -40% 0px' }
      )
      observer.observe(el)
      observers.push(observer)
    })

    return () => {
      clearTimeout(showTimer)
      observers.forEach((o) => o.disconnect())
    }
  }, [])

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.nav
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          aria-label="ניווט בין סקשנים"
          className="fixed top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-white/80 backdrop-blur-md rounded-full px-4 py-2.5 shadow-soft border border-brand-cream-dark/60"
        >
          {SECTIONS.map(({ id, label }) => {
            const isActive = active === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => scrollTo(id)}
                aria-label={`עבור אל: ${label}`}
                aria-current={isActive ? 'true' : undefined}
                title={label}
                className={cn(
                  'relative rounded-full transition-all duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                  isActive ? 'w-6 h-2.5 bg-brand-rose' : 'w-2.5 h-2.5 bg-brand-muted/40 hover:bg-brand-rose/50'
                )}
              />
            )
          })}
        </motion.nav>
      )}
    </AnimatePresence>
  )
}
