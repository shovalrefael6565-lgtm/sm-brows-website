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

const SERVICE_DURATIONS: Record<string, number> = {
  'עיצוב גבות טבעי': 20,
  'הרמת גבות': 45,
  'קורס מקצועי': 60,
  'מיקרובליידינג': 150,
}

function getAuth() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!key) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set')
  const credentials = JSON.parse(key)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
}

function getCalendarId() {
  const id = process.env.GOOGLE_CALENDAR_ID
  if (!id) throw new Error('GOOGLE_CALENDAR_ID is not set')
  return id
}

/** Returns busy time ranges (HH:MM start/end in Israel time) for a given date — business hours only */
export async function getBusyRanges(date: string): Promise<{ start: string; end: string }[]> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  // Use explicit UTC bounds to avoid server-timezone ambiguity
  const dayStart = new Date(`${date}T00:00:00Z`)
  const dayEnd   = new Date(`${date}T23:59:59Z`)

  const res = await calendar.events.list({
    calendarId,
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  const events = res.data.items ?? []
  const ranges: { start: string; end: string }[] = []

  for (const event of events) {
    const startStr = event.start?.dateTime
    const endStr   = event.end?.dateTime
    if (!startStr || !endStr) continue // ignore all-day events

    const start = fmtIsrael(new Date(startStr))
    const end   = fmtIsrael(new Date(endStr))

    // Skip events outside business hours (catches AM/PM mistakes)
    if (!inBusinessHours(start)) continue

    ranges.push({ start, end })
  }

  return ranges
}

/** Returns the list of start times (HH:MM in Israel time) already booked on a given date (YYYY-MM-DD) */
export async function getTakenSlots(date: string): Promise<string[]> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  const dayStart = new Date(`${date}T00:00:00Z`)
  const dayEnd   = new Date(`${date}T23:59:59Z`)

  const res = await calendar.events.list({
    calendarId,
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  const events = res.data.items ?? []
  const taken: string[] = []

  for (const event of events) {
    const start = event.start?.dateTime
    if (!start) continue
    const timeStr = fmtIsrael(new Date(start))
    if (!inBusinessHours(timeStr)) continue
    taken.push(timeStr)
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

  // Parse the Hebrew date string back to ISO
  const isoDate = parseHebrewDate(params.date)
  const [hours, minutes] = params.time.split(':').map(Number)

  const startDate = new Date(`${isoDate}T${params.time}:00`)
  const durationMinutes = SERVICE_DURATIONS[params.service] ?? 60
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000)

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
      end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Jerusalem' },
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
