'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { galleryItems, type GalleryItem } from '@/lib/data'
import BeforeAfterSlider from './BeforeAfterSlider'
import Lightbox from './Lightbox'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'microblading' | 'natural' | 'lifting'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'הכל' },
  { value: 'microblading', label: 'מיקרובליידינג' },
  { value: 'natural', label: 'עיצוב טבעי' },
  { value: 'lifting', label: 'הרמת גבות' },
]

const CATEGORY_LABELS: Record<GalleryItem['category'], string> = {
  microblading: 'מיקרובליידינג',
  natural: 'עיצוב גבות טבעי',
  lifting: 'הרמת גבות',
}

const CATEGORY_ORDER: GalleryItem['category'][] = ['microblading', 'natural', 'lifting']

export default function GalleryGrid() {
  const [filter, setFilter] = useState<Filter>('all')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const filtered = useMemo(
    () => filter === 'all' ? galleryItems : galleryItems.filter((g) => g.category === filter),
    [filter]
  )

  const lightboxImages = useMemo(
    () =>
      filtered.map((item) => ({
        src: item.type === 'before-after' ? (item.afterImage ?? '') : (item.image ?? ''),
        alt: item.alt,
        caption: item.caption,
      })),
    [filtered]
  )

  const openLightbox = (item: GalleryItem) => {
    if (item.type === 'before-after') return
    const idx = filtered.findIndex((f) => f.id === item.id)
    setLightboxIndex(idx)
  }

  return (
    <>
      {/* Filter tabs */}
      <div
        className="flex items-center justify-center flex-wrap gap-2 mb-10"
        role="group"
        aria-label="סינון גלריה לפי קטגוריה"
      >
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            aria-label={`סנן לפי: ${label}`}
            className={cn(
              'px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
              filter === value
                ? 'bg-brand-gold text-brand-dark shadow-gold'
                : 'bg-white text-brand-medium border border-brand-cream-dark hover:border-brand-rose hover:text-brand-rose'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* All view — grouped by category */}
      {filter === 'all' ? (
        <div className="space-y-10">
          {CATEGORY_ORDER.map((cat) => {
            const items = galleryItems.filter((g) => g.category === cat)
            return (
              <section key={cat} aria-labelledby={`gallery-section-${cat}`}>
                <h3
                  id={`gallery-section-${cat}`}
                  className="font-serif text-lg font-bold text-brand-dark mb-4 pb-2 border-b border-brand-cream-dark"
                >
                  {CATEGORY_LABELS[cat]}
                </h3>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4" role="list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <GalleryCard item={item} onClick={() => openLightbox(item)} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        /* Filtered single-category view */
        <motion.ul
          layout
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4"
          role="list"
          aria-label="גלריית עבודות"
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((item) => (
              <motion.li
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
              >
                <GalleryCard item={item} onClick={() => openLightbox(item)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      {/* Lightbox */}
      <Lightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onNext={() => setLightboxIndex((i) => (i !== null ? (i + 1) % filtered.length : null))}
        onPrev={() =>
          setLightboxIndex((i) =>
            i !== null ? (i - 1 + filtered.length) % filtered.length : null
          )
        }
      />
    </>
  )
}

function GalleryCard({ item, onClick }: { item: GalleryItem; onClick: () => void }) {
  const isBeforeAfter = item.type === 'before-after'
  const height = 'h-52 sm:h-56'

  if (isBeforeAfter) {
    return (
      <article
        className={cn('relative rounded-2xl overflow-hidden', height)}
        aria-label={item.alt}
      >
        <BeforeAfterSlider
          beforeSrc={item.beforeImage!}
          afterSrc={item.afterImage!}
          alt={item.alt}
          leftLabel=""
          rightLabel=""
          leftObjectPosition={item.leftObjectPosition}
          rightObjectPosition={item.rightObjectPosition}
          rightScale={item.rightScale}
        />
        <CategoryBadge category={item.category} />
      </article>
    )
  }

  return (
    <article className={cn('relative rounded-2xl overflow-hidden group', height)}>
      <button
        type="button"
        onClick={onClick}
        aria-label={`הגדל תמונה: ${item.alt}`}
        className="relative w-full h-full cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-gold focus-visible:ring-inset block"
      >
        <Image
          src={item.image!}
          alt={item.alt}
          fill
          loading="lazy"
          decoding="async"
          sizes="(max-width: 640px) calc(100vw - 32px), (max-width: 1024px) calc(50vw - 24px), calc(33vw - 24px)"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          style={{
            objectPosition: item.objectPosition ?? '50% 50%',
            transform: item.imageTransform ?? (item.flipX ? 'scaleX(-1)' : undefined),
          }}
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-brand-dark/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          aria-hidden="true"
        />
      </button>
      <CategoryBadge category={item.category} />
    </article>
  )
}

function CategoryBadge({ category }: { category: GalleryItem['category'] }) {
  return (
    <span
      className="absolute top-3 start-3 bg-white/85 backdrop-blur-sm text-brand-rose text-[11px] font-semibold px-2.5 py-1 rounded-full pointer-events-none"
      aria-hidden="true"
    >
      {CATEGORY_LABELS[category]}
    </span>
  )
}
