import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, Clock } from 'lucide-react'
import { blogPosts } from '@/lib/data'
import { WHATSAPP_URL, SITE_URL } from '@/lib/utils'

interface Props {
  params: { slug: string }
}

export async function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = blogPosts.find((p) => p.slug === params.slug)
  if (!post) return {}
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      images: [{ url: post.image }],
      type: 'article',
      locale: 'he_IL',
      publishedTime: post.date,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt,
      images: [post.image],
    },
  }
}

export default function BlogPostPage({ params }: Props) {
  const post = blogPosts.find((p) => p.slug === params.slug)
  if (!post) notFound()

  const relatedPosts = blogPosts.filter((p) => p.slug !== post.slug).slice(0, 2)
  const html = renderMarkdown(post.content)

  const blogPostingJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    image: `${SITE_URL}${post.image}`,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Organization', name: 'S.M BROWS' },
    publisher: {
      '@type': 'Organization',
      name: 'S.M BROWS',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/blog/${post.slug}`,
    },
    articleSection: post.category,
  }

  return (
    <article lang="he" dir="rtl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingJsonLd) }}
      />
      {/* Hero */}
      <div className="relative h-64 sm:h-80 lg:h-96">
        <Image
          src={post.image}
          alt={`תמונה ראשית של המאמר: ${post.title}`}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-brand-dark/70 via-brand-dark/30 to-transparent"
          aria-hidden="true"
        />
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 pb-8">
            <span className="inline-block bg-brand-gold text-brand-dark text-xs font-bold px-3 py-1.5 rounded-full mb-3">
              {post.category}
            </span>
            <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-snug">
              {post.title}
            </h1>
          </div>
        </div>
      </div>

      {/* Meta bar */}
      <div className="bg-white border-b border-brand-cream-dark">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center flex-wrap gap-4 text-sm text-brand-muted">
          <Link
            href="/blog"
            aria-label="חזרה לכל המאמרים"
            className="inline-flex items-center gap-1.5 text-brand-rose hover:text-brand-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
          >
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
            כל המאמרים
          </Link>
          <span className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" aria-hidden="true" />
            <span>{post.readTime} דקות קריאה</span>
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="bg-brand-cream">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-12 items-start">
            {/* Main */}
            <div>
              <p className="text-brand-dark text-lg leading-relaxed mb-8 font-medium border-r-4 border-brand-gold pr-4">
                {post.excerpt}
              </p>
              <div
                className="prose-custom"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>

            {/* Sidebar */}
            <aside aria-label="מידע נוסף">
              <div className="sticky top-28 space-y-6">
                {/* Booking widget */}
                <div className="bg-white rounded-3xl p-6 shadow-soft border border-brand-cream-dark/50">
                  <p className="font-serif text-lg font-bold text-brand-dark mb-2">
                    רוצה לנסות?
                  </p>
                  <p className="text-brand-medium text-sm mb-4">
                    קבעי תור לטיפול מקצועי ב-S.M BROWS
                  </p>
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="קביעת תור בוואצאפ"
                    className="w-full flex items-center justify-center gap-2 bg-brand-gold text-brand-dark font-semibold py-3 rounded-xl hover:bg-brand-gold-dark transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                  >
                    <WhatsAppIcon className="w-5 h-5" />
                    קבעי תור עכשיו
                  </a>
                </div>

                {/* Related posts */}
                {relatedPosts.length > 0 && (
                  <div className="bg-white rounded-3xl p-5 shadow-soft border border-brand-cream-dark/50">
                    <p className="font-semibold text-brand-dark text-sm mb-4">מאמרים נוספים</p>
                    <ul className="space-y-4" role="list">
                      {relatedPosts.map((related) => (
                        <li key={related.id}>
                          <Link
                            href={`/blog/${related.slug}`}
                            aria-label={`קרא את המאמר: ${related.title}`}
                            className="flex items-start gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded-lg"
                          >
                            <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0">
                              <Image
                                src={related.image}
                                alt={related.title}
                                fill
                                sizes="56px"
                                className="object-cover"
                              />
                            </div>
                            <p className="text-xs text-brand-medium group-hover:text-brand-rose transition-colors leading-snug pt-1">
                              {related.title}
                            </p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </article>
  )
}

function renderMarkdown(md: string): string {
  const lines = md.trim().split('\n')
  const result: string[] = []
  let inList = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('### ')) {
      if (inList) { result.push('</ul>'); inList = false }
      result.push(`<h3>${escape(trimmed.slice(4))}</h3>`)
    } else if (trimmed.startsWith('## ')) {
      if (inList) { result.push('</ul>'); inList = false }
      result.push(`<h2>${escape(trimmed.slice(3))}</h2>`)
    } else if (trimmed.startsWith('- ')) {
      if (!inList) { result.push('<ul>'); inList = true }
      result.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`)
    } else if (trimmed === '') {
      if (inList) { result.push('</ul>'); inList = false }
    } else {
      if (inList) { result.push('</ul>'); inList = false }
      result.push(`<p>${inlineFormat(trimmed)}</p>`)
    }
  }
  if (inList) result.push('</ul>')
  return result.join('\n')
}

function inlineFormat(s: string): string {
  return escape(s).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
