'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { WHATSAPP_URL } from '@/lib/utils'

interface FaqItem {
  q: string
  a: string
}

interface FaqSection {
  title: string
  items: FaqItem[]
}

const FAQ_DATA: FaqSection[] = [
  {
    title: 'מיקרובליידינג',
    items: [
      {
        q: 'מה זה מיקרובליידינג?',
        a: 'מיקרובליידינג הוא טיפול קוסמטי חצי-קבוע שבו מצוירות שיערות דקות בצבע על עור הגבה בעזרת סכין ידנית מיוחדת. התוצאה היא גבות טבעיות, מלאות ומוגדרות שמחזיקות עד שנה.',
      },
      {
        q: 'האם מיקרובליידינג כואב?',
        a: 'הכאב מינימלי מאוד. לפני הטיפול מורחת קרם הרדמה מקומית שמפחיתה משמעותית את תחושת האי-נוחות. רוב הלקוחות מדווחות על תחושה קלה בלבד.',
      },
      {
        q: 'כמה זמן מחזיקה התוצאה?',
        a: 'התוצאה מחזיקה עד שנה, תלוי בסוג העור, אורח חיים וחשיפה לשמש. מומלץ לבצע טיפול חיזוק (touch-up) לאחר 6–8 שבועות מהטיפול הראשון.',
      },
      {
        q: 'מה ההכנה הנדרשת לפני הטיפול?',
        a: 'יש להימנע מדילול דם (אספירין, איבופרופן) 48 שעות לפני הטיפול. לא לשתות אלכוהול 24 שעות לפני. להימנע מחשיפה לשמש אינטנסיבית שבוע לפני. אין לבצע פילינג כימי או בוטוקס 4 שבועות לפני.',
      },
      {
        q: 'מי לא מתאימה לטיפול מיקרובליידינג?',
        a: 'הטיפול אינו מתאים לנשים בהיריון או הנקה, אנשים עם מחלת עור פעילה באזור הגבות (אקזמה, פסוריאזיס), אנשים הנוטלים נוגדי קרישה, ואנשים עם מצבים רפואיים מסוימים. בכל מקרה של ספק – יש להתייעץ עם רופא תחילה.',
      },
    ],
  },
  {
    title: 'עיצוב גבות טבעי',
    items: [
      {
        q: 'מה ההבדל בין עיצוב גבות טבעי למיקרובליידינג?',
        a: 'עיצוב גבות טבעי הוא טיפול זמני שכולל הסרת שיערות עודפות, עיצוב לפי צורת הפנים, ולעיתים צביעה. מיקרובליידינג הוא טיפול חצי-קבוע שמוסיף שיערות מצוירות לגבה. עיצוב גבות מתאים לתחזוקה שוטפת, מיקרובליידינג לשינוי מהותי וממושך.',
      },
      {
        q: 'כמה תדיר כדאי לעצב את הגבות?',
        a: 'מומלץ לעצב גבות כל 4–6 שבועות, בהתאם לקצב גדילת השיערות. הגעה תדירה מדי עלולה לפגוע בצורה הטבעית של הגבה.',
      },
      {
        q: 'האם יש צביעת גבות בקליניקה?',
        a: 'כן, אני מציעה צביעת גבות (henna / צבע כימי) כחלק מטיפול עיצוב גבות מקיף. הצבע מחזיק 2–4 שבועות תלוי בסוג הצבע ובטיפול.',
      },
    ],
  },
  {
    title: 'הרמת גבות',
    items: [
      {
        q: 'מה זה הרמת גבות (Brow Lamination)?',
        a: 'הרמת גבות היא טיפול המיישר ומרים את שיערות הגבה, ויוצר מראה מלא, מסודר ומרחף. בדומה לפן לשיער – השיערות "לומדות" לגדול כלפי מעלה. התוצאה מחזיקה 6–8 שבועות.',
      },
      {
        q: 'האם הרמת גבות פוגעת בשיערות?',
        a: 'הטיפול בטוח כשהוא מבוצע נכון. אני משתמשת במוצרים איכותיים ומוסמכים. ההמלצה היא לא לחזור על הטיפול לפני שחלפו 6 שבועות מהפעם הקודמת, ולטפח את השיערות בשמן קסטור.',
      },
      {
        q: 'מה לא לעשות אחרי הרמת גבות?',
        a: 'ב-24 שעות הראשונות: אין להרטיב את הגבות, אין להשתמש במוצרי טיפוח על האזור, אין לישון עם הפנים כלפי מטה. לאחר מכן ניתן לחזור לשגרה.',
      },
    ],
  },
  {
    title: 'קורס מקצועי',
    items: [
      {
        q: 'למי מתאים הקורס?',
        a: 'הקורס מתאים למתחילות שרוצות להיכנס לתחום, ולמי שכבר עוסקות בטיפולי יופי ורוצות להוסיף התמחות בגבות. אין צורך בניסיון קודם.',
      },
      {
        q: 'מה מקבלים בסיום הקורס?',
        a: 'בסיום הקורס מקבלים תעודת הסמכה ממכון S.M BROWS, ערכת כלים מקצועית, חוברת לימוד דיגיטלית, וליווי אישי לאחר הקורס.',
      },
      {
        q: 'האם הקורס מוכר?',
        a: 'תעודת ההסמכה מוכרת על ידי הקליניקה ומהווה אסמכתא לאיכות ומקצועיות. לצורך רישיון עסק עצמאי, יש לפנות לרשויות המקומיות הרלוונטיות.',
      },
    ],
  },
  {
    title: 'תורים, תשלום וביטולים',
    items: [
      {
        q: 'כיצד קובעים תור?',
        a: 'ניתן לקבוע תור דרך וואצאפ או דרך מערכת קביעת התורים באתר. אני מאשרת כל תור באופן אישי.',
      },
      {
        q: 'מה אמצעי התשלום המקובלים?',
        a: 'אני מקבלת תשלום במזומן, בביט, ובפייבוקס. התשלום מתבצע בקליניקה לאחר הטיפול.',
      },
      {
        q: 'מה מדיניות הביטולים?',
        a: 'ביטול או שינוי תור עד 24 שעות לפני הטיפול – ללא עלות. ביטול בתוך 24 שעות מהתור – ייתכן חיוב של 50% מעלות הטיפול. אי הגעה ללא הודעה (no-show) – חיוב מלא. אנא צרי קשר בהקדם האפשרי במקרה של שינוי.',
      },
      {
        q: 'האם יש אפשרות לתשלום בתשלומים?',
        a: 'עבור טיפולי מיקרובליידינג ניתן לפצל את התשלום ל-2 תשלומים שווים (תשלום ראשון לפני הטיפול, שני בטיפול החיזוק). פרטים נוספים בוואצאפ.',
      },
    ],
  },
]

function FaqItem({ item, isOpen, onToggle }: { item: FaqItem; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="border border-brand-cream-dark/60 rounded-2xl overflow-hidden bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
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

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="px-6 pb-5 text-brand-medium text-sm leading-relaxed border-t border-brand-cream-dark/40 pt-4">
              {item.a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function FaqContent() {
  const [openKey, setOpenKey] = useState<string | null>(null)

  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key))

  return (
    <section aria-label="שאלות ותשובות" className="section-padding bg-brand-cream">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {FAQ_DATA.map((section, si) => (
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
            className="inline-flex items-center gap-2 bg-brand-gold text-brand-dark font-bold px-7 py-3.5 rounded-full hover:bg-brand-gold-dark transition-all duration-200 shadow-gold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
          >
            שאלי אותנו בוואצאפ
          </a>
        </div>
      </div>
    </section>
  )
}
