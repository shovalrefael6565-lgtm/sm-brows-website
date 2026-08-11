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
  approveRescheduleRequest,
  rejectRescheduleRequest,
  cancelConfirmedAppointmentByAdmin,
} from '@/lib/db/appointments'
import {
  updateAppointmentEventTime,
  deleteAppointmentEvent,
  findConflictingCalendarEvent,
  sanitizeGoogleError,
} from '@/lib/googleCalendar'
import { loadAppointmentPolicy, loadBuildingEntryCode } from '@/lib/db/businessSettings'
import { israelDateStr, fmtIsrael } from '@/lib/israelTime'
import { treatmentLabel, formatDateTimeIL, STATUS_LABELS } from '@/lib/admin/format'
import {
  buildApprovalMessage,
  buildRejectionMessage,
  buildRescheduleApprovedMessage,
  buildRescheduleRejectedMessage,
  buildWhatsAppLinkToCustomer,
  cutoffPolicyLines,
  rescheduleCutoffLines,
} from '@/lib/whatsappTemplates'

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
  /**
   * 🔒 שלב 15C. `true` = **התור אושר בפועל** (status='confirmed', השעה
   * תפוסה, שורת ההיסטוריה נכתבה), והכשל הוא בסנכרון היומן בלבד.
   *
   * ⚠️ ההבחנה הזו אינה קוסמטית. approve_pending_appointment היא טרנזקציה
   * נפרדת שכבר עשתה COMMIT לפני שנגעו ב-Google, ואף אחת משלוש נקודות
   * הכשל שאחריה אינה יכולה לכתוב ל-status — הן קוראות רק ל-
   * fail_calendar_sync. בלי הדגל הזה ה-UI הציג "האישור נכשל" על תור
   * שאושר, וסגר את הודעת האישור ללקוחה. Google הוא integration state,
   * לא business state.
   */
  approved?: true
  /**
   * הודעת האישור המוכנה ללקוחה, כשהתור אושר אך הסנכרון נכשל. הלקוחה
   * צריכה לקבל אישור — התור שלה קיים והשעה שמורה, ללא קשר ליומן.
   */
  whatsappUrl?: string
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

/**
 * קישור WhatsApp עם **הנוסח המאושר** של הודעת האישור.
 *
 * ⚠️ נגזר מ-starts_at ומפרטי הלקוחה — כלומר תקף גם כשסנכרון היומן נכשל,
 * כי מועד התור ב-DB אינו תלוי ב-Google.
 *
 * 🔒 **מחזירה undefined כשלא ניתן לקרוא את המדיניות מ-business_settings.**
 *
 * ⚠️ זו אינה התחמקות — זו הנקודה הקריטית של 15F. הנוסח המאושר מצהיר
 * ללקוחה תוך כמה שעות היא יכולה לבטל או לשנות. מספר שגוי שם הוא הבטחה
 * שהאתר עצמו ישבור: הלקוחה תנסה לבטל, ה-RPC יאכוף את המספר האמיתי, והיא
 * תיתקל בחומה אחרי שהובטח לה אחרת. ברירת מחדל שקטה כאן היא בדיוק דפוס
 * "90 מול 40 דקות" מ-Risks של 15A.
 *
 * העדר קישור פירושו ששובל שולחת הודעה בעצמה — מצב גרוע פחות באופן מובהק
 * מהודעה אוטומטית שמשקרת.
 */
async function approvalWhatsAppUrl(row: AdminAppointmentRow): Promise<string | undefined> {
  const ctx = await loadMessageContext()
  if (!ctx) return undefined

  const { date, time } = formatDateTimeIL(row.starts_at)
  const message = buildApprovalMessage({
    date,
    time,
    treatment: treatmentLabel(row),
    priceLine: approvalPriceLine(row),
    buildingCode: ctx.buildingCode,
    cutoffLines: cutoffPolicyLines(ctx.policy),
  })
  return buildWhatsAppLinkToCustomer(row.customer_phone_e164, message)
}

/**
 * ההגדרות שכל הודעת WhatsApp נשענת עליהן: המדיניות וקוד הכניסה.
 *
 * 🔒 מחזירה null אם **אחד** מהם חסר, וזה מכוון. שתי ההודעות שנבנות ממנה
 * מכילות גם חלון ביטול וגם קוד כניסה, ושתיהן חסרות ערך אם אחד מהם שגוי
 * או חסר: לקוחה עם חלון שגוי תיתקל בחומה, ולקוחה בלי קוד כניסה תעמוד
 * מחוץ לבניין. ראה את הנימוק המלא ב-approvalWhatsAppUrl.
 */
