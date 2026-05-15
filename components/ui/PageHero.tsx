'use client'

import { motion } from 'framer-motion'

interface Props {
  tag?: string
  title: string
  titleHighlight?: string
  description?: string
}

export default function PageHero({ tag, title, titleHighlight, description }: Props) {
  return (
    <section
      aria-label="כותרת עמוד"
      className="pt-36 pb-16 sm:pt-44 sm:pb-20 bg-hero-gradient text-center"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {tag && (
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-3"
          >
            {tag}
          </motion.p>
        )}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold text-brand-dark mb-4"
        >
          {title}
          {titleHighlight && (
            <>
              {' '}
              <span className="text-brand-rose">{titleHighlight}</span>
            </>
          )}
        </motion.h1>
        {description && (
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-brand-medium text-base sm:text-lg leading-relaxed"
          >
            {description}
          </motion.p>
        )}
      </div>
    </section>
  )
}
