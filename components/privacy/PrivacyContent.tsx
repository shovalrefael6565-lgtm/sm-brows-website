'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { EMAIL, WHATSAPP_URL, PHONE_NUMBER, LOCATION } from '@/lib/utils'
import { PRIVACY_NOTICE_VERSION, PRIVACY_NOTICE_UPDATED } from '@/lib/privacyNotice'

const OWNER_NAME = 'שובל ואחדי מאירה'
const BUSINESS_NAME = 'S.M BROWS'

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
          מדיניות פרטיות זו מתארת את האופן שבו {BUSINESS_NAME}, בבעלות {OWNER_NAME} (להלן: &quot;הקליניקה&quot; או &quot;אני&quot;),
          אוספת, משתמשת ושומרת מידע אישי של לקוחות ומבקרות באתר, בהתאם לחוק הגנת הפרטיות, תשמ&quot;א–1981
          ותקנות הגנת הפרטיות (אבטחת מידע), תשע&quot;ז–2017. שליחת בקשת תור, כניסה לאזור האישי או יצירת קשר
          עם הקליניקה מהווה הסכמה למדיניות פרטיות זו. מסמך זה נועד ליידע ואינו מהווה ייעוץ משפטי או
          הצהרה על עמידה מלאה בדין.
        </p>
      ),
    },
    {
      id: 'controller',
      title: '2. מי אחראית על המידע ופרטי הקשר',
      content: (
        <>
          <p className="mb-2">
            בעלת השליטה במאגר המידע היא {OWNER_NAME}, בעלת {BUSINESS_NAME}.
          </p>
          <ul className="list-disc list-inside space-y-1 text-brand-medium text-sm">
            <li>כתובת: {LOCATION}</li>
            <li>טלפון: <span dir="ltr">{PHONE_NUMBER}</span></li>
            <li>דואר אלקטרוני: <a href={`mailto:${EMAIL}`} className="text-brand-rose-text hover:underline">{EMAIL}</a></li>
          </ul>
        </>
      ),
    },
    {
      id: 'collected-data',
      title: '3. סוגי המידע שאני אוספת',
      content: (
        <>
          <p className="mb-3">בהתאם לאופן שבו נעשה שימוש באתר, אני עשויה לאסוף:</p>
          <ul className="list-disc list-inside space-y-2 text-brand-medium text-sm">
            <li><strong>שם ומספר טלפון</strong> — לזיהוי הלקוחה וניהול כרטיס הלקוחה.</li>
            <li><strong>פרטי תורים והיסטוריית שירות:</strong> סוג הטיפול, תאריך ושעה, סטטוס התור ותורים קודמים.</li>
            <li><strong>הערות לוגיסטיות אופציונליות</strong> שנמסרות בשדה ההערות בטופס ההזמנה — לתיאום התור בלבד. אין לכלול בשדה זה מידע רפואי או מידע אישי רגיש אחר.</li>
            <li><strong>נתוני OTP, session ואבטחה:</strong> קוד אימות (מוצפן/מגובב, לא בטקסט גלוי), פרטי הפעלת כניסה וכתובת IP — לצורך זיהוי בכניסה לאזור האישי ומניעת שימוש לרעה.</li>
            <li><strong>נתוני גלישה ואנליטיקס/שיווק</strong> (כגון Google Analytics ו-Meta Pixel) — <strong>רק לאחר הסכמה נפרדת</strong> שניתנת או נשללת דרך הגדרות הפרטיות באתר, ואינה קשורה לאישור מדיניות הפרטיות בטופס ההזמנה.</li>
          </ul>
          <p className="mt-3 text-sm">
            אינני אוספת ביודעין מידע רגיש כהגדרתו בחוק (כגון מידע רפואי, ביומטרי, דתי או פוליטי). שדה
            ההערות בטופס ההזמנה מיועד לבקשות תיאום לוגיסטיות בלבד ואינו מיועד למידע רפואי — לבירור התאמה
            לטיפול יש לפנות אליי ישירות.
          </p>
        </>
      ),
    },
    {
      id: 'mandatory-optional',
      title: '4. אילו פרטים חובה ואילו רשות',
      content: (
        <>
          <p className="mb-2">
            <strong>שם ומספר טלפון הם שדות חובה.</strong> בלעדיהם לא ניתן לזהות אתכן, לנהל כרטיס לקוחה,
            לשלוח בקשת תור או ליצור קשר בנוגע לשירות — ולכן לא ניתן להשלים הזמנת תור או כניסה לאזור
            האישי ללא מסירתם.
          </p>
          <p>
            שדה ההערות בטופס ההזמנה הוא <strong>רשות</strong>. אי-מסירתו אינו מונע שליחת בקשת תור.
          </p>
        </>
      ),
    },
    {
      id: 'purpose',
      title: '5. מטרת איסוף המידע והשימוש בו',
      content: (
        <ul className="list-disc list-inside space-y-2 text-brand-medium text-sm">
          <li>זיהוי הלקוחה וניהול כרטיס הלקוחה.</li>
          <li>קביעה, אישור, שינוי וביטול תורים, וניהול לוח הזמנים.</li>
          <li>יצירת קשר בנוגע לתור או לשירות (כולל תזכורות ועדכוני סטטוס).</li>
          <li>מתן השירות עצמו והמשך הקשר העסקי מול לקוחות קיימות.</li>
          <li>אבטחת האתר ומניעת שימוש לרעה (כניסה לאזור האישי, הגבלת קצב בקשות).</li>
          <li>בירור מחלוקות ועמידה בחובות הדין החלות על העסק.</li>
          <li>סטטיסטיקה ושיווק — <strong>רק לאחר הסכמה נפרדת</strong>, כמפורט בסעיף 3.</li>
          <li>
            משלוח עדכונים, הטבות ותזכורות לקביעת תור חדש ב-SMS — <strong>רק ללקוחה שסימנה
            בעצמה את תיבת הדיוור האופציונלית בטופס ההזמנה</strong>, וניתן להסרה בכל עת.
          </li>
        </ul>
      ),
    },
    {
      id: 'why-needed',
      title: '6. מדוע נדרשים הפרטים ומה קורה בלעדיהם',
      content: (
        <ul className="list-disc list-inside space-y-2 text-brand-medium text-sm">
          <li>פרטי החובה (שם ומספר טלפון) נדרשים לטיפול בבקשת התור, לניהול התור וליצירת קשר בנוגע לשירות.</li>
          <li>ללא מסירת פרטי החובה לא ניתן להגיש את הבקשה או לטפל בה.</li>
          <li>
            סימון תיבת האישור בטופס ההזמנה מתעד שהלקוחה קראה את הודעת הפרטיות ואת מדיניות הפרטיות; הוא
            אינו מוצג ואינו מהווה הסכמה גורפת לכל עיבוד מידע.
          </li>
        </ul>
      ),
    },
    {
      id: 'storage',
      title: '7. שמירת המידע',
      content: (
        <>
          <p>
            שם, מספר טלפון, פרטי תורים והיסטוריית שירות נשמרים כל עוד הם נחוצים לשם ניהול הקשר השוטף
            עם הלקוחה — לרבות תורים עתידיים, המשך מתן שירות, בירור מחלוקות ועמידה בחובות שמירה על-פי
            דין.
          </p>
          <p className="mt-3">
            <strong>רשומות טכניות הנמחקות אוטומטית.</strong> על הרשומות הבאות פועל מנגנון ניקוי
            מבוסס-זמן, והן נמחקות מבסיס הנתונים:
          </p>
          <ul className="mt-2 list-disc space-y-1 pr-5">
            <li>ניסיונות אימות (קודי כניסה) — <strong>7 ימים</strong> ממועד יצירתם.</li>
            <li>הפעלות כניסה לאזור האישי — <strong>30 ימים</strong> לאחר פקיעתן או ביטולן.</li>
            <li>רישומי ניסיונות שליחה של הודעות — <strong>90 ימים</strong> לאחר סיום הניסיון.</li>
          </ul>
          <p className="mt-3">
            <strong>מזעור, ולא מחיקה.</strong> הערה חופשית שנרשמה על תור מרוקנת <strong>90 ימים</strong>
            לאחר מועד התור. התור עצמו, השם ומספר הטלפון נשמרים — רק תוכן ההערה מוסר.
          </p>
          <p className="mt-3">
            <strong>מה שאינו נמחק אוטומטית.</strong> כרטיס הלקוחה, פרטי התורים והיסטוריית השירות
            אינם כפופים למחיקה אוטומטית. כרטיסים ללא פעילות למעלה מ-24 חודשים נכללים בדוח בדיקה
            תקופתי בלבד — הדוח אינו מוחק דבר, וכל מחיקה בפועל נעשית ידנית ובכפוף לדין, לצורך העסקי
            ולחובות השמירה החלות עליי.
          </p>
          <p className="mt-3">
            ניתן לסמן כרטיס לקוחה כך שהמזעור האוטומטי לא יחול עליו — למשל כאשר יש מחלוקת פתוחה או
            חובת שמירה קונקרטית. סימון כזה עוצר את המזעור, ואינו משפיע על דוחות הבדיקה התקופתיים.
          </p>
        </>
      ),
    },
    {
      id: 'sharing',
      title: '8. ספקי שירות ומסירת מידע',
      content: (
        <>
          <p className="mb-3">
            אינני מוכרת ואינני משכירה מידע אישי לצדדים שלישיים למטרות שיווקיות. לצורך הפעלת האתר
            והשירות, המידע עשוי להישמר ולעבור עיבוד באמצעות הספקים הבאים:
          </p>
          <ul className="list-disc list-inside space-y-2 text-brand-medium text-sm">
            <li><strong>Supabase</strong> — מסד הנתונים שבו נשמר כרטיס הלקוחה ופרטי התורים.</li>
            <li><strong>Vercel</strong> — אחסון והרצת האתר.</li>
            <li>
              <strong>Google Calendar</strong> — <strong>שם הלקוחה, סוג הטיפול ומועד התור עשויים
              להישמר ביומן Google העסקי שלי</strong>, לצורך ניהול לוח הזמנים. מספר הטלפון והערות
              חופשיות שנמסרות בטופס ההזמנה אינם מוכנסים ליומן.
            </li>
            <li>
              <strong>ספק SMS (019)</strong> — לשליחת קוד כניסה חד-פעמי (OTP) ותזכורות תור.
              בנוסף, ורק ללקוחה שסימנה בעצמה את תיבת הדיוור בטופס ההזמנה, נשלחים דרכו גם
              עדכונים והטבות. כל הודעת דיוור כזו כוללת קישור להסרה, וההסרה אינה משפיעה על
              הודעות השירות (תזכורת, אישור, ביטול, שינוי מועד) ועל קוד הכניסה.
            </li>
            <li>
              <strong>WhatsApp / Meta</strong> — הודעות בנוגע לתור (בקשה, אישור, דחייה, תזכורת) נשלחות
              דרך WhatsApp. הודעה נשלחת רק כאשר הלקוחה או אני לוחצות בעצמנו על &quot;שליחה&quot; בתוך
              WhatsApp — האתר אינו שולח הודעות WhatsApp אוטומטיות.
            </li>
            <li>
              <strong>Google Analytics (GA4) ו-Meta Pixel</strong> — רק לאחר הסכמה נפרדת ומפורשת
              שניתנת דרך הגדרות הפרטיות באתר, ולעולם לא באזור האישי, במסך הכניסה או בממשק הניהול.
            </li>
          </ul>
          <p className="mt-3 text-sm">
            חלק מהספקים הללו (בהם Google ו-Meta) עשויים לעבד מידע גם מחוץ לישראל, כחלק מהתשתית
            הגלובלית הרגילה שלהם. אינני יכולה להצהיר במסמך זה על אזור אחסון מדויק או על תוכן הסכמי
            עיבוד מידע ספציפיים מול כל ספק — פרטים אלה כפופים למדיניות הפרטיות של הספק עצמו.
          </p>
        </>
      ),
    },
    {
      id: 'consent-checkbox',
      title: '9. אישור מדיניות הפרטיות בטופס ההזמנה',
      content: (
        <>
          <p className="mb-2">
            לפני שליחת בקשת תור נדרש סימון חובה בתיבה &quot;קראתי את הודעת הפרטיות ואת מדיניות
            הפרטיות&quot;. <strong>סימון התיבה מתעד שהלקוחה קראה את הודעת הפרטיות ואת מדיניות
            הפרטיות; הוא אינו מוצג כהסכמה גורפת לכל עיבוד מידע.</strong>
          </p>
          <p>
            <strong>אישור זה נפרד לחלוטין מהסכמה לאנליטיקס (Google Analytics) או לשיווק (Meta
            Pixel)</strong> — הסכמה כזו ניתנת או נשללת רק דרך הגדרות הפרטיות באתר, ואינה מוסקת מהמשך
            גלישה, מסימון תיבת האישור או משליחת בקשת תור.
          </p>
          <p className="mt-2">
            מתחת לתיבה זו מופיעה <strong>תיבה שנייה, נפרדת ואופציונלית</strong>, לאישור קבלת עדכונים,
            הטבות ותזכורות לקביעת תורים ב-SMS. <strong>היא אינה מסומנת מראש ואינה תנאי לקביעת
            תור</strong> — בקשת תור נשלחת ומטופלת בדיוק באותו אופן בלי לסמן אותה. סימונה נשמר יחד עם
            מועד הסימון ומקורו, וניתן להסיר את ההסכמה בכל עת דרך הקישור שבכל הודעת דיוור. הסרה כזו
            אינה עוצרת הודעות שירות בנוגע לתור ואינה עוצרת את קוד הכניסה לאזור האישי.
          </p>
        </>
      ),
    },
    {
      id: 'rights',
      title: '10. זכויות הלקוחה',
      content: (
        <>
          <p className="mb-3">
            בהתאם לחוק הגנת הפרטיות, תשמ&quot;א–1981, ניתן לפנות אליי בבקשה:
          </p>
          <ul className="list-disc list-inside space-y-2 text-brand-medium text-sm">
            <li>לעיין במידע שאני שומרת אודותייך.</li>
            <li>לתקן מידע שגוי, חסר או לא עדכני.</li>
            <li>למחוק מידע — בכפוף לדין, לצורך העסקי הלגיטימי (למשל תורים קיימים) ולחובות שמירה החלות עליי.</li>
            <li>לבטל בכל עת הסכמה לאנליטיקס או לשיווק, דרך הגדרות הפרטיות באתר.</li>
            <li>להסיר את עצמך בכל עת מדיוור ה-SMS, דרך הקישור שבכל הודעת דיוור או בפנייה אליי.</li>
          </ul>
          <p className="mt-3">
            כל בקשה נבדקת ונענית באופן ידני בזמן סביר. <strong>אין כרגע מסלול self-service אוטומטי
            לעיון, תיקון או מחיקה</strong> — הדרך לפנייה היא דרך פרטי הקשר בסעיף 11.
          </p>
        </>
      ),
    },
    {
      id: 'cookies',
      title: '11. עוגיות (Cookies) והסכמה',
      content: (
        <p>
          האתר משתמש בעוגיות אנליטיקס ושיווק (Google Analytics, Meta Pixel) רק לאחר הסכמה מפורשת
          שנשאלת בבאנר ההסכמה ונשמרת בהעדפותייך. ניתן לשנות או לבטל את ההסכמה בכל עת דרך הקישור
          &quot;הגדרות פרטיות ועוגיות&quot; בתחתית האתר. עוגיות אלה אינן פעילות באזור האישי, במסך
          הכניסה או בממשק הניהול.
        </p>
      ),
    },
    {
      id: 'minors',
      title: '12. קטינים',
      content: (
        <p>
          שירותי הקליניקה מיועדים לבני 16 ומעלה. קטינים מתחת לגיל 16 נדרשים לקבל הסכמת הורה או
          אפוטרופוס לפני קביעת תור ומסירת מידע אישי.
        </p>
      ),
    },
    {
      id: 'security',
      title: '13. אבטחת מידע',
      content: (
        <p>
          אני נוקטת אמצעי אבטחה טכניים וארגוניים סבירים בנסיבות העניין להגנה על המידע מפני גישה בלתי
          מורשית, אובדן, שינוי או גילוי — לרבות הצפנת תעבורה, הפרדת הרשאות בין לקוחות למנהלת המערכת,
          ואימות בכניסה לאזור האישי באמצעות קוד חד-פעמי.
        </p>
      ),
    },
    {
      id: 'updates',
      title: '14. עדכונים למדיניות',
      content: (
        <p>
          אני שומרת לעצמי את הזכות לעדכן מדיניות פרטיות זו מעת לעת. עדכונים מהותיים יפורסמו באתר.
          המשך השימוש באתר לאחר פרסום השינויים מהווה הסכמה לתנאים המעודכנים.
          <br />
          תאריך העדכון האחרון: {PRIVACY_NOTICE_UPDATED} (גרסה {PRIVACY_NOTICE_VERSION}).
        </p>
      ),
    },
    {
      id: 'contact',
      title: '15. יצירת קשר בנושאי פרטיות',
      content: (
        <>
          <p className="mb-2">לבקשת עיון, תיקון או מחיקה, או לכל שאלה או תלונה בנושא פרטיות, ניתן לפנות אל:</p>
          <p className="font-semibold text-brand-dark">{OWNER_NAME} – {BUSINESS_NAME}</p>
          <p>{LOCATION}</p>
          <p>
            דואר אלקטרוני:{' '}
            <a href={`mailto:${EMAIL}`} className="text-brand-rose-text hover:underline">{EMAIL}</a>
          </p>
          <p>
            וואצאפ:{' '}
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="text-brand-rose-text hover:underline">
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
          מסמך זה עודכן לאחרונה ב-{PRIVACY_NOTICE_UPDATED} (גרסה {PRIVACY_NOTICE_VERSION}). הוא נכתב
          בהתאם לחוק הגנת הפרטיות, תשמ&quot;א–1981 ותקנות הגנת הפרטיות (אבטחת מידע), תשע&quot;ז–2017,
          ואינו מהווה ייעוץ משפטי.
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
            className="inline-flex items-center gap-2 text-brand-rose-text font-semibold hover:text-brand-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
          >
            לשאלות נוספות – יצירת קשר
          </Link>
        </div>
      </div>
    </section>
  )
}
