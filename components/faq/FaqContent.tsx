'use client'

import { useId, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { WHATSAPP_URL } from '@/lib/utils'
import { FAQ_SECTIONS, type FaqItem } from '@/lib/faq'

/*
  ⚠️ הפאנל מרונדר תמיד — גם כשהוא סגור.

  עד תיקון ה-SEO היה כאן `<AnimatePresence>{isOpen && …}`, ו-openKey
  מתחיל כ-null. כלומר אף תשובה לא נכנסה ל-DOM: לא ב-SSR ולא אחרי
  hydration, אלא רק אחרי לחיצה אנושית. Googlebot מריץ JavaScript אבל
  אינו לוחץ — ולכן כל 17 התשובות בעמוד היו בלתי נראות לחלוטין לחיפוש
  ולמנועי AI, והעמוד הסתכם ב-183 מילים של ניווט וכותרות שאלה בלבד.

  הקיפול נעשה כעת ב-CSS טהור (grid-template-rows בין 0fr ל-1fr) במקום
  mount/unmount. הטקסט תמיד ב-HTML, האנימציה נשמרת באותה משך ובאותה
  עקומת easing כמו קודם, והערך הסגור נכתב inline כך שאין הבזק של תוכן
  פתוח לפני ה-hydration.
*/
function FaqItem({ item, isOpen, onToggle }: { item: FaqItem; isOpen: boolean; onToggle: () => void }) {
  const uid = useId()
  const panelId = `faq-panel-${uid}`
  const buttonId = `faq-button-${uid}`

  return (
    <div className="border border-brand-cream-dark/60 rounded-2xl overflow-hidden bg-white">
      <button
        type="button"
        id={buttonId}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-4 px-6 py-4 text-right cursor-pointer hover:bg-brand-cream/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-inset"
      >
        <span className="font-semibold text-brand-dark text-sm sm:text-base leading-snug">
          {item.q}
        </span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-gold/15 flex items-center justify-center"
        >
          <ChevronDown className="w-4 h-4 text-brand-gold" aria-hidden="true" />
        </motion.span>
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className="grid motion-safe:transition-all motion-safe:duration-[250ms]"
        style={{
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          opacity: isOpen ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div className="overflow-hidden">
          <p className="px-6 pb-5 text-brand-medium text-sm leading-relaxed border-t border-brand-cream-dark/40 pt-4">
            {item.a}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function FaqContent() {
  const [openKey, setOpenKey] = useState<string | null>(null)

  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key))

  return (
    <section aria-label="שאלות ותשובות" className="section-padding bg-brand-cream">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {FAQ_SECTIONS.map((section, si) => (
          <div key={section.title} className="mb-10">
            <h2 className="font-serif text-xl sm:text-2xl font-bold text-brand-dark mb-4 flex items-center gap-2">
              <span className="w-1 h-6 rounded-full bg-brand-gold inline-block" aria-hidden="true" />
              {section.title}
            </h2>
            <div className="space-y-3">
              {section.items.map((item, ii) => {
                const key = `${si}-${ii}`
                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: si * 0.05 + ii * 0.04 }}
                  >
                    <FaqItem
                      item={item}
                      isOpen={openKey === key}
                      onToggle={() => toggle(key)}
                    />
                  </motion.div>
                )
              })}
            </div>
          </div>
        ))}

        {/* CTA */}
        <div className="mt-12 bg-brand-rose-bg rounded-3xl p-8 border border-brand-rose-light text-center">
          <p className="font-serif text-xl font-bold text-brand-dark mb-2">
            לא מצאת תשובה?
          </p>
          <p className="text-brand-medium text-sm mb-5">
            שלחי לי הודעה בוואצאפ ואשמח לעזור
          </p>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-brand-dark text-white font-bold px-6 py-3 rounded hover:bg-brand-dark/90 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark focus-visible:ring-offset-2"
          >
            שאלי אותנו בוואצאפ
          </a>
          <p className="text-brand-medium text-sm mt-4">
            כבר יודעת מה מתאים לך?{' '}
            <Link
              href="/booking"
              className="text-brand-rose-text underline underline-offset-2 hover:text-brand-rose-text/80 transition-colors"
            >
              קבעי תור ביומן
            </Link>
          </p>
        </div>
      </div>
    </section>
  )
}
