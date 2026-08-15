import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { approveRescheduleAndSync } from '@/lib/appointmentApproval'
import { dispatchNow } from '@/lib/notifications/dispatch'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 🔒 שלב 15E — אישור בקשת שינוי מועד.
 *
 * ⚠️ נתיב **נפרד** מ-/approve בכוונה. /approve מפעיל
 * approve_pending_appointment, שמאשר בקשת תור רגילה ואינו יודע דבר על
 * התור המקורי — הפעלתו על שורת בקשת שינוי הייתה מאשרת את המועד החדש
 * **בלי לשחרר את הישן ובלי למחוק את האירוע שלו**, כלומר משאירה ללקוחה
 * שני תורים פעילים ושתי שעות תפוסות. שני נתיבים נפרדים מונעים את
 * הבלבול הזה ברמת ה-API.
 *
 * ה-`id` הוא מזהה **שורת הבקשה**, לא התור המקורי.
 *
 * 🔒 15F — הנוסח של "שינוי המועד אושר" אושר ומוחזר כאן כ-whatsappUrl.
 * ⚠️ הוא נוסח **נפרד** מנוסח אישור התור הרגיל; אין להחליף ביניהם.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'הבקשה לא נמצאה.' }, { status: 404 })
  }

  const result = await approveRescheduleAndSync(id, guard.userId)

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    )
  }

  /*
   * ⚠️ ok:true גם כשהסנכרון ליומן לא הושלם. ההחלפה ב-DB כבר עשתה COMMIT:
   * התור החדש קיים והשעה הישנה השתחררה. הצגת "האישור נכשל" כאן הייתה
   * גורמת לשובל לאשר שוב תור שכבר אושר — בדיוק הלקח של 15C.
   * מה שלא הסתנכרן מופיע ברשימת ״דורש טיפול״ עם כפתור retry.
   */
  /*
   * 🔒 15F — `id` הוא מזהה **שורת הבקשה**, וזו בדיוק השורה שעליה הטריגר
   * רשם `reschedule_approved`. ראה ההערה המלאה ב-approve/route.ts.
   */
  waitUntil(dispatchNow(id))

  return NextResponse.json({
    ok: true,
    newEventSynced: result.newEventSynced,
    oldEventRemoved: result.oldEventRemoved,
    message: result.message,
    // 🔒 15F — הנוסח המאושר. עד כאן הנתיב לא החזיר whatsappUrl כלל.
    whatsappUrl: result.whatsappUrl,
  })
}
