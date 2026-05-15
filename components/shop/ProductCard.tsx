'use client'

import { useState } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingBag, Check, Download } from 'lucide-react'
import { type Product } from '@/lib/data'
import { cn, WHATSAPP_URL } from '@/lib/utils'

interface Props {
  product: Product
}

export default function ProductCard({ product }: Props) {
  const [added, setAdded] = useState(false)

  const handleAdd = () => {
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  return (
    <article
      aria-label={`מוצר: ${product.name}`}
      className="group bg-white rounded-3xl overflow-hidden shadow-soft hover:shadow-soft-lg transition-all duration-300 hover:-translate-y-1 flex flex-col border border-brand-cream-dark/50"
    >
      {/* Image */}
      <div className="relative h-52 bg-brand-cream overflow-hidden flex-shrink-0">
        <Image
          src={product.image}
          alt={`תמונה של ${product.name}`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {product.badge && (
          <span className="absolute top-3 end-3 bg-brand-gold text-brand-dark text-xs font-bold px-2.5 py-1 rounded-full">
            {product.badge}
          </span>
        )}

        <div
          className="absolute inset-0 bg-gradient-to-t from-brand-dark/10 to-transparent"
          aria-hidden="true"
        />
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-1">
        <span className="text-xs text-brand-gold font-semibold uppercase tracking-wider mb-1">
          {product.category}
        </span>
        <h3 className="font-semibold text-brand-dark mb-2 leading-snug">{product.name}</h3>
        <p className="text-brand-medium text-xs leading-relaxed mb-4 flex-1">
          {product.description}
        </p>

        <div className="flex items-center justify-between mt-auto">
          <p className="font-serif text-xl font-bold text-brand-dark" aria-label={`מחיר: ${product.price > 0 ? product.price + ' שקלים' : 'ליצירת קשר'}`}>
            {product.price > 0 ? `₪${product.price}` : 'לפרטים'}
          </p>

          {product.isDigital ? (
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`לרכישת ${product.name} בוואצאפ`}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-brand-gold text-brand-dark hover:bg-brand-gold-dark transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              לרכישה בוואצאפ
            </a>
          ) : (
          <button
            type="button"
            onClick={handleAdd}
            aria-label={`${added ? 'נוסף לסל' : 'הוסף לסל'}: ${product.name}`}
            aria-live="polite"
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
              added
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-brand-rose-bg text-brand-rose border border-brand-rose-light hover:bg-brand-rose hover:text-white hover:border-brand-rose'
            )}
          >
            <AnimatePresence mode="wait">
              {added ? (
                <motion.span
                  key="added"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  נוסף!
                </motion.span>
              ) : (
                <motion.span
                  key="add"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1.5"
                >
                  <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                  הוסף לסל
                </motion.span>
              )}
            </AnimatePresence>
          </button>
          )}
        </div>
      </div>
    </article>
  )
}
