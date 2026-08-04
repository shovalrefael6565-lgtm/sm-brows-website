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
