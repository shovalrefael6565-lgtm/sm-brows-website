import { NextResponse } from 'next/server'
import { getCurrentCustomerId } from '@/lib/auth/currentCustomer'
import { getAppointmentForCustomer } from '@/lib/db/appointments'
import { buildIcs } from '@/lib/calendarInvite'
import { treatmentLabel } from '@/lib/admin/format'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * שלב 15H — קובץ היומן של תור מאושר (מסלול Apple/iPhone).
 *
 * ═══ למה הקובץ נבנה בשרת ולא בדפדפן ═══
 *
 * הנתונים נטענים כאן מה-DB לפי הזהות של ה-session, ולא מתקבלים מהבקשה.
 * דפדפן שיבנה את הקובץ בעצמו היה משתמש במה שמוצג בדף — כלומר במה שאפשר
 * לערוך ב-DOM — ולקוחה הייתה יכולה להוריד "אירוע" עם כל תוכן שתרצה,
 * חתום בשם העסק.
 *
 * ═══ הבעלות ═══
 *
 * `getAppointmentForCustomer` מכניסה את `customer_id` לתוך השאילתה עצמה.
 * תור של לקוחה אחרת פשוט **אינו נמצא**, ולכן אי אפשר להסיק מהתשובה אפילו
 * שהוא קיים.
 *
 * ⚠️ `confirmed` בלבד. בקשה שממתינה לאישור אינה תור, ותור מבוטל או שנדחה
 * ודאי שאינו כזה — קובץ יומן עבורם היה שותל במכשיר הלקוחה אירוע שלא
 * יתקיים, ושאיש לא ימחק ממנו אחר כך.
 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isNewBookingSystemEnabled()) {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 403 })
  }

  const customerId = await getCurrentCustomerId()
  if (!customerId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const lookup = await getAppointmentForCustomer(id, customerId)
  if (!lookup.ok) {
    return lookup.reason === 'db_error'
      ? NextResponse.json({ error: 'service_unavailable' }, { status: 503 })
      : NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const appt = lookup.appointment
  if (appt.status !== 'confirmed') {
    return NextResponse.json({ error: 'not_confirmed' }, { status: 409 })
  }

  const ics = buildIcs({
    appointmentId: appt.id,
    treatment: treatmentLabel(appt),
    startsAt: appt.starts_at,
    durationMin: appt.duration_min,
  })

  /*
   * ⚠️ `no-store`: התור יכול לזוז או להתבטל, ואסור ש-CDN או דפדפן יגישו
   * קובץ ישן שמכניס ליומן הלקוחה מועד שכבר אינו נכון.
   *
   * ⚠️ שם קובץ ASCII בלבד. שם עברי ב-Content-Disposition דורש קידוד
   * RFC 5987, ולקוחות ישנים שאינם מפענחים אותו מציגים ג'יבריש.
   */
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="sm-brows-${appt.id.slice(0, 8)}.ics"`,
      'Cache-Control': 'no-store, must-revalidate',
    },
  })
}
