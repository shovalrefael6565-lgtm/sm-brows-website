import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { SessionRole } from '@/lib/auth/sessionClaims'

/**
 * גישה לטבלת app_sessions — הצד שנוגע בבסיס הנתונים (שלב 14, מיגרציה 0015).
 *
 * ═══ מה הקובץ הזה קונה ═══
 *
 * עד שלב 14 ה-session היה JWT חתום ותו לא, ו-logout מחק cookie מהדפדפן.
 * מי שהעתיק את ה-cookie לפני ההתנתקות נשאר מחובר עד 30 יום — כולל לאזור
 * הניהול. מכאן והלאה לכל token יש `jti` ורשומה מקבילה כאן, ואימות דורש
 * **שני** תנאים בלתי תלויים: חתימה תקפה *וגם* רשומה חיה.
 *
 * ═══ fail-closed ═══
 *
 * ⚠️ כל פונקציה כאן מחזירה את התשובה השמרנית כשהמסד אינו זמין:
 * `isSessionActive` מחזירה false (אין גישה), ו-`createSessionRecord`
 * מחזירה false (לא נוצר session ולכן לא ייכתב cookie). ההשלכה מכוונת
 * ומאושרת: תקלת Supabase מנתקת את כולן, ולא פותחת דלת.
 *
 * החריג היחיד הוא `deleteExpiredSessions` — ניקוי תחזוקה שאינו חלק
 * מהאימות ולעולם אינו מפיל כניסה תקינה. ראה הנימוק שם.
 *
 * ═══ למה אין כאן RPC ═══
 *
 * בניגוד ל-otpStore (0013), אין כאן שום read-then-write: כל פעולה היא
 * משפט SQL יחיד, ולכן אטומית ממילא. נעילה מפורשת לא הייתה מוסיפה הבטחה.
 *
 * הטבלה נגישה ל-service_role בלבד — RLS מופעל עם אפס policies — ולכן
 * הקובץ הזה חייב להישאר server-only.
 */

const TABLE = 'app_sessions'

/**
 * ⚠️ `code` בלבד, לעולם לא `message`/`details`/`hint`.
 * PostgREST מחזיר ב-details את השורה שגרמה לשגיאה, וזה היה מכניס מזהי
 * session ומשתמשות ללוג. אותה מדיניות בדיוק כמו ב-otpStore.
 */
function safeErrorCode(error: { code?: string | null } | null): string {
  return error?.code ?? 'unknown'
}

export interface NewSessionRecord {
  /** ה-jti של ה-JWT שנחתם באותו רגע */
  jti: string
  authUserId: string
  role: SessionRole
  expiresAt: Date
}

/**
 * רושמת session חדש. **חייבת להצליח לפני שנכתב cookie.**
 *
 * ⚠️ הסדר אינו עניין של סגנון: cookie שנכתב בלי רשומה מקבילה הוא token
 * שייפסל מיד באימות הראשון — כלומר לקוחה שהזינה קוד אימות תקין, קיבלה
 * "התחברת", והועפה החוצה בעמוד הבא בלי הסבר. עדיף להיכשל בגלוי בכניסה.
 *
 * מחזירה false על כל כשל — הקורא לא ימשיך ליצירת cookie.
 */
export async function createSessionRecord(record: NewSessionRecord): Promise<boolean> {
  const db = createSupabaseAdminClient()

  const { error } = await db.from(TABLE).insert({
    id: record.jti,
    auth_user_id: record.authUserId,
    role: record.role,
    expires_at: record.expiresAt.toISOString(),
  })

  if (error) {
    console.error('[appSessions] יצירת רשומת session נכשלה, sqlstate=', safeErrorCode(error))
    return false
  }

  return true
}

export interface SessionLookup {
  jti: string
  /** JWT.sub — חייב להתאים לשורה */
  authUserId: string
  /** JWT.role — חייב להתאים לשורה */
  role: SessionRole
}

/**
 * האם ה-session הזה עדיין חי.
 *
 * ארבעה תנאים, וכולם חייבים להתקיים:
 *   1. השורה קיימת — jti שאין לו רשומה אינו session, גם אם החתימה תקפה.
 *   2. `revoked_at IS NULL` — כלומר לא בוצע logout.
 *   3. התוקף לא פג.
 *   4. `auth_user_id` ו-`role` תואמים למה שחתום ב-token.
 *
 * ⚠️ תנאי 4 הוא הגנה לעומק ולא ההגנה העיקרית — בלי SESSION_SECRET אי אפשר
 * לחתום token סביב jti גנוב מלכתחילה. הוא קיים כדי שגם תקלה שמצליבה בין
 * שורות (למשל שגיאת קוד עתידית) תיעצר כאן ולא תהפוך ללקוחה שנכנסת
 * כמנהלת.
 *
 * ⚠️ אין כאן עדכון `last_seen` ואין הארכת תוקף. אימות הוא קריאה בלבד:
 * כתיבה בכל בקשה הייתה הופכת כל טעינת עמוד ל-write במסד, ו-refresh
 * להארכת session אילמת שהמשתמשת לא ביקשה.
 */
