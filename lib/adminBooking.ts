import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  israelWallTimeToUtc, israelDateStr, israelMinutes, fmtIsrael,
  BUSINESS_START_MIN, BUSINESS_END_MIN,
} from '@/lib/israelTime'
import {
  findConflictingCalendarEvent, logGoogleCalendarError, adoptExistingCalendarEvent,
  listAdoptableCalendarEvents, readCalendarEvent,
  type AdoptableCalendarEvent, type AppointmentCalendarEvent,
} from '@/lib/googleCalendar'
import { lookupAppointmentsByEventIds } from '@/lib/db/calendarSync'
import {
  claimCalendarSync, completeCalendarSync, failCalendarSync, getAppointmentForAdmin,
} from '@/lib/db/appointments'
import { retryCalendarSync } from '@/lib/appointmentApproval'
import { POLICY_VERSION } from '@/lib/bookingPolicy'
import { isFridayOrSaturday } from '@/lib/bookingWindow'
import { lookupIdempotency } from '@/lib/db/manualCustomers'
import { appointmentCreateFingerprint } from '@/lib/adminIdempotency'
import {
  NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS,
  LIFTING_PRICE, LIFTING_DURATION_MIN, NATURAL_DURATION_MIN,
  isAdminOnlyService, ADMIN_MIN_DURATION_MIN, ADMIN_MAX_DURATION_MIN,
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

export type ManualServiceError =
  | 'invalid_service' | 'variants_required' | 'invalid_variants'
  | 'invalid_duration' | 'invalid_price'

export interface ResolvedService {
  serviceKey: string
  variants: string[]
  durationMin: number
  /** null = טיפול ניהולי בלי מחיר שנקבע מראש (שלב 12) */
  priceTotal: number | null
  /** true = המשך הוזן ידנית ע"י המנהלת ולא נגזר מהקטלוג */
  manualDuration: boolean
}

/** מה שהדפדפן רשאי לקבוע בטיפול ניהולי — ורק בו */
export interface ManualServiceOverrides {
  durationMin?: unknown
  priceTotal?: unknown
}

/**
 * טוענת מחדש את הגדרת השירות ומחשבת משך ומחיר בשרת.
 * שום ערך מהדפדפן לא נכנס לתוצאה מלבד הבחירה עצמה.
 *
 * ─── החריג היחיד: טיפולי מיקרובליידינג (שלב 12) ─────────────────────────────
 *
 * לשני הטיפולים הניהוליים אין משך בקטלוג — שובל קובעת אותו ידנית בכל תור,
 * וזו דרישה עסקית ולא פשרה. לכן, ורק עבורם, המשך (וגם מחיר אופציונלי)
 * מגיעים מהטופס. הם עדיין **מאומתים כאן** מול אותם גבולות שה-RPC אוכף
 * (5–480 דקות, 0010), כך שהדפדפן לא יכול לכתוב ערך שרירותי ל-DB.
 *
 * ⚠️ לשני טיפולי הקטלוג הציבוריים דבר לא השתנה: המשך והמחיר שלהם ממשיכים
 * להיגזר מ-lib/services.ts בלבד, וערכים שנשלחו עבורם מהדפדפן מתעלמים.
 */
export function resolveManualService(
  serviceKey: unknown,
  rawVariants: unknown,
  overrides: ManualServiceOverrides = {},
): { ok: true; data: ResolvedService } | { ok: false; error: ManualServiceError } {
  if (typeof serviceKey === 'string' && isAdminOnlyService(serviceKey)) {
    // ⚠️ תוספות אינן קיימות בטיפולים האלה. ערך שנשלח נדחה במפורש ולא
    // מושמט בשקט — בדיוק כמו בהרמת גבות.
    const sentVariants = Array.isArray(rawVariants) ? rawVariants : []
    if (sentVariants.length > 0) return { ok: false, error: 'invalid_variants' }

    const durationMin = Number(overrides.durationMin)
    if (
      !Number.isInteger(durationMin) ||
      durationMin < ADMIN_MIN_DURATION_MIN ||
      durationMin > ADMIN_MAX_DURATION_MIN
    ) {
      return { ok: false, error: 'invalid_duration' }
    }

    // מחיר אופציונלי: undefined/null/'' פירושם "לא נקבע", ולא 0.
    const rawPrice = overrides.priceTotal
    let priceTotal: number | null = null
    if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
      const parsed = Number(rawPrice)
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100000) {
        return { ok: false, error: 'invalid_price' }
      }
      priceTotal = parsed
    }

    return {
      ok: true,
      data: { serviceKey, variants: [], durationMin, priceTotal, manualDuration: true },
    }
  }

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
        manualDuration: false,
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
      manualDuration: false,
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

