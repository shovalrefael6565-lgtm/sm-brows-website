import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import TermsContent from '@/components/terms/TermsContent'

export const metadata: Metadata = {
  title: 'תקנון ותנאי שימוש | S.M BROWS',
  description: 'תקנון ותנאי שימוש של S.M BROWS – מדיניות ביטול, אחריות, הצהרות בריאות ותנאים כלליים.',
}

export default function TermsPage() {
  return (
    <>
      <PageHero
        tag="מסמך משפטי"
        title="תקנון"
        titleHighlight="ותנאי שימוש"
        description="אנא קראי את התנאים הבאים בעיון לפני קבלת שירותים מהסטודיו."
      />
      <TermsContent />
    </>
  )
}
