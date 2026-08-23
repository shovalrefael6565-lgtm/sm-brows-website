import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import FaqContent from '@/components/faq/FaqContent'
import { FAQ_SECTIONS } from '@/lib/faq'
import { breadcrumbJsonLd } from '@/lib/breadcrumbs'
import { SITE_URL } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'שאלות ותשובות',
  description: 'תשובות לשאלות הנפוצות ביותר על מיקרובליידינג, עיצוב גבות, הרמת גבות וקורסים ב-S.M BROWS.',
  alternates: { canonical: '/faq' },
  openGraph: {
    title: 'שאלות ותשובות | S.M BROWS',
    description: 'תשובות לשאלות הנפוצות על מיקרובליידינג, עיצוב גבות, הרמת גבות וקורסים.',
    url: `${SITE_URL}/faq`,
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [
      { url: '/hero.webp', width: 1200, height: 630, alt: 'S.M BROWS — שאלות ותשובות' },
    ],
  },
}

/*
  FAQPage — נבנה מ-FAQ_SECTIONS, בדיוק אותו מערך ש-FaqContent מרנדר.
  זה מה שהופך את הסימון לחוקי: ה-schema מתאר אחד-לאחד שאלות ותשובות
  שקיימות בפועל ב-HTML של העמוד ונגישות למבקרת.

  ⚠️ תנאי מקדים: מאז תיקון האקורדיון (components/faq/FaqContent.tsx)
  התשובות מרונדרות תמיד. כל עוד זה נכון — הסימון תקף. אם מישהו יחזיר
  את `{isOpen && …}`, הסימון יתאר תוכן שאינו קיים ו-scripts/test-seo-schema.mjs
  ייכשל.

  ⚠️ בלי הבטחות: מאז 2023 Google מציגה FAQ rich results כמעט רק לאתרי
  ממשל ובריאות. הערך כאן הוא הבנת ישות ותוכן ניתן-לציטוט — לא כוכביות
  בתוצאות החיפוש.
*/
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/faq#faq`,
  inLanguage: 'he-IL',
  mainEntity: FAQ_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  ),
}

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([{ name: 'שאלות ותשובות', path: '/faq' }]),
          ),
        }}
      />
      <PageHero

        title="שאלות"
        titleHighlight="ותשובות"
        description="כל מה שרצית לדעת על הטיפולים, ההכנה, ההחלמה ועוד."
      />
      <FaqContent />
    </>
  )
}
