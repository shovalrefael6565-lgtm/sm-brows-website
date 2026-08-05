import 'server-only'
import type { NextRequest } from 'next/server'

/**
 * הגנת same-origin ל-routes שמשנים מצב.
 *
 * ההגנה הקיימת באתר היא cookie עם sameSite:'lax' (lib/auth/session.ts),
 * שכבר מונע שליחת ה-session בבקשת POST חוצת-אתרים. הבדיקה כאן היא שכבה
 * שנייה ובלתי תלויה: היא לא סומכת על כך שכל דפדפן יאכוף lax נכון, ולא על
 * כך שהגדרת ה-cookie לא תשתנה בעתיד.
 *
 * ⚠️ בדיקה זו אינה מחליפה את requireAdminApi — היא נוספת עליו. כפתור
 * מוסתר או route "שאף אחד לא יודע עליו" אינם הגנה.
 *
 * בקשה ללא Origin (למשל curl או קריאת שרת-לשרת) אינה נחסמת כאן: CSRF הוא
 * תקיפה שמנצלת דפדפן עם cookie קיים, ודפדפן תמיד שולח Origin ב-POST.
 * ההרשאה עצמה נאכפת ממילא ע"י ה-session ו-is_admin.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true

  const host = req.headers.get('host')
  if (!host) return false

  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
