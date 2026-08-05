'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  STATUS_LABELS, formatDateTimeIL, treatmentLabel,
  HISTORY_ACTION_LABELS, HISTORY_ACTOR_LABELS, historySourceLabel,
} from '@/lib/admin/format'

export interface TimelineAppointment {
  id: string
  service_key: string
  variants: string[]
  price_total: number | null
  starts_at: string
  duration_min: number
  status: string
  reschedule_count: number
  original_starts_at: string | null
  created_at: string
  calendar_sync_status: string
  history: {
    id: number
    action: string
    from_status: string | null
    to_status: string | null
    from_starts_at: string | null
    to_starts_at: string | null
    actor: string
    source: string | null
    created_at: string
  }[]
}

const PAGE = 10

/**
 * היסטוריית התורים של הלקוחה.
 *
 * לא נטענת בבת אחת: מוצגים 10 תורים ו-"הצג עוד" מרחיב. הפירוט של כל תור
 * (appointment_history) סגור כברירת מחדל ונפתח בלחיצה.
 *
 * מה **לא** מוצג כאן: google_event_id, sync tokens, ושגיאות סנכרון גולמיות.
 * מצב הסנכרון מוצג כתווית מילולית בלבד. מחיר מוצג כ"מחיר שנקבע" ולעולם
 * לא כסכום ששולם — אין במערכת מקור אמת לתשלום.
 */
export default function CustomerTimeline({ appointments }: { appointments: TimelineAppointment[] }) {
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState<string | null>(null)

  if (appointments.length === 0) {
    return <p className="text-sm text-brand-muted">אין עדיין תורים.</p>
  }

  const visible = appointments.slice(0, shown)

  return (
    <>
      <ul className="space-y-2">
        {visible.map(a => {
          const { date, time } = formatDateTimeIL(a.starts_at)
          const status = STATUS_LABELS[a.status] ?? { label: a.status, className: '' }
          const isOpen = open === a.id

          return (
            <li key={a.id} className="bg-white border border-brand-linen-dark rounded-xl overflow-hidden">
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="font-medium text-brand-dark">
                      {treatmentLabel({ service_key: a.service_key, variants: a.variants })}
                    </div>
                    <div className="text-xs text-brand-muted">
                      {date}, {time} · {a.duration_min} דק׳
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${status.className}`}>
                    {status.label}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-muted">
                  {a.price_total !== null && <span>מחיר שנקבע: {a.price_total} ₪</span>}
                  {a.reschedule_count > 0 && <span>{a.reschedule_count} הזזות עצמיות</span>}
                  {a.original_starts_at && (
                    <span>מועד מקורי: {formatDateTimeIL(a.original_starts_at).date}</span>
                  )}
                  <span>נוצר: {formatDateTimeIL(a.created_at).date}</span>
                  {a.calendar_sync_status !== 'not_applicable' && (
                    <span>יומן: {syncLabel(a.calendar_sync_status)}</span>
                  )}
                </div>

                {a.history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : a.id)}
                    aria-expanded={isOpen}
                    className="inline-flex items-center gap-1 mt-3 text-xs text-brand-dark hover:text-brand-rose"
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                    {isOpen ? 'הסתרת פירוט' : `פירוט (${a.history.length})`}
                  </button>
                )}
              </div>

              {isOpen && (
                <ol className="border-t border-brand-linen-dark bg-brand-cream/30 divide-y divide-brand-linen-dark">
                  {a.history.map(h => {
                    const src = historySourceLabel(h.source)
                    return (
                      <li key={h.id} className="px-4 py-2.5 text-xs">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-medium text-brand-dark">
                            {HISTORY_ACTION_LABELS[h.action] ?? h.action}
                          </span>
                          <span className="text-brand-muted">
                            {/* מקור google_calendar מוצג כמקור פעולה, בלי לייחס
                                אותו למנהל מסוים — היומן אינו מוכיח מי ביצע */}
                            {src ?? HISTORY_ACTOR_LABELS[h.actor] ?? h.actor}
                          </span>
                          <span className="text-brand-muted">
                            {formatDateTimeIL(h.created_at).date}, {formatDateTimeIL(h.created_at).time}
                          </span>
                        </div>
                        {(h.from_status || h.to_status) && (
                          <div className="text-brand-muted mt-0.5">
                            {h.from_status && (STATUS_LABELS[h.from_status]?.label ?? h.from_status)}
                            {h.from_status && h.to_status && ' ← '}
                            {h.to_status && (STATUS_LABELS[h.to_status]?.label ?? h.to_status)}
                          </div>
                        )}
                        {(h.from_starts_at || h.to_starts_at) && (
                          <div className="text-brand-muted mt-0.5">
                            {h.from_starts_at && formatDateTimeIL(h.from_starts_at).date}
                            {h.from_starts_at && h.to_starts_at && ' ← '}
                            {h.to_starts_at && (
                              <>
                                {formatDateTimeIL(h.to_starts_at).date},{' '}
                                {formatDateTimeIL(h.to_starts_at).time}
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}
            </li>
          )
        })}
      </ul>

      {shown < appointments.length && (
        <button
          type="button"
          onClick={() => setShown(s => s + PAGE)}
          className="mt-3 h-10 px-5 rounded-xl border border-brand-linen-dark bg-white
                     text-sm text-brand-dark hover:border-brand-gold transition-colors"
        >
          הצג עוד ({appointments.length - shown})
        </button>
      )}
    </>
  )
}

/** תווית מילולית בלבד — לעולם לא שגיאת סנכרון גולמית */
function syncLabel(status: string): string {
  switch (status) {
    case 'synced':  return 'מסונכרן'
    case 'pending': return 'ממתין'
    case 'syncing': return 'בסנכרון'
    case 'failed':  return 'דורש טיפול'
    default:        return status
  }
}
