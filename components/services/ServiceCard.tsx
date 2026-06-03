'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { type Service } from '@/lib/data'
import { WHATSAPP_URL } from '@/lib/utils'

interface Props {
  service: Service
  index: number
}

function ImageSlider({ images, alt, objectPositions, aspectRatio }: { images: string[]; alt: string; objectPositions?: string[]; aspectRatio?: string }) {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)
  const [touched, setTouched] = useState(false)
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const go = useCallback((idx: number) => setCurrent(idx), [])

  const prev = () => go((current - 1 + images.length) % images.length)
  const next = useCallback(() => go((current + 1) % images.length), [current, images.length, go])

  useEffect(() => {
    if (paused) return
    const timer = setInterval(next, 3500)
    return () => clearInterval(timer)
  }, [paused, next])

  const handleTouch = () => {
    setTouched(true)
    if (touchTimer.current) clearTimeout(touchTimer.current)
    touchTimer.current = setTimeout(() => setTouched(false), 3000)
  }

  return (
    <div
      className="relative rounded-3xl overflow-hidden shadow-soft-lg group bg-brand-cream"
      style={{ aspectRatio: aspectRatio ?? '4/2.04' }}
      onClick={handleTouch}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label={`תמונות של ${alt}`}
    >
      {/* All images rendered simultaneously — opacity crossfade only */}
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
            alt={i === 0 ? `${alt} – תמונה 1` : ''}
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover"
            style={{
              filter: 'brightness(1.04) contrast(1.03) saturate(1.06)',
              objectPosition: objectPositions?.[i] ?? 'top',
            }}
            loading={i === 0 ? 'eager' : 'lazy'}
            priority={i === 0}
          />
        </div>
      ))}

      {/* Gradients sit above all images */}
      <div
        className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-brand-dark/20 pointer-events-none z-10"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-gradient-to-br from-brand-rose/8 via-transparent to-brand-gold/5 pointer-events-none z-10"
        aria-hidden="true"
      />

      {/* Arrows — visible on hover */}
      <button
        type="button"
        onClick={prev}
        aria-label="תמונה קודמת"
        className={`absolute top-1/2 -translate-y-1/2 start-3 z-10 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white transition-opacity duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${touched ? 'opacity-100' : 'opacity-0'} sm:opacity-0 sm:group-hover:opacity-100`}
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={next}
        aria-label="תמונה הבאה"
        className={`absolute top-1/2 -translate-y-1/2 end-3 z-10 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white transition-opacity duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${touched ? 'opacity-100' : 'opacity-0'} sm:opacity-0 sm:group-hover:opacity-100`}
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
            onClick={() => go(i)}
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
      {/* Image */}
      <div className={service.imageAspect ? 'flex justify-center' : ''}>
        <div className={service.imageAspect ? 'w-full max-w-[300px]' : 'w-full'}>
          <ImageSlider
            images={service.images}
            alt={service.name}
            objectPositions={service.imagePositions}
            aspectRatio={service.imageAspect}
          />
        </div>
      </div>

      {/* Content */}
      <div>
        {service.tagline && (
          <p className="text-xs tracking-[0.2em] text-brand-gold font-semibold uppercase mb-2">
            {service.tagline}
          </p>
        )}
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark mb-4">
          {service.name}
        </h2>
        <p className="text-brand-medium leading-relaxed mb-6">{service.description}</p>

        {/* למי מתאים? */}
        {service.suitableFor && service.suitableFor.length > 0 && (
          <div className="mb-6">
            <p className="font-semibold text-brand-dark mb-3">למי מתאים?</p>
            <ul className="space-y-2" aria-label={`למי מתאים ${service.name}`}>
              {service.suitableFor.map((item) => (
                <li key={item} className="flex items-start gap-2 text-brand-medium text-sm">
                  <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-brand-rose" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

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
          {service.price && (
            <>
              <div>
                <p className="text-xs text-brand-muted">מחיר הטיפול</p>
                <p className="font-serif text-2xl font-bold text-brand-dark">{service.price}</p>
              </div>
              <div className="h-10 w-px bg-brand-rose-light" aria-hidden="true" />
            </>
          )}
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
            className="inline-flex items-center gap-2 bg-brand-linen text-brand-dark font-bold px-8 py-4 rounded-full hover:bg-brand-linen-dark transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
          >
            <WhatsAppIcon className="w-5 h-5" />
            {service.name === 'מיקרובליידינג' ? 'לשיחת ייעוץ ללא התחייבות' : 'קבעי תור בוואצאפ'}
          </a>
          {service.name === 'עיצוב גבות טבעיות' && (
            <Link
              href="/booking"
              aria-label={`קביעת תור לטיפול ${service.name} ביומן`}
              className="inline-flex items-center gap-2 text-brand-dark font-medium px-6 py-4 rounded-full border border-brand-rose-light hover:bg-brand-rose-bg hover:border-brand-rose transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
            >
              <Calendar className="w-4 h-4 text-brand-rose" />
              קביעת תור ביומן
            </Link>
          )}
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
