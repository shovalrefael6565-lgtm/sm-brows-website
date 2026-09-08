import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { setWaitlistRequestStatus, type WaitlistStatus } from '@/lib/db/waitlist'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: WaitlistStatus[] = ['open', 'contacted', 'closed']

/**
 * שינוי סטטוס של בקשת המתנה — הפעולה הניהולית **היחידה** בשלב הזה.
 *
 * 🔒 אין כאן המרה לתור, אין יצירת אירוע ביומן ואין SMS. שובל רואה את
 * הבקשה, מתקשרת, ומסמנת. קביעת התור עצמה נעשית במסלול הקיים
 * (/admin/appointments/new) ללא שום קשר לשורה כאן.
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: { id?: unknown; status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'הבקשה לא נמצאה.' }, { status: 404 })
  }

  const status = body.status as WaitlistStatus
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: 'bad_status', message: 'סטטוס לא תקין.' }, { status: 400 })
  }

  const result = await setWaitlistRequestStatus(id, status)
  if (!result.ok) {
    return NextResponse.json({ error: 'failed', message: 'העדכון נכשל. נסי שוב.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
