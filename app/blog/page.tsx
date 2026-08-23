import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import BlogCard from '@/components/blog/BlogCard'
import { blogPosts } from '@/lib/data'
import { SITE_URL } from '@/lib/utils'
import { breadcrumbJsonLd } from '@/lib/breadcrumbs'

export const metadata: Metadata = {
  title: 'מאמרים',
  description:
    'מאמרים וטיפים מקצועיים על עיצוב גבות, מיקרובליידינג, הרמת גבות, וטיפוח מ-S.M BROWS.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'מאמרים | S.M BROWS',
    description: 'מאמרים וטיפים מקצועיים על עיצוב גבות, מיקרובליידינג, הרמת גבות וטיפוח.',
    url: `${SITE_URL}/blog`,
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [
      { url: '/hero.webp', width: 1200, height: 630, alt: 'S.M BROWS — מאמרים' },
    ],
  },
}

const CATEGORIES = ['הכל', 'מיקרובליידינג', 'עיצוב גבות', 'הרמת גבות']

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

        title="טיפים, ידע"
        titleHighlight="ועדכונים"
        description="כל מה שצריך לדעת על גבות – מאמרים מקצועיים, טיפים לטיפול, ועדכונים מהקליניקה."
      />

      <section aria-label="מאמרים" className="section-padding bg-brand-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/* Category filters */}
          <div
            className="flex items-center gap-2 flex-wrap mb-10"
            role="group"
            aria-label="סינון מאמרים לפי קטגוריה"
          >
            {CATEGORIES.map((cat, i) => (
              <span
                key={cat}
                className={`px-4 py-2 rounded-full text-sm font-medium border cursor-default ${
                  i === 0
                    ? 'bg-brand-gold text-brand-dark border-brand-gold font-bold'
                    : 'bg-white text-brand-medium border-brand-cream-dark'
                }`}
                aria-label={`קטגוריה: ${cat}`}
              >
                {cat}
              </span>
            ))}
          </div>

          {/* Posts grid */}
          <ul
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            role="list"
            aria-label="רשימת מאמרים"
          >
            {blogPosts.map((post, i) => (
              <li key={post.id}>
                <BlogCard post={post} priority={i === 0} headingLevel={2} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
