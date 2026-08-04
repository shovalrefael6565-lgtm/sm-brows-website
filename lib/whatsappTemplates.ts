/**
 * מקור אמת יחיד לנוסחי WhatsApp שהמנהלת שולחת ידנית אחרי אישור/דחייה
 * (ראה app/api/admin/appointments/[id]/{approve,reject}/route.ts).
 *
 * המערכת אף פעם לא שולחת הודעה אוטומטית — היא רק פותחת שיחה עם טקסט
 * מוכן, ושובל לוחצת בעצמה "שליחה". הנוסחים כאן זמניים ומיועדים להחלפה
 * בהמשך בלי לגעת בלוגיקת האישור/הדחייה עצמה.
 */

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
