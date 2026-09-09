/**
 * חלון הזמינות (טווח ההזמנה) ורשת הסלוטים — עותק בצד השרת של אותם
 * כללים בדיוק כפי שממומשים ב-components/booking/BookingForm.tsx, כדי
 * שאפשר יהיה לאמת בקשת תור מול השרת ולא רק מול מה שהוצג בדפדפן.
 *
 * ⚠️ שינוי ברשת הסלוטים או בחלון הזמינות ב-BookingForm.tsx חייב להתעדכן
 * גם כאן — אחרת השרת ידחה (או יאשר בטעות) בקשות שהלקוחה כן יכולה לראות
 * באתר.
 *
 * חשוב: הכלים כאן בודקים "האם הסלוט חוקי באופן עקרוני" (יום פתוח, שעה
 * ברשת) — לא "האם הוא פנוי כרגע". הבדיקה הזו נעשית בנפרד (Google Calendar
 * + ה-EXCLUDE constraint ב-DB), כי היא חייבת להיבדק שוב בכל בקשה.
 *
 * שים לב גם: האלגוריתם שקובע אילו סלוטים "להציג" ללקוחה (slotsForOffset,
 * הערבוב המבוסס-זרע וכו' ב-BookingForm) הוא עיצוב חוויית משתמש בלבד —
 * יצירת מחסור מדומה, לא כלל עסקי אמיתי. השרת לא משחזר אותו: כל סלוט
 * שקיים ברשת האמיתית ופנוי בפועל קביל, גם אם הוא לא נבחר להצגה לאותה
 * לקוחה באותו רינדור.
 */

import { isSpecialDay, specialSlotsFor, SLOT_INTERVAL_MINUTES } from './specialAvailability'

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** ה-Y/M/D (M הוא 0-based, כמו ב-Date) של "עכשיו" לפי שעון ישראל */
export function israelTodayYMD(now: Date = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now)
  const get = (t: string) => parseInt(parts.find(p => p.type === t)!.value, 10)
  return { y: get('year'), m: get('month') - 1, d: get('day') }
}

/** מספר ימי עסקים מהיום (ישראל) עד התאריך היעד, פוסח על שישי+שבת */
export function businessDayOffset(
  year: number, month: number, day: number, now: Date = new Date(),
): number {
  const { y, m, d } = israelTodayYMD(now)
  const today = new Date(y, m, d)
  const target = new Date(year, month, day)
  if (target.getTime() <= today.getTime()) return 0
  let count = 0
  const cur = new Date(today)
  while (cur.getTime() < target.getTime()) {
    cur.setDate(cur.getDate() + 1)
    const dow = cur.getDay()
    if (dow !== 5 && dow !== 6) count++
  }
  return count
}

/**
 * טווח ההזמנה — עד כמה ימים *קלנדריים* קדימה מהיום ניתן לראות ולהזמין.
 *
 * ⚠️ **מקור אמת יחיד.** עד כאן הטווח היה כתוב כליטרל `<= 6` ("שבוע קדימה",
 * בימי עסקים) בארבעה מקומות נפרדים — כאן פעמיים, ב-lib/slotSelection.ts
 * וב-components/booking/BookingForm.tsx — וארבעתם יכלו להתבדר בשקט. מכאן
 * הגבול מוגדר פעם אחת, והשרת, הטופס ואלגוריתם ההצגה קוראים את אותו ערך.
 *
 * 🔒 הרחבת הטווח **אינה** פותחת אף יום שהיה סגור. שישי/שבת (isFridayOrSaturday),
 * ימים שנחסמו ביומן Google (getBusyRanges), חגים שנחסמו ביומן, תורים קיימים
 * ובקשות pending — כל אחד מהם נבדק במנגנון שלו, בדיוק כמו לפני השינוי. כל
 * מה שהערך הזה קובע הוא עד כמה רחוק *בכלל* מותר להסתכל.
 */
export const BOOKING_HORIZON_DAYS = 30

/** מספר ימים קלנדריים מהיום (ישראל) עד התאריך היעד. תאריך שעבר ⟶ שלילי */
export function calendarDayOffset(
  year: number, month: number, day: number, now: Date = new Date(),
): number {
  const { y, m, d } = israelTodayYMD(now)
  const today = new Date(y, m, d)
  const target = new Date(year, month, day)
  // round ולא floor: שני התאריכים בחצות מקומית, ומעבר שעון קיץ הופך את
  // ההפרש ל-23 או 25 שעות ליום.
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

/** האם התאריך בתוך טווח ההזמנה: לא עבר, ולא מעבר ל-BOOKING_HORIZON_DAYS */
export function isWithinBookingHorizon(
  year: number, month: number, day: number, now: Date = new Date(),
): boolean {
  const offset = calendarDayOffset(year, month, day, now)
  return offset >= 0 && offset <= BOOKING_HORIZON_DAYS
}

export function isFridayOrSaturday(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month, day).getDay()
  return dow === 5 || dow === 6
}

/**
 * האם התאריך פתוח להזמנה: לא עבר, לא שישי/שבת, ובתוך טווח ההזמנה
 * (BOOKING_HORIZON_DAYS ימים קלנדריים קדימה) — או שנפתח במפורש בזמינות
 * המיוחדת.
 */
