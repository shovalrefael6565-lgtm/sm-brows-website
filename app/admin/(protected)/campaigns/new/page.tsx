import Link from 'next/link'
import { Info } from 'lucide-react'
import { listMarketingCandidates } from '@/lib/db/marketing'
import { marketingProviderName } from '@/lib/marketing/provider'
import { optOutSecretReady } from '@/lib/marketing/tokens'
import BulkSmsComposer from '@/components/admin/BulkSmsComposer'

export const dynamic = 'force-dynamic'

/**
 * שליחת SMS ללקוחות.
 *
 * 🔓 PHASE 1: הרשימה היא כל הלקוחות במאגר, והמנהלת בוחרת ידנית.
 * `marketing_consent` נשמר ומוצג בהמשך, אך אינו מסנן כאן.
 * 🔴 לקוחה שהסירה את עצמה מוצגת ומסומנת, וה-checkbox שלה מושבת.
 */
export default async function NewCampaignPage() {
  const candidates = await listMarketingCandidates()
  const provider = marketingProviderName()
  const secretReady = optOutSecretReady()

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">שליחת SMS ללקוחות</h1>
        <p className="text-sm text-brand-muted">
          {candidates.length} לקוחות במאגר ·{' '}
          <Link href="/admin/campaigns" className="underline underline-offset-2 hover:text-brand-dark">
            הודעות שנשלחו
          </Link>
        </p>
      </div>

      {/*
        ⚠️ שני מצבים שבהם אסור לשלוח, ועדיף לומר אותם מראש מאשר להיכשל
        באמצע קמפיין.
      */}
      {!secretReady && (
        <div role="alert" className="flex items-start gap-2.5 bg-rose-50 border border-rose-200
                                     rounded-xl p-3.5 mb-4 text-sm text-rose-800">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <strong>MARKETING_OPT_OUT_SECRET_V1</strong> אינו מוגדר בסביבה. בלי הסוד אי אפשר
            לייצר קישורי הסרה, ולכן אי אפשר לשלוח דיוור.
          </p>
        </div>
      )}
      {provider === 'disabled' && (
        <div className="flex items-start gap-2.5 bg-brand-cream/60 border border-brand-cream-dark
                        rounded-xl p-3.5 mb-4 text-sm text-brand-dark">
          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            הדיוור כבוי (<code>MARKETING_SMS_PROVIDER</code> אינו <code>sms_019</code>).
            אפשר לבחור, לנסח ולראות את התחזית — אבל שום הודעה לא תצא.
            ⚠️ התזכורות וההודעות על תורים אינן מושפעות מהדגל הזה.
          </p>
        </div>
      )}

      <BulkSmsComposer candidates={candidates} />
    </div>
  )
}
