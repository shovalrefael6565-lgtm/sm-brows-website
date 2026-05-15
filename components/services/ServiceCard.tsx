'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useCallback } from 'react'
import { Clock, Check, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { type Service } from '@/lib/data'
import { WHATSAPP_URL } from '@/lib/utils'
import BeforeAfterSlider from '@/components/gallery/BeforeAfterSlider'

interface Props {
  service: Service
  index: number
}

function ImageSlider({ images, alt, duration }: { images: string[]; alt: string; duration: string }) {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)
  const [direction, setDirection] = useState(1)

  const go = useCallback((idx: number, dir: number) => {
    setDirection(dir)
    setCurrent(idx)
  }, [])

  const prev = () => go((current - 1 + images.length) % images.length, -1)
  const next = useCallback(() => go((current + 1) % images.length, 1), [current, images.length, go])

  useEffect(() => {
    if (paused) return
    const timer = setInterval(next, 3000)
    return () => clearInterval(timer)
  }, [paused, next])

  return (
    <div
      className="relative rounded-3xl overflow-hidden shadow-soft-lg aspect-[4/3] group"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label={`תמונות של ${alt}`}
    >
      {/* Images */}
      <AnimatePresence initial={false}>
        <motion.div
          key={current}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
          className="absolute inset-0"
        >
          <Image
            src={images[current]}
            alt={`${alt} – תמונה ${current + 1}`}
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover object-top"
            style={{ filter: 'brightness(1.04) contrast(1.03) saturate(1.06)' }}
          />
          <div
            className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-brand-dark/20"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-gradient-to-br from-brand-rose/8 via-transparent to-brand-gold/5"
            aria-hidden="true"
          />
        </motion.div>
      </AnimatePresence>

      {/* Duration badge */}
      <div
        className="absolute bottom-4 end-4 glass-card rounded-2xl px-4 py-2 flex items-center gap-2 z-10"
        aria-hidden="true"
      >
        <Clock className="w-4 h-4 text-brand-gold" />
        <span className="text-sm font-semibold text-brand-dark">{duration}</span>
      </div>

      {/* Arrows — visible on hover */}
      <button
        type="button"
        onClick={prev}
        aria-label="תמונה קודמת"
        className="absolute top-1/2 -translate-y-1/2 start-3 z-10 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={next}
        aria-label="תמונה הבאה"
        className="absolute top-1/2 -translate-y-1/2 end-14 z-10 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
      </button>

      {/* Dots */}
      <div
        className="absolute bottom-4 start-4 flex items-center gap-1.5 z-10"
        role="tablist"
        aria-label="בחרי תמונה"
      >
        {images.map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === current}
            aria-label={`תמונה ${i + 1}`}
            onClick={() => go(i, i > current ? 1 : -1)}
            className={`transition-all duration-300 rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
              i === current
                ? 'w-4 h-1.5 bg-brand-gold'
                : 'w-1.5 h-1.5 bg-white/60 hover:bg-white'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

export default function ServiceCard({ service, index }: Props) {
  const isEven = index % 2 === 0

  return (
    <motion.article
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay: index * 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      aria-label={`טיפול: ${service.name}`}
      className={`grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center ${
        isEven ? '' : 'lg:[&>*:first-child]:order-2'
      }`}
    >
      {/* Image — comparison slider for microblading, auto carousel for others */}
      {service.id === 'microblading' && service.images.length >= 2 ? (
        <div className="relative rounded-3xl overflow-hidden aspect-[4/5] shadow-soft-lg">
          <BeforeAfterSlider
            beforeSrc={service.images[0]}
            afterSrc={service.images[1]}
            alt={service.name}
            leftLabel="זווית 1"
            rightLabel="זווית 2"
            objectPosition="top"
          />
        </div>
      ) : (
        <ImageSlider
          images={service.images}
          alt={service.name}
          duration={service.duration}
        />
      )}

      {/* Content */}
      <div>
        <p className="text-xs tracking-[0.2em] text-brand-gold font-semibold uppercase mb-2">
          {service.tagline}
        </p>
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark mb-4">
          {service.name}
        </h2>
        <p className="text-brand-medium leading-relaxed mb-6">{service.description}</p>

        {/* Features */}
        <ul className="space-y-3 mb-6" aria-label={`תכונות של ${service.name}`}>
          {service.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-brand-medium">
              <span
                className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-gold/20 flex items-center justify-center mt-0.5"
                aria-hidden="true"
              >
                <Check className="w-3 h-3 text-brand-gold-dark" />
              </span>
              {feature}
            </li>
          ))}
        </ul>

        {/* Price */}
        <div className="flex items-center gap-4 mb-6 p-4 bg-brand-rose-bg rounded-2xl border border-brand-rose-light/50">
          <div>
            <p className="text-xs text-brand-muted">מחיר הטיפול</p>
            <p className="font-serif text-2xl font-bold text-brand-dark">{service.price}</p>
          </div>
          <div className="h-10 w-px bg-brand-rose-light" aria-hidden="true" />
          <div>
            <p className="text-xs text-brand-muted">משך הטיפול</p>
            <p className="font-semibold text-brand-dark">{service.duration}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`קביעת תור לטיפול ${service.name} בוואצאפ`}
            className="inline-flex items-center gap-2 bg-brand-gold text-brand-dark font-bold px-8 py-4 rounded-full hover:bg-brand-gold-dark transition-colors duration-200 shadow-gold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
          >
            <WhatsAppIcon className="w-5 h-5" />
            קבעי תור בוואצאפ
          </a>
          <Link
            href="/booking"
            aria-label={`קביעת תור לטיפול ${service.name} ביומן`}
            className="inline-flex items-center gap-2 text-brand-dark font-medium px-6 py-4 rounded-full border border-brand-rose-light hover:bg-brand-rose-bg hover:border-brand-rose transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
          >
            <Calendar className="w-4 h-4 text-brand-rose" />
            קביעת תור ביומן
          </Link>
        </div>
      </div>
    </motion.article>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
