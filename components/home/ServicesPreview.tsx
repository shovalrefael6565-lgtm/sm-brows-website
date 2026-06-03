'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion, useInView } from 'framer-motion'
import { useRef, useState, useEffect } from 'react'
import { ArrowLeft, Clock } from 'lucide-react'
import { services } from '@/lib/data'
import { WHATSAPP_URL } from '@/lib/utils'

function ServiceImageSlider({ images, imagePositions, name, active }: { images: string[]; imagePositions?: string[]; name: string; active?: boolean }) {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    if (!active || images.length <= 1) return
    const interval = setInterval(() => {
      setCurrent((i) => (i + 1) % images.length)
    }, 3500)
    return () => clearInterval(interval)
  }, [images.length, active])

  return (
    <div className="relative h-52 overflow-hidden flex-shrink-0 bg-brand-cream">
      {images.map((src, i) => (
        <div
          key={src}
          className="absolute inset-0"
          style={{
            opacity: i === current ? 1 : 0,
            transition: 'opacity 380ms ease-in-out',
            willChange: 'opacity',
            transform: 'translateZ(0)',
          }}
          aria-hidden={i !== current}
        >
          <Image
            src={src}
            alt={i === 0 ? name : ''}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
            style={{ objectPosition: imagePositions?.[i] ?? '50% 50%' }}
            loading="lazy"
          />
        </div>
      ))}
      <div
        className="absolute inset-0 bg-gradient-to-t from-brand-dark/30 to-transparent pointer-events-none z-10"
        aria-hidden="true"
      />
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" aria-hidden="true">
        {images.map((_, i) => (
          <span
            key={i}
            className={`rounded-full transition-all duration-300 ${
              i === current ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

export default function ServicesPreview() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section
      ref={ref}
      id="services"
      aria-labelledby="services-heading"
      className="section-padding bg-white"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <h2
            id="services-heading"
            className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold text-brand-dark mb-4"
          >
            הטיפולים שלי
          </h2>
          <p className="text-brand-medium max-w-xl mx-auto leading-relaxed">
            שלושה טיפולים, כל אחד עם תוצאה אחרת — בואי נמצא יחד מה הכי מתאים לך.
          </p>
        </motion.div>

        {/* Service cards */}
        <ul
          className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8"
          role="list"
          aria-label="רשימת טיפולים"
        >
          {services.map((service, i) => (
            <motion.li
              key={service.id}
              initial={{ opacity: 0, y: 32 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.15, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="group"
            >
              <article
                className="h-full bg-white rounded-3xl overflow-hidden shadow-soft hover:shadow-soft-lg transition-all duration-300 border border-brand-cream-dark/50 hover:-translate-y-1 flex flex-col"
                aria-label={`טיפול: ${service.name}`}
              >
                {/* Auto-rotating image — paused when section is not in viewport */}
                <ServiceImageSlider
                  images={service.homeImages ?? service.images}
                  imagePositions={service.homeImagePositions ?? service.imagePositions}
                  name={service.name}
                  active={isInView}
                />

                {/* Content */}
                <div className="p-6 flex flex-col flex-1">
                  <h3 className="font-serif text-2xl font-bold text-brand-dark tracking-wide">
                    {service.name}
                  </h3>
                  <div className="flex items-center gap-2 mb-3 mt-2" aria-hidden="true">
                    <span className="w-8 h-px bg-brand-rose-light" />
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-rose" />
                  </div>
                  <p className="text-brand-medium text-sm leading-relaxed mb-4 flex-1">
                    {service.homeDescription ?? service.description}
                  </p>

                  {/* Features */}
                  <ul className="space-y-1.5 mb-5" aria-label={`תכונות של ${service.name}`}>
                    {service.features.slice(0, 3).map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-xs text-brand-medium">
                        <span
                          className="w-4 h-4 rounded-full bg-brand-rose-bg flex items-center justify-center flex-shrink-0"
                          aria-hidden="true"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-rose" />
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {/* Price & Duration */}
                  <div className="flex items-center justify-between mb-5 py-3 border-t border-b border-brand-cream-dark/50">
                    <div>
                      <p className="text-xs text-brand-muted">מחיר</p>
                      <p className="font-bold text-brand-dark text-sm">{service.price}</p>
                    </div>
                    <div className="flex items-center gap-1 text-brand-muted">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span className="text-xs">{service.duration}</span>
                    </div>
                  </div>

                  {/* CTAs */}
                  <div className="flex gap-2">
                    <a
                      href={WHATSAPP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`קביעת תור לטיפול ${service.name} בוואצאפ`}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-brand-gold text-brand-dark font-semibold text-sm py-3 rounded-xl hover:bg-brand-gold-dark transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                    >
                      <WhatsAppSmIcon />
                      {service.name === 'מיקרובליידינג' ? 'לשיחת ייעוץ ללא התחייבות' : 'וואצאפ'}
                    </a>
                    {service.name === 'עיצוב גבות טבעיות' && (
                      <Link
                        href="/booking"
                        aria-label={`קביעת תור לטיפול ${service.name} ביומן`}
                        className="flex-1 flex items-center justify-center gap-1.5 border border-brand-rose-light text-brand-dark font-semibold text-sm py-3 rounded-xl hover:bg-brand-rose-bg hover:border-brand-rose transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
                      >
                        <CalendarIcon className="w-3.5 h-3.5 text-brand-rose" />
                        ביומן
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            </motion.li>
          ))}
        </ul>

        {/* View all link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="text-center mt-10"
        >
          <Link
            href="/services"
            aria-label="צפייה בעמוד הטיפולים המלא"
            className="inline-flex items-center gap-2 text-brand-rose font-semibold hover:text-brand-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            לכל הטיפולים
          </Link>
        </motion.div>
      </div>
    </section>
  )
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function WhatsAppSmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
