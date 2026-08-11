import 'server-only'
import { LOCATION, SITE_URL } from '@/lib/utils'
import { formatDateTimeIL } from '@/lib/admin/format'
import { REMINDER_SMS } from '@/lib/messageTemplates'

/**
 * נוסח התזכורות.
 *
 * 🔒 day_before ו-two_hours_before **אינם נוסחים עצמאיים כאן.** הם מנתבים
 * ל-REMINDER_SMS ב-lib/messageTemplates.ts — מקור האמת היחיד
 * לנוסחי SMS מאושרים (15F), הנאכף שם ב-assertion טעינה על ≤70 תווים ואפס
 * אמוג'י. אין להעתיק את הטקסט לכאן: עותק שני היה מתפצל מהמקור בעדכון
 * הבא של אחד מהם, בלי שאף בדיקה הייתה תופסת את זה.
 *
 * ⚠️ שתי אלה **כן** כותבות "מחר"/"היום" במפורש — זו ההחלטה שאושרה ונמדדה
 * ב-15F, לא טעות שחזרה. היא בטוחה בפועל בזכות החלונות שקבועים ב-0011:
 * day_before יוצאת לכל המאוחר 6 שעות אחרי scheduled_for (עדיין אותו יום
 * קלנדרי), ו-two_hours_before יוצאת עד רבע שעה לפני התור עצמו — כך
 * ש"מחר"/"היום" תמיד נכונים ברגע שהם נשלחים.
 *
 * manual **אינו** בנוסחי 15F ונשאר תבנית נפרדת ודינמית: מנהלת יכולה
 * לשלוח אותו בכל רגע לפני התור, כולל ימים מראש, ושם "מחר"/"היום" היה
 * פשוט שקר — לכן הוא ממשיך לשאת תאריך ושעה מפורשים, בלי תלות ברגע
 * השליחה בפועל.
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

export function dayBeforeReminderBody(): string {
  return REMINDER_SMS.day_before
}

export function twoHoursBeforeReminderBody(): string {
  return REMINDER_SMS.two_hours_before
}

/** ידנית — הנוסח הכללי ביותר, כי מנהלת יכולה לשלוח בכל זמן לפני התור */
export function manualReminderBody(p: ReminderTemplateInput): string {
  const { date, time } = formatDateTimeIL(p.startsAt.toISOString())
  return `תזכורת מ-${BRAND} 🌸\n${p.treatment}\n${date} בשעה ${time}\n${LOCATION}\n\nלשינוי או ביטול: ${ACCOUNT_URL}`
}

export function reminderBodyFor(
  kind: 'day_before' | 'two_hours_before' | 'manual',
  p: ReminderTemplateInput,
): string {
  if (kind === 'day_before') return dayBeforeReminderBody()
  if (kind === 'two_hours_before') return twoHoursBeforeReminderBody()
  return manualReminderBody(p)
}
