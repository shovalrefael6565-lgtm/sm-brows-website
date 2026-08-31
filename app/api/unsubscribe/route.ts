import { NextRequest, NextResponse } from 'next/server'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { applyOptOut } from '@/lib/db/marketing'
import { isWellFormedOptOutToken } from '@/lib/marketing/tokens'

export const dynamic = 'force-dynamic'

/**
 * ביצוע ההסרה מדיוור.
 *
 * 🔒 **בלי התחברות ובלי OTP.** לקוחה שקיבלה SMS שיווקי חייבת להיות מסוגלת
 * לצאת ממנו בלחיצה אחת; דרישת הזדהות הייתה הופכת את ההסרה למכשול, וזו
 * בדיוק הסיבה שרגולציה דורשת מנגנון פשוט.
 *
 * ⚠️ ה-token הוא הראיה היחידה, והוא 128 סיביות שנגזרו מסוד ייעודי. הוא
 * אינו מזהה לקוחה ואינו טלפון, ולכן גם דליפה של ה-URL אינה חושפת דבר
 * מלבד היכולת להסיר את אותה נמענת מדיוור — פעולה שאין בה נזק.
 *
 * ⚠️ אידמפוטנטי: לחיצה שנייה מחזירה את אותה תשובה בדיוק.
 *
 * 🔒 אינו נוגע בתזכורות, בביטולים, בשינויי מועד או ב-OTP.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: { token?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // ⚠️ צורת ה-token נבדקת לפני כל פנייה למסד.
  if (!isWellFormedOptOutToken(body.token)) {
    return NextResponse.json({ result: 'not_found' }, { status: 404 })
  }

  const result = await applyOptOut(body.token)
  if (result === 'not_found') {
    return NextResponse.json({ result }, { status: 404 })
  }
  // ⚠️ 'opted_out' ו-'already_opted_out' מחזירים שניהם 200: מבחינת הלקוחה
  // המצב זהה — היא מוסרת.
  return NextResponse.json({ result })
}
