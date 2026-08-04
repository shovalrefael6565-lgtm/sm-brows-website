import type { SmsProvider, SmsMessage, SmsResult } from './types'

/**
 * ספק Twilio — מימוש מלא מול REST API, בלי תלות ב-SDK.
 *
 * מופעל ע"י SMS_PROVIDER=twilio. דורש את משתני הסביבה:
 *   TWILIO_ACCOUNT_SID · TWILIO_AUTH_TOKEN · TWILIO_FROM
 * (TWILIO_FROM = מספר Twilio או Sender ID רשום)
 *
 * הקובץ הזה עדיין לא נבדק מול חשבון אמיתי — ראה דוח השלב.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio'
  readonly isLive = true

  private readonly accountSid: string
  private readonly authToken: string
  private readonly from: string

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_FROM
    if (!accountSid || !authToken || !from) {
      throw new Error(
        'TwilioSmsProvider requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM',
      )
    }
    this.accountSid = accountSid
    this.authToken = authToken
    this.from = from
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: message.to,
          From: this.from,
          Body: message.body,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        // לא מדליפים את גוף ההודעה או את המספר ללוג השגיאות
        console.error('[sms:twilio] send failed', res.status, data?.code, data?.message)
        return { ok: false, error: data?.message ?? `http_${res.status}` }
      }

      return { ok: true, providerMessageId: data?.sid }
    } catch (err) {
      console.error('[sms:twilio] network error', err)
      return { ok: false, error: 'network_error' }
    }
  }
}
