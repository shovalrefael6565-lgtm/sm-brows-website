/**
 * TEMPORARY DEBUG ROUTE — remove after confirming calendar sync works.
 * GET /api/debug/calendar
 * Shows: server time, Israel time, calendar ID, service account email,
 *        raw events + normalized times (AM/PM correction applied).
 */
import { NextResponse } from 'next/server'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BUSINESS_START = 10
const BUSINESS_END   = 19
const TWELVE_H       = 12 * 60 * 60 * 1000

function fmtIsrael(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const h = (parts.find(p => p.type === 'hour')?.value   ?? '00').padStart(2, '0')
  const m = (parts.find(p => p.type === 'minute')?.value ?? '00').padStart(2, '0')
  return `${h}:${m}`
}

function israelTimeStr(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date())
}

function normalizeAmPm(startDate: Date, endDate: Date): { start: Date; end: Date } | null {
  const s = fmtIsrael(startDate)
  const h = parseInt(s.slice(0, 2), 10)
  if (h >= BUSINESS_START && h < BUSINESS_END) return { start: startDate, end: endDate }
  const hMinus = h - 12
  if (hMinus >= BUSINESS_START && hMinus < BUSINESS_END)
    return { start: new Date(startDate.getTime() - TWELVE_H), end: new Date(endDate.getTime() - TWELVE_H) }
  const hPlus = h + 12
  if (hPlus >= BUSINESS_START && hPlus < BUSINESS_END)
    return { start: new Date(startDate.getTime() + TWELVE_H), end: new Date(endDate.getTime() + TWELVE_H) }
  return null
}

export async function GET() {
  const now        = new Date()
  const calendarId = process.env.GOOGLE_CALENDAR_ID ?? null
  const b64Key     = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 ?? null
  const rawKey     = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? null
  const keySource  = b64Key ? 'GOOGLE_SERVICE_ACCOUNT_KEY_BASE64' : rawKey ? 'GOOGLE_SERVICE_ACCOUNT_KEY' : '(not set)'

  let serviceAccountEmail = '(key not set)'
  let credentials: Record<string, unknown> | null = null
  if (b64Key) {
    try {
      credentials = JSON.parse(Buffer.from(b64Key, 'base64').toString('utf8'))
      serviceAccountEmail = (credentials?.client_email as string) ?? '(client_email missing)'
    } catch { serviceAccountEmail = '(base64 decode / JSON parse error)' }
  } else if (rawKey) {
    try {
      credentials = JSON.parse(rawKey)
      serviceAccountEmail = (credentials?.client_email as string) ?? '(client_email missing)'
    } catch { serviceAccountEmail = '(GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON)' }
  }

  const base = {
    utcTime: now.toISOString(),
    israelTime: israelTimeStr(),
    calendarId: calendarId ?? '(GOOGLE_CALENDAR_ID not set)',
    keySource,
    serviceAccountEmail,
  }

  if (!calendarId || !credentials) {
    return NextResponse.json(
      { ...base, error: 'Missing or invalid env vars.', events: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    })
    const calendar = google.calendar({ version: 'v3', auth })

    const timeMin = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()  // 3 h back (cover today)
    const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const res = await calendar.events.list({
      calendarId, timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 50,
    })

    const events = (res.data.items ?? []).map(e => {
      const rawStart = e.start?.dateTime ?? null
      const rawEnd   = e.end?.dateTime   ?? null
      const israelRawStart = rawStart ? fmtIsrael(new Date(rawStart)) : null
      const israelRawEnd   = rawEnd   ? fmtIsrael(new Date(rawEnd))   : null

      let normalized: { israelStart: string; israelEnd: string; corrected: boolean } | null = null
      if (rawStart && rawEnd) {
        const result = normalizeAmPm(new Date(rawStart), new Date(rawEnd))
        if (result) {
          normalized = {
            israelStart: fmtIsrael(result.start),
            israelEnd:   fmtIsrael(result.end),
            corrected:   fmtIsrael(result.start) !== israelRawStart,
          }
        }
      }

      return {
        summary:         e.summary ?? '(no title)',
        rawStart,
        rawEnd,
        israelRawStart,
        israelRawEnd,
        normalized,
        blocksSlot:      normalized?.israelStart ?? null,
        status:          e.status,
      }
    })

    return NextResponse.json(
      { ...base, fetchedAt: now.toISOString(), eventCount: events.length, events },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const code    = (err as { code?: number }).code
    return NextResponse.json(
      {
        ...base, error: message, errorCode: code ?? null,
        hint: code === 403 ? 'Calendar not shared with service account.'
            : code === 404 ? 'Calendar not found — check GOOGLE_CALENDAR_ID.'
            : 'Check env vars.',
        events: [],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
