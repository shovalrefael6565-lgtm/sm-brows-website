'use client'

import { useState } from 'react'
import { motion, AnimatePresence, useInView } from 'framer-motion'
import { ChevronDown, MessageCircle } from 'lucide-react'
import { useRef } from 'react'
import Link from 'next/link'
import { WHATSAPP_URL } from '@/lib/utils'

const FAQ_ITEMS = [
  {
    q: 'האם מיקרובליידינג כואב?',
    a: 'הכאב מינימלי. לפני הטיפול מורחת קרם הרדמה מקומית שמפחיתה משמעותית את אי-הנוחות. רוב הלקוחות מדווחות על תחושה קלה בלבד.',
  },
  {
    q: 'כמה זמן מחזיקה התוצאה של מיקרובליידינג?',
    a: 'בין 12 ל-24 חודשים, תלוי בסוג העור ואורח החיים. מומלץ טיפול חיזוק (touch-up) לאחר 6–8 שבועות מהטיפול הראשון.',
  },
  {
    q: 'מה לא לעשות לפני מיקרובליידינג?',
    a: 'להימנע מאספירין/איבופרופן 48 שעות לפני, מאלכוהול 24 שעות לפני, מחשיפה אינטנסיבית לשמש שבוע לפני, ומפילינג כימי/בוטוקס 4 שבועות לפני.',
  },
  {
    q: 'כמה תדיר כדאי לעצב גבות?',
    a: 'מומלץ כל 4–6 שבועות בהתאם לקצב גדילת השיערות. הגעה תדירה מדי עלולה לפגוע בצורה הטבעית של הגבה.',
  },
  {
    q: 'מה לא לעשות אחרי הרמת גבות?',
    a: 'ב-24 שעות הראשונות: אין להרטיב את הגבות, אין להשתמש במוצרי טיפוח על האזור, ואין לישון עם הפנים כלפי מטה.',
  },
  {
    q: 'מה אמצעי התשלום המקובלים?',
    a: 'תשלום במזומן, ביט ופייבוקס — בקליניקה לאחר הטיפול. למיקרובליידינג ניתן לפצל ל-2 תשלומים שווים.',
  },
]

function FaqItem({ item, isOpen, onToggle, index }: {
  item: typeof FAQ_ITEMS[0]
  isOpen: boolean
  onToggle: () => void
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="border border-brand-cream-dark/70 rounded-2xl overflow-hidden bg-white"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-right cursor-pointer hover:bg-brand-cream/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-inset"
      >
        <span className="font-semibold text-brand-dark text-sm sm:text-base leading-snug">
          {item.q}
        </span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.22 }}
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
            isOpen ? 'bg-brand-gold text-brand-dark' : 'bg-brand-gold/15 text-brand-gold'
          }`}
        >
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="px-5 pb-5 text-brand-medium text-sm leading-relaxed border-t border-brand-cream-dark/40 pt-4">
              {item.a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function ServiceFaqSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section
      ref={ref}
      aria-labelledby="service-faq-heading"
      className="section-padding bg-white"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-3">
            לפני שקובעים תור
          </p>
          <h2
            id="service-faq-heading"
            className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark mb-4"
          >
            שאלות
            <span className="text-brand-rose"> נפוצות</span>
          </h2>
          <div className="flex items-center justify-center gap-2 mb-4" aria-hidden="true">
            <span className="w-10 h-px bg-brand-rose-light" />
            <span className="w-1.5 h-1.5 rounded-full bg-brand-rose" />
            <span className="w-10 h-px bg-brand-rose-light" />
          </div>
        </motion.div>

        <div className="space-y-3 mb-8">
          {FAQ_ITEMS.map((item, i) => (
            <FaqItem
              key={i}
              item={item}
              index={i}
              isOpen={openIdx === i}
              onToggle={() => setOpenIdx((prev) => (prev === i ? null : i))}
            />
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3 text-center"
        >
          <p className="text-brand-medium text-sm">לא מצאת תשובה?</p>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-brand-gold text-brand-dark font-bold px-6 py-3 rounded-full hover:bg-brand-gold-dark transition-colors shadow-gold text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
          >
            <MessageCircle className="w-4 h-4" />
            שאלי אותי בוואצאפ
          </a>
          <Link
            href="/faq"
            className="text-sm text-brand-rose hover:text-brand-rose/70 underline underline-offset-2 transition-colors"
          >
            לכל השאלות ←
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
