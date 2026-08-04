import 'server-only'
import {
  type AdminAppointmentRow,
  approvePendingAppointment,
  rejectPendingAppointment,
  claimCalendarSync,
  completeCalendarSync,
  failCalendarSync,
  getAppointmentForAdmin,
} from '@/lib/db/appointments'
import { createAppointmentEvent, findConflictingCalendarEvent, sanitizeGoogleError } from '@/lib/googleCalendar'
import { israelDateStr, fmtIsrael } from '@/lib/israelTime'
import { treatmentLabel, formatDateTimeIL } from '@/lib/admin/format'
import { buildApprovalMessage, buildRejectionMessage, buildWhatsAppLinkToCustomer } from '@/lib/whatsappTemplates'

/**
 * אורקסטרציה של שלב 6 — אישור/דחייה + סנכרון יומן. מאחדת בקובץ אחד את
 * ה-state machine המלא (ראה ensureCalendarSynced) כדי שגם /approve
 * (אחרי אישור טרי) וגם /sync-calendar (retry על תור confirmed קיים)
 * יעברו בדיוק באותה לוגיקה — אין שני מימושים שיכולים להתבדר.
 *
 * Calendar ו-Supabase אינם transaction אחד: כל הבטיחות מפני אירוע כפול
 * באה מ-lib/googleCalendar.ts (ID דטרמיניסטי + reconciliation) ומ-
 * lib/db/appointments.ts (claim/complete/fail עם lease) — לא מקוד כאן.
 */

export interface ApprovalOk {
  ok: true
  whatsappUrl: string
}

export interface ApprovalFail {
  ok: false
  status: number
  error: string
  message: string
}

export type ApprovalResult = ApprovalOk | ApprovalFail

interface SyncSuccess {
  calendarSynced: true
  whatsappUrl: string
}

interface SyncFailure {
  calendarSynced: false
  status: number
  error: string
  message: string
}

type SyncOutcome = SyncSuccess | SyncFailure

function buildSyncSuccess(row: AdminAppointmentRow): SyncSuccess {
  const { date, time } = formatDateTimeIL(row.starts_at)
  const message = buildApprovalMessage({
    customerName: row.customer_full_name,
    date,
    time,
    treatment: treatmentLabel(row),
  })
  return { calendarSynced: true, whatsappUrl: buildWhatsAppLinkToCustomer(row.customer_phone_e164, message) }
}

/**
 * מבטיחה שתור confirmed מסונכרן ליומן, בכל מצב שהוא נמצא בו כרגע —
 * זו הפונקציה היחידה שנוגעת ב-Google Calendar בכל הזרימה. תמיד idempotent:
 * תור שכבר מסונכרן מחזיר הצלחה מיידית בלי לגעת ב-Google בכלל.
 */
async function ensureCalendarSynced(row: AdminAppointmentRow): Promise<SyncOutcome> {
  if (row.calendar_sync_status === 'synced' && row.google_event_id) {
    return buildSyncSuccess(row)
  }

  const claim = await claimCalendarSync(row.id)
  if (!claim.ok) {
    if (claim.error === 'not_claimable') {
      // מישהי כבר תפסה claim פעיל, או שהמצב השתנה בינתיים — קוראים
      // מחדש כדי לדעת אם זו בעצם הצלחה idempotent (סונכרן הרגע ע"י
      // ניסיון אחר) או שסנכרון עדיין רץ.
      const fresh = await getAppointmentForAdmin(row.id)
      if (fresh?.calendar_sync_status === 'synced' && fresh.google_event_id) {
        return buildSyncSuccess(fresh)
      }
      return {
        calendarSynced: false,
        status: 409,
        error: 'sync_in_progress',
        message: 'סנכרון היומן כבר מתבצע. נסי שוב בעוד רגע.',
      }
    }
    return {
      calendarSynced: false,
      status: 500,
      error: 'server_error',
      message: 'שמירת ניסיון הסנכרון נכשלה. נסי שוב.',
    }
  }

  const startsAt = new Date(row.starts_at)
  const endsAt = new Date(row.ends_at)
  const isoDate = israelDateStr(startsAt)

  const conflict = await findConflictingCalendarEvent(isoDate, startsAt, endsAt, row.id)
  if (conflict) {
    await failCalendarSync(row.id, 'התנגשות עם אירוע קיים ביומן')
    return {
      calendarSynced: false,
      status: 409,
      error: 'calendar_conflict',
      message: 'הזמן הזה כבר תפוס באירוע אחר ביומן. יש לבדוק ולתאם ידנית מול הלקוחה.',
    }
  }

  let eventId: string
  try {
    const created = await createAppointmentEvent({
      appointmentId: row.id,
      customerName: row.customer_full_name,
      phone: row.customer_phone_e164,
      treatment: treatmentLabel(row),
      isoDate,
      startHHMM: fmtIsrael(startsAt),
      durationMin: row.duration_min,
    })
    eventId = created.eventId
  } catch (err) {
    await failCalendarSync(row.id, sanitizeGoogleError(err))
    return {
      calendarSynced: false,
      status: 502,
      error: 'calendar_error',
      message: 'יצירת האירוע ביומן נכשלה. התור נשאר מאושר במערכת — ניתן לנסות לסנכרן שוב.',
    }
  }

  const completed = await completeCalendarSync(row.id, eventId)
  if (!completed) {
    // האירוע נוצר בפועל אך השמירה ב-DB נכשלה. לא מסמנים failed בכוונה —
    // זה היה מאפשר claim חדש מיידי, ו-createAppointmentEvent הבא היה
    // מקבל 409 מ-Google ומ-reconciliation, אבל עדיף שה-lease (2 דק')
    // יפוג באופן טבעי ואז retry ימצא את אותו אירוע ע"י ה-ID הדטרמיניסטי.
    return {
      calendarSynced: false,
      status: 500,
      error: 'server_error',
      message: 'האירוע נוצר ביומן אך שמירת האישור במערכת נכשלה. נסי שוב בעוד כמה דקות.',
    }
  }

  return buildSyncSuccess({ ...row, google_event_id: eventId, calendar_sync_status: 'synced' })
}

