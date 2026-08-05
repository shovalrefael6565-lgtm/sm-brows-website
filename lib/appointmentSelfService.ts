import 'server-only'
import {
  type CustomerAppointmentRow,
  type SelfServiceError,
  getAppointmentForCustomer,
  rescheduleAppointmentByCustomer,
  cancelConfirmedAppointmentByCustomer,
} from '@/lib/db/appointments'
import { loadAppointmentPolicy } from '@/lib/db/businessSettings'
import { canCancel, canReschedule, type AppointmentPolicy, type PolicyDecision } from '@/lib/appointmentPolicy'
import { findConflictingCalendarEvent } from '@/lib/googleCalendar'
import { retryCalendarSync } from '@/lib/appointmentApproval'
import { israelDateStr, israelWallTimeToUtc } from '@/lib/israelTime'
import { isBookableDate, isValidTimeSlot, isValidLiftingStart, hasLeadTime } from '@/lib/bookingWindow'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'
import { NATURAL_DURATION_MIN } from '@/lib/services'

/**
 * שלב 7 — שינוי מועד וביטול ע"י הלקוחה עצמה.
 *
 * המקבילה של lib/appointmentApproval.ts בצד הלקוחה. כל שכבה כאן קיימת
 * כדי לתת *הודעה טובה* מוקדם ככל האפשר — האכיפה האמיתית נמצאת במקום
 * אחד בלבד: ה-RPC ב-0005, שבודק בעלות, סטטוס ומדיניות באותה טרנזקציה
 * שבה הוא כותב. שום בדיקה בקובץ הזה אינה "ההגנה"; כולן שיפור חוויה.
 *
 * מה כן קריטי כאן:
 *   • הנתונים של התור (משך, מחיר, טיפול, מועד נוכחי) נטענים תמיד מה-DB.
 *     מהדפדפן מתקבלים רק המועד המבוקש והמועד שהוצג על המסך.
 *   • כשל בקריאת המדיניות עוצר הכול (503) — ראה lib/db/businessSettings.ts.
 *   • הסנכרון ליומן עובר דרך retryCalendarSync, כלומר בדיוק אותה
 *     ensureCalendarSynced שמשמשת את המנהלת — אין מסלול סנכרון שני.
 */

export type SelfServiceFailureCode =
  | 'feature_disabled'
  | 'not_found'
  | 'settings_unavailable'
  | 'invalid_slot'
  | 'slot_taken'
  | SelfServiceError

export interface SelfServiceFail {
  ok: false
  status: number
  error: SelfServiceFailureCode
  message: string
  /** האם להציע ללקוחה קישור לוואטסאפ (מדיניות חוסמת / תקלת שירות) */
  offerWhatsApp?: boolean
}

export interface RescheduleOk {
  ok: true
  outcome: 'applied' | 'no_change' | 'already_applied'
  /** false = ה-DB עודכן אך האירוע ביומן עדיין לא — ראה ההודעה למטה */
  calendarSynced: boolean
  message: string
}

export interface CancelOk {
  ok: true
  outcome: 'applied' | 'already_cancelled'
  calendarSynced: boolean
  message: string
}

export type RescheduleResult = RescheduleOk | SelfServiceFail
export type CancelResult = CancelOk | SelfServiceFail

/** הודעות אחידות לכל קודי השגיאה של ה-RPC */
const ERROR_MESSAGES: Record<SelfServiceError, { status: number; message: string; whatsApp: boolean }> = {
  not_found: { status: 404, message: 'התור לא נמצא, כבר טופל, או שאינו שלך.', whatsApp: false },
  not_allowed_status: { status: 409, message: 'לא ניתן לבצע את הפעולה במצב הנוכחי של התור.', whatsApp: true },
  sync_in_progress: { status: 409, message: 'התור מתעדכן ביומן ברגע זה. נסי שוב בעוד רגע.', whatsApp: false },
  in_past: { status: 422, message: 'מועד התור כבר עבר.', whatsApp: true },
  max_reschedules: { status: 422, message: '', whatsApp: true }, // מנוסח דינמית לפי המדיניות
  deposit_locked: { status: 422, message: 'לתור זה שולמה מקדמה, ולכן השינוי מתבצע מול שובל ישירות.', whatsApp: true },
  too_late: { status: 422, message: '', whatsApp: true }, // מנוסח דינמית לפי המדיניות
  slot_taken: { status: 409, message: 'המועד נתפס כרגע. בחרי מועד אחר.', whatsApp: false },
  db_error: { status: 500, message: 'הפעולה נכשלה. נסי שוב.', whatsApp: false },
}

