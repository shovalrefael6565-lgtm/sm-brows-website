'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { CheckCircle, AlertCircle, Mail } from 'lucide-react'
import { EMAIL, WHATSAPP_URL } from '@/lib/utils'

const OWNER_NAME = 'שובל ואחדי מאירה'
const BUSINESS_NAME = 'S.M BROWS'
const LAST_UPDATED = 'מאי 2026'

const implemented = [
  'הגדרת כיוון RTL (מימין לשמאל) לכל דפי האתר',
  'תגי ARIA מתאימים לכפתורים, ניווט ורכיבים אינטראקטיביים',
  'טקסט חלופי (alt text) לכל התמונות המשמעותיות',
  'ניגודיות צבעים עומדת בדרישות רמה AA לפי WCAG 2.0',
  'גודל פונטים ניתן להגדלה ללא שבירת הפריסה',
  'אפשרות ניווט מלאה באמצעות מקלדת (Tab order)',
  'מצבי focus גלויים על כל האלמנטים האינטראקטיביים',
  'כותרות (h1–h6) במבנה היררכי תקין',
  'גדלי אזורי לחיצה עומדים בדרישות המינימום (44×44 פיקסל)',
  'תמיכה ב-prefers-reduced-motion להפחתת אנימציות',
  'שפת הדף מוגדרת כ-"he" (עברית)',
  'כל הטפסים כוללים תוויות (labels) מתאימות',
]

const limitations = [
  'חלק מהאנימציות המתקדמות (Framer Motion) עשויות להציג אתגר למשתמשי קורא מסך',
  'תצוגת ה-carousel בגלריה אינה מכריזה אוטומטית על החלפת תמונה בקורא מסך',
  'מפת Google המוטמעת (אם קיימת) אינה בשליטתנו המלאה מבחינת נגישות',
]

