import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { approveRescheduleAndSync } from '@/lib/appointmentApproval'

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
 * ⚠️ אין כאן whatsappUrl: נוסח הודעת "שינוי המועד אושר" טרם אושר והוא
 * שייך ל-15F. אסור להשתמש בנוסח אישור התור הרגיל כתחליף.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

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
  return NextResponse.json({
    ok: true,
    newEventSynced: result.newEventSynced,
    oldEventRemoved: result.oldEventRemoved,
    message: result.message,
  })
}