function fail(error: SelfServiceError, fallbackMessage?: string): SelfServiceFail {
  const spec = ERROR_MESSAGES[error]
  return {
    ok: false,
    status: spec.status,
    error,
    message: spec.message || fallbackMessage || 'לא ניתן לבצע את הפעולה.',
    offerWhatsApp: spec.whatsApp,
  }
}

const SETTINGS_UNAVAILABLE: SelfServiceFail = {
  ok: false,
  status: 503,
  error: 'settings_unavailable',
  message: 'לא ניתן לבצע את הפעולה כרגע. נסי שוב בעוד מספר דקות או פני לשובל.',
  offerWhatsApp: true,
}

const FEATURE_DISABLED: SelfServiceFail = {
  ok: false,
  status: 403,
  error: 'feature_disabled',
  message: 'ניהול תורים דרך האתר אינו זמין כרגע. ניתן לפנות לשובל בוואטסאפ.',
  offerWhatsApp: true,
}

const NOT_FOUND: SelfServiceFail = {
  ok: false,
  status: 404,
  error: 'not_found',
  message: 'התור לא נמצא, כבר טופל, או שאינו שלך.',
}

/**
 * תקלה בקריאה מה-DB — לא "לא נמצא". אותה תשובה בדיוק כמו כשל בטעינת
 * המדיניות: הפעולה נחסמת, שום דבר לא נכתב, והלקוחה מקבלת הודעה זמנית
 * עם אפשרות לפנות לשובל.
 */
const SERVICE_UNAVAILABLE: SelfServiceFail = {
  ok: false,
  status: 503,
  error: 'settings_unavailable',
  message: 'לא ניתן לבצע את הפעולה כרגע. נסי שוב בעוד מספר דקות או פני לשובל.',
  offerWhatsApp: true,
}

// ── יכולות התור, לחישוב בשרת לפני רינדור האזור האישי ────────────────────────

export interface AppointmentCapabilities {
  reschedule: PolicyDecision
  cancel: PolicyDecision
  rescheduleCount: number
  maxReschedules: number
}

/**
 * מה הלקוחה רשאית לעשות בתור הזה, לפי המדיניות שנטענה מה-DB.
 *
 * ⚠️ זו תשובה לשאלה "אילו כפתורים להציג", ולא הרשאה. בזמן הפעולה עצמה
 * הכול נבדק מחדש בשרת ובתוך ה-RPC — כפתור שמוצג בטעות לא יאפשר דבר.
 */
export function capabilitiesFor(
  appt: CustomerAppointmentRow,
  policy: AppointmentPolicy,
  now: Date = new Date(),
): AppointmentCapabilities {
  const forPolicy = {
    startsAt: new Date(appt.starts_at),
    status: appt.status,
    rescheduleCount: appt.reschedule_count,
    hasDeposit: appt.has_deposit,
  }
  return {
    reschedule: canReschedule(forPolicy, policy, now),
    cancel: canCancel(forPolicy, policy, now),
    rescheduleCount: appt.reschedule_count,
    maxReschedules: policy.maxReschedules,
  }
}

// ── שינוי מועד ──────────────────────────────────────────────────────────────

/**
 * האם הסלוט המבוקש חוקי *באופן עקרוני* — יום פתוח, שעה ברשת, זמן הכנה.
 * בדיוק אותם כללים של קביעת תור חדש (app/api/appointments/route.ts),
 * ומול משך הטיפול הקיים של התור — לא משך שנשלח מהדפדפן.
 */
function isSlotStructurallyValid(isoDate: string, time: string, durationMin: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !/^\d{2}:\d{2}$/.test(time)) return false

  const [y, mo, d] = isoDate.split('-').map(Number)
  const year = y, month = mo - 1, day = d

  if (!isBookableDate(year, month, day)) return false

  const slotOk = durationMin > NATURAL_DURATION_MIN
    ? isValidLiftingStart(year, month, day, time)
    : isValidTimeSlot(year, month, day, time)
  if (!slotOk) return false

  return hasLeadTime(year, month, day, time)
}

export interface RescheduleParams {
  appointmentId: string
  customerId: string
  isoDate: string
  time: string
  /** המועד שהוצג ללקוחה כשפתחה את הדיאלוג (ISO). לזיהוי התאוששות בלבד. */
  expectedStartsAt: string | null
}

