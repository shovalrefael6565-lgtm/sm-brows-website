import type { MetadataRoute } from 'next'
import { blogPosts } from '@/lib/data'

const SITE_URL = 'https://smbrows.co.il'

/**
 * sitemap.xml דינמי — נוצר אוטומטית מהמסלולים והבלוג
 * כל פעם שמוסיפים פוסט/דף — מתעדכן בלי שינוי קוד
 */
/*
  ⚠️ אין lastModified לעמודים הסטטיים — וזה מכוון.

  קודם כל 12 העמודים קיבלו `new Date()`, כלומר רגע הבנייה. כל דיפלוי,
  גם כזה שלא נגע בהם, הכריז עליהם כ"השתנו הרגע". סיגנל שמצביע תמיד על
  "עכשיו" הוא סיגנל שגוגל לומדת להתעלם ממנו — וגרוע מכך, הוא לא נכון.

  אין כרגע מקור אמין לתאריך השינוי האחרון של עמוד סטטי (התוכן חי בקוד,
  לא ב-CMS עם timestamp). לפי מפרט ה-sitemap התג אופציונלי, ולכן עדיף
  להשמיט אותו מאשר להמציא תאריך. פוסטי הבלוג כן שומרים lastModified —
  שם post.date הוא תאריך אמיתי מ-lib/data.ts.

  אם בעתיד יהיה מקור אמיתי (CMS / git log per-route) — להחזיר אותו כאן.
*/
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL,                      changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE_URL}/services`,        changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/course`,          changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/booking`,         changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/contact`,         changeFrequency: 'yearly',  priority: 0.7 },
    { url: `${SITE_URL}/faq`,             changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/blog`,            changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE_URL}/shop`,            changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/privacy`,         changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/terms`,           changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/accessibility`,   changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/booking-policy`,  changeFrequency: 'yearly',  priority: 0.4 },
  ]

  const blogRoutes: MetadataRoute.Sitemap = blogPosts.map(post => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: 'monthly',
    priority: 0.6,
  }))

  return [...staticRoutes, ...blogRoutes]
}
