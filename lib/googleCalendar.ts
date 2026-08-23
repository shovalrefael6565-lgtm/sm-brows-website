import { google } from 'googleapis'
import {
  BUSINESS_START_MIN, BUSINESS_END_MIN, DAY_MIN,
  israelDateStr, israelMinutes, minToHHMM, dayBoundsUtc, israelWallTimeToUtc,
} from './israelTime'
import { CALENDAR_EVENT_SOURCE, deterministicEventId } from './calendarLink'

const SERVICE_DURATIONS: Record<string, number> = {
  'עיצוב גבות טבעיות': 20,
  'הרמת גבות': 45,
  'קורס מקצועי': 60,
  'מיקרובליידינג': 150,
}

function getCredentials() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (raw) return JSON.parse(raw)
  throw new Error('Neither GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 nor GOOGLE_SERVICE_ACCOUNT_KEY is set')
}

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
}

function getCalendarId() {
  const id = process.env.GOOGLE_CALENDAR_ID
  if (!id) throw new Error('GOOGLE_CALENDAR_ID is not set')
  return id
}

/**
 * Busy time ranges (HH:MM Israel) for a date — a faithful reflection of the
 * real calendar: every timed event that overlaps the business window
 * (09:00–19:00 Israel) on that date is blocked, clamped to the window.
 * No AM/PM guessing — the calendar is the source of truth.
 */
export async function getBusyRanges(date: string): Promise<{ start: string; end: string }[]> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()
  const { timeMin, timeMax } = dayBoundsUtc(date)

  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  })

  const events = res.data.items ?? []
  const ranges: { start: string; end: string }[] = []

  for (const event of events) {
    if (event.status === 'cancelled') continue
    const startStr = event.start?.dateTime
    const endStr   = event.end?.dateTime
    if (!startStr || !endStr) continue  // skip all-day / date-only events

    const start = new Date(startStr)
    const end   = new Date(endStr)

    // Minutes-from-midnight on the *target* Israel date, clamped to that day,
    // so multi-day or adjacent-day events only contribute their portion of today.
    const startDate = israelDateStr(start)
    const endDate   = israelDateStr(end)

    let startMin: number
    if (startDate < date) startMin = 0
    else if (startDate === date) startMin = israelMinutes(start)
    else continue // event starts after today

    let endMin: number
    if (endDate > date) endMin = DAY_MIN
    else if (endDate === date) endMin = israelMinutes(end)
    else continue // event ended before today

    // Clamp to the business window and keep only a positive overlap.
    const s = Math.max(startMin, BUSINESS_START_MIN)
    const e = Math.min(endMin, BUSINESS_END_MIN)
    if (s < e) ranges.push({ start: minToHHMM(s), end: minToHHMM(e) })
  }

  return ranges
}

/**
 * Creates a calendar event for a new booking.
 *
 * ⚠️ שלב 8 — קוד מת: אין קריאה אליה מ-app/ או lib/ (המסלול הפעיל הוא
 * createAppointmentEvent למטה). הוסרו כאן הזרמת `params.notes` וגם
 * `params.phone` לתיאור האירוע — לא הערות חופשיות ולא מספר טלפון אמורים
 * להגיע ל-Google Calendar בשום מסלול, כולל זה שאינו מחווט כרגע. לא נגעו
 * במנגנון הסנכרון הפעיל עצמו.
 */
export async function createBookingEvent(params: {
  name: string
  service: string
  date: string   // e.g. "16 מאי 2026"
  time: string   // e.g. "10:20"
}) {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  const isoDate = parseHebrewDate(params.date)
  const durationMinutes = SERVICE_DURATIONS[params.service] ?? 60

  // israelWallTimeToUtc ולא new Date(`${isoDate}T${time}:00`) — השרת רץ ב-UTC
  // (Vercel), ובניית תאריך ישיר מהמחרוזת הייתה מפרשת את השעה כ-UTC ולא
  // כשעון קיר ישראלי, כלומר קובעת תור בפועל 2-3 שעות מוקדם/מאוחר מהמבוקש.
  const startDate = israelWallTimeToUtc(isoDate, params.time)
  const endDate   = new Date(startDate.getTime() + durationMinutes * 60 * 1000)

  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `🌸 ${params.service} — ${params.name}`,
      start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Jerusalem' },
      end:   { dateTime: endDate.toISOString(),   timeZone: 'Asia/Jerusalem' },
    },
  })
}

