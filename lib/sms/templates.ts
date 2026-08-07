import type { SmsMessage } from './types'
import { LOCATION, SITE_URL } from '@/lib/utils'

/**
 * תבניות ההודעות — מרוכזות במקום אחד כדי שאפשר יהיה לשנות נוסח בלי לחפש
 * בקוד. כל התבניות בעברית, קצרות בכוונה (SMS ארוך נשלח כמספר הודעות ומתומחר
 * לפי כמות).
 */

const BRAND = 'S.M BROWS'
const ACCOUNT_URL = `${SITE_URL}/account`

/**
 * ⚠️ שם המותג בהודעת ה-OTP הוא `SM BROWS` ולא `S.M BROWS` — זהו שם השולח
 * המאושר בחשבון 019, תו-בתו. התאמה בין שם השולח לשם בגוף ההודעה היא
 * אות אמינות מול הנמענת, וחוסכת שני תווים בהודעה שנמדדת בתווים.
 *
 * שאר התבניות ממשיכות להשתמש ב-BRAND המלא — הן אינן מחוברות לספק.
 */
const SMS_SENDER_BRAND = 'SM BROWS'

/**
 * קוד התחברות / אימות חד־פעמי.
 *
 * ═══ למה הנוסח קצר כל כך ═══
 *
 * ⚠️ עברית מכריחה קידוד UCS-2, ולכן מקטע SMS הוא **70 תווים** ולא 160
 * (ו-67 בהודעה מפוצלת). הנוסח הקודם היה 75 תווים — כלומר **שני מקטעים,
 * פי שניים בעלות, על כל קוד כניסה של כל לקוחה**.
 *
 * הנוסח הזה: 64 תווים → **מקטע אחד**, עם 6 תווים למרווח. אין להאריך אותו
 * בלי לספור מחדש. scripts/test-otp-sms019.mjs נכשלת אם הוא חוצה 70.
 *
 * ⚠️ אין אמוג'י. אמוג'י הוא surrogate pair — שתי יחידות UCS-2 — ומסכן
 * תצוגה במכשירים ישנים. בהודעה שנמדדת בתווים אין לו מקום.
 *
 * ⚠️ האזהרה "אין למסור לאף אחד" נשארת. זו הגנה מפני הנדסה חברתית, לא
 * נימוס: התקיפה הנפוצה על OTP היא שיחה שמבקשת מהקורבן להקריא את הקוד.
 */
export function otpMessage(to: string, code: string, minutes: number): SmsMessage {
  return {
    to,
    kind: 'otp',
    body: `קוד הכניסה ל-${SMS_SENDER_BRAND}: ${code}\nבתוקף ל-${minutes} דקות. אין למסור לאף אחד.`,
  }
}

/** אישור קביעת תור */
export function bookingConfirmedMessage(
  to: string,
  p: { treatment: string; dateLabel: string; timeLabel: string },
): SmsMessage {
  return {
    to,
    kind: 'booking_confirmed',
    body: `התור שלך ב-${BRAND} נקבע 🌸\n${p.treatment}\n${p.dateLabel} בשעה ${p.timeLabel}\n${LOCATION}\n\nלניהול התור: ${ACCOUNT_URL}`,
  }
}

/** אישור שינוי מועד */
export function bookingRescheduledMessage(
  to: string,
  p: { treatment: string; dateLabel: string; timeLabel: string },
): SmsMessage {
  return {
    to,
    kind: 'booking_rescheduled',
    body: `התור שלך ב-${BRAND} הוזז ✅\n${p.treatment}\nמועד חדש: ${p.dateLabel} בשעה ${p.timeLabel}\n${LOCATION}\n\nלניהול התור: ${ACCOUNT_URL}`,
  }
}

/** אישור ביטול */
export function bookingCancelledMessage(
  to: string,
  p: { treatment: string; dateLabel: string; timeLabel: string },
): SmsMessage {
  return {
    to,
    kind: 'booking_cancelled',
    body: `התור שלך ב-${BRAND} בוטל.\n${p.treatment} — ${p.dateLabel} בשעה ${p.timeLabel}\n\nלקביעת תור חדש: ${ACCOUNT_URL}`,
  }
}

/** תזכורת לפני התור */
export function reminderMessage(
  to: string,
  p: { treatment: string; dateLabel: string; timeLabel: string },
): SmsMessage {
  return {
    to,
    kind: 'reminder',
    body: `תזכורת מ-${BRAND} 🌸\n${p.treatment}\nמחר, ${p.dateLabel} בשעה ${p.timeLabel}\n${LOCATION}\n\nלשינוי או ביטול: ${ACCOUNT_URL}`,
  }
}

/** עדכון לבעלת העסק על פעולה שלקוחה ביצעה */
export function adminNoticeMessage(
  to: string,
  p: { action: string; customerName: string; treatment: string; detail: string },
): SmsMessage {
  return {
    to,
    kind: 'admin_notice',
    body: `${p.action}\n${p.customerName} — ${p.treatment}\n${p.detail}`,
  }
}
