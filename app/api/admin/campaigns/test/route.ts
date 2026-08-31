import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { normalizePhone } from '@/lib/phone'
import { evaluateMarketingBody, renderMarketingSms, OPT_OUT_TOKEN_LENGTH } from '@/lib/marketing/message'
import { resolveMarketingProvider } from '@/lib/marketing/provider'

export const dynamic = 'force-dynamic'

/**
 * "שליחת הודעת בדיקה" — **אך ורק** למספר הבעלים מהסביבה.
 *
 * 🔒 היעד אינו מגיע מגוף הבקשה בשום צורה. ADMIN_PHONE_E164 בלבד, ולכן אין
 * דרך להפוך את הכפתור הזה לשליחה ללקוחה.
 *
 * ⚠️ משתמש **באותו renderer** של השליחה האמיתית, עם token דמה באורך
 * הנכון: מה ששובל מקבלת לטלפון זהה באורך ובמבנה למה שתקבל הלקוחה.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response
  if (!isSameOrigin(req)) return NextResponse.json({ error: 'bad_origin' }, { status: 403 })

  let body: { body?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  const text = typeof body.body === 'string' ? body.body : ''
  const stats = evaluateMarketingBody(text)
  if (stats.error) {
    return NextResponse.json({ error: 'invalid_body', message: 'נוסח ההודעה אינו תקין.' }, { status: 400 })
  }

  const to = normalizePhone(process.env.ADMIN_PHONE_E164 ?? '')
  if (!to) {
    return NextResponse.json(
      { error: 'no_test_phone', message: 'ADMIN_PHONE_E164 אינו מוגדר בסביבה.' }, { status: 500 })
  }

  const provider = resolveMarketingProvider()
  const res = await provider.send({
    to,
    // token דמה באורך אמיתי — הבדיקה חייבת להיות זהה באורכה למה שיישלח.
    body: renderMarketingSms(text, 't'.repeat(OPT_OUT_TOKEN_LENGTH)),
    idempotencyKey: crypto.randomUUID(),
  })

  if (res.outcome === 'accepted') {
    return NextResponse.json({ ok: true, provider: provider.name, message: 'הודעת הבדיקה נשלחה למספר הבעלים.' })
  }
  if (res.outcome === 'delivery_unknown') {
    return NextResponse.json({ ok: true, provider: provider.name, message: 'הודעת הבדיקה נשלחה, אך הספק לא אישר קבלה.' })
  }
  return NextResponse.json({
    ok: false, provider: provider.name,
    message: provider.name === 'disabled'
      ? 'הדיוור כבוי (MARKETING_SMS_PROVIDER=disabled) — לא נשלחה הודעה.'
      : 'שליחת הודעת הבדיקה נכשלה.',
  })
}