export function isBookableDate(
  year: number, month: number, day: number, now: Date = new Date(),
): boolean {
  if (isFridayOrSaturday(year, month, day)) return false
  const { y, m, d } = israelTodayYMD(now)
  const today = new Date(y, m, d)
  const target = new Date(year, month, day)
  if (target.getTime() < today.getTime()) return false
  return isWithinBookingHorizon(year, month, day, now) || isSpecialDay(year, month, day)
}

/**
 * ⏰ **שעות העבודה — מקור אמת יחיד.**
 *
 * כל רשת הסלוטים נגזרת מכאן, ואין בקוד עוד מספר שעה שני. שינוי שעות
 * הפעילות = עריכת המערך הזה בלבד (ואז עדכון הטקסטים הגלויים באתר
 * וב-JSON-LD, שאינם יכולים להיגזר בזמן ריצה).
 *
 * ⚠️ עד 06.09.2026 המשמרות היו 09:00–11:00 ו-15:00–19:00.
 * ⚠️ עד 09.09.2026 משמרת הבוקר הסתיימה ב-12:00. כעת 09:00–13:00.
 *
 * 🔒 המשמרות קובעות אך ורק אילו שעות **קיימות**. הן אינן פותחות ימים:
 * שישי/שבת, חגים וימים חסומים ביומן Google, תורים קיימים ובקשות pending
 * ממשיכים להיחסם כל אחד במנגנון שלו, ללא שינוי.
 */
export const BUSINESS_SHIFTS: readonly { start: string; end: string }[] = [
  { start: '09:00', end: '13:00' },
  { start: '16:00', end: '19:00' },
]

/**
 * משך סלוט הבסיס ברשת (דקות) — טיפול ארוך יותר נבנה מסלוטים רצופים.
 * 🔒 מוגדר ב-lib/specialAvailability.ts ומיוצא כאן מחדש, כדי שהמרווח
 * שבין תור לתור יהיה מספר אחד בלבד בכל המערכת.
 */
export { SLOT_INTERVAL_MINUTES }

/**
 * רשת הסלוטים הרגילה, נגזרת מ-BUSINESS_SHIFTS.
 *
 * 🔒 סלוט נכנס לרשת רק אם הוא **מסתיים** בתוך המשמרת: הסלוט האחרון בבוקר
 * הוא 12:40 (מסתיים 13:00) ובערב 18:40 (מסתיים 19:00). ומכאן גם הכלל
 * לטיפול ארוך: הרמת גבות (40 דק') דורשת שני סלוטים רצופים ברשת, ולכן
 * 12:40 אינה שעת התחלה חוקית עבורה — הטיפול היה חורג מ-13:00.
 */
export const TIME_SLOTS: string[] = BUSINESS_SHIFTS.flatMap(shift => {
  const slots: string[] = []
  const from = toMin(shift.start)
  const until = toMin(shift.end) - SLOT_INTERVAL_MINUTES
  for (let m = from; m <= until; m += SLOT_INTERVAL_MINUTES) {
    slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  }
  return slots
})

/**
 * האם השעה תקינה לתאריך הזה. הרשת המלאה (בוקר+ערב) חלה רק על תאריכים
 * שבתוך טווח ההזמנה — בדיוק כמו ב-BookingForm
 * (`if (maxSlots === 0) return specialFree`): מעבר לטווח, רק הסלוטים
 * שהוגדרו במפורש בזמינות המיוחדת קבילים, לא כל הרשת.
 */
export function isValidTimeSlot(
  year: number, month: number, day: number, hhmm: string, now: Date = new Date(),
): boolean {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return false
  const inNormalWindow = isWithinBookingHorizon(year, month, day, now)
  if (inNormalWindow && TIME_SLOTS.includes(hhmm)) return true
  return specialSlotsFor(year, month, day).includes(hhmm)
}

/** הרמת גבות = 40 דק' = שני סלוטים רצופים ברשת. שניהם חייבים להיות תקינים */
export function isValidLiftingStart(
  year: number, month: number, day: number, hhmm: string, now: Date = new Date(),
): boolean {
  if (!isValidTimeSlot(year, month, day, hhmm, now)) return false
  const next = toMin(hhmm) + 20
  const nextLabel = `${pad(Math.floor(next / 60))}:${pad(next % 60)}`
  return isValidTimeSlot(year, month, day, nextLabel, now)
}

/**
 * חלון ההכנה המינימלי להזמנה חדשה, בדקות.
 *
 * ⚠️ **מקור אמת יחיד.** עד שלב 15B הערך (90) היה כתוב פעמיים — כאן
 * וכ-`+ 90` בתוך `selectVisibleSlots` — ושני העותקים יכלו להתבדר בשקט:
 * השרת היה דוחה שעות שהלקוחה רואה בלוח, או להפך. `slotSelection.ts`
 * מייבא את הקבוע הזה, ואין יותר מספר שני.
 */
export const MIN_LEAD_MINUTES = 40

/** חלון ההכנה: בהיום — רק שעות שמתחילות לפחות MIN_LEAD_MINUTES מעכשיו */
export function hasLeadTime(
  year: number, month: number, day: number, hhmm: string, now: Date = new Date(),
): boolean {
  const { y, m, d } = israelTodayYMD(now)
  const isToday = year === y && month === m && day === d
  if (!isToday) return true
  const nowParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now)
  const nowMin =
    parseInt(nowParts.find(p => p.type === 'hour')!.value, 10) * 60 +
    parseInt(nowParts.find(p => p.type === 'minute')!.value, 10)
  return toMin(hhmm) >= nowMin + MIN_LEAD_MINUTES
}
