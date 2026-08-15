import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { markNoShowByAdmin } from '@/lib/appointmentApproval'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * שלב 16 (0029) — סימון אי-הגעה ע"י שובל.
 *
 * כל הלוגיקה חיה ב-lib/appointmentApproval.ts. ה-route אוכף הרשאה ומתרגם
 * ל-HTTP, בדיוק כמו .../cancel/route.ts.
 *
 * ⚠️ בשונה מ-cancel, אין כאן `waitUntil(dispatchNow(...))`: הפעולה הזו
 * אינה מייצרת שום שורת התראה (ראה ההערה ב-appointmentApproval.ts), ולכן
 * אין מה לנקז.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'התור לא נמצא.' }, { status: 404 })
  }

  const result = await markNoShowByAdmin(id, guard.userId)

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    )
  }

  return NextResponse.json({ ok: true, outcome: result.outcome, message: result.message })
}
