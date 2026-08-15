import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { israelWallTimeToUtc, israelDateStr, israelMinutes, BUSINESS_START_MIN, BUSINESS_END_MIN } from '@/lib/israelTime'
import { findConflictingCalendarEvent, logGoogleCalendarError } from '@/lib/googleCalendar'
import { retryCalendarSync } from '@/lib/appointmentApproval'
import { POLICY_VERSION } from '@/lib/bookingPolicy'
import { isFridayOrSaturday } from '@/lib/bookingWindow'
import { lookupIdempotency } from '@/lib/db/manualCustomers'
import { appointmentCreateFingerprint } from '@/lib/adminIdempotency'
import {
  NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS,
  LIFTING_PRICE, LIFTING_DURATION_MIN, NATURAL_DURATION_MIN,
} from '@/lib/services'

/**
 * תור ידני שמנהלת קובעת ממערכת הניהול (שלב 10).
 *
 * ─── מה שונה ממסלול הלקוחה ────────────────────────────────────────────────
 *
 * תור ידני הוא **חריגה ניהולית**, ולכן חלון ההזמנות הציבורי אינו חל עליו:
 * מותר מחוץ ל-7 הימים, מחוץ לשעות הפעילות, ובשישי/שבת. מה שכן נאכף —
 * מועד עתידי, ואי-חפיפה עם תור קיים או עם אירוע ביומן Google.
 *
 * ⚠️ אין override לחפיפה. אירוע ידני ביומן חוסם, ולעולם לא נמחק או מוזז
 * כדי לפנות מקום.
 *
 * ─── מקורות האמת ──────────────────────────────────────────────────────────
 *
 * הדפדפן שולח **רק** service_key, variants, תאריך ושעה. שם הטיפול, המשך,
 * המחיר וגרסת המדיניות נטענים כאן מ-lib/services.ts ומ-lib/bookingPolicy.ts
 * — בדיוק המקורות שמסלול הלקוחה משתמש בהם.
 *
 * ⚠️ התאריך והשעה מפורשים כשעון קיר **ישראלי** דרך israelWallTimeToUtc,
 * ולא דרך new Date('YYYY-MM-DDTHH:mm'). האחרון היה מתפרש לפי אזור הזמן של
 * שרת Vercel (UTC) ומזיז כל תור בשעתיים-שלוש, בהתאם לשעון קיץ.
 */

export type ManualServiceError = 'invalid_service' | 'variants_required' | 'invalid_variants'

export interface ResolvedService {
  serviceKey: string
  variants: string[]
  durationMin: number
  priceTotal: number
}

/**
 * טוענת מחדש את הגדרת השירות ומחשבת משך ומחיר בשרת.
 * שום ערך מהדפדפן לא נכנס לתוצאה מלבד הבחירה עצמה.
 */
export function resolveManualService(
  serviceKey: unknown,
  rawVariants: unknown,
): { ok: true; data: ResolvedService } | { ok: false; error: ManualServiceError } {
  if (serviceKey !== NATURAL_SERVICE && serviceKey !== LIFTING_SERVICE) {
    return { ok: false, error: 'invalid_service' }
  }

  if (serviceKey === LIFTING_SERVICE) {
    // הרמת גבות היא טיפול יחיד ללא תוספות — variants שנשלחו נדחים במפורש
    // ולא מושמטים בשקט, כדי שלא ייווצר פער בין מה שנבחר למה שנשמר.
    const sent = Array.isArray(rawVariants) ? rawVariants : []
    if (sent.length > 0) return { ok: false, error: 'invalid_variants' }
    return {
      ok: true,
      data: {
        serviceKey: LIFTING_SERVICE,
        variants: [],
        durationMin: LIFTING_DURATION_MIN,
        priceTotal: LIFTING_PRICE,
      },
    }
  }

  const requested = Array.isArray(rawVariants)
    ? rawVariants.filter((v): v is string => typeof v === 'string')
    : []
  if (requested.length === 0) return { ok: false, error: 'variants_required' }

  // רק מזהים ידועים; הסינון גם מסלק כפילויות ומקבע את הסדר של הקטלוג
  const matched = NATURAL_VARIANTS.filter(v => requested.includes(v.id))
  if (matched.length !== new Set(requested).size) return { ok: false, error: 'invalid_variants' }

  return {
    ok: true,
    data: {
      serviceKey: NATURAL_SERVICE,
      variants: matched.map(v => v.id),
      durationMin: NATURAL_DURATION_MIN,
      priceTotal: matched.reduce((sum, v) => sum + v.price, 0),
    },
  }
}