// ════════════════════════════════════════════════════════════════════════════
// 15I — אימוץ אירוע Google כמקור האמת למועד (מיקרובליידינג בלבד)
//
// ─── התקלה שנסגרת כאן ──────────────────────────────────────────────────────
//
// עד 15I האימוץ ("זה אותו תור") **קישר** את האירוע אבל שמר את המועד שהוקלד
// בטופס. אירוע ביומן 10:20–11:20 שאומץ מול הקלדה של 10:30 + 150 דקות נשמר
// במערכת כ-10:30–13:00, בעוד האירוע ביומן נשאר 10:20–11:20 — שני מועדים
// שונים לאותו תור, לנצח. התזכורות, ה-CRM וההיסטוריה כולם ירשו את המועד
// השגוי, והיומן — שהוא מה ששובל באמת מסתכלת עליו — לא סתר אותם בשום מסך.
//
// ─── הכלל ──────────────────────────────────────────────────────────────────
//
// כשנבחר אירוע Google קיים: **תאריך, התחלה, סיום ומשך נלקחים מהאירוע**,
// והמשך הוא end − start. מה שהוזן בטופס לפני כן אינו רלוונטי ואינו נשמר.
// האתר אינו מעדכן את האירוע ביומן לפי הטופס, ואינו יוצר אירוע שני.
//
// 🔒 החריגה חלה **רק** על מיקרובליידינג וייעוץ מיקרובליידינג (הטיפולים
// הניהוליים). לשני טיפולי הקטלוג הציבוריים דבר לא השתנה, וההזמנה הציבורית
// לא נגעה כאן בכלל.
// ════════════════════════════════════════════════════════════════════════════

/**
 * רק טיפול ניהולי (מיקרובליידינג / ייעוץ) זכאי לזרימת "Google הוא מקור
 * האמת". זו הנקודה היחידה שקובעת זאת, והשרת מכריע לפי ה-service_key —
 * לא לפי דגל מהדפדפן.
 */
export function supportsGoogleSourcedSlot(serviceKey: unknown): boolean {
  return typeof serviceKey === 'string' && isAdminOnlyService(serviceKey)
}

/** מועד תור שנגזר במלואו מאירוע Google — אין בו שום ערך שהגיע מהטופס */
export interface AdoptedGoogleSlot {
  eventId: string
  /** כותרת האירוע ביומן, לתצוגה בלבד. אינה נשמרת על התור. */
  summary: string
  isoDate: string
  startTime: string
  endTime: string
  startsAt: Date
  endsAt: Date
  /** תמיד end − start. לא ברירת מחדל מהקטלוג ולא מה שהוקלד. */
  durationMin: number
}

export type AdoptedSlotError =
  | 'adopt_not_supported'
  | 'adopt_event_gone'
  | 'adopt_event_taken'
  | 'adopt_event_invalid'
  | 'calendar_unavailable'

/**
 * גזירת המועד מהאירוע — פונקציה טהורה, בלי רשת ובלי DB.
 *
 * ⚠️ המשך מחושב ולא מתקבל: `end − start`. אירוע שמשכו חורג מהגבולות
 * שה-RPC אוכף (5–480 דקות) נדחה כאן במפורש, ולא נשמר "בערך".
 */
export function googleEventToSlot(event: {
  eventId: string
  summary: string
  start: Date
  end: Date
}): { ok: true; data: AdoptedGoogleSlot } | { ok: false; error: 'adopt_event_invalid' } {
  const startsAt = event.start
  const endsAt = event.end
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { ok: false, error: 'adopt_event_invalid' }
  }

  const durationMin = Math.round((endsAt.getTime() - startsAt.getTime()) / 60000)
  if (
    !Number.isInteger(durationMin) ||
    durationMin < ADMIN_MIN_DURATION_MIN ||
    durationMin > ADMIN_MAX_DURATION_MIN
  ) {
    return { ok: false, error: 'adopt_event_invalid' }
  }

  return {
    ok: true,
    data: {
      eventId: event.eventId,
      summary: event.summary,
      isoDate: israelDateStr(startsAt),
      startTime: fmtIsrael(startsAt),
      endTime: fmtIsrael(endsAt),
      startsAt,
      endsAt,
      durationMin,
    },
  }
}

