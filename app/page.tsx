import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Hero from '@/components/home/Hero'

// סקשנים קרובים — SSR רגיל (טוב ל-SEO + LCP)
const BeforeAfterSection  = dynamic(() => import('@/components/home/BeforeAfterSection'))
const TestimonialsSection = dynamic(() => import('@/components/home/TestimonialsSection'))
const ServicesPreview     = dynamic(() => import('@/components/home/ServicesPreview'))

// סקשנים רחוקים — ssr:false מקטין את ה-bundle הראשוני
const WhyChooseUs     = dynamic(() => import('@/components/home/WhyChooseUs'),     { ssr: false })
const CourseBanner    = dynamic(() => import('@/components/home/CourseBanner'),    { ssr: false })
const BlogPreview     = dynamic(() => import('@/components/home/BlogPreview'),     { ssr: false })
const BookingSection  = dynamic(() => import('@/components/home/BookingSection'),  { ssr: false })

export const metadata: Metadata = {
  title: 'S.M BROWS | עיצוב גבות מקצועי באשקלון',
  description:
    'סטודיו מקצועי לעיצוב גבות באשקלון. מיקרובליידינג, עיצוב גבות טבעי, הרמת גבות. גבות מושלמות מחכות לך.',
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <BeforeAfterSection />
      <TestimonialsSection />
      <ServicesPreview />
      <WhyChooseUs />
      <CourseBanner />
      <BlogPreview />
      <BookingSection />
    </>
  )
}
