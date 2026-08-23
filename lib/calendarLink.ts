/**
 * זהות הקישור בין תור לאירוע ביומן — מודול **טהור**: בלי googleapis, בלי
 * רשת ובלי server-only. לכן אפשר לייבא אותו גם מ-server component, גם
 * מבדיקה, וגם מקוד שרץ בדפדפן.
 *
 * ─── למה הופרד מ-lib/googleCalendar.ts ─────────────────────────────────────
 *
 * שם יושב מנוע ה-API עצמו (googleapis, credentials, רשת). ההבחנה "האם
 * האירוע הזה נוצר על ידינו או אומץ מיומן שובל" היא שאלה על **מחרוזת**, ולא
 * על היומן — ורשימת התורים באדמין צריכה לענות עליה על כל שורה, בלי לגעת
 * ב-Google. googleCalendar.ts מייצא מחדש את הפונקציות האלה, ולכן שום
 * import קיים לא השתנה.
 */

export const CALENDAR_EVENT_SOURCE = 'sm_brows_website'

/**
 * Google Calendar event IDs must be lowercase, match [a-v0-9]{5,1024}.
 * UUID hex digits (0-9a-f) are already a subset of that range, so a prefix +
 * the UUID without hyphens is always valid — and always the same for the
 * same appointment, which is the whole point.
 *
 * ⚠️ The prefix itself must also stay inside a-v — no w/x/y/z. "smbappt"
 * was chosen specifically to avoid the 'w' in "smbrows" (w=23rd letter,
 * outside a-v which stops at v=22), which Google rejected outright.
 */
export function deterministicEventId(appointmentId: string): string {
  return `smbappt${appointmentId.replace(/-/g, '')}`
}

const DETERMINISTIC_EVENT_ID_RE = /^smbappt([0-9a-f]{32})$/

/**
 * ההיפוך של deterministicEventId — מזהה אירוע → appointment UUID, או null
 * אם הוא אינו בצורה הזו כלל.
 *
 * ⚠️ ההחזרה אינה הוכחה שה-appointment קיים, רק שהמזהה *נגזר* מ-UUID.
 * הקישור בפועל נבדק מול ה-DB (שלב 8, סיווג בעלות בסנכרון הנכנס).
 */
export function appointmentIdFromDeterministicEventId(eventId: string): string | null {
  const m = DETERMINISTIC_EVENT_ID_RE.exec(eventId)
  if (!m) return null
  const h = m[1]
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * 🔒 15I — האם המועד של התור **נעול לפי Google**.
 *
 * ─── ההבחנה, ולמה היא נגזרת ולא עמודה חדשה ────────────────────────────────
 *
 * לתור שהמערכת יצרה ביומן יש תמיד את המזהה הדטרמיניסטי שלה — הוא נגזר
 * מ-appointment.id ואי אפשר לקבל אותו בשום דרך אחרת. מזהה **אחר** יכול
 * להגיע רק ממקום אחד: אירוע ששובל יצרה ביומן בעצמה ושאומץ לתור.
 *
 * ולכן: `google_event_id` שאינו הדטרמיניסטי ⟺ המועד נקבע ביומן ולא באתר.
 * אין צורך בעמודה חדשה, אין מיגרציה, ואין מצב שבו התשובה נכונה בטבלה אחת
 * ושגויה באחרת — היא נגזרת מאותו שדה יחיד שכבר קובע מול איזה אירוע
 * המערכת עובדת.
 *
 * מרגע שהתשובה true: תאריך, שעת התחלה, שעת סיום ומשך **אינם ניתנים
 * לעריכה באתר**. שינוי מועד מתחיל ביומן Google ומגיע למערכת דרך הסנכרון
 * הנכנס (שלב 8), ולא הפוך.
 */
export function isGoogleTimeLocked(
  appointmentId: string,
  googleEventId: string | null | undefined,
): boolean {
  if (!googleEventId) return false
  return googleEventId !== deterministicEventId(appointmentId)
}
