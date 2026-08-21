import Image from 'next/image'
import Link from 'next/link'
import { Clock, ArrowLeft } from 'lucide-react'
import { type BlogPost } from '@/lib/data'

interface Props {
  post: BlogPost
  priority?: boolean
  /**
   * רמת הכותרת של שם המאמר. ברירת המחדל 3 מתאימה לתצוגה בתוך סקשן
   * שכבר יש בו h2 (דף הבית). ב-/blog הכרטיסים יושבים ישירות מתחת ל-h1,
   * ולכן שם מועבר 2 — אחרת נוצר דילוג h1→h3.
   */
  headingLevel?: 2 | 3
}

export default function BlogCard({ post, priority = false, headingLevel = 3 }: Props) {
  const Heading = (`h${headingLevel}` as 'h2' | 'h3')
  return (
    <article
      aria-label={`מאמר: ${post.title}`}
      className="group bg-white rounded-3xl overflow-hidden shadow-soft hover:shadow-soft-lg transition-all duration-300 hover:-translate-y-1 flex flex-col border border-brand-cream-dark/50"
    >
      {/* Image */}
      <Link
        href={`/blog/${post.slug}`}
        aria-label={`קרא את המאמר: ${post.title}`}
        className="relative block aspect-[4/3] overflow-hidden flex-shrink-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-gold focus-visible:ring-inset"
        tabIndex={-1}
      >
        <Image
          src={post.image}
          alt={`תמונה ראשית של המאמר: ${post.title}`}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          priority={priority}
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-brand-dark/20 to-transparent"
          aria-hidden="true"
        />

        {/* Category badge */}
        <span className="absolute top-4 start-4 bg-brand-gold/90 text-brand-dark text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-sm">
          {post.category}
        </span>
      </Link>

      {/* Content */}
      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center gap-4 text-xs text-brand-muted mb-3">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span>{post.readTime} דקות קריאה</span>
          </span>
        </div>

        <Heading className="font-serif text-lg font-bold text-brand-dark mb-2 leading-snug">
          {/* בלי aria-label: טקסט הקישור הוא כותרת המאמר, וזה השם הנכון
              גם לקישור וגם לכותרת. aria-label דרס אותו ב-"קרא את המאמר: …". */}
          <Link
            href={`/blog/${post.slug}`}
            className="hover:text-brand-rose-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
          >
            {post.title}
          </Link>
        </Heading>

        <p className="text-brand-medium text-sm leading-relaxed mb-5 flex-1">{post.excerpt}</p>

        <Link
          href={`/blog/${post.slug}`}
          aria-label={`קרא עוד על: ${post.title}`}
          className="inline-flex items-center gap-1.5 text-brand-rose-text text-sm font-semibold hover:text-brand-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          קראי עוד
        </Link>
      </div>
    </article>
  )
}
