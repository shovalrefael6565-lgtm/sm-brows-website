'use client'

import Image from 'next/image'
import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { Check, Monitor, Users, MapPin, CalendarDays } from 'lucide-react'
import { courseService } from '@/lib/data'
import { WHATSAPP_URL } from '@/lib/utils'

export default function CourseCard() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      <article
        aria-label="קורס עיצוב גבות מקצועי – פרימיום"
        className="relative overflow-hidden rounded-3xl bg-brand-dark text-white shadow-[0_20px_80px_-12px_rgba(44,24,16,0.4)]"
      >
        {/* Background image with overlay */}
        <div className="absolute inset-0" aria-hidden="true">
          <Image
            src={courseService.image}
            alt="קורס עיצוב גבות מקצועי"
            fill
            sizes="100vw"
            className="object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-brand-dark via-brand-dark/95 to-brand-dark/70" />
        </div>

        {/* Gold border accent top */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gold-gradient" aria-hidden="true" />

        <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-8 p-8 sm:p-12">
          {/* Content */}
          <div className="flex flex-col justify-center">
            {/* Badge */}
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 bg-brand-gold/20 border border-brand-gold/40 text-brand-gold text-xs font-bold px-3 py-1.5 rounded-full tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-gold animate-pulse" aria-hidden="true" />
                קורס פרימיום
              </span>
            </div>

            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-white mb-3 leading-snug">
              {courseService.name}
            </h2>

            <p className="text-white/70 leading-relaxed mb-6">
              {courseService.description}
            </p>

            {/* Format badges */}
            <div className="flex flex-wrap gap-2 mb-5">
              <span className="inline-flex items-center gap-1.5 bg-brand-gold/15 border border-brand-gold/30 text-brand-gold text-xs font-semibold px-3 py-1.5 rounded-full">
                <MapPin className="w-3 h-3" aria-hidden="true" />
                פרונטלי
              </span>
              <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/80 text-xs font-semibold px-3 py-1.5 rounded-full">
                <Monitor className="w-3 h-3" aria-hidden="true" />
                אונליין
              </span>
            </div>

            {/* Key details */}
            <div className="flex flex-wrap gap-4 mb-6">
              <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
                <Users className="w-4 h-4 text-brand-gold flex-shrink-0" aria-hidden="true" />
                <span className="text-sm text-white font-medium">{courseService.sessions}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2">
                <CalendarDays className="w-4 h-4 text-brand-gold flex-shrink-0" aria-hidden="true" />
                <span className="text-sm text-white font-medium">מקומות מוגבלים</span>
              </div>
            </div>

            {/* Features */}
            <ul className="space-y-2.5 mb-8" aria-label="מה כלול בקורס">
              {courseService.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <span
                    className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-gold/20 border border-brand-gold/40 flex items-center justify-center mt-0.5"
                    aria-hidden="true"
                  >
                    <Check className="w-3 h-3 text-brand-gold" />
                  </span>
                  <span className="text-sm text-white/80">{feature}</span>
                </li>
              ))}
            </ul>

            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="לפרטים ורישום לקורס עיצוב גבות בוואצאפ"
              className="inline-flex items-center justify-center gap-2 bg-brand-gold text-brand-dark font-bold text-base px-8 py-4 rounded-full hover:bg-brand-gold-light transition-all duration-200 shadow-gold hover:-translate-y-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark w-full sm:w-auto"
            >
              <WhatsAppIcon className="w-5 h-5" />
              לפרטים ורישום בוואצאפ
            </a>
          </div>

          {/* Price panel */}
          <div className="flex items-center justify-center lg:justify-end">
            <div className="relative text-center p-8 sm:p-10">
              {/* Decorative ring */}
              <div
                className="absolute inset-0 rounded-full border-2 border-brand-gold/20 scale-110"
                aria-hidden="true"
              />
              <div
                className="absolute inset-0 rounded-full border border-brand-gold/10 scale-125"
                aria-hidden="true"
              />

              <p className="text-white/50 text-sm uppercase tracking-widest mb-2">מחיר הקורס</p>
              <p
                className="font-serif text-6xl sm:text-7xl font-bold text-brand-gold leading-none mb-2"
                aria-label="מחיר 2,500 שקלים"
              >
                {courseService.price}
              </p>
              <p className="text-white/40 text-xs">כולל ערכת כלים</p>

              <div className="mt-6 pt-6 border-t border-white/10 space-y-2">
                <div className="flex items-center justify-center gap-1.5 text-white/60 text-sm">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                  <span>אשקלון / אונליין</span>
                </div>
                <div className="flex items-center justify-center gap-1.5 text-white/60 text-sm">
                  <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                  <span>מקומות מוגבלים</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    </motion.div>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
