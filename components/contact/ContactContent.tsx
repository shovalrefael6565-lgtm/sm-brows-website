'use client'

import { motion } from 'framer-motion'
import { MapPin, Phone, Mail, Clock, MessageCircle } from 'lucide-react'
import { WHATSAPP_URL, LOCATION, EMAIL, PHONE_NUMBER } from '@/lib/utils'

const PHONE = PHONE_NUMBER

const hours = [
  { day: 'ראשון – חמישי (בוקר)', time: '09:00 – 11:00' },
  { day: 'ראשון – חמישי (אחה"צ)', time: '15:00 – 19:00' },
  { day: 'שישי – שבת', time: 'סגור' },
]

const contactItems = [
  {
    icon: MapPin,
    label: 'כתובת',
    value: LOCATION,
    href: 'https://maps.google.com/?q=הכורמים+אשקלון',
    external: true,
  },
  {
    icon: Phone,
    label: 'טלפון',
    value: PHONE,
    href: `tel:${PHONE.replace(/-/g, '')}`,
    external: false,
  },
  {
    icon: Mail,
    label: 'דואר אלקטרוני',
    value: EMAIL,
    href: `mailto:${EMAIL}`,
    external: false,
  },
  {
    icon: MessageCircle,
    label: 'וואצאפ',
    value: 'שלחי הודעה ישירה',
    href: WHATSAPP_URL,
    external: true,
  },
]

export default function ContactContent() {
  return (
    <section aria-label="פרטי יצירת קשר" className="section-padding bg-brand-cream">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

          {/* Contact cards — 3 cols */}
          <div className="lg:col-span-3 space-y-4">
            <h2 className="font-serif text-2xl font-bold text-brand-dark mb-6">
              דרכי יצירת קשר
            </h2>

            {contactItems.map((item, i) => (
              <motion.a
                key={item.label}
                href={item.href}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="flex items-center gap-4 bg-white rounded-2xl p-5 border border-brand-cream-dark/50 shadow-soft hover:shadow-soft-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                <span className="w-12 h-12 rounded-xl bg-brand-gold/10 flex items-center justify-center flex-shrink-0 group-hover:bg-brand-gold/20 transition-colors">
                  <item.icon className="w-5 h-5 text-brand-gold" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs text-brand-muted mb-0.5">{item.label}</p>
                  <p className="font-semibold text-brand-dark text-sm">{item.value}</p>
                </div>
              </motion.a>
            ))}

            {/* WhatsApp CTA */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="mt-6"
            >
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="קביעת תור בוואצאפ"
                className="inline-flex items-center gap-3 bg-brand-gold text-brand-dark font-bold text-base px-8 py-4 rounded-full shadow-gold hover:bg-brand-gold-dark transition-all duration-200 hover:-translate-y-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
              >
                <WhatsAppIcon className="w-5 h-5" />
                קביעת תור בוואצאפ
              </a>
            </motion.div>
          </div>

          {/* Hours + info — 2 cols */}
          <div className="lg:col-span-2 space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="bg-white rounded-3xl p-6 border border-brand-cream-dark/50 shadow-soft"
            >
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-brand-gold" aria-hidden="true" />
                <h3 className="font-serif text-lg font-bold text-brand-dark">שעות פעילות</h3>
              </div>
              <ul className="space-y-3">
                {hours.map(({ day, time }) => (
                  <li key={day} className="flex items-center justify-between text-sm">
                    <span className="text-brand-medium">{day}</span>
                    <span className={`font-semibold ${time === 'סגור' ? 'text-brand-muted' : 'text-brand-dark'}`}>
                      {time}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-brand-muted mt-4 border-t border-brand-cream-dark/50 pt-3">
                * שעות פעילות עשויות להשתנות בחגים ובמועדים מיוחדים
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="bg-brand-rose-bg rounded-3xl p-6 border border-brand-rose-light"
            >
              <h3 className="font-serif text-lg font-bold text-brand-dark mb-3">
                מענה מהיר בוואצאפ
              </h3>
              <p className="text-brand-medium text-sm leading-relaxed">
                הדרך המהירה ביותר לתאם תור היא דרך וואצאפ. אני מגיבה בדרך כלל תוך מספר שעות בימי עסקים.
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
