'use client'

import { motion } from 'framer-motion'
import { Construction, Sparkles } from 'lucide-react'
import PageHero from '@/components/ui/PageHero'

export default function ShopPage() {
  return (
    <>
      <PageHero
        tag="החנות שלי"
        title="מוצרי גבות"
        titleHighlight="מקצועיים"
        description="כל מה שצריך לשמור על הגבות מושלמות בין הטיפולים."
      />

      <section className="section-padding bg-brand-cream min-h-[50vh] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-md mx-auto text-center px-6"
        >
          <div className="w-20 h-20 rounded-full bg-brand-gold/15 flex items-center justify-center mx-auto mb-6">
            <Construction className="w-10 h-10 text-brand-gold" />
          </div>

          <h2 className="font-serif text-3xl font-bold text-brand-dark mb-3">
            החנות בבנייה
          </h2>

          <p className="text-brand-muted text-base leading-relaxed mb-6">
            אנחנו עובדות על משהו מיוחד! החנות תעלה בקרוב עם מוצרים מקצועיים שאני ממליצה עליהם.
          </p>

          <div className="flex items-center justify-center gap-2 text-brand-gold font-semibold text-sm">
            <Sparkles className="w-4 h-4" />
            <span>בקרוב...</span>
            <Sparkles className="w-4 h-4" />
          </div>
        </motion.div>
      </section>
    </>
  )
}
