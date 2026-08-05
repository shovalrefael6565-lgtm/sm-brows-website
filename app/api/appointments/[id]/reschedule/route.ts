import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { rescheduleForCustomer } from '@/lib/appointmentSelfService'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/**
 * שינוי מועד של תור confirmed ע"י הלקוחה.
 *
 * מהדפדפן מתקבלים אך ורק שלושה ערכים: התאריך המבוקש, השעה המבוקשת,
 * והמועד שהוצג על המסך (expectedStartsAt — משמש רק כדי להבחין בין
 * "לא נבחר מועד חדש" לבין התאוששות מבקשה שכבר הצליחה).
 *
 * כל השאר — מי הלקוחה, איזה תור, מה משך הטיפול, מה המחיר, מה הסטטוס
 * ומה המדיניות — נטען בשרת. אין שום שדה מגוף הבקשה שיכול לשנות טיפול,
 * מחיר, משך או בעלות.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.customerId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'התור לא נמצא.' }, { status: 404 })
  }

  let body: { isoDate?: unknown; time?: unknown; expectedStartsAt?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const isoDate = typeof body.isoDate === 'string' ? body.isoDate : ''
  const time = typeof body.time === 'string' ? body.time : ''
  if (!ISO_DATE_RE.test(isoDate) || !TIME_RE.test(time)) {
    return NextResponse.json(
      { error: 'invalid_slot', message: 'המועד שנבחר אינו תקין.' },
      { status: 400 },
    )
  }

  // ערך לא תקין כאן אינו שגיאה — הוא רק מוותר על ההבחנה בנוסח ההודעה
  const expectedRaw = typeof body.expectedStartsAt === 'string' ? body.expectedStartsAt : null
  const expectedStartsAt =
    expectedRaw && !Number.isNaN(Date.parse(expectedRaw)) ? expectedRaw : null

  const result = await rescheduleForCustomer({
    appointmentId: id,
    customerId: session.customerId,
    isoDate,
    time,
    expectedStartsAt,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message, offerWhatsApp: result.offerWhatsApp ?? false },
      { status: result.status },
    )
  }

  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    calendarSynced: result.calendarSynced,
    message: result.message,
  })
}
