import type { SmsProvider, SmsMessage, SmsResult } from './types'
import { ConsoleSmsProvider } from './consoleProvider'
import { TwilioSmsProvider } from './twilioProvider'

export type { SmsProvider, SmsMessage, SmsResult, SmsKind } from './types'

/**
 * נקודת הכניסה היחידה לשליחת הודעות.
 *
 * הבחירה נעשית לפי SMS_PROVIDER, וברירת המחדל היא ספק הפיתוח (קונסול).
 * כדי לחבר ספק חדש בעתיד: להוסיף מחלקה שמממשת SmsProvider ולהוסיף ענף כאן.
 */

let cached: SmsProvider | null = null

export function getSmsProvider(): SmsProvider {
  if (cached) return cached

  const kind = (process.env.SMS_PROVIDER ?? 'console').toLowerCase()
  switch (kind) {
    case 'twilio':
      cached = new TwilioSmsProvider()
      break
    case 'console':
      cached = new ConsoleSmsProvider()
      break
    default:
      console.error(`[sms] unknown SMS_PROVIDER "${kind}" — falling back to console`)
      cached = new ConsoleSmsProvider()
  }

  return cached
}

/**
 * שליחה בטוחה: לעולם לא זורקת.
 *
 * הודעות הן תופעת לוואי של פעולה עסקית — כישלון בשליחת אישור ביטול
 * לא אמור להחזיר שגיאה ללקוחה שהביטול שלה כבר נשמר. הכישלון נרשם ללוג
 * והפעולה העסקית ממשיכה. היוצא מן הכלל הוא OTP, שם הקורא כן בודק את ok.
 */
export async function sendSms(message: SmsMessage): Promise<SmsResult> {
  try {
    return await getSmsProvider().send(message)
  } catch (err) {
    console.error('[sms] provider threw', err)
    return { ok: false, error: 'provider_error' }
  }
}

/** לבדיקות בלבד — מאפס את הספק שנשמר במטמון */
export function __resetSmsProviderCache() {
  cached = null
}
