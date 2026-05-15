'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ShoppingCart } from 'lucide-react'
import PageHero from '@/components/ui/PageHero'
import ProductCard from '@/components/shop/ProductCard'
import { products } from '@/lib/data'
import { cn } from '@/lib/utils'

const CATEGORIES = ['הכל', 'סרומים', 'כלים', 'ערכות', 'טיפוח', 'קורסים']

export default function ShopPage() {
  const [activeCategory, setActiveCategory] = useState('הכל')

  const premiumProducts = products.filter((p) => p.isPremium)
  const regularProducts = products.filter((p) => !p.isPremium)

  const filtered =
    activeCategory === 'הכל'
      ? regularProducts
      : regularProducts.filter((p) => p.category === activeCategory)

  return (
    <>
      <PageHero
        tag="החנות שלי"
        title="מוצרי גבות"
        titleHighlight="מקצועיים"
        description="כל מה שצריך לשמור על הגבות מושלמות בין הטיפולים. מוצרים מקצועיים שאני ממליצה עליהם."
      />

      <section aria-label="חנות מוצרים" className="section-padding bg-brand-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">

          {/* Premium featured products */}
          {premiumProducts.length > 0 && (
            <div className="mb-12">
              <p className="text-xs tracking-[0.2em] text-brand-gold font-semibold uppercase mb-4">
                מוצר מומלץ
              </p>
              <ul className="grid grid-cols-1 gap-5" role="list" aria-label="מוצרים מומלצים">
                {premiumProducts.map((product, i) => (
                  <motion.li
                    key={product.id}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08, duration: 0.5 }}
                  >
                    <ProductCard product={product} />
                  </motion.li>
                ))}
              </ul>
            </div>
          )}

          {/* Cart notice */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 bg-brand-gold/10 border border-brand-gold/30 rounded-2xl px-5 py-3 mb-8 text-sm text-brand-medium"
            role="status"
            aria-live="polite"
          >
            <ShoppingCart className="w-4 h-4 text-brand-gold flex-shrink-0" aria-hidden="true" />
            <span>
              החנות נמצאת בפיתוח – בקרוב תוכלי להזמין ישירות מהאתר! לרכישה כרגע, צרי קשר בוואצאפ.
            </span>
          </motion.div>

          {/* Filters */}
          <div
            className="flex items-center gap-2 flex-wrap mb-8"
            role="group"
            aria-label="סינון מוצרים לפי קטגוריה"
          >
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                aria-pressed={activeCategory === cat}
                aria-label={`סנן לפי קטגוריה: ${cat}`}
                className={cn(
                  'px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                  activeCategory === cat
                    ? 'bg-brand-gold text-brand-dark shadow-gold'
                    : 'bg-white text-brand-medium border border-brand-cream-dark hover:border-brand-rose hover:text-brand-rose'
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Products grid */}
          <ul
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
            role="list"
            aria-label="רשימת מוצרים"
          >
            {filtered.map((product, i) => (
              <motion.li
                key={product.id}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
              >
                <ProductCard product={product} />
              </motion.li>
            ))}
          </ul>

          {filtered.length === 0 && (
            <div className="text-center py-16 text-brand-muted" role="status">
              <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-40" aria-hidden="true" />
              <p>אין מוצרים בקטגוריה זו</p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
