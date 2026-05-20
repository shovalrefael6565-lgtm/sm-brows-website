import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/utils'
import { blogPosts } from '@/lib/data'

/**
 * sitemap.xml דינמי — נוצר אוטומטית מהמסלולים והבלוג
 * כל פעם שמוסיפים פוסט/דף — מתעדכן בלי שינוי קוד
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL,                      lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE_URL}/services`,        lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/gallery`,         lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/booking`,         lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/contact`,         lastModified: now, changeFrequency: 'yearly',  priority: 0.7 },
    { url: `${SITE_URL}/faq`,             lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/blog`,            lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE_URL}/shop`,            lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/privacy`,         lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/terms`,           lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/accessibility`,   lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
  ]

  const blogRoutes: MetadataRoute.Sitemap = blogPosts.map(post => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: 'monthly',
    priority: 0.6,
  }))

  return [...staticRoutes, ...blogRoutes]
}
