'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { galleryItems } from '@/lib/data'

const PREVIEW_ITEMS = galleryItems.filter((g) => g.type !== 'before-after').slice(0, 6)

export default function GalleryPreview() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section
      ref={ref}
      id="gallery"
      aria-labelledby="gallery-preview-heading"
      className="section-padding bg-brand-cream"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="flex items-end justify-between mb-10 flex-wrap gap-4"
        >
          <div>
            <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold-text font-semibold uppercase mb-2">
              הגלריה שלי
            </p>
            <h2
              id="gallery-preview-heading"
              className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark"
            >
              עבודות שאני
              <span className="text-brand-rose"> גאה בהן</span>
            </h2>
          </div>
          <Link
            href="/services"
            aria-label="לעמוד הטיפולים"
            className="inline-flex items-center gap-1.5 text-brand-rose font-semibold hover:text-brand-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            לעמוד הטיפולים
          </Link>
        </motion.div>

        {/* Grid */}
        <ul
          className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4"
          role="list"
          aria-label="תמונות מהגלריה"
        >
          {PREVIEW_ITEMS.map((item, i) => (
            <motion.li
              key={item.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={isInView ? { opacity: 1, scale: 1 } : {}}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className={i === 0 ? 'col-span-2 sm:col-span-1 sm:row-span-2' : ''}
            >
              <Link
                href="/services"
                aria-label={`פתח גלריה – ${item.alt}`}
                className="group relative block rounded-2xl overflow-hidden focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-gold"
                style={{ height: i === 0 ? '100%' : undefined }}
              >
                <div className={i === 0 ? 'h-64 sm:h-full' : 'h-36 sm:h-44'}>
                  <Image
                    src={item.image!}
                    alt={item.alt}
                    fill
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 640px) calc(50vw - 12px), calc(33vw - 16px)"
                    className="object-cover transition-transform duration-500 group-hover:scale-107"
                    style={{ objectPosition: item.objectPosition ?? '50% 50%' }}
                  />
                  <div
                    className="absolute inset-0 bg-brand-dark/0 group-hover:bg-brand-dark/20 transition-colors duration-300"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  )
}
