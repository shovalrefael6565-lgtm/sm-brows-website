import type { AppointmentRow } from '@/lib/db/appointments'
import { NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS } from '@/lib/services'

/** תוויות הסטטוסים בעברית — תואמות ל-appointment_status ב-DB (0001_customer_accounts.sql) */
export const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending:                { label: 'ממתינה לאישור',      className: 'bg-brand-gold/15 text-brand-gold-text border-brand-gold/40' },
  confirmed:              { label: 'מאושר',               className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  completed:              { label: 'הושלם',                className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  cancelled_by_customer:  { label: 'בוטל על ידי הלקוחה',   className: 'bg-red-50 text-red-600 border-red-200' },
  cancelled_by_business:  { label: 'בוטל על ידי העסק',     className: 'bg-red-50 text-red-600 border-red-200' },
  rescheduled:            { label: 'הוזז',                 className: 'bg-blue-50 text-blue-700 border-blue-200' },
  no_show:                { label: 'לא הגיעה',             className: 'bg-red-50 text-red-600 border-red-200' },
  expired:                { label: 'תוקף הבקשה פג',        className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
}

export function treatmentLabel(appt: Pick<AppointmentRow, 'service_key' | 'variants'>): string {
  if (appt.service_key === NATURAL_SERVICE) {
    const labels = NATURAL_VARIANTS.filter(v => appt.variants.includes(v.id)).map(v => v.label)
    return labels.length > 0 ? labels.join(' + ') : NATURAL_SERVICE
  }
  if (appt.service_key === LIFTING_SERVICE) return LIFTING_SERVICE
  return appt.service_key
}

/** "כמה זמן נשאר עד תפוגת בקשת pending" — null אם אין תפוגה או שכבר עברה */
export function formatTimeRemaining(pendingExpiresAt: string | null): string | null {
  if (!pendingExpiresAt) return null
  const diffMs = new Date(pendingExpiresAt).getTime() - Date.now()
  if (diffMs <= 0) return null
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000))
  if (hours > 0) return `נותרו ${hours} שע' ו-${minutes} דק' לתפוגה`
  return `נותרו ${minutes} דק' לתפוגה`
}

export function formatDateTimeIL(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return { date, time }
}
