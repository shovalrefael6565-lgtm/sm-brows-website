import 'server-only'
import type { JWTPayload } from 'jose'

/**
 * קריאת ה-claims מתוך JWT שכבר עבר אימות חתימה — לוגיקה טהורה.
 *
 * ═══ למה זה קובץ נפרד ═══
 *
 * ⚠️ הסיבה אינה סגנון. `lib/auth/session.ts` מייבא `next/headers` ומדבר עם
 * Supabase, ולכן אי אפשר לייבא אותו לסקריפט בדיקה — `cookies()` זורקת
 * מחוץ להקשר של בקשה. המשמעות הייתה שההחלטה הקריטית ביותר בשלב 14
 * ("token בלי jti אינו תקף") הייתה נבדקת רק ע"י חיפוש מחרוזת בקוד המקור.
 *
 * כאן אין תלות בבקשה ואין תלות במסד, ולכן `scripts/test-session-revocation.mjs`
 * חותם token אמיתי עם jose ומריץ עליו את הפונקציה הזו ממש.
 *
 * ⚠️ הקובץ הזה בודק **צורה בלבד**. הוא אינו יודע אם ה-session בוטל — זו
 * שאלה למסד (lib/db/sessionStore.ts), ואין לו שום דרך לענות עליה.
 */

export type SessionRole = 'customer' | 'admin'

export interface SessionClaims {
  /** auth.users.id — המקור ב-admins.user_id וב-customers.auth_user_id */
  userId: string
  phone: string
  role: SessionRole
  /** מזהה ה-session, המפתח לשורה ב-app_sessions */
  jti: string
  /** ⚠️ רמז בלבד, לעולם לא מקור בעלות — ראה lib/auth/session.ts */
  cid?: string
}

/**
 * ממירה payload מאומת ל-claims, או null אם הוא אינו session תקין.
 *
 * ═══ 🔒 שלב 14: token ללא jti נדחה, בלי תקופת חסד ═══
 *
 * ⚠️ זו ההחלטה שמנתקת פעם אחת את כל מי שהייתה מחוברת בזמן המעבר, וזה
 * מחיר מכוון ומאושר. "תקופת חסד" שהייתה מקבלת token ישן פירושה שהפרצה
 * שבגללה נבנה שלב 14 — JWT שהועתק לפני logout וממשיך לעבוד — נשארת
 * פתוחה לרוחב עוד 30 יום, כלומר בדיוק משך החיים של ה-token שרצינו להרוג.
 *
 * ⚠️ ההגנה כאן אינה לבדה: במעבר לשלב 14 מוחלף גם SESSION_SECRET פעם אחת,
 * ולכן ה-token-ים הישנים נופלים כבר באימות החתימה ולא מגיעים לכאן. שתי
 * שכבות בלתי תלויות — אם אחת מהן תישכח בפריסה, השנייה עדיין תופסת.
 * (הסוד **אינו** מוחלף בכל logout — זה היה מנתק את כל המשתמשות בכל פעם.)
 */
export function readSessionClaims(payload: JWTPayload): SessionClaims | null {
  if (!payload.sub || typeof payload.sub !== 'string') return null
  if (typeof payload.phone !== 'string') return null

  // 🔒 בלי jti אין מה לחפש ב-app_sessions, ולכן אין דרך לדעת אם ה-session
  // בוטל. token כזה נדחה — הוא בהגדרה token מלפני שלב 14.
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) return null

  return {
    userId: payload.sub,
    phone: payload.phone,
    // ⚠️ ברירת המחדל 'customer' נשמרת מהמימוש הקודם. אין כאן יותר token
    // בלי role (כזה היה גם בלי jti ונדחה למעלה), אבל ההסלמה לכיוון
    // 'admin' לעולם לא תקרה מערך לא צפוי — רק ההפך.
    role: payload.role === 'admin' ? 'admin' : 'customer',
    jti: payload.jti,
    // ⚠️ לא נגזר מ-userId. עד שלב 10 הם היו אותו ערך, ולקיחת ה-auth id
    // כמזהה לקוחה הייתה עובדת "במקרה".
    cid: typeof payload.cid === 'string' ? payload.cid : undefined,
  }
}
