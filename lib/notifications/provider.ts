import 'server-only'
import {
  DisabledReminderProvider,
  SimulatedReminderProvider,
  Sms019ReminderProvider,
  readSms019Config,
  isDispatchable,
  type ReminderProvider,
} from '@/lib/reminders/provider'
import { normalizeEnvFlag } from '@/lib/envFlag'

/**
 * שלב 15F — בחירת הספק להתראות הטרנזקציוניות.
 *
 * ═══ למה קובץ נפרד, ולמה בכל זאת אותם מימושים ═══
 *
 * 🔒 **`REMINDER_PROVIDER` נעול ואין לגעת בו.** שימוש חוזר בו כאן היה
 * אומר ש-`REMINDER_PROVIDER=sms_019` מדליק בבת אחת את ההתראות **וגם** את
 * מנוע התזכורות, שאינו חלק מ-15F ולא נבדק בפרודקשן. שני משתני סביבה =
 * שתי מערכות שנדלקות בנפרד.
 *
 * ⚠️ ובכל זאת — **המימושים אותם מימושים**. `Sms019ReminderProvider` אינו
 * יודע דבר על תזכורות: הוא מקבל `{to, body, idempotencyKey}` ומחזיר את
 * חוזה ארבעת המצבים. שכפולו לטובת "נקיון שמות" היה מייצר עותק שני של
 * מיפוי שגיאות 019 — ושתי נקודות שיכולות להתבדר בדיוק במקום שבו טעות
 * שקטה שולחת SMS כפול.
 *
 * ⚠️ אותם credentials בדיוק (`SMS019_USERNAME/TOKEN/SOURCE`), ולכן אותו
 * שם שולח מאושר — `SM BROWS`.
 */

/**
 * הספק שהסביבה מגדירה עבור ההתראות.
 *
 * ⚠️ אינה זורקת. `readSms019Config` מחזירה תוצאה, וכל חוסר או פורמט פסול
 * מפיל ל-`disabled` במקום לנסות לשלוח על תצורה חלקית. זריקה כאן הייתה
 * מפילה את מסלול השליחה כולו — כלומר משתנה סביבה אחד חסר היה הופך כשל
 * שליחה לכשל של הבקשה העסקית.
 *
 * ⚠️ `simulated` מותר **רק** כאשר NODE_ENV אינו production. אין override.
 */
export function resolveNotificationProvider(
  env: NodeJS.ProcessEnv = process.env,
): ReminderProvider {
  // ⚠️ נרמול ולא רק toLowerCase: ערך שהודבק ללוח הבקרה של Vercel גורר
  // איתו שורה חדשה או מרכאות, ו-`'sms_019\n' !== 'sms_019'` היה מפיל
  // ל-disabled בלי שאיש יראה הבדל בלוח. ראה lib/envFlag.ts.
  const requested = normalizeEnvFlag(env.NOTIFICATION_PROVIDER) || 'disabled'

  if (requested === 'sms_019') {
    const cfg = readSms019Config(env)
    if (!cfg.ok) {
      // ⚠️ problems מכיל שמות משתנים בלבד — לעולם לא ערכים.
      console.error(
        `[notifications] sms_019 אינו מוגדר כראוי (${cfg.problems.join('; ')}) — נופל ל-disabled`,
      )
      return new DisabledReminderProvider()
    }
    return new Sms019ReminderProvider(cfg.config)
  }

  if (requested === 'simulated') {
    if (env.NODE_ENV === 'production') {
      console.error(
        '[notifications] NOTIFICATION_PROVIDER=simulated אסור בפרודקשן — נופל ל-disabled',
      )
      return new DisabledReminderProvider()
    }
    return new SimulatedReminderProvider()
  }

  if (requested !== 'disabled') {
    console.error(`[notifications] ספק לא מוכר "${requested}" — נופל ל-disabled`)
  }
  return new DisabledReminderProvider()
}

export { isDispatchable }
export type { ReminderProvider }
