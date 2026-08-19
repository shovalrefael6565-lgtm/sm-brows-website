import type { MetadataRoute } from 'next'

/**
 * שלב 9 — Web App Manifest.
 *
 * מוגש ע"י Next.js בכתובת /manifest.webmanifest, ותגית ה-<link rel="manifest">
 * מוזרקת אוטומטית לכל עמוד דרך ה-Root Layout. ה-CSP כבר מתיר
 * `manifest-src 'self'` (next.config.mjs), ולכן אין צורך בשינוי כותרות.
 *
 * הצבעים אינם חדשים: #FAF7F5 הוא brand-cream — אותו ערך שכבר משמש כרקע
 * ה-<body> וכ-themeColor ב-app/layout.tsx. הכוונה היא שסרגל המערכת ומסך
 * הפתיחה יימשכו ברצף מהעיצוב הקיים, בלי שינוי branding.
 *
 * ⚠️ אין כאן service worker ואין offline caching: האתר הוא SSG/ISR עם
 * מערכת תורים חיה (זמינות, אישורי תור, אזור אישי) — קאש offline של תוכן
 * כזה מציג מידע שגוי ומסוכן ללקוחה, וה-Cache-Control הקיים כבר עושה את
 * העבודה. installability באנדרואיד אינה דורשת service worker מאז
 * Chrome 118 (מספיקים manifest + start_url + אייקון 192/512 + HTTPS).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'S.M BROWS | עיצוב גבות מקצועי באשקלון',
    short_name: 'S.M BROWS',
    description:
      'קליניקה מקצועית לעיצוב גבות באשקלון. מיקרובליידינג, עיצוב גבות טבעיות, הרמת גבות וקביעת תור אונליין.',
    lang: 'he',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // אם הדפדפן לא תומך ב-standalone — minimal-ui לפני נפילה ל-browser.
    display_override: ['standalone', 'minimal-ui'],
    background_color: '#FAF7F5',
    theme_color: '#FAF7F5',
    categories: ['beauty', 'lifestyle'],
    // אין orientation נעול: האתר רספונסיבי, ונעילה לפורטרייט הייתה משנה
    // התנהגות קיימת בטאבלט.
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // רק יעדים ציבוריים שאינם תלויי דגל או התחברות — קיצור שמוביל ל-404
    // (למשל /account כשהמערכת החדשה כבויה) נראה שבור במסך הבית.
    shortcuts: [
      { name: 'קביעת תור', short_name: 'תור', url: '/booking' },
      { name: 'הטיפולים שלנו', short_name: 'טיפולים', url: '/services' },
    ],
  }
}
