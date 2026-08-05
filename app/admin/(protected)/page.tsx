import { listAppointmentsNeedingAdminAction, type AdminAppointmentRow } from '@/lib/db/appointments'
import { formatPhoneForDisplay } from '@/lib/phone'
import { formatDateTimeIL, formatTimeRemaining, treatmentLabel, STATUS_LABELS } from '@/lib/admin/format'
import ApproveRejectButtons from '@/components/admin/ApproveRejectButtons'
import RetrySyncButton from '@/components/admin/RetrySyncButton'
import CalendarSyncPanel from '@/components/admin/CalendarSyncPanel'
import { Calendar, Clock, Timer, Send } from 'lucide-react'

/**
 * מסך הבית של הניהול — שני חלקים:
 *   1. בקשות pending: כאן מתבצע אישור/דחייה (שלב 6).
 *   2. תורים שאושרו אך סנכרון היומן שלהם לא הושלם (calendar_sync_status
 *      pending/failed/syncing) — כדי ש"נסה לסנכרן שוב" יהיה נגיש גם אחרי
 *      שהבקשה כבר עזבה pending (ראה lib/appointmentApproval.ts).
 *
 * ללא דפדוף בכוונה: זו רשימת "צריך טיפול", לא ארכיון — ראה כל התורים
 * לתצוגה מלאה עם דפדוף וסינון.
 */
export default async function AdminPendingPage() {
  const rows = await listAppointmentsNeedingAdminAction()
  const pendingRows = rows.filter(r => r.status === 'pending')
  // גם confirmed שממתין ליצירת/עדכון אירוע וגם תור שבוטל וממתין למחיקתו
  const syncIssueRows = rows.filter(r => r.status !== 'pending')

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">בקשות ממתינות</h1>
        <p className="text-sm text-brand-muted mb-6">{pendingRows.length} בקשות ממתינות לאישור</p>

        {pendingRows.length === 0 ? (
          <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
            אין כרגע בקשות ממתינות.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingRows.map(appt => (
              <PendingCard key={appt.id} appt={appt} />
            ))}
          </div>
        )}
      </div>

      {syncIssueRows.length > 0 && (
        <div>
          <h2 className="font-serif text-xl font-bold text-brand-dark mb-1">דורש טיפול: סנכרון יומן</h2>
          <p className="text-sm text-brand-muted mb-4">
            המצב במערכת נכון ותפוס/משוחרר כנדרש, אך היומן עדיין לא עודכן בהתאם.
          </p>
          <div className="space-y-3">
            {syncIssueRows.map(appt => (
              <SyncIssueCard key={appt.id} appt={appt} />
            ))}
          </div>
        </div>
      )}

      {/* שלב 8 — הכיוון ההפוך: שינויים שנעשו ידנית ביומן וחוזרים למערכת */}
      <CalendarSyncPanel />
    </div>
  )
}

function PendingCard({ appt }: { appt: AdminAppointmentRow }) {
  const { date, time } = formatDateTimeIL(appt.starts_at)
  const submitted = formatDateTimeIL(appt.created_at)
  const remaining = formatTimeRemaining(appt.pending_expires_at)
  const status = STATUS_LABELS[appt.status] ?? { label: appt.status, className: '' }

  return (
    <div className="bg-white border border-brand-linen-dark rounded-2xl p-4 shadow-soft">
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
      <p className="text-sm text-brand-dark font-medium mb-2">
        {treatmentLabel(appt)} · {appt.duration_min} דק׳
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted">
        <span className="inline-flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-brand-rose" aria-hidden="true" />
          {date}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-brand-rose" aria-hidden="true" />
          {time}
        </span>
        {appt.price_total != null && <span className="font-semibold text-brand-dark">₪{appt.price_total}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted mt-1.5">
        <span className="inline-flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          נשלחה {submitted.date}, {submitted.time}
        </span>
        {remaining && (
          <span className="inline-flex items-center gap-1.5 text-brand-gold-text">
            <Timer className="w-3.5 h-3.5" aria-hidden="true" />
            {remaining}
          </span>
        )}
      </div>
      <ApproveRejectButtons appointmentId={appt.id} />
    </div>
  )
}

function SyncIssueCard({ appt }: { appt: AdminAppointmentRow }) {
  const { date, time } = formatDateTimeIL(appt.starts_at)
  // מה בדיוק חסר ביומן נקבע לפי calendar_sync_operation, לא לפי הסטטוס —
  // אותו מקור אמת שלפיו פועל ה-retry עצמו (lib/appointmentApproval.ts).
  const isDelete = appt.calendar_sync_operation === 'delete'
  return (
    <div className="bg-white border border-brand-linen-dark rounded-2xl p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="font-bold text-brand-dark text-sm">{appt.customer_full_name || 'ללא שם'}</h3>
          <p className="text-xs text-brand-muted" dir="ltr">
            {formatPhoneForDisplay(appt.customer_phone_e164)}
          </p>
        </div>
        <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border bg-red-50 text-red-600 border-red-200">
          {isDelete ? 'האירוע לא נמחק מהיומן' : 'היומן לא סונכרן'}
        </span>
      </div>
      {isDelete && (
        <p className="text-xs text-brand-muted mb-2">
          התור בוטל על ידי הלקוחה. האירוע שנותר ביומן עדיין חוסם את השעה.
        </p>
      )}
      <p className="text-sm text-brand-dark font-medium mb-2">
        {treatmentLabel(appt)} · {appt.duration_min} דק׳
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted">
        <span className="inline-flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-brand-rose" aria-hidden="true" />
          {date}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-brand-rose" aria-hidden="true" />
          {time}
        </span>
      </div>
      {appt.calendar_sync_error && (
        <p className="text-xs text-red-500 mt-1.5">{appt.calendar_sync_error}</p>
      )}
      <RetrySyncButton appointmentId={appt.id} />
    </div>
  )
}
