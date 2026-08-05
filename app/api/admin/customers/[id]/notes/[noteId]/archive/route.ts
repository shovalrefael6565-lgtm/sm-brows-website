import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { archiveCustomerNote } from '@/lib/db/crm'
import { CRM_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * העברת הערה לארכיון. אין hard delete בשום מקום במערכת — אין route ואין
 * RPC שמוחק הערה, וה-body נשמר כפי שהוא.
 *
 * אידמפוטנטי: ארכוב חוזר של הערה שכבר בארכיון אינו כותב שוב ואינו יוצר
 * activity נוספת.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; noteId: string } },
) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const { id: customerId, noteId } = params
  if (!UUID_RE.test(customerId) || !UUID_RE.test(noteId)) {
    return NextResponse.json({ error: 'not_found', message: 'ההערה לא נמצאה.' }, { status: 404 })
  }

  const res = await archiveCustomerNote(noteId, customerId, guard.userId)
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, message: CRM_ERROR_MESSAGES[res.error] ?? CRM_ERROR_MESSAGES.unknown },
      { status: res.error === 'note_not_found' ? 404 : 400 })
  }

  return NextResponse.json({ ok: true, changed: res.data.changed })
}
