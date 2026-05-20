import { google } from 'googleapis'

const BUSINESS_START = 10  // 10:00 Israel time
const BUSINESS_END   = 19  // 19:00 Israel time

/** Format a UTC Date as HH:MM in Israel timezone (Asia/Jerusalem) */
function fmtIsrael(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = (parts.find(p => p.type === 'hour')?.value  ?? '00').padStart(2, '0')
  const m = (parts.find(p => p.type === 'minute')?.value ?? '00').padStart(2, '0')
  return `${h}:${m}`
}

/** Returns true if a HH:MM Israel-time string falls within business hours */
function inBusinessHours(timeStr: string): boolean {
  const h = parseInt(timeStr.slice(0, 2), 10)
  return h >= BUSINESS_START && h < BUSINESS_END
}

/**
 * Handle AM/PM calendar mistakes: if an event start falls outside business hours,
 * shift it ±12 hours to see if that lands inside business hours.
 * Example: event at 22:00 Israel → shift -12h → 10:00 Israel (valid).
 * Both start and end are shifted by the same offset so duration is preserved.
 * Returns null if neither shift puts the event inside business hours (genuine off-hours event).
 */
function normalizeAmPm(
  startDate: Date,
  endDate: Date
): { start: Date; end: Date } | null {
  const startStr = fmtIsrael(startDate)
  if (inBusinessHours(startStr)) return { start: startDate, end: endDate }

  const h = parseInt(startStr.slice(0, 2), 10)
  const TWELVE_H = 12 * 60 * 60 * 1000

  // Try PM → AM (subtract 12 h)
  const hMinus = h - 12
  if (hMinus >= BUSINESS_START && hMinus < BUSINESS_END) {
    return {
      start: new Date(startDate.getTime() - TWELVE_H),
      end:   new Date(endDate.getTime()   - TWELVE_H),
    }
  }

  // Try AM → PM (add 12 h)
  const hPlus = h + 12
  if (hPlus >= BUSINESS_START && hPlus < BUSINESS_END) {
    return {
      start: new Date(startDate.getTime() + TWELVE_H),
      end:   new Date(endDate.getTime()   + TWELVE_H),
    }
  }

  return null  // genuinely outside business hours — ignore
}

const SERVICE_DURATIONS: Record<string, number> = {
  'עיצוב גבות טבעי': 20,
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
 * Build query bounds for a calendar date.
 * We query a 30-hour window (21:00 UTC day-before to 03:00 UTC day-after)
 * to fully cover the Israel day regardless of DST (UTC+2 / UTC+3).
 * Business-hour filtering ensures only relevant events survive.
 */
function dayBounds(date: string): { timeMin: string; timeMax: string } {
  const base = new Date(`${date}T00:00:00Z`)
  const timeMin = new Date(base.getTime() - 3 * 60 * 60 * 1000)  // 21:00 UTC prev day
  const timeMax = new Date(base.getTime() + 27 * 60 * 60 * 1000) // 03:00 UTC next day
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() }
}

/** Returns busy time ranges (HH:MM start/end in Israel time) for a given date */
export async function getBusyRanges(date: string): Promise<{ start: string; end: string }[]> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()
  const { timeMin, timeMax } = dayBounds(date)

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
    const startStr = event.start?.dateTime
    const endStr   = event.end?.dateTime
    if (!startStr || !endStr) continue  // skip all-day events

    const normalized = normalizeAmPm(new Date(startStr), new Date(endStr))
    if (!normalized) continue  // outside business hours even after ±12h — ignore

    ranges.push({
      start: fmtIsrael(normalized.start),
      end:   fmtIsrael(normalized.end),
    })
  }

  return ranges
}

/** Returns the list of start times (HH:MM in Israel time) already booked on a given date */
export async function getTakenSlots(date: string): Promise<string[]> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()
  const { timeMin, timeMax } = dayBounds(date)

  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  })

  const events = res.data.items ?? []
  const taken: string[] = []

  for (const event of events) {
    const startStr = event.start?.dateTime
    const endStr   = event.end?.dateTime
    if (!startStr) continue

    const endDate = endStr ? new Date(endStr) : new Date(new Date(startStr).getTime() + 60 * 60 * 1000)
    const normalized = normalizeAmPm(new Date(startStr), endDate)
    if (!normalized) continue

    taken.push(fmtIsrael(normalized.start))
  }

  return taken
}

/** Creates a calendar event for a new booking */
export async function createBookingEvent(params: {
  name: string
  phone: string
  service: string
  date: string   // e.g. "16 מאי 2026"
  time: string   // e.g. "10:20"
  notes?: string
}) {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  const isoDate = parseHebrewDate(params.date)
  const durationMinutes = SERVICE_DURATIONS[params.service] ?? 60

  const startDate = new Date(`${isoDate}T${params.time}:00`)
  const endDate   = new Date(startDate.getTime() + durationMinutes * 60 * 1000)

  const description = [
    `📞 טלפון: ${params.phone}`,
    params.notes ? `📝 הערות: ${params.notes}` : '',
  ].filter(Boolean).join('\n')

  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `🌸 ${params.service} — ${params.name}`,
      description,
      start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Jerusalem' },
      end:   { dateTime: endDate.toISOString(),   timeZone: 'Asia/Jerusalem' },
    },
  })
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
