import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getCurrentCustomerId } from '@/lib/auth/currentCustomer'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { requestRescheduleForCustomer } from '@/lib/appointmentSelfService'
import { dispatchNow } from '@/lib/notifications/dispatch'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/**
 * 🔒 שלב 15E — פתיחת **בקשת** שינוי מועד לתור confirmed.
 *
 * ⚠️ הכתובת נשארה זהה אבל **הסמנטיקה השתנתה**: עד 15E הקריאה הזו הזיזה
 * את התור מיד; מ-15E היא יוצרת בקשה שממתינה לשובל, והתור המקורי נשאר
 * confirmed וחוסם את שעתו עד ההכרעה. תשובת ההצלחה מחזירה
 * outcome:'requested' ולא 'applied'.
 *
 * מהדפדפן מתקבלים שני ערכים בלבד: התאריך והשעה המבוקשים. expectedStartsAt
 * הוסר — הוא שירת את מסלול ההתאוששות של ההזזה המיידית, ובמודל הבקשה
 * מפתח ה-idempotency הוא האינדקס appointments_one_open_reschedule_per_appt.
 *
 * כל השאר — מי הלקוחה, איזה תור, משך הטיפול, המחיר, הסטטוס והמדיניות —
 * נטען בשרת.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const customerId = await getCurrentCustomerId()
  if (!customerId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'התור לא נמצא.' }, { status: 404 })
  }

  let body: { isoDate?: unknown; time?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const isoDate = typeof body.isoDate === 'string' ? body.isoDate : ''
  const time = typeof body.time === 'string' ? body.time : ''
  if (!ISO_DATE_RE.test(isoDate) || !TIME_RE.test(time)) {
    return NextResponse.json(
      { error: 'invalid_slot', message: 'המועד שנבחר אינו תקין.' },
      { status: 400 },
    )
  }

  const result = await requestRescheduleForCustomer({
    appointmentId: id,
    customerId,
    isoDate,
    time,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message, offerWhatsApp: result.offerWhatsApp ?? false },
      { status: result.status },
    )
  }

  /*
   * 🔒 15F — ⚠️ `result.requestId` ולא `id`.
   *
   * `id` הוא התור **המקורי**, שלא זז ואין עליו התראה. הטריגר רשם
   * `reschedule_requested` על שורת הבקשה החדשה (0022 — בקשה היא שורה
   * שנייה בטבלה). ניקוז לפי `id` היה מוצא אפס שורות, וההתראה לשובל
   * הייתה נשארת queued לנצח בלי שאיש ידע.
   */
  waitUntil(dispatchNow(result.requestId))

  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    calendarSynced: result.calendarSynced,
    message: result.message,
  })
}
