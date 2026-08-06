import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { normalizePhone } from '@/lib/phone'
import { createManualCustomer } from '@/lib/db/manualCustomers'
import { ADMIN_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * יצירת לקוחה ידנית ממערכת הניהול.
 *
 * ⚠️ הפעולה **אינה** יוצרת חשבון התחברות, אינה שולחת OTP, SMS או WhatsApp.
 * הלקוחה תוכל להתחבר בעתיד בעצמה, ואז החשבון ייקשר לשורה הזו לפי הטלפון.
 *
 * client_request_id הוא מפתח ה-idempotency: הדפדפן יוצר אותו פעם אחת לכל
 * ניסיון ושולח אותו שוב בכל retry. disabled על הכפתור אינו הגנה — תגובה
 * יכולה ללכת לאיבוד אחרי שה-DB כבר כתב.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: {
    fullName?: unknown
    phone?: unknown
    sourceKey?: unknown
    crmStatus?: unknown
    client_request_id?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  if (typeof body.client_request_id !== 'string' || !UUID_RE.test(body.client_request_id)) {
    return NextResponse.json(
      { error: 'missing_request_id', message: ADMIN_ERROR_MESSAGES.missing_request_id },
      { status: 400 })
  }

  if (typeof body.fullName !== 'string') {
    return NextResponse.json(
      { error: 'invalid_name', message: ADMIN_ERROR_MESSAGES.invalid_name }, { status: 400 })
  }
  const fullName = body.fullName.trim().replace(/\s+/g, ' ')
  if (fullName.length < 2 || fullName.length > 80) {
    return NextResponse.json(
      { error: 'invalid_name', message: ADMIN_ERROR_MESSAGES.invalid_name }, { status: 400 })
  }

  // אותו נירמול שכל המערכת משתמשת בו — מקור אמת יחיד לפורמט הטלפון
  const phoneE164 = typeof body.phone === 'string' ? normalizePhone(body.phone) : null
  if (!phoneE164) {
    return NextResponse.json(
      { error: 'invalid_phone', message: ADMIN_ERROR_MESSAGES.invalid_phone }, { status: 400 })
  }

  const crmStatus = body.crmStatus === 'inactive' ? 'inactive' : 'active'
  const sourceKey = typeof body.sourceKey === 'string' && body.sourceKey.trim()
    ? body.sourceKey.trim()
    : 'unknown'

  const res = await createManualCustomer({
    fullName,
    phoneE164,
    sourceKey,
    crmStatus,
    adminUserId: guard.userId,   // מה-session בלבד, לעולם לא מגוף הבקשה
    clientRequestId: body.client_request_id,
  })

  if (!res.ok) {
    const status =
      res.error === 'not_admin' ? 403 :
      res.error === 'idempotency_key_reused' ? 409 :
      res.error === 'unknown' ? 500 : 400
    return NextResponse.json(
      { error: res.error, message: ADMIN_ERROR_MESSAGES[res.error] ?? ADMIN_ERROR_MESSAGES.unknown },
      { status })
  }

  // חשבון מנהל: הודעה מסוננת בלבד. אין מזהה, אין שם, ואין קישור לפרופיל —
  // כדי לא להסגיר שהמספר שייך לחשבון ניהולי.
  if (res.data.result === 'admin_phone_exists') {
    return NextResponse.json(
      { result: 'phone_taken', message: ADMIN_ERROR_MESSAGES.phone_taken },
      { status: 409 })
  }

  return NextResponse.json({
    result: res.data.result,          // 'customer_created' | 'existing_customer'
    customerId: res.data.customerId,
    created: res.data.result === 'customer_created',
  })
}
