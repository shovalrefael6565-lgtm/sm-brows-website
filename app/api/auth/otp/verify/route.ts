import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/phone'
import { verifyOtp } from '@/lib/db/otpStore'
import { findOrCreateCustomer } from '@/lib/db/customers'
import { createSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/** נוסחי השגיאה שמוצגים ללקוחה — מכוונים לפעולה ולא לניסוח טכני */
const MESSAGES: Record<string, string> = {
  no_code: 'לא נמצא קוד פעיל. יש לבקש קוד חדש.',
  expired: 'תוקף הקוד פג. יש לבקש קוד חדש.',
  too_many: 'יותר מדי ניסיונות. יש לבקש קוד חדש.',
  wrong: 'הקוד שגוי. בדקי ונסי שוב.',
  error: 'משהו השתבש. נסי שוב בעוד רגע.',
}

export async function POST(req: NextRequest) {
  let body: { phone?: string; code?: string; purpose?: string; fullName?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const phone = normalizePhone(body.phone ?? '')
  const code = (body.code ?? '').trim()

  if (!phone || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: 'bad_request', message: 'יש להזין קוד בן 6 ספרות.' },
      { status: 400 },
    )
  }

  const purpose = body.purpose === 'booking' ? 'booking' : 'login'
  const outcome = await verifyOtp(phone, purpose, code)

  if (outcome !== 'ok') {
    // 401 ולא 400 — הקוד תקין מבחינת פורמט, האימות הוא שנכשל
    return NextResponse.json(
      { error: outcome, message: MESSAGES[outcome] },
      { status: outcome === 'error' ? 500 : 401 },
    )
  }

  const { customer, error } = await findOrCreateCustomer(phone, body.fullName)
  if (!customer) {
    console.error('[otp/verify] customer resolution failed', error)
    return NextResponse.json(
      { error: 'server_error', message: 'משהו השתבש. נסי שוב בעוד רגע.' },
      { status: 500 },
    )
  }

  if (customer.is_blocked) {
    return NextResponse.json(
      { error: 'blocked', message: 'לא ניתן להתחבר. יש ליצור קשר בוואטסאפ.' },
      { status: 403 },
    )
  }

  await createSession({ customerId: customer.id, phone: customer.phone_e164 })

  return NextResponse.json({
    ok: true,
    customer: { fullName: customer.full_name },
  })
}
