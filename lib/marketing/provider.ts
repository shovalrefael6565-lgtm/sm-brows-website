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
 * בחירת הספק לדיוור.
 *
 * ═══ למה דגל שלישי, ולמה בכל זאת אותו מימוש ═══════════════════════════════
 *
 * זה בדיוק אותו שיקול שהוליד את lib/notifications/provider.ts, ומאותה
 * סיבה: `REMINDER_PROVIDER` ו-`NOTIFICATION_PROVIDER` נעולים, ושימוש חוזר
 * בהם כאן היה אומר שדגל אחד מדליק בבת אחת גם את התזכורות וגם דיוור המוני.
 * **שלושה משתני סביבה = שלוש מערכות שנדלקות בנפרד**, וכיבוי הדיוור אינו
 * נוגע בתזכורת של אף לקוחה.
 *
 * 🔴 ברירת המחדל היא `disabled`, במכוון: מערכת דיוור שנדלקת מעצמה ברגע
 * שהקוד נפרס היא בדיוק התאונה שאסור שתקרה. כל עוד `MARKETING_SMS_PROVIDER`
 * אינו מוגדר בפרודקשן, המסך עובד במלואו ואף הודעה אינה יוצאת.
 *
 * ⚠️ אותם credentials של 019 ואותו שם שולח מאושר. אין כאן חשבון שני.
 */
export function resolveMarketingProvider(
  env: NodeJS.ProcessEnv = process.env,
): ReminderProvider {
  const requested = normalizeEnvFlag(env.MARKETING_SMS_PROVIDER) || 'disabled'

  if (requested === 'sms_019') {
    const cfg = readSms019Config(env)
    if (!cfg.ok) {
      // ⚠️ שמות משתנים בלבד, לעולם לא ערכים.
      console.error(
        `[marketing] sms_019 אינו מוגדר כראוי (${cfg.problems.join('; ')}) — נופל ל-disabled`,
      )
      return new DisabledReminderProvider()
    }
    return new Sms019ReminderProvider(cfg.config)
  }

  if (requested === 'simulated') {
    if (env.NODE_ENV === 'production') {
      console.error('[marketing] MARKETING_SMS_PROVIDER=simulated אסור בפרודקשן — נופל ל-disabled')
      return new DisabledReminderProvider()
    }
    return new SimulatedReminderProvider()
  }

  if (requested !== 'disabled') {
    console.error(`[marketing] ספק לא מוכר "${requested}" — נופל ל-disabled`)
  }
  return new DisabledReminderProvider()
}

/** האם הדיוור מסוגל לשלוח בפועל — להצגה במסך לפני קמפיין */
export function marketingProviderName(env: NodeJS.ProcessEnv = process.env): string {
  return resolveMarketingProvider(env).name
}
