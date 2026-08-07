import { NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/**
 * POST ולא GET — כדי שקישור או תמונה באתר אחר לא יוכלו לנתק את הלקוחה.
 *
 * 🔒 שלב 14: ההתנתקות מבטלת את ה-session בשרת (app_sessions.revoked_at)
 * ורק אחר כך מוחקת את ה-cookie, וכך גם עותק של ה-token שנלקח לפני
 * ההתנתקות מפסיק לעבוד מיד.
 *
 * ⚠️ אין כאן `isSameOrigin`, כפי שהיה גם קודם. CSRF על logout מטריד
 * (מישהו יכול "להתנתק" בשמך) אך אינו מסלול לגישה, ו-`sameSite=lax` כבר
 * חוסם את ה-cookie בבקשת POST חוצת-אתר. שינוי כזה הוא החלטה נפרדת
 * ולא חלק משלב 14.
 */
export async function POST() {
  const outcome = await destroySession()

  /*
   * ⚠️ **אין לדווח על התנתקות שלא הובטחה.** ה-cookie אכן נמחק מהדפדפן
   * הזה, אבל הביטול בשרת נכשל — כלומר עותק של ה-token שנלקח קודם עדיין
   * יכול לעבוד. זה בדיוק המצב ששלב 14 בא לסגור, ו-`{ ok: true }` כאן היה
   * מחזיר אותו במסווה של הצלחה.
   *
   * 503 ולא 500: הכשל הוא זמינות של המסד, והפעולה שווה ניסיון חוזר.
   */
  if (outcome === 'revocation_failed') {
    return NextResponse.json(
      {
        ok: false,
        error: 'revocation_failed',
        message: 'התנתקת מהמכשיר הזה, אך לא הצלחנו לבטל את החיבור בשרת. נסי שוב בעוד רגע.',
      },
      { status: 503 },
    )
  }

  return NextResponse.json({ ok: true })
}
