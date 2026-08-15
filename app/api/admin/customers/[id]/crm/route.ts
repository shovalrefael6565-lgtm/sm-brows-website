import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { setCustomerCrmStatus, setCustomerSource } from '@/lib/db/crm'
import { CRM_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * עדכון סטטוס CRM ו/או מקור הגעה.
 *
 * ⚠️ ה-actor נלקח מ-guard.userId — מה-session המאומת בשרת — ולעולם לא מגוף
 * הבקשה. ה-RPC עצמו מאמת שוב שהמזהה קיים בטבלת admins, כך שגם אם ה-route
 * ייפרץ, ה-DB דוחה בלי לשנות דבר ובלי לכתוב activity.
 *
 * הפעולות אידמפוטנטיות: שינוי לאותו ערך אינו כותב activity נוספת ומחזיר
 * הצלחה עם changed:false.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
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

  let body: { crm_status?: unknown; source_key?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  const wantsStatus = body.crm_status !== undefined
  const wantsSource = body.source_key !== undefined
  if (!wantsStatus && !wantsSource) {
    return NextResponse.json({ error: 'bad_request', message: 'לא נשלח שינוי.' }, { status: 400 })
  }

  const changes: Record<string, boolean> = {}

  if (wantsStatus) {
    if (body.crm_status !== 'active' && body.crm_status !== 'inactive') {
      return NextResponse.json(
        { error: 'invalid_status', message: CRM_ERROR_MESSAGES.invalid_status }, { status: 400 })
    }
    const res = await setCustomerCrmStatus(customerId, body.crm_status, guard.userId)
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error, message: CRM_ERROR_MESSAGES[res.error] ?? CRM_ERROR_MESSAGES.unknown },
        { status: res.error === 'customer_not_found' ? 404 : 400 })
    }
    changes.crm_status = res.data.changed
  }

  if (wantsSource) {
    if (typeof body.source_key !== 'string' || !/^[a-z_]{2,32}$/.test(body.source_key)) {
      return NextResponse.json(
        { error: 'invalid_source', message: CRM_ERROR_MESSAGES.invalid_source }, { status: 400 })
    }
    const res = await setCustomerSource(customerId, body.source_key, guard.userId)
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error, message: CRM_ERROR_MESSAGES[res.error] ?? CRM_ERROR_MESSAGES.unknown },
        { status: res.error === 'customer_not_found' ? 404 : 400 })
    }
    changes.source_key = res.data.changed
  }

  return NextResponse.json({ ok: true, changed: changes })
}
