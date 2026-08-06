import 'server-only'
import type {
  ReminderDeliveryResult,
  ReminderMessage,
  ReminderProvider,
  ReminderProviderName,
} from './types'

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
 * הוגדר במפורש. אין override, אין דגל חילוץ, ואין דרך להפעיל סימולציה
 * בפרודקשן בשלב 11 — production הוא disabled עד שיחובר 019 בשלב 12.
 */
export function resolveReminderProvider(
  env: NodeJS.ProcessEnv = process.env,
): ReminderProvider {
  const requested = (env.REMINDER_PROVIDER ?? 'disabled').toLowerCase()

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

export type { ReminderProvider, ReminderProviderName, ReminderMessage, ReminderDeliveryResult }
