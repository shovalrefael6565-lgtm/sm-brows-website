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

export interface SessionPayload {
  /** auth.users.id — זהה ל-customers.id */
  customerId: string
  phone: string
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
  const token = await new SignJWT({ phone: payload.phone })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.customerId)
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
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    if (!payload.sub || typeof payload.phone !== 'string') return null
    return { customerId: payload.sub, phone: payload.phone }
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
