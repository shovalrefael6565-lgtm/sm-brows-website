import { listAppointmentsNeedingAdminAction, type AdminAppointmentRow } from '@/lib/db/appointments'
import { formatPhoneForDisplay } from '@/lib/phone'
import {
  formatDateTimeIL, formatTimeRemaining, formatAbsoluteExpiry, treatmentLabel, variantLabels,
  STATUS_LABELS, BOOKING_SOURCE_LABELS,
} from '@/lib/admin/format'
import ApproveRejectButtons from '@/components/admin/ApproveRejectButtons'
import RetrySyncButton from '@/components/admin/RetrySyncButton'
import CalendarSyncPanel from '@/components/admin/CalendarSyncPanel'
import { Calendar, Clock, Timer, Send, MessageSquare, AlertTriangle } from 'lucide-react'

/**
 * מסך הבית של הניהול — שני חלקים:
 *   1. בקשות pending: כאן מתבצע אישור/דחייה (שלב 6).
 *   2. תורים שאושרו אך סנכרון היומן שלהם לא הושלם (calendar_sync_status
 *      pending/failed/syncing) — כדי ש"נסה לסנכרן שוב" יהיה נגיש גם אחרי
 *      שהבקשה כבר עזבה pending (ראה lib/appointmentApproval.ts).
 *
 * ללא דפדוף בכוונה: זו רשימת "צריך טיפול", לא ארכיון — ראה כל התורים
 * לתצוגה מלאה עם דפדוף וסינון.
 *
 * ⚠️ שני החלקים מגיעים מ**שאילתה אחת**, ולכן כשל בטעינה נוגע לשניהם
 * ומוצג פעם אחת. פאנל הסנכרון הנכנס (CalendarSyncPanel) הוא fetch נפרד
 * וממשיך לעבוד גם כשהשאילתה הזו נכשלה — לכן הכשל אינו מפיל את העמוד.
 */
export default async function AdminPendingPage() {
  const result = await listAppointmentsNeedingAdminAction()

  const pendingRows = result.ok ? result.rows.filter(r => r.status === 'pending') : []
  // גם confirmed שממתין ליצירת/עדכון אירוע וגם תור שבוטל וממתין למחיקתו
  const syncIssueRows = result.ok ? result.rows.filter(r => r.status !== 'pending') : []

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">בקשות ממתינות</h1>
        <p className="text-sm text-brand-muted mb-6">
          {result.ok ? `${pendingRows.length} בקשות ממתינות לאישור` : 'לא הצלחנו לטעון את הרשימה'}
        </p>

        {/*
          🔒 כשל טעינה **אינו** "אין בקשות". עד 15C השאילתה החזירה [] בשקט,
          ושובל ראתה "אין כרגע בקשות ממתינות" בזמן שהיו בקשות אמיתיות
          (קרה בפועל ב-15B). מסך שכל תכליתו לומר מה דורש טיפול חייב
          להבדיל בין "אין" לבין "לא ידוע".
        */}
        {!result.ok ? (
          <LoadFailure />
        ) : pendingRows.length === 0 ? (
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

/**
 * מצב שגיאה מפורש. הניסוח אומר בדיוק שתי עובדות ולא יותר: הטעינה נכשלה,
 * וייתכן שיש בקשות שאינך רואה. הוא **אינו** מבטיח שהבעיה תיפתר ברענון —
 * רק מציע את הפעולה הזולה ביותר.
 */
function LoadFailure() {
  return (
    <div
      role="alert"
      className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-3"
    >
      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="text-sm font-bold text-red-700 mb-1">
          לא הצלחנו לטעון את הבקשות שממתינות לטיפול. נסי לרענן.
        </p>
        <p className="text-xs text-red-600">
          ⚠️ ייתכן שיש בקשות ממתינות שאינן מוצגות כאן. אין להסיק מהמסך הזה
          שאין בקשות. אם הבעיה חוזרת גם אחרי רענון — יש לבדוק את המערכת.
        </p>
      </div>
    </div>
  )
}

function PendingCard({ appt }: { appt: AdminAppointmentRow }) {
  const { date, time } = formatDateTimeIL(appt.starts_at)
  const submitted = formatDateTimeIL(appt.created_at)
  const remaining = formatTimeRemaining(appt.pending_expires_at)
  const expiresAt = formatAbsoluteExpiry(appt.pending_expires_at)
  const variants = variantLabels(appt)
  const notes = appt.notes?.trim()
  const status = STATUS_LABELS[appt.status] ?? { label: appt.status, className: '' }
  // null = בקשה שנוצרה לפני 0017. אין תווית, ולא ממציאים אחת.
  const source = appt.booking_source ? BOOKING_SOURCE_LABELS[appt.booking_source] : null

  return (
    <div className="bg-white border border-brand-linen-dark rounded-2xl p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="font-bold text-brand-dark text-sm">{appt.customer_full_name || 'ללא שם'}</h3>
          <p className="text-xs text-brand-muted" dir="ltr">
            {formatPhoneForDisplay(appt.customer_phone_e164)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${status.className}`}>
            {status.label}
          </span>
          {source && (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${source.className}`}>
              {source.label}
            </span>
          )}
        </div>
      </div>
      <p className="text-sm text-brand-dark font-medium mb-2">
        {treatmentLabel(appt)} · {appt.duration_min} דק׳
      </p>
      {/*
        התוספות במפורש ולא רק בתוך treatmentLabel: זו הרשימה שהלקוחה
        סימנה בפועל, וערך שאינו בקטלוג מוצג כמות שהוא ולא נעלם.
        הרמת גבות היא טיפול יחיד ללא תוספות — שם המערך ריק ולא מוצג דבר.
      */}
      {variants.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {variants.map(v => (
            <span
              key={v}
              className="text-[11px] font-medium px-2 py-0.5 rounded-full border bg-brand-cream text-brand-muted border-brand-cream-dark"
            >
              {v}
            </span>
          ))}
        </div>
      )}
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
        {/*
          מועד מוחלט + זמן שנותר. אחרי כלל הלילה של 15B בקשה יכולה להחזיק
          סלוט עד ~66 שעות, ואז "נותרו 66 שע'" לבדו הוא מספר שאי אפשר
          לתכנן לפיו — שובל צריכה לדעת גם *מתי* היא פגה.
        */}
        {expiresAt && (
          <span className="inline-flex items-center gap-1.5 text-brand-gold-text">
            <Timer className="w-3.5 h-3.5" aria-hidden="true" />
            פגה ב-{expiresAt}
            {remaining && <span className="text-brand-muted">({remaining})</span>}
          </span>
        )}
      </div>
      {notes && (
        <div className="mt-2.5 flex items-start gap-1.5 text-xs text-brand-dark bg-brand-cream/60 border border-brand-cream-dark rounded-xl p-2.5">
          <MessageSquare className="w-3.5 h-3.5 text-brand-rose flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="whitespace-pre-wrap break-words">{notes}</p>
        </div>
      )}
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