// ============================================================================
// שלב 6 — אישור בקשות תור: אירוע ביומן עם idempotency אמיתי.
//
// Google Calendar ו-Supabase אינם אותה מערכת (אין transaction משותף), אז
// אי אפשר להסתמך על "לא ניסינו קודם" כדי למנוע אירוע כפול. הפתרון: מזהה
// אירוע דטרמיניסטי שנגזר אך ורק מ-appointment.id (ראה deterministicEventId
// למטה) — כל ניסיון חוזר (אחרי כשל DB, timeout, לחיצה כפולה) מנסה ליצור
// בדיוק את אותו ID. Google דוחה יצירה שנייה עם אותו ID (409), ואז השחזור
// הוא GET רגיל על אותו מזהה — לא חיפוש, לא ניחוש.
// ============================================================================

// ⚠️ זהות האירוע (המזהה הדטרמיניסטי וההיפוך שלו) עברה ל-lib/calendarLink.ts
// — מודול טהור בלי googleapis, כדי שגם server components ובדיקות יוכלו
// לענות על "האם האירוע הזה שלנו" בלי לטעון את מנוע ה-API. הייצוא מחדש כאן
// שומר על כל ה-imports הקיימים בדיוק כפי שהם.
export {
  CALENDAR_EVENT_SOURCE,
  deterministicEventId,
  appointmentIdFromDeterministicEventId,
} from './calendarLink'

function isGoogleApiError(err: unknown): err is { code?: number | string; response?: { status?: number } } {
  return typeof err === 'object' && err !== null
}

export function googleErrorStatus(err: unknown): number | undefined {
  if (!isGoogleApiError(err)) return undefined
  const status = err.response?.status
  if (typeof status === 'number') return status
  const code = err.code
  if (typeof code === 'number') return code
  if (typeof code === 'string' && /^\d+$/.test(code)) return Number(code)
  return undefined
}

/**
 * שלב 3 (תיקון לוגים) — לוג בטוח לכשל בקריאה ליומן Google.
 *
 * שומר אך ורק: קונטקסט קבוע שנכתב בקוד הקורא, שם ספק קבוע, ו-status
 * מספרי אם קיים (googleErrorStatus, כבר מסונן). לעולם לא message, stack,
 * cause, config, request, response, headers או תוכן מהשגיאה עצמה — אלה
 * עלולים לשאת URL, פרטי בקשה או תוכן payload.
 */
export function logGoogleCalendarError(context: string, err: unknown): void {
  const status = googleErrorStatus(err)
  console.error(context, 'provider=google_calendar', `status=${status ?? 'unknown'}`)
}

/** הודעת שגיאה קצרה ובטוחה לשמירה ב-DB — לעולם לא JSON מלא/tokens/headers */
export function sanitizeGoogleError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.slice(0, 300)
}

/**
 * ה-`reason` המובנה שגוגל מחזירה (`errors[0].reason`), למשל
 * 'fullSyncRequired' או 'invalid'. משמש בשלב 8 כדי להבחין בין שגיאת cursor
 * לשגיאה אחרת — הבחנה שאסור לבסס על ניחוש מטקסט חופשי, כי טעות בה מאפסת
 * syncToken תקין ומאלצת סריקה מלאה של כל היומן.
 */
export function googleErrorReason(err: unknown): string | undefined {
  if (!isGoogleApiError(err)) return undefined
  const e = err as { errors?: { reason?: unknown }[]; response?: { data?: { error?: { errors?: { reason?: unknown }[] } } } }
  const reason = e.errors?.[0]?.reason ?? e.response?.data?.error?.errors?.[0]?.reason
  return typeof reason === 'string' ? reason : undefined
}

