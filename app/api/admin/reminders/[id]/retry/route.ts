import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { retryReminder } from '@/lib/db/reminders'
import { runReminderDispatch } from '@/lib/reminders/dispatch'
import { REMINDER_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_BY_ERROR: Record<string, number> = {
  not_admin: 403,
  reminder_not_found: 404,
  duplicate_risk_not_confirmed: 409,
  lease_active: 409,
  appointment_not_confirmed: 409,
  snapshot_stale: 409,
  window_closed: 409,
  db_error: 500,
}

/**
 * ניסיון חוזר לתזכורת שנכשלה.
 *
 * ⚠️ transition אטומי על **אותה שורה** — אינו יוצר תזכורת חדשה. לחיצה
 * כפולה אינה יכולה לייצר שליחה כפולה: הראשונה משנה סטטוס, והשנייה כבר
 * אינה מוצאת שורה במצב שניתן ל-retry ומקבלת not_retryable עם המצב הקיים.
 *
 * 🔒 retry מ-delivery_unknown דורש confirmDuplicateRisk=true, וה-**שרת**
 * הוא שאוכף זאת (ראה retry_reminder ב-0011). modal בדפדפן הוא ממשק, לא
 * הגנה: בקשה ישירה בלי הדגל נדחית ב-409.
 *
 * 🔒 retry על תזכורת שיש עליה worker חי נדחה. מנהלת אינה גוזלת lease פעיל.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      { error: 'reminder_not_found', message: REMINDER_ERROR_MESSAGES.reminder_not_found },
      { status: 404 },
    )
  }

  let body: { confirmDuplicateRisk?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // גוף ריק הוא לגיטימי — משמעותו "בלי אישור סיכון הכפילות".
  }

  const result = await retryReminder({
    reminderId: params.id,
    adminId: guard.userId,
    confirmDuplicateRisk: body.confirmDuplicateRisk === true,
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        message: REMINDER_ERROR_MESSAGES[result.error] ?? REMINDER_ERROR_MESSAGES.unknown,
      },
      { status: STATUS_BY_ERROR[result.error] ?? 500 },
    )
  }

  if (result.result === 'not_retryable') {
    return NextResponse.json({ ok: true, result: 'not_retryable', status: result.status })
  }

  const stats = await runReminderDispatch()
  return NextResponse.json({ ok: true, result: 'requeued', status: result.status, stats })
}
