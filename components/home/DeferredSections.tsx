'use client'

import dynamic from 'next/dynamic'

// סקשנים רחוקים — ssr:false מקטין את ה-bundle הראשוני.
// `next/dynamic({ ssr: false })` מותר רק ב-Client Component (Next.js 15+),
// לכן ה-wrapper הזה קיים אך ורק כדי לאכסן את הקריאות האלה מחוץ ל-Server Component של הדף.
const BlogPreview   = dynamic(() => import('@/components/home/BlogPreview'), { ssr: false })
const BookingSection = dynamic(() => import('@/components/home/BookingSection'), { ssr: false })

export default function DeferredSections() {
  return (
    <>
      <BlogPreview />
      <BookingSection />
    </>
  )
}
