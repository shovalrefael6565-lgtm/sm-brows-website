import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import PrivacyContent from '@/components/privacy/PrivacyContent'

export const metadata: Metadata = {
  title: 'מדיניות פרטיות',
  description: 'מדיניות הפרטיות של S.M BROWS – כיצד אני אוספת, משתמשת ושומרת על המידע האישי שלך.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        tag="מסמך משפטי"
        title="מדיניות"
        titleHighlight="פרטיות"
        description="אני מחויבת לשמור על פרטיותך בהתאם לחוק הגנת הפרטיות, תשמ״א-1981."
      />
      <PrivacyContent />
    </>
  )
}
