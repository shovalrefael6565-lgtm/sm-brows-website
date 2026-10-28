import 'server-only'
import {
  DisabledReminderProvider,
  SimulatedReminderProvider,
  Sms019ReminderProvider,
  readSms019Config,
  type ReminderProvider,
} from '@/lib/reminders/provider'
import { normalizeEnvFlag } from '@/lib/envFlag'

/**
 * הספק של הודעת ההשקה.
 *
 * ═══ למה דגל רביעי, ולמה בכל זאת אותו מימוש ═══════════════════════════════
 *
 * אותו שיקול בדיוק שהוליד את lib/notifications/provider.ts ואת
 * lib/marketing/provider.ts: `REMINDER_PROVIDER`, `NOTIFICATION_PROVIDER`
 * ו-`MARKETING_SMS_PROVIDER` נעולים כל אחד למערכת שלו, ושימוש חוזר בהם
 * כאן היה אומר שדגל אחד מדליק שתי מערכות. **ארבעה משתנים = ארבע מערכות
 * שנדלקות בנפרד**, וכיבוי אחת אינו נוגע באחרות.
 *
 * 🔴 ברירת המחדל `disabled`: מערכת שליחה שנדלקת מעצמה ברגע שהקוד נפרס
 * היא בדיוק התאונה שאסור שתקרה. כל עוד `PRODUCT_LAUNCH_SMS_PROVIDER`
 * אינו מוגדר, מסך הניהול עובד במלואו ואף הודעה אינה יוצאת.
 *
 * ⚠️ אותם credentials של 019 ואותו שם שולח מאושר. אין חשבון שני.
 *
 * ⚠️ **זו אינה מערכת הקמפיינים.** היא אינה נוגעת ב-sms_campaigns,
 * ב-marketing_consent וב-marketing_opted_out_at: ההודעה הזו היא מימוש של
 * בקשה מפורשת של הלקוחה לעדכון אחד, ולא דיוור.
 */
export function resolveProductLaunchProvider(
  env: NodeJS.ProcessEnv = process.env,
): ReminderProvider {
  const requested = normalizeEnvFlag(env.PRODUCT_LAUNCH_SMS_PROVIDER) || 'disabled'

  if (requested === 'sms_019') {
    const cfg = readSms019Config(env)
    if (!cfg.ok) {
      // ⚠️ שמות משתנים בלבד, לעולם לא ערכים.
      console.error(
        `[product-launch] sms_019 אינו מוגדר כראוי (${cfg.problems.join('; ')}) — נופל ל-disabled`,
      )
      return new DisabledReminderProvider()
    }
    return new Sms019ReminderProvider(cfg.config)
  }

  if (requested === 'simulated') {
    if (env.NODE_ENV === 'production') {
      console.error('[product-launch] simulated אסור בפרודקשן — נופל ל-disabled')
      return new DisabledReminderProvider()
    }
    return new SimulatedReminderProvider()
  }

  if (requested !== 'disabled') {
    console.error(`[product-launch] ספק לא מוכר "${requested}" — נופל ל-disabled`)
  }
  return new DisabledReminderProvider()
}

/** שם הספק — להצגה במסך הניהול לפני שליחה. */
export function productLaunchProviderName(env: NodeJS.ProcessEnv = process.env): string {
  return resolveProductLaunchProvider(env).name
}
