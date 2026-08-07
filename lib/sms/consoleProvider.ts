import type { SmsProvider, SmsMessage, SmsResult } from './types'
import { maskPhone } from '@/lib/phone'

/**
 * ספק פיתוח — לא שולח כלום, מדפיס את ההודעה ללוג השרת.
 *
 * מאפשר לפתח ולבדוק את כל תהליך ההתחברות והתורים מקצה לקצה בלי חשבון
 * אצל ספק SMS ובלי לשלם על הודעות. זהו ברירת המחדל כשלא הוגדר SMS_PROVIDER.
 *
 * הגנה: הספק הזה מסרב לפעול ב-production אלא אם הוגדר במפורש
 * SMS_ALLOW_CONSOLE_IN_PROD=true — כדי שלא נשחרר בטעות אתר חי שבו אף
 * לקוחה לא מקבלת את קוד ההתחברות שלה.
 *
 * 🔒 **שלב 12B: ל-OTP בפרודקשן אין דגל חילוץ.**
 *
 * SMS_ALLOW_CONSOLE_IN_PROD נועד לאפשר הרצה חיה בלי ספק SMS. עבור קוד
 * כניסה זה אומר שמשתנה סביבה אחד מדפיס קודי כניסה של מנהלת ללוגי הפלטפורמה,
 * שם הם נשמרים, נגישים לכל מי שיש לו גישה ללוגים, ואינם פגי תוקף מבחינת
 * מי שקורא אותם בדיעבד. הדגל **אינו חל** על kind='otp', ואין דגל שני
 * שמבטל את זה.
 *
 * ⚠️ מאז 12B lib/sms/index.ts כבר אינו בונה את הספק הזה בפרודקשן מלכתחילה.
 * הבדיקה כאן היא השכבה השנייה, למקרה שמישהו יבנה אותו ישירות.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console'
  readonly isLive = false

  async send(message: SmsMessage): Promise<SmsResult> {
    const isProduction = process.env.NODE_ENV === 'production'

    // 🔒 קודם כול, ובלי תלות בדגל: OTP לא מודפס בפרודקשן.
    if (isProduction && message.kind === 'otp') {
      console.error(
        '[sms] ConsoleSmsProvider refused an OTP in production — no override exists',
      )
      // notDelivered — הספק סירב לפני שנגע בהודעה. שום דבר לא יצא.
      return { ok: false, notDelivered: true, error: 'console_provider_blocked_for_otp' }
    }

    if (isProduction && process.env.SMS_ALLOW_CONSOLE_IN_PROD !== 'true') {
      console.error(
        '[sms] ConsoleSmsProvider blocked in production — set SMS_PROVIDER to a real provider',
      )
      return { ok: false, notDelivered: true, error: 'console_provider_blocked_in_production' }
    }

    // המספר ממוסך גם בלוג. גוף ההודעה מוצג במלואו כי זו כל מטרת מצב הפיתוח
    // (צריך לראות את קוד ה-OTP), ולכן הספק הזה אסור בסביבה חיה.
    console.info(
      `\n[sms:${message.kind}] → ${maskPhone(message.to)}\n${'─'.repeat(48)}\n${message.body}\n${'─'.repeat(48)}\n`,
    )

    return { ok: true, providerMessageId: `console-${Date.now()}` }
  }
}
