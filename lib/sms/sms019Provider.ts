import 'server-only'
import { randomUUID } from 'crypto'
import type { SmsProvider, SmsMessage, SmsResult } from './types'
import { Sms019ReminderProvider, readSms019Config, type Sms019Config } from '@/lib/reminders/sms019'

/**
 * שלב 12B — ספק 019 עבור קודי ה-OTP.
 *
 * ═══ מה הקובץ הזה הוא, ומה הוא בכוונה איננו ═══
 *
 * הוא **מתאם (adapter) ותו לא**. כל הידע על 019 — מבנה הבקשה, מיפוי קודי
 * השגיאה, המרת הטלפון, ההחלטה מה נחשב עמום — יושב ב-lib/reminders/sms019.ts
 * וב-lib/reminders/sms019Mapping.ts, ו**אף אחד מהם לא שונה בשלב 12B**.
 *
 * ⚠️ למה לא חולץ לקוח 019 משותף: הקוד ההוא הוא היחיד במערכת ששלח SMS אמיתי
 * ואומת מקצה לקצה מול החשבון. כתיבתו מחדש כדי "לסדר את הארכיטקטורה" הייתה
 * מסכנת את המסלול היחיד שכבר עובד, בשביל מסלול שני שעדיין לא. העטיפה עולה
 * קובץ אחד; regression בתזכורות עולה תזכורות שלא נשלחות.
 *
 * ⚠️ למה לא שוכפלה לוגיקת ה-fetch: שני עותקים של מיפוי הכשלים היו מתפצלים.
 * המיפוי הוא ההחלטה המסוכנת ביותר בשלב הזה, ויש לו מימוש אחד.
 *
 * ═══ ההבדל המהותי בין תזכורת ל-OTP ═══
 *
 * תזכורת מבחינה בין ארבע תוצאות; OTP הוא בינארי. התרגום היחיד שאינו טריוויאלי
 * הוא `delivery_unknown` → `{ ok: true, uncertain: true }`. ראה את הנימוק
 * המלא ב-SmsResult.uncertain.
 */

export interface Sms019SmsDeps {
  /** מוזרק בבדיקות. בפרודקשן — fetch הגלובלי. */
  fetch?: typeof globalThis.fetch
  log?: (line: string) => void
}

export class Sms019SmsProvider implements SmsProvider {
  readonly name = 'sms_019'
  readonly isLive = true

  private readonly inner: Sms019ReminderProvider

  constructor(config: Sms019Config, deps: Sms019SmsDeps = {}) {
    const log = deps.log ?? ((line: string) => console.error(line))

    this.inner = new Sms019ReminderProvider(config, {
      fetch: deps.fetch,
      // ⚠️ הספק הפנימי מתייג את שורותיו `[reminders:sms_019]`. שליחת OTP
      // שמדווחת על עצמה כתזכורת הייתה מטעה בתחקור, ולכן הקידומת מוחלפת
      // כאן — במקום לשנות קובץ של שלב 12A בשביל מחרוזת.
      log: line => log(line.replace('[reminders:sms_019]', '[sms:sms_019]')),
    })
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    const result = await this.inner.send({
      to: message.to,
      body: message.body,
      // ⚠️ UUID גולמי, בדיוק כמו reminder.id — זו הצורה שאומתה מול 019
      // בשלב 12A. הוספת קידומת כמו `otp-` הייתה משנה את אורך השדה מול
      // ספק שאינו מתעד מגבלת אורך ל-`id`, בלי שום תמורה.
      //
      // 🔒 לעולם לא הטלפון ולא הקוד: השדה הזה נשלח ל-019 כ-external_id,
      // נשמר אצלו, ומופיע בשורת הלוג שלנו.
      idempotencyKey: randomUUID(),
    })

    switch (result.outcome) {
      case 'accepted':
        return { ok: true, providerMessageId: result.providerMessageId }

      case 'delivery_unknown':
        // 🔒 ok:true במכוון, ו-**בלי** notDelivered. שורת ה-OTP תקפה,
        // וייתכן מאוד שההודעה נשלחה.
        return { ok: true, uncertain: true, error: result.errorCode }

      case 'retryable_error':
      case 'permanent_error':
        /*
         * 🔒 notDelivered:true — ושתי הקטגוריות, לא רק permanent.
         *
         * ⚠️ זו אינה הקלה. זו האינווריאנטה המפורשת של sms019Mapping:
         * `retryable_error` הוא **רשימה סגורה** של כשלים שהוכח שקרו לפני
         * שהבקשה יצאה (ENOTFOUND · EAI_AGAIN · ECONNREFUSED · כשל TLS
         * handshake) או של דחיות מפורשות מהספק (HTTP 429 · קוד 5). בשני
         * המקרים **לא נכנסה הודעה לתור**. כל מה שאינו מוכח נופל מראש
         * ל-delivery_unknown, ולכן אינו מגיע לענף הזה בכלל.
         *
         * ⚠️ ההבחנה בין השניים נשמרת ב-errorCode לתחקור, אך אינה מוצגת
         * ללקוחה ואינה מפעילה retry: קוד OTP חדש הוא בקשה חדשה של המשתמשת,
         * עם ה-cooldown שלה — לא ניסיון חוזר שקט מצדנו.
         */
        return { ok: false, notDelivered: true, error: result.errorCode }
    }
  }
}

/**
 * בונה את הספק מהסביבה, או מחזיר את *שמות* המשתנים הפסולים.
 *
 * ⚠️ אינה זורקת ואינה נופלת לספק אחר. הבחירה מה לעשות עם תצורה חסרה היא
 * של lib/sms/index.ts, ושם היא חייבת להיות "כשל בטוח" — לא "קונסול".
 */
export function createSms019SmsProvider(
  env: NodeJS.ProcessEnv,
  deps: Sms019SmsDeps = {},
): { ok: true; provider: Sms019SmsProvider } | { ok: false; problems: string[] } {
  const cfg = readSms019Config(env)
  if (!cfg.ok) return { ok: false, problems: cfg.problems }
  return { ok: true, provider: new Sms019SmsProvider(cfg.config, deps) }
}
