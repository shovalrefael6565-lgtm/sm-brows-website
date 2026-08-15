import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

export const config = {
  matcher: ['/login'],
}

/**
 * שלב 2 (מידע פרטי) — ניקוי cookie קרוס בעל JWT לא תקף/פג תוקף בלבד.
 *
 * ⚠️ הגרסה הקודמת קראה ל-getCustomerById (service_role, Supabase) כדי
 * לזהות session "יתום" — token חתום כדין שמצביע לזהות שנמחקה מ-customers.
 * זה חשף מפתח service_role לסביבת ה-Edge בלי צורך אמיתי: הטבלה שמאחורי
 * ביטול ה-session (0015_app_sessions.sql) מוגדרת ON DELETE CASCADE על
 * auth.users, וכל route שקורא נתוני לקוחה/מנהלת מוודא בעלות מחדש מול
 * ה-DB בכל בקשה (getCurrentCustomerId ב-lib/auth/currentCustomer.ts,
 * isAdmin ב-lib/auth/adminGuard.ts). session יתום תקף נדחה שם תמיד —
 * ה-cookie המת שנשאר בדפדפן אינו פרצה, רק תגית שתידרס בהתחברות הבאה.
 * אין יותר צורך ב-DB כאן כדי להבטיח את זה.
 *
 * ⚠️ אין להוסיף כאן קריאה ל-app_sessions: middleware רץ ב-Edge, וכל מה
 * שהוא נוגע בו נגרר לסביבה הזו יחד עם הסודות שהוא צריך. בדיקת הביטול
 * חיה בקוד שרת בלבד — getSession (lib/auth/session.ts).
 *
 * מה שנשאר: בדיקת JWT טהורה (חתימה + תוקף), בלי מסד ובלי service_role.
 * token מזויף/פג-תוקף נמחק כאן מיידית — נוחות בלבד, לא שער אבטחה: גם
 * בלעדיו הוא נדחה ב-getSession בכל route.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get('sm_session')?.value
  if (!token) return NextResponse.next()

  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) return NextResponse.next()

  try {
    await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] })
    return NextResponse.next()
  } catch {
    // חתימה לא תקפה או תוקף פג — מנקים כאן כדי לא להשאיר cookie מת בדפדפן.
    const res = NextResponse.next()
    res.cookies.delete('sm_session')
    return res
  }
}
