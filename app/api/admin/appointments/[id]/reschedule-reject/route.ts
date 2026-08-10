import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { rejectReschedule } from '@/lib/appointmentApproval'
import { dispatchNow } from '@/lib/notifications/dispatch'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 🔒 שלב 15E — דחיית בקשת שינוי מועד.
 *
 * ⚠️ נתיב נפרד מ-/reject מאותו שיקול כמו reschedule-approve:
 * reject_pending_appointment היה מסמן את השורה 'rejected' בלי שום קשר
 * לתור המקורי. כאן ההבטחה מפורשת ונאכפת ב-RPC —
 * **התור המקורי אינו נגוע באף שדה**, ורק שעת היעד משתחררת.
 *
 * אין כאן שום אינטראקציה עם Google Calendar: לבקשה שממתינה לאישור
 * מעולם לא נוצר אירוע.
 *
 * ⚠️ אין whatsappUrl — נוסח הודעת הדחייה לשינוי מועד שייך ל-15F.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'הבקשה לא נמצאה.' }, { status: 404 })
  }

  const result = await rejectReschedule(id, guard.userId)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    )
  }

  // 🔒 15F — `id` = שורת הבקשה, שעליה נרשם `reschedule_rejected`.
  waitUntil(dispatchNow(id))

  return NextResponse.json({
    ok: true,
    message: 'בקשת שינוי המועד נדחתה. התור המקורי נשאר ללא שינוי.',
    // 🔒 15F — הנוסח המאושר, עם המועד **המקורי** שנשאר שמור.
    whatsappUrl: result.whatsappUrl,
  })
}
