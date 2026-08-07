import 'server-only'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { cookies } from 'next/headers'
import { readSessionClaims, type SessionRole } from '@/lib/auth/sessionClaims'
import {
  createSessionRecord,
  deleteExpiredSessions,
  isSessionActive,
  revokeSessionRecord,
} from '@/lib/db/sessionStore'

/**
 * ניהול ה-session של הלקוחה — cookie חתום, HttpOnly, **עם רשומה בצד השרת**.
 *
 * מה שומר עלינו:
 *   • HttpOnly — JavaScript בדפדפן לא יכול לקרוא את ה-cookie (הגנה מ-XSS).
 *   • Secure בפרודקשן — נשלח רק על HTTPS.
 *   • SameSite=Lax — לא נשלח בבקשות חוצות-אתר (הגנה מ-CSRF).
 *   • חתימה — אי אפשר לזייף מזהה לקוחה בלי הסוד שבמשתני הסביבה.
 *   • 🔒 שלב 14: רשומת session (app_sessions, מיגרציה 0015) — logout מבטל
 *     אותה, וכך גם עותק של ה-token שנלקח *לפני* ההתנתקות מפסיק לעבוד.
 *
 * ה-session מכיל אך ורק מזהים ומספר טלפון — אין בו שום מידע רגיש, וגם אם
 * מישהו יפענח אותו (הוא חתום, לא מוצפן) הוא לא ילמד דבר שהלקוחה לא יודעת.
 *
 * ═══ 🔒 שלב 14 — מה נשבר כאן קודם ═══
 *
 * ⚠️ `destroySession` מחקה cookie מהדפדפן, וזו הייתה הפעולה **היחידה**
 * בהתנתקות. מי שהעתיק את ערך ה-cookie לפני כן נשאר מחובר עד 30 יום:
 * ה-token נשאר חתום כדין, `sub` שלו הצביע על auth user קיים, ו-`isAdmin()`
 * המשיכה להחזיר עבורו true — ולכן הוא עבר את **כל** שערי הגישה, כולל
 * `/admin`. שום בדיקה קיימת לא תפסה את זה, כי כולן שואלות "מי אתה" ואף
 * אחת לא שאלה "האם ה-session הזה עדיין חי".
 *
 * ⚠️ התיקון יושב כאן ולא ב-guards **בכוונה**: `getSession` היא הצוואר
 * היחיד שדרכו עוברים `requireAdminPage/Api`, `getCurrentCustomerId`,
 * `/login` ו-`/admin/login`. תיקון כאן מכסה את כולם, ואינו יכול "להישכח"
 * ב-route חדש שייכתב מחר.
 *
 * ⚠️ אין כאן cache של תוצאת האימות (גם לא `React.cache`) — ובמכוון.
 * ההבטחה של שלב 14 היא ש-session מבוטל מפסיק לעבוד **מיד**, וכל שכבת
 * זיכרון היא בדיוק החלון שבו הוא ממשיך לעבוד. אם יתברר בפרודקשן שמספר
 * ה-round-trips מכביד, הצעד הנכון הוא מדידה ואז cache שיוכח כ-request-scoped —
 * לא הנחה מראש.
 */

const COOKIE_NAME = 'sm_session'
/** התנתקות אוטומטית אחרי 30 יום */
const SESSION_TTL_DAYS = 30
const SESSION_TTL_SEC = SESSION_TTL_DAYS * 24 * 60 * 60

export type { SessionRole }

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

/** מאמת חתימה ותוקף בלבד. אינו יודע דבר על ביטול — ראה getSession. */
async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    return payload
  } catch {
    // תוקף פג, חתימה שגויה, או cookie מזויף — כולם מטופלים אותו דבר.
    // ⚠️ כאן גם נופלים כל ה-token-ים שהונפקו לפני החלפת SESSION_SECRET
    // במעבר לשלב 14, וזו בדיוק הכוונה.
    return null
  }
}

/**
 * יוצר session חדש: רושם אותו בשרת ורק אז מצרף cookie חתום לתגובה.
 *
 * ⚠️ **הסדר קריטי.** cookie שנכתב בלי רשומה מקבילה הוא token שייפסל מיד
 * באימות הבא — כלומר לקוחה שהזינה קוד תקין, ראתה "התחברת", והועפה החוצה
 * בעמוד הבא בלי שום הסבר. לכן: אין רשומה ⇒ אין cookie ⇒ הכניסה נכשלת
 * בגלוי, והקורא מציג שגיאה.
 *
 * מחזיר false כשלא ניתן היה לרשום את ה-session (fail-closed).
 */
