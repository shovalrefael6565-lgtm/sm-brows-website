import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { updateCustomerNote } from '@/lib/db/crm'
import { CRM_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * עריכת הערה.
 *
 * ⚠️ ה-customerId מועבר ל-RPC ונדרש להתאים גם הוא, לא רק ה-noteId: זה מה
 * שחוסם עריכת הערה של לקוחה אחת דרך המזהה של לקוחה אחרת.
 *
 * אידמפוטנטי: תוכן זהה אחרי trim אינו מבצע UPDATE, אינו מזיז updated_at
 * ואינו כותב activity. הערה שהועברה לארכיון אינה ניתנת לעריכה.
 */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; noteId: string }> }
) {
  const params = await props.params;
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const { id: customerId, noteId } = params
  if (!UUID_RE.test(customerId) || !UUID_RE.test(noteId)) {
    return NextResponse.json({ error: 'not_found', message: 'ההערה לא נמצאה.' }, { status: 404 })
  }

  let body: { body?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  if (typeof body.body !== 'string') {
    return NextResponse.json(
      { error: 'note_empty', message: CRM_ERROR_MESSAGES.note_empty }, { status: 400 })
  }

  const text = body.body.trim()
  if (text.length === 0) {
    return NextResponse.json(
      { error: 'note_empty', message: CRM_ERROR_MESSAGES.note_empty }, { status: 400 })
  }
  if (text.length > 2000) {
    return NextResponse.json(
      { error: 'note_too_long', message: CRM_ERROR_MESSAGES.note_too_long }, { status: 400 })
  }

  const res = await updateCustomerNote(noteId, customerId, text, guard.userId)
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, message: CRM_ERROR_MESSAGES[res.error] ?? CRM_ERROR_MESSAGES.unknown },
      { status: res.error === 'note_not_found' ? 404 : 400 })
  }

  return NextResponse.json({ ok: true, changed: res.data.changed })
}
