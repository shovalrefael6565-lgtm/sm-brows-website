import { google } from 'googleapis'

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

/** Returns the list of start times (HH:MM) already booked on a given date (YYYY-MM-DD) */
export async function getTakenSlots(date: string): Promise<string[]> {
  const auth = getAuth()
  const calendar = google.calendar({ version: 'v3', auth })
  const calendarId = getCalendarId()

  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(`${date}T23:59:59`)

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
    const d = new Date(start)
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    taken.push(`${hh}:${mm}`)
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
