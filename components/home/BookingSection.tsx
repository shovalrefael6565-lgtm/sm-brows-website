'use client'

import Link from 'next/link'
import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { WHATSAPP_URL } from '@/lib/utils'

export default function BookingSection() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section
      ref={ref}
      id="booking"
      aria-labelledby="booking-heading"
      className="relative overflow-hidden bg-brand-dark py-20 sm:py-28"
    >
      <div aria-hidden="true" className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-30 pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <h2
            id="booking-heading"
            className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium text-white leading-[1.2] mb-6 text-balance"
          >
            הגבות שחלמת עליהן{' '}
            <span className="text-brand-gold">מחכות לך</span>
          </h2>

          <p className="text-white/60 text-base sm:text-lg leading-relaxed mb-10">
            שלחי לי הודעה ונקבע. ייעוץ ראשוני חינם — בלי התחייבות.
          </p>

          <div className="flex flex-col items-center gap-5 mb-12">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="קביעת תור ב-S.M BROWS בוואצאפ"
              className="inline-flex items-center gap-3 bg-brand-cream text-brand-dark font-bold text-base px-7 py-3 rounded hover:bg-white active:scale-[0.97] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark"
            >
              <WhatsAppIcon className="w-5 h-5" />
              לקביעת תור בוואצאפ
            </a>

            <Link
              href="/booking"
              aria-label="קביעת תור דרך הטופס המקוון"
              className="text-white/50 hover:text-white/80 text-sm font-medium underline underline-offset-4 decoration-white/25 hover:decoration-white/50 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
            >
              או לקבוע דרך הטופס המקוון
            </Link>
          </div>

          <p className="text-white/55 text-sm">
            זמינות: ראשון–חמישי | 09:00–11:00 ו-15:00–19:00
          </p>
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
