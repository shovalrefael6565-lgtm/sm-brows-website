/**
 * מועד התפוגה של בקשת תור ממתינה — מקור אמת יחיד.
 *
 * ═══ הכלל העסקי (אושר 08.08.2026) ═══
 *
 *   expires_at = created_at + 3 שעות
 *
 *   אם התוצאה נופלת מחוץ ל"חלון הטיפול" של שובל, או ביום שאינו יום עבודה
 *   ⟶ expires_at = 11:00 ביום העבודה הבא (הקרוב ביותר שאינו לפני התוצאה).
 *
 * דוגמאות שנמסרו ואומתו בבדיקות:
 *   15:00 ביום עבודה  ⟶ 18:00 באותו יום
 *   17:00 ביום עבודה  ⟶ 11:00 ביום העבודה הבא   (20:00 ≥ 19:00)
 *   חמישי 17:00        ⟶ ראשון 11:00              (שישי ושבת מדולגים)
 *
 * ⚠️ **נקודת החיתוך האפקטיבית היא 16:00, לא 19:00.** בקשה מ-16:00 ואילך
 * חוצה את 19:00 ולכן מתגלגלת. זו תוצאה ישירה של הכלל, לא פרשנות.
 *
 * ═══ ⚠️ גבול תחתון — הרחבה מפורשת של הכלל ═══
 *
 * הכלל שנמסר נקב בגבול עליון בלבד ("19:00 או מאוחר יותר"). אבל בקשה
 * שנוצרת ב-23:00 מגיעה ל-02:00 — שעה שאינה ≥ 19:00 ונופלת ביום עבודה,
 * ולכן לפי הניסוח המילולי הייתה פגה **באמצע הלילה**. זה סותר חזיתית את
 * מטרת הכלל כפי שנוסחה ("אסור לבקשה לפוג בלילה").
 *
 * לכן חלון הטיפול מוגדר כאן משני צדדיו, ומשתמש בקבועים שכבר קיימים
 * במערכת: [BUSINESS_START_MIN, BUSINESS_END_MIN) = [09:00, 19:00).
 * 09:00 ולא 11:00 — 11:00 היא שעת ה*שחרור*, לא סף הקבילות, ובקשה שפגה
 * ב-09:30 פגה בשעת פעילות לגיטימית ואין סיבה להאריך אותה.
 *
 * ═══ אזור זמן ═══
 *
 * 🔒 כל החישוב ב-Asia/Jerusalem במפורש, דרך lib/israelTime.ts. שרתי Vercel
 * רצים ב-UTC, וכל חישוב שנשען על אזור הזמן של השרת היה שגוי בשעתיים-שלוש.
 *
 * ═══ "יום עבודה" ═══
 *
 * 🔒 מוגדר **אך ורק** ע"י isFridayOrSaturday מ-lib/bookingWindow.ts — אותה
 * לוגיקה שמשמשת את חלון 7 הימים ואת הזמינות. אין כאן לוח חגים, ואין
 * הגדרה שנייה של "יום סגור": שכפול ההגדרה היה בדיוק הבאג של 90 הדקות
 * שהתגלה בסריקת 15A. ימי חג ממשיכים להתנהל דרך Google Calendar כפי שהיום.
 */

import { BUSINESS_START_MIN, BUSINESS_END_MIN, israelWallTimeToUtc } from './israelTime'
import { isFridayOrSaturday } from './bookingWindow'

/** ברירת המחדל: כמה זמן בקשה ממתינה מחזיקה את השעה */
export const PENDING_TTL_HOURS = 3

/** השעה שאליה מתגלגלת בקשה שאסור לה לפוג בלילה או ביום סגור */
export const PENDING_RELEASE_HHMM = '11:00'

/**
 * תקרת ביטחון על מרחק התפוגה מרגע היצירה.
 *
 * ⚠️ אינה כלל עסקי אלא חגורת בטיחות: המקרה הלגיטימי הארוך ביותר הוא
 * בקשה בחמישי בערב שמתגלגלת לראשון 11:00 — כ-66 שעות. 72 מותירות מרווח
 * לשעון קיץ בלי לאפשר ערך אבסורדי. אותה תקרה נאכפת שוב ב-RPC, כדי
 * שקורא שגוי לא יוכל להחזיק סלוט לנצח.
 */
export const PENDING_EXPIRY_MAX_HOURS = 72

