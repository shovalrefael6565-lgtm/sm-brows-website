import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Hero from '@/components/home/Hero'

// כל הסקשנים מתחת ל-Hero נטענים רק כשמגיעים אליהם
const ServicesPreview   = dynamic(() => import('@/components/home/ServicesPreview'))
const BeforeAfterSection = dynamic(() => import('@/components/home/BeforeAfterSection'))
const GalleryPreview    = dynamic(() => import('@/components/home/GalleryPreview'))
const WhyChooseUs       = dynamic(() => import('@/components/home/WhyChooseUs'))
const CourseBanner      = dynamic(() => import('@/components/home/CourseBanner'))
const OnlineCoursePromo = dynamic(() => import('@/components/home/OnlineCoursePromo'))
const BlogPreview       = dynamic(() => import('@/components/home/BlogPreview'))
const BookingSection    = dynamic(() => import('@/components/home/BookingSection'))

export const metadata: Metadata = {
  title: 'S.M BROWS | עיצוב גבות מקצועי באשקלון',
  description:
    'סטודיו מקצועי לעיצוב גבות באשקלון. מיקרובליידינג, עיצוב גבות טבעי, הרמת גבות. גבות מושלמות מחכות לך.',
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <ServicesPreview />
      <BeforeAfterSection />
      <GalleryPreview />
      <WhyChooseUs />
      <CourseBanner />
      <OnlineCoursePromo />
      <BlogPreview />
      <BookingSection />
    </>
  )
}
