import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { markCompletedByAdmin } from '@/lib/appointmentApproval'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * שלב 12 (0034) — סימון תור בודד כהושלם.
 *
 * ⚠️ כמו .../no-show ובשונה מ-.../cancel: אין כאן `waitUntil(dispatchNow(...))`.
 * הפעולה אינה מייצרת שום שורת התראה (ראה ההערה ב-appointmentApproval.ts
 * וב-0034), ולכן אין מה לנקז ואין SMS שיוצא ללקוחה.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'התור לא נמצא.' }, { status: 404 })
  }

  const result = await markCompletedByAdmin(id, guard.userId)

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message }, { status: result.status })
  }

  return NextResponse.json({ ok: true, outcome: result.outcome, message: result.message })
}
