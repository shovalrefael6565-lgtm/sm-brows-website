import type { Metadata } from 'next'
import PageHero from '@/components/ui/PageHero'
import PrivacyContent from '@/components/privacy/PrivacyContent'

export const metadata: Metadata = {
  title: 'מדיניות פרטיות | S.M BROWS',
  description: 'מדיניות הפרטיות של S.M BROWS – כיצד אנו אוספים, משתמשים ושומרים על המידע האישי שלך.',
}

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        tag="מסמך משפטי"
        title="מדיניות"
        titleHighlight="פרטיות"
        description="אנו מחויבים לשמור על פרטיותך בהתאם לחוק הגנת הפרטיות, תשמ״א-1981."
      />
      <PrivacyContent />
    </>
  )
}
