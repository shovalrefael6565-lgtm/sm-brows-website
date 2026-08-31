import Link from 'next/link'
import { MessageSquarePlus } from 'lucide-react'
import { listCampaigns, type CampaignRow } from '@/lib/db/marketing'
import { formatDateTimeIL } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft:     { label: 'טיוטה',  className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  sending:   { label: 'נשלחת',  className: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed: { label: 'הסתיים', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  failed:    { label: 'נכשל',   className: 'bg-rose-50 text-rose-700 border-rose-200' },
}

/**
 * "הודעות שנשלחו".
 *
 * ⚠️ אין כאן PII: לא שמות נמענות, לא טלפונים ולא רשימות. רק מתי, מה נשלח,
 * לכמה, וכמה הצליחו. מי שצריכה לדעת על לקוחה מסוימת נכנסת לכרטיס שלה.
 */
export default async function CampaignsPage() {
  const campaigns = await listCampaigns()

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">הודעות שנשלחו</h1>
          <p className="text-sm text-brand-muted">{campaigns.length} קמפיינים אחרונים</p>
        </div>
        <Link
          href="/admin/campaigns/new"
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-brand-dark
                     text-white text-sm font-medium hover:bg-brand-dark/90 transition-colors"
        >
          <MessageSquarePlus className="w-4 h-4" aria-hidden="true" />
          שליחת SMS ללקוחות
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
          עדיין לא נשלחו הודעות ללקוחות.
        </div>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {campaigns.map(c => <li key={c.id}><CampaignCard row={c} /></li>)}
          </ul>

          <div className="hidden md:block overflow-x-auto rounded-2xl border border-brand-linen-dark bg-white">
            <table className="w-full text-sm text-right">
              <thead className="bg-brand-cream/50 text-xs text-brand-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">תאריך</th>
                  <th scope="col" className="px-4 py-3 font-medium">ההודעה</th>
                  <th scope="col" className="px-4 py-3 font-medium">נמענות</th>
                  <th scope="col" className="px-4 py-3 font-medium">נשלחו</th>
                  <th scope="col" className="px-4 py-3 font-medium">נכשלו</th>
                  <th scope="col" className="px-4 py-3 font-medium">דולגו</th>
                  <th scope="col" className="px-4 py-3 font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-linen-dark">
                {campaigns.map(c => {
                  const s = STATUS_LABELS[c.status] ?? STATUS_LABELS.draft
                  return (
                    <tr key={c.id} className="hover:bg-brand-cream/30 transition-colors">
                      <td className="px-4 py-3 text-brand-muted whitespace-nowrap">
                        {fmtStamp(c.created_at)}
                      </td>
                      <td className="px-4 py-3 text-brand-dark max-w-xs truncate">{bodyPreview(c.body)}</td>
                      <td className="px-4 py-3 tabular-nums text-brand-dark">{c.recipient_count}</td>
                      <td className="px-4 py-3 tabular-nums text-emerald-700">{c.sent_count}</td>
                      <td className="px-4 py-3 tabular-nums text-rose-700">{c.failed_count}</td>
                      <td className="px-4 py-3 tabular-nums text-brand-muted">{c.skipped_count}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border
                                          text-[11px] ${s.className}`}>{s.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/** תאריך ושעה בשורה אחת, בשעון ישראל — כמו שאר מסכי האדמין */
function fmtStamp(iso: string): string {
  const { date, time } = formatDateTimeIL(iso)
  return `${date} · ${time}`
}

/** ⚠️ תחילת ההודעה בלבד. הלוג אינו מסך קריאה של תוכן שיווקי מלא. */
function bodyPreview(body: string): string {
  const one = body.replace(/\s+/g, ' ').trim()
  return one.length <= 60 ? one : `${one.slice(0, 60)}…`
}

function CampaignCard({ row }: { row: CampaignRow }) {
  const s = STATUS_LABELS[row.status] ?? STATUS_LABELS.draft
  return (
    <div className="bg-white border border-brand-linen-dark rounded-xl p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <span className="text-xs text-brand-muted">{fmtStamp(row.created_at)}</span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] ${s.className}`}>
          {s.label}
        </span>
      </div>
      <p className="text-sm text-brand-dark mb-2">{bodyPreview(row.body)}</p>
      <p className="text-xs text-brand-muted tabular-nums">
        {row.recipient_count} נמענות · נשלחו {row.sent_count} · נכשלו {row.failed_count} ·
        דולגו {row.skipped_count}
      </p>
    </div>
  )
}