export interface AppointmentCalendarEvent {
  eventId: string
  appointmentId: string | null
  start: Date
  end: Date
  /** כותרת האירוע כפי שהיא ביומן. ריקה כשהאירוע נוצר בלי כותרת. */
  summary: string
}

/**
 * כל האירועים (לא מבוטלים) שחופפים לטווח נתון באותו יום, עם appointment_id
 * מתוך extendedProperties.private אם קיים. משמש הן לבדיקת התנגשות (ownership
 * matters: אירוע שהוא שלנו לא ייחשב חוסם) והן ל-reconciliation (מציאת
 * האירוע שלנו אם הוא כבר קיים ביומן בלי שה-DB יודע על כך).
 */
async function listAppointmentEventsForDate(isoDate: string): Promise<AppointmentCalendarEvent[]> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()
  const { timeMin, timeMax } = dayBoundsUtc(isoDate)

  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  })

  const events = res.data.items ?? []
  const result: AppointmentCalendarEvent[] = []
  for (const event of events) {
    if (event.status === 'cancelled') continue
    const startStr = event.start?.dateTime
    const endStr = event.end?.dateTime
    if (!startStr || !endStr || !event.id) continue

    const props = event.extendedProperties?.private
    const appointmentId =
      props?.source === CALENDAR_EVENT_SOURCE && typeof props?.appointment_id === 'string'
        ? props.appointment_id
        : null

    result.push({
      eventId: event.id,
      appointmentId,
      start: new Date(startStr),
      end: new Date(endStr),
      summary: typeof event.summary === 'string' ? event.summary : '',
    })
  }
  return result
}

export interface CalendarConflict {
  eventId: string
  /**
   * 🔒 שלב 12 — מזהה ה-appointment שהאירוע כבר שייך לו, אם קיים.
   *
   * ⚠️ ההבחנה קריטית לזרימת "זה אותו תור": אירוע **ידני** (null) הוא אירוע
   * שאין לו תור במערכת, ולכן מותר לאמץ אותו. אירוע ששייך כבר לתור אחר הוא
   * הזמנה כפולה אמיתית, ואין לאמץ אותו בשום מצב.
   */
  appointmentId: string | null
  summary: string
  start: string
  end: string
}

/**
 * בודקת התנגשות אמיתית מול היומן לטווח [startsAt, endsAt) של תור מסוים.
 * אירוע ששייך לאותו appointment (לפי extendedProperties) אינו נחשב
 * התנגשות — הוא "אנחנו", לא זר. כל חפיפה אחרת (ידנית או תור אחר) חוסמת.
 */
export async function findConflictingCalendarEvent(
  isoDate: string,
  startsAt: Date,
  endsAt: Date,
  appointmentId: string,
  /**
   * 🔒 15I — אירוע שכבר אושר מפורשות כ"זה אותו תור" ושהמועד נלקח **ממנו**.
   * הוא אינו התנגשות בהגדרה: הוא התור עצמו, רק שעדיין אין לו את חתימת
   * המערכת. בלי החרגה מפורשת הוא היה חוסם את התור שנגזר ממנו.
   *
   * ⚠️ מחריג אירוע **אחד** ולפי מזהה. כל אירוע אחר שחופף — כולל אירוע שני
   * ביומן באותה שעה — ממשיך לחסום בדיוק כמו קודם.
   */
  ignoreEventId: string | null = null,
): Promise<CalendarConflict | null> {
  const events = await listAppointmentEventsForDate(isoDate)
  for (const event of events) {
    if (event.appointmentId === appointmentId) continue // אנחנו — לא התנגשות
    if (ignoreEventId && event.eventId === ignoreEventId) continue // האירוע שאומץ
    const overlaps = event.start.getTime() < endsAt.getTime() && event.end.getTime() > startsAt.getTime()
    if (overlaps) {
      return {
        eventId: event.eventId,
        appointmentId: event.appointmentId,
        summary: event.summary,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
      }
    }
  }
  return null
}

