import 'server-only'
import { LOCATION, SITE_URL } from '@/lib/utils'
import { formatDateTimeIL } from '@/lib/admin/format'

/**
 * נוסח התזכורות.
 *
 * ⚠️ **אף תבנית אינה כותבת "מחר" או "בעוד שעתיים".** התבנית הקיימת
 * ב-lib/sms/templates.ts (reminderMessage) כן כותבת "מחר", ולכן היא אינה
 * בשימוש כאן והושארה כפי שהיא.
 *
 * הסיבה אינה סגנונית: לכל תזכורת יש **חלון** ולא רגע. תזכורת "יום לפני"
 * שיוצאת שש שעות באיחור עדיין תקפה — ואז "מחר" הופך לשקר. תזכורת ידנית
 * יכולה להישלח בכל רגע לפני התור. תאריך ושעה מפורשים נכונים תמיד, בלי
 * תלות ברגע השליחה בפועל.
 *
 * גרסת התבנית נשמרת בשורת התזכורת (template_version). שינוי נוסח שמשנה
 * את משמעות ההודעה חייב להעלות אותה.
 */

export const REMINDER_TEMPLATE_VERSION = 'v1'

const BRAND = 'S.M BROWS'
const ACCOUNT_URL = `${SITE_URL}/account`

export interface ReminderTemplateInput {
  treatment: string
  /** מועד התור. תמיד ה-snapshot של התזכורת, לא "עכשיו" ולא starts_at טרי */
  startsAt: Date
}

function body(intro: string, p: ReminderTemplateInput): string {
  const { date, time } = formatDateTimeIL(p.startsAt.toISOString())
  return `${intro}\n${p.treatment}\n${date} בשעה ${time}\n${LOCATION}\n\nלשינוי או ביטול: ${ACCOUNT_URL}`
}

export function dayBeforeReminderBody(p: ReminderTemplateInput): string {
  return body(`תזכורת לתור שלך ב-${BRAND} 🌸`, p)
}

export function twoHoursBeforeReminderBody(p: ReminderTemplateInput): string {
  return body(`התור שלך ב-${BRAND} מתקרב 🌸`, p)
}

/** ידנית — הנוסח הכללי ביותר, כי מנהלת יכולה לשלוח בכל זמן לפני התור */
export function manualReminderBody(p: ReminderTemplateInput): string {
  return body(`תזכורת מ-${BRAND} 🌸`, p)
}

export function reminderBodyFor(
  kind: 'day_before' | 'two_hours_before' | 'manual',
  p: ReminderTemplateInput,
): string {
  if (kind === 'day_before') return dayBeforeReminderBody(p)
  if (kind === 'two_hours_before') return twoHoursBeforeReminderBody(p)
  return manualReminderBody(p)
}
