'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import Link from 'next/link'
import { MapPin, Phone, Clock, Calendar } from 'lucide-react'
import { WHATSAPP_URL, PHONE_NUMBER, LOCATION } from '@/lib/utils'

export default function BookingSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section
      ref={ref}
      id="booking"
      aria-labelledby="booking-heading"
      className="section-padding bg-hero-gradient"
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-3">
            קביעת תור
          </p>
          <h2
            id="booking-heading"
            className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-brand-dark mb-4"
          >
            מוכנה לשדרג את הגבות?
          </h2>
          <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-2xl mx-auto mb-8">
            לקביעת תור שלחי לי הודעה בוואצאפ ואחזור אלייך בהקדם לתיאום מועד מתאים.
            ייעוץ ראשוני חינם!
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <motion.a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="קביעת תור בוואצאפ – S.M BROWS"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-3 bg-[#25D366] text-white font-bold text-lg px-10 py-5 rounded-full shadow-lg hover:shadow-xl transition-shadow duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
            >
              <WhatsAppIcon className="w-7 h-7" />
              שלחי הודעה בוואצאפ
            </motion.a>

            <Link
              href="/booking"
              aria-label="קביעת תור דרך הטופס"
              className="inline-flex items-center gap-3 bg-brand-gold text-brand-dark font-bold text-lg px-10 py-5 rounded-full shadow-gold hover:bg-brand-gold-dark transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
            >
              <Calendar className="w-6 h-6" />
              קביעת תור בטופס
            </Link>
          </div>

          {/* Info cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" role="list" aria-label="פרטי התקשרות">
            {[
              {
                icon: <WhatsAppIcon className="w-6 h-6 text-[#25D366]" />,
                label: 'וואצאפ',
                value: PHONE_NUMBER,
                href: WHATSAPP_URL,
                isExternal: true,
                ariaLabel: `פתחי שיחת וואצאפ – ${PHONE_NUMBER}`,
              },
              {
                icon: <Phone className="w-6 h-6 text-brand-rose" aria-hidden="true" />,
                label: 'טלפון',
                value: PHONE_NUMBER,
                href: `tel:${PHONE_NUMBER.replace(/-/g, '')}`,
                isExternal: false,
                ariaLabel: `התקשרי אליי – ${PHONE_NUMBER}`,
              },
              {
                icon: <MapPin className="w-6 h-6 text-brand-gold" aria-hidden="true" />,
                label: 'מיקום',
                value: `${LOCATION}, ישראל`,
                href: null,
                isExternal: false,
                ariaLabel: `מיקום הסטודיו: ${LOCATION}, ישראל`,
              },
            ].map(({ icon, label, value, href, isExternal, ariaLabel }) => (
              <div key={label} className="glass-card rounded-2xl p-5" role="listitem">
                <div className="flex items-center gap-3 mb-2">
                  {icon}
                  <span className="text-sm font-semibold text-brand-dark">{label}</span>
                </div>
                {href ? (
                  <a
                    href={href}
                    target={isExternal ? '_blank' : undefined}
                    rel={isExternal ? 'noopener noreferrer' : undefined}
                    aria-label={ariaLabel}
                    className="text-brand-medium text-sm hover:text-brand-rose transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
                  >
                    {value}
                  </a>
                ) : (
                  <p className="text-brand-medium text-sm" aria-label={ariaLabel}>{value}</p>
                )}
              </div>
            ))}
          </div>

          {/* Hours note */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : {}}
            transition={{ delay: 0.4 }}
            className="flex items-center justify-center gap-2 mt-8 text-brand-muted text-sm"
          >
            <Clock className="w-4 h-4" aria-hidden="true" />
            <span>זמינות: ראשון–שישי | 9:00–20:00</span>
          </motion.div>
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
