import 'server-only'
import { redirect, notFound } from 'next/navigation'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'

/**
 * שער הגישה היחיד לאזור /admin/(protected).
 *
 * שני עקרונות שאסור לשבור:
 *   1. הדגל: כשמערכת ההזמנות החדשה כבויה, כל אזור הניהול כבוי איתה —
 *      מחזירים 404 (notFound) ולא מסך שגיאה שמרמז שהוא קיים.
 *   2. ההרשאה תמיד נבדקת מול טבלת admins בפועל, גם אם ה-session שבידיים
 *      כבר מכיל role: 'admin'. כך מנהלת שנוספה לטבלה תוך כדי session
 *      פעיל מקבלת גישה מיד, ומנהלת שהוסרה נחסמת מיד — בלי לסמוך על
 *      תוכן ה-cookie.
 *
 * מחזירה את ה-userId המאומת לשימוש בעמוד (למשל ללוגים), אחרת מפנה
 * החוצה ולא חוזרת כלל.
 */
export async function requireAdminPage(): Promise<{ userId: string }> {
  if (!isNewBookingSystemEnabled()) notFound()

  const session = await getSession()
  if (!session) redirect('/admin/login')

  const admin = await isAdmin(session.userId)
  if (!admin) {
    // לקוחה רגילה מנותבת לאזור שלה, לא ללולאת login
    redirect(session.customerId ? '/account' : '/admin/login')
  }

  return { userId: session.userId }
}

/**
 * שער הגישה למקבילת ה-API של requireAdminPage — ל-routes תחת
 * app/api/admin/*, שם redirect/notFound אינם מתאימים (זו קריאת fetch, לא
 * ניווט). אותם שני עקרונות בדיוק: הדגל חוסם לפני הכול, וההרשאה תמיד
 * נבדקת מול admins בפועל.
 *
 * מחזירה את ה-userId המאומת, או תגובת שגיאה מוכנה לשימוש ישיר
 * (401 ללא session, 403 למחוברת שאינה admin או כשהדגל כבוי).
 */
export async function requireAdminApi(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  if (!isNewBookingSystemEnabled()) {
    return { ok: false, response: NextResponse.json({ error: 'feature_disabled' }, { status: 403 }) }
  }

  const session = await getSession()
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  }

  const admin = await isAdmin(session.userId)
  if (!admin) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }

  return { ok: true, userId: session.userId }
}
