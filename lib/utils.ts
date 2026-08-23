import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** כתובת בסיס לאתר — משמשת ל-SEO, sitemap, canonical, OG */
/** הדומיין הקנוני מקובע בכוונה: ה-canonical/OG חייבים תמיד להצביע לדומיין */
/** האמיתי, ולא לדומיין vercel.app (גם אם NEXT_PUBLIC_SITE_URL מוגדר אחרת). */
export const SITE_URL = 'https://smbrows.co.il'

export const WHATSAPP_BASE = 'https://wa.me/972552932813'
export const WHATSAPP_URL  = `${WHATSAPP_BASE}?text=${encodeURIComponent('היי שובל 🤍 רציתי לקבוע תור')}`
export const PHONE_NUMBER = '055-293-2813'
export const PHONE_RAW = '0552932813'
/*
  אותו מספר בדיוק, בפורמט E.164 — ל-structured data בלבד. Google מבקשת
  את הצורה הבינלאומית ב-JSON-LD כדי לקשר את הטלפון לישות אחת חד-משמעית.
  ⚠️ לא לתצוגה: מה שהמבקרת רואה נשאר PHONE_NUMBER בכל מקום באתר.
*/
export const PHONE_E164 = '+972552932813'
/*
  שלושה שימושים שונים למיקום, ובכוונה שלושה קבועים — עד לפאס ה-SEO הם היו
  קבוע אחד, ושינוי של הנוסח השיווקי גרר איתו בשקט גם את נוסח התזכורות.

  LOCATION             — התצוגה הציבורית באתר (פוטר, יצירת קשר, פרטיות, קורס).
  STREET_ADDRESS       — הרחוב הפוסטלי האמיתי, ל-JSON-LD. לא טקסט שיווקי.
  APPOINTMENT_LOCATION — המיקום כפי שהוא מופיע בתזכורות ללקוחה. נוסח מאושר:
                         אין לשנות אותו כחלק משינוי שיווקי/SEO.
*/
export const LOCATION = 'עיר היין, אשקלון'
export const STREET_ADDRESS = 'הכורמים 14'
export const APPOINTMENT_LOCATION = 'הכורמים, אשקלון'
export const EMAIL = 'shoval3654579@gmail.com'
export const INSTAGRAM_URL = 'https://www.instagram.com/shovalmeira/'
export const FACEBOOK_URL = 'https://www.facebook.com/shovalvahdy'
export const TIKTOK_URL = 'https://www.tiktok.com/@shovalbrows?_r=1&_t=ZS-96W3SJ62zyc'
/** פרופיל העסק בגוגל (Google Business Profile) */
export const GOOGLE_BUSINESS_URL = 'https://share.google/X2mvO3sEyQttxMydz'

/*
  ── עוגני הישות ל-JSON-LD ────────────────────────────────────────────────
  מזהים יציבים וקבועים. כל אזכור של העסק בכל עמוד מצביע ל-BUSINESS_ID
  היחיד הזה, כך שהעסק הוא ישות אחת בגרף — ולא ישות חדשה בכל עמוד.

  ⚠️ אלה מזהים, לא כתובות לניווט. הם לעולם לא נפתרים לעמוד אמיתי, ואסור
  לשנות אותם אחרי פרסום: מנוע שכבר מיפה את הישות מזהה אותה לפי המחרוזת
  הזו, ושינוי שלה מייצר ישות חדשה ומאבד את מה שנצבר.
*/
export const BUSINESS_ID = `${SITE_URL}/#business`
export const WEBSITE_ID = `${SITE_URL}/#website`
export const PERSON_ID = `${SITE_URL}/#shoval`

/**
 * שובל מאירה — האדם שמאחורי העסק.
 *
 * ⚠️ אלה כל העובדות שאושרו עליה, וזו הרשימה המלאה. אין להוסיף כאן
 * הכשרות, תעודות, פרסים, מקומות לימוד או הסמכות — שום דבר מהם לא נמסר,
 * וסימון כזה ב-JSON-LD הוא המצאה שגוגל מתייחסת אליה כתוכן מטעה.
 */
export const PERSON_NAME = 'שובל מאירה'
export const PERSON_NAME_EN = 'Shoval Meira'
export const PERSON_YEARS_EXPERIENCE = 5

/**
 * הופך נתיב יחסי ל-URL מוחלט, ומחזיר URL שכבר מוחלט כמו שהוא.
 *
 * ⚠️ נכתב אחרי באג אמיתי: ב-BlogPosting JSON-LD היה
 * `image: \`${SITE_URL}${post.image}\``, ותמונות הבלוג הן URL-ים מוחלטים
 * של Unsplash — כך שהתוצאה בפרודקשן הייתה
 * "https://smbrows.co.ilhttps://images.unsplash.com/..." בכל פוסט.
 * scripts/test-seo-schema.mjs מוודא שהשרשור הזה לא חוזר.
 */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
}