/**
 * 🔒 הכלל עצמו, במקום אחד: כשיש אירוע מאומץ — **הוא** קובע את המועד.
 *
 * ⚠️ נקראת בתוך createManualAppointment, כלומר בפונקציה שכותבת בפועל, ולא
 * רק ב-route. גם קורא עתידי שיעביר בטעות את מה שהוקלד בטופס לא יוכל
 * לשמור מועד שאינו זה שביומן.
 */
export function applyGoogleSourcedSlot(
  form: { startsAt: Date; endsAt: Date; durationMin: number },
  adopted: AdoptedGoogleSlot | null,
): { startsAt: Date; endsAt: Date; durationMin: number; googleSourced: boolean } {
  if (!adopted) return { ...form, googleSourced: false }
  return {
    startsAt: adopted.startsAt,
    endsAt: adopted.endsAt,
    durationMin: adopted.durationMin,
    googleSourced: true,
  }
}

/**
 * התלויות החיצוניות של האימוץ, מוזרקות כדי שההחלטות יהיו ניתנות לבדיקה
 * בלי Google ובלי Supabase.
 */
export interface AdoptionDeps {
  readEvent: (eventId: string) => Promise<
    { ok: true; event: AppointmentCalendarEvent } | { ok: false; reason: 'gone' | 'unsupported' }
  >
  listEvents: (isoDate: string) => Promise<AdoptableCalendarEvent[]>
  /** מזהי אירועים שכבר מקושרים לתור במערכת. 'unknown' = ה-DB לא ענה. */
  linkedEventIds: (eventIds: string[]) => Promise<Set<string> | 'unknown'>
}

export function defaultAdoptionDeps(): AdoptionDeps {
  return {
    readEvent: readCalendarEvent,
    listEvents: listAdoptableCalendarEvents,
    linkedEventIds: async ids => {
      const res = await lookupAppointmentsByEventIds(ids)
      if (!res.ok) return 'unknown'
      return new Set(res.map.keys())
    },
  }
}

/**
 * אירועי היום שניתן להציג לבחירה.
 *
 * שני סינונים בלתי תלויים, ושניהם נחוצים:
 *   1. חתימת מערכת על האירוע (Google) — אירוע שכבר מייצג תור.
 *   2. `appointments.google_event_id` שמצביע עליו (DB) — אירוע שאומץ בעבר,
 *      גם אם החתימה ביומן נמחקה או שונתה ידנית.
 *
 * ⚠️ כשל בקריאת ה-DB אינו "אין קישורים": במצב כזה כל האירועים מסומנים
 * כלא-זמינים, כדי שלא ייבחר אירוע ששייך לתור אחר.
 */
export async function listAdoptableEventsForDate(
  isoDate: string,
  deps: AdoptionDeps = defaultAdoptionDeps(),
): Promise<
  | { ok: true; events: AdoptableCalendarEvent[] }
  | { ok: false; error: 'calendar_unavailable' }
> {
  let events: AdoptableCalendarEvent[]
  try {
    events = await deps.listEvents(isoDate)
  } catch (err) {
    logGoogleCalendarError('[adminBooking] adoptable events listing failed', err)
    return { ok: false, error: 'calendar_unavailable' }
  }

  const linked = await deps.linkedEventIds(events.map(e => e.eventId))
  if (linked === 'unknown') return { ok: false, error: 'calendar_unavailable' }

  // אירוע שכבר מקושר פשוט אינו מוצג. הוא אינו "אפשרות אפורה" — הצגתו
  // הייתה חושפת ללא צורך שקיים תור אחר באותה שעה.
  return { ok: true, events: events.filter(e => !linked.has(e.eventId)) }
}

/**
 * קריאת האירוע שנבחר וגזירת המועד ממנו — נקראת שוב **רגע לפני השמירה**,
 * ולא סומכת על מה שהוצג במסך.
 */
