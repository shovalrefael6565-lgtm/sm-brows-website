import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

/**
 * ניהול ה-session של הלקוחה — cookie חתום, HttpOnly.
 *
 * מה שומר עלינו:
 *   • HttpOnly — JavaScript בדפדפן לא יכול לקרוא את ה-cookie (הגנה מ-XSS).
 *   • Secure בפרודקשן — נשלח רק על HTTPS.
 *   • SameSite=Lax — לא נשלח בבקשות חוצות-אתר (הגנה מ-CSRF).
 *   • חתימה — אי אפשר לזייף מזהה לקוחה בלי הסוד שבמשתני הסביבה.
 *
 * ה-session מכיל אך ורק מזהה ומספר טלפון — אין בו שום מידע רגיש, וגם אם
 * מישהו יפענח אותו (הוא חתום, לא מוצפן) הוא לא ילמד דבר שהלקוחה לא יודעת.
 */

const COOKIE_NAME = 'sm_session'
/** התנתקות אוטומטית אחרי 30 יום */
const SESSION_TTL_DAYS = 30
const SESSION_TTL_SEC = SESSION_TTL_DAYS * 24 * 60 * 60

export type SessionRole = 'customer' | 'admin'

export interface SessionPayload {
  /** auth.users.id — המקור ב-admins.user_id וב-customers.auth_user_id */
  userId: string
  phone: string
  /**
   * רמז לניתוב בלבד (איזה מסך להראות מיד אחרי כניסה) — לעולם לא מקור
   * ההרשאה. כל בדיקת גישה ל-/admin חייבת לשאול מחדש את טבלת admins
   * (ראה lib/auth/adminGuard.ts), כדי שמחיקת הרשאה תיחסם מיד ולא רק
   * אחרי שה-session הישן יפוג.
   */
  role: SessionRole
  /**
   * ⚠️ **רמז בלבד — לעולם לא מקור בעלות.**
   *
   * מאז שלב 10 מזהה הלקוחה אינו זהה ל-auth user id, ולכן הוא נשמר כאן
   * במפורש. אבל חתימה מונעת *זיוף*, לא *התיישנות*: ה-cookie תקף 30 יום,
   * ובתוכם ה-auth user יכול להימחק או ה-auth_user_id להתאפס ל-NULL, בעוד
   * ה-cid הישן ממשיך להצביע על לקוחה קיימת. route שהיה סומך עליו לבדו
   * (עם service_role, שעוקף RLS) היה ממשיך לתת גישה.
   *
   * לכן הבעלות מוכחת מחדש בכל בקשה מול customers.auth_user_id — ראה
   * lib/auth/currentCustomer.ts. ה-cid משמש שם אך ורק כבדיקת עקביות:
   * אם הוא סותר את ה-DB, ה-session נדחה.
   *
   * קיים רק כש-role === 'customer'. ל-admin אין בעלות על לקוחה, גם אם
   * קיימת לו שורת customers טכנית.
   */
  cid?: string
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is missing or too short (needs at least 32 chars). Generate with: openssl rand -hex 32',
    )
  }
  return new TextEncoder().encode(secret)
}

/** יוצר cookie חתום ומצרף אותו לתגובה */
export async function createSession(payload: SessionPayload): Promise<void> {
  // cid נשמר אך ורק ללקוחה. session של מנהלת לא נושאת בעלות על שום
  // לקוחה — גם לשובל ולרפאל יש שורת customers (כדי שיוכלו להתחבר), ואסור
  // שהיא תהפוך אותן ללקוחות לצורך /account או ביטול/הזזה של תור.
  const cid = payload.role === 'customer' ? payload.cid : undefined

  const token = await new SignJWT({ phone: payload.phone, role: payload.role, cid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(getSecret())

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  })
}

/**
 * מחזיר את ה-session הנוכחי, או null אם אין / פג תוקף / החתימה לא תקפה.
 *
 * זו הפונקציה שכל קריאת נתונים באזור האישי חייבת לעבור דרכה — היא המקור
 * היחיד למזהה הלקוחה, ואסור לקחת מזהה כזה מגוף הבקשה או מפרמטר ב-URL.
 *
 * תואם לאחור: session שנוצר לפני הוספת role/admins (מכיל רק sub+phone,
 * בלי role) עדיין מפוענח בהצלחה כ-role: 'customer' — כך שלקוחות מחוברות
 * לא מתנתקות כשהקוד הזה עולה לפרודקשן.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    if (!payload.sub || typeof payload.phone !== 'string') return null

    const userId = payload.sub
    const role: SessionRole = payload.role === 'admin' ? 'admin' : 'customer'
    return {
      userId,
      phone: payload.phone,
      role,
      // ⚠️ לא נגזר מ-userId. עד שלב 10 הם היו אותו ערך, ולקיחת ה-auth id
      // כמזהה לקוחה הייתה עובדת "במקרה". session ישן (לפני שלב 10) פשוט
      // אין לו cid, וההיפוך לזהות הלקוחה נעשה מול ה-DB.
      cid: typeof payload.cid === 'string' ? payload.cid : undefined,
    }
  } catch {
    // תוקף פג, חתימה שגויה, או cookie מזויף — כולם מטופלים אותו דבר
    return null
  }
}

/** מוחק את ה-session (התנתקות) */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}
