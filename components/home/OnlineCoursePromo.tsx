'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { Check, Monitor, Star, ArrowLeft } from 'lucide-react'
import { products } from '@/lib/data'
import { WHATSAPP_URL } from '@/lib/utils'

const onlineCourse = products.find((p) => p.isPremium)

export default function OnlineCoursePromo() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-60px' })

  if (!onlineCourse) return null

  return (
    <section
      id="online-course-section"
      ref={ref}
      aria-labelledby="online-course-heading"
      className="section-padding bg-brand-cream"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden rounded-3xl bg-white border border-brand-cream-dark/60 shadow-soft-lg"
        >
          {/* Gold top accent */}
          <div className="absolute top-0 inset-x-0 h-1 bg-gold-gradient" aria-hidden="true" />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
            {/* Image */}
            <div className="relative h-64 lg:h-auto overflow-hidden rounded-t-3xl lg:rounded-t-none lg:rounded-s-3xl">
              <Image
                src={onlineCourse.image}
                alt={`תמונה של ${onlineCourse.name}`}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-brand-dark/40 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:to-white/5"
                aria-hidden="true"
              />

              {/* Badge on image */}
              <div className="absolute top-4 start-4 flex flex-col gap-2">
                <span className="inline-flex items-center gap-1.5 bg-brand-gold text-brand-dark text-xs font-bold px-3 py-1.5 rounded-full shadow-gold">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-dark animate-pulse" aria-hidden="true" />
                  קורס אונליין
                </span>
                <span className="inline-flex items-center gap-1.5 bg-white/90 backdrop-blur-sm text-brand-dark text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm">
                  <Monitor className="w-3 h-3 text-brand-rose" aria-hidden="true" />
                  {onlineCourse.badge}
                </span>
              </div>
            </div>

            {/* Content */}
            <div className="p-8 sm:p-10 flex flex-col justify-center">
              <div className="flex items-center gap-1 mb-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} className="w-4 h-4 fill-brand-gold text-brand-gold" aria-hidden="true" />
                ))}
              </div>

              <p className="text-xs tracking-[0.2em] text-brand-gold-text font-semibold uppercase mb-2">
                {onlineCourse.category}
              </p>

              <h2
                id="online-course-heading"
                className="font-serif text-2xl sm:text-3xl font-bold text-brand-dark mb-3 leading-snug"
              >
                {onlineCourse.name}
              </h2>

              <p className="text-brand-medium text-sm leading-relaxed mb-5">
                {onlineCourse.description}
              </p>

              {onlineCourse.includes && onlineCourse.includes.length > 0 && (
                <ul className="space-y-2 mb-6" aria-label="מה כלול בקורס">
                  {onlineCourse.includes.map((item) => (
                    <li key={item} className="flex items-center gap-2.5 text-sm text-brand-medium">
                      <span
                        className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-gold/15 border border-brand-gold/30 flex items-center justify-center"
                        aria-hidden="true"
                      >
                        <Check className="w-3 h-3 text-brand-gold-dark" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {/* Price + CTA */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-5 border-t border-brand-cream-dark/50">
                <div>
                  <p className="text-xs text-brand-muted mb-0.5">מחיר הקורס</p>
                  <p
                    className="font-serif text-4xl font-bold text-brand-dark"
                    aria-label={`מחיר ${onlineCourse.price} שקלים`}
                  >
                    ₪{onlineCourse.price}
                  </p>
                  <p className="text-xs text-brand-muted">תשלום חד-פעמי</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 sm:ms-auto">
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`לרכישת ${onlineCourse.name} בוואצאפ`}
                    className="inline-flex items-center justify-center gap-2 bg-brand-gold text-brand-dark font-bold text-sm px-7 py-3.5 rounded-full hover:bg-brand-gold-dark transition-all duration-200 shadow-gold hover:-translate-y-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
                  >
                    <WhatsAppIcon className="w-4 h-4" />
                    לרכישה בוואצאפ
                  </a>
                  <Link
                    href="/shop"
                    aria-label="לחנות המוצרים"
                    className="inline-flex items-center justify-center gap-1.5 text-brand-rose font-medium text-sm px-5 py-3.5 rounded-full border border-brand-rose-light hover:bg-brand-rose-bg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
                  >
                    לחנות
                    <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
