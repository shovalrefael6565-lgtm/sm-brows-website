/**
 * חשבון אזור זמן ישראל — מקור אמת יחיד.
 *
 * משמש גם את Google Calendar (lib/googleCalendar.ts) וגם את קביעת התורים
 * ב-DB (lib/db/appointments.ts), כדי ששני הצדדים יחשבו תאריך/שעה בדיוק
 * באותה שיטה. שרתי Vercel רצים ב-UTC ללא קשר לאזור הזמן של הלקוחה או
 * העסק — כל הפונקציות כאן מתעלמות מאזור הזמן של השרת ומחשבות מול
 * Asia/Jerusalem במפורש, כולל שעון קיץ/חורף.
 */

export const BUSINESS_START_MIN = 9 * 60   // 09:00
export const BUSINESS_END_MIN   = 19 * 60  // 19:00
export const DAY_MIN = 24 * 60

/** Format a UTC Date as HH:MM in Israel timezone */
export function fmtIsrael(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = (parts.find(p => p.type === 'hour')?.value ?? '00').padStart(2, '0')
  const m = (parts.find(p => p.type === 'minute')?.value ?? '00').padStart(2, '0')
  return `${h}:${m}`
}

/** The YYYY-MM-DD calendar date of an instant, in Israel time */
export function israelDateStr(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Minutes from Israel midnight (00:00 → 0, 09:30 → 570) */
export function israelMinutes(d: Date): number {
  const s = fmtIsrael(d)
  return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10)
}

export function minToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Query bounds for a calendar date — a 30-hour window (21:00 UTC day-before
 * to 03:00 UTC day-after) that fully covers the Israel day regardless of DST.
 */
export function dayBoundsUtc(isoDate: string): { timeMin: string; timeMax: string } {
  const base = new Date(`${isoDate}T00:00:00Z`)
  const timeMin = new Date(base.getTime() - 3 * 60 * 60 * 1000)
  const timeMax = new Date(base.getTime() + 27 * 60 * 60 * 1000)
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() }
}

/**
 * ממיר שעון קיר ישראלי (למשל "2026-08-24" + "17:00", כפי שרואים על השעון
 * באשקלון) לרגע UTC מדויק — בלי תלות באזור הזמן של השרת ובלי תלות בשעון
 * קיץ/חורף.
 *
 * שיטת "ההמרה הכפולה": מנחשים שהשעון הקיר הוא UTC, בודקים מה השעון
 * בישראל היה מראה ברגע הזה בפועל, ומתקנים לפי ההפרש. הפרש האזור לא
 * משתנה בטווח כזה קצר (בטח לא סביב אותו יום), ולכן תיקון יחיד מספיק.
 */
export function israelWallTimeToUtc(isoDate: string, hhmm: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  const [hour, minute] = hhmm.split(':').map(Number)

  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(guess)
  const get = (t: string) => parseInt(parts.find(p => p.type === t)!.value, 10)
  let h = get('hour')
  if (h === 24) h = 0 // חלק ממימושי ה-Intl מחזירים 24:00 במקום 00:00

  const shownAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), h, get('minute'), 0)
  return new Date(guess.getTime() + (guess.getTime() - shownAsUtc))
}
