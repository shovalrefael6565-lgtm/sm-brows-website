import Link from 'next/link'
import {
  type ReminderStatus,
  getReminderCounts,
  listReminders,
} from '@/lib/db/reminders'
import {
  REMINDER_KIND_LABELS,
  REMINDER_REASON_LABELS,
  REMINDER_STATUS_LABELS,
  formatDateTimeIL,
  treatmentLabel,
} from '@/lib/admin/format'
import Pagination from '@/components/admin/Pagination'
import RunRemindersButton from '@/components/admin/RunRemindersButton'
import RetryReminderButton from '@/components/admin/RetryReminderButton'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

const STATUS_FILTERS = [
  { value: undefined, label: 'הכול' },
  { value: 'scheduled', label: 'מתוזמנות' },
  { value: 'retrying', label: 'לניסיון חוזר' },
  { value: 'processing', label: 'בעיבוד' },
  { value: 'sent', label: 'נשלחו' },
  { value: 'simulated', label: 'סימולציה' },
  { value: 'failed', label: 'נכשלו' },
  { value: 'delivery_unknown', label: 'לא ודאיות' },
  { value: 'skipped', label: 'לא נשלחו' },
  { value: 'cancelled', label: 'בוטלו' },
  { value: 'superseded', label: 'הוחלפו' },
] as const

/** מצבים שמהם retry ידני אפשרי בכלל. תואם ל-retry_reminder ב-0011. */
const RETRYABLE: ReadonlySet<string> = new Set(['failed', 'delivery_unknown', 'processing'])

export default async function AdminRemindersPage({
  searchParams,
}: {
  searchParams: { page?: string; status?: string }
}) {
  const page = Math.max(1, Number(searchParams.page) || 1)
  const status = STATUS_FILTERS.some(f => f.value === searchParams.status)
    ? (searchParams.status as ReminderStatus | undefined)
    : undefined

  const [{ rows, total }, counts] = await Promise.all([
    listReminders({
      status: status ? [status] : undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getReminderCounts(),
  ])

  const now = Date.now()

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-1">
        <h1 className="font-serif text-2xl font-bold text-brand-dark">תזכורות</h1>
        <RunRemindersButton />
      </div>
      <p className="text-sm text-brand-muted mb-6">
        {total} תזכורות · מתוזמנות {counts.scheduled} · נשלחו {counts.sent} ·
        סימולציה {counts.simulated} · נכשלו {counts.failed} ·
        לא ודאיות {counts.delivery_unknown}
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        {STATUS_FILTERS.map(f => (
          <Link
            key={f.label}
            href={f.value ? `/admin/reminders?status=${f.value}` : '/admin/reminders'}
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
          לא נמצאו תזכורות.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-right text-xs text-brand-muted border-b border-brand-linen-dark">
                <th className="py-2 pl-3 font-medium">לקוחה</th>
                <th className="py-2 pl-3 font-medium">מועד התור</th>
                <th className="py-2 pl-3 font-medium">סוג</th>
                <th className="py-2 pl-3 font-medium">מתוזמנת ל</th>
                <th className="py-2 pl-3 font-medium">סטטוס</th>
                <th className="py-2 pl-3 font-medium">ניסיונות</th>
                <th className="py-2 font-medium">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const appt = formatDateTimeIL(r.appointment_starts_at)
                const sched = formatDateTimeIL(r.scheduled_for)
                const badge = REMINDER_STATUS_LABELS[r.status]
                const reason = r.outcome_reason
                  ? REMINDER_REASON_LABELS[r.outcome_reason] ?? r.outcome_reason
                  : null
                const leaseHeld =
                  r.status === 'processing' &&
                  r.lease_expires_at !== null &&
                  new Date(r.lease_expires_at).getTime() > now

                return (
                  <tr key={r.id} className="border-b border-brand-linen align-top">
                    <td className="py-3 pl-3 text-brand-dark">{r.customer_full_name}</td>
                    <td className="py-3 pl-3 text-brand-muted whitespace-nowrap">
                      {appt.date}
                      <span className="block text-xs">{appt.time}</span>
                      <span className="block text-xs">
                        {treatmentLabel({ service_key: r.service_key, variants: r.variants })}
                      </span>
                    </td>
                    <td className="py-3 pl-3 text-brand-muted whitespace-nowrap">
                      {REMINDER_KIND_LABELS[r.reminder_kind] ?? r.reminder_kind}
                    </td>
                    <td className="py-3 pl-3 text-brand-muted whitespace-nowrap">
                      {sched.date}
                      <span className="block text-xs">{sched.time}</span>
                    </td>
                    <td className="py-3 pl-3">
                      <span
                        className={cn(
                          'inline-block text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap',
                          badge?.className,
                        )}
                      >
                        {badge?.label ?? r.status}
                      </span>
                      {reason && (
                        <span className="block text-xs text-brand-muted mt-1 max-w-[22ch]">
                          {reason}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-brand-muted">
                      {r.attempt_count}
                      {r.last_error_code && (
                        <span className="block text-xs">{r.last_error_code}</span>
                      )}
                    </td>
                    <td className="py-3">
                      {RETRYABLE.has(r.status) && !leaseHeld ? (
                        <RetryReminderButton
                          reminderId={r.id}
                          requiresDuplicateConfirmation={r.status === 'delivery_unknown'}
                        />
                      ) : (
                        <span className="text-xs text-brand-muted">—</span>
                      )}
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
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/admin/reminders"
        searchParams={{ status }}
      />
    </div>
  )
}
