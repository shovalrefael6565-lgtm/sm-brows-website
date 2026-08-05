import { google, type calendar_v3 } from 'googleapis'
import { createHash } from 'crypto'
import {
  CALENDAR_EVENT_SOURCE,
  appointmentIdFromDeterministicEventId,
  googleErrorStatus,
  googleErrorReason,
} from './googleCalendar'

/**
 * שלב 8 — הצד של Google בסנכרון הנכנס.
 *
 * זהו ערוץ שאילתה *נפרד לגמרי* מ-getBusyRanges ו-listAppointmentEventsForDate
 * ב-lib/googleCalendar.ts. אלה סורקות יום בודד לפי timeMin/timeMax; כאן
 * עוקבים אחרי שינויים לאורך זמן באמצעות syncToken. שני הערוצים אינם
 * חולקים parameters ואינם משפיעים זה על זה.
 *
 * הקובץ הזה אינו נוגע ב-Supabase ואינו מקבל החלטות עסקיות — הוא מביא
 * שינויים ומסווג אותם. ההחלטות ב-lib/calendarInboundSync.ts.
 */

// ============================================================================
// פרמטרי השאילתה
// ============================================================================

/**
 * הפרמטרים הקבועים של ערוץ הסנכרון. חייבים להיות *זהים בין ה-full sync
 * לבין כל בקשה עם syncToken*, אחרת ההתנהגות אינה מוגדרת לפי התיעוד.
 *
 * • showDeleted: true — חובה. אסור להעביר false יחד עם syncToken, ובלעדיו
 *   מחיקת אירוע לא הייתה מגיעה אלינו כלל.
 *
 * • singleEvents: false — בכוונה, ובניגוד ל-getBusyRanges. עם true וללא
 *   timeMin/timeMax (שאסורים עם syncToken) Google מרחיב כל אירוע חוזר לכל
 *   המופעים שלו, ואירוע חוזר ללא סוף ביומן היה מייצר סריקה עצומה. אירועי
 *   האתר כולם חד-פעמיים ולכן חוזרים זהים; אירוע חוזר ידני חוזר כאב אחד
 *   שאנחנו ממילא מתעלמים ממנו.
 *
 * ⚠️ timeMin, timeMax, orderBy, updatedMin, q ו-privateExtendedProperty
 * אסורים יחד עם syncToken ולכן אינם נשלחים גם ב-full sync. המחיר הוא
 * ש-full sync עובר על כל היומן; הריסון הוא שרק אירועי מערכת נשמרים בכלל.
 */
const SYNC_QUERY_DEFAULTS = {
  showDeleted: true,
  singleEvents: false,
  maxResults: 250,
} as const

export type SyncMode = 'full' | 'incremental'

export interface ListChangesRequest {
  mode: SyncMode
  /** ה-syncToken שממנו התחילה הסדרה. נדרש ב-incremental, מתעלמים ממנו ב-full. */
  baseSyncToken: string | null
  /** cursor של עמוד המשך. null = העמוד הראשון. */
  pageToken: string | null
}

export interface ListChangesParams {
  calendarId: string
  showDeleted: boolean
  singleEvents: boolean
  maxResults: number
  syncToken?: string
  pageToken?: string
}

/**
 * בונה את אובייקט הבקשה. זו הפונקציה שמקודדת את הכלל הקריטי היחיד של
 * ה-pagination:
 *
 *   full sync        → syncToken לעולם לא נשלח. pageToken בעמודי המשך.
 *   incremental sync → syncToken נשלח ב*כל* עמוד, כולל עמודי המשך ו-resume,
 *                      *בנוסף* ל-pageToken.
 *
 * ⚠️ pageToken לבדו ב-incremental הוא באג: בקשת עמוד המשך חייבת להיות אותה
 * שאילתה בדיוק של העמוד הראשון, ושם ה-syncToken הוא חלק מהשאילתה. בלעדיו
 * התוצאה אינה מוגדרת. ב-full sync אין syncToken מלכתחילה ולכן אין מה לשמר.
 */
