import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { updateCustomerDetails, deleteCustomerIfSafe, getCrmCustomer } from '@/lib/db/crm'
import { findAuthUserIdByPhone } from '@/lib/auth/adminUserResolver'
import { CRM_ERROR_MESSAGES } from '@/lib/admin/format'
import { normalizePhone } from '@/lib/phone'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function failure(error: string, status?: number) {
  return NextResponse.json(
    { error, message: CRM_ERROR_MESSAGES[error] ?? CRM_ERROR_MESSAGES.unknown },
    { status: status ?? (error === 'customer_not_found' ? 404 : 400) },
  )
}

/**
 * שלב 15H — עריכת פרטי לקוחה.
 *
 * ⚠️ ה-actor נלקח מ-guard.userId ולעולם לא מגוף הבקשה, וה-RPC מאמת אותו
 * שוב מול טבלת admins — אותו גבול של כל פעולות ה-CRM.
 *
 * ⚠️ הטלפון מנורמל כאן ב-lib/phone.ts לפני שהוא מגיע ל-DB, כדי ששתי
 * צורות כתיבה של אותו מספר ("050-1234567" ו-"+972501234567") לא ייחשבו
 * שינוי, ולא ייצרו כרטיס עם מספר בפורמט שהמערכת אינה מזהה בהתחברות.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const customerId = params.id
  if (!UUID_RE.test(customerId)) {
    return NextResponse.json({ error: 'not_found', message: 'הלקוחה לא נמצאה.' }, { status: 404 })
  }

  let body: { fullName?: unknown; phone?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  const wantsName = typeof body.fullName === 'string' && body.fullName.trim() !== ''
  const wantsPhone = typeof body.phone === 'string' && body.phone.trim() !== ''
  if (!wantsName && !wantsPhone) {
    return NextResponse.json({ error: 'bad_request', message: 'לא נשלח שינוי.' }, { status: 400 })
  }

  let phone: string | null = null
  if (wantsPhone) {
    phone = normalizePhone(body.phone as string)
    if (!phone) return failure('bad_phone')
  }

  const res = await updateCustomerDetails(customerId, guard.userId, {
    fullName: wantsName ? (body.fullName as string) : null,
    phone,
  })

  if (!res.ok) {
    // 409 ולא 400: הבקשה תקינה לחלוטין, המצב הוא שחוסם אותה.
    const conflict = res.error === 'has_login_account' || res.error === 'phone_taken'
    return failure(res.error, conflict ? 409 : undefined)
  }

  return NextResponse.json({
    ok: true,
    outcome: res.data.outcome,
    changed: res.data.changed ?? [],
    fullName: res.data.full_name,
  })
}

/** הודעה אחידה לשני מצבי החסימה: בשניהם התשובה היא ארכיון. */
const ARCHIVE_INSTEAD = 'אפשר להעביר את הכרטיס לארכיון — הוא ייצא מהרשימה וכל הנתונים יישמרו.'