export async function isSessionActive(lookup: SessionLookup): Promise<boolean> {
  const db = createSupabaseAdminClient()

  const { data, error } = await db
    .from(TABLE)
    .select('auth_user_id, role, expires_at, revoked_at')
    .eq('id', lookup.jti)
    .maybeSingle()

  if (error) {
    // 🔒 fail-closed: מסד שאינו עונה אינו "אישור זמני"
    console.error('[appSessions] בדיקת session נכשלה, sqlstate=', safeErrorCode(error))
    return false
  }

  // אין שורה: ה-session לא נוצר מעולם, או שנוקה אחרי שפג תוקפו
  if (!data) return false

  const row = data as {
    auth_user_id: string
    role: string
    expires_at: string
    revoked_at: string | null
  }

  if (row.revoked_at !== null) return false
  if (new Date(row.expires_at).getTime() <= Date.now()) return false
  if (row.auth_user_id !== lookup.authUserId) {
    console.error('[appSessions] אי-התאמה בין auth user שב-token לשורת ה-session — נדחה')
    return false
  }
  if (row.role !== lookup.role) {
    console.error('[appSessions] אי-התאמה בין role שב-token לשורת ה-session — נדחה')
    return false
  }

  return true
}

export type RevokeOutcome =
  /** השורה סומנה כמבוטלת עכשיו, או שכבר הייתה מבוטלת/לא קיימת */
  | 'revoked'
  /** המסד לא ענה — **אין לדווח למשתמשת שההתנתקות הובטחה** */
  | 'error'

/**
 * מבטלת session אחד לפי ה-jti שלו. זו הפעולה שהופכת logout לאירוע אבטחה
 * אמיתי ולא לניקוי מקומי.
 *
 * ⚠️ שורה שאינה קיימת מוחזרת כ-'revoked' ולא ככשל, וזה נכון ולא ויתור:
 * המשמעות היחידה של היעדר שורה היא ש-`isSessionActive` תדחה את ה-token
 * ממילא (תנאי 1). הדיווח משקף את המצב בפועל — ה-session אינו שמיש —
 * ולא את מספר השורות שהעדכון נגע בהן.
 *
 * ⚠️ `revoked_at` לעולם אינו חוזר ל-NULL, ולכן ביטול חוזר של אותו session
 * אינו משנה דבר. אין כאן `.is('revoked_at', null)` בכוונה: הוא היה מבחין
 * בין "ביטלתי עכשיו" ל"כבר היה מבוטל", וזו הבחנה שאין לה שום שימוש כאן —
 * ושתי התוצאות בטוחות באותה מידה.
 */
export async function revokeSessionRecord(jti: string): Promise<RevokeOutcome> {
  const db = createSupabaseAdminClient()

  const { error } = await db
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', jti)

  if (error) {
    console.error('[appSessions] ביטול session נכשל, sqlstate=', safeErrorCode(error))
    return 'error'
  }

  return 'revoked'
}

/**
 * ניקוי opportunistic של שורות שפג תוקפן.
 *
 * ⚠️ **לעולם אינה זורקת ולעולם אינה מחזירה כשל לקורא** — ובכוונה. הניקוי
 * אינו חלק מאימות ואינו חלק מהכניסה: שורה שפג תוקפה כבר נדחית ב-
 * `isSessionActive` (תנאי 3), ולכן קיומה אינו סיכון אלא מקום בדיסק.
 * כשל ניקוי שהיה מפיל כניסה תקינה היה הופך תחזוקה לתקלת זמינות.
 *
 * ⚠️ נמחקות שורות שפג תוקפן בלבד. שורה שבוטלה אך תוקפה עוד לא פג נשארת —
 * היא הראיה שההתנתקות בוצעה, והיא נמחקת בסיבוב שאחרי הפקיעה.
 *
 * אין כאן Cron ואין job מתוזמן: הניקוי רץ בעקבות כניסה מוצלחת בלבד.
 */
export async function deleteExpiredSessions(): Promise<void> {
  try {
    const db = createSupabaseAdminClient()
    const { error } = await db.from(TABLE).delete().lt('expires_at', new Date().toISOString())

    if (error) {
      console.error('[appSessions] ניקוי sessions שפג תוקפם נכשל, sqlstate=', safeErrorCode(error))
    }
  } catch (err) {
    // תצורה חסרה, רשת, כל דבר — הכניסה כבר הצליחה ואסור שהניקוי יבטל אותה
    console.error('[appSessions] ניקוי sessions נכשל בחריגה', err instanceof Error ? err.message : '')
  }
}