export default function AccessibilityContent() {
  return (
    <section aria-label="הצהרת נגישות" className="section-padding bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">

        {/* Notice */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-brand-gold/10 border border-brand-gold/30 rounded-2xl px-5 py-4 mb-10 text-sm text-brand-medium"
        >
          הצהרה זו עודכנה לאחרונה ב-{LAST_UPDATED}. היא נכתבה בהתאם לחוק שוויון זכויות לאנשים
          עם מוגבלות, תשנ"ח–1998, תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות),
          תשע"ג–2013, ותקן ישראלי 5568 (WCAG 2.0 רמה AA).
        </motion.div>

        {/* Sections */}
        {[
          {
            id: 'commitment',
            title: '1. מחויבות לנגישות',
            content: (
              <p>
                {BUSINESS_NAME} מחויב לאפשר לאנשים עם מוגבלות לגלוש באתר ולהשתמש בשירותיו
                בצורה שוויונית ומכובדת. אנו עובדים לעמוד בדרישות תקן ישראלי 5568 ברמה AA,
                המבוסס על הנחיות WCAG 2.0 של ארגון W3C.
              </p>
            ),
          },
          {
            id: 'level',
            title: '2. רמת הנגישות שהושגה',
            content: (
              <p>
                אתר זה עומד ברמת נגישות <strong>AA חלקית</strong> לפי תקן ישראלי 5568 (WCAG 2.0).
                אנו ממשיכים לשפר את הנגישות ולהתאים את האתר לדרישות תקן זה.
              </p>
            ),
          },
          {
            id: 'implemented',
            title: '3. התאמות נגישות שבוצעו',
            content: (
              <ul className="space-y-2.5 mt-2" role="list">
                {implemented.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-brand-medium">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            ),
          },
          {
            id: 'limitations',
            title: '4. מגבלות נגישות ידועות',
            content: (
              <>
                <p className="mb-3 text-sm text-brand-medium">
                  למרות מאמצינו, קיימות מגבלות ידועות שאנו עובדים לפתור:
                </p>
                <ul className="space-y-2.5" role="list">
                  {limitations.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm text-brand-medium">
                      <AlertCircle className="w-4 h-4 text-brand-gold flex-shrink-0 mt-0.5" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            ),
          },
          {
            id: 'coordinator',
            title: '5. רכז/ת נגישות',
            content: (
              <>
                <p>רכזת הנגישות של {BUSINESS_NAME}:</p>
                <p className="font-semibold text-brand-dark mt-1">{OWNER_NAME}</p>
                <p>
                  דואר אלקטרוני:{' '}
                  <a href={`mailto:${EMAIL}`} className="text-brand-rose hover:underline">{EMAIL}</a>
                </p>
                <p>
                  וואצאפ:{' '}
                  <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="text-brand-rose hover:underline">
                    לחצי כאן לשליחת הודעה
                  </a>
                </p>
              </>
            ),
          },
          {
            id: 'request',
            title: '6. בקשת התאמות נגישות',
            content: (
              <p>
                אם נתקלת בקושי בגישה לתכנים באתר, או אם יש לך בקשה לקבלת מידע בפורמט נגיש,
                אנא פני אלינו דרך הדואר האלקטרוני או הוואצאפ. אנו נשתדל לספק מענה תוך 5 ימי עסקים.
              </p>
            ),
          },
          {
            id: 'complaint',
            title: '7. הגשת תלונה',
            content: (
              <p>
                אם לא קיבלת מענה מספק לבקשת הנגישות שלך, תוכלי לפנות לנציב שוויון זכויות לאנשים
                עם מוגבלות במשרד המשפטים. פרטי נציב השוויון:{' '}
                <a
                  href="https://www.justice.gov.il/Units/NetzivutShivyon"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-rose hover:underline"
                >
                  www.justice.gov.il
                </a>
              </p>
            ),
          },
          {
            id: 'assistive',
            title: '8. טכנולוגיות נתמכות',
            content: (
              <>
                <p className="mb-2">האתר נבדק ומותאם לשימוש עם:</p>
                <ul className="list-disc list-inside space-y-1.5 text-sm text-brand-medium">
                  <li>NVDA (קורא מסך לחלונות) עם Chrome</li>
                  <li>VoiceOver (קורא מסך של Apple) עם Safari</li>
                  <li>ניווט מקלדת בדפדפני Chrome, Firefox ו-Safari</li>
                  <li>תצוגה מוגדלת עד 200% ברוחב מסך מלא</li>
                </ul>
              </>
            ),
          },
          {
            id: 'date',
            title: '9. תאריך עדכון',
            content: (
              <p>
                הצהרת נגישות זו עודכנה לאחרונה בתאריך {LAST_UPDATED}.
                אנו מעדכנים הצהרה זו אחת לשנה לפחות, ובכל עת שמבוצעות שינויים מהותיים באתר.
              </p>
            ),
          },
        ].map((section, i) => (
          <motion.div
            key={section.id}
            id={section.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.4 }}
            className="mb-8"
          >
            <h2 className="font-serif text-xl font-bold text-brand-dark mb-3 flex items-center gap-2">
              <span className="w-1 h-5 rounded-full bg-brand-gold inline-block flex-shrink-0" aria-hidden="true" />
              {section.title}
            </h2>
            <div className="text-brand-medium text-sm leading-relaxed space-y-2 pr-3">
              {section.content}
            </div>
          </motion.div>
        ))}

        {/* CTA */}
        <div className="mt-10 bg-brand-rose-bg rounded-3xl p-6 border border-brand-rose-light flex items-start gap-4">
          <Mail className="w-5 h-5 text-brand-rose flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold text-brand-dark mb-1">נתקלת בבעיית נגישות?</p>
            <p className="text-brand-medium text-sm mb-3">
              אנו מחויבים לשפר את חוויית הגלישה לכולם. צרי קשר ונשמח לעזור.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 text-brand-rose font-semibold hover:text-brand-medium transition-colors text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
            >
              יצירת קשר עם רכזת הנגישות ←
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
