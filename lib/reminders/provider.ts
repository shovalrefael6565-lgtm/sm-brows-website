import 'server-only'
import type {
  ReminderDeliveryResult,
  ReminderMessage,
  ReminderProvider,
  ReminderProviderName,
} from './types'
import { Sms019ReminderProvider, readSms019Config } from './sms019'
import { normalizeEnvFlag } from '@/lib/envFlag'

/**
 * בחירת הספק. ברירת המחדל — בכל סביבה, כולל production — היא disabled.
 *
 * ⚠️ ספק disabled אינו "ספק ששולח כלום ומחזיר שגיאה". הוא מסמן למערכת
 * **לא להתחיל לעבד בכלל**: אין claim, אין ניסיון, ואין שינוי סטטוס על אף
 * תזכורת. ראה isDispatchable() למטה ואת השימוש בו ב-dispatch.ts.
 *
 * הסיבה מעשית: אילו כל תזכורת הייתה נתפסת ומסומנת כשהספק כבוי, שלב 12 היה
 * מוצא ערימת תזכורות שכבר "טופלו" ולא היה יכול לשלוח אף אחת מהן — כולל
 * כאלה שחלון השליחה שלהן עדיין פתוח לגמרי.
 */

/**
 * ספק פיתוח. **אינו שולח כלום** ואינו יוצר חיבור לשום שירות חיצוני.
 *
 * ⚠️ הלוג מכיל מזהים בלבד. אין בו מספר טלפון, אין שם, ואין גוף הודעה —
 * גם לא בסימולציה, וגם לא בפיתוח. גוף ההודעה נבנה בזיכרון ונזרק.
 */
export class SimulatedReminderProvider implements ReminderProvider {
  readonly name = 'simulated' as const
  readonly isLive = false

  constructor(
    private readonly log: (line: string) => void = line => console.info(line),
  ) {}

  async send(message: ReminderMessage): Promise<ReminderDeliveryResult> {
    this.log(`[reminder:simulated] key=${message.idempotencyKey} — לא נשלח SMS`)
    return { outcome: 'accepted', providerMessageId: `simulated-${message.idempotencyKey}` }
  }
}

/**
 * ספק כבוי. קיים כדי שיהיה שם לספק שנרשם בשורה, ולא כדי להיקרא:
 * dispatch לעולם אינו מגיע ל-send() שלו, כי isDispatchable() עוצר לפניו.
 */
export class DisabledReminderProvider implements ReminderProvider {
  readonly name = 'disabled' as const
  readonly isLive = false

  async send(): Promise<ReminderDeliveryResult> {
    // הגנה בעומק: אם מסלול עתידי כן יקרא לכאן, שום דבר לא נשלח.
    return { outcome: 'permanent_error', errorCode: 'provider_disabled' }
  }
}

/**
 * הספק שהסביבה מגדירה.
 *
 * ⚠️ simulated מותר **רק** כאשר NODE_ENV אינו production *וגם* המשתנה
 * הוגדר במפורש. אין override ואין דגל חילוץ.
 *
 * ⚠️ sms_019 שולח SMS אמיתי. הוא נבחר אך ורק בבחירה מפורשת
 * (REMINDER_PROVIDER=sms_019) ורק כשכל משתני הסביבה שלו תקינים. כל חוסר או
 * פורמט פסול = נפילה ל-disabled, ולא ניסיון שליחה על תצורה חלקית.
 */
export function resolveReminderProvider(
  env: NodeJS.ProcessEnv = process.env,
): ReminderProvider {
  // ⚠️ נרמול ולא רק toLowerCase: ערך שהודבק ללוח הבקרה של Vercel גורר
  // איתו שורה חדשה או מרכאות, ו-`'sms_019\n' !== 'sms_019'` היה מפיל
  // ל-disabled בלי שאיש יראה הבדל בלוח. ראה lib/envFlag.ts.
  const requested = normalizeEnvFlag(env.REMINDER_PROVIDER) || 'disabled'

  if (requested === 'sms_019') {
    const cfg = readSms019Config(env)
    if (!cfg.ok) {
      // ⚠️ problems מכיל שמות משתנים בלבד — לעולם לא ערכים.
      console.error(
        `[reminders] sms_019 אינו מוגדר כראוי (${cfg.problems.join('; ')}) — נופל ל-disabled`,
      )
      return new DisabledReminderProvider()
    }
    return new Sms019ReminderProvider(cfg.config)
  }

  if (requested === 'simulated') {
    if (env.NODE_ENV === 'production') {
      console.error(
        '[reminders] REMINDER_PROVIDER=simulated אסור בפרודקשן — נופל ל-disabled',
      )
      return new DisabledReminderProvider()
    }
    return new SimulatedReminderProvider()
  }

  if (requested !== 'disabled') {
    console.error(`[reminders] ספק לא מוכר "${requested}" — נופל ל-disabled`)
  }
  return new DisabledReminderProvider()
}

/**
 * האם מותר בכלל להתחיל לעבד תזכורות עם הספק הזה.
 *
 * ספק שאינו dispatchable = אפס claim, אפס ניסיונות, אפס שינויי סטטוס.
 * התזכורות נשארות scheduled/retrying וממתינות — בדיוק כדי ששלב 12 יוכל
 * לקחת את אלה שעדיין תקפות ולשלוח אותן.
 */
export function isDispatchable(provider: ReminderProvider): boolean {
  return provider.name !== 'disabled'
}

export { Sms019ReminderProvider, readSms019Config }
export type { ReminderProvider, ReminderProviderName, ReminderMessage, ReminderDeliveryResult }
