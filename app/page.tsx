import type { Metadata } from 'next'
import Hero from '@/components/home/Hero'
import ServicesPreview from '@/components/home/ServicesPreview'
import BeforeAfterSection from '@/components/home/BeforeAfterSection'
import GalleryPreview from '@/components/home/GalleryPreview'
import WhyChooseUs from '@/components/home/WhyChooseUs'
import CourseBanner from '@/components/home/CourseBanner'
import BlogPreview from '@/components/home/BlogPreview'
import BookingSection from '@/components/home/BookingSection'
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
      <BlogPreview />
      <BookingSection />
    </>
  )
}
