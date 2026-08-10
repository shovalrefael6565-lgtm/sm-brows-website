import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { approveAndSyncAppointment } from '@/lib/appointmentApproval'
import { dispatchNow } from '@/lib/notifications/dispatch'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * אישור בקשת pending. כל הלוגיקה (בדיקת התנגשות, ה-RPC האטומי, סנכרון
 * היומן עם claim/reconciliation) חיה ב-lib/appointmentApproval.ts —
 * ה-route רק אוכף הרשאה ומתרגם את התוצאה ל-HTTP.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'הבקשה לא נמצאה.' }, { status: 404 })
  }

  const result = await approveAndSyncAppointment(id, guard.userId)

  /*
   * 🔒 15F — ההתראה, אחרי ה-COMMIT ולפני ה-return.
   *
   * ⚠️ **גם במסלול השגיאה.** `result.approved` אומר שהתור אושר ב-DB ורק
   * סנכרון היומן נכשל — הלקוחה צריכה לדעת שהתור אושר בדיוק כמו במסלול
   * המוצלח. תלייה של ההתראה ב-`result.ok` הייתה משתיקה אותה בגלל תקלה
   * ב-Google, שאין לה שום קשר ללקוחה.
   *
   * ⚠️ `waitUntil` ולא await, ולא fire-and-forget: ב-Next 14.2 אין
   * `unstable_after`, ו-Promise שלא ממתינים לו נקטע ברגע שהתשובה נשלחת.
   * `waitUntil` מחזיק את ה-function בחיים בלי לחסום את התשובה.
   *
   * 🔒 `dispatchNow` אינה זורקת ואינה משנה את תשובת ה-HTTP.
   */
  if (result.ok || result.approved) waitUntil(dispatchNow(id))

  if (!result.ok) {
    // ⚠️ approved=true נשלח גם בתשובת השגיאה: התור אושר ב-DB והשעה תפוסה,
    // ורק סנכרון היומן נכשל. בלי זה ה-UI היה מציג "האישור נכשל" על תור
    // קיים ומאבד את הודעת האישור ללקוחה. ראה ApprovalFail.
    return NextResponse.json(
      {
        error: result.error,
        message: result.message,
        approved: result.approved,
        whatsappUrl: result.whatsappUrl,
      },
      { status: result.status },
    )
  }

  return NextResponse.json({ ok: true, whatsappUrl: result.whatsappUrl })
}
