import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { cancelPendingAppointment } from '@/lib/db/appointments'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ביטול בקשת pending ע"י הלקוחה שיצרה אותה. אין כאן ביטול של תור confirmed —
 * cancel_pending_appointment ב-DB מתנה את הפעולה בסטטוס pending ובבעלות
 * ה-customer_id מה-session, כך שאי אפשר לבטל בקשה של לקוחה אחרת.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.customerId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const result = await cancelPendingAppointment(id, session.customerId)
  if (!result.ok) {
    if (result.error === 'not_found') {
      return NextResponse.json(
        { error: 'not_found', message: 'הבקשה לא נמצאה, כבר טופלה, או שאינה שלך.' },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: 'server_error', message: 'הביטול נכשל. נסי שוב.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
