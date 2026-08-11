import { STUDIO_DETAILS } from '@/lib/whatsappTemplates'

/**
 * שלב 15H — "הוספה ליומן" עבור הלקוחה.
 *
 * ═══ 🔒 מה מותר להיכנס לאירוע, ומה אסור ═══
 *
 * הקובץ הזה מייצר תוכן ש**יוצא מהשליטה שלנו ברגע שהוא נשמר**: קובץ .ics
 * יורד למכשיר ומסונכרן לענן של הלקוחה, וקישור Google נפתח בחשבון Google
 * שלה. לכן נכנס לכאן רק מה שממילא מופיע באתר הפומבי:
 *
 *   ✅ סוג הטיפול · תאריך · שעה · משך · כתובת הסטודיו · קישור לאזור האישי
 *
 *   🔴 **`building_entry_code` לעולם לא.** קוד הכניסה לבניין הוא ערך פרטי
 *      שנחסם מפני anon ב-0026 ומופיע אך ורק בהודעת SMS מאושרת ללקוחה
 *      שהתור שלה אושר. הזרמתו לקובץ יומן הייתה עוקפת את כל ההגנה הזו.
 *
 *   🔴 טלפון הלקוחה, מחיר, מקדמה, הערות CRM, מזהי Google — אף אחד מהם
 *      אינו נחוץ כדי להגיע לתור.
 *
 * ⚠️ אין כאן ORGANIZER ואין ATTENDEE, בכוונה. שדות אלה הופכים את הקובץ
 * מ"אירוע להוספה ליומן" ל"הזמנה שממתינה לתשובה", ואז לקוחות דוא"ל מציגים
 * ללקוחה כפתורי אישור/דחייה שאין להם שום משמעות במערכת שלנו — ומייצרים
 * תשובות RSVP לכתובת שאיש אינו קורא.
 *
 * 🔒 הקובץ נקי מ-DB ומ-'server-only': הוא מקבל ערכים ומחזיר מחרוזות, וזה
 * מה שמאפשר לבדוק אותו ישירות.
 */

export interface CalendarEventInput {
  /** מזהה התור — מייצר UID יציב, כך שהורדה חוזרת מעדכנת ולא מכפילה */
  appointmentId: string
  /** שם הטיפול כפי שהוא מוצג ללקוחה */
  treatment: string
  /** תחילת התור, ISO מלא עם אזור זמן (העמודה starts_at) */
  startsAt: string
  durationMin: number
}

/** בסיס ה-URL של האתר, לקישור לאזור האישי בתוך גוף האירוע. */
const SITE_URL = 'https://smbrows.co.il'

function eventTitle(treatment: string): string {
  return `S.M BROWS — ${treatment}`
}

function eventDescription(treatment: string, durationMin: number): string {
  return [
    `${treatment} · ${durationMin} דק׳`,
    STUDIO_DETAILS.addressNote,
    `לצפייה בתור, שינוי מועד או ביטול: ${SITE_URL}/account`,
  ].join('\n')
}

/**
 * רגע בזמן → הצורה שגם ICS וגם Google מצפים לה: UTC בסיסי, `YYYYMMDDTHHMMSSZ`.
 *
 * ⚠️ UTC ולא זמן מקומי עם VTIMEZONE. תור בישראל שנשמר כ-UTC מוצג נכון בכל
 * לקוח יומן ובכל אזור זמן, בלי שנצטרך לשלוח הגדרת אזור זמן משלנו — וכל
 * שגיאה בהגדרה כזו הייתה מזיזה את התור של הלקוחה בשעה.
 */
export function toCalendarStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

function endOf(startsAt: string, durationMin: number): Date {
  return new Date(new Date(startsAt).getTime() + durationMin * 60 * 1000)
}

/**
 * בריחה של ערך טקסט לפי RFC 5545 §3.3.11.
 *
 * ⚠️ הסדר קריטי: הבקסלאש **ראשון**. אילו הוחלף אחרי הפסיק, הבקסלאש שנוסף
 * זה עתה ע"י בריחת הפסיק היה עובר בריחה בעצמו ומייצר `\\,` — כלומר
 * בקסלאש מילולי ואחריו מפריד שדות, שמפרק את השורה.
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * קיפול שורות ל-75 אוקטטים לפי RFC 5545 §3.1.
 *
 * ⚠️ אוקטטים, לא תווים. כל אות עברית היא שני בייטים ב-UTF-8, וספירת תווים
 * הייתה מייצרת שורות ארוכות מדי — שלקוחות יומן קפדניים דוחים.
 *
 * ⚠️ הקיפול לעולם אינו חוצה תו: הוא נעשה ברמת נקודות קוד, ולכן אין סיכוי
 * לשבור סימן עברי לשני בייטים בשתי שורות שונות.
 */
function foldLine(line: string): string {
  const MAX_OCTETS = 75
  const encoder = new TextEncoder()

  const chunks: string[] = []
  let current = ''
  let currentOctets = 0
  // השורה השנייה ואילך מתחילה ברווח, שנספר גם הוא במכסה.
  let limit = MAX_OCTETS

  for (const char of line) {
    const size = encoder.encode(char).length
    if (currentOctets + size > limit) {
      chunks.push(current)
      current = ''
      currentOctets = 0
      limit = MAX_OCTETS - 1
    }
    current += char
    currentOctets += size
  }
  chunks.push(current)

  return chunks.join('\r\n ')
}

/**
 * קובץ .ics לאירוע בודד — למסלול Apple/iPhone וכל לקוח יומן אחר.
 *
 * ⚠️ UID יציב שנגזר מ-appointment.id: הורדה חוזרת של אותו תור מעדכנת את
 * האירוע הקיים במקום ליצור שני עותקים ביומן הלקוחה. אותו עיקרון בדיוק
 * שעליו נשען deterministicEventId בצד שלנו.
 *
 * ⚠️ שורות מופרדות ב-CRLF. זו דרישת התקן, ולא כל לקוח סלחן כלפי \n בלבד.
 */
export function buildIcs(input: CalendarEventInput, now: Date = new Date()): string {
  const start = new Date(input.startsAt)
  const end = endOf(input.startsAt, input.durationMin)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//S.M BROWS//Appointments//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:smbappt${input.appointmentId.replace(/-/g, '')}@smbrows.co.il`,
    `DTSTAMP:${toCalendarStamp(now)}`,
    `DTSTART:${toCalendarStamp(start)}`,
    `DTEND:${toCalendarStamp(end)}`,
    `SUMMARY:${escapeIcsText(eventTitle(input.treatment))}`,
    `DESCRIPTION:${escapeIcsText(eventDescription(input.treatment, input.durationMin))}`,
    `LOCATION:${escapeIcsText(STUDIO_DETAILS.address)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/**
 * קישור "הוספה ליומן Google".
 *
 * ⚠️ זהו קישור טופס מוכן ולא כתיבה ליומן: Google פותח מסך יצירת אירוע
 * מלא מראש, והלקוחה היא זו שלוחצת "שמירה". אנחנו לא מבקשים הרשאה ליומן
 * שלה, לא מקבלים טוקן ולא נוגעים בחשבונה.
 */
export function buildGoogleCalendarUrl(input: CalendarEventInput): string {
  const start = new Date(input.startsAt)
  const end = endOf(input.startsAt, input.durationMin)

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitle(input.treatment),
    dates: `${toCalendarStamp(start)}/${toCalendarStamp(end)}`,
    details: eventDescription(input.treatment, input.durationMin),
    location: STUDIO_DETAILS.address,
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
