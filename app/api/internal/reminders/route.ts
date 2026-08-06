import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual, createHash } from 'crypto'
import { runReminderDispatch } from '@/lib/reminders/dispatch'

export const dynamic = 'force-dynamic'

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
 */
export async function POST(req: NextRequest) {
  const secret = process.env.REMINDERS_DISPATCH_SECRET

  // לא מוגדר, או קצר מכדי להיות סוד אמיתי → אין route.
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const token = bearerToken(req.headers.get('authorization'))
  if (!token || !secretsMatch(token, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ⚠️ אין כאן בדיקת דגל שמחזירה 403. הדגלים נבדקים בתוך ה-dispatcher,
  // ומצב כבוי חוזר כ-200 עם enabled:false ואפס כתיבות למסד.
  const stats = await runReminderDispatch()
  return NextResponse.json({ ok: true, stats })
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