// ============================================================================
// 15I — גילוי אירועים לאימוץ, וקריאת אירוע בודד כמקור אמת למועד.
//
// ─── למה זה קיים ───────────────────────────────────────────────────────────
//
// עד כאן אפשר היה לאמץ אירוע קיים רק במקרה: המנהלת הקלידה שעה, השעה
// התנגשה באירוע, והמערכת הציעה "זה אותו תור". מי שיודעת שהתור כבר ביומן
// לא צריכה לנחש את השעה כדי למצוא אותו — היא צריכה לראות את אירועי היום
// ולבחור. וברגע שבחרה, **המועד הוא של Google** ולא של הטופס.
//
// ⚠️ שתי הפונקציות כאן **קוראות בלבד**. אף אחת מהן אינה יוצרת, מזיזה או
// מוחקת אירוע, ואף אחת מהן אינה כותבת ליומן את מה שהוזן באתר.
// ============================================================================

/** אירוע ביומן שאפשר לאמץ — בדיוק המידע שדרוש לזהות אותו, ולא יותר */
export interface AdoptableCalendarEvent {
  eventId: string
  /** כותרת האירוע כפי שהיא ביומן. ריקה כשהאירוע נוצר בלי כותרת. */
  summary: string
  start: string
  end: string
  durationMin: number
}

/**
 * כל אירועי היום שניתן לאמץ: אירועים בעלי שעה (לא ימים שלמים), לא
 * מבוטלים, **שאין עליהם חתימת מערכת** — כלומר אירועים ששובל יצרה ביומן
 * בעצמה ואין להם תור באתר.
 *
 * ⚠️ אירוע שנושא חתימת מערכת מושמט כאן לגמרי, ולא מוחזר כ"תפוס": הוא כבר
 * מייצג תור קיים, ובחירה בו הייתה גוזלת אותו מהתור ההוא.
 *
 * ⚠️ מוחזרים רק מזהה, כותרת וטווח. לא משתתפים, לא תיאור, לא מיקום ולא
 * שום payload אחר מ-Google.
 */
export async function listAdoptableCalendarEvents(
  isoDate: string,
): Promise<AdoptableCalendarEvent[]> {
  const events = await listAppointmentEventsForDate(isoDate)
  return events
    // רק אירועים שמתחילים ביום המבוקש עצמו — אירוע שנמשך מאתמול אינו
    // "תור של היום הזה", והצגתו הייתה מזמינה בחירה שגויה.
    .filter(e => e.appointmentId === null && israelDateStr(e.start) === isoDate)
    .map(e => ({
      eventId: e.eventId,
      summary: e.summary,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
      durationMin: Math.round((e.end.getTime() - e.start.getTime()) / 60000),
    }))
}

export type CalendarEventReadResult =
  | { ok: true; event: AppointmentCalendarEvent }
  /** 'gone' = נמחק/בוטל · 'unsupported' = יום שלם או אירוע בלי טווח שעות */
  | { ok: false; reason: 'gone' | 'unsupported' }

/**
 * קריאת אירוע בודד מהיומן — **מקור האמת** למועד של תור מאומץ.
 *
 * ⚠️ נקראת שוב רגע לפני השמירה, ולא מסתמכת על מה שהוצג במסך: בין הבחירה
 * לשליחה שובל יכולה להזיז את האירוע ביומן, ומה שנשמר חייב להיות מה
 * שביומן **עכשיו**.
 */
export async function readCalendarEvent(eventId: string): Promise<CalendarEventReadResult> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  let data
  try {
    const res = await calendar.events.get({ calendarId, eventId })
    data = res.data
  } catch (err) {
    const status = googleErrorStatus(err)
    if (status === 404 || status === 410) return { ok: false, reason: 'gone' }
    throw err
  }

  if (data.status === 'cancelled') return { ok: false, reason: 'gone' }

  const startStr = data.start?.dateTime
  const endStr = data.end?.dateTime
  // אירוע "יום שלם" אין לו שעת התחלה וסיום, ולכן אין ממה לגזור תור.
  if (!startStr || !endStr || !data.id) return { ok: false, reason: 'unsupported' }

  const props = data.extendedProperties?.private
  const appointmentId =
    props?.source === CALENDAR_EVENT_SOURCE && typeof props?.appointment_id === 'string'
      ? props.appointment_id
      : null

  return {
    ok: true,
    event: {
      eventId: data.id,
      appointmentId,
      start: new Date(startStr),
      end: new Date(endStr),
      summary: typeof data.summary === 'string' ? data.summary : '',
    },
  }
}

