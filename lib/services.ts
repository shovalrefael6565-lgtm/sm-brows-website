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
  { id: 'עיצוב גבות טבעי',    label: 'עיצוב גבות טבעי',    desc: 'עיצוב מדויק והגדרת הגבה — כולל שפם',          price: 70 },
  { id: 'עיצוב גבות + צביעה', label: 'עיצוב גבות + צביעה', desc: 'כולל צביעת גבות — האפקט נמשך כ-7 עד 10 ימים', price: 85 },
  { id: 'שעווה לכל הפנים',    label: 'שעווה לכל הפנים',    desc: 'הסרת שיער בשעווה לכל אזורי הפנים',            price: 40 },
]

export type BookableService = typeof NATURAL_SERVICE | typeof LIFTING_SERVICE

export function isBookableService(name: string): name is BookableService {
  return name === NATURAL_SERVICE || name === LIFTING_SERVICE
}