export async function resolveAdoptedGoogleSlot(
  serviceKey: unknown,
  eventId: string,
  deps: AdoptionDeps = defaultAdoptionDeps(),
): Promise<{ ok: true; data: AdoptedGoogleSlot } | { ok: false; error: AdoptedSlotError }> {
  // 🔒 שער הטיפולים. טיפול אחר שיבקש אימוץ-לפי-Google נדחה כאן, לפני כל
  // קריאה חיצונית — ולכן החריגה אינה יכולה לזלוג לקטלוג הציבורי.
  if (!supportsGoogleSourcedSlot(serviceKey)) return { ok: false, error: 'adopt_not_supported' }

  let read
  try {
    read = await deps.readEvent(eventId)
  } catch (err) {
    logGoogleCalendarError('[adminBooking] adopted event read failed', err)
    return { ok: false, error: 'calendar_unavailable' }
  }

  if (!read.ok) {
    return { ok: false, error: read.reason === 'gone' ? 'adopt_event_gone' : 'adopt_event_invalid' }
  }

  // 🔒 אירוע שנושא חתימת מערכת שייך כבר לתור. אימוצו היה גוזל אותו מהתור
  // ההוא ומשאיר אותו בלי אירוע ביומן, בלי שאיש ידע.
  if (read.event.appointmentId !== null) return { ok: false, error: 'adopt_event_taken' }

  const linked = await deps.linkedEventIds([eventId])
  if (linked === 'unknown') return { ok: false, error: 'calendar_unavailable' }
  if (linked.has(eventId)) return { ok: false, error: 'adopt_event_taken' }

  return googleEventToSlot(read.event)
}

export type AvailabilityResult =
  | { available: true }
  | {
      available: false
      reason: 'past' | 'db_conflict' | 'calendar_conflict' | 'calendar_unavailable'
      /**
       * 🔒 שלב 12 — פרטי האירוע החוסם, **רק** כשהחסימה היא יומן וכשהאירוע
       * אינו שייך כבר לתור אחר במערכת. זה בדיוק המצב שבו "זה אותו תור"
       * לגיטימי: שובל רשמה את התור ביומן בעצמה והוא עדיין לא במערכת.
       */
      adoptable?: { eventId: string; summary: string; start: string; end: string }
    }

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
  /**
   * 🔒 15I — האירוע שממנו נגזר המועד. הוא אינו התנגשות אלא התור עצמו,
   * ולכן מוחרג מהבדיקה מול היומן. **אינו** מוחרג מהבדיקה מול ה-DB: תור
   * אחר במערכת באותה שעה ממשיך לחסום.
   */
  ignoreEventId: string | null = null,
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
      israelDateStr(startsAt), startsAt, endsAt, appointmentId, ignoreEventId,
    )
    if (conflict) {
      return {
        available: false,
        reason: 'calendar_conflict',
        // ⚠️ אירוע ששייך כבר ל-appointment אחר אינו ניתן לאימוץ: זו חפיפה
        // אמיתית בין שני תורים, ואימוצה היה גוזל את האירוע מהתור הראשון.
        ...(conflict.appointmentId === null
          ? {
              adoptable: {
                eventId: conflict.eventId,
                summary: conflict.summary,
                start: conflict.start,
                end: conflict.end,
              },
            }
          : {}),
      }
    }
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
  | 'bad_fingerprint' | 'integrity_error' | 'adopt_event_gone'
  | 'adopt_event_taken' | 'unknown'

export interface ManualAppointmentOk {
  appointmentId: string
  /** true = האירוע הקיים ביומן אומץ ולא נוצר אירוע חדש (שלב 12) */
  calendarAdopted?: boolean
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
  priceTotal: number | null
  startsAt: Date
  endsAt: Date
  adminUserId: string
  clientRequestId: string
  /**
   * 🔒 שלב 12 — "זה אותו תור": מזהה אירוע Google קיים שהמנהלת אישרה
   * במפורש שהוא **אותו** תור. נוכחותו הופכת את התנגשות היומן מחסימה
   * לאימוץ: התור נשמר במערכת, והאירוע הקיים מקבל את חתימת המערכת
   * במקום שייווצר אירוע שני.
   *
   * ⚠️ אינו עוקף התנגשות **ב-DB**. תור אחר במערכת באותה שעה ממשיך לחסום,
   * כי שם מדובר בשתי לקוחות ולא בשני ייצוגים של אותו תור.
   */
  adoptCalendarEventId?: string | null
  /**
   * 🔒 15I — המועד כפי שנקרא מהאירוע ב-Google. כשהוא קיים הוא **דורס**
   * את startsAt/endsAt/durationMin שלמעלה: הם מה שהוזן בטופס, וזה מה
   * שביומן. ראה applyGoogleSourcedSlot.
   *
   * ⚠️ תקף רק לטיפול ניהולי. הפונקציה מוודאת זאת בעצמה ואינה סומכת על
   * הקורא.
   */
  adoptedSlot?: AdoptedGoogleSlot | null
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