/**
 * מוצאת את האירוע של appointment ספציפי ביומן, אם קיים — לפי המזהה
 * הדטרמיניסטי. משמשת ל-reconciliation: Google הצליח בעבר אך ה-DB לא
 * הספיק להירשם (כשל/timeout), וניסיון חוזר צריך לזהות זאת ולא ליצור שוב.
 */
export async function findExistingAppointmentEvent(appointmentId: string): Promise<{ eventId: string } | null> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()
  const eventId = deterministicEventId(appointmentId)

  try {
    const res = await calendar.events.get({ calendarId, eventId })
    if (res.data.status === 'cancelled') return null
    const props = res.data.extendedProperties?.private
    if (props?.source !== CALENDAR_EVENT_SOURCE || props?.appointment_id !== appointmentId) return null
    return { eventId }
  } catch (err) {
    if (googleErrorStatus(err) === 404) return null
    throw err
  }
}

export interface CreateAppointmentEventParams {
  appointmentId: string
  customerName: string
  treatment: string
  isoDate: string
  startHHMM: string
  durationMin: number
}

/**
 * יוצרת (או משחזרת) את אירוע היומן לתור מאושר, עם ה-ID הדטרמיניסטי.
 *
 * אם ה-INSERT נכשל כי ה-ID כבר קיים (409) — זה תמיד האירוע שלנו עצמו
 * (אף גורם אחר לא יכול להתנגש על ID שנגזר מה-UUID שלנו), אז זו לא שגיאה
 * אלא אישור שהיצירה כבר הצליחה בעבר: מאמתים בעלות ומחזירים הצלחה, בלי
 * ליצור אירוע שני.
 */
export async function createAppointmentEvent(
  params: CreateAppointmentEventParams,
): Promise<{ eventId: string }> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()
  const eventId = deterministicEventId(params.appointmentId)

  const startDate = israelWallTimeToUtc(params.isoDate, params.startHHMM)
  const endDate = new Date(startDate.getTime() + params.durationMin * 60 * 1000)

  const description = [
    `טיפול: ${params.treatment}`,
    `מזהה תור: ${params.appointmentId}`,
    'נקבע דרך אתר SM Brows',
  ].join('\n')

  try {
    await calendar.events.insert({
      calendarId,
      requestBody: {
        id: eventId,
        summary: `🌸 ${params.customerName} | ${params.treatment}`,
        description,
        start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Jerusalem' },
        end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Jerusalem' },
        extendedProperties: {
          private: {
            appointment_id: params.appointmentId,
            source: CALENDAR_EVENT_SOURCE,
          },
        },
      },
    })
    return { eventId }
  } catch (err) {
    if (googleErrorStatus(err) === 409) {
      const existing = await findExistingAppointmentEvent(params.appointmentId)
      if (existing) return existing
    }
    throw err
  }
}

// ============================================================================
// שלב 7 — שינוי מועד וביטול ע"י הלקוחה: עדכון ומחיקה של האירוע הקיים.
//
// שני הכללים שמנחים את כל מה שלמטה:
//   1. לעולם לא ליצור אירוע שני. עדכון מועד הוא patch על האירוע הקיים,
//      ורק אם הוא באמת נעלם — יצירה מחדש עם אותו ID דטרמיניסטי.
//   2. לעולם לא לגעת באירוע שאינו שלנו. לפני כל patch/delete מאמתים
//      extendedProperties.private (source + appointment_id). אירוע ידני
//      של שובל ואירוע של appointment אחר נשארים בדיוק כפי שהם.
// ============================================================================

/**
 * מזהי האירוע המועמדים לתור, לפי סדר עדיפות: המזהה השמור ב-DB (אם יש),
 * ואחריו המזהה הדטרמיניסטי.
 *
 * ⚠️ google_event_id ריק אינו מוכיח שאין אירוע ביומן — ייתכן שהיצירה
 * הצליחה ורק שמירת המזהה ב-Supabase נכשלה (תרחיש 1 בשלב 6). לכן המזהה
 * הדטרמיניסטי תמיד נבדק, גם כשהעמודה ריקה.
 */