async function loadMessageContext(): Promise<
  { policy: { cancelCutoffHours: number; rescheduleCutoffHours: number }; buildingCode: string } | null
> {
  const [policyResult, buildingCode] = await Promise.all([
    loadAppointmentPolicy(),
    loadBuildingEntryCode(),
  ])

  if (!policyResult.ok) {
    console.error('[approval] מדיניות אינה זמינה — הודעת ה-WhatsApp לא נבנתה')
    return null
  }
  if (!buildingCode) {
    // ⚠️ 0024 יוצרת את המפתח ריק; הערך נקבע ידנית בפרודקשן.
    console.error('[approval] building_entry_code לא הוגדר — הודעת ה-WhatsApp לא נבנתה')
    return null
  }

  return {
    policy: {
      cancelCutoffHours: policyResult.policy.cancelCutoffHours,
      rescheduleCutoffHours: policyResult.policy.rescheduleCutoffHours,
    },
    buildingCode,
  }
}

/**
 * שורת "פרטי הטיפול והמחיר" בנוסח המאושר.
 *
 * ⚠️ מושמטת כשאין מחיר, ולא מוצגת כ-₪0. תור בלי מחיר הוא תור שהמחיר שלו
 * נקבע מול שובל, ו-"₪0" היה נראה כמו טיפול חינם.
 */
function approvalPriceLine(row: AdminAppointmentRow): string | undefined {
  if (!row.price_total) return undefined
  return `₪${row.price_total}`
}

