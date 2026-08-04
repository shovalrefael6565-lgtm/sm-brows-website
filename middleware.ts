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
