/**
 * זמינות מיוחדת — פתיחה זמנית וממוקדת של תורים, כתוספת למנגנון הרגיל.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * זה הקובץ היחיד שצריך לגעת בו כדי להוסיף / לשנות / להסיר זמינות מיוחדת.
 * הוא לא נוגע במנגנון "שבוע קדימה" הרגיל (businessDayOffset / slotsForOffset
 * ב-BookingForm), לא במשך הטיפולים ולא במרווח שבין תור לתור.
 *
 * כדי לבטל לגמרי את הזמינות המיוחדת: לרוקן את המערך SPECIAL_WINDOWS ל-[].
 * כדי לשנות טווח: לערוך את from / to / hours של החלון המתאים.
 * כדי להוסיף טווח נוסף: להוסיף עוד אובייקט למערך.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * שימו לב: ימי שישי ושבת נשארים סגורים גם בתוך הטווחים המיוחדים — הסגירה
 * הזו נשלטת ע"י המנגנון הקיים (isClosedDay) והזמינות המיוחדת לא עוקפת אותה.
 */

/** מרווח הזמן הקיים במערכת בין תור לתור (דקות) — זהה לרשת הסלוטים הרגילה */
export const SLOT_INTERVAL_MINUTES = 20

type SpecialWindow = {
  /** תאריך התחלה כולל, בפורמט YYYY-MM-DD */
  from: string
  /** תאריך סיום כולל, בפורמט YYYY-MM-DD */
  to: string
  /** חלונות שעות שנפתחים בטווח הזה. הסלוט האחרון מסתיים בדיוק בשעת ה-end */
  hours: { start: string; end: string }[]
  /** תיאור פנימי — לתיעוד בלבד */
  note?: string
}

/**
 * החלונות הפעילים כרגע.
 *
 * 23.08.2026–09.09.2026 → ערב 17:00–19:00
 * 23.08.2026–31.08.2026 → בנוסף גם בוקר 09:00–11:00
 *
 * בתאריכים 23.08–31.08 מתקבל איחוד: גם 09:00–11:00 וגם 17:00–19:00.
 * אחרי 09.09.2026 אין כאן שום חלון פעיל, והמערכת חוזרת לפעול אך ורק לפי
 * מנגנון השבוע קדימה הרגיל — בלי צורך בשינוי קוד.
 */
const SPECIAL_WINDOWS: SpecialWindow[] = [
  {
    from: '2026-08-23',
    to: '2026-09-09',
    hours: [{ start: '17:00', end: '19:00' }],
    note: 'פתיחת ערב זמנית',
  },
  {
    from: '2026-08-23',
    to: '2026-08-31',
    hours: [{ start: '09:00', end: '11:00' }],
    note: 'תוספת בוקר זמנית',
  },
]

function pad(n: number) {
  return n.toString().padStart(2, '0')
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function toHHMM(m: number): string {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** YYYY-MM-DD מרכיבי תאריך של לוח השנה (month הוא 0-based, כמו ב-Date) */
function isoOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

/**
 * כל הסלוטים המיוחדים של תאריך נתון (ממוינים, ללא כפילויות).
 * מערך ריק = לתאריך הזה אין זמינות מיוחדת, והוא מתנהג בדיוק כמו קודם.
 */
export function specialSlotsFor(year: number, month: number, day: number): string[] {
  const iso = isoOf(year, month, day)
  const out: string[] = []

  for (const win of SPECIAL_WINDOWS) {
    // השוואת מחרוזות ISO — בטוחה, בלי תלות באזור זמן או בשעון השרת
    if (iso < win.from || iso > win.to) continue
    for (const { start, end } of win.hours) {
      const last = toMin(end) - SLOT_INTERVAL_MINUTES // הסלוט האחרון מסתיים ב-end
      for (let m = toMin(start); m <= last; m += SLOT_INTERVAL_MINUTES) {
        const slot = toHHMM(m)
        if (!out.includes(slot)) out.push(slot)
      }
    }
  }

  return out.sort((a, b) => toMin(a) - toMin(b))
}

/** האם לתאריך הזה יש זמינות מיוחדת (משמש כדי לפתוח אותו ביומן) */
export function isSpecialDay(year: number, month: number, day: number): boolean {
  return specialSlotsFor(year, month, day).length > 0
}

/** האם קיים בכלל חלון מיוחד בחודש נתון — לניווט האוטומטי בין חודשים */
export function monthHasSpecialDays(year: number, month: number): boolean {
  const lastDay = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= lastDay; d++) {
    if (isSpecialDay(year, month, d)) return true
  }
  return false
}
