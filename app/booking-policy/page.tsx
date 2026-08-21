import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import BookingPolicyContent from '@/components/booking-policy/BookingPolicyContent'

export const metadata: Metadata = {
  title: 'מדיניות קביעת תורים, שינויים וביטולים',
  description:
    'מדיניות קביעת תורים, שינויים וביטולים של S.M BROWS — תנאי שינוי וביטול, מקדמות, איחורים ואי-הגעה לתור.',
  alternates: { canonical: '/booking-policy' },
}

export default function BookingPolicyPage() {
  return (
    <>
      <PageHero

        title="מדיניות תורים"
        titleHighlight="ושינויים"
        description="כל תור נשמר במיוחד עבורך — כאן תמצאי בדיוק מה קורה במקרה של שינוי, ביטול או איחור."
      />
      <BookingPolicyContent />
    </>
  )
}
