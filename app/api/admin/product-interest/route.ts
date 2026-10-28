import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { setProductInterestStatus } from '@/lib/db/productInterestAdmin'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * שינוי סטטוס ידני של הרשמה.
 *
 * 🔴 **`'notified'` אינו ערך קביל כאן, ואין לו מסלול.** הרשימה המותרת היא
 * `open` ו-`closed` בלבד, וגם ה-RPC דוחה אותו בנפרד (0039). סימון ידני של
 * "נשלחה הודעה" הוא הצהרה שקרית על העולם: הוא מוציא לקוחה מרשימת הנמענות
 * בלי שקיבלה כלום, ואי אפשר לגלות זאת בדיעבד.
 *
 * 🔒 אין כאן GET. רשימת הטלפונים נקראת אך ורק ברינדור השרת של
 * /admin/product-interest, שמוגן ב-layout — אין endpoint שמחזיר PII.
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: { id?: unknown; status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'הבקשה לא נמצאה.' }, { status: 404 })
  }

  if (body.status !== 'open' && body.status !== 'closed') {
    /*
     * ⚠️ נוסח ייעודי ל-'notified' כדי שהמנהלת תבין מדוע זה חסום, במקום
     * "סטטוס לא תקין" שנראה כמו באג.
     */
    const message = body.status === 'notified'
      ? 'לא ניתן לסמן "עודכנה" ידנית — הסטטוס נקבע רק אחרי שליחת הודעה מוצלחת.'
      : 'סטטוס לא תקין.'
    return NextResponse.json({ error: 'bad_status', message }, { status: 400 })
  }

  const result = await setProductInterestStatus(id, body.status)
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 500
    return NextResponse.json(
      { error: result.error ?? 'failed', message: 'העדכון נכשל. נסי שוב.' },
      { status },
    )
  }

  return NextResponse.json({ ok: true })
}