function candidateEventIds(appointmentId: string, googleEventId: string | null): string[] {
  const deterministic = deterministicEventId(appointmentId)
  return googleEventId && googleEventId !== deterministic
    ? [googleEventId, deterministic]
    : [deterministic]
}

function isOwnedBy(
  event: { extendedProperties?: { private?: Record<string, string> | null } | null },
  appointmentId: string,
): boolean {
  const props = event.extendedProperties?.private
  return props?.source === CALENDAR_EVENT_SOURCE && props?.appointment_id === appointmentId
}

interface FoundEvent {
  eventId: string
  owned: boolean
}

/** מאתר את האירוע של התור לפי המזהים המועמדים. null = לא קיים אף אחד מהם. */
async function findEventByCandidates(
  appointmentId: string,
  googleEventId: string | null,
): Promise<FoundEvent | null> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  for (const eventId of candidateEventIds(appointmentId, googleEventId)) {
    try {
      const res = await calendar.events.get({ calendarId, eventId })
      if (res.data.status === 'cancelled') continue
      return { eventId, owned: isOwnedBy(res.data, appointmentId) }
    } catch (err) {
      const status = googleErrorStatus(err)
      if (status === 404 || status === 410) continue
      throw err
    }
  }
  return null
}

export interface UpdateAppointmentEventParams extends CreateAppointmentEventParams {
  /** המזהה השמור ב-DB, אם קיים. null → מחפשים לפי המזהה הדטרמיניסטי בלבד. */
  googleEventId: string | null
}

export type UpdateEventResult =
  | { ok: true; eventId: string; created: boolean }
  | { ok: false; reason: 'not_ours' }

/**
 * מעדכנת את שעת האירוע הקיים של התור — start/end בלבד.
 *
 * events.patch ולא events.update: patch משנה רק את השדות שנשלחו ומשמר
 * summary, description ו-extendedProperties (כלומר את זהות ה-appointment)
 * כפי שהם. אם האירוע נעלם מהיומן לגמרי — נוצר מחדש עם אותו ID דטרמיניסטי,
 * ולכן גם כאן לא ייווצר אירוע שני.
 */
export async function updateAppointmentEventTime(
  params: UpdateAppointmentEventParams,
): Promise<UpdateEventResult> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  const found = await findEventByCandidates(params.appointmentId, params.googleEventId)

  if (!found) {
    const created = await createAppointmentEvent(params)
    return { ok: true, eventId: created.eventId, created: true }
  }
  if (!found.owned) {
    // מזהה שקיים ביומן אך אינו נושא את חתימת המערכת — לא נוגעים בו.
    return { ok: false, reason: 'not_ours' }
  }

  const startDate = israelWallTimeToUtc(params.isoDate, params.startHHMM)
  const endDate = new Date(startDate.getTime() + params.durationMin * 60 * 1000)

  await calendar.events.patch({
    calendarId,
    eventId: found.eventId,
    requestBody: {
      start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Jerusalem' },
      end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Jerusalem' },
    },
  })

  return { ok: true, eventId: found.eventId, created: false }
}

export type DeleteEventResult =
  | { ok: true; deleted: boolean }
  | { ok: false; reason: 'not_ours' }

/**
 * מוחקת את אירוע היומן של התור — ורק אותו.
 *
 * • לא נמצא אירוע כלל (או 404/410 בזמן המחיקה) → הצלחה idempotent.
 *   מבחינת המערכת המצב הרצוי הושג: אין אירוע ביומן.
 * • נמצא אירוע שאינו נושא את חתימת המערכת (אירוע ידני של שובל, או אירוע
 *   של appointment אחר) → כשל בטוח, בלי מחיקה.
 */
