import { NextRequest, NextResponse } from 'next/server'
import { getCurrentCustomerId } from '@/lib/auth/currentCustomer'
import { cancelPendingAppointment, getAppointmentForCustomer } from '@/lib/db/appointments'
import { cancelConfirmedForCustomer } from '@/lib/appointmentSelfService'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ביטול תור ע"י הלקוחה — שני מסלולים תחת כתובת אחת.
 *
 * המסלול נבחר לפי הסטטוס *שנטען מה-DB*, לעולם לא לפי ערך שנשלח מהדפדפן:
 *
 *   pending   → cancel_pending_appointment (0003). המסלול הקיים משלב 4,
 *               ללא שינוי בהתנהגות ובלי לגעת ב-RPC עצמה.
 *   confirmed → המסלול החדש של שלב 7: מדיניות, היסטוריה מלאה ומחיקת
 *               אירוע היומן (lib/appointmentSelfService.ts).
 *
 * בשני המסלולים הבעלות נבדקת בתוך ה-RPC (customer_id הוא חלק מתנאי
 * ה-UPDATE), ולכן טעינת התור כאן משמשת לבחירת המסלול בלבד — לא כהרשאה.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const customerId = await getCurrentCustomerId()
  if (!customerId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const lookup = await getAppointmentForCustomer(id, customerId)

  // תקלת DB אינה "לא נמצא" ואסור לה להפיל אותנו בשקט למסלול ה-pending
  if (!lookup.ok && lookup.reason === 'db_error') {
    return NextResponse.json(
      {
        error: 'service_unavailable',
        message: 'לא ניתן לבצע את הפעולה כרגע. נסי שוב בעוד מספר דקות או פני לשובל.',
        offerWhatsApp: true,
      },
      { status: 503 },
    )
  }

  const appt = lookup.ok ? lookup.appointment : null

  // ── תור מאושר: המסלול של שלב 7 ────────────────────────────────────────────
  if (appt?.status === 'confirmed' || appt?.status === 'cancelled_by_customer') {
    const result = await cancelConfirmedForCustomer(id, customerId)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, message: result.message, offerWhatsApp: result.offerWhatsApp ?? false },
        { status: result.status },
      )
    }
    return NextResponse.json({
      ok: true,
      outcome: result.outcome,
      calendarSynced: result.calendarSynced,
      message: result.message,
    })
  }

  // ── בקשה ממתינה: המסלול הקיים, ללא שינוי ──────────────────────────────────
  const result = await cancelPendingAppointment(id, customerId)
  if (!result.ok) {
    if (result.error === 'not_found') {
      return NextResponse.json(
        { error: 'not_found', message: 'הבקשה לא נמצאה, כבר טופלה, או שאינה שלך.' },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: 'server_error', message: 'הביטול נכשל. נסי שוב.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