export async function createSession(payload: SessionPayload): Promise<boolean> {
  // cid נשמר אך ורק ללקוחה. session של מנהלת לא נושאת בעלות על שום
  // לקוחה — גם לשובל ולרפאל יש שורת customers (כדי שיוכלו להתחבר), ואסור
  // שהיא תהפוך אותן ללקוחות לצורך /account או ביטול/הזזה של תור.
  const cid = payload.role === 'customer' ? payload.cid : undefined

  // 🔒 מזהה ה-session. אקראי מלא ולא נגזר משום דבר — אין דרך לנחש jti
  // של משתמשת אחרת, וגם ניחוש מוצלח חסר ערך בלי הסוד שחותם עליו.
  const jti = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000)

  const stored = await createSessionRecord({
    jti,
    authUserId: payload.userId,
    role: payload.role,
    expiresAt,
  })
  if (!stored) return false

  const token = await new SignJWT({ phone: payload.phone, role: payload.role, cid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setJti(jti)
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

  // ⚠️ אחרי שהכניסה כבר הצליחה, ובתוך פונקציה שלעולם אינה זורקת: ניקוי
  // תחזוקה לא יכול וגם לא צריך להפיל התחברות תקינה (ראה sessionStore).
  await deleteExpiredSessions()

  return true
}

/**
 * מחזיר את ה-session הנוכחי, או null אם אין / פג תוקף / החתימה לא תקפה /
 * **ה-session בוטל בשרת**.
 *
 * זו הפונקציה שכל קריאת נתונים באזור האישי חייבת לעבור דרכה — היא המקור
 * היחיד למזהה הלקוחה, ואסור לקחת מזהה כזה מגוף הבקשה או מפרמטר ב-URL.
 *
 * ⚠️ **אין יותר תאימות לאחור.** session שנוצר לפני שלב 14 (בלי jti) נדחה,
 * ומי שהייתה מחוברת בזמן המעבר מתחברת מחדש פעם אחת. ראה הנימוק המלא ב-
 * lib/auth/sessionClaims.ts: תקופת חסד הייתה משאירה את הפרצה עצמה פתוחה
 * למשך חיי ה-token שרצינו להרוג.
 *
 * 🔒 fail-closed: כשל בפנייה למסד מחזיר null, לא "אישור זמני".
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  const payload = await verifyToken(token)
  if (!payload) return null

  const claims = readSessionClaims(payload)
  if (!claims) return null

  // 🔒 התנאי השני, הבלתי תלוי: חתימה תקפה מוכיחה שה-token לא זויף —
  // ורק השורה במסד מוכיחה שהוא לא בוטל.
  const active = await isSessionActive({
    jti: claims.jti,
    authUserId: claims.userId,
    role: claims.role,
  })
  if (!active) return null

  return {
    userId: claims.userId,
    phone: claims.phone,
    role: claims.role,
    cid: claims.cid,
  }
}

export type LogoutOutcome =
  /** ה-session בוטל בשרת (או שכבר לא היה שמיש) — ההתנתקות מלאה */
  | 'revoked'
  /** לא היה session שאפשר לבטל: אין cookie, או שהוא פסול/פג/מלפני שלב 14 */
  | 'no_session'
  /** ⚠️ ה-cookie נמחק אך הביטול בשרת נכשל — **אין לדווח על הצלחה** */
  | 'revocation_failed'

/**
 * התנתקות: **קודם ביטול בשרת, ורק אחריו מחיקת ה-cookie.**
 *
 * ⚠️ הסדר הוא כל העניין. מחיקת ה-cookie מסירה את ה-token מהדפדפן *הזה*
 * בלבד; מה שהופך את ה-session לבלתי שמיש בכל מקום אחר הוא `revoked_at`.
 * לו היינו מוחקים קודם, היינו מאבדים את ה-jti — כלומר את היכולת לבטל
 * בכלל.
 *
 * ⚠️ ה-cookie נמחק **בכל מקרה**, גם כשהביטול נכשל: להשאיר אותו בדפדפן
 * אחרי שהמשתמשת ביקשה לצאת זו התוצאה הגרועה משתיהן. אבל הקורא מקבל
 * 'revocation_failed' ו**חייב** לדווח שהביטול לא הובטח — התנתקות שנראית
 * מוצלחת ולא בוצעה בשרת היא בדיוק השקר ששלב 14 בא לתקן.
 *
 * ⚠️ אינה קוראת ל-getSession במכוון: זו הייתה מחזירה null עבור session
 * שכבר בוטל *וגם* כשהמסד אינו זמין — ואז היינו מדלגים על הביטול בשקט
 * בדיוק במקרה שבו הוא הכי נחוץ.
 */
export async function destroySession(): Promise<LogoutOutcome> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value

  let outcome: LogoutOutcome = 'no_session'

  if (token) {
    const payload = await verifyToken(token)
    const claims = payload ? readSessionClaims(payload) : null

    if (claims) {
      outcome = (await revokeSessionRecord(claims.jti)) === 'revoked'
        ? 'revoked'
        : 'revocation_failed'
    }
    // אין claims: חתימה פסולה, תוקף פג, או token מלפני שלב 14. אין מה
    // לבטל — כזה token ממילא נדחה ב-getSession — ולכן 'no_session'.
  }

  cookieStore.delete(COOKIE_NAME)
  return outcome
}