export async function rescheduleForCustomer(params: RescheduleParams): Promise<RescheduleResult> {
  if (!isNewBookingSystemEnabled()) return FEATURE_DISABLED

  const lookup = await getAppointmentForCustomer(params.appointmentId, params.customerId)
  if (!lookup.ok) return lookup.reason === 'db_error' ? SERVICE_UNAVAILABLE : NOT_FOUND
  const appt = lookup.appointment

  const policyResult = await loadAppointmentPolicy()
  if (!policyResult.ok) return SETTINGS_UNAVAILABLE
  const policy = policyResult.policy

  const newStartsAt = israelWallTimeToUtc(params.isoDate, params.time)
  const currentStartsAt = new Date(appt.starts_at)
  const expectedStartsAt = params.expectedStartsAt ? new Date(params.expectedStartsAt) : null

  // בחירת המועד הקיים — שום כתיבה, שום קריאה ל-Google. ה-RPC מבחין בין
  // "לא נבחר מועד חדש" לבין התאוששות מבקשה קודמת שכבר הצליחה, ולכן
  // הבדיקה הזו לא נעשית כאן אלא נשלחת אליו.
  const isSameSlot = newStartsAt.getTime() === currentStartsAt.getTime()

  if (!isSameSlot) {
    // המדיניות נבדקת לפני הכול כדי להחזיר נוסח מדויק. ה-RPC בודק שוב.
    const decision = canReschedule(
      {
        startsAt: currentStartsAt,
        status: appt.status,
        rescheduleCount: appt.reschedule_count,
        hasDeposit: appt.has_deposit,
      },
      policy,
    )
    if (!decision.allowed) {
      return {
        ok: false,
        status: decision.reason === 'not_active' ? 409 : 422,
        error: decision.reason === 'max_reschedules' ? 'max_reschedules'
          : decision.reason === 'deposit_locked' ? 'deposit_locked'
          : decision.reason === 'in_past' ? 'in_past'
          : decision.reason === 'not_active' ? 'not_allowed_status'
          : 'too_late',
        message: decision.message ?? 'לא ניתן לשנות את מועד התור.',
        offerWhatsApp: true,
      }
    }

    if (!isSlotStructurallyValid(params.isoDate, params.time, appt.duration_min)) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_slot',
        message: 'המועד שנבחר אינו זמין לקביעה. יש לבחור מועד אחר.',
      }
    }

    // בדיקת התנגשות ראשונה — לפני שה-DB משתנה בכלל. האירוע של אותו
    // appointment אינו נחשב התנגשות (findConflictingCalendarEvent מדלג
    // עליו לפי extendedProperties). בדיקה שנייה תרוץ שוב מיד לפני
    // הכתיבה ל-Google, כי אירוע ידני יכול להיווצר בין השתיים.
    try {
      const endsAt = new Date(newStartsAt.getTime() + appt.duration_min * 60 * 1000)
      const conflict = await findConflictingCalendarEvent(
        israelDateStr(newStartsAt), newStartsAt, endsAt, appt.id,
      )
      if (conflict) return fail('slot_taken')
    } catch (err) {
      // תקלת Google לא חוסמת — ה-EXCLUDE constraint עדיין מגן, והבדיקה
      // השנייה (אחרי ה-claim) תרוץ בכל מקרה לפני שנוגעים ביומן.
      console.error('[selfService] calendar pre-check failed', err)
    }
  }

  const result = await rescheduleAppointmentByCustomer({
    appointmentId: appt.id,
    customerId: params.customerId,
    newStartsAt,
    expectedStartsAt,
  })

  if (!result.ok) {
    if (result.error === 'max_reschedules') {
      return {
        ok: false, status: 422, error: 'max_reschedules', offerWhatsApp: true,
        message: `ניתן להזיז תור עד ${policy.maxReschedules} פעמים. לשינוי נוסף יש ליצור קשר בוואטסאפ.`,
      }
    }
    if (result.error === 'too_late') {
      const hours = appt.has_deposit ? policy.depositRescheduleCutoffHours : policy.rescheduleCutoffHours
      return {
        ok: false, status: 422, error: 'too_late', offerWhatsApp: true,
        message: `ניתן לשנות מועד עד ${hours} שעות לפני התור. לשינוי במועד קרוב יותר יש ליצור קשר בוואטסאפ.`,
      }
    }
    return fail(result.error)
  }

  if (result.outcome === 'no_change') {
    return { ok: true, outcome: 'no_change', calendarSynced: true, message: 'לא נבחר מועד חדש.' }
  }

  // גם ב-applied וגם ב-already_applied ממשיכים לסנכרון: ב-already_applied
  // ייתכן שהבקשה הקודמת עדכנה את ה-DB אך נפלה לפני היומן, וזה בדיוק
  // מסלול ההתאוששות. הסנכרון עצמו idempotent (claim + lease + ID קבוע).
  const synced = await syncQuietly(appt.id)

  return {
    ok: true,
    outcome: result.outcome,
    calendarSynced: synced,
    message: synced
      ? 'מועד התור עודכן.'
      : 'המועד עודכן במערכת. הסנכרון ליומן נמצא בטיפול.',
  }
}