export async function deleteAppointmentEvent(
  appointmentId: string,
  googleEventId: string | null,
): Promise<DeleteEventResult> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  const found = await findEventByCandidates(appointmentId, googleEventId)
  if (!found) return { ok: true, deleted: false }
  if (!found.owned) return { ok: false, reason: 'not_ours' }

  try {
    await calendar.events.delete({ calendarId, eventId: found.eventId })
    return { ok: true, deleted: true }
  } catch (err) {
    const status = googleErrorStatus(err)
    // נמחק בין ה-get למחיקה — בדיוק התוצאה שרצינו
    if (status === 404 || status === 410) return { ok: true, deleted: false }
    throw err
  }
}

const HEBREW_MONTHS: Record<string, number> = {
  'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'אפריל': 4,
  'מאי': 5, 'יוני': 6, 'יולי': 7, 'אוגוסט': 8,
  'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12,
}

function parseHebrewDate(hebrewDate: string): string {
  // "16 מאי 2026" → "2026-05-16"
  const [day, month, year] = hebrewDate.split(' ')
  const m = HEBREW_MONTHS[month]
  if (!m) throw new Error(`Unknown Hebrew month: ${month}`)
  return `${year}-${m.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

// ============================================================================
// שלב 12 — אימוץ אירוע ידני קיים ("זה אותו תור")
//
// ─── הבעיה ─────────────────────────────────────────────────────────────────
//
// שובל קובעת מיקרובליידינג בטלפון, רושמת אותו ביומן Google בעצמה, ורק
// אחר כך מכניסה אותו למערכת כדי שיהיה CRM ותזכורת. הבדיקה מול היומן
// רואה את האירוע שלה, ובצדק חוסמת — אבל זה **אותו תור**, לא התנגשות.
//
// ─── מה עושים כאן, ומה בכוונה לא ────────────────────────────────────────────
//
// האימוץ **אינו יוצר אירוע שני** ואינו מזיז את האירוע הקיים: הוא כותב על
// האירוע של שובל את חתימת המערכת (extendedProperties.private) ותו לא.
// המועד, הכותרת והתיאור שלה נשארים מילה במילה כפי שהם.
//
// ⚠️ החתימה היא בדיוק מה שהופך את האירוע ל"שלנו" מבחינת כל שאר המנגנון
// (isOwnedBy): מרגע האימוץ שינוי מועד יעדכן את האירוע הזה, וביטול ימחק
// אותו — במקום להיכשל ב-'calendar_not_ours' על אירוע יתום.
//
// 🔒 אירוע ששייך כבר ל-appointment אחר **לא מאומץ בשום מצב**. זו הזמנה
// כפולה אמיתית, ואימוץ שלה היה גונב את האירוע מהתור הראשון ומשאיר אותו
// בלי אירוע ביומן, בלי שאיש ידע.
// ============================================================================

export type AdoptEventResult =
  | { ok: true; eventId: string }
  | { ok: false; reason: 'gone' | 'belongs_to_other_appointment' }

export async function adoptExistingCalendarEvent(
  appointmentId: string,
  eventId: string,
): Promise<AdoptEventResult> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  let existing
  try {
    const res = await calendar.events.get({ calendarId, eventId })
    existing = res.data
  } catch (err) {
    const status = googleErrorStatus(err)
    // האירוע נעלם בין הבדיקה לאישור — אין מה לאמץ, וזה אינו כשל תקשורת.
    if (status === 404 || status === 410) return { ok: false, reason: 'gone' }
    throw err
  }

  if (existing.status === 'cancelled') return { ok: false, reason: 'gone' }

  const props = existing.extendedProperties?.private ?? {}
  if (props.source === CALENDAR_EVENT_SOURCE && props.appointment_id !== appointmentId) {
    return { ok: false, reason: 'belongs_to_other_appointment' }
  }

  // ⚠️ מיזוג ולא החלפה: מאפיינים פרטיים אחרים על האירוע נשמרים. patch
  // על extendedProperties בלבד — start/end/summary/description לא נשלחים
  // כלל, ולכן Google אינו נוגע בהם.
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      extendedProperties: {
        private: { ...props, appointment_id: appointmentId, source: CALENDAR_EVENT_SOURCE },
      },
    },
  })

  return { ok: true, eventId }
}
