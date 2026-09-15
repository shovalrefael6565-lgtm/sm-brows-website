'use client'

import { useMemo, useState } from 'react'
import BlogCard from '@/components/blog/BlogCard'
import FeaturedPostCard from '@/components/blog/FeaturedPostCard'
import { type BlogPost } from '@/lib/data'

interface Props {
  posts: BlogPost[]
}

const ALL = 'הכל'

/**
 * רשימת המאמרים של /blog — כרטיסים + סינון לפי קטגוריה.
 *
 * ⚠️ הקטגוריות נגזרות מהפוסטים עצמם ולא מרשימה קבועה. קודם ישבה כאן
 * רשימה ידנית של שלוש קטגוריות, כך שכל פוסט בקטגוריה חדשה היה נופל
 * מחוץ לסרגל בשקט. עכשיו אי אפשר שהשניים יתפצלו.
 *
 * ⚠️ עד עכשיו הצ'יפים היו <span> עם cursor-default — סרגל שנראה כמו סינון
 * ולא סינן כלום. הם כפתורים אמיתיים עכשיו, עם aria-pressed. אין חיפוש
 * ואין עימוד: עם ארבעה מאמרים זה היה רעש ולא עזרה.
 *
 * הרשימה מלאה כבר ב-SSR (ברירת המחדל היא "הכל"), ולכן כל הכרטיסים
 * נמצאים ב-HTML הראשוני גם בלי JavaScript.
 */
export default function BlogList({ posts }: Props) {
  const [active, setActive] = useState<string>(ALL)

  const categories = useMemo(
    () => [ALL, ...Array.from(new Set(posts.map((p) => p.category)))],
    [posts],
  )

  const visible = active === ALL ? posts : posts.filter((p) => p.category === active)
  const featured = visible.find((p) => p.featured)
  const rest = featured ? visible.filter((p) => p.id !== featured.id) : visible

  return (
    <>
      {/* סינון לפי קטגוריה */}
      <div
        className="flex items-center gap-2 flex-wrap mb-10"
        role="group"
        aria-label="סינון מאמרים לפי קטגוריה"
      >
        {categories.map((cat) => {
          const isActive = cat === active
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActive(cat)}
              aria-pressed={isActive}
              className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 ${
                isActive
                  ? 'bg-brand-gold text-brand-dark border-brand-gold font-bold'
                  : 'bg-white text-brand-medium border-brand-cream-dark hover:border-brand-gold'
              }`}
            >
              {cat}
            </button>
          )
        })}
      </div>

      <p className="sr-only" aria-live="polite">
        {visible.length === 1 ? 'מוצג מאמר אחד' : `מוצגים ${visible.length} מאמרים`}
        {active === ALL ? '' : ` בקטגוריה ${active}`}
      </p>

      {/* מאמר מומלץ */}
      {featured && (
        <div className="mb-10">
          <FeaturedPostCard post={featured} />
        </div>
      )}

      {/* שאר המאמרים */}
      {rest.length > 0 && (
        <ul
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          role="list"
          aria-label="רשימת מאמרים"
        >
          {rest.map((post, i) => (
            <li key={post.id}>
              <BlogCard post={post} priority={!featured && i === 0} headingLevel={2} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