// ── ביטול תור מאושר ─────────────────────────────────────────────────────────

export async function cancelConfirmedForCustomer(
  appointmentId: string,
  customerId: string,
): Promise<CancelResult> {
  if (!isNewBookingSystemEnabled()) return FEATURE_DISABLED

  const lookup = await getAppointmentForCustomer(appointmentId, customerId)
  if (!lookup.ok) return lookup.reason === 'db_error' ? SERVICE_UNAVAILABLE : NOT_FOUND
  const appt = lookup.appointment

  const policyResult = await loadAppointmentPolicy()
  if (!policyResult.ok) return SETTINGS_UNAVAILABLE
  const policy = policyResult.policy

  if (appt.status === 'confirmed') {
    const decision = canCancel(
      {
        startsAt: new Date(appt.starts_at),
        status: appt.status,
        rescheduleCount: appt.reschedule_count,
        hasDeposit: appt.has_deposit,
      },
      policy,
    )
    if (!decision.allowed) {
      return {
        ok: false,
        status: decision.reason === 'not_active' ? 409 : 422,
        error: decision.reason === 'deposit_locked' ? 'deposit_locked'
          : decision.reason === 'in_past' ? 'in_past'
          : decision.reason === 'not_active' ? 'not_allowed_status'
          : 'too_late',
        message: decision.message ?? 'לא ניתן לבטל את התור.',
        offerWhatsApp: true,
      }
    }
  }

  const result = await cancelConfirmedAppointmentByCustomer(appointmentId, customerId)
  if (!result.ok) {
    if (result.error === 'too_late') {
      return {
        ok: false, status: 422, error: 'too_late', offerWhatsApp: true,
        message: `ניתן לבטל עד ${policy.cancelCutoffHours} שעות לפני התור. לביטול במועד קרוב יותר יש ליצור קשר בוואטסאפ.`,
      }
    }
    return fail(result.error)
  }

  // סנכרון רק כשבאמת יש מה למחוק ביומן. בקשת pending שבוטלה בעבר מגיעה
  // לכאן עם operation='upsert' — מעולם לא נוצר לה אירוע, ואין מה להסיר.
  // גם ביטול שכבר סונכרן (לחיצה חוזרת שהצליחה) לא נוגע ב-Google שוב.
  const appointment = result.appointment
  const needsCalendarWork =
    appointment.calendar_sync_operation === 'delete' &&
    appointment.calendar_sync_status !== 'synced'

  const synced = needsCalendarWork ? await syncQuietly(appointmentId) : true

  return {
    ok: true,
    outcome: result.outcome,
    calendarSynced: synced,
    message: synced
      ? 'התור בוטל.'
      : 'התור בוטל במערכת. הסרת האירוע מהיומן נמצאת בטיפול.',
  }
}

/**
 * מריצה את הסנכרון ליומן ומחזירה רק "הצליח/לא הצליח".
 *
 * הכישלון לעולם אינו הופך את הפעולה כולה לכישלון: ה-DB הוא מקור האמת,
 * הוא כבר עודכן, והסלוט כבר תפוס/משוחרר בהתאם. תור שהסנכרון שלו נכשל
 * מסומן failed ומופיע בניהול עם כפתור retry — ראה
 * listAppointmentsNeedingAdminAction.
 */
async function syncQuietly(appointmentId: string): Promise<boolean> {
  try {
    const sync = await retryCalendarSync(appointmentId)
    return sync.ok
  } catch (err) {
    console.error('[selfService] calendar sync threw', err)
    return false
  }
}
