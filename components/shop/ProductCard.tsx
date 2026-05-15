'use client'

import { useState } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingBag, Check, Download, Star, Monitor } from 'lucide-react'
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

  if (product.isPremium) {
    return (
      <article
        aria-label={`מוצר פרימיום: ${product.name}`}
        className="relative overflow-hidden rounded-3xl bg-brand-dark text-white shadow-[0_20px_60px_-12px_rgba(44,24,16,0.5)] col-span-full"
      >
        <div className="absolute inset-0" aria-hidden="true">
          <Image
            src={product.image}
            alt={`תמונה של ${product.name}`}
            fill
            sizes="100vw"
            className="object-cover opacity-15"
          />
          <div className="absolute inset-0 bg-gradient-to-l from-brand-dark/60 via-brand-dark/90 to-brand-dark" />
        </div>
        <div className="absolute top-0 inset-x-0 h-1 bg-gold-gradient" aria-hidden="true" />

        <div className="relative grid grid-cols-1 lg:grid-cols-5 gap-8 p-8 sm:p-10">
          {/* Content — 3 cols */}
          <div className="lg:col-span-3 flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 bg-brand-gold/20 border border-brand-gold/40 text-brand-gold text-xs font-bold px-3 py-1.5 rounded-full tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-gold animate-pulse" aria-hidden="true" />
                קורס פרימיום
              </span>
              <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/80 text-xs font-semibold px-3 py-1.5 rounded-full">
                <Monitor className="w-3 h-3" aria-hidden="true" />
                {product.badge}
              </span>
            </div>

            <h3 className="font-serif text-2xl sm:text-3xl font-bold text-white mb-3 leading-snug">
              {product.name}
            </h3>
            <p className="text-white/70 text-sm leading-relaxed mb-5">{product.description}</p>

            {product.includes && product.includes.length > 0 && (
              <ul className="space-y-2 mb-6" aria-label="מה כלול בקורס">
                {product.includes.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-white/80">
                    <span
                      className="flex-shrink-0 w-4 h-4 rounded-full bg-brand-gold/20 border border-brand-gold/40 flex items-center justify-center"
                      aria-hidden="true"
                    >
                      <Check className="w-2.5 h-2.5 text-brand-gold" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            )}

            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`לרכישת ${product.name} בוואצאפ`}
              className="inline-flex items-center justify-center gap-2 bg-brand-gold text-brand-dark font-bold text-sm px-7 py-3.5 rounded-full hover:bg-brand-gold-light transition-all duration-200 shadow-gold hover:-translate-y-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark w-full sm:w-auto"
            >
              <WhatsAppIcon className="w-4 h-4" />
              לרכישה בוואצאפ
            </a>
          </div>

          {/* Price panel — 2 cols */}
          <div className="lg:col-span-2 flex items-center justify-center lg:justify-end">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className="w-4 h-4 fill-brand-gold text-brand-gold" aria-hidden="true" />
                ))}
              </div>
              <p className="text-white/50 text-xs uppercase tracking-widest mb-1">מחיר הקורס</p>
              <p
                className="font-serif text-5xl sm:text-6xl font-bold text-brand-gold leading-none mb-1"
                aria-label={`מחיר ${product.price} שקלים`}
              >
                ₪{product.price}
              </p>
              <p className="text-white/40 text-xs">תשלום חד-פעמי</p>
            </div>
          </div>
        </div>
      </article>
    )
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

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