function fromSyncOutcome(sync: SyncOutcome): ApprovalResult {
  if (sync.calendarSynced) return { ok: true, whatsappUrl: sync.whatsappUrl }
  return { ok: false, status: sync.status, error: sync.error, message: sync.message }
}

/**
 * אישור בקשת pending, כולל בדיקת התנגשות מוקדמת מול היומן (לפני שהתור
 * הופך ל-confirmed בכלל) וסנכרון יומן. גם קריאה על תור confirmed קיים
 * (לחיצה כפולה על "אישור") מטופלת — נכנסת ישירות ל-ensureCalendarSynced
 * ומחזירה תוצאה idempotent, לא שגיאה.
 */
export async function approveAndSyncAppointment(appointmentId: string, adminId: string): Promise<ApprovalResult> {
  const row = await getAppointmentForAdmin(appointmentId)
  if (!row) {
    return { ok: false, status: 404, error: 'not_found', message: 'הבקשה לא נמצאה.' }
  }

  if (row.status === 'pending') {
    const startsAt = new Date(row.starts_at)
    const endsAt = new Date(row.ends_at)
    const isoDate = israelDateStr(startsAt)

    const conflict = await findConflictingCalendarEvent(isoDate, startsAt, endsAt, row.id)
    if (conflict) {
      return {
        ok: false,
        status: 409,
        error: 'calendar_conflict',
        message: 'הזמן הזה כבר תפוס באירוע אחר ביומן. לא ניתן לאשר — ניתן לדחות את הבקשה.',
      }
    }

    const approved = await approvePendingAppointment(appointmentId, adminId)
    if (!approved.ok) {
      if (approved.error === 'not_pending') {
        return { ok: false, status: 409, error: 'already_handled', message: 'הבקשה כבר טופלה או שתוקפה פג.' }
      }
      return { ok: false, status: 500, error: 'server_error', message: 'האישור נכשל. נסי שוב.' }
    }

    const fresh = await getAppointmentForAdmin(appointmentId)
    if (!fresh) {
      return { ok: false, status: 500, error: 'server_error', message: 'התור אושר אך טעינתו מחדש נכשלה. רעננ/י את העמוד.' }
    }
    return fromSyncOutcome(await ensureCalendarSynced(fresh))
  }

  if (row.status === 'confirmed') {
    return fromSyncOutcome(await ensureCalendarSynced(row))
  }

  return { ok: false, status: 409, error: 'not_pending', message: 'הבקשה כבר אינה ממתינה לאישור.' }
}

/** ניסיון חוזר לסנכרון יומן, לתור confirmed שהסנכרון שלו נכשל/תקוע. */
export async function retryCalendarSync(appointmentId: string): Promise<ApprovalResult> {
  const row = await getAppointmentForAdmin(appointmentId)
  if (!row) {
    return { ok: false, status: 404, error: 'not_found', message: 'התור לא נמצא.' }
  }
  if (row.status !== 'confirmed') {
    return { ok: false, status: 409, error: 'not_confirmed', message: 'ניתן לנסות סנכרון רק לתור מאושר.' }
  }
  return fromSyncOutcome(await ensureCalendarSynced(row))
}

/** דחיית בקשת pending. אין כאן שום אינטראקציה עם Google Calendar. */
export async function rejectAppointment(appointmentId: string, adminId: string): Promise<ApprovalResult> {
  const row = await getAppointmentForAdmin(appointmentId)
  if (!row) {
    return { ok: false, status: 404, error: 'not_found', message: 'הבקשה לא נמצאה.' }
  }

  const rejected = await rejectPendingAppointment(appointmentId, adminId)
  if (!rejected.ok) {
    if (rejected.error === 'not_pending') {
      return { ok: false, status: 409, error: 'already_handled', message: 'הבקשה כבר טופלה או שתוקפה פג.' }
    }
    return { ok: false, status: 500, error: 'server_error', message: 'הדחייה נכשלה. נסי שוב.' }
  }

  const message = buildRejectionMessage({ customerName: row.customer_full_name })
  return { ok: true, whatsappUrl: buildWhatsAppLinkToCustomer(row.customer_phone_e164, message) }
}
