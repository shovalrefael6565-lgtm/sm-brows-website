import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/phone'
import { verifyOtp } from '@/lib/db/otpStore'
import { resolveCustomerForLogin } from '@/lib/db/customers'
import { readJsonWithLimit, DEFAULT_MAX_JSON_BYTES } from '@/lib/http/bodyLimit'
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

/**
 * 🔒 שלב 14 — הכניסה נכשלת בגלוי כשלא ניתן לרשום את ה-session.
 *
 * ⚠️ מאז שלב 14 `createSession` כותבת שורה ב-app_sessions *לפני* ה-cookie,
 * וכשהכתיבה נכשלת אין cookie בכלל. זו התנהגות מכוונת (fail-closed): cookie
 * בלי רשומה מקבילה היה נפסל באימות הראשון, כלומר לקוחה שרואה "התחברת"
 * ומועפת החוצה בעמוד הבא בלי הסבר.
 *
 * ⚠️ הקוד שהוזן כבר נצרך (`verify_otp_atomic` שורפת אותו באותה טרנזקציה
 * שאימתה אותו), ולכן ניסיון חוזר מחייב קוד חדש. הנוסח למטה מכוון לפעולה
 * הזו ולא מסגיר את הסיבה הפנימית.
 *
 * 503 ולא 500 — כשל זמינות של המסד, ששווה ניסיון חוזר.
 */
function sessionCreationFailed() {
  console.error('[otp/verify] יצירת session נכשלה — לא נכתב cookie')
  return NextResponse.json(
    { error: 'server_error', message: 'משהו השתבש. יש לבקש קוד חדש ולנסות שוב.' },
    { status: 503 },
  )
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

  const parsed = await readJsonWithLimit<{
    phone?: string
    code?: string
    purpose?: string
    fullName?: string
  }>(req, DEFAULT_MAX_JSON_BYTES)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? 'payload_too_large' : 'bad_request' },
      { status: parsed.status },
    )
  }
  const body = parsed.body

  const phone = normalizePhone(body.phone ?? '')
  const code = (body.code ?? '').trim()

  if (!phone || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: 'bad_request', message: 'יש להזין קוד בן 6 ספרות.' },
      { status: 400 },
    )
  }

  // 🔒 שלב 3 — אותה תקרה בדיוק כמו bookings/request (0001: 2–80 תווים).
  // רלוונטי רק ללקוחה חדשה שנרשמת כאן לראשונה — קיימת אינה מושפעת
  // (resolveCustomerForLogin אינו דורס שם קיים בשם ריק/undefined).
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  if (fullName && (fullName.length < 2 || fullName.length > 80)) {
    return NextResponse.json(
      { error: 'invalid_name', message: 'השם שהוזן אינו תקין.' },
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
  const resolved = await resolveCustomerForLogin(phone, fullName || undefined)
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
    const created = await createSession({
      userId: authUserId,
      phone: customer.phone_e164,
      role: 'admin',
    })
    if (!created) return sessionCreationFailed()
    return NextResponse.json({ ok: true, redirectTo: '/admin' })
  }

  if (customer.is_blocked) {
    return NextResponse.json(
      { error: 'blocked', message: 'לא ניתן להתחבר. יש ליצור קשר בוואטסאפ.' },
      { status: 403 },
    )
  }

  const created = await createSession({
    userId: authUserId,
    cid: customer.id,
    phone: customer.phone_e164,
    role: 'customer',
  })
  if (!created) return sessionCreationFailed()

  return NextResponse.json({
    ok: true,
    redirectTo: '/account',
    customer: { fullName: customer.full_name },
  })
}