/**
 * ממירה תאריך ושעה בשעון ישראל לרגע UTC, ומחזירה גם את הסוף לפי המשך
 * שחושב בשרת. זו הנקודה היחידה בזרימה שממירה זמן.
 */
export function manualSlotInstants(
  isoDate: string,
  time: string,
  durationMin: number,
): { startsAt: Date; endsAt: Date } {
  const startsAt = israelWallTimeToUtc(isoDate, time)
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMin * 60 * 1000) }
}

/** אזהרה לא-חוסמת: המועד חוקי אך חורג ממה שמוצג ללקוחות */
export interface SlotWarnings {
  outsideBusinessHours: boolean
  closedDay: boolean
}

export function manualSlotWarnings(startsAt: Date, endsAt: Date): SlotWarnings {
  const isoDate = israelDateStr(startsAt)
  const [y, m, d] = isoDate.split('-').map(Number)
  const startMin = israelMinutes(startsAt)
  // סוף שנופל אחרי חצות נחשב תמיד חריגה
  const endMin = israelDateStr(endsAt) === isoDate ? israelMinutes(endsAt) : BUSINESS_END_MIN + 1

  return {
    outsideBusinessHours: startMin < BUSINESS_START_MIN || endMin > BUSINESS_END_MIN,
    closedDay: isFridayOrSaturday(y, m - 1, d),
  }
}

export type AvailabilityResult =
  | { available: true }
  | { available: false; reason: 'past' | 'db_conflict' | 'calendar_conflict' | 'calendar_unavailable' }

/**
 * בדיקת זמינות מלאה: Supabase + Google Calendar.
 *
 * ⚠️ אינה משתמשת ב-getBusyRanges/getDbBusyRangesForDate — שתיהן חותכות
 * לשעות הפעילות (09:00–19:00), ולכן היו מחמיצות התנגשות בתור ניהולי
 * שנקבע מחוץ להן. כאן נבדק הטווח המלא של התור עצמו.
 *
 * ⚠️ זו בדיקה מוקדמת בלבד. ההגנה האמיתית מול תורים מקבילים היא ה-EXCLUDE
 * constraint ב-DB, וההגנה מול היומן היא הבדיקה החוזרת בתוך
 * ensureCalendarSynced רגע לפני הכתיבה ל-Google.
 */
export async function checkManualSlotAvailability(
  startsAt: Date,
  endsAt: Date,
  appointmentId: string,
): Promise<AvailabilityResult> {
  if (startsAt.getTime() <= Date.now()) return { available: false, reason: 'past' }

  const db = createSupabaseAdminClient()
  // חפיפה אמיתית: התור הקיים מתחיל לפני שאנחנו נגמרים, ונגמר אחרי
  // שאנחנו מתחילים. אותו תנאי בדיוק שה-EXCLUDE constraint אוכף.
  const { data, error } = await db
    .from('appointments')
    .select('id')
    .in('status', ['pending', 'confirmed'])
    .lt('starts_at', endsAt.toISOString())
    .gt('ends_at', startsAt.toISOString())
    .limit(1)

  if (error) {
    console.error('[adminBooking] db availability check failed', error.message)
    return { available: false, reason: 'db_conflict' }
  }
  if ((data ?? []).length > 0) return { available: false, reason: 'db_conflict' }

  try {
    const conflict = await findConflictingCalendarEvent(
      israelDateStr(startsAt), startsAt, endsAt, appointmentId,
    )
    if (conflict) return { available: false, reason: 'calendar_conflict' }
  } catch (err) {
    // ⚠️ בניגוד למסלול הלקוחה, כאן **חוסמים** כשהיומן אינו זמין. מנהלת
    // קובעת תור מחוץ לשעות הפעילות, שם הסיכוי לאירוע ידני חופף גבוה
    // דווקא, ותור שנקבע על אירוע קיים גורר טלפון ללקוחה.
    logGoogleCalendarError('[adminBooking] calendar availability check failed', err)
    return { available: false, reason: 'calendar_unavailable' }
  }

  return { available: true }
}

