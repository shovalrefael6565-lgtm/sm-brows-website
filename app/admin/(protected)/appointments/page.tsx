import Link from 'next/link'
import { listAppointmentsAdmin } from '@/lib/db/appointments'
import { formatPhoneForDisplay } from '@/lib/phone'
import { formatDateTimeIL, treatmentLabel, STATUS_LABELS } from '@/lib/admin/format'
import Pagination from '@/components/admin/Pagination'
import { cn } from '@/lib/utils'

const STATUS_FILTERS = [
  { value: undefined, label: 'הכול' },
  { value: 'pending', label: 'ממתין' },
  { value: 'confirmed', label: 'מאושר' },
  { value: 'completed', label: 'הושלם' },
  { value: 'cancelled_by_customer', label: 'בוטל ע"י לקוחה' },
  { value: 'cancelled_by_business', label: 'בוטל ע"י העסק' },
  { value: 'no_show', label: 'לא הגיעה' },
  { value: 'expired', label: 'פג תוקף' },
] as const

/** כל התורים במערכת, לצפייה בלבד, עם סינון סטטוס ודפדוף */
export default async function AdminAppointmentsPage({
  searchParams,
}: {
  searchParams: { page?: string; status?: string }
}) {
  const page = Math.max(1, Number(searchParams.page) || 1)
  const status = STATUS_FILTERS.some(f => f.value === searchParams.status) ? searchParams.status : undefined

  const { rows, total, pageSize } = await listAppointmentsAdmin({ status, page })

  return (
    <div>
      <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">כל התורים</h1>
      <p className="text-sm text-brand-muted mb-6">{total} תורים</p>

      <div className="flex flex-wrap gap-2 mb-6">
        {STATUS_FILTERS.map(f => (
          <Link
            key={f.label}
            href={f.value ? `/admin/appointments?status=${f.value}` : '/admin/appointments'}
            className={cn(
              'text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors',
              status === f.value
                ? 'bg-brand-dark text-white border-brand-dark'
                : 'bg-white text-brand-dark border-brand-linen-dark hover:border-brand-rose',
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
          לא נמצאו תורים.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-right text-xs text-brand-muted border-b border-brand-linen-dark">
                <th className="px-4 sm:px-2 py-2 font-medium">לקוחה</th>
                <th className="px-2 py-2 font-medium">טיפול</th>
                <th className="px-2 py-2 font-medium">תאריך ושעה</th>
                <th className="px-2 py-2 font-medium">סטטוס</th>
                <th className="px-2 py-2 font-medium">מחיר</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(appt => {
                const { date, time } = formatDateTimeIL(appt.starts_at)
                const s = STATUS_LABELS[appt.status] ?? { label: appt.status, className: '' }
                return (
                  <tr key={appt.id} className="border-b border-brand-linen-dark/60">
                    <td className="px-4 sm:px-2 py-3">
                      <div className="font-medium text-brand-dark">{appt.customer_full_name || 'ללא שם'}</div>
                      <div className="text-xs text-brand-muted" dir="ltr">
                        {formatPhoneForDisplay(appt.customer_phone_e164)}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-brand-dark">{treatmentLabel(appt)}</td>
                    <td className="px-2 py-3 text-brand-muted whitespace-nowrap">{date} · {time}</td>
                    <td className="px-2 py-3">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${s.className}`}>
                        {s.label}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-brand-dark font-medium">
                      {appt.price_total != null ? `₪${appt.price_total}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/appointments"
        searchParams={{ status }}
      />
    </div>
  )
}
