import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual, createHash } from 'crypto'
import { runReminderDispatch } from '@/lib/reminders/dispatch'
import { completePastConfirmedAppointments } from '@/lib/db/appointments'

export const dynamic = 'force-dynamic'

/**
 * 🔒 תקרת גוף הבקשה.
 *
 * ⚠️ ה-route אינו קורא את הגוף בכלל — אין לו פרמטרים, וכל מה שהוא צריך
 * נמצא בכותרת Authorization. התקרה כאן אינה מגנה על פרסור (אין כזה) אלא
 * חוסמת בקשה שמנסה להזרים אליו מגה-בייטים לפני שהיא נדחית. היא נבדקת
 * **לפני** האימות ולפני כל נגיעה במסד.
 *
 * ⚠️ הגבול מבוטא בכותרת Content-Length, וזו כל תחולתו. בקשה שאינה
 * מצהירה על אורך (chunked) **אינה** נדחית כאן, ואין בכך פרצה: הגוף לעולם
 * אינו נקרא, ומה שחוסם גישה הוא ה-Bearer ולא התקרה. דחיית chunked הייתה
 * מסתכנת בשבירת scheduler לגיטימי בתמורה לאפס הגנה נוספת.
 */
const MAX_BODY_BYTES = 1024

/**
 * 🔒 אף תשובה כאן אינה ניתנת לשמירה במטמון.
 *
 * ⚠️ `private` בנוסף ל-`no-store`: התשובה מתארת את מצב מנגנון השליחה
 * (enabled/provider/ספירות), ואין שום proxy שאמור להחזיק אותה — גם לא
 * לרגע, וגם לא תשובת 401/404.
 */
const NO_STORE: Readonly<Record<string, string>> = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE } })
}