export type ManualAppointmentError =
  | 'not_admin' | 'customer_not_found' | 'customer_is_admin'
  | 'start_in_past' | 'invalid_duration' | 'slot_taken' | 'calendar_conflict'
  | 'calendar_unavailable' | 'idempotency_key_reused' | 'missing_request_id'
  | 'bad_fingerprint' | 'integrity_error' | 'unknown'

export interface ManualAppointmentOk {
  appointmentId: string
  /** false = התור נוצר אך הסנכרון ליומן נכשל (partial success) */
  calendarSynced: boolean
  /** קיים רק כשהסנכרון נכשל — הודעה מסוננת להצגה למנהלת */
  calendarMessage?: string
  replayed: boolean
}

function mapError(message: string): ManualAppointmentError {
  const m = message.toUpperCase()
  if (m.includes('NOT_ADMIN'))               return 'not_admin'
  if (m.includes('CUSTOMER_IS_ADMIN'))       return 'customer_is_admin'
  if (m.includes('CUSTOMER_NOT_FOUND'))      return 'customer_not_found'
  if (m.includes('START_IN_PAST'))           return 'start_in_past'
  if (m.includes('INVALID_DURATION'))        return 'invalid_duration'
  if (m.includes('IDEMPOTENCY_KEY_REUSED'))  return 'idempotency_key_reused'
  if (m.includes('MISSING_REQUEST_ID'))      return 'missing_request_id'
  if (m.includes('BAD_FINGERPRINT'))         return 'bad_fingerprint'
  // 23P01 = exclusion_violation — ה-EXCLUDE constraint תפס חפיפה
  if (m.includes('23P01') || m.includes('APPOINTMENTS_NO_OVERLAP')) return 'slot_taken'
  return 'unknown'
}

export interface CreateManualAppointmentInput {
  customerId: string
  serviceKey: string
  variants: string[]
  durationMin: number
  priceTotal: number
  startsAt: Date
  endsAt: Date
  adminUserId: string
  clientRequestId: string
}

/**
 * יצירת תור ידני מקצה לקצה.
 *
 * ─── סדר הפעולות, ולמה idempotency קודמת ל-Google ────────────────────────
 *
 * אילו בדיקת הזמינות הייתה רצה ראשונה, retry אחרי הצלחה מלאה היה נכשל:
 * הבקשה הראשונה כבר יצרה אירוע ביומן, הבדיקה הייתה רואה אותו כתפוס,
 * וה-retry היה מחזיר "המועד נתפס" במקום את התור שכבר נוצר בהצלחה.
 *
 * לכן: מזהים קודם *האם זו בקשה חדשה בכלל*, ורק לבקשה חדשה בודקים זמינות.
 * retry של בקשה קיימת ממשיך ישר לסנכרון היומן של אותו תור.
 *
 * ─── Calendar ו-Supabase אינם טרנזקציה אחת ────────────────────────────────
 *
 * DB נכשל       → אין תור, אין היסטוריה, אין אירוע.
 * DB ✓ Google ✓ → confirmed + synced.
 * DB ✓ Google ✗ → התור **נשאר confirmed**, הסנכרון מסומן failed, ואין
 *                 מחיקה ואין היסטוריה נוספת. המנהלת מקבלת הודעת partial
 *                 success וכפתור retry דרך המנגנון הקיים.
 */
