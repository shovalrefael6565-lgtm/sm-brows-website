import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone, maskPhone } from '@/lib/phone'
import { issueOtp, discardOtp } from '@/lib/db/otpStore'
import { sendSms } from '@/lib/sms'
import { otpMessage } from '@/lib/sms/templates'
import { OTP_TTL_MINUTES } from '@/lib/otp'

export const dynamic = 'force-dynamic'

/**
 * שליחת קוד אימות.
 *
 * שיקול אבטחה מרכזי: התשובה **זהה** בין מספר שרשום במערכת למספר שאינו
 * רשום. אחרת אפשר היה להשתמש ב-endpoint הזה כדי לברר אילו מספרי טלפון
 * הם לקוחות של העסק — דליפת פרטיות בפני עצמה.
 */
export async function POST(req: NextRequest) {
  let body: { phone?: string; purpose?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const phone = normalizePhone(body.phone ?? '')
  if (!phone) {
    return NextResponse.json(
      { error: 'invalid_phone', message: 'מספר הטלפון אינו תקין. יש להזין מספר נייד ישראלי.' },
      { status: 400 },
    )
  }

  const purpose = body.purpose === 'booking' ? 'booking' : 'login'

  // ה-IP משמש להגבלת קצב בלבד ואינו נשמר בשום מקום אחר
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null

  const result = await issueOtp(phone, purpose, ip)

  if (!result.ok) {
    if (result.limit) {
      return NextResponse.json(
        {
          error: result.limit.reason,
          message: result.limit.message,
          retryAfterSec: result.limit.retryAfterSec,
        },
        { status: 429 },
      )
    }
    return NextResponse.json(
      { error: 'server_error', message: 'לא הצלחנו לשלוח את הקוד. נסי שוב בעוד רגע.' },
      { status: 500 },
    )
  }

  const sms = await sendSms(otpMessage(phone, result.code!, OTP_TTL_MINUTES))

  if (!sms.ok) {
    // ⚠️ sms.error הוא slug קצר מהמיפוי שלנו (`sms019_...`) ולא טקסט מהספק.
    // אין כאן מספר, אין גוף הודעה, ואין את הקוד.
    console.error('[otp/send] sms delivery failed', sms.error)

    /*
     * 🔒 הוכח שההודעה לא יצאה → השורה שנוצרה לפני השליחה נמחקת.
     *
     * ⚠️ בלי זה, כשל ודאי היה מעניש את הלקוחה פעמיים: הקוד הקודם שאולי
     * כבר בידה מפסיק להיות תקף (השורה החדשה היא "האחרונה"), והיא נחסמת
     * ל-60 שניות מלבקש חדש.
     *
     * ⚠️ מתבצע רק על notDelivered. תוצאה עמומה אינה מגיעה לכאן בכלל —
     * היא ok:true.
     */
    if (sms.notDelivered && typeof result.otpId === 'number') {
      const discarded = await discardOtp(result.otpId, phone, purpose)
      if (discarded !== 'discarded') {
        // ⚠️ slug מסונן בלבד. אין מספר, אין מזהה, ואין פרטי ספק.
        // הכישלון אינו משנה את התשובה ללקוחה: היא כללית כך או כך.
        console.error('[otp/send] otp row discard did not remove the row —', discarded)
      }
    }
    // ⚠️ נוסח כללי. הוא אינו מסגיר איזה ספק פעיל, ואינו מבחין בין תקלת
    // אימות אצל הספק לחוסר יתרה — מידע תפעולי שאין ללקוחה מה לעשות איתו
    // ושאין סיבה למסור לצד שלישי שסורק את ה-endpoint.
    return NextResponse.json(
      { error: 'sms_failed', message: 'לא הצלחנו לשלוח את ההודעה. נסי שוב או צרי קשר בוואטסאפ.' },
      { status: 502 },
    )
  }

  if (sms.uncertain) {
    // 🔒 הבקשה יצאה ואיננו יודעים מה עלה בגורלה. **אין retry** — ל-019 אין
    // idempotency מוכחת, וניסיון נוסף הוא הימור על SMS שני.
    //
    // שורת ה-OTP תקפה, ולכן התשובה היא 200 והמשתמשת ממשיכה להזנת הקוד.
    // אילו החזרנו כישלון, לקוחה שההודעה כן הגיעה אליה הייתה רואה
    // "לא הצלחנו לשלוח" ונחסמת ל-60 שניות עם קוד תקף ביד.
    console.error('[otp/send] sms delivery uncertain', sms.error)
  }

  return NextResponse.json({
    ok: true,
    maskedPhone: maskPhone(phone),
    expiresInMinutes: OTP_TTL_MINUTES,
    // ⚠️ נוסח כללי שאינו מזכיר ספק, תקלה או סיבה.
    notice: sms.uncertain
      ? 'אם ההודעה לא הגיעה תוך דקה, ניתן לבקש קוד חדש.'
      : undefined,
  })
}
