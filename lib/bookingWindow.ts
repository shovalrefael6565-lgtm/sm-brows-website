/**
 * חלון הזמינות הרגיל ("שבוע קדימה") ורשת הסלוטים — עותק בצד השרת של אותם
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

import { isSpecialDay, specialSlotsFor } from './specialAvailability'

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

export function isFridayOrSaturday(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month, day).getDay()
  return dow === 5 || dow === 6
}

/**
 * האם התאריך פתוח להזמנה: לא עבר, לא שישי/שבת, ובתוך חלון השבוע קדימה
 * הרגיל (עד 6 ימי עסקים) — או שנפתח במפורש בזמינות המיוחדת.
 */
export function isBookableDate(
  year: number, month: number, day: number, now: Date = new Date(),
): boolean {
  if (isFridayOrSaturday(year, month, day)) return false
  const { y, m, d } = israelTodayYMD(now)
  const today = new Date(y, m, d)
  const target = new Date(year, month, day)
  if (target.getTime() < today.getTime()) return false
  return businessDayOffset(year, month, day, now) <= 6 || isSpecialDay(year, month, day)
}

/** רשת הסלוטים הרגילה — 20 דק', 09:00–11:00 ו-15:00–19:00 (זהה ל-buildTimeSlots) */
export const TIME_SLOTS: string[] = (() => {
  const slots: string[] = []
  for (let m = 9 * 60; m <= 10 * 60 + 40; m += 20) slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  for (let m = 15 * 60; m <= 18 * 60 + 40; m += 20) slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  return slots
})()

/**
 * האם השעה תקינה לתאריך הזה. הרשת המלאה (בוקר+ערב) חלה רק על תאריכים
 * שבתוך חלון השבוע קדימה הרגיל — בדיוק כמו ב-BookingForm
 * (`if (maxSlots === 0) return specialFree`): מעבר לחלון, רק הסלוטים
 * שהוגדרו במפורש בזמינות המיוחדת קבילים, לא כל הרשת.
 */
export function isValidTimeSlot(
  year: number, month: number, day: number, hhmm: string, now: Date = new Date(),
): boolean {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return false
  const inNormalWindow = businessDayOffset(year, month, day, now) <= 6
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

/** חלון ההכנה: בהיום — רק שעות שמתחילות לפחות 90 דק' מעכשיו (זהה ל-BookingForm) */
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
  return toMin(hhmm) >= nowMin + 90
}
