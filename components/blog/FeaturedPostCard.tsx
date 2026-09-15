import Image from 'next/image'
import Link from 'next/link'
import { Clock, ArrowLeft } from 'lucide-react'
import { type BlogPost } from '@/lib/data'

interface Props {
  post: BlogPost
}

/**
 * המאמר המומלץ בראש /blog.
 *
 * אותם אלמנטים בדיוק של BlogCard — תג קטגוריה, זמן קריאה, כותרת, תקציר
 * ו-"קראי עוד" — רק בפריסה רחבה: תמונה בצד אחד וטקסט בשני. אין כאן צבע,
 * צל או רדיוס חדשים, רק הגדלה של אותו כרטיס.
 */
export default function FeaturedPostCard({ post }: Props) {
  return (
    <article
      aria-label={`מאמר מומלץ: ${post.title}`}
      className="group bg-white rounded-3xl overflow-hidden shadow-soft hover:shadow-soft-lg transition-all duration-300 border border-brand-cream-dark/50 grid grid-cols-1 lg:grid-cols-2"
    >
      {/* תמונה — ילד ראשון ב-DOM, ובעמודת ה-RTL הוא נופל ימינה */}
      <Link
        href={`/blog/${post.slug}`}
        aria-label={`קרא את המאמר: ${post.title}`}
        className="relative block aspect-[4/3] lg:aspect-auto lg:min-h-[340px] overflow-hidden focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-gold focus-visible:ring-inset"
        tabIndex={-1}
      >
        <Image
          src={post.image}
          alt={post.imageAlt}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          style={post.imagePosition ? { objectPosition: post.imagePosition } : undefined}
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-brand-dark/20 to-transparent"
          aria-hidden="true"
        />
        <span className="absolute top-4 start-4 bg-brand-gold/90 text-brand-dark text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-sm">
          {post.category}
        </span>
      </Link>

      {/* טקסט */}
      <div className="p-6 sm:p-8 lg:p-10 flex flex-col justify-center">
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <span className="text-xs font-bold text-brand-gold-text uppercase tracking-wider">
            מאמר מומלץ
          </span>
          <span className="w-px h-3 bg-brand-cream-dark" aria-hidden="true" />
          <span className="flex items-center gap-1 text-xs text-brand-muted">
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span>{post.readTime} דקות קריאה</span>
          </span>
        </div>

        <h2 className="font-serif text-2xl sm:text-3xl font-bold text-brand-dark mb-4 leading-snug">
          <Link
            href={`/blog/${post.slug}`}
            className="hover:text-brand-rose-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
          >
            {post.title}
          </Link>
        </h2>

        <p className="text-brand-medium text-sm sm:text-base leading-relaxed mb-6">
          {post.excerpt}
        </p>

        <Link
          href={`/blog/${post.slug}`}
          aria-label={`קרא עוד על: ${post.title}`}
          className="inline-flex items-center gap-1.5 text-brand-rose-text text-sm font-semibold hover:text-brand-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded self-start"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          קראי עוד
        </Link>
      </div>
    </article>
  )
}
