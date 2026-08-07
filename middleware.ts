import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { getCustomerById } from '@/lib/db/customers'

export const config = {
  matcher: ['/login'],
}

/**
 * מנקה מהדפדפן cookie session "יתום" — חתום כדין ובתוקף, אבל מצביע
 * לזהות (auth.users) שכבר לא קיימת ב-DB, למשל אחרי ניקוי נתוני בדיקה.
 *
 * app/login/page.tsx כבר לא מפנה בעיוורון ל-/account/-/admin על סמך
 * session שקיים — הוא בודק existence ומונע בכך את הלולאה. אבל בדיקה
 * זו לא יכולה גם למחוק את ה-cookie: Next.js מתיר לשנות cookies רק
 * מתוך Server Action, Route Handler, או Middleware — לא מתוך רינדור
 * של Server Component (כמו העמוד עצמו). לכן הניקוי בפועל קורה כאן.
 *
 * הבדיקה: שורת customers קיימת עבור ה-userId החתום. כל זהות אמיתית —
 * לקוחה או מנהלת כאחד — מקבלת שורת customers ב-findOrCreateCustomer
 * (lib/db/customers.ts), כך שהיעדרה מוכיח חד-משמעית שה-session יתום,
 * בלי תלות ב-role.
 *
 * ═══ 🔒 שלב 14 — למה בדיקת הביטול *אינה* כאן ═══
 *
 * ⚠️ אין להוסיף כאן קריאה ל-app_sessions. middleware ב-Next רץ ב-Edge,
 * וכל מה שהוא נוגע בו נגרר לסביבה הזו יחד עם הסודות שהוא צריך. בדיקת
 * הביטול חיה בקוד שרת בלבד — `getSession` (lib/auth/session.ts) — שדרכו
 * עוברים ממילא כל שערי הגישה.
 *
 * ⚠️ ההשלכה, במכוון: cookie של session **מבוטל** לא ייעלם מהדפדפן כאן —
 * הוא ייראה "לא יתום" (הלקוחה קיימת) וישרוד. זה אינו פתח גישה: `getSession`
 * דוחה אותו בכל מסלול, `/login` יציג מסך התחברות, והכניסה הבאה תדרוס אותו.
 * ההפרש הוא cookie מת בדפדפן, לא הרשאה.
 *
 * ⚠️ הערה שאינה נוגעת לשלב 14 אבל חשובה לרישום: `getCustomerById` משתמשת
 * ב-service_role, ולכן המפתח כבר מגיע לסביבת ה-Edge היום — עוד לפני שלב
 * 14 ובלי קשר אליו. שלב 14 לא הוסיף לכך דבר. הסרת התלות הזו היא שינוי
 * נפרד שדורש החלטה משלו.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get('sm_session')?.value
  if (!token) return NextResponse.next()

  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) return NextResponse.next()

  let userId: string | undefined
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] })
    userId = typeof payload.sub === 'string' ? payload.sub : undefined
  } catch {
    userId = undefined // חתימה לא תקפה / תוקף פג — מטופל כיתום למטה
  }

  const orphaned = !userId || !(await getCustomerById(userId))
  if (!orphaned) return NextResponse.next()

  const res = NextResponse.next()
  res.cookies.delete('sm_session')
  return res
}
