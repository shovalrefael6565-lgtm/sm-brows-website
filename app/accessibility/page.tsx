import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import AccessibilityContent from '@/components/accessibility/AccessibilityContent'

export const metadata: Metadata = {
  title: 'הצהרת נגישות | S.M BROWS',
  description: 'הצהרת הנגישות של אתר S.M BROWS בהתאם לתקן הישראלי 5568 וחוק שוויון זכויות לאנשים עם מוגבלות.',
}

export default function AccessibilityPage() {
  return (
    <>
      <PageHero
        tag="נגישות"
        title="הצהרת"
        titleHighlight="נגישות"
        description="אתר S.M BROWS מחויב לנגישות דיגיטלית עבור כלל המשתמשים."
      />
      <AccessibilityContent />
    </>
  )
}
