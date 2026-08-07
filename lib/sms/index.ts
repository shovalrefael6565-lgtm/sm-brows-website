import type { SmsProvider, SmsMessage, SmsResult } from './types'
import { ConsoleSmsProvider } from './consoleProvider'
import { TwilioSmsProvider } from './twilioProvider'
import { createSms019SmsProvider } from './sms019Provider'
import { FailClosedSmsProvider } from './failClosedProvider'

export type { SmsProvider, SmsMessage, SmsResult, SmsKind } from './types'
export { Sms019SmsProvider, createSms019SmsProvider } from './sms019Provider'
export { FailClosedSmsProvider }

/**
 * נקודת הכניסה היחידה לשליחת הודעות.
 *
 * ═══ שלב 12B: אין יותר נפילה שקטה לקונסול ═══
 *
 * ⚠️ המימוש הקודם היה `default: falling back to console`. כלומר טעות הקלדה
 * אחת ב-SMS_PROVIDER (`sms019` במקום `sms_019`) הפנתה את מסלול ה-OTP לספק
 * ש**מדפיס את גוף ההודעה ללוג** — כולל את הקוד עצמו. ההגנה היחידה הייתה
 * בדיקה בתוך ConsoleSmsProvider, כלומר נכס יחיד.
 *
 * עכשיו הכלל מפורש: **כל מצב שאינו "console מותר במפורש" מחזיר ספק שנכשל
 * בבטחה.** ספק שנכשל בבטחה אינו מדפיס כלום, אינו פותח חיבור, ואינו מתחזה
 * להצלחה — הוא פשוט מחזיר ok:false, והקורא מציג ללקוחה נוסח כללי.
 *
 * ⚠️ הערכים שנרשמים ללוג כאן הם *שמות* משתני סביבה ושם הספק שהתבקש. אין
 * כאן token, טלפון, גוף הודעה או קוד.
 */

let cached: SmsProvider | null = null

/**
 * בוחר את הספק לפי הסביבה. מיוצא לבדיקות — הן מזריקות env במקום
 * להשתמש ב-process.env הגלובלי.
 */
export function resolveSmsProvider(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const kind = (env.SMS_PROVIDER ?? 'console').trim().toLowerCase()
  const isProduction = env.NODE_ENV === 'production'

  if (kind === 'sms_019') {
    const built = createSms019SmsProvider(env)
    if (!built.ok) {
      // ⚠️ problems מכיל שמות משתנים בלבד — לעולם לא ערכים.
      console.error(
        `[sms] sms_019 אינו מוגדר כראוי (${built.problems.join('; ')}) — כשל בטוח`,
      )
      return new FailClosedSmsProvider('sms019_not_configured')
    }
    return built.provider
  }

  if (kind === 'twilio') {
    try {
      return new TwilioSmsProvider()
    } catch {
      // ⚠️ ה-constructor זורק כשחסרים משתנים. ההודעה שלו מכילה שמות
      // משתנים בלבד, אבל היא לא נרשמת כאן ממילא — אין צורך.
      console.error('[sms] twilio אינו מוגדר כראוי — כשל בטוח')
      return new FailClosedSmsProvider('twilio_not_configured')
    }
  }

  if (kind === 'console') {
    // 🔒 בפרודקשן ההחלטה נופלת כאן, לא בתוך הספק. ConsoleSmsProvider עדיין
    // מגן על עצמו (הגנה בעומק), אבל בפרודקשן הוא כבר לא נבנה מלכתחילה.
    if (isProduction) {
      console.error(
        '[sms] SMS_PROVIDER=console אסור בפרודקשן — יש להגדיר ספק אמיתי. כשל בטוח',
      )
      return new FailClosedSmsProvider('console_provider_blocked_in_production')
    }
    return new ConsoleSmsProvider()
  }

  // ⚠️ ספק לא מוכר. **אין נפילה לקונסול, בשום סביבה.**
  console.error(`[sms] ספק לא מוכר "${kind}" — כשל בטוח`)
  return new FailClosedSmsProvider('unknown_sms_provider')
}

export function getSmsProvider(): SmsProvider {
  if (!cached) cached = resolveSmsProvider()
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
    // ⚠️ err בלבד. גוף ההודעה אינו נרשם — הוא מכיל את קוד ה-OTP.
    console.error('[sms] provider threw', err)
    return { ok: false, error: 'provider_error' }
  }
}

/** לבדיקות בלבד — מאפס את הספק שנשמר במטמון */
export function __resetSmsProviderCache() {
  cached = null
}
