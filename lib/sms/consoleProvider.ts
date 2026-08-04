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
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console'
  readonly isLive = false

  async send(message: SmsMessage): Promise<SmsResult> {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.SMS_ALLOW_CONSOLE_IN_PROD !== 'true'
    ) {
      console.error(
        '[sms] ConsoleSmsProvider blocked in production — set SMS_PROVIDER to a real provider',
      )
      return { ok: false, error: 'console_provider_blocked_in_production' }
    }

    // המספר ממוסך גם בלוג. גוף ההודעה מוצג במלואו כי זו כל מטרת מצב הפיתוח
    // (צריך לראות את קוד ה-OTP), ולכן הספק הזה אסור בסביבה חיה.
    console.info(
      `\n[sms:${message.kind}] → ${maskPhone(message.to)}\n${'─'.repeat(48)}\n${message.body}\n${'─'.repeat(48)}\n`,
    )

    return { ok: true, providerMessageId: `console-${Date.now()}` }
  }
}
