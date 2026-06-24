import { Location, Zmanim } from '@hebcal/core'

/**
 * נעילת הזמנות בשבת — מקור אמת יחיד.
 *
 * החלון: משקיעת החמה ביום שישי ועד 30 דקות לאחר צאת השבת (מוצ"ש),
 * מחושב אוטומטית לפי קואורדינטות אשקלון ושעון ישראל.
 *
 * הפונקציה לא נוגעת ב-Google Calendar, בזמינות, בסלוטים או בלוגיקת
 * הביקוש — היא רק מסמנת אם כרגע שבת, וכל רכיבי ההזמנה נשענים עליה.
 */

// אשקלון — קו רוחב/אורך לחישוב שקיעה וצאת הכוכבים
const ASHKELON = new Location(31.6688, 34.5742, true, 'Asia/Jerusalem', 'Ashkelon', 'IL')

// כמה דקות אחרי צאת השבת המערכת נשארת נעולה
const POST_SHABBAT_BUFFER_MIN = 30

/** ה-Y/M/D של "עכשיו" לפי שעון ישראל (לא תלוי בשעון השרת) */
function israelYMD(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** תאריך בצהריים מרכיבים מקומיים — getDate()/getDay() תמיד מחזירים את אותו יום-קלנדרי */
function atNoon(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12, 0, 0, 0)
}

/**
 * גבולות חלון השבת אם "עכשיו" יכול ליפול בתוכו (שישי/שבת בלבד), אחרת null.
 * start = שקיעת שישי · end = צאת שבת + 30 דק'.
 */
export function shabbatWindow(now: Date = new Date()): { start: Date; end: Date } | null {
  const { y, m, d } = israelYMD(now)
  const base = atNoon(y, m, d)
  const dow = base.getDay() // 0=ראשון … 6=שבת

  let friday: Date
  let saturday: Date
  if (dow === 5) {
    friday = base
    saturday = addDays(base, 1)
  } else if (dow === 6) {
    friday = addDays(base, -1)
    saturday = base
  } else {
    return null // ראשון–חמישי: ודאי לא שבת
  }

  const start = new Zmanim(ASHKELON, friday, false).sunset()       // שקיעת שישי
  const tzeit = new Zmanim(ASHKELON, saturday, false).tzeit()      // צאת הכוכבים שבת
  const end = new Date(tzeit.getTime() + POST_SHABBAT_BUFFER_MIN * 60_000)
  return { start, end }
}

/**
 * הפונקציה המרכזית: true בזמן שבת (משקיעת שישי ועד מוצ"ש +30 דק'), אחרת false.
 */
export function isShabbat(now: Date = new Date()): boolean {
  const w = shabbatWindow(now)
  if (!w) return false
  const t = now.getTime()
  return t >= w.start.getTime() && t <= w.end.getTime()
}
