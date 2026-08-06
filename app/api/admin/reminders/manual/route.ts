import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { getAppointmentForAdmin } from '@/lib/db/appointments'
import { createManualReminder } from '@/lib/db/reminders'
import { manualReminderFingerprint } from '@/lib/adminIdempotency'
import { REMINDER_TEMPLATE_VERSION } from '@/lib/reminders/templates'
import { runReminderDispatch } from '@/lib/reminders/dispatch'
import { REMINDER_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_BY_ERROR: Record<string, number> = {
  not_admin: 403,
  missing_request_id: 400,
  bad_fingerprint: 400,
  idempotency_key_reused: 409,
  appointment_not_found: 404,
  not_confirmed: 409,
  appointment_in_past: 409,
  db_error: 500,
}

/**
 * שליחה ידנית של תזכורת ע"י מנהלת.
 *
 * ⚠️ מה **לא** מגיע מהדפדפן: מועד התור, גרסת התבנית, וזהות המנהלת. שלושתם
 * נטענים או נגזרים בשרת, בדיוק כמו בשלב 10 — כדי שהדפדפן לא יוכל להשפיע
 * על מה שנשמר ועל מה שייחשב כ"אותה בקשה".
 *
 * ⚠️ ה-fingerprint כולל את מועד התור. אם התור הוזז בין שתי לחיצות, זו כבר
 * בקשה אחרת: הבקשה השנייה מקבלת IDEMPOTENCY_KEY_REUSED במקום לשלוח בשקט
 * תזכורת שמתארת מועד שכבר אינו נכון.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: { appointmentId?: unknown; client_request_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  if (typeof body.client_request_id !== 'string' || !UUID_RE.test(body.client_request_id)) {
    return NextResponse.json(
      { error: 'missing_request_id', message: REMINDER_ERROR_MESSAGES.missing_request_id },
      { status: 400 },
    )
  }
  if (typeof body.appointmentId !== 'string' || !UUID_RE.test(body.appointmentId)) {
    return NextResponse.json(
      { error: 'appointment_not_found', message: REMINDER_ERROR_MESSAGES.appointment_not_found },
      { status: 404 },
    )
  }

  // התור נטען מחדש בשרת — ה-snapshot ל-fingerprint חייב להגיע מה-DB.
  const appt = await getAppointmentForAdmin(body.appointmentId)
  if (!appt) {
    return NextResponse.json(
      { error: 'appointment_not_found', message: REMINDER_ERROR_MESSAGES.appointment_not_found },
      { status: 404 },
    )
  }

  const created = await createManualReminder({
    appointmentId: appt.id,
    adminId: guard.userId,
    clientRequestId: body.client_request_id,
    payloadFingerprint: manualReminderFingerprint({
      actorAdminId: guard.userId,
      appointmentId: appt.id,
      appointmentStartsAt: new Date(appt.starts_at),
      templateVersion: REMINDER_TEMPLATE_VERSION,
    }),
    templateVersion: REMINDER_TEMPLATE_VERSION,
  })

  if (!created.ok) {
    return NextResponse.json(
      {
        error: created.error,
        message: REMINDER_ERROR_MESSAGES[created.error] ?? REMINDER_ERROR_MESSAGES.unknown,
      },
      { status: STATUS_BY_ERROR[created.error] ?? 500 },
    )
  }

  // ⚠️ ה-dispatch כאן אינו "השליחה" — הוא רק מנסה לטפל בתור מיד במקום
  // להמתין להרצה הבאה. אם הספק כבוי (וזה המצב בשלב 11) הוא לא ייגע בכלום,
  // והתזכורת פשוט תמתין. התשובה מציגה את המצב האמיתי.
  const stats = await runReminderDispatch()

  return NextResponse.json({
    ok: true,
    reminderId: created.reminderId,
    replayed: created.replayed,
    stats,
  })
}