/**
 * שלב 15H — מחיקת כרטיס לקוחה.
 *
 * ═══ 🔴 מחיקה חייבת לא להשאיר אחריה שום שארית ═══
 *
 * לכן היא מותרת רק כשמתקיימים **שלושה** תנאים, שנבדקים בשלוש שכבות שונות:
 *
 *   1. אין ללקוחה אף תור            — נאכף במסד (`on delete restrict` +
 *                                      delete_customer_if_safe).
 *   2. אין לה חשבון התחברות מקושר   — נאכף ב-RPC (0028).
 *   3. אין auth user **כלשהו** עם   — נאכף **כאן**, ורק כאן.
 *      הטלפון שלה
 *
 * ⚠️ תנאי 3 הוא הכיוון השני של אותו orphan, וה-RPC אינו יכול לבדוק אותו:
 * לקוחה יכולה להיות `auth_user_id is null` בעוד ב-auth.users יושבת זהות
 * עם אותו מספר — למשל חשבון שנוצר בהתחברות שהקישור שלה נכשל (0010:71
 * מתעד את המצב הזה במפורש כמצב אפשרי ולגיטימי). מחיקת הכרטיס הייתה
 * מותירה את הזהות ההיא בלי שום לקוחה, ובהתחברות הבאה נוצר כרטיס חדש
 * בשקט. auth.users אינה ניתנת לשאילתה אמינה לפי טלפון מתוך plpgsql —
 * GoTrue שומר אותו בלי '+' — ולכן הבדיקה נעשית דרך ה-Auth Admin API.
 *
 * 🔒 **fail-closed.** כשל בבדיקה, או יותר מזהות אחת לאותו מספר, חוסמים
 * את המחיקה. ההפסד מחסימה שגויה הוא כרטיס שנשאר; ההפסד ממחיקה שגויה הוא
 * זהות יתומה שאיש לא ידע עליה.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const customerId = params.id
  if (!UUID_RE.test(customerId)) {
    return NextResponse.json({ error: 'not_found', message: 'הלקוחה לא נמצאה.' }, { status: 404 })
  }

  // ── שכבה 3: אין זהות התחברות עם המספר הזה ────────────────────────────────
  const customer = await getCrmCustomer(customerId)
  if (!customer) {
    return NextResponse.json({ error: 'not_found', message: 'הלקוחה לא נמצאה.' }, { status: 404 })
  }

  if (customer.has_login_account) {
    return NextResponse.json(
      {
        error: 'has_login_account',
        message: `ללקוחה יש חשבון התחברות ולכן אי אפשר למחוק את הכרטיס. ${ARCHIVE_INSTEAD}`,
      },
      { status: 409 },
    )
  }

  const authLookup = await findAuthUserIdByPhone(customer.phone_e164)
  if (!authLookup.ok) {
    // ⚠️ לא ממשיכים למחיקה. בדיקה שלא הצליחה אינה "אין חשבון".
    return NextResponse.json(
      {
        error: 'auth_lookup_failed',
        message: 'לא ניתן היה לוודא שאין למספר הזה חשבון התחברות, ולכן המחיקה נעצרה. נסי שוב מאוחר יותר.',
      },
      { status: 503 },
    )
  }
  if (authLookup.id) {
    return NextResponse.json(
      {
        error: 'orphan_auth_user',
        message:
          `קיים חשבון התחברות עם מספר הטלפון הזה, גם אם הוא אינו מקושר לכרטיס. ` +
          `מחיקה הייתה משאירה אותו יתום. ${ARCHIVE_INSTEAD}`,
      },
      { status: 409 },
    )
  }

  const res = await deleteCustomerIfSafe(customerId, guard.userId)
  if (!res.ok) return failure(res.error)

  if (res.data.outcome === 'blocked_has_appointments') {
    const count = res.data.appointment_count
    return NextResponse.json(
      {
        error: 'has_appointments',
        appointmentCount: count ?? null,
        message: count
          ? `ללקוחה יש ${count} תורים במערכת ולכן אי אפשר למחוק אותה. ההיסטוריה נשמרת — ${ARCHIVE_INSTEAD}`
          : `ללקוחה יש תורים במערכת ולכן אי אפשר למחוק אותה. ${ARCHIVE_INSTEAD}`,
      },
      { status: 409 },
    )
  }

  /*
   * ⚠️ ה-RPC חוסם שוב, גם אחרי שהשכבה למעלה בדקה. זה אינו כפל מיותר:
   * הלקוחה יכולה להתחבר בדיוק בין שתי הבדיקות ולקבל auth_user_id, ואז
   * ה-RPC — שרץ תחת FOR UPDATE על השורה — הוא היחיד שרואה את המצב האמיתי.
   */
  if (res.data.outcome === 'blocked_has_login_account') {
    return NextResponse.json(
      {
        error: 'has_login_account',
        message: `ללקוחה יש חשבון התחברות ולכן אי אפשר למחוק את הכרטיס. ${ARCHIVE_INSTEAD}`,
      },
      { status: 409 },
    )
  }

  return NextResponse.json({ ok: true, outcome: 'deleted' })
}
