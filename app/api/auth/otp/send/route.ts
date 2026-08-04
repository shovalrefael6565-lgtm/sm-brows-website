import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone, maskPhone } from '@/lib/phone'
import { issueOtp } from '@/lib/db/otpStore'
import { sendSms } from '@/lib/sms'
import { otpMessage } from '@/lib/sms/templates'
import { OTP_TTL_MINUTES } from '@/lib/otp'

export const dynamic = 'force-dynamic'

/**
 * שליחת קוד אימות.
 *
 * שיקול אבטחה מרכזי: התשובה **זהה** בין מספר שרשום במערכת למספר שאינו
 * רשום. אחרת אפשר היה להשתמש ב-endpoint הזה כדי לברר אילו מספרי טלפון
 * הם לקוחות של העסק — דליפת פרטיות בפני עצמה.
 */
export async function POST(req: NextRequest) {
  let body: { phone?: string; purpose?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const phone = normalizePhone(body.phone ?? '')
  if (!phone) {
    return NextResponse.json(
      { error: 'invalid_phone', message: 'מספר הטלפון אינו תקין. יש להזין מספר נייד ישראלי.' },
      { status: 400 },
    )
  }

  const purpose = body.purpose === 'booking' ? 'booking' : 'login'

  // ה-IP משמש להגבלת קצב בלבד ואינו נשמר בשום מקום אחר
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null

  const result = await issueOtp(phone, purpose, ip)

  if (!result.ok) {
    if (result.limit) {
      return NextResponse.json(
        {
          error: result.limit.reason,
          message: result.limit.message,
          retryAfterSec: result.limit.retryAfterSec,
        },
        { status: 429 },
      )
    }
    return NextResponse.json(
      { error: 'server_error', message: 'לא הצלחנו לשלוח את הקוד. נסי שוב בעוד רגע.' },
      { status: 500 },
    )
  }

  const sms = await sendSms(otpMessage(phone, result.code!, OTP_TTL_MINUTES))
  if (!sms.ok) {
    console.error('[otp/send] sms delivery failed', sms.error)
    return NextResponse.json(
      { error: 'sms_failed', message: 'לא הצלחנו לשלוח את ההודעה. נסי שוב או צרי קשר בוואטסאפ.' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    maskedPhone: maskPhone(phone),
    expiresInMinutes: OTP_TTL_MINUTES,
  })
}
