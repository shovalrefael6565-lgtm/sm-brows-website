import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { approveAndSyncAppointment } from '@/lib/appointmentApproval'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * אישור בקשת pending. כל הלוגיקה (בדיקת התנגשות, ה-RPC האטומי, סנכרון
 * היומן עם claim/reconciliation) חיה ב-lib/appointmentApproval.ts —
 * ה-route רק אוכף הרשאה ומתרגם את התוצאה ל-HTTP.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'הבקשה לא נמצאה.' }, { status: 404 })
  }

  const result = await approveAndSyncAppointment(id, guard.userId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: result.status })
  }

  return NextResponse.json({ ok: true, whatsappUrl: result.whatsappUrl })
}
