import { listWaitlistRequests } from '@/lib/db/waitlist'
import { formatDateTimeIL } from '@/lib/admin/format'
import WaitlistStatusSelect from '@/components/admin/WaitlistStatusSelect'
import { NATURAL_VARIANTS, NATURAL_SERVICE } from '@/lib/services'

export const dynamic = 'force-dynamic'

/**
 * בקשות רשימת המתנה.
 *
 * ⚠️ **זו אינה רשימת תורים.** אף שורה כאן אינה חוסמת זמן, אינה מסונכרנת
 * ליומן ואינה מייצרת תזכורות. המסך קורא, ומאפשר לסמן סטטוס — זה הכל.
 *
 * ⚠️ אין כאן CRM חדש: השם והטלפון נשלפים מכרטיס הלקוחה הקיים ואינם
 * שמורים על השורה (ראה 0037).
 */
export default async function WaitlistPage() {
  const rows = await listWaitlistRequests()
  // ⚠️ "פעילה" = open **או** contacted — אותה הגדרה שה-partial unique index
  // ותקרת המכסה ב-0037 סופרים. רק 'closed' משחרר את המועד.
  const active = rows.filter(r => r.status === 'open' || r.status === 'contacted').length

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">רשימת המתנה</h1>
        <p className="text-sm text-brand-muted">
          {rows.length} בקשות · {active} פעילות
        </p>
      </div>

      <p className="text-xs text-brand-muted bg-brand-cream border border-brand-linen-dark rounded-xl p-3 mb-4 leading-relaxed">
        בקשות המתנה אינן תורים: הן אינן תופסות שעה ביומן ואינן שולחות תזכורות.
        כדי לקבוע תור בפועל — יש לפתוח אותו במסך &quot;תור חדש&quot;.
      </p>

      {rows.length === 0 ? (
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
          אין עדיין בקשות לרשימת ההמתנה.
        </div>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {rows.map(r => {
              const when = formatDateTimeIL(r.requested_at)
              return (
                <li key={r.id} className="bg-white border border-brand-linen-dark rounded-xl p-4 shadow-soft">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <span className="text-sm font-bold text-brand-dark">
                      {r.customer_name ?? '—'}
                    </span>
                    <WaitlistStatusSelect id={r.id} status={r.status} />
                  </div>
                  <p className="text-sm text-brand-dark">{when.date} · {when.time}</p>
                  <p className="text-xs text-brand-muted mt-0.5">{treatment(r)}</p>
                  {r.customer_phone && (
                    <a href={`tel:${r.customer_phone}`} dir="ltr"
                       className="inline-block text-xs text-brand-rose-text mt-1.5 underline">
                      {r.customer_phone}
                    </a>
                  )}
                  <p className="text-[11px] text-brand-muted mt-2">
                    נוצרה {stamp(r.created_at)}
                  </p>
                </li>
              )
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto rounded-2xl border border-brand-linen-dark bg-white">
            <table className="w-full text-sm text-right">
              <thead className="bg-brand-cream/50 text-xs text-brand-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">לקוחה</th>
                  <th scope="col" className="px-4 py-3 font-medium">טיפול</th>
                  <th scope="col" className="px-4 py-3 font-medium">תאריך</th>
                  <th scope="col" className="px-4 py-3 font-medium">שעה</th>
                  <th scope="col" className="px-4 py-3 font-medium">נוצרה</th>
                  <th scope="col" className="px-4 py-3 font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-linen-dark">
                {rows.map(r => {
                  const when = formatDateTimeIL(r.requested_at)
                  return (
                    <tr key={r.id} className="hover:bg-brand-cream/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="block font-semibold text-brand-dark">{r.customer_name ?? '—'}</span>
                        {r.customer_phone && (
                          <a href={`tel:${r.customer_phone}`} dir="ltr"
                             className="text-xs text-brand-rose-text underline">{r.customer_phone}</a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-brand-dark">{treatment(r)}</td>
                      <td className="px-4 py-3 text-brand-dark whitespace-nowrap">{when.date}</td>
                      <td className="px-4 py-3 tabular-nums text-brand-dark">{when.time}</td>
                      <td className="px-4 py-3 text-xs text-brand-muted whitespace-nowrap">
                        {stamp(r.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <WaitlistStatusSelect id={r.id} status={r.status} />
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

function stamp(iso: string): string {
  const { date, time } = formatDateTimeIL(iso)
  return `${date} · ${time}`
}

/** אותה תווית שהמסכים האחרים מציגים: הטיפול, ועבור הטבעי גם סוגי המשנה. */
function treatment(r: { service_key: string; variants: string[] }): string {
  if (r.service_key !== NATURAL_SERVICE) return r.service_key
  const labels = NATURAL_VARIANTS.filter(v => r.variants.includes(v.id)).map(v => v.label)
  return labels.length > 0 ? labels.join(' + ') : r.service_key
}
