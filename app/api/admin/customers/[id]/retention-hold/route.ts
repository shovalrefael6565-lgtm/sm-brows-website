import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { setCustomerRetentionHold } from '@/lib/db/crm'
import { readJsonWithLimit, DEFAULT_MAX_JSON_BYTES } from '@/lib/http/bodyLimit'
import { CRM_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 9B — הפעלה/ביטול "עצירת ניקוי אוטומטי" (retention_hold) על כרטיס לקוחה.
 *
 * ⚠️ ה-actor נלקח מ-guard.userId ולעולם לא מגוף הבקשה — אותו גבול שכל
 * שאר פעולות ה-CRM נשענות עליו (ראה lib/db/crm.ts). ה-RPC (0032) מאמת
 * אותו שוב מול טבלת admins.
 *
 * גוף הבקשה מכיל אך ורק `hold: boolean`. אין שדה סיבה — לא כאן ולא ב-RPC —
 * כדי לא ליצור ערוץ טקסט חופשי נוסף שעלול לשאת מידע רגיש.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json(
      { error: 'bad_origin' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const customerId = params.id
  if (!UUID_RE.test(customerId)) {
    return NextResponse.json(
      { error: 'not_found', message: 'הלקוחה לא נמצאה.' },
      { status: 404, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const bodyResult = await readJsonWithLimit<{ hold?: unknown }>(req, DEFAULT_MAX_JSON_BYTES)
  if (!bodyResult.ok) {
    return NextResponse.json(
      { error: 'bad_request', message: 'בקשה לא תקינה.' },
      { status: bodyResult.status, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const hold = bodyResult.body.hold
  if (typeof hold !== 'boolean') {
    return NextResponse.json(
      { error: 'bad_hold', message: CRM_ERROR_MESSAGES.bad_hold },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const res = await setCustomerRetentionHold(customerId, guard.userId, hold)
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, message: CRM_ERROR_MESSAGES[res.error] ?? CRM_ERROR_MESSAGES.unknown },
      { status: res.error === 'customer_not_found' ? 404 : 400, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  return NextResponse.json(
    { ok: true, outcome: res.data.outcome, retentionHold: res.data.retention_hold },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
