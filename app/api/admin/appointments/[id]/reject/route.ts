import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { rejectAppointment } from '@/lib/appointmentApproval'
import { dispatchNow } from '@/lib/notifications/dispatch'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** דחיית בקשת pending. אין כאן שום אינטראקציה עם Google Calendar. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'הבקשה לא נמצאה.' }, { status: 404 })
  }

  const result = await rejectAppointment(id, guard.userId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: result.status })
  }

  // 🔒 15F — אחרי ה-COMMIT. ראה ההערה המלאה ב-approve/route.ts.
  waitUntil(dispatchNow(id))

  return NextResponse.json({ ok: true, whatsappUrl: result.whatsappUrl })
}
