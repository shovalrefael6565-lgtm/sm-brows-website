import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import FaqContent from '@/components/faq/FaqContent'

export const metadata: Metadata = {
  title: 'שאלות ותשובות',
  description: 'תשובות לשאלות הנפוצות ביותר על מיקרובליידינג, עיצוב גבות, הרמת גבות וקורסים ב-S.M BROWS.',
  alternates: { canonical: '/faq' },
}

export default function FaqPage() {
  return (
    <>
      <PageHero
        tag="שאלות נפוצות"
        title="שאלות"
        titleHighlight="ותשובות"
        description="כל מה שרצית לדעת על הטיפולים, ההכנה, ההחלמה ועוד."
      />
      <FaqContent />
    </>
  )
}
