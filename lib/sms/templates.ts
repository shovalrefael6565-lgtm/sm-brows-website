import type { SmsMessage } from './types'
import { LOCATION, SITE_URL } from '@/lib/utils'

/**
 * תבניות ההודעות — מרוכזות במקום אחד כדי שאפשר יהיה לשנות נוסח בלי לחפש
 * בקוד. כל התבניות בעברית, קצרות בכוונה (SMS ארוך נשלח כמספר הודעות ומתומחר
 * לפי כמות).
 */

const BRAND = 'S.M BROWS'
const ACCOUNT_URL = `${SITE_URL}/account`

/** קוד התחברות / אימות חד־פעמי */
export function otpMessage(to: string, code: string, minutes: number): SmsMessage {
  return {
    to,
    kind: 'otp',
    body: `קוד האימות שלך ל-${BRAND}: ${code}\nתקף ל-${minutes} דקות. אין למסור את הקוד לאף אחד.`,
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
