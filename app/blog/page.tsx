import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import BlogList from '@/components/blog/BlogList'
import { blogPosts } from '@/lib/data'
import { SITE_URL } from '@/lib/utils'
import { breadcrumbJsonLd } from '@/lib/breadcrumbs'

export const metadata: Metadata = {
  title: 'מאמרים מקצועיים על גבות',
  description:
    'מדריכים, תשובות וטיפים מקצועיים על עיצוב גבות, צביעת גבות, מיקרובליידינג והרמת גבות — מהקליניקה של שובל באשקלון.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'מאמרים מקצועיים על גבות | S.M BROWS',
    description: 'מדריכים, תשובות וטיפים מקצועיים על עיצוב גבות, צביעת גבות, מיקרובליידינג והרמת גבות.',
    url: `${SITE_URL}/blog`,
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [
      { url: '/hero.webp', width: 1200, height: 630, alt: 'S.M BROWS — מאמרים מקצועיים על גבות' },
    ],
  },
}

export default function BlogPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([{ name: 'מאמרים', path: '/blog' }]),
          ),
        }}
      />
      <PageHero

        title="כל מה שחשוב לדעת על"
        titleHighlight="הגבות שלך"
        description="מדריכים, תשובות וטיפים מקצועיים שיעזרו לך להבין מה באמת מתאים לגבות שלך ואיך לשמור על תוצאה טבעית ומדויקת."
      />

      <section aria-label="מאמרים" className="section-padding bg-brand-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/*
            הסינון והכרטיסים חיים ב-BlogList (קומפוננטת לקוח) — הוא זה
            שמחזיק את הקטגוריה הפעילה. הפוסטים מגיעים מכאן כדי שהרשימה
            תהיה מרונדרת מהשרת במלואה.
          */}
          <BlogList posts={blogPosts} />
        </div>
      </section>
    </>
  )
}
