'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { EMAIL, WHATSAPP_URL } from '@/lib/utils'

const OWNER_NAME = 'שובל ואחדי מאירה'
const BUSINESS_NAME = 'S.M BROWS'
const ADDRESS = 'הכורמים, אשקלון'
const LAST_UPDATED = 'מאי 2026'

interface Section {
  id: string
  title: string
  content: React.ReactNode
}

export default function PrivacyContent() {
  const sections: Section[] = [
    {
      id: 'intro',
      title: '1. כללי',
      content: (
        <p>
          מדיניות פרטיות זו מתארת את האופן שבו {BUSINESS_NAME}, בבעלות {OWNER_NAME} (להלן: "הסטודיו" או "אנחנו"),
          אוסף, משתמש ושומר על מידע אישי של משתמשי האתר ולקוחות הסטודיו, בהתאם לחוק הגנת הפרטיות,
          תשמ"א–1981 ותקנות הגנת הפרטיות (אבטחת מידע), תשע"ז–2017.
          השימוש באתר ו/או בשירותי הסטודיו מהווה הסכמה למדיניות פרטיות זו.
        </p>
      ),
    },
    {
      id: 'collected-data',
      title: '2. המידע שאנו אוספים',
      content: (
        <>
          <p className="mb-3">אנו עשויים לאסוף את סוגי המידע הבאים:</p>
          <ul className="list-disc list-inside space-y-2 text-brand-medium text-sm">
            <li><strong>פרטי זיהוי:</strong> שם פרטי ושם משפחה</li>
            <li><strong>פרטי יצירת קשר:</strong> מספר טלפון, כתובת דואר אלקטרוני</li>
            <li><strong>מידע על טיפולים:</strong> סוג הטיפול שהוזמן, תאריך ושעת תור, הערות רלוונטיות</li>
            <li><strong>מידע על תקשורת:</strong> תוכן הודעות שנשלחו אלינו דרך וואצאפ, דואר אלקטרוני או טופס יצירת קשר</li>
            <li><strong>נתוני גלישה:</strong> כתובת IP, סוג דפדפן, עמודים שנצפו, דרך הגעה לאתר – באופן אנונימי לצורכי סטטיסטיקה</li>
          </ul>
          <p className="mt-3 text-sm">אנו לא אוספים מידע רגיש כהגדרתו בחוק (כגון מידע בריאותי, ביומטרי, דתי או פוליטי), אלא אם נמסר מרצון הלקוח לצורך הכנת הטיפול.</p>
        </>
      ),
    },
    {
      id: 'purpose',
      title: '3. מטרת איסוף המידע',
      content: (
        <>
          <p className="mb-3">המידע האישי נאסף ומשמש למטרות הבאות:</p>
          <ul className="list-disc list-inside space-y-2 text-brand-medium text-sm">
            <li>תיאום וניהול תורים וטיפולים</li>
            <li>יצירת קשר עם הלקוח לצורך אישור, תזכורת או שינוי תור</li>
            <li>מתן שירות טיפולים מקצועי ומותאם אישית</li>
            <li>משלוח עדכונים על מבצעים ושירותים חדשים (בהסכמה בלבד)</li>
            <li>שיפור השירות ובניית סטטיסטיקות אנונימיות על ביקורים באתר</li>
            <li>עמידה בדרישות חוקיות</li>
          </ul>
        </>
      ),
    },
    {
      id: 'legal-basis',
      title: '4. הבסיס המשפטי לעיבוד המידע',
      content: (
        <p>
          עיבוד המידע האישי מתבצע על בסיס: הסכמת הלקוח (בעת קביעת תור או יצירת קשר),
          הכרחיות לביצוע הסכם שירות (לצורך מתן טיפול), ואינטרס לגיטימי של הסטודיו
          (כגון ניהול תורים ושיפור שירות). לקוח שמסר פרטיו לצורך קביעת תור מסכים לעיבוד
          המידע למטרות המפורטות לעיל.
        </p>
      ),
    },
    {
      id: 'storage',
      title: '5. אחסון ואבטחת המידע',
      content: (
        <>
          <p>
            המידע מאוחסן על שרתים מאובטחים ו/או מכשירים אישיים המוגנים בסיסמה.
            אנו נוקטים אמצעי אבטחה טכניים וארגוניים סבירים להגנה על המידע מפני גישה
            בלתי מורשית, אובדן, שינוי או גילוי.
          </p>
          <p className="mt-3">
            המידע יישמר כל עוד הוא נדרש לצורך המטרות שלשמן נאסף, ולא יותר מ-7 שנים
            לאחר סיום הקשר העסקי, אלא אם חלה חובת שמירה ארוכה יותר לפי דין.
          </p>
        </>
      ),
    },
    {
      id: 'sharing',
      title: '6. מסירת מידע לצד שלישי',
      content: (
        <>
          <p className="mb-3">
            אנו לא מוכרים, משכירים או משתפים מידע אישי עם צדדים שלישיים למטרות שיווקיות.
            המידע עשוי להיות מועבר במקרים הבאים בלבד:
          </p>
          <ul className="list-disc list-inside space-y-2 text-brand-medium text-sm">
            <li><strong>ספקי שירות:</strong> פלטפורמות תקשורת כגון Meta (WhatsApp, Facebook, Instagram) – בכפוף למדיניות הפרטיות שלהן</li>
            <li><strong>חובה חוקית:</strong> בהתאם לדרישת רשות מוסמכת, צו שיפוטי או חוק</li>
            <li><strong>הגנה על זכויות:</strong> במקרה הכרחי להגנה על זכויות הסטודיו או על בטיחות הציבור</li>
          </ul>
        </>
      ),
    },
    {
      id: 'rights',
      title: '7. זכויות הלקוח',
      content: (
        <>
          <p className="mb-3">
            בהתאם לחוק הגנת הפרטיות, תשמ"א–1981, ובכפוף לתנאיו, כל אדם זכאי:
          </p>
          <ul className="list-disc list-inside space-y-2 text-brand-medium text-sm">
            <li>לדעת אם מידע אודותיו מצוי במאגר מידע</li>
            <li>לעיין במידע אודותיו השמור אצלנו</li>
            <li>לבקש תיקון מידע שגוי, חסר או לא עדכני</li>
            <li>לבקש מחיקת מידע, בכפוף לדרישות חוקיות לשמירתו</li>
            <li>לבטל הסכמה לקבלת פרסומת ישירה בכל עת</li>
          </ul>
          <p className="mt-3">
            לממוש זכויות אלה, ניתן לפנות אלינו בדואר אלקטרוני: <a href={`mailto:${EMAIL}`} className="text-brand-rose hover:underline">{EMAIL}</a>
          </p>
        </>
      ),
    },
    {
      id: 'cookies',
      title: '8. עוגיות (Cookies)',
      content: (
        <p>
          האתר עשוי להשתמש בעוגיות לצורך שיפור חוויית הגלישה ואיסוף נתונים סטטיסטיים אנונימיים.
          ניתן להגדיר את הדפדפן לחסום עוגיות, אך הדבר עשוי לפגוע בחלק מפונקציות האתר.
          אתר זה אינו משתמש בעוגיות לצורכי פרסום ממוקד.
        </p>
      ),
    },
    {
      id: 'minors',
      title: '9. קטינים',
      content: (
        <p>
          שירותי הסטודיו מיועדים לבני 16 ומעלה. קטינים מתחת לגיל 16 נדרשים לקבל הסכמת הורה
          או אפוטרופוס לפני קביעת תור ומסירת מידע אישי.
        </p>
      ),
    },
    {
      id: 'updates',
      title: '10. עדכונים למדיניות',
      content: (
        <p>
          אנו שומרים לעצמנו את הזכות לעדכן מדיניות פרטיות זו מעת לעת.
          עדכונים מהותיים יפורסמו באתר. המשך השימוש באתר לאחר פרסום השינויים מהווה הסכמה לתנאים המעודכנים.
          תאריך העדכון האחרון: {LAST_UPDATED}.
        </p>
      ),
    },
    {
      id: 'contact',
      title: '11. יצירת קשר בנושאי פרטיות',
      content: (
        <>
          <p className="mb-2">לכל שאלה, בקשה או תלונה בנושא פרטיות, ניתן לפנות אל:</p>
          <p className="font-semibold text-brand-dark">{OWNER_NAME} – {BUSINESS_NAME}</p>
          <p>{ADDRESS}</p>
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
  ]

  return (
    <section aria-label="מדיניות פרטיות" className="section-padding bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-brand-gold/10 border border-brand-gold/30 rounded-2xl px-5 py-4 mb-10 text-sm text-brand-medium"
        >
          מסמך זה עודכן לאחרונה ב-{LAST_UPDATED}. הוא נכתב בהתאם לחוק הגנת הפרטיות, תשמ"א–1981
          ותקנות הגנת הפרטיות (אבטחת מידע), תשע"ז–2017.
        </motion.div>

        <div className="space-y-8">
          {sections.map((section, i) => (
            <motion.div
              key={section.id}
              id={section.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
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
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 text-brand-rose font-semibold hover:text-brand-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
          >
            לשאלות נוספות – יצירת קשר
          </Link>
        </div>
      </div>
    </section>
  )
}
