import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Hero from '@/components/home/Hero'
import DeferredSections from '@/components/home/DeferredSections'
import CourseBanner from '@/components/home/CourseBanner'
import { SITE_URL } from '@/lib/utils'

// סקשנים קרובים — SSR רגיל (טוב ל-SEO + LCP)
const BeforeAfterSection  = dynamic(() => import('@/components/home/BeforeAfterSection'))
const TestimonialsSection = dynamic(() => import('@/components/home/TestimonialsSection'))
const MicrobladingTeaser  = dynamic(() => import('@/components/home/MicrobladingTeaser'))
const ServicesPreview     = dynamic(() => import('@/components/home/ServicesPreview'))

export const metadata: Metadata = {
  title: 'S.M BROWS | עיצוב גבות מקצועי באשקלון',
  description:
    'קליניקה מקצועית לעיצוב גבות באשקלון. מיקרובליידינג, עיצוב גבות טבעיות, הרמת גבות. גבות מושלמות מחכות לך.',
  // מפורש ולא בהסתמכות על ירושה מה-layout — הערך זהה, אבל הוא כתוב היכן
  // שקוראים אותו. הפורמט (בלי לוכסן בסוף) הוא זה שהאתר משתמש בו בכל מקום:
  // אותו ערך ב-sitemap.xml וב-og:url.
  alternates: { canonical: '/' },
  openGraph: {
    title: 'S.M BROWS | עיצוב גבות מקצועי באשקלון',
    description:
      'קליניקה מקצועית לעיצוב גבות באשקלון — מיקרובליידינג, עיצוב גבות טבעיות והרמת גבות.',
    url: SITE_URL,
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [
      { url: '/hero.webp', width: 1200, height: 630, alt: 'S.M BROWS — עיצוב גבות מקצועי באשקלון' },
    ],
  },
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <BeforeAfterSection />
      <TestimonialsSection />
      <MicrobladingTeaser />
      <ServicesPreview />
      <CourseBanner />
      <DeferredSections />
    </>
  )
}