/**
 * נקודת הרצה פנימית לשליחת התזכורות — מוכנה לתזמון עתידי, ולא מתוזמנת עכשיו.
 *
 * ⚠️ שלב 11 אינו מפעיל Vercel Cron, אינו יוצר vercel.json ואינו פורס דבר.
 * ה-route קיים כדי שהתזמון בעתיד יהיה שינוי הגדרה ולא שינוי קוד.
 *
 * ═══ חוזה קודי התגובה ═══
 *
 *   404 — REMINDERS_DISPATCH_SECRET אינו מוגדר בשרת, או קצר מכדי להיות סוד.
 *         ה-endpoint פשוט אינו קיים בסביבה כזו, ואינו מסגיר את קיומו.
 *
 *   401 — **כשל אימות בלבד**: אין Authorization, ה-scheme אינו Bearer,
 *         ה-token ריק, או שאינו תואם.
 *
 *   200 — הבקשה אומתה. זה כולל את המצב שבו המערכת כבויה או שאין ספק:
 *         ⚠️ מצב כבוי הוא **מצב תפעולי תקין, לא כשל**. כש-Cron יחובר,
 *         החזרת 403 על מערכת כבויה הייתה מייצרת התראות כשל על כל הרצה
 *         מתוזמנת בזמן שהכול תקין. התשובה מחזירה enabled:false וספירות
 *         אפס, וזו התשובה הנכונה.
 *
 * ═══ ההגנה ═══
 *
 *   • secret נפרד לגמרי מ-session הניהול, ונפרד גם מזה של סנכרון היומן.
 *     דליפתו אינה נותנת גישה לאזור הניהול.
 *   • השוואה בזמן קבוע. השוואת מחרוזות רגילה יוצאת מוקדם בתו הראשון שאינו
 *     תואם, ומדליפה בכך את אורך הקידומת הנכונה.
 *   • ה-secret מתקבל אך ורק מכותרת Authorization. אינו נקרא מ-query string
 *     (שם היה נכתב ללוגי גישה של השרת), ואינו נקרא מכותרת אחרת.
 *   • התשובה היא דגלים וספירות בלבד — לעולם לא ה-secret, מזהי תזכורות,
 *     שמות, טלפונים או גוף הודעה.
 *   • הגנה מפני הפעלה כפולה היא ה-lease ב-DB, לא ה-route.
 *
 * ═══ 0029 — sibling call עצמאי, לא הרחבה של runReminderDispatch ═══
 *
 * ⚠️ **לא נכנס לתוך runReminderDispatch.** השער שם (shouldDispatch, שורה
 * "gate → sweep → claim") הוא כלל ספציפי לתזכורות: "כשהמערכת כבויה, אין
 * שום כתיבה" — ונועד למנוע כתיבות תזכורות לא רצויות, לא לחסום פעולות
 * שאין להן שום קשר לתזכורות. סיום תור אוטומטי הוא עובדה על תור שעבר
 * את זמנו, לא תלוי ב-REMINDERS_ENABLED/isNewBookingSystemEnabled, ואסור
 * שידום אם מישהו יכבה את דגל התזכורות מסיבה שאין לה שום קשר לסיום תורים.
 *
 * זו הסיבה שהקריאה כאן היא שלב עצמאי ב-route, עם try/catch משלה: תקלה
 * בסיום תורים לא תמנע דיוור תזכורות, ותקלה בדיוור לא תמנע סיום תורים.
 * שני הצדדים כותבים best-effort (completePastConfirmedAppointments כבר
 * עוטפת ומדפיסה ללוג, בדיוק כמו expireStalePendingAppointments) — ה-try
 * כאן הוא הגנה כפולה בלבד, למקרה שמשהו יזרוק בכל זאת.
 *
 * 🔒 שיתוף התשתית מוגבל ל-transport: אותו secret, אותו route, אותה קריאת
 * QStash של 5 דקות. שום לוגיקה עסקית אינה משותפת בין שני הצדדים.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.REMINDERS_DISPATCH_SECRET

  // לא מוגדר, או קצר מכדי להיות סוד אמיתי → אין route.
  if (!secret || secret.length < 32) {
    return json({ error: 'not_found' }, 404)
  }

  // ⚠️ תקרת הגוף נבדקת **לפני** האימות: בקשה עצומה נדחית בלי שהשרת יקרא
  // ממנה בייט, ובלי שנגיע לחישוב ההשוואה.
  const tooLarge = bodyTooLarge(req.headers.get('content-length'))
  if (tooLarge) {
    return json({ error: 'payload_too_large' }, 413)
  }

  const token = bearerToken(req.headers.get('authorization'))
  if (!token || !secretsMatch(token, secret)) {
    return json({ error: 'unauthorized' }, 401)
  }

  try {
    await completePastConfirmedAppointments()
  } catch (err) {
    console.error('[internal/reminders] completion sweep threw',
      err instanceof Error ? err.message : String(err))
  }

  // ⚠️ אין כאן בדיקת דגל שמחזירה 403. הדגלים נבדקים בתוך ה-dispatcher,
  // ומצב כבוי חוזר כ-200 עם enabled:false ואפס כתיבות למסד.
  const stats = await runReminderDispatch()
  return json({ ok: true, stats }, 200)
}

/**
 * 🔒 כל מתודה שאינה POST — 405, בלי נגיעה במסד ובלי הפעלת הספק.
 *
 * ⚠️ Next מחזיר 405 מעצמו על מתודה שאין לה handler, אבל **בלי הכותרות
 * שלנו ובלי Allow**. הצהרה מפורשת היא מה שהופך את זה להתנהגות בדוקה: אין
 * מסלול GET שאפשר לירות עליו מדפדפן או מ-prefetch, ואין תשובה שנשמרת
 * במטמון. ה-route הזה גורם לשליחת SMS — הוא אינו אמור להיות ניתן
 * להפעלה בניווט.
 *
 * ⚠️ אינו מסגיר את קיום ה-endpoint יותר משעשה קודם: 405 חוזר בין אם
 * ה-secret מוגדר ובין אם לא, ולפני כל בדיקת הרשאה.
 */
function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { error: 'method_not_allowed' },
    { status: 405, headers: { ...NO_STORE, Allow: 'POST' } },
  )
}

export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const HEAD = methodNotAllowed
export const OPTIONS = methodNotAllowed

/**
 * האם הגוף גדול מהמותר.
 *
 * ⚠️ כותרת חסרה → false (ראה MAX_BODY_BYTES). כותרת **פסולה** — לא
 * מספר, שלילית — → true: מי ששלח Content-Length שאינו מספר לא שלח בקשה
 * תמימה, ואין שום סיבה להמשיך לטפל בה.
 *
 * ⚠️ `Content-Length: 0` ובקשת POST קצרה הם המקרה התקין — QStash שולח
 * בדיוק כך.
 */
function bodyTooLarge(contentLength: string | null): boolean {
  if (contentLength === null) return false
  const n = Number(contentLength)
  if (!Number.isFinite(n) || n < 0) return true
  return n > MAX_BODY_BYTES
}

/**
 * מחלץ את ה-token מ-`Authorization: Bearer <token>`.
 *
 * מחזיר null על כל סטייה: אין כותרת, scheme אחר (Basic וכו'), Bearer בלי
 * ערך, או רווח בלבד. ה-scheme אינו תלוי רישיות — כך מגדיר RFC 7235.
 */
function bearerToken(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer[ \t]+(\S.*)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1].trim()
  return token.length > 0 ? token : null
}

/**
 * השוואה בזמן קבוע. שני הצדדים עוברים sha256 תחילה כדי שהאורכים יהיו תמיד
 * שווים — timingSafeEqual זורק על buffers באורך שונה, וההבדל באורך עצמו
 * הוא דליפה.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}