export function buildListChangesParams(
  calendarId: string,
  req: ListChangesRequest,
): ListChangesParams {
  const params: ListChangesParams = { calendarId, ...SYNC_QUERY_DEFAULTS }

  if (req.mode === 'incremental') {
    if (!req.baseSyncToken) {
      throw new Error('incremental sync requires a base sync token')
    }
    params.syncToken = req.baseSyncToken
  }
  if (req.pageToken) params.pageToken = req.pageToken

  return params
}

// ============================================================================
// סיווג שגיאות cursor
// ============================================================================

/**
 * ברירת המחדל בכל ספק היא *לא לאפס כלום*. איפוס שגוי של syncToken תקין
 * מאלץ סריקה מלאה של כל היומן, ואיפוס של pageToken באמצע סדרה מאבד את
 * ההתקדמות — שניהם עונש כבד על שגיאה שאולי כלל אינה קשורה ל-cursor.
 *
 *   'full_reset'   — הטוקן עצמו פסול. 410 / fullSyncRequired.
 *   'page_restart' — רק ה-pageToken פסול; ה-syncToken של הסדרה עדיין תקף,
 *                    אז מתחילים את אותה סדרה מהעמוד הראשון.
 *   'transient'    — 403/429/5xx/רשת. שומרים את ה-cursor כפי שהוא.
 *   'fatal'        — כל השאר, כולל 400 שאינו מזוהה כבעיית cursor.
 */
export type CursorErrorKind = 'full_reset' | 'page_restart' | 'transient' | 'fatal'

const PAGE_TOKEN_REASONS = new Set(['invalid', 'badRequest', 'invalidParameter'])

export function classifyCursorError(err: unknown, sentPageToken: boolean): CursorErrorKind {
  const status = googleErrorStatus(err)
  const reason = googleErrorReason(err)

  if (status === 410 || reason === 'fullSyncRequired') return 'full_reset'

  // pageToken פסול — רק אם באמת שלחנו pageToken בבקשה הזו. 400 על בקשה
  // ללא pageToken לעולם אינו יכול להיות בעיית pageToken.
  if (sentPageToken && (status === 400 || status === 404) && reason && PAGE_TOKEN_REASONS.has(reason)) {
    return 'page_restart'
  }

  if (status === 403 || status === 429 || (status !== undefined && status >= 500)) return 'transient'
  if (status === undefined) return 'transient' // תקלת רשת ללא קוד — לא מאפסים כלום

  return 'fatal'
}

// ============================================================================
// סיווג האירוע עצמו
// ============================================================================

export type EventOwnership =
  | 'extended_properties'
  | 'deterministic_id'
  | 'stored_event_id'
  | 'ambiguous'

export type EventShape =
  | 'timed_single'
  | 'recurring_master'
  | 'recurring_instance'
  | 'all_day'
  | 'malformed'

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled'

/**
 * הרשומה שנשמרת ב-calendar_change_queue. שים לב למה ש*אינו* כאן: summary,
 * description, attendees, location, recurrence payload, organizer, צבע.
 * גם באירוע מערכת אין סיבה לשמר אותם, ובאירוע ידני זו פגיעה בפרטיות.
 */
