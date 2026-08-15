import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { createCustomerNote } from '@/lib/db/crm'
import { CRM_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * יצירת הערה פנימית.
 *
 * client_request_id הוא מפתח ה-idempotency: הדפדפן יוצר אותו פעם אחת לכל
 * ניסיון יצירה ושולח אותו שוב בכל retry. שליחה חוזרת עם אותו תוכן מחזירה
 * את אותה הערה בלי ליצור כפילות ובלי activity נוספת; שליחה עם אותו מפתח
 * ותוכן *שונה* נדחית במפורש, כדי שלא נחזיר הצלחה על תוכן שלא נשמר.
 *
 * disabled על הכפתור לבדו אינו מספיק — תגובה יכולה ללכת לאיבוד אחרי
 * שה-DB כבר כתב.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const customerId = params.id
  if (!UUID_RE.test(customerId)) {
    return NextResponse.json({ error: 'not_found', message: 'הלקוחה לא נמצאה.' }, { status: 404 })
  }

  let body: { body?: unknown; client_request_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  if (typeof body.client_request_id !== 'string' || !UUID_RE.test(body.client_request_id)) {
    return NextResponse.json(
      { error: 'missing_request_id', message: CRM_ERROR_MESSAGES.missing_request_id }, { status: 400 })
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

  const res = await createCustomerNote(customerId, text, guard.userId, body.client_request_id)
  if (!res.ok) {
    const status =
      res.error === 'customer_not_found' ? 404 :
      res.error === 'idempotency_key_reused' ? 409 : 400
    return NextResponse.json(
      { error: res.error, message: CRM_ERROR_MESSAGES[res.error] ?? CRM_ERROR_MESSAGES.unknown },
      { status })
  }

  return NextResponse.json({ ok: true, noteId: res.data.note_id, created: res.data.created })
}
