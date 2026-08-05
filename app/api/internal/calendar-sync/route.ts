import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual, createHash } from 'crypto'
import { runCalendarSync } from '@/lib/calendarInboundSync'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'

export const dynamic = 'force-dynamic'

/**
 * נקודת הרצה פנימית לסנכרון הנכנס — מוכנה לתזמון עתידי, ולא מתוזמנת עכשיו.
 *
 * ⚠️ שלב 8 אינו מפעיל Vercel Cron, אינו רושם webhook של Google ואינו
 * פורס דבר. ה-route קיים כדי שהתזמון בעתיד יהיה שינוי הגדרה ולא שינוי קוד.
 *
 * ההגנה:
 *   • secret נפרד לגמרי מ-session הניהול (CALENDAR_SYNC_SECRET). מנהלת
 *     שנחסמת אינה משפיעה עליו, ודליפתו אינה נותנת גישה לאזור הניהול.
 *   • השוואה בזמן קבוע. השוואת מחרוזות רגילה (===) יוצאת מוקדם בתו הראשון
 *     שאינו תואם, ומדליפה בכך את אורך הקידומת הנכונה.
 *   • המשתנה לא מוגדר → ה-route פשוט אינו קיים (404). כך סביבה שלא הוגדרה
 *     בכוונה אינה חושפת endpoint פתוח.
 *   • התשובה היא ספירות בלבד — לעולם לא טוקנים, לא מזהי אירועים ולא פרטי
 *     לקוחות.
 *   • הגנה מפני הפעלה כפולה היא ה-lease ב-DB, לא ה-route.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CALENDAR_SYNC_SECRET

  // לא מוגדר, או קצר מכדי להיות סוד אמיתי → אין route.
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (!isNewBookingSystemEnabled()) {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 403 })
  }

  const provided = req.headers.get('x-calendar-sync-secret')
  if (!provided || !secretsMatch(provided, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await runCalendarSync()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ ok: true, stats: result.stats })
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
