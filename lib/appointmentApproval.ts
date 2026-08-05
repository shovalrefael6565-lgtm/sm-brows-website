import 'server-only'
import {
  type AdminAppointmentRow,
  approvePendingAppointment,
  rejectPendingAppointment,
  claimCalendarSync,
  completeCalendarSync,
  completeCalendarDelete,
  failCalendarSync,
  getAppointmentForAdmin,
} from '@/lib/db/appointments'
import {
  updateAppointmentEventTime,
  deleteAppointmentEvent,
  findConflictingCalendarEvent,
  sanitizeGoogleError,
} from '@/lib/googleCalendar'
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
  /**
   * הודעת האישור המוכנה ללקוחה. קיימת רק כשיש מה להודיע — סנכרון של
   * *מחיקת* אירוע (אחרי ביטול עצמי) מסתיים בהצלחה בלי הודעת וואטסאפ,
   * כי הלקוחה היא זו שביטלה.
   */
  whatsappUrl?: string
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
  whatsappUrl?: string
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
 * מבטיחה שאירוע היומן של התור תואם למצב ב-Supabase, בכל מצב שהוא נמצא בו
 * כרגע — זו הפונקציה היחידה שנוגעת ב-Google Calendar בכל הזרימה. תמיד
 * idempotent: תור שכבר מסונכרן מחזיר הצלחה מיידית בלי לגעת ב-Google בכלל.
 *
 * מה בדיוק לעשות נקבע לפי calendar_sync_operation ולא לפי status של התור:
 *   'upsert' → ליצור או לעדכן את האירוע (confirmed)
 *   'delete' → למחוק את האירוע (cancelled_by_customer)
 * ניחוש לפי status היה שביר — 'cancelled_by_customer' מגיע גם ממסלול
 * ביטול pending, שמעולם לא היה לו אירוע ביומן.
 */
