import type { Metadata } from 'next'
import { isWellFormedOptOutToken } from '@/lib/marketing/tokens'
import UnsubscribeForm from '@/components/marketing/UnsubscribeForm'
import { BUSINESS_IDENTIFIER } from '@/lib/marketing/message'

export const dynamic = 'force-dynamic'

/**
 * עמוד ההסרה מדיוור.
 *
 * 🔒 **אין בעמוד שום PII.** לא שם, לא טלפון ולא מזהה לקוחה — גם לא אחרי
 * ההסרה. העמוד אינו טוען את הלקוחה כלל: ה-token עובר לפעולה, וההסרה
 * מתבצעת בשרת. מי שפותח את הקישור בטעות אינו לומד דבר על אף אחת.
 *
 * ⚠️ noindex: קישור הסרה לא אמור להופיע בחיפוש.
 */
export const metadata: Metadata = {
  title: 'הסרה מדיוור',
  robots: { index: false, follow: false },
}

export default async function UnsubscribePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  const wellFormed = isWellFormedOptOutToken(token)

  // ⚠️ בלי <main> משלו: app/layout.tsx כבר מרנדר אחד, ושני landmarks
  // שוברים את הניווט של קורא מסך (נאכף ב-scripts/test-a11y.mjs).
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md bg-white border border-brand-linen-dark rounded-2xl p-6 shadow-soft">
        <h1 className="font-serif text-2xl font-bold text-brand-dark mb-2">
          הסרה מרשימת הדיוור
        </h1>
        <p className="text-sm text-brand-muted mb-5">
          {BUSINESS_IDENTIFIER}
        </p>

        {wellFormed ? (
          <UnsubscribeForm token={token} />
        ) : (
          <p className="text-sm text-brand-dark">
            הקישור אינו תקין. אפשר להשיב להודעה שקיבלת או ליצור קשר, ונסיר אותך מהדיוור.
          </p>
        )}
      </div>
    </div>
  )
}
