import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { cancelConfirmedByAdmin } from '@/lib/appointmentApproval'
import { dispatchNow } from '@/lib/notifications/dispatch'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * שלב 15H — ביטול תור מאושר ע"י שובל.
 *
 * כל הלוגיקה — ה-RPC האטומי, סגירת בקשת שינוי המועד ומחיקת אירוע היומן —
 * חיה ב-lib/appointmentApproval.ts. ה-route אוכף הרשאה ומתרגם ל-HTTP.
 *
 * ⚠️ `guard.userId` הוא ה-auth user id של המנהלת המחוברת, והוא זה שנרשם
 * כ-actor_id בהיסטוריה. הוא **אינו** מתקבל מהבקשה — גוף הבקשה אינו נקרא
 * כאן כלל, ולכן אין שום דרך לבטל "בשם" מנהלת אחרת.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'התור לא נמצא.' }, { status: 404 })
  }

  const result = await cancelConfirmedByAdmin(id, guard.userId)

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    )
  }

  /*
   * 🔒 15F — ההתראה ללקוחה, אחרי ה-COMMIT ולפני ה-return.
   *
   * ⚠️ הטריגר של 0025 כבר רשם את השורה `booking_cancelled/customer` ברגע
   * שנכתבה שורת ההיסטוריה. כאן רק מנקזים אותה. **רק ללקוחה** — שובל היא
   * זו שלחצה, ואין טעם להודיע לה על מה שהיא עצמה עשתה.
   *
   * ⚠️ `waitUntil` ולא await: Promise שלא ממתינים לו נקטע ברגע שהתשובה
   * נשלחת, ובלעדיו ההודעה הייתה נשארת `queued` עד הניקוז הבא.
   *
   * ⚠️ גם ב-'already_cancelled': אין שורת היסטוריה חדשה ולכן אין הודעה
   * חדשה, אבל אם ניסיון קודם נתקע ב-`retrying` — זו ההזדמנות לסיים אותו.
   *
   * 🔒 `dispatchNow` אינה זורקת ואינה משנה את תשובת ה-HTTP. כשל SMS אינו
   * מחזיר את התור או את האירוע ביומן.
   */
  waitUntil(dispatchNow(id))

  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    calendarRemoved: result.calendarRemoved,
    message: result.message,
  })
}
