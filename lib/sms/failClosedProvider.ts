import type { SmsProvider, SmsMessage, SmsResult } from './types'

/**
 * ספק שנכשל בבטחה — התשובה לכל תצורה שאינה תקינה.
 *
 * 🔒 **מה שהוא לא עושה הוא כל הפואנטה:**
 *   • אינו מדפיס את גוף ההודעה. לעולם. גם לא בפיתוח.
 *   • אינו מדפיס את המספר, את הקוד או את סוג ההודעה.
 *   • אינו פותח חיבור ואינו נוגע ברשת.
 *   • אינו מתחזה להצלחה — `ok:false`, והקורא מציג נוסח כללי.
 *
 * ⚠️ הוא קיים כדי שלא תהיה נפילה לקונסול. הקוד הקודם החזיר ConsoleSmsProvider
 * בכל מצב לא צפוי, כלומר טעות תצורה הפכה למסלול ש**מדפיס קודי כניסה ללוג**.
 * המצב הבטוח לתצורה שבורה הוא "לא נשלח כלום ואיש לא ראה את הקוד", לא
 * "נשלח לקונסול".
 *
 * ⚠️ `isLive = false` — הוא אינו שולח. אין לגזור מכך שמותר להדפיס דרכו
 * משהו: `isLive` מתאר את היעד, לא היתר לוג.
 */
export class FailClosedSmsProvider implements SmsProvider {
  readonly name = 'fail_closed'
  readonly isLive = false

  /** ⚠️ מזהה קצר ויציב. לא הודעה ללקוחה ולא ערך מהסביבה. */
  constructor(private readonly reason: string) {}

  async send(_message: SmsMessage): Promise<SmsResult> {
    // 🔒 notDelivered — הספק הזה אינו פותח חיבור בכלל, ולכן "לא נשלח" הוא
    // ודאות מוחלטת ולא הסקה. שורת ה-OTP שנוצרה לפני הקריאה תימחק.
    return { ok: false, notDelivered: true, error: this.reason }
  }
}
