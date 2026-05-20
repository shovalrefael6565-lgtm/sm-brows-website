/**
 * TEMPORARY DEBUG ROUTE — remove after confirming calendar sync works.
 * GET /api/debug/calendar
 * Returns: server time, Israel time, calendar ID, service account email, raw events for next 7 days.
 */
import { NextResponse } from 'next/server'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function israelTimeStr(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date())
}

export async function GET() {
  const now = new Date()
  const calendarId = process.env.GOOGLE_CALENDAR_ID ?? null
  const b64Key     = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 ?? null
  const rawKey     = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? null
  const hasKey     = !!(b64Key || rawKey)
  const keySource  = b64Key ? 'GOOGLE_SERVICE_ACCOUNT_KEY_BASE64' : rawKey ? 'GOOGLE_SERVICE_ACCOUNT_KEY' : '(not set)'

  let serviceAccountEmail: string = '(key not set)'
  let credentials: Record<string, unknown> | null = null
  if (b64Key) {
    try {
      credentials = JSON.parse(Buffer.from(b64Key, 'base64').toString('utf8'))
      serviceAccountEmail = (credentials?.client_email as string) ?? '(client_email missing)'
    } catch {
      serviceAccountEmail = '(base64 decode / JSON parse error)'
    }
  } else if (rawKey) {
    try {
      credentials = JSON.parse(rawKey)
      serviceAccountEmail = (credentials?.client_email as string) ?? '(client_email missing)'
    } catch {
      serviceAccountEmail = '(GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON)'
    }
  }

  const base = {
    utcTime:             now.toISOString(),
    israelTime:          israelTimeStr(),
    calendarId:          calendarId ?? '(GOOGLE_CALENDAR_ID not set)',
    keySource,
    serviceAccountEmail,
    instruction:         `Share the calendar "${calendarId}" with the service account email above (Editor or Reader role) in Google Calendar settings.`,
  }

  if (!calendarId || !hasKey || !credentials) {
    return NextResponse.json(
      { ...base, error: 'One or more required env vars are missing or invalid.', events: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    })
    const calendar = google.calendar({ version: 'v3', auth })

    const timeMin = now.toISOString()
    const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    })

    const rawEvents = res.data.items ?? []
    const events = rawEvents.map(e => ({
      id:      e.id,
      summary: e.summary ?? '(no title)',
      start:   e.start?.dateTime ?? e.start?.date ?? null,
      end:     e.end?.dateTime   ?? e.end?.date   ?? null,
      status:  e.status,
    }))

    return NextResponse.json(
      {
        ...base,
        fetchedAt:  now.toISOString(),
        eventCount: events.length,
        events,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const code    = (err as { code?: number }).code
    return NextResponse.json(
      {
        ...base,
        error:     message,
        errorCode: code ?? null,
        hint:      code === 403
          ? 'Calendar not shared with service account. Share the calendar with the email above.'
          : code === 404
          ? 'Calendar not found — check GOOGLE_CALENDAR_ID in Vercel env vars.'
          : 'Check GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_CALENDAR_ID in Vercel env vars.',
        events: [],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
