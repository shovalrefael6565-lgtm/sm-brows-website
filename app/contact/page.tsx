import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import ContactContent from '@/components/contact/ContactContent'
import { SITE_URL } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'יצירת קשר',
  description: 'צרי קשר עם קליניקה S.M BROWS לקביעת תור, שאלות על טיפולים או כל עניין אחר. הקליניקה בעיר היין, אשקלון.',
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'יצירת קשר | S.M BROWS',
    description: 'לקביעת תור, שאלות על טיפולים או כל עניין אחר — הקליניקה בעיר היין, אשקלון.',
    url: `${SITE_URL}/contact`,
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [
      { url: '/hero.webp', width: 1200, height: 630, alt: 'S.M BROWS — יצירת קשר' },
    ],
  },
}

export default function ContactPage() {
  return (
    <>
      <PageHero

        title="יצירת"
        titleHighlight="קשר"
        description="שמחה לשמוע ממך – לקביעת תור, שאלות על טיפולים, או כל דבר אחר."
      />
      <ContactContent />
    </>
  )
}
