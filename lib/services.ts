/**
 * קטלוג הטיפולים שנקבעים דרך יומן — מקור אמת יחיד לשם, למחיר ולמשך.
 *
 * BookingForm.tsx (לקוח) ו-app/api/appointments (שרת) מייבאים משתי הקבועים
 * האלה בלבד, כדי שהלקוח לא יוכל להשפיע על המחיר או המשך שנשמרים בפועל —
 * השרת מחשב אותם בעצמו מתוך הרשימה כאן, ולא סומך על מה שהגיע מהדפדפן.
 *
 * מיקרובליידינג וקורס מקצועי אינם כאן בכוונה: הם ממשיכים בזרימת הוואטסאפ
 * הקיימת בלי יומן, בלי DB ובלי OTP — לא "תורים" מבחינת המערכת.
 */

export const NATURAL_SERVICE = 'עיצוב גבות טבעיות'
export const LIFTING_SERVICE = 'הרמת גבות'

export const NATURAL_DURATION_MIN = 20
export const LIFTING_DURATION_MIN = 40
export const LIFTING_PRICE = 250

export interface NaturalVariant {
  id: string
  label: string
  desc: string
  price: number
}

export const NATURAL_VARIANTS: NaturalVariant[] = [
  // ⚠️ id נשאר 'עיצוב גבות טבעי' בכוונה — הוא המפתח היציב שנשמר כבר
  // בעמודת variants (text[]) של תורים קיימים ב-DB. שינוי ה-id היה שובר
  // את ההתאמה מול נתונים היסטוריים. רק label (טקסט התצוגה) עודכן.
  { id: 'עיצוב גבות טבעי',    label: 'עיצוב גבות טבעיות',  desc: 'עיצוב מדויק והגדרת הגבה — כולל שפם',          price: 70 },
  { id: 'עיצוב גבות + צביעה', label: 'עיצוב גבות + צביעה', desc: 'כולל צביעת גבות — האפקט נמשך כ-7 עד 10 ימים', price: 85 },
  { id: 'שעווה לכל הפנים',    label: 'שעווה לכל הפנים',    desc: 'הסרת שיער בשעווה לכל אזורי הפנים',            price: 40 },
]

export type BookableService = typeof NATURAL_SERVICE | typeof LIFTING_SERVICE

export function isBookableService(name: string): name is BookableService {
  return name === NATURAL_SERVICE || name === LIFTING_SERVICE
}

// ─── טיפולים ניהוליים בלבד (שלב 12) ─────────────────────────────────────────
//
// מיקרובליידינג וייעוץ מיקרובליידינג נקבעים **רק** ממערכת הניהול. הם אינם
// חלק מהקטלוג הציבורי, isBookableService אינה מכירה אותם, ולכן אף מסלול
// לקוחה (טופס הזמנה, אזור אישי, בקשת שינוי מועד) אינו יכול לבחור בהם.
//
// ⚠️ **המשך נקבע ידנית ע"י שובל בכל תור.** אין לטיפולים האלה משך קבוע:
// מיקרובליידינג משתנה לפי העבודה בפועל, וייעוץ משתנה לפי הלקוחה. הערך
// כאן הוא ברירת מחדל שממלאת את השדה בטופס בלבד — מה שנשמר הוא מה ששובל
// הזינה, אחרי אימות טווח בשרת וב-RPC (5–480 דקות, 0010).
//
// ⚠️ המחיר אופציונלי במכוון: מחיר מיקרובליידינג נקבע מול הלקוחה ואינו
// תמיד ידוע בשעת הקביעה. price_total הוא nullable ב-DB (0001), ותור בלי
// מחיר מוצג "—" בדיוק כמו תור ישן בלי מחיר.

export const MICROBLADING_SERVICE = 'מיקרובליידינג'
export const MICROBLADING_CONSULT_SERVICE = 'ייעוץ מיקרובליידינג'

export interface AdminOnlyService {
  /** נשמר כמות שהוא ב-appointments.service_key, ולכן אסור לשנותו אחרי שנוצרו תורים */
  key: string
  label: string
  /** ברירת מחדל לשדה המשך בטופס בלבד — לא ערך שנאכף */
  defaultDurationMin: number
}

export const ADMIN_ONLY_SERVICES: AdminOnlyService[] = [
  { key: MICROBLADING_SERVICE,         label: 'מיקרובליידינג',       defaultDurationMin: 150 },
  { key: MICROBLADING_CONSULT_SERVICE, label: 'ייעוץ מיקרובליידינג', defaultDurationMin: 30 },
]

/** אותם גבולות בדיוק שה-RPC create_manual_appointment אוכף (0010) */
export const ADMIN_MIN_DURATION_MIN = 5
export const ADMIN_MAX_DURATION_MIN = 480

export function isAdminOnlyService(name: string): boolean {
  return ADMIN_ONLY_SERVICES.some(s => s.key === name)
}

export function adminOnlyService(name: string): AdminOnlyService | null {
  return ADMIN_ONLY_SERVICES.find(s => s.key === name) ?? null
}
