import { google } from 'googleapis'

const BUSINESS_START = 9   // 09:00 Israel time (בוקר)
const BUSINESS_END   = 19  // 19:00 Israel time (ערב)
const BUSINESS_START_MIN = BUSINESS_START * 60 // 540
const BUSINESS_END_MIN   = BUSINESS_END * 60   // 1140
const DAY_MIN = 24 * 60

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

/** The YYYY-MM-DD calendar date of an instant, in Israel time */
function israelDateStr(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Minutes from Israel midnight (00:00 → 0, 09:30 → 570) */
function israelMinutes(d: Date): number {
  const s = fmtIsrael(d)
  return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10)
}

function minToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

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
 * Build query bounds for a calendar date.
 * We query a 30-hour window (21:00 UTC day-before to 03:00 UTC day-after)
 * to fully cover the Israel day regardless of DST (UTC+2 / UTC+3).
 */
function dayBounds(date: string): { timeMin: string; timeMax: string } {
  const base = new Date(`${date}T00:00:00Z`)
  const timeMin = new Date(base.getTime() - 3 * 60 * 60 * 1000)  // 21:00 UTC prev day
  const timeMax = new Date(base.getTime() + 27 * 60 * 60 * 1000) // 03:00 UTC next day
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() }
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