async function ensureCalendarSynced(row: AdminAppointmentRow): Promise<SyncOutcome> {
  const isDelete = row.calendar_sync_operation === 'delete'

  if (row.calendar_sync_status === 'synced') {
    // מחיקה שהושלמה אין לה google_event_id "תקף" להתנות בו — עצם ה-synced
    // הוא ההוכחה. ב-upsert עדיין דורשים מזהה, כמו קודם.
    if (isDelete) return { calendarSynced: true }
    if (row.google_event_id) return buildSyncSuccess(row)
  }

  const claim = await claimCalendarSync(row.id)
  if (!claim.ok) {
    if (claim.error === 'not_claimable') {
      // מישהי כבר תפסה claim פעיל, או שהמצב השתנה בינתיים — קוראים
      // מחדש כדי לדעת אם זו בעצם הצלחה idempotent (סונכרן הרגע ע"י
      // ניסיון אחר) או שסנכרון עדיין רץ.
      const fresh = await getAppointmentForAdmin(row.id)
      if (fresh?.calendar_sync_status === 'synced') {
        if (fresh.calendar_sync_operation === 'delete') return { calendarSynced: true }
        if (fresh.google_event_id) return buildSyncSuccess(fresh)
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

  return isDelete ? runCalendarDelete(row) : runCalendarUpsert(row)
}

/**
 * יצירה או עדכון של אירוע היומן.
 *
 * ⚠️ בדיקת ההתנגשות כאן היא בדיקה *שנייה*, ולא כפילות מיותרת: הבדיקה
 * הראשונה קורית ב-route לפני שה-DB מתעדכן בכלל, ובין השתיים שובל יכולה
 * להכניס ליומן אירוע ידני שחופף למועד החדש. הבדיקה הזו רצה אחרי ה-claim
 * וממש לפני הכתיבה ל-Google, ולכן היא זו שמונעת דריסה של אירוע ידני.
 *
 * אם היא תופסת התנגשות מאוחרת — התור *נשאר* במועד החדש ב-Supabase ואין
 * rollback: המועד החדש כבר תפוס ומוגן ע"י ה-EXCLUDE constraint, והחלטה
 * מה לעשות עם ההתנגשות היא של שובל. הסנכרון מסומן failed והתור מופיע
 * באזור תקלות הסנכרון בניהול.
 */
async function runCalendarUpsert(row: AdminAppointmentRow): Promise<SyncOutcome> {
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
    const result = await updateAppointmentEventTime({
      appointmentId: row.id,
      googleEventId: row.google_event_id,
      customerName: row.customer_full_name,
      phone: row.customer_phone_e164,
      treatment: treatmentLabel(row),
      isoDate,
      startHHMM: fmtIsrael(startsAt),
      durationMin: row.duration_min,
    })
    if (!result.ok) {
      await failCalendarSync(row.id, 'אירוע היומן אינו נושא את חתימת המערכת — לא עודכן')
      return {
        calendarSynced: false,
        status: 409,
        error: 'calendar_not_ours',
        message: 'קיים ביומן אירוע באותו מזהה שאינו של המערכת. לא נגענו בו — יש לבדוק ידנית.',
      }
    }
    eventId = result.eventId
  } catch (err) {
    await failCalendarSync(row.id, sanitizeGoogleError(err))
    return {
      calendarSynced: false,
      status: 502,
      error: 'calendar_error',
      message: 'עדכון האירוע ביומן נכשל. התור נשאר מעודכן במערכת — ניתן לנסות לסנכרן שוב.',
    }
  }

  const completed = await completeCalendarSync(row.id, eventId)
  if (!completed) {
    // האירוע נוצר/עודכן בפועל אך השמירה ב-DB נכשלה. לא מסמנים failed
    // בכוונה — זה היה מאפשר claim חדש מיידי; עדיף שה-lease (2 דק') יפוג
    // באופן טבעי ואז retry ימצא את אותו אירוע ע"י ה-ID הדטרמיניסטי.
    return {
      calendarSynced: false,
      status: 500,
      error: 'server_error',
      message: 'האירוע עודכן ביומן אך שמירת האישור במערכת נכשלה. נסי שוב בעוד כמה דקות.',
    }
  }

  return buildSyncSuccess({ ...row, google_event_id: eventId, calendar_sync_status: 'synced' })
}

/**
 * מחיקת אירוע היומן אחרי ביטול. idempotent לחלוטין: אירוע שכבר אינו קיים
 * (404/410, או שמעולם לא נוצר) הוא בדיוק המצב הרצוי ולכן נחשב הצלחה.
 * אירוע שאינו נושא את חתימת המערכת לא נמחק בשום מצב.
 */
async function runCalendarDelete(row: AdminAppointmentRow): Promise<SyncOutcome> {
  try {
    const result = await deleteAppointmentEvent(row.id, row.google_event_id)
    if (!result.ok) {
      await failCalendarSync(row.id, 'אירוע היומן אינו נושא את חתימת המערכת — לא נמחק')
      return {
        calendarSynced: false,
        status: 409,
        error: 'calendar_not_ours',
        message: 'האירוע ביומן אינו של המערכת ולכן לא נמחק. יש לבדוק ידנית.',
      }
    }
  } catch (err) {
    await failCalendarSync(row.id, sanitizeGoogleError(err))
    return {
      calendarSynced: false,
      status: 502,
      error: 'calendar_error',
      message: 'מחיקת האירוע ביומן נכשלה. התור מבוטל במערכת — ניתן לנסות שוב.',
    }
  }

  const completed = await completeCalendarDelete(row.id)
  if (!completed) {
    return {
      calendarSynced: false,
      status: 500,
      error: 'server_error',
      message: 'האירוע נמחק ביומן אך שמירת המצב במערכת נכשלה. נסי שוב בעוד כמה דקות.',
    }
  }

  return { calendarSynced: true }
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

/**
 * ניסיון חוזר לסנכרון יומן. עובד לשני הכיוונים, לפי calendar_sync_operation:
 * תור confirmed שהאירוע שלו לא נוצר/עודכן, ותור שבוטל ע"י הלקוחה שהאירוע
 * שלו עדיין לא נמחק. הפעולה עצמה נקבעת ב-ensureCalendarSynced — כאן רק
 * נבדק שהצירוף (status, operation) הוא צירוף שיש לו משמעות.
 */
export async function retryCalendarSync(appointmentId: string): Promise<ApprovalResult> {
  const row = await getAppointmentForAdmin(appointmentId)
  if (!row) {
    return { ok: false, status: 404, error: 'not_found', message: 'התור לא נמצא.' }
  }

  const syncable =
    (row.status === 'confirmed' && row.calendar_sync_operation === 'upsert') ||
    (row.status === 'cancelled_by_customer' && row.calendar_sync_operation === 'delete')

  if (!syncable) {
    return {
      ok: false,
      status: 409,
      error: 'not_syncable',
      message: 'לתור הזה אין פעולת סנכרון פתוחה ליומן.',
    }
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
