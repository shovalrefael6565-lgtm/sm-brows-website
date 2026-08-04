import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PageHero from '@/components/ui/PageHero'
import LoginForm from '@/components/account/LoginForm'
import { getSession } from '@/lib/auth/session'

export const metadata: Metadata = {
  // הסיומת "| S.M BROWS" מגיעה מה-template ב-app/layout.tsx
  title: 'כניסה לאזור האישי',
  description: 'כניסה לאזור האישי לניהול התורים שלך — צפייה, שינוי מועד וביטול.',
  // עמוד אישי — אין סיבה שיופיע במנועי חיפוש
  robots: { index: false, follow: false },
}

export default async function LoginPage() {
  // כבר מחוברת — אין טעם להציג מסך התחברות
  const session = await getSession()
  if (session) redirect('/account')

  return (
    <>
      <PageHero
        tag="אזור אישי"
        title="כניסה"
        titleHighlight="לאזור האישי"
        description="כאן תוכלי לראות את התורים שלך, לשנות מועד או לבטל — בלי להמתין לתשובה."
      />
      <section className="py-14 sm:py-20 px-4 sm:px-6">
        <LoginForm />
      </section>
    </>
  )
}
