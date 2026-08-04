import { listAppointmentsAdmin } from '@/lib/db/appointments'
import { formatPhoneForDisplay } from '@/lib/phone'
import { formatDateTimeIL, treatmentLabel, STATUS_LABELS } from '@/lib/admin/format'
import Pagination from '@/components/admin/Pagination'
import { Calendar, Clock } from 'lucide-react'

/**
 * מסך הבית של הניהול — בקשות pending בלבד. read-only: אין כאן כפתור
 * אישור/דחייה (שלב הבא). המטרה כרגע היא לראות מה ממתין, לא לפעול עליו.
 */
export default async function AdminPendingPage({
  searchParams,
}: {
  searchParams: { page?: string }
}) {
  const page = Math.max(1, Number(searchParams.page) || 1)
  const { rows, total, pageSize } = await listAppointmentsAdmin({ status: 'pending', page })

  return (
    <div>
      <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">בקשות ממתינות</h1>
      <p className="text-sm text-brand-muted mb-6">{total} בקשות ממתינות לאישור</p>

      {rows.length === 0 ? (
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
          אין כרגע בקשות ממתינות.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(appt => {
            const { date, time } = formatDateTimeIL(appt.starts_at)
            const status = STATUS_LABELS[appt.status] ?? { label: appt.status, className: '' }
            return (
              <div key={appt.id} className="bg-white border border-brand-linen-dark rounded-2xl p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <h3 className="font-bold text-brand-dark text-sm">{appt.customer_full_name || 'ללא שם'}</h3>
                    <p className="text-xs text-brand-muted" dir="ltr">
                      {formatPhoneForDisplay(appt.customer_phone_e164)}
                    </p>
                  </div>
                  <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${status.className}`}>
                    {status.label}
                  </span>
                </div>
                <p className="text-sm text-brand-dark font-medium mb-2">{treatmentLabel(appt)}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-brand-rose" aria-hidden="true" />
                    {date}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-brand-rose" aria-hidden="true" />
                    {time}
                  </span>
                  {appt.price_total != null && (
                    <span className="font-semibold text-brand-dark">₪{appt.price_total}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} basePath="/admin" />
    </div>
  )
}
