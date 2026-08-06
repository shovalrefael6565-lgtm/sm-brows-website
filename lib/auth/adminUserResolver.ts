import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'

/**
 * איתור ואימות של חשבון ההתחברות (auth user) מצד השרת (שלב 10).
 *
 * ⚠️ למה לא RPC שקורא את auth.users: Supabase חוסמת את סכמת auth בפני
 * תפקידי ה-API. אימתנו מול הפרויקט האמיתי —
 * `schema('auth').from('users')` מחזיר "Invalid schema: auth". פונקציית
 * SQL שהייתה עושה SELECT על auth.users הייתה עוברת ב-PGlite ונכשלת רק
 * אחרי התקנת המיגרציה בפרודקשן. לכן כל הגישה ל-auth עוברת דרך Auth Admin
 * API, שהוא הממשק הנתמך.
 *
 * ⚠️ שום דבר מכאן לא מגיע ל-client. הפונקציות מחזירות UUID או union של
 * מחרוזות — לעולם לא אובייקט user, לא email, לא metadata ולא טלפון.
 */

/** תקרת בטיחות: 50 עמודים × 200 = 10,000 משתמשים. מונע לולאה אינסופית אם ה-API יחזיר תשובה חריגה. */
const MAX_PAGES = 50
const PER_PAGE = 200

/**
 * החלק היחיד של Supabase שהפונקציות כאן צריכות.
 *
 * הפרמטר האופציונלי בשתי הפונקציות אינו "פתח לבדיקות" שמחליש משהו: המודול
 * הוא server-only, והברירת מחדל היא תמיד הלקוח האמיתי. הוא מאפשר לבדוק
 * מול Auth Admin מזויף — כולל עמוד שני, טלפון סותר ושני משתמשים לאותו
 * מספר — בלי ליצור משתמשים אמיתיים ב-Supabase.
 */
export interface AuthAdminLike {
  auth: {
    admin: {
      getUserById(id: string): Promise<{ data: { user: { phone?: string | null } | null } | null; error: unknown }>
      listUsers(params: { page: number; perPage: number }): Promise<{
        data: { users: { id: string; phone?: string | null }[] } | null
        error: { message: string } | null
      }>
    }
  }
}

export type VerifyPhoneResult = 'ok' | 'not_found' | 'phone_mismatch'

/**
 * מאמתת שה-auth user קיים ושהטלפון שלו הוא בדיוק הטלפון שאומת ב-OTP.
 *
 * זו הבדיקה שמחליפה את אימות הטלפון שתוכנן בתוך ה-RPC. בלעדיה, באג
 * ב-route היה יכול לקשר auth user לטלפון של מישהי אחרת.
 */
export async function verifyAuthUserPhone(
  authUserId: string,
  phoneE164: string,
  client?: AuthAdminLike,
): Promise<VerifyPhoneResult> {
  const db = client ?? (createSupabaseAdminClient() as unknown as AuthAdminLike)
  const { data, error } = await db.auth.admin.getUserById(authUserId)

  if (error || !data?.user) return 'not_found'

  // Supabase שומר את הטלפון בלי ה-+ ; normalizePhone מכסה את שני הפורמטים
  // ומחזיר ייצוג יחיד, ולכן ההשוואה אינה תלויה בפורמט האחסון.
  const stored = normalizePhone(data.user.phone ?? '')
  return stored !== null && stored === phoneE164 ? 'ok' : 'phone_mismatch'
}

export type FindAuthUserResult =
  | { ok: true; id: string | null }
  | { ok: false; error: 'ambiguous' | 'lookup_failed' }

/**
 * מוצאת auth user לפי טלפון מאומת.
 *
 * ⚠️ נקראת רק כשאין קיצור דרך: לקוחה בלי auth_user_id, או recovery אחרי
 * ש-createUser החזיר duplicate. התחברות רגילה של לקוחה מקושרת אינה מגיעה
 * לכאן כלל — היא מסתפקת ב-verifyAuthUserPhone.
 *
 * זה מה שפותר את התקיעה שבה auth user קיים מדור קודם אך אף customer אינה
 * מקושרת אליו: המתנה על customers.auth_user_id לבדה הייתה נכשלת לנצח.
 *
 * סיום ה-pagination חד-משמעי: עמוד שחזר קטן מ-PER_PAGE הוא האחרון. בנוסף
 * יש תקרת עמודים, כדי שתשובת API חריגה (למשל עמוד מלא שחוזר לנצח) לא
 * תיצור לולאה אינסופית.
 */
export async function findAuthUserIdByPhone(
  phoneE164: string,
  client?: AuthAdminLike,
): Promise<FindAuthUserResult> {
  const db = client ?? (createSupabaseAdminClient() as unknown as AuthAdminLike)
  const matches: string[] = []

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) {
      console.error('[authResolver] listUsers failed', error.message)
      return { ok: false, error: 'lookup_failed' }
    }

    const users = data?.users ?? []
    for (const u of users) {
      if (normalizePhone(u.phone ?? '') === phoneE164) matches.push(u.id)
    }

    // שני מצבי עצירה מפורשים: עמוד חלקי (האחרון) או עמוד ריק.
    if (users.length < PER_PAGE) break
  }

  // יותר מ-auth user אחד לאותו טלפון הוא מצב נתונים פגום. אין לבחור אחד
  // באקראי ואין למזג — זה היה יכול לקשר לקוחה לחשבון של מישהי אחרת.
  if (matches.length > 1) return { ok: false, error: 'ambiguous' }
  return { ok: true, id: matches[0] ?? null }
}
