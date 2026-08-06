import 'server-only'

/**
 * דגלים מרכזיים להפעלה/כיבוי של מערכות בפיתוח. אף דגל כאן אינו
 * NEXT_PUBLIC_ — 'server-only' דואג שגם ניסיון ייבוא בטעות מקומפוננטת
 * לקוח ייכשל בזמן בנייה, כדי שהבדיקה לעולם לא תעבור דרך קוד לקוח בלבד.
 */

/**
 * מערכת קביעת התורים החדשה: OTP, שמירת בקשה כ-pending ב-Supabase, אזור
 * אישי. ברירת המחדל היא כבוי — חייבים להדליק אותה במפורש בכל סביבה,
 * כולל production, אחרי שהתשתית נבדקה שם.
 */
export function isNewBookingSystemEnabled(): boolean {
  return process.env.NEW_BOOKING_SYSTEM_ENABLED === 'true'
}

/**
 * מערכת התזכורות (שלב 11). ברירת המחדל כבויה בכל סביבה.
 *
 * ⚠️ הדגל חוסם **שליחה בלבד**, לא יצירת שורות תזכורת. השורות נוצרות תמיד
 * ע"י הטריגר ב-DB, כדי שההיסטוריה תהיה שלמה ושהדלקת המערכת תהיה מיידית
 * במקום להתחיל מאפס. כשהדגל כבוי אין claim, אין ניסיון, ואף תזכורת אינה
 * משנה סטטוס — היא פשוט ממתינה (ראה lib/reminders/dispatch.ts).
 */
export function areRemindersEnabled(): boolean {
  return process.env.REMINDERS_ENABLED === 'true'
}
