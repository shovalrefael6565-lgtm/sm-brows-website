import 'server-only'

/**
 * שכבת שליחת התזכורות — חוזה משותף לכל הספקים.
 *
 * ⚠️ למה זה אינו lib/sms הקיים, ולמה זה לא אוחד איתו:
 *
 *   1. **צורת התוצאה שונה מהותית.** SmsResult הוא { ok, error } — בינארי.
 *      תזכורת חייבת להבחין בין ארבעה מצבים שונים לחלוטין, ובפרט בין שגיאה
 *      זמנית (retry) לשגיאה קבועה (אל תנסה שוב) ולתוצאה עמומה (אולי נשלח,
 *      **אסור** לנסות שוב). מיפוי של שלושת אלה ל-ok=false היה הופך כל
 *      תקלה חולפת לתזכורת אבודה, וכל תוצאה עמומה לשליחה כפולה.
 *
 *   2. **זרימת ה-OTP עובדת בפרודקשן ואין לגעת בה.** איחוד היה משנה מסלול
 *      חי בשביל פיצ'ר שעדיין לא מחובר לספק.
 *
 * שלב 12 יחבר כאן מימוש של 019 תחת השם 'sms_019' (ראה ReminderProviderName
 * למטה). עד אז אין ספק אמיתי, ואין שליחה אמיתית.
 */

/**
 * תוצאת מסירה מספק.
 *
 * ⚠️ delivery_unknown אינו "שגיאה". הוא המצב שבו הבקשה יצאה ואיננו יודעים
 * מה קרה לה — timeout אחרי שה-HTTP request נשלח, חיבור שנקטע באמצע התגובה.
 * הוא מטופל כסופי ולא כ-retryable בדיוק מהסיבה הזו.
 */
export type ReminderDeliveryResult =
  | { outcome: 'accepted'; providerMessageId?: string }
  | { outcome: 'retryable_error'; errorCode: string }
  | { outcome: 'permanent_error'; errorCode: string }
  | { outcome: 'delivery_unknown'; errorCode: string }

/**
 * שמות הספקים המותרים בשלב 11.
 *
 * ⚠️ שם הספק של שלב 12 נקבע ל-**'sms_019'** ולא ל-'019'. הסיבה אינה
 * סגנונית: ה-CHECK על העמודה provider ב-0011 הוא `^[a-z][a-z0-9_]{1,31}$`
 * ודורש אות ראשונה, ולכן '019' אינו ערך חוקי כלל. 'sms_019' עובר בלי שינוי
 * סכמה — ואין לשנות את ה-CHECK כדי לאפשר שם שמתחיל בספרה.
 */
export type ReminderProviderName = 'disabled' | 'simulated' | 'fake'

export interface ReminderMessage {
  /** יעד ב-E.164 בלבד. אינו נשמר באף טבלה של תזכורות. */
  to: string
  body: string
  /**
   * מפתח ה-idempotency שנשלח לספק.
   *
   * ⚠️ חייב להיות **יציב בכל retry של אותה תזכורת**, ולכן הוא reminder.id
   * ולעולם לא מזהה ניסיון, מספר ניסיון, חותמת זמן או מזהה worker. כך שלב 12
   * יוכל לנצל client reference / idempotency של 019 בלי לשנות את מודל התור.
   */
  idempotencyKey: string
}

export interface ReminderProvider {
  readonly name: ReminderProviderName
  /**
   * האם הספק שולח הודעות אמיתיות.
   *
   * ⚠️ בשלב 11 הערך הוא false בכל המימושים. זו אינה הגנה יחידה — ה-CHECK
   * reminders_sent_requires_live_provider ב-0011 הופך status='sent' עם ספק
   * שאינו אמיתי לבלתי אפשרי ברמת בסיס הנתונים.
   */
  readonly isLive: boolean
  send(message: ReminderMessage): Promise<ReminderDeliveryResult>
}
