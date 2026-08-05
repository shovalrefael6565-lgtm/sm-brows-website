import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { runCalendarSync } from '@/lib/calendarInboundSync'

export const dynamic = 'force-dynamic'

/**
 * הפעלה ידנית של הסנכרון הנכנס מ-Google Calendar, מתוך מערכת הניהול.
 *
 * ההגנה היא requireAdminApi — session אמיתי, בדיקת is_admin מול הטבלה
 * בפועל, ודגל המערכת — בדיוק כמו sync-calendar. ההגנה מפני שתי ריצות
 * מקבילות אינה כאן אלא ב-lease שב-DB (claim_calendar_sync_run), כך שגם
 * שתי לשוניות פתוחות או לחיצה כפולה שעקפה את ה-loading לא יריצו שתי ריצות.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const result = await runCalendarSync()
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: result.status })
  }

  return NextResponse.json({ ok: true, stats: result.stats })
}
