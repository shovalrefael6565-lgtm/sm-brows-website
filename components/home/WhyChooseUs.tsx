'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { Clock, Award, ShieldCheck, Heart, Sparkles } from 'lucide-react'

const FEATURES = [
  {
    icon: <Clock className="w-6 h-6" aria-hidden="true" />,
    title: 'זמינות גבוהה',
    description: 'ניתן לקבוע תור בגמישות לאורך כל ימות השבוע, בשעות נוחות עבורך.',
  },
  {
    icon: <Award className="w-6 h-6" aria-hidden="true" />,
    title: '5+ שנות ניסיון',
    description: 'מאות לקוחות מרוצות ועשרות קורסים וטיפולים מוצלחים בחגורה.',
  },
  {
    icon: <ShieldCheck className="w-6 h-6" aria-hidden="true" />,
    title: 'תוצאות מובטחות',
    description: 'אני מתחייבת לתוצאה. לא מרוצה? אחזור על הטיפול עד שתהיי.',
  },
  {
    icon: <Heart className="w-6 h-6" aria-hidden="true" />,
    title: 'טיפול אישי לכל לקוחה',
    description: 'כל לקוחה מקבלת ייעוץ אישי, טיפול מותאם ותשומת לב מלאה.',
  },
  {
    icon: <Sparkles className="w-6 h-6" aria-hidden="true" />,
    title: 'חומרים מהשורה הראשונה',
    description: 'אני עובדת רק עם מוצרים ופיגמנטים מקצועיים מהמובילים בעולם.',
  },
]

export default function WhyChooseUs() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section
      id="why-us"
      ref={ref}
      aria-labelledby="why-heading"
      className="section-padding bg-brand-dark text-white overflow-hidden relative"
    >
      {/* Decorative blobs */}
      <div
        aria-hidden="true"
        className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-brand-rose/10 blur-3xl pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-brand-gold/10 blur-3xl pointer-events-none"
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-3">
            למה S.M BROWS
          </p>
          <h2
            id="why-heading"
            className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4"
          >
            למה לבחור
            <span className="text-brand-gold"> בי?</span>
          </h2>
          <p className="text-white/60 max-w-xl mx-auto leading-relaxed">
            לא כל הסטודיואים שווים. הנה מה שמבדיל אותי מהשאר ומה שתקבלי כשתבחרי ב-S.M BROWS.
          </p>
        </motion.div>

        <ul
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5"
          role="list"
          aria-label="יתרונות S.M BROWS"
        >
          {FEATURES.map(({ icon, title, description }, i) => (
            <motion.li
              key={title}
              initial={{ opacity: 0, y: 32 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="group"
            >
              <div className="h-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-brand-gold/40 rounded-3xl p-6 transition-all duration-300 flex flex-col gap-4">
                <div className="w-12 h-12 rounded-2xl bg-brand-gold/20 text-brand-gold flex items-center justify-center flex-shrink-0 group-hover:bg-brand-gold/30 transition-colors">
                  {icon}
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-2 leading-snug">{title}</h3>
                  <p className="text-white/50 text-sm leading-relaxed">{description}</p>
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  )
}
