'use client'

import Link from 'next/link'
import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { blogPosts } from '@/lib/data'
import BlogCard from '@/components/blog/BlogCard'

export default function BlogPreview() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section
      ref={ref}
      id="blog"
      aria-labelledby="blog-preview-heading"
      className="section-padding bg-white"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="flex items-end justify-between mb-10 flex-wrap gap-4"
        >
          <div>
            <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold font-semibold uppercase mb-2">
              המאמרים שלנו
            </p>
            <h2
              id="blog-preview-heading"
              className="font-serif text-3xl sm:text-4xl font-bold text-brand-dark"
            >
              טיפים וידע
              <span className="text-brand-rose"> מהמומחים</span>
            </h2>
          </div>
          <Link
            href="/blog"
            aria-label="לכל המאמרים"
            className="inline-flex items-center gap-1.5 text-brand-rose font-semibold hover:text-brand-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            לכל המאמרים
          </Link>
        </motion.div>

        <ul
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
          role="list"
          aria-label="מאמרים אחרונים"
        >
          {blogPosts.map((post, i) => (
            <motion.li
              key={post.id}
              initial={{ opacity: 0, y: 32 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.12, duration: 0.6 }}
            >
              <BlogCard post={post} priority={i === 0} />
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  )
}
