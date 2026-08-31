import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { createCampaign } from '@/lib/db/marketing'
import { evaluateMarketingBody } from '@/lib/marketing/message'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MESSAGES: Record<string, string> = {
  invalid_body:   'נוסח ההודעה אינו תקין או חורג ממה שהספק מאפשר.',
  no_recipients:  'לא נבחרו נמענות.',
  missing_secret: 'סוד קישור ההסרה אינו מוגדר בסביבה. אי אפשר לשלוח דיוור בלי דרך להסרה.',
  db_error:       'שמירת הקמפיין נכשלה. נסי שוב.',
}

/**
 * יצירת קמפיין דיוור ובניית רשימת הנמענות. **אינה שולחת דבר.**
 *
 * client_request_id הוא מפתח ה-idempotency: הדפדפן יוצר אותו פעם אחת לכל
 * ניסיון ושולח אותו שוב בכל retry. לחיצה כפולה או תשובה שאבדה מחזירות את
 * אותו קמפיין, ולא יוצרות שני.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response
  if (!isSameOrigin(req)) return NextResponse.json({ error: 'bad_origin' }, { status: 403 })

  let body: { body?: unknown; customerIds?: unknown; client_request_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  if (typeof body.client_request_id !== 'string' || !UUID_RE.test(body.client_request_id)) {
    return NextResponse.json({ error: 'missing_request_id', message: 'מזהה בקשה חסר.' }, { status: 400 })
  }

  const text = typeof body.body === 'string' ? body.body : ''
  // 🔒 אותה פונקציה בדיוק שהמסך סופר בה. אין שני חישובים.
  const stats = evaluateMarketingBody(text)
  if (stats.error) {
    return NextResponse.json({
      error: 'invalid_body',
      message: stats.error === 'empty'
        ? 'ההודעה ריקה.'
        : `ההודעה הסופית היא ${stats.chars} תווים וחורגת מהמקסימום של הספק. יש לקצר — ההודעה לא תיחתך אוטומטית.`,
    }, { status: 400 })
  }

  const customerIds = Array.isArray(body.customerIds)
    ? body.customerIds.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
    : []

  const res = await createCampaign({
    adminId: guard.userId,
    body: text,
    clientRequestId: body.client_request_id,
    customerIds,
  })

  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, message: MESSAGES[res.error] ?? 'הפעולה נכשלה.' },
      { status: res.error === 'db_error' || res.error === 'missing_secret' ? 500 : 400 })
  }

  return NextResponse.json({
    campaignId: res.data.campaign.id,
    replayed: res.data.replayed,
    recipientCount: res.data.campaign.recipient_count,
    skippedCount: res.data.campaign.skipped_count,
    duplicatesDropped: res.data.duplicatesDropped,
    segments: res.data.campaign.segments,
  })
}
