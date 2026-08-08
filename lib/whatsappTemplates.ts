/**
 * מקור אמת יחיד לנוסחי WhatsApp שהמנהלת שולחת ידנית אחרי אישור/דחייה
 * (ראה app/api/admin/appointments/[id]/{approve,reject}/route.ts).
 *
 * המערכת אף פעם לא שולחת הודעה אוטומטית — היא רק פותחת שיחה עם טקסט
 * מוכן, ושובל לוחצת בעצמה "שליחה". הנוסחים כאן זמניים ומיועדים להחלפה
 * בהמשך בלי לגעת בלוגיקת האישור/הדחייה עצמה.
 */

/**
 * נוסח **בקשת התור** שהלקוחה שולחת לשובל.
 *
 * ⚠️ הועתק מילה במילה מ-`BookingForm.buildWhatsAppMessage`, שהיה עד שלב
 * 15B הנוסח היחיד ו-חי בתוך הקומפוננטה. החילוץ לכאן נועד לדבר אחד בלבד:
 * שהאזור האישי (15D) ישלח **בדיוק** את אותו נוסח, בלי עותק שני שיתבדר.
 *
 * ⚠️ כל שינוי כאן משנה את הנוסח שהלקוחות שולחות היום.
 * `scripts/test-public-booking-core.mjs` מחזיק snapshot של הנוסח ונכשל על
 * כל סטייה — כולל רווח או אמוג'י.
 *
 * ⚠️ הקובץ הזה אינו 'server-only' בכוונה: הפונקציה נקראת מקומפוננטת לקוח.
 * אין בה שום סוד ושום גישה ל-DB.
 *
 * ─── למה אין כאן שורת אישור מדיניות ────────────────────────────────────────
 *
 * אישור המדיניות הוא **תנאי חוסם** לשליחת הבקשה (`validateFinal` ב-
 * BookingForm), ולכן אי אפשר שתגיע בקשה שלא אושרה. שורה שמצהירה על משהו
 * שתמיד נכון אינה מוסיפה מידע — היא רק מאריכה את ההודעה.
 *
 * ⚠️ התיעוד עצמו לא אבד: `policy_version` נשמר על שורת התור
 * (`create_public_pending_appointment`), יחד עם `created_at`.
 */
export interface BookingRequestMessageParams {
  customerName: string
  /** כפי שהוקלד בטופס — לתצוגה בלבד, לא מנורמל */
  phone: string
  /** שם הטיפול המוצג (וריאציות מאוחדות ב-' + ', או שם השירות) */
  treatment: string
  /** סה"כ מחיר. 0 או undefined ⟶ השורה מושמטת */
  priceTotal?: number
  /** האם להוסיף קידומת "סה"כ " לפני המחיר (עיצוב טבעי בלבד) */
  priceIsSum?: boolean
  /** משך מוצג, למשל '40 דקות'. undefined ⟶ השורה מושמטת */
  durationLabel?: string
  /** תאריך בעברית לתצוגה, למשל '24 אוגוסט 2026' */
  dateLabel?: string
  /** שעה או טווח שעות, למשל '17:00' או '17:00–17:40' */
  timeLabel?: string
  notes?: string
}

export function buildBookingRequestMessage(p: BookingRequestMessageParams): string {
  const lines = [
    'היי שובל 🤍',
    '',
    'בקשת תור חדשה 🌸',
    '',
    `👤 ${p.customerName}`,
    `📞 ${p.phone}`,
    '',
    `💆 ${p.treatment}`,
    ...(p.priceTotal ? [`💰 ${p.priceIsSum ? 'סה"כ ' : ''}₪${p.priceTotal}`] : []),
    ...(p.durationLabel ? [`⏱️ ${p.durationLabel}`] : []),
    ...(p.dateLabel ? [`📅 ${p.dateLabel}`] : []),
    ...(p.timeLabel ? [`⏰ ${p.timeLabel}`] : []),
    ...(p.notes?.trim() ? ['', `📝 ${p.notes}`] : []),
  ]
  return lines.join('\n')
}

export function buildApprovalMessage(params: {
  customerName: string
  date: string
  time: string
  treatment: string
}): string {
  return [
    `היי ${params.customerName} 🌸`,
    `התור שלך אושר ליום ${params.date} בשעה ${params.time}, לטיפול ${params.treatment}.`,
    'מחכה לראותך,',
    'שובל | SM Brows',
  ].join('\n')
}

export function buildRejectionMessage(params: { customerName: string }): string {
  return [
    `היי ${params.customerName} 🌸`,
    'לצערי לא ניתן לאשר את המועד שביקשת.',
    'אפשר לשלוח לי הודעה ואעזור לך למצוא מועד חלופי.',
  ].join('\n')
}

/** בונה קישור wa.me לשיחה עם הלקוחה (לא עם העסק) — טלפון + טקסט מקודד */
export function buildWhatsAppLinkToCustomer(phoneE164: string, message: string): string {
  const digits = phoneE164.replace(/^\+/, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

/**
 * קישור לשיחה עם הלקוחה **בלי טקסט מוכן** — לכפתור ה-WhatsApp ב-CRM.
 *
 * בכוונה ללא הודעה: פתיחת שיחה מפרופיל הלקוחה אינה פעולה טיפולית או
 * שיווקית, ואין שום נוסח שנכון להמציא עבורה. שובל כותבת בעצמה.
 * הכפתור נפתח אך ורק בלחיצה, ואינו נרשם כאילו נשלחה הודעה.
 */
export function buildWhatsAppLinkPlain(phoneE164: string): string {
  return `https://wa.me/${phoneE164.replace(/^\+/, '')}`
}
