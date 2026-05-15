import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import BlogCard from '@/components/blog/BlogCard'
import { blogPosts } from '@/lib/data'

export const metadata: Metadata = {
  title: 'מאמרים | S.M BROWS',
  description:
    'מאמרים וטיפים מקצועיים על עיצוב גבות, מיקרובליידינג, הרמת גבות, וטיפוח מ-S.M BROWS.',
}

const CATEGORIES = ['הכל', 'מיקרובליידינג', 'עיצוב גבות', 'הרמת גבות']

export default function BlogPage() {
  return (
    <>
      <PageHero
        tag="הבלוג שלי"
        title="טיפים, ידע"
        titleHighlight="ועדכונים"
        description="כל מה שצריך לדעת על גבות – מאמרים מקצועיים, טיפים לטיפול, ועדכונים מהסטודיו."
      />

      <section aria-label="מאמרים" className="section-padding bg-brand-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/* Category filters */}
          <div
            className="flex items-center gap-2 flex-wrap mb-10"
            role="group"
            aria-label="סינון מאמרים לפי קטגוריה"
          >
            {CATEGORIES.map((cat) => (
              <span
                key={cat}
                className="px-4 py-2 rounded-full text-sm font-medium bg-white text-brand-medium border border-brand-cream-dark cursor-default"
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
                <BlogCard post={post} priority={i === 0} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
