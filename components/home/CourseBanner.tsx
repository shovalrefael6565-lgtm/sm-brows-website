'use client'

import Link from 'next/link'
import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { MapPin, Monitor, Sparkles } from 'lucide-react'
import { WHATSAPP_URL } from '@/lib/utils'

export default function CourseBanner() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section
      ref={ref}
      aria-labelledby="course-banner-heading"
      className="relative overflow-hidden bg-brand-dark py-16 sm:py-20"
    >
      {/* Background decoration */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-brand-gold/8 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-brand-rose/8 blur-3xl" />
        <div className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-60" />
        <div className="absolute bottom-0 inset-x-0 h-px bg-gold-gradient opacity-30" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">

          {/* Text */}
          <motion.div
            initial={{ opacity: 0, x: 32 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Tag */}
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 bg-brand-gold/20 border border-brand-gold/40 text-brand-gold text-xs font-bold px-3 py-1.5 rounded-full tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-gold animate-pulse" aria-hidden="true" />
                קורס פרימיום
              </span>
            </div>

            <h2
              id="course-banner-heading"
              className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight mb-4"
            >
              קורס עיצוב גבות
              <br />
              <span className="text-brand-gold">מקצועי</span>
            </h2>

            <p className="text-white/65 text-base sm:text-lg leading-relaxed mb-6 max-w-lg">
              2 מפגשים אישיים שיהפכו אותך לאמנית גבות מקצועית. תיאוריה, פרקטיקה, ערכת כלים
              מקצועית והסמכה מוכרת — הכל כלול.
            </p>

            {/* Format badges */}
            <div className="flex items-center gap-3 mb-8">
              <span className="inline-flex items-center gap-1.5 bg-brand-gold/15 border border-brand-gold/30 text-brand-gold text-sm font-semibold px-4 py-2 rounded-full">
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                פרונטלי
              </span>
              <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/80 text-sm font-semibold px-4 py-2 rounded-full">
                <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
                אונליין
              </span>
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="לפרטים ורישום לקורס עיצוב גבות בוואצאפ"
                className="inline-flex items-center gap-2 bg-brand-gold text-brand-dark font-bold text-base px-7 py-3.5 rounded-full hover:bg-brand-gold-dark transition-all duration-200 shadow-gold hover:-translate-y-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark"
              >
                <WhatsAppIcon className="w-5 h-5" />
                לפרטים ורישום
              </a>
              <Link
                href="/services"
                aria-label="פרטים נוספים על הקורס בדף הטיפולים"
                className="inline-flex items-center gap-2 text-white/70 font-medium text-base px-5 py-3.5 rounded-full border border-white/20 hover:border-white/40 hover:text-white transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                פרטים נוספים
              </Link>
            </div>
          </motion.div>

          {/* Price card */}
          <motion.div
            initial={{ opacity: 0, x: -32 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="flex justify-center lg:justify-end"
          >
            <div className="relative w-full max-w-xs">
              {/* Glow */}
              <div aria-hidden="true" className="absolute inset-0 bg-brand-gold/10 rounded-3xl blur-2xl scale-110" />

              <div className="relative bg-white/5 border border-white/10 rounded-3xl p-8 text-center backdrop-blur-sm">
                <div className="inline-flex items-center gap-1.5 bg-brand-rose/20 border border-brand-rose/30 text-brand-rose text-xs font-bold px-3 py-1 rounded-full mb-5">
                  <Sparkles className="w-3 h-3" aria-hidden="true" />
                  מקומות מוגבלים
                </div>

                <p className="text-white/50 text-xs uppercase tracking-widest mb-1">מחיר הקורס</p>
                <p
                  className="font-serif text-6xl font-bold text-brand-gold leading-none mb-1"
                  aria-label="מחיר 2,500 שקלים"
                >
                  ₪2,500
                </p>
                <p className="text-white/40 text-xs mb-6">כולל ערכת כלים מקצועית</p>

                <div className="space-y-3 text-sm">
                  {[
                    '2 מפגשים אישיים',
                    'תיאוריה ופרקטיקה',
                    'הסמכה מוכרת',
                    'ליווי לאחר הקורס',
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2 text-white/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-gold flex-shrink-0" aria-hidden="true" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

        </div>
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
