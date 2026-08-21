import 'server-only'
import { APPOINTMENT_LOCATION, SITE_URL } from '@/lib/utils'
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
 * ⚠️ שתי אלה **כן** כותבות "מחר"/"בעוד שעתיים" במפורש — זו ההחלטה
 * שאושרה, לא טעות שחזרה. אבל שתי הטענות אינן מוגנות באותה דרך, וזה
 * ההבדל שקובע:
 *
 *   day_before ("מחר") — מוגן ע"י הסכמה בלבד. `expires_at` הוא
 *     `scheduled_for + 6h`, ו-`scheduled_for` הוא אותה שעת קיר ביום
 *     הקלנדרי הקודם (Asia/Jerusalem). כל רגע שבו החלון פתוח הוא בהכרח
 *     היום שלפני התור, ולכן "מחר" נכון לכל אורכו. אין צורך בשום בדיקה
 *     נוספת בצד השולח.
 *
 *   two_hours_before ("בעוד שעתיים") — **אינו מוגן ע"י הסכמה.**
 *     `expires_at` שלו הוא `starts_at - 15m`, כלומר החלון פתוח עד רבע
 *     שעה לפני התור. תזכורת שנתפסת בקצה הזה הייתה אומרת "בעוד שעתיים"
 *     חמש-עשרה דקות לפני התור — הודעה שקרית ללקוחה. הנוסח הקודם ("היום")
 *     היה נכון בכל אורך החלון ולכן לא נזקק לכלום; הנוסח הנוכחי הוא טענה
 *     על **מרחק בזמן**, ולכן הוא מחייב חסם רעננות מפורש בצד השולח.
 *     ⚠️ החסם אינו כאן אלא ב-`dispatch.ts` (`TWO_HOURS_FRESHNESS_MS`),
 *     כי הוא צריך את שעת ה-claim בפועל, ולא רק את הנוסח.
 *
 * ⚠️ צמצום `expires_at` ב-0011 היה הפתרון הישיר יותר — והוא **לא** נבחר:
 * הוא מחייב migration ממוספרת חדשה, ובזה אין צורך. הכלל נאכף בקוד מול
 * `scheduled_for` שכבר נמצא בשורה.
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
  return `תזכורת מ-${BRAND} 🌸\n${p.treatment}\n${date} בשעה ${time}\n${APPOINTMENT_LOCATION}\n\nלשינוי או ביטול: ${ACCOUNT_URL}`
}

export function reminderBodyFor(
  kind: 'day_before' | 'two_hours_before' | 'manual',
  p: ReminderTemplateInput,
): string {
  if (kind === 'day_before') return dayBeforeReminderBody()
  if (kind === 'two_hours_before') return twoHoursBeforeReminderBody()
  return manualReminderBody(p)
}