export async function createManualAppointment(
  input: CreateManualAppointmentInput,
): Promise<{ ok: true; data: ManualAppointmentOk } | { ok: false; error: ManualAppointmentError }> {
  const db = createSupabaseAdminClient()

  const fingerprint = appointmentCreateFingerprint({
    actorAdminId: input.adminUserId,
    customerId: input.customerId,
    serviceKey: input.serviceKey,
    variants: input.variants,
    startsAt: input.startsAt,
    durationMin: input.durationMin,
    priceTotal: input.priceTotal,
    policyVersion: POLICY_VERSION,
  })

  // ── 1. האם זו בקשה שכבר טופלה? ──────────────────────────────────────────
  const prior = await lookupIdempotency('appointment_create', input.adminUserId, input.clientRequestId)
  if (!prior.ok) return { ok: false, error: 'unknown' }

  if (prior.record) {
    if (prior.record.payload_fingerprint !== fingerprint) {
      return { ok: false, error: 'idempotency_key_reused' }
    }
    if (!prior.record.target_id) {
      console.error('[adminBooking] idempotency row without target', input.clientRequestId)
      return { ok: false, error: 'integrity_error' }
    }
    // retry: אותו תור, בלי INSERT ובלי בדיקת זמינות. הסנכרון ממשיך מהמקום
    // שבו נעצר — אותו appointment ואותו מזהה אירוע דטרמיניסטי.
    return finishWithCalendar(prior.record.target_id, true)

  }

  // ── 2. בקשה חדשה: בדיקת זמינות לפני כל כתיבה ───────────────────────────
  // ה-UUID שנשלח כאן הוא מזהה זמני לצורך "האירוע הזה הוא אנחנו" — לתור
  // עוד אין מזהה, ולכן שום אירוע קיים לא ייחשב בטעות כשלנו.
  const availability = await checkManualSlotAvailability(
    input.startsAt, input.endsAt, '00000000-0000-0000-0000-000000000000',
  )
  if (!availability.available) {
    if (availability.reason === 'past') return { ok: false, error: 'start_in_past' }
    if (availability.reason === 'calendar_conflict') return { ok: false, error: 'calendar_conflict' }
    if (availability.reason === 'calendar_unavailable') return { ok: false, error: 'calendar_unavailable' }
    return { ok: false, error: 'slot_taken' }
  }

  // ── 3. יצירה אטומית: idempotency + appointment + history ────────────────
  const { data, error } = await db.rpc('create_manual_appointment', {
    p_customer_id: input.customerId,
    p_service_key: input.serviceKey,
    p_variants: input.variants,
    p_price_total: input.priceTotal,
    p_starts_at: input.startsAt.toISOString(),
    p_duration_min: input.durationMin,
    p_policy_version: POLICY_VERSION,
    p_admin_id: input.adminUserId,
    p_client_request_id: input.clientRequestId,
    p_payload_fingerprint: fingerprint,
  })

  if (error) {
    const mapped = mapError(error.message)
    if (mapped === 'unknown') console.error('[adminBooking] create failed', error.message)
    return { ok: false, error: mapped }
  }

  const row = data as { appointment_id: string; replayed: boolean }
  return finishWithCalendar(row.appointment_id, row.replayed)
}

/**
 * סנכרון היומן דרך המנגנון הקיים בלבד (ensureCalendarSynced, מאחורי
 * retryCalendarSync). אין כאן מנוע Google חדש: אותו claim עם lease, אותה
 * בדיקת התנגשות חוזרת, ואותו מזהה אירוע דטרמיניסטי שמונע אירוע כפול
 * ב-retry.
 *
 * ה-whatsappUrl שהמנגנון מחזיר נזרק בכוונה — תור ידני אינו פותח WhatsApp
 * ואינו שולח הודעה אוטומטית.
 */
async function finishWithCalendar(
  appointmentId: string,
  replayed: boolean,
): Promise<{ ok: true; data: ManualAppointmentOk } | { ok: false; error: ManualAppointmentError }> {
  const sync = await retryCalendarSync(appointmentId)

  if (sync.ok) {
    return { ok: true, data: { appointmentId, calendarSynced: true, replayed } }
  }

  // ⚠️ רשומת idempotency שמצביעה על תור שאינו קיים אינה "כשל סנכרון" אלא
  // אי-התאמה בנתונים. אין ליצור תור חלופי ואין להציג הצלחה חלקית — זה היה
  // מסתיר את הבעיה ומייצר תור שני בניסיון הבא.
  if (sync.error === 'not_found') {
    console.error('[adminBooking] idempotency target appointment is missing', appointmentId)
    return { ok: false, error: 'integrity_error' }
  }

  // ⚠️ התור **לא** נמחק ולא משתנה. הוא confirmed ותקף; רק האירוע ביומן
  // חסר, וזה מצב שהמנגנון הקיים יודע לנסות שוב.
  return {
    ok: true,
    data: {
      appointmentId,
      calendarSynced: false,
      calendarMessage: sync.message,
      replayed,
    },
  }
}
