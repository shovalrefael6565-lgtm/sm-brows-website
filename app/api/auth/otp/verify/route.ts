import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/phone'
import { verifyOtp } from '@/lib/db/otpStore'
import { resolveCustomerForLogin } from '@/lib/db/customers'
import { isAdmin } from '@/lib/db/admins'
import { createSession } from '@/lib/auth/session'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'

export const dynamic = 'force-dynamic'

/** נוסחי השגיאה שמוצגים ללקוחה — מכוונים לפעולה ולא לניסוח טכני */
const MESSAGES: Record<string, string> = {
  no_code: 'לא נמצא קוד פעיל. יש לבקש קוד חדש.',
  expired: 'תוקף הקוד פג. יש לבקש קוד חדש.',
  too_many: 'יותר מדי ניסיונות. יש לבקש קוד חדש.',
  wrong: 'הקוד שגוי. בדקי ונסי שוב.',
  error: 'משהו השתבש. נסי שוב בעוד רגע.',
}

export async function POST(req: NextRequest) {
  /*
   * 🔒 שלב 13 — הדגל חוסם לפני `verifyOtp`, לפני `resolveCustomerForLogin`
   * ולפני `createSession`.
   *
   * ⚠️ החסימה כאן אינה מיותרת גם כש-send חסום: קוד שהונפק בזמן שהדגל היה
   * דלוק נשאר תקף חמש דקות. בלי השער הזה, כיבוי הדגל היה מותיר חלון שבו
   * עדיין אפשר לממש קוד קיים ולקבל session מלא למערכת שהוכרזה סגורה.
   *
   * 🔒 ההשלכה המכוונת: אין שום מסלול שיוצר session חדש כשהדגל כבוי.
   */
  if (!isNewBookingSystemEnabled()) {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 403 })
  }

  let body: { phone?: string; code?: string; purpose?: string; fullName?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const phone = normalizePhone(body.phone ?? '')
  const code = (body.code ?? '').trim()

  if (!phone || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: 'bad_request', message: 'יש להזין קוד בן 6 ספרות.' },
      { status: 400 },
    )
  }

  const purpose = body.purpose === 'booking' ? 'booking' : 'login'
  const outcome = await verifyOtp(phone, purpose, code)

  if (outcome !== 'ok') {
    // 401 ולא 400 — הקוד תקין מבחינת פורמט, האימות הוא שנכשל
    return NextResponse.json(
      { error: outcome, message: MESSAGES[outcome] },
      { status: outcome === 'error' ? 500 : 401 },
    )
  }

  // resolveCustomerForLogin מאתרת/יוצרת את חשבון ההתחברות ומקשרת אותו
  // ללקוחה — כולל לקוחה שנוצרה ידנית ב-CRM, שמקבלת כאן את הקישור הראשון
  // שלה ושומרת על כל ההיסטוריה (ראה lib/db/customers.ts). ההפרדה בין
  // לקוחה למנהלת מתבצעת אך ורק לפי הימצאות ב-admins, לא לפי טלפון או קלט.
  const resolved = await resolveCustomerForLogin(phone, body.fullName)
  if (!resolved.ok) {
    console.error('[otp/verify] customer resolution failed', resolved.error)
    // כל הסיבות מוצגות באותו נוסח מסונן: הן מתארות מצב נתונים פנימי
    // שהלקוחה אינה יכולה לפעול לגביו, ואין להסגיר אותו.
    const retryable = resolved.error === 'auth_race_unresolved'
    return NextResponse.json(
      { error: 'server_error', message: 'משהו השתבש. נסי שוב בעוד רגע.' },
      { status: retryable ? 503 : 500 },
    )
  }

  const { customer, authUserId } = resolved.data

  // ⚠️ מול ה-auth user id, לא מול מזהה הלקוחה: admins.user_id מפנה
  // ל-auth.users, ומאז שלב 10 הם שני מזהים שונים.
  if (await isAdmin(authUserId)) {
    await createSession({ userId: authUserId, phone: customer.phone_e164, role: 'admin' })
    return NextResponse.json({ ok: true, redirectTo: '/admin' })
  }

  if (customer.is_blocked) {
    return NextResponse.json(
      { error: 'blocked', message: 'לא ניתן להתחבר. יש ליצור קשר בוואטסאפ.' },
      { status: 403 },
    )
  }

  await createSession({
    userId: authUserId,
    cid: customer.id,
    phone: customer.phone_e164,
    role: 'customer',
  })

  return NextResponse.json({
    ok: true,
    redirectTo: '/account',
    customer: { fullName: customer.full_name },
  })
}
