import { CalendarClock, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import {
  type IssueKind,
  type OpenIssueRow,
  getCalendarSyncState,
  getQueueCounts,
  listOpenSyncIssues,
} from '@/lib/db/calendarSync'
import { listAppointmentsForAdminByIds, type AdminAppointmentRow } from '@/lib/db/appointments'
import { formatDateTimeIL, treatmentLabel } from '@/lib/admin/format'
import { formatPhoneForDisplay } from '@/lib/phone'
import { buildWhatsAppLinkToCustomer } from '@/lib/whatsappTemplates'
import RunCalendarSyncButton from './RunCalendarSyncButton'
import RetryChangeButton from './RetryChangeButton'

/**
 * אזור הסנכרון של Google Calendar במערכת הניהול.
 *
 * ⚠️ מה שאינו מוצג כאן, בכוונה: syncToken, pageToken, מזהה היומן, מזהי
 * אירועים גולמיים ו-payload של Google. אלה סודות תפעוליים שאין להם שום
 * שימוש בתצוגה, ו-getCalendarSyncState אינה בוחרת אותם מלכתחילה.
 *
 * ⚠️ כשהמקור הוא Google Calendar, זה מוצג כ"מקור: Google Calendar" ולא
 * מיוחס לשובל או לרפאל. Google Calendar API אינו מוכיח מי מהמשתמשים גרר
 * את האירוע, ואין לייחס פעולה לאדם בלי ראיה.
 */

const ISSUE_LABELS: Record<IssueKind, { label: string; action: string }> = {
  conflict_slot_taken: {
    label: 'המועד ביומן היה תפוס',
    action: 'האירוע הוחזר למועד שבמערכת. אם המועד החדש נדרש — יש לפנות אותו קודם.',
  },
  new_start_invalid: {
    label: 'מועד לא תקין ביומן',
    action: 'האירוע הוחזר למועד שבמערכת.',
  },
  revert_failed: {
    label: 'החזרת האירוע ליומן נכשלה',
    action: 'המערכת נכונה, היומן לא. יש לתקן את האירוע ביומן ידנית או לנסות שוב.',
  },
  duplicate_event: {
    label: 'שני אירועים לאותו תור',
    action: 'לא בוצעה פעולה אוטומטית. יש למחוק ביומן את האירוע הכפול ידנית.',
  },
  orphaned_event: {
    label: 'אירוע ללא תור במערכת',
    action: 'לא נוצר תור ולא נוצרה לקוחה. יש לבדוק את האירוע ביומן.',
  },
  invalid_appointment_id: {
    label: 'מזהה תור פגום באירוע',
    action: 'לא בוצעה פעולה. נדרשת בדיקה ידנית של האירוע.',
  },
  ambiguous_ownership: {
    label: 'בעלות לא ברורה על האירוע',
    action: 'לא בוצעה שום פעולה — לא במערכת ולא ביומן. נדרשת בדיקה ידנית.',
  },
  restored_after_cancel: {
    label: 'אירוע של תור מבוטל חזר ליומן',
    action: 'התור נשאר מבוטל. האירוע נמחק שוב מהיומן.',
  },
  deleted_terminal_appointment: {
    label: 'נמחק אירוע של תור שכבר הסתיים',
    action: 'הסטטוס במערכת נשמר כפי שהוא. לא נדרשת פעולה.',
  },
  unsupported_recurring_event: {
    label: 'אירוע מערכת הפך לאירוע חוזר',
    action: 'לא בוצע שינוי. יש להחזיר אותו לאירוע חד-פעמי ביומן.',
  },
  unsupported_all_day_event: {
    label: 'אירוע מערכת הפך לאירוע יום שלם',
    action: 'לא בוצע שינוי. יש להחזיר לו שעת התחלה וסיום ביומן.',
  },
  malformed_event: {
    label: 'אירוע ללא שעות תקינות',
    action: 'לא בוצע שינוי. נדרשת בדיקה ידנית.',
  },
  calendar_changed: {
    label: 'היומן המחובר השתנה',
    action: 'מתבצע סנכרון מלא מחדש. לא נדרשת פעולה.',
  },
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const { date, time } = formatDateTimeIL(iso)
  return `${date}, ${time}`
}

export default async function CalendarSyncPanel() {
  const [state, counts, issues] = await Promise.all([
    getCalendarSyncState(),
    getQueueCounts(),
    listOpenSyncIssues(),
  ])

  const apptIds = Array.from(
    new Set(issues.map(i => i.appointment_id).filter((id): id is string => Boolean(id))),
  )
  const appointments = await listAppointmentsForAdminByIds(apptIds)

  const lastStatus = state?.last_run_status ?? null

  return (
    <div>
      <h2 className="font-serif text-xl font-bold text-brand-dark mb-1">סנכרון Google Calendar</h2>
      <p className="text-sm text-brand-muted mb-4">
        שינויים שנעשו ידנית ביומן — הזזה או מחיקה של תור — נקלטים כאן חזרה למערכת.
      </p>

      <div className="bg-white border border-brand-linen-dark rounded-2xl p-4 shadow-soft space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-brand-rose" aria-hidden="true" />
            <span className="text-sm font-bold text-brand-dark">מצב הסנכרון</span>
          </div>
          <StatusBadge status={lastStatus} />
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          <Row label="סנכרון מלא אחרון" value={fmt(state?.last_full_sync_at ?? null)} />
          <Row label="סנכרון מתעדכן אחרון" value={fmt(state?.last_incremental_sync_at ?? null)} />
          <Row label="הריצה האחרונה" value={fmt(state?.last_run_at ?? null)} />
          <Row label="שינויים ממתינים" value={String(counts.pending)} />
          <Row label="שינויים בעיבוד" value={String(counts.processing)} />
          <Row label="שינויים שנכשלו" value={String(counts.failed)} />
        </dl>

        {state?.paused_mid_pagination && (
          <p className="text-xs text-brand-gold-text inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            הסנכרון נעצר באמצע ויימשך מאותה נקודה בריצה הבאה.
          </p>
        )}
        {state?.calendar_changed_count ? (
          <p className="text-xs text-brand-gold-text">
            היומן המחובר השתנה בעבר — בוצע סנכרון מלא מחדש.
          </p>
        ) : null}
        {lastStatus === 'failed' && state?.last_run_error && (
          <p className="text-xs text-red-500">{state.last_run_error}</p>
        )}

        <RunCalendarSyncButton />
      </div>

      {issues.length > 0 && (
        <div className="mt-5">
          <h3 className="font-serif text-lg font-bold text-brand-dark mb-1">
            תקלות סנכרון פתוחות
          </h3>
          <p className="text-sm text-brand-muted mb-3">{issues.length} תקלות דורשות בדיקה</p>
          <div className="space-y-3">
            {issues.map(issue => (
              <IssueCard
                key={issue.id}
                issue={issue}
                appt={issue.appointment_id ? appointments.get(issue.appointment_id) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-brand-linen-dark/60 py-1">
      <dt className="text-brand-muted">{label}</dt>
      <dd className="font-semibold text-brand-dark">{value}</dd>
    </div>
  )
}

function StatusBadge({ status }: { status: 'running' | 'success' | 'failed' | null }) {
  if (status === 'success') {
    return (
      <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-green-50 text-green-700 border-green-200">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
        הריצה האחרונה הצליחה
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-red-50 text-red-600 border-red-200">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
        הריצה האחרונה נכשלה
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border bg-brand-linen text-brand-dark border-brand-linen-dark">
        סנכרון מתבצע
      </span>
    )
  }
  return (
    <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border bg-brand-linen text-brand-muted border-brand-linen-dark">
      טרם רץ
    </span>
  )
}

function IssueCard({ issue, appt }: { issue: OpenIssueRow; appt?: AdminAppointmentRow }) {
  const meta = ISSUE_LABELS[issue.kind]
  const retryable = issue.queue_id != null && issue.queue_status === 'failed'

  // ⚠️ קישור מוכן בלבד. אין פתיחה אוטומטית של WhatsApp ואין שליחת הודעה
  // אוטומטית בשלב הזה — שובל מחליטה אם ומתי לפנות ללקוחה.
  const whatsappUrl = appt
    ? buildWhatsAppLinkToCustomer(appt.customer_phone_e164, '')
    : null

  return (
    <div className="bg-white border border-brand-linen-dark rounded-2xl p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h4 className="font-bold text-brand-dark text-sm">{meta.label}</h4>
          <p className="text-xs text-brand-muted">מקור: Google Calendar</p>
        </div>
        <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border bg-red-50 text-red-600 border-red-200">
          דורש בדיקה
        </span>
      </div>

      {appt && (
        <div className="mb-2">
          <p className="text-sm text-brand-dark font-medium">
            {appt.customer_full_name || 'ללא שם'} · {treatmentLabel(appt)} · {appt.duration_min} דק׳
          </p>
          <p className="text-xs text-brand-muted" dir="ltr">
            {formatPhoneForDisplay(appt.customer_phone_e164)}
          </p>
        </div>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs mb-2">
        <Row label="המועד במערכת" value={fmt(issue.db_starts_at)} />
        <Row label="המועד ביומן" value={fmt(issue.google_starts_at)} />
      </dl>

      {issue.detail && <p className="text-xs text-brand-muted mb-1">{issue.detail}</p>}
      <p className="text-xs text-brand-dark font-medium">{meta.action}</p>

      {issue.queue_attempts != null && issue.queue_attempts > 1 && (
        <p className="text-xs text-brand-muted mt-1">ניסיונות: {issue.queue_attempts}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {retryable && <RetryChangeButton queueId={issue.queue_id!} />}
        {whatsappUrl && (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 text-xs font-semibold text-brand-whatsapp-dark hover:underline"
          >
            פתיחת WhatsApp ללקוחה
          </a>
        )}
      </div>
    </div>
  )
}
