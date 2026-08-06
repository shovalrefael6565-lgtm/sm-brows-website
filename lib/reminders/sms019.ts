import 'server-only'
import type { ReminderDeliveryResult, ReminderMessage, ReminderProvider } from './types'
import {
  SMS019_API_URL,
  SMS019_MAX_MESSAGE_CHARS,
  SMS019_SOURCE_RE,
  buildSms019Payload,
  classifySms019Body,
  classifySms019HttpStatus,
  classifySms019TransportError,
  toLocalIsraeliPhone,
} from './sms019Mapping'

/**
 * שלב 12A — ספק 019.
 *
 * 🔒 **הספק היחיד במערכת שבו isLive = true.** מרגע שהוא נבחר,
 * finish_reminder_attempt כותבת status='sent' על תוצאה accepted, כי v_live
 * מחושב שם כ-`p_provider not in ('disabled','simulated','fake')`. אין כאן
 * שינוי סכמה ואין migration — 0011 נבנתה בדיוק לרגע הזה.
 *
 * ⚠️ 'sent' במסד פירושו **"נמסרה לספק השליחה"**, לא "הגיעה לטלפון".
 * status=0 של 019 הוא קבלת הבקשה למשלוח. אישור מסירה אמיתי קיים רק ב-DLR,
 * שאינו ממומש בשלב 12A. התווית במסך הניהול מנוסחת בהתאם.
 *
 * ═══ מה הקובץ הזה לעולם לא עושה ═══
 *
 *   • לא זורק. אף פעם. ראה למטה.
 *   • לא מדפיס token, מספר טלפון או גוף הודעה — בשום רמת לוג.
 *   • לא מחזיר, שומר או מעביר הלאה את גוף התשובה הגולמי של 019.
 *   • לא קורא כתובת מ-env. יש קבוע אחד, SMS019_API_URL.
 */

/** ⚠️ שמות משתנים בלבד. הערכים עצמם לעולם אינם נכנסים ללוג. */
const REQUIRED_ENV = ['SMS019_USERNAME', 'SMS019_TOKEN', 'SMS019_SOURCE'] as const

const DEFAULT_TIMEOUT_MS = 10_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 30_000

export interface Sms019Config {
  username: string
  token: string
  source: string
  timeoutMs: number
}

export type Sms019ConfigResult =
  | { ok: true; config: Sms019Config }
  /** ⚠️ שמות המשתנים החסרים/הפסולים, לא הערכים. בטוח להדפסה. */
  | { ok: false; problems: string[] }

function readTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < MIN_TIMEOUT_MS || n > MAX_TIMEOUT_MS) return DEFAULT_TIMEOUT_MS
  return Math.floor(n)
}

/**
 * קריאת התצורה מהסביבה.
 *
 * ⚠️ מחזירה תוצאה ואינה זורקת. TwilioSmsProvider זורק ב-constructor שלו,
 * וזה מה שאסור כאן: resolveReminderProvider נקראת בתוך defaultDeps() של
 * ה-dispatcher, וזריקה שם הייתה מפילה את מסלול השליחה כולו — כלומר משתנה
 * סביבה חסר אחד היה מוריד את כל התזכורות במקום להשאיר אותן ממתינות.
 */
export function readSms019Config(env: NodeJS.ProcessEnv): Sms019ConfigResult {
  const problems: string[] = []

  for (const key of REQUIRED_ENV) {
    const v = env[key]
    if (typeof v !== 'string' || v.trim() === '') problems.push(`${key} חסר`)
  }

  const source = env.SMS019_SOURCE?.trim() ?? ''
  if (source !== '' && !SMS019_SOURCE_RE.test(source)) {
    // ⚠️ מתועד: עד 11 תווים, ספרות ואותיות אנגליות בלבד. נבדק כאן ולא
    // בזמן השליחה, כדי ש-source פסול יכבה את הספק במקום לשרוף תזכורות
    // אחת-אחת מול שגיאה 992.
    problems.push('SMS019_SOURCE אינו עומד בפורמט (עד 11 תווים, אותיות אנגליות וספרות)')
  }

  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    config: {
      username: env.SMS019_USERNAME!.trim(),
      token: env.SMS019_TOKEN!.trim(),
      source,
      timeoutMs: readTimeoutMs(env.SMS019_TIMEOUT_MS),
    },
  }
}

export interface Sms019Deps {
  /** מוזרק בבדיקות. בפרודקשן — fetch הגלובלי. */
  fetch: typeof globalThis.fetch
  log: (line: string) => void
}

export class Sms019ReminderProvider implements ReminderProvider {
  readonly name = 'sms_019' as const
  readonly isLive = true

  private readonly config: Sms019Config
  private readonly deps: Sms019Deps

  constructor(config: Sms019Config, deps: Partial<Sms019Deps> = {}) {
    this.config = config
    this.deps = {
      fetch: deps.fetch ?? ((...args) => globalThis.fetch(...args)),
      log: deps.log ?? (line => console.error(line)),
    }
  }

  async send(message: ReminderMessage): Promise<ReminderDeliveryResult> {
    const result = await this.attempt(message)
    if (result.outcome !== 'accepted') {
      // ⚠️ מזהים וקודים בלבד. אין טלפון, אין גוף הודעה, אין token, ואין
      // מילה אחת מהתשובה של הספק.
      this.deps.log(
        `[reminders:sms_019] outcome=${result.outcome} code=${result.errorCode} key=${message.idempotencyKey}`,
      )
    }
    return result
  }

  private async attempt(message: ReminderMessage): Promise<ReminderDeliveryResult> {
    // ── ולידציה מקומית: נכשלת לפני שנוצר חיבור, ולכן מוכח שלא נשלח ──────
    const localPhone = toLocalIsraeliPhone(message.to)
    if (localPhone === null) {
      return { outcome: 'permanent_error', errorCode: 'sms019_unsupported_destination' }
    }
    if (typeof message.body !== 'string' || message.body.trim() === '') {
      return { outcome: 'permanent_error', errorCode: 'sms019_message_empty' }
    }
    if (message.body.length > SMS019_MAX_MESSAGE_CHARS) {
      return { outcome: 'permanent_error', errorCode: 'sms019_message_too_long' }
    }

    const payload = buildSms019Payload({
      username: this.config.username,
      source: this.config.source,
      localPhone,
      message: message.body,
      // ⚠️ reminder.id. יציב בכל retry, ומשמש כ-external_id לשאילתת DLR.
      // אינו idempotency key: ל-019 אין idempotency מוכחת (ראה sms019Mapping).
      externalId: message.idempotencyKey,
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)

    let res: Response
    try {
      res = await this.deps.fetch(SMS019_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (err) {
      // ⚠️ מכאן והלאה אי אפשר לדעת אם הבקשה יצאה. הסיווג שמרני בכוונה.
      return classifySms019TransportError(err)
    } finally {
      clearTimeout(timer)
    }

    const byHttp = classifySms019HttpStatus(res.status)
    if (byHttp) return byHttp

    let body: unknown
    try {
      body = await res.json()
    } catch {
      // HTTP 200 עם גוף שאי אפשר לפענח: הבקשה הגיעה, וייתכן מאוד שההודעה
      // בדרך. זו ההגדרה של delivery_unknown.
      return { outcome: 'delivery_unknown', errorCode: 'sms019_malformed_response' }
    }

    return classifySms019Body(body)
  }
}
