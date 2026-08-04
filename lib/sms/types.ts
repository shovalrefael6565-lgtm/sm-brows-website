/**
 * שכבת שליחת הודעות — חוזה משותף לכל הספקים.
 *
 * המערכת לא יודעת מי הספק. כל קוד שרוצה לשלוח SMS קורא ל-getSmsProvider()
 * ומקבל מימוש שתואם לממשק הזה. החלפת ספק בעתיד = הוספת קובץ אחד ושינוי
 * משתנה סביבה, בלי לגעת בלוגיקת ההזמנות או האימות.
 *
 * אין מפתחות בקוד — כל פרטי הגישה מגיעים ממשתני סביבה.
 */

/** סוגי ההודעות שהמערכת שולחת — משמש ללוגים, למדידה ולבחירת תבנית */
export type SmsKind =
  | 'otp'                  // קוד התחברות / אימות
  | 'booking_confirmed'    // אישור קביעת תור
  | 'booking_rescheduled'  // אישור שינוי מועד
  | 'booking_cancelled'    // אישור ביטול
  | 'reminder'             // תזכורת לפני התור
  | 'admin_notice'         // עדכון לבעלת העסק

export interface SmsMessage {
  /** יעד בפורמט E.164 בלבד (ראה lib/phone.ts) */
  to: string
  body: string
  kind: SmsKind
}

export interface SmsResult {
  ok: boolean
  /** מזהה ההודעה אצל הספק — נשמר בלוג לצורך מעקב ותחקור */
  providerMessageId?: string
  error?: string
}

export interface SmsProvider {
  /** שם הספק — ללוגים ולבדיקות בריאות */
  readonly name: string
  /**
   * האם הספק שולח הודעות אמיתיות. false = מצב פיתוח (הקוד מודפס לקונסול).
   * מסכי ה-UI לא משתנים לפיו — הוא נועד ללוגים ולבדיקות בלבד.
   */
  readonly isLive: boolean
  send(message: SmsMessage): Promise<SmsResult>
}
