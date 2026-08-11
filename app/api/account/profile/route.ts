import { NextRequest, NextResponse } from 'next/server'
import { getCurrentCustomerId } from '@/lib/auth/currentCustomer'
import { completeCustomerName } from '@/lib/db/customers'
import { buildFullName, placeholderFullNames, NAME_ERROR_MESSAGES } from '@/lib/customerProfile'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'

export const dynamic = 'force-dynamic'

/**
 * שלב 15H — הלקוחה משלימה שם פרטי ושם משפחה.
 *
 * ═══ 🔒 למה אי אפשר ליצור כאן לקוחה כפולה ═══
 *
 * ה-route הזה **אינו מקבל מזהה לקוחה ואינו מקבל טלפון**. הזהות נקבעת
 * במלואה ב-`getCurrentCustomerId()`, שמוכיחה אותה מחדש מול
 * `customers.auth_user_id` בכל בקשה. הגוף מכיל שני שדות טקסט בלבד.
 *
 * גם אם התוקפת תשלח `customerId`, `phone` או `id` — הם פשוט אינם נקראים.
 * ומכיוון שהפעולה למטה היא `UPDATE` על מפתח ראשי, אין בכל המסלול הזה שום
 * `insert` שיכול לייצר שורה שנייה.
 *
 * ⚠️ הטלפון המנורמל נשאר הזיהוי הראשי של הלקוחה ואינו ניתן לשינוי כאן.
 * שינוי טלפון הוא פעולה ניהולית (15H, נושא 3) ולא פעולה של הלקוחה.
 *
 * 🔒 הולידציה ב-lib/customerProfile.ts רצה **גם** בדפדפן, אבל האכיפה
 * היחידה שנחשבת היא זו שכאן.
 */
export async function PATCH(req: NextRequest) {
  if (!isNewBookingSystemEnabled()) {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 403 })
  }

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const customerId = await getCurrentCustomerId()
  if (!customerId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { firstName?: unknown; lastName?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const firstName = typeof body.firstName === 'string' ? body.firstName : ''
  const lastName = typeof body.lastName === 'string' ? body.lastName : ''

  const built = buildFullName(firstName, lastName)
  if (!built.ok) {
    return NextResponse.json(
      { error: built.error, message: NAME_ERROR_MESSAGES[built.error] },
      { status: 400 },
    )
  }

  const outcome = await completeCustomerName(customerId, built.fullName, placeholderFullNames())

  switch (outcome) {
    case 'updated':
      return NextResponse.json({ ok: true, fullName: built.fullName })

    case 'already_named':
      /*
       * ⚠️ 200 ולא שגיאה. הגענו לכאן כשלשורה כבר יש שם תקין — לחיצה
       * כפולה, שליחה חוזרת אחרי timeout, או ששובל הזינה שם ידנית בזמן
       * שהטופס היה פתוח. בכל המקרים מצב היעד הושג, והלקוחה אמורה פשוט
       * להמשיך לאזור האישי.
       *
       * ⚠️ `fullName` **אינו** מוחזר כאן: השם ששמור הוא זה שב-DB ולא זה
       * שהוקלד, והחזרת הקלט הייתה מציגה ללקוחה שם שלא נשמר.
       */
      return NextResponse.json({ ok: true, alreadyNamed: true })

    case 'not_found':
      // ה-session מצביע על לקוחה שאינה קיימת עוד. אין מסלול תיקון בצד הזה.
      return NextResponse.json(
        { error: 'unauthorized', message: 'יש להתחבר מחדש.' },
        { status: 401 },
      )

    case 'error':
      return NextResponse.json(
        { error: 'server_error', message: 'לא הצלחנו לשמור את הפרטים. נסי שוב בעוד רגע.' },
        { status: 503 },
      )
  }
}
