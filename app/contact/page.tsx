import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import ContactContent from '@/components/contact/ContactContent'

export const metadata: Metadata = {
  title: 'יצירת קשר | S.M BROWS',
  description: 'צרי קשר עם סטודיו S.M BROWS לקביעת תור, שאלות על טיפולים או כל עניין אחר. אשקלון, הכורמים.',
}

export default function ContactPage() {
  return (
    <>
      <PageHero
        tag="דברי איתנו"
        title="יצירת"
        titleHighlight="קשר"
        description="שמחה לשמוע ממך – לקביעת תור, שאלות על טיפולים, או כל דבר אחר."
      />
      <ContactContent />
    </>
  )
}
