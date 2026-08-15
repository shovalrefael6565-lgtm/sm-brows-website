import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Hero from '@/components/home/Hero'
import DeferredSections from '@/components/home/DeferredSections'

// סקשנים קרובים — SSR רגיל (טוב ל-SEO + LCP)
const BeforeAfterSection  = dynamic(() => import('@/components/home/BeforeAfterSection'))
const TestimonialsSection = dynamic(() => import('@/components/home/TestimonialsSection'))
const ServicesPreview     = dynamic(() => import('@/components/home/ServicesPreview'))

const MicrobladingTeaser  = dynamic(() => import('@/components/home/MicrobladingTeaser'))

export const metadata: Metadata = {
  title: 'S.M BROWS | עיצוב גבות מקצועי באשקלון',
  description:
    'קליניקה מקצועית לעיצוב גבות באשקלון. מיקרובליידינג, עיצוב גבות טבעיות, הרמת גבות. גבות מושלמות מחכות לך.',
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <BeforeAfterSection />
      <MicrobladingTeaser />
      <TestimonialsSection />
      <ServicesPreview />
      <DeferredSections />
    </>
  )
}
