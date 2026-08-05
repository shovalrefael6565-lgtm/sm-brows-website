import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { retryChange } from '@/lib/db/calendarSync'
import { runCalendarSync } from '@/lib/calendarInboundSync'

export const dynamic = 'force-dynamic'

/**
 * ניסיון חוזר לשינוי בודד שנכשל.
 *
 * retry_calendar_change (0008) מחזיר לתור רק פריט שהוא 'failed' — או
 * 'processing' עם lease שפג. פריט שכבר 'processed'/'ignored' הוא מצב סופי
 * ומחזיר 409: אין מסלול שמחייה שינוי שכבר הוכרע.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const queueId = Number(params.id)
  if (!Number.isInteger(queueId) || queueId <= 0) {
    return NextResponse.json({ error: 'not_found', message: 'השינוי לא נמצא.' }, { status: 404 })
  }

  const reset = await retryChange(queueId)
  if (!reset.ok) {
    if (reset.error === 'not_retryable') {
      return NextResponse.json(
        { error: 'not_retryable', message: 'השינוי כבר טופל ואינו ניתן לניסיון חוזר.' },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: 'server_error', message: 'איפוס השינוי נכשל. נסי שוב.' },
      { status: 500 },
    )
  }

  // הפריט כבר חזר ל-pending בכל מקרה. אם ריצה אחרת מחזיקה כרגע את ה-lease,
  // זו אינה שגיאה — הריצה שפועלת (או הבאה) תרים אותו ממילא.
  const run = await runCalendarSync()
  if (!run.ok && run.error !== 'sync_in_progress') {
    return NextResponse.json(
      { ok: true, queued: true, message: 'השינוי הוחזר לתור. העיבוד יתבצע בסנכרון הבא.' },
    )
  }

  return NextResponse.json({ ok: true, queued: !run.ok, stats: run.ok ? run.stats : null })
}