async function buildSyncSuccess(row: AdminAppointmentRow): Promise<SyncSuccess> {
  return { calendarSynced: true, whatsappUrl: await approvalWhatsAppUrl(row) }
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
    if (row.google_event_id) return await buildSyncSuccess(row)
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
        if (fresh.google_event_id) return await buildSyncSuccess(fresh)
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

  return await buildSyncSuccess({ ...row, google_event_id: eventId, calendar_sync_status: 'synced' })
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
 * כמו fromSyncOutcome, אבל למסלול שבו התור **כבר confirmed ב-DB**.
 *
 * ⚠️ לא מאוחדת עם fromSyncOutcome בכוונה: retryCalendarSync משתמשת בזו
 * הראשונה ואסור שתדווח "התור אושר" — היא רצה על תור שאושר מזמן, ולעיתים
 * דווקא על תור **שבוטל** וממתין למחיקת האירוע. הדגל approved שייך למסלול
 * האישור בלבד.
 *
 * ה-message של הסנכרון נשמר כפי שהוא ומשמש כפירוט הטכני; המסגור ("התור
 * אושר, היומן לא סונכרן") נעשה ב-UI, כדי שלא יהיו שני ניסוחים לאותו כשל.
 */
async function fromApprovalOutcome(sync: SyncOutcome, row: AdminAppointmentRow): Promise<ApprovalResult> {
  if (sync.calendarSynced) return { ok: true, whatsappUrl: sync.whatsappUrl }
  return {
    ok: false,
    status: sync.status,
    error: sync.error,
    message: sync.message,
    approved: true,
    whatsappUrl: await approvalWhatsAppUrl(row),
  }
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
      // ⚠️ ה-RPC כבר עשה COMMIT — התור אושר. הכשל הוא בקריאה החוזרת בלבד.
      // row הוא השורה שלפני האישור, אבל starts_at והלקוחה אינם משתנים
      // באישור, ולכן הודעת האישור שנבנית ממנו נכונה.
      return {
        ok: false, status: 500, error: 'server_error',
        message: 'התור אושר אך טעינתו מחדש נכשלה. רעננ/י את העמוד.',
        approved: true,
        whatsappUrl: await approvalWhatsAppUrl(row),
      }
    }
    return await fromApprovalOutcome(await ensureCalendarSynced(fresh), fresh)
  }

  if (row.status === 'confirmed') {
    // לחיצה כפולה: התור כבר אושר בלחיצה הראשונה. כשל סנכרון כאן הוא
    // בדיוק אותו מצב — אושר, היומן לא.
    return fromApprovalOutcome(await ensureCalendarSynced(row), row)
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

  // 🔒 15E — (rescheduled, delete) הוא צירוף חוקי: התור המקורי שהוזז,
  // שהאירוע הישן שלו עדיין ממתין למחיקה. בלעדיו retry ידני על אירוע
  // כזה היה מוחזר כ-not_syncable והאירוע היה נשאר ביומן לנצח.
  // 🔒 15H — (cancelled_by_business, delete) הוא צירוף חוקי: תור שבוטל ע"י
  // שובל והאירוע שלו ממתין למחיקה. חייב להישאר תואם לרשימה ב-
  // claim_calendar_sync (0027) — רשימה שמתירה שם וחוסמת כאן הייתה מייצרת
  // not_syncable על תור שהמסד דווקא מוכן לסנכרן.
  const syncable =
    (row.status === 'confirmed' && row.calendar_sync_operation === 'upsert') ||
    (row.status === 'cancelled_by_customer' && row.calendar_sync_operation === 'delete') ||
    (row.status === 'rescheduled' && row.calendar_sync_operation === 'delete') ||
    (row.status === 'cancelled_by_business' && row.calendar_sync_operation === 'delete')

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

/**
 * 🔒 שלב 15E — אישור בקשת שינוי מועד, כולל סנכרון **שתי** השורות.
 *
 * הסדר כאן אינו שרירותי:
 *
 *   1. ה-RPC (approve_reschedule_request) עושה את ההחלפה ב-DB בטרנזקציה
 *      אחת. אחרי ה-COMMIT הזה **התור העסקי כבר קיים במועד החדש** והשעה
 *      החדשה תפוסה. כל מה שקורה אחריו נוגע ל-Google בלבד.
 *   2. upsert לאירוע החדש.
 *   3. delete לאירוע הישן.
 *
 * ⚠️ **המחיקה אחרונה במכוון.** אילו מחקנו קודם ונפלנו לפני היצירה, היה
 * נוצר חלון שבו אין ליומן שום אירוע לתור הזה — בדיוק המצב ששובל אמורה
 * לא לפגוש. בסדר הזה, כשל אחרי שלב 2 משאיר אירוע כפול (ישן + חדש), וזה
 * מצב **גלוי ובר-תיקון**: שתי השורות מופיעות במסך "דורש טיפול" עם כפתור
 * retry. עודף גלוי עדיף על חוסר שקט.
 *
 * ⚠️ כשל סנכרון **אינו** הופך את האישור לכישלון. ה-DB הוא מקור האמת והוא
 * כבר עודכן — בדיוק העיקרון של הדגל `approved` ב-15C.
 *
 * ⚠️ **אין כאן whatsappUrl.** נוסח הודעת "שינוי המועד אושר" טרם אושר
 * (שייך ל-15F), ואסור להשתמש בנוסח אישור התור הרגיל כתחליף — הוא מדבר
 * על תור חדש ולא על שינוי. ensureCalendarSynced מחזירה whatsappUrl
 * כחלק מהחוזה שלה; הוא **נזרק כאן בכוונה**.
 */
export interface RescheduleApprovalResult {
  ok: true
  /** האם האירוע החדש נוצר/עודכן ביומן */
  newEventSynced: boolean
  /** האם האירוע הישן נמחק מהיומן */
  oldEventRemoved: boolean
  message: string
  /**
   * 🔒 15F — הנוסח המאושר של "שינוי המועד אושר".
   *
   * ⚠️ אופציונלי: אינו נבנה כשהמדיניות או קוד הכניסה אינם זמינים. ראה
   * loadMessageContext.
   */
  whatsappUrl?: string
}

export async function approveRescheduleAndSync(
  requestId: string,
  adminId: string,
): Promise<RescheduleApprovalResult | ApprovalFail> {
  const approved = await approveRescheduleRequest(requestId, adminId)

  if (!approved.ok) {
    const map: Record<string, { status: number; message: string }> = {
      not_a_request: { status: 400, message: 'הפעולה הזו מיועדת לבקשת שינוי מועד בלבד.' },
      not_pending: { status: 409, message: 'הבקשה כבר טופלה או שתוקפה פג.' },
      original_not_confirmed: {
        status: 409,
        message: 'התור המקורי כבר אינו מאושר, ולכן אין מה להעביר. יש לבדוק את התור מול הלקוחה.',
      },
      in_past: {
        status: 422,
        message: 'אחד המועדים כבר עבר, ולכן לא ניתן לאשר את הבקשה. התור המקורי נשאר כפי שהוא.',
      },
      sync_in_progress: { status: 409, message: 'סנכרון היומן מתבצע כרגע. נסי שוב בעוד רגע.' },
      not_found: { status: 404, message: 'הבקשה לא נמצאה.' },
      slot_taken: { status: 409, message: 'המועד החדש נתפס בינתיים. לא ניתן לאשר.' },
      db_error: { status: 500, message: 'האישור נכשל. נסי שוב.' },
    }
    const spec = map[approved.error] ?? map.db_error
    return { ok: false, status: spec.status, error: approved.error, message: spec.message }
  }

  // ⚠️ מכאן ואילך ה-DB כבר עשה COMMIT. שום כשל אינו מחזיר את השעון.

  /*
   * 🔒 טעינה מחדש דרך getAppointmentForAdmin, ולא שימוש בשורות שה-RPC
   * החזיר.
   *
   * ⚠️ הסיבה קונקרטית: ה-RPC מחזיר to_jsonb(appointments_row) — כלומר את
   * שורת הטבלה **בלבד**, בלי ה-join ל-customers. runCalendarUpsert בונה
   * את אירוע היומן מ-customer_full_name ומ-customer_phone_e164, ששניהם
   * מגיעים אך ורק מה-join (ADMIN_APPOINTMENT_COLUMNS). שימוש ישיר בשורת
   * ה-RPC היה יוצר ביומן אירוע עם שם וטלפון undefined — תקלה שקטה שנראית
   * כהצלחה מלאה.
   */
  const [freshRequest, freshOriginal] = await Promise.all([
    getAppointmentForAdmin(approved.requestId),
    getAppointmentForAdmin(approved.originalId),
  ])

  if (!freshRequest || !freshOriginal) {
    // ⚠️ ההחלפה עצמה הצליחה ועשתה COMMIT. רק הקריאה החוזרת נכשלה, ולכן
    // זו אינה שגיאה — שתי השורות ממתינות לסנכרון ויופיעו ב"דורש טיפול".
    console.error('[approval] reschedule approved but reload failed')
    return {
      ok: true,
      newEventSynced: false,
      oldEventRemoved: false,
      message: 'מועד התור עודכן במערכת. סנכרון היומן נמצא בטיפול ומופיע ברשימת הדורשים טיפול.',
    }
  }

  const newSync = await ensureCalendarSynced(freshRequest)
  const oldSync = await ensureCalendarSynced(freshOriginal)

  const newEventSynced = newSync.calendarSynced
  const oldEventRemoved = oldSync.calendarSynced

  let message: string
  if (newEventSynced && oldEventRemoved) {
    message = 'מועד התור עודכן והיומן סונכרן.'
  } else if (!newEventSynced && !oldEventRemoved) {
    message = 'מועד התור עודכן במערכת. סנכרון היומן נמצא בטיפול ומופיע ברשימת הדורשים טיפול.'
  } else if (!newEventSynced) {
    message = 'מועד התור עודכן במערכת. יצירת האירוע החדש ביומן נמצאת בטיפול.'
  } else {
    message = 'מועד התור עודכן והאירוע החדש נוצר. הסרת האירוע הישן מהיומן נמצאת בטיפול.'
  }

  /*
   * 🔒 15F — הנוסח המאושר של אישור שינוי מועד.
   *
   * ⚠️ עד כאן הנתיב הזה **לא החזיר whatsappUrl בכלל**, ושובל נאלצה לכתוב
   * ללקוחה מאפס אחרי כל אישור שינוי.
   *
   * ⚠️ המועד נלקח מ-`freshRequest` — שורת הבקשה, שהיא זו שהפכה ל-confirmed
   * ונושאת את המועד **החדש**. `freshOriginal` נושא את הישן, שכבר שוחרר.
   */
  const whatsappUrl = await rescheduleApprovedWhatsAppUrl(freshRequest)

  return { ok: true, newEventSynced, oldEventRemoved, message, whatsappUrl }
}

async function rescheduleApprovedWhatsAppUrl(
  request: AdminAppointmentRow,
): Promise<string | undefined> {
  const ctx = await loadMessageContext()
  if (!ctx) return undefined

  const { date, time } = formatDateTimeIL(request.starts_at)
  const message = buildRescheduleApprovedMessage({
    treatment: treatmentLabel(request),
    date,
    time,
    buildingCode: ctx.buildingCode,
    // ⚠️ ניסוח cutoff נפרד — שני הנוסחים אושרו בנפרד ואין לאחד אותם.
    cutoffLines: rescheduleCutoffLines(ctx.policy),
  })
  return buildWhatsAppLinkToCustomer(request.customer_phone_e164, message)
}

/** דחיית בקשת שינוי מועד. אין כאן שום אינטראקציה עם Google Calendar —
 *  לבקשה שממתינה לאישור מעולם לא נוצר אירוע. */
export async function rejectReschedule(
  requestId: string,
  adminId: string,
): Promise<{ ok: true; whatsappUrl?: string } | ApprovalFail> {
  const rejected = await rejectRescheduleRequest(requestId, adminId)
  if (!rejected.ok) {
    if (rejected.error === 'not_pending') {
      return { ok: false, status: 409, error: 'already_handled', message: 'הבקשה כבר טופלה או שתוקפה פג.' }
    }
    if (rejected.error === 'not_a_request') {
      return { ok: false, status: 400, error: 'not_a_request', message: 'הפעולה הזו מיועדת לבקשת שינוי מועד בלבד.' }
    }
    return { ok: false, status: 500, error: 'server_error', message: 'הדחייה נכשלה. נסי שוב.' }
  }

  /*
   * 🔒 15F — הנוסח המאושר של דחיית שינוי מועד.
   *
   * ⚠️ **המועד בהודעה הוא של התור המקורי, לא של הבקשה שנדחתה.** זו כל
   * הנקודה: התור הקיים נשאר שמור, והלקוחה צריכה לראות מולו את המועד
   * שאליו עליה להגיע. הצגת המועד שביקשה ושלא אושר הייתה בדיוק ההפך —
   * והיא הייתה מגיעה ביום הלא נכון.
   *
   * ⚠️ ולכן נטען כאן **התור המקורי** ולא שורת הבקשה.
   */
  const original = rejected.originalId
    ? await getAppointmentForAdmin(rejected.originalId)
    : null
  if (!original) {
    // הדחייה עשתה COMMIT. חוסר הודעה אינו הופך אותה לכישלון.
    console.error('[approval] reschedule rejected but original reload failed')
    return { ok: true }
  }

  const { date, time } = formatDateTimeIL(original.starts_at)
  const message = buildRescheduleRejectedMessage({
    treatment: treatmentLabel(original),
    date,
    time,
  })
  return {
    ok: true,
    whatsappUrl: buildWhatsAppLinkToCustomer(original.customer_phone_e164, message),
  }
}

/**
 * 🔒 שלב 15H — ביטול תור מאושר ע"י שובל.
 *
 * ═══ סדר הפעולות, ולמה הוא כזה ═══
 *
 *   1. ה-RPC (0027) עושה הכול ב-DB בטרנזקציה אחת: הסטטוס, שחרור השעה,
 *      סגירת בקשת שינוי מועד פתוחה, ושורת ההיסטוריה.
 *      **אחרי ה-COMMIT הזה הביטול הוא עובדה מוגמרת.**
 *   2. מחיקת האירוע מיומן Google.
 *
 * ⚠️ **כשל בשלב 2 אינו הופך את הביטול לכישלון.** Supabase הוא מקור האמת,
 * השעה כבר משוחררת, והלקוחה כבר קיבלה הודעה. תור שהמחיקה שלו נכשלה מסומן
 * `failed` ומופיע ברשימת "דורש טיפול" עם כפתור retry — בדיוק כמו כל כשל
 * סנכרון אחר במערכת. זה העיקרון של דגל `approved` ב-15C, בכיוון ההפוך.
 *
 * ⚠️ ההתראה ללקוחה **אינה נשלחת מכאן**. הטריגר של 0025 רושם אותה כשנכתבת
 * שורת ההיסטוריה, וה-route מנקז אותה ב-`waitUntil(dispatchNow(...))`.
 * שליחה מכאן הייתה עוקפת את מנגנון ה-idempotency של 15F.
 */
export type AdminCancelServiceResult =
  | { ok: true; outcome: 'applied' | 'already_cancelled'; calendarRemoved: boolean; message: string }
  | { ok: false; status: number; error: string; message: string }

export async function cancelConfirmedByAdmin(
  appointmentId: string,
  adminUserId: string,
): Promise<AdminCancelServiceResult> {
  const res = await cancelConfirmedAppointmentByAdmin(appointmentId, adminUserId)

  if (!res.ok) {
    switch (res.error) {
      case 'not_found':
        return { ok: false, status: 404, error: 'not_found', message: 'התור לא נמצא.' }
      case 'sync_in_progress':
        return {
          ok: false, status: 409, error: 'sync_in_progress',
          message: 'סנכרון היומן מתבצע כרגע על התור הזה. נסי שוב בעוד רגע.',
        }
      case 'not_admin':
        // ⚠️ אמור להיחסם כבר ב-requireAdminApi. הגעה לכאן משמעה שההרשאה
        // הוסרה בין הבדיקה לקריאה — או שמישהו קרא ל-RPC ממקום אחר.
        return { ok: false, status: 403, error: 'forbidden', message: 'אין הרשאה לבצע את הפעולה.' }
      case 'db_error':
        return { ok: false, status: 500, error: 'server_error', message: 'הביטול נכשל. נסי שוב.' }
    }
  }

  const { outcome, appointment } = res.result

  if (outcome === 'not_cancellable') {
    const label = STATUS_LABELS[res.result.currentStatus ?? '']?.label
    return {
      ok: false, status: 409, error: 'not_cancellable',
      message: label
        ? `לא ניתן לבטל תור בסטטוס "${label}".`
        : 'לא ניתן לבטל את התור במצבו הנוכחי.',
    }
  }

  if (outcome === 'in_past') {
    return {
      ok: false, status: 422, error: 'in_past',
      message: 'התור כבר התחיל ולכן לא ניתן לבטלו. יש לסמן אותו כהושלם או כאי-הגעה.',
    }
  }

  /*
   * מ-'already_cancelled' ממשיכים לסנכרון בכוונה: ייתכן שהביטול הצליח
   * בניסיון קודם והמחיקה מהיומן היא זו שנכשלה. זו ההזדמנות לסיים אותה.
   *
   * ⚠️ התנאי אינו "always": ביטול שמקורו במחיקה ידנית ב-Google מגיע לכאן
   * עם 'synced' (0008 מסמנת אותו כך כי האירוע כבר נמחק בפועל), ואין שום
   * סיבה לפנות ל-Google בשבילו שוב.
   */
  const needsCalendarWork =
    appointment.calendar_sync_operation === 'delete' &&
    appointment.calendar_sync_status !== 'synced'

  let calendarRemoved = true
  if (needsCalendarWork) {
    try {
      const sync = await retryCalendarSync(appointmentId)
      calendarRemoved = sync.ok
    } catch (err) {
      console.error('[approval] admin cancel calendar delete threw', err)
      calendarRemoved = false
    }
  }

  return {
    ok: true,
    outcome,
    calendarRemoved,
    message: calendarRemoved
      ? 'התור בוטל והאירוע הוסר מהיומן.'
      : 'התור בוטל. הסרת האירוע מהיומן נכשלה ומופיעה ברשימת התורים שדורשים טיפול.',
  }
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

  /*
   * 🔒 15F — הנוסח המאושר, שמזכיר ללקוחה **על איזה תור** מדובר.
   *
   * ⚠️ המועד נלקח מ-`row` שנטען **לפני** הדחייה, וזה הנכון: הדחייה משנה
   * רק את ה-status, ו-starts_at של הבקשה שנדחתה נשאר בדיוק מה שהלקוחה
   * ביקשה. זה המועד שהיא מזהה.
   *
   * ⚠️ בניגוד להודעות האישור, הנוסח הזה אינו מכיל קוד כניסה ואינו מכיל
   * חלון ביטול — אין תור שאליו להגיע. לכן אין כאן loadMessageContext ואין
   * מסלול שבו ההודעה לא נבנית.
   */
  const { date, time } = formatDateTimeIL(row.starts_at)
  const message = buildRejectionMessage({
    customerName: row.customer_full_name,
    treatment: treatmentLabel(row),
    date,
    time,
  })
  return { ok: true, whatsappUrl: buildWhatsAppLinkToCustomer(row.customer_phone_e164, message) }
}
