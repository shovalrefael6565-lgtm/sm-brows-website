import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { runReminderDispatch } from '@/lib/reminders/dispatch'

export const dynamic = 'force-dynamic'

/**
 * הרצה ידנית של שליחת התזכורות מתוך מערכת הניהול.
 *
 * ההגנה היא requireAdminApi — session אמיתי, בדיקת is_admin מול הטבלה
 * בפועל, ודגל המערכת. ההגנה מפני שתי ריצות מקבילות אינה כאן אלא ב-lease
 * שב-DB, כך שגם שתי לשוניות פתוחות לא ישלחו שתי הודעות על אותה תזכורת.
 *
 * ⚠️ בשלב 11 הריצה הזו לא תשלח דבר: הספק disabled בכל סביבה, ולכן אין
 * claim ואין ניסיון. התשובה מציגה זאת במפורש (enabled/dispatchable), כדי
 * שלא ייווצר רושם שמשהו נשלח.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const stats = await runReminderDispatch()
  return NextResponse.json({ ok: true, stats })
}