  /*
   * 🔒 15I — Google קודם לטופס, וזה קורה **לפני** טביעת האצבע.
   *
   * ⚠️ הסדר אינו קוסמטי: ה-fingerprint חייב להיות של מה שבאמת נכתב. אילו
   * חושב על מה שהוזן בטופס, retry לגיטימי היה נראה כ"payload שונה" ונופל
   * על IDEMPOTENCY_KEY_REUSED, ורשומת ה-idempotency הייתה מתעדת מועד שלא
   * נשמר מעולם.
   *
   * ⚠️ שער הטיפולים נאכף כאן שוב, ולא רק ב-route: adoptedSlot שהגיע עם
   * טיפול מהקטלוג הציבורי מתעלם לחלוטין, והמועד נשאר של הטופס.
   */
  const adoptedSlot = supportsGoogleSourcedSlot(input.serviceKey) ? (input.adoptedSlot ?? null) : null
  const slot = applyGoogleSourcedSlot(
    { startsAt: input.startsAt, endsAt: input.endsAt, durationMin: input.durationMin },
    adoptedSlot,
  )

  const fingerprint = appointmentCreateFingerprint({
    actorAdminId: input.adminUserId,
    customerId: input.customerId,
    serviceKey: input.serviceKey,
    variants: input.variants,
    startsAt: slot.startsAt,
    durationMin: slot.durationMin,
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
    // שבו נעצר — אותו appointment ואותו מזהה אירוע דטרמיניסטי (או אותו
    // אירוע מאומץ, אם זה מה שהבקשה המקורית ביקשה).
    return finishWithCalendar(
      prior.record.target_id, true, input.adoptCalendarEventId?.trim() || null,
    )

  }

  // ── 2. בקשה חדשה: בדיקת זמינות לפני כל כתיבה ───────────────────────────
  // ה-UUID שנשלח כאן הוא מזהה זמני לצורך "האירוע הזה הוא אנחנו" — לתור
  // עוד אין מזהה, ולכן שום אירוע קיים לא ייחשב בטעות כשלנו.
  const adoptEventId = input.adoptCalendarEventId?.trim() || null
  const availability = await checkManualSlotAvailability(
    slot.startsAt, slot.endsAt, '00000000-0000-0000-0000-000000000000',
    // המועד נגזר מהאירוע הזה עצמו — הוא אינו יכול להתנגש בעצמו.
    slot.googleSourced ? adoptEventId : null,
  )
  if (!availability.available) {
    if (availability.reason === 'past') return { ok: false, error: 'start_in_past' }
    if (availability.reason === 'calendar_conflict') {
      /*
       * 🔒 האימוץ מותר רק כשהאירוע שחוסם **הוא בדיוק זה** שהמנהלת אישרה,
       * ורק כשהוא עדיין ניתן לאימוץ (כלומר אינו שייך כבר לתור אחר).
       *
       * ⚠️ ההשוואה למזהה שהגיע מהטופס אינה פורמליות: בין הבדיקה במסך
       * ללחיצה יכול להיווצר ביומן אירוע *אחר* באותה שעה, ואישור שניתן על
       * אירוע אחד אינו אישור על אירוע שהמנהלת מעולם לא ראתה.
       */
      const adoptable = availability.adoptable
      if (!adoptEventId || !adoptable || adoptable.eventId !== adoptEventId) {
        return { ok: false, error: 'calendar_conflict' }
      }
    } else if (availability.reason === 'calendar_unavailable') {
      return { ok: false, error: 'calendar_unavailable' }
    } else {
      return { ok: false, error: 'slot_taken' }
    }
  }

  // ── 3. יצירה אטומית: idempotency + appointment + history ────────────────
  const { data, error } = await db.rpc('create_manual_appointment', {
    p_customer_id: input.customerId,
    p_service_key: input.serviceKey,
    p_variants: input.variants,
    p_price_total: input.priceTotal,
    p_starts_at: slot.startsAt.toISOString(),
    p_duration_min: slot.durationMin,
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
  return finishWithCalendar(row.appointment_id, row.replayed, adoptEventId)
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
  adoptEventId: string | null = null,
): Promise<{ ok: true; data: ManualAppointmentOk } | { ok: false; error: ManualAppointmentError }> {
  if (adoptEventId) return await finishWithAdoptedEvent(appointmentId, adoptEventId, replayed)

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


/**
 * "זה אותו תור" — סגירת הסנכרון מול אירוע שכבר קיים ביומן.
 *
 * ⚠️ **אין כאן שום יצירת אירוע.** המסלול הוא claim → אימוץ (חתימה בלבד על
 * האירוע של שובל) → complete, כלומר בדיוק אותה מכונת מצבים של סנכרון רגיל,
 * רק שהצעד האמצעי הוא patch על extendedProperties במקום insert. התוצאה:
 * התור מסומן synced ומצביע על האירוע הקיים, ולא נוצר אירוע כפול.
 *
 * ⚠️ כשל באימוץ **אינו מבטל את התור.** התור נשאר confirmed ותקף, הסנכרון
 * מסומן failed, ושובל מקבלת הצלחה חלקית עם כפתור "נסה לסנכרן שוב" הרגיל —
 * בדיוק כמו כל כשל יומן אחר.
 */
async function finishWithAdoptedEvent(
  appointmentId: string,
  eventId: string,
  replayed: boolean,
): Promise<{ ok: true; data: ManualAppointmentOk } | { ok: false; error: ManualAppointmentError }> {
  const existing = await getAppointmentForAdmin(appointmentId)
  if (!existing) {
    console.error('[adminBooking] adopt target appointment is missing', appointmentId)
    return { ok: false, error: 'integrity_error' }
  }

  // retry שמגיע אחרי אימוץ שכבר הצליח: אין מה לעשות שוב.
  if (existing.calendar_sync_status === 'synced' && existing.google_event_id) {
    return {
      ok: true,
      data: { appointmentId, calendarSynced: true, calendarAdopted: true, replayed },
    }
  }

  const claim = await claimCalendarSync(appointmentId)
  if (!claim.ok) {
    return {
      ok: true,
      data: {
        appointmentId,
        calendarSynced: false,
        calendarAdopted: false,
        calendarMessage: 'סנכרון היומן כבר מתבצע. נסי לסנכרן שוב בעוד רגע.',
        replayed,
      },
    }
  }

  let adopted
  try {
    adopted = await adoptExistingCalendarEvent(appointmentId, eventId)
  } catch (err) {
    logGoogleCalendarError('[adminBooking] adopt failed', err)
    await failCalendarSync(appointmentId, 'אימוץ האירוע הקיים ביומן נכשל')
    return {
      ok: true,
      data: {
        appointmentId,
        calendarSynced: false,
        calendarAdopted: false,
        calendarMessage: 'לא הצלחנו לקשר את האירוע הקיים ביומן. אפשר לנסות שוב מרשימת התורים.',
        replayed,
      },
    }
  }

  if (!adopted.ok) {
    await failCalendarSync(
      appointmentId,
      adopted.reason === 'gone'
        ? 'האירוע שנבחר לאימוץ אינו קיים יותר ביומן'
        : 'האירוע שנבחר לאימוץ שייך כבר לתור אחר',
    )
    return {
      ok: true,
      data: {
        appointmentId,
        calendarSynced: false,
        calendarAdopted: false,
        calendarMessage: adopted.reason === 'gone'
          ? 'האירוע שסומן כ"אותו תור" אינו קיים יותר ביומן. אפשר לסנכרן מחדש מרשימת התורים כדי ליצור אירוע.'
          : 'האירוע שסומן כ"אותו תור" שייך כבר לתור אחר במערכת, ולכן לא קושר.',
        replayed,
      },
    }
  }

  const completed = await completeCalendarSync(appointmentId, adopted.eventId)
  if (!completed) {
    return {
      ok: true,
      data: {
        appointmentId,
        calendarSynced: false,
        calendarAdopted: false,
        calendarMessage: 'האירוע קושר ביומן אך שמירת האישור במערכת נכשלה. נסי לסנכרן שוב בעוד כמה דקות.',
        replayed,
      },
    }
  }

  return {
    ok: true,
    data: { appointmentId, calendarSynced: true, calendarAdopted: true, replayed },
  }
}