/** כמה ימים קדימה לחפש יום עבודה לפני ויתור (שישי+שבת = לכל היותר 2) */
const MAX_ROLL_DAYS = 8

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/** רכיבי התאריך והשעה של רגע נתון, לפי שעון ישראל */
function israelParts(d: Date): { y: number; m: number; day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parseInt(parts.find(p => p.type === t)!.value, 10)
  let hour = get('hour')
  if (hour === 24) hour = 0 // חלק ממימושי Intl מחזירים 24:00 במקום 00:00
  return {
    y: get('year'),
    m: get('month') - 1, // 0-based, כמו ב-Date וכמו בכל שאר הפרויקט
    day: get('day'),
    minutes: hour * 60 + get('minute'),
  }
}

function isoOf(y: number, m: number, day: number): string {
  return `${y}-${pad(m + 1)}-${pad(day)}`
}

/** האם הרגע נופל בתוך חלון הטיפול של יום עבודה */
function isInsideHandlingWindow(d: Date): boolean {
  const { y, m, day, minutes } = israelParts(d)
  if (isFridayOrSaturday(y, m, day)) return false
  return minutes >= BUSINESS_START_MIN && minutes < BUSINESS_END_MIN
}

/**
 * הרגע הראשון שהוא 11:00 ביום עבודה ואינו לפני `from`.
 *
 * מטפל בשני המקרים באותה לולאה: תפוגה שנפלה **לפני** 11:00 באותו יום
 * (בקשת לילה) מקבלת את 11:00 של אותו יום עצמו; תפוגה שנפלה **אחרי**
 * מתגלגלת קדימה.
 */
function nextReleaseMoment(from: Date): Date {
  const { y, m, day } = israelParts(from)
  const cursor = new Date(y, m, day) // תאריך קלנדרי בלבד — לא רגע בזמן

  for (let i = 0; i < MAX_ROLL_DAYS; i++) {
    const cy = cursor.getFullYear()
    const cm = cursor.getMonth()
    const cd = cursor.getDate()

    if (!isFridayOrSaturday(cy, cm, cd)) {
      const candidate = israelWallTimeToUtc(isoOf(cy, cm, cd), PENDING_RELEASE_HHMM)
      if (candidate.getTime() >= from.getTime()) return candidate
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  /*
   * בלתי אפשרי עם שבוע בן 7 ימים ושני ימי סגירה רצופים — אבל להחזיר
   * ערך שגוי בשקט זה גרוע מלזרוק. מי שקורא לפונקציה מקבל שגיאה ברורה
   * ולא בקשה שמחזיקה סלוט לנצח.
   */
  throw new Error('pendingExpiry: לא נמצא יום עבודה בטווח סביר')
}

/**
 * מועד התפוגה של בקשה שנוצרת עכשיו.
 *
 * @param createdAt רגע יצירת הבקשה. ברירת המחדל: עכשיו.
 */
export function computePendingExpiresAt(createdAt: Date = new Date()): Date {
  const raw = new Date(createdAt.getTime() + PENDING_TTL_HOURS * 60 * 60 * 1000)
  return isInsideHandlingWindow(raw) ? raw : nextReleaseMoment(raw)
}

/**
 * האם מועד תפוגה הוא ערך סביר עבור בקשה שנוצרה ב-`createdAt`.
 *
 * משמשת את שכבת ה-DB לפני שליחת הערך ל-RPC, ומשקפת בדיוק את התקרה
 * שה-RPC אוכף בעצמו — כך שכשל נתפס מוקדם ועם הודעה ברורה, במקום כחריגת
 * Postgres גולמית.
 */
export function isSanePendingExpiry(
  expiresAt: Date,
  createdAt: Date = new Date(),
): boolean {
  const deltaMs = expiresAt.getTime() - createdAt.getTime()
  return deltaMs > 0 && deltaMs <= PENDING_EXPIRY_MAX_HOURS * 60 * 60 * 1000
}

/**
 * עזר לתצוגה/בדיקות: תיאור קריא של התפוגה בשעון ישראל.
 * לא בשימוש בזרימת הכתיבה — קיים כדי שבדיקות ולוגים לא ימציאו פורמט משלהם.
 */
export function describeExpiry(d: Date): string {
  const { y, m, day, minutes } = israelParts(d)
  return `${isoOf(y, m, day)} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}