export interface CalendarChangeRecord {
  google_event_id: string
  event_version: string
  ownership: EventOwnership
  event_shape: EventShape
  appointment_id: string | null
  event_status: EventStatus
  event_start: string | null
  event_end: string | null
  event_updated: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * גרסת האירוע — המפתח שמבטיח שכל גרסה מעובדת לכל היותר פעם אחת.
 *
 * סדר העדיפות יורד מהאמין ביותר לנפילה האחורית:
 *   1. etag      — משתנה בכל שינוי אמיתי. הגרסה הנכונה.
 *   2. updated   — חותמת שינוי אחרון.
 *   3. sequence  — מונה גרסה של האירוע.
 *   4. fingerprint של מזהה, סטטוס, זמנים וסימן חזרתיות בלבד.
 *
 * ⚠️ ה-fingerprint אינו כולל summary, description, attendees, location או
 * כל תוכן פרטי — הוא מזהה גרסה, לא תמצית של האירוע.
 *
 * ⚠️ מקרה קצה מתועד: אירוע שנמחק, שוחזר ונמחק שוב *כאשר Google לא סיפקה
 * לא etag, לא updated ולא sequence* — שתי המחיקות מקבלות אותו fingerprint
 * ומתאחדות לגרסה אחת. זה בטוח: השחזור שביניהן נושא status='confirmed'
 * ולכן מקבל גרסה משלו, והביטול עצמו idempotent — המחיקה השנייה הייתה
 * מוצאת appointment שכבר cancelled_by_business ומחזירה already_cancelled
 * באפס כתיבות.
 */
export function eventVersion(event: calendar_v3.Schema$Event): string {
  if (event.etag) return event.etag
  if (event.updated) return `u:${event.updated}`
  if (typeof event.sequence === 'number') return `q:${event.sequence}`

  const material = [
    event.id ?? '',
    event.status ?? '',
    event.start?.dateTime ?? event.start?.date ?? '',
    event.end?.dateTime ?? event.end?.date ?? '',
    event.recurringEventId ?? '',
    event.recurrence?.length ? 'r' : '',
  ].join('|')
  return `f:${createHash('sha256').update(material).digest('hex').slice(0, 32)}`
}

export function eventShape(event: calendar_v3.Schema$Event): EventShape {
  if (event.recurrence?.length) return 'recurring_master'
  if (event.recurringEventId) return 'recurring_instance'
  if (event.start?.date && !event.start.dateTime) return 'all_day'
  if (event.status === 'cancelled') return 'timed_single' // לאירוע מחוק אין זמנים, וזה תקין
  if (!event.start?.dateTime || !event.end?.dateTime) return 'malformed'
  return 'timed_single'
}

function eventStatus(event: calendar_v3.Schema$Event): EventStatus {
  return event.status === 'cancelled' ? 'cancelled'
    : event.status === 'tentative' ? 'tentative'
    : 'confirmed'
}

interface OwnershipVerdict {
  ownership: EventOwnership
  appointmentId: string | null
}

/**
 * האם לאירוע יש *סימן כלשהו* לבעלות מערכת. אירוע שאין בו אף סימן הוא
 * אירוע ידני של שובל — נזרק לפני שמירה, ולא נשמר עליו שום מידע.
 *
 * ⚠️ כותרת האירוע, שם הלקוחה, טלפון בתיאור ותאריך/שעה אינם סימני בעלות
 * ואינם נבדקים כאן בכלל. אירוע ידני שכותרתו מזכירה את שם העסק נשאר ידני.
 */
function ownershipOf(event: calendar_v3.Schema$Event, storedIds: Map<string, string[]>): OwnershipVerdict | null {
  const props = event.extendedProperties?.private
  const hasSourceMark = props?.source === CALENDAR_EVENT_SOURCE
  const propsId = typeof props?.appointment_id === 'string' ? props.appointment_id : null
  const detId = event.id ? appointmentIdFromDeterministicEventId(event.id) : null
  const stored = event.id ? storedIds.get(event.id) : undefined

  // אירוע ידני טהור: אין source, אין מזהה דטרמיניסטי, ואינו מוכר לנו מה-DB.
  if (!hasSourceMark && !detId && !stored) return null

  // ── מכאן והלאה יש סימן בעלות, ולכן האירוע *תמיד* נשמר בעמידות ──────────
  // גם כשהוא פגום. שינוי חשוד שנזרק לפני קידום ה-cursor הוא שינוי אבוד:
  // Google לא יחזיר אותו שוב לעולם.

  if (stored && stored.length > 1) {
    // אותו מזהה אירוע רשום על יותר מ-appointment אחד — לא נבחר אחד מהם.
    return { ownership: 'ambiguous', appointmentId: null }
  }

  if (hasSourceMark) {
    if (!propsId || !UUID_RE.test(propsId)) {
      // source שלנו אבל appointment_id פגום — לא מנחשים.
      return { ownership: 'ambiguous', appointmentId: null }
    }
    if (detId && detId !== propsId) {
      // שני מקורות בעלות שסותרים זה את זה.
      return { ownership: 'ambiguous', appointmentId: null }
    }
    if (stored && stored.length === 1 && stored[0] !== propsId) {
      return { ownership: 'ambiguous', appointmentId: null }
    }
    return { ownership: 'extended_properties', appointmentId: propsId }
  }

  if (detId) {
    if (stored && stored.length === 1 && stored[0] !== detId) {
      return { ownership: 'ambiguous', appointmentId: null }
    }
    // extendedProperties חסרים אבל המזהה נגזר מ-UUID. זה *אינו* הופך אותו
    // לאירוע ידני — הקישור ל-appointment נבדק בעיבוד.
    return { ownership: 'deterministic_id', appointmentId: detId }
  }

  return { ownership: 'stored_event_id', appointmentId: stored![0] }
}

/**
 * מסווגת עמוד אירועים. storedIds ממפה google_event_id → רשימת appointment ids
 * שמצביעים עליו (רשימה, כדי שכפילות תזוהה ולא תיבחר באקראי).
 *
 * מחזירה *רק* אירועים שיש בהם סימן בעלות. השאר נזרקים כאן ולא נשמרים בשום
 * מקום — הם ממשיכים לחסום זמינות דרך getBusyRanges כפי שעשו תמיד.
 */
export function classifyEvents(
  events: calendar_v3.Schema$Event[],
  storedIds: Map<string, string[]>,
): { records: CalendarChangeRecord[]; skippedManual: number } {
  const records: CalendarChangeRecord[] = []
  let skippedManual = 0

  for (const event of events) {
    if (!event.id) { skippedManual++; continue }

    const verdict = ownershipOf(event, storedIds)
    if (!verdict) { skippedManual++; continue }

    records.push({
      google_event_id: event.id,
      event_version: eventVersion(event),
      ownership: verdict.ownership,
      event_shape: eventShape(event),
      appointment_id: verdict.appointmentId,
      event_status: eventStatus(event),
      event_start: event.start?.dateTime ?? null,
      event_end: event.end?.dateTime ?? null,
      event_updated: event.updated ?? null,
    })
  }

  return { records, skippedManual }
}

// ============================================================================
// הבאת עמוד
// ============================================================================

export interface ChangesPage {
  events: calendar_v3.Schema$Event[]
  nextPageToken: string | null
  nextSyncToken: string | null
}

export interface CalendarChangesClient {
  listChanges(params: ListChangesParams): Promise<ChangesPage>
}

/** ה-client האמיתי. מוזרק כדי שהבדיקות יוכלו לבחון את אובייקט הבקשה עצמו. */
export function createCalendarChangesClient(): CalendarChangesClient {
  return {
    async listChanges(params) {
      const auth = new google.auth.GoogleAuth({
        credentials: getCredentials(),
        scopes: ['https://www.googleapis.com/auth/calendar'],
      })
      const calendar = google.calendar({ version: 'v3', auth })
      const res = await calendar.events.list(params)
      return {
        events: res.data.items ?? [],
        nextPageToken: res.data.nextPageToken ?? null,
        nextSyncToken: res.data.nextSyncToken ?? null,
      }
    },
  }
}

function getCredentials() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
  if (b64) return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (raw) return JSON.parse(raw)
  throw new Error('Neither GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 nor GOOGLE_SERVICE_ACCOUNT_KEY is set')
}

export function getSyncCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID
  if (!id) throw new Error('GOOGLE_CALENDAR_ID is not set')
  return id
}

/**
 * טביעת האצבע של היומן המחובר. syncToken שייך ליומן מסוים; אם היומן
 * יוחלף, שליחת הטוקן הישן ליומן החדש היא התנהגות לא מוגדרת. נשמר כ-hash
 * ולא כמזהה עצמו, כדי שגם תצוגת ניהול או דליפת שורה לא יחשפו אותו.
 */
export function calendarFingerprint(calendarId: string): string {
  return createHash('sha256').update(calendarId).digest('hex')
}
