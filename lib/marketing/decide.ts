/**
 * 🔒 ההחלטה "האם לשלוח לנמענת הזו, ואם לא — למה" — פונקציה טהורה.
 *
 * ═══ למה זה חי בנפרד ═════════════════════════════════════════════════════
 *
 * זו ההחלטה המסוכנת ביותר בזרימה: היא זו שמונעת דיוור למי שביקשה להסיר
 * את עצמה, ומונעת שליחה למספר שהוחלף מאז שהרשימה אושרה. קבורה בתוך לולאת
 * שליחה עם קריאות רשת ומסד, אי אפשר לכסות אותה. כאן היא נבדקת על כל
 * צירוף אפשרי, בלי DB ובלי ספק.
 *
 * ⚠️ הסדר אינו שרירותי. `opted_out` נבדק **ראשון**: לקוחה שביקשה להסיר
 * את עצמה לא תקבל הודעה גם אם בינתיים גם עברה לארכיון וגם החליפה מספר.
 * מה שמדווח הוא הסיבה החזקה ביותר, לא הראשונה שנתקלנו בה במקרה.
 */

export type RecipientDecision =
  | { send: true }
  | { send: false; skipReason: 'opted_out' | 'archived' | 'blocked' | 'invalid_phone' | 'phone_changed' }

export interface RecipientState {
  /** לא null ⟹ הלקוחה הסירה את עצמה מדיוור */
  optedOutAt: string | null
  archivedAt: string | null
  isBlocked: boolean
  /** null ⟹ הטלפון השמור אינו עובר נירמול ל-E.164 תקין */
  normalizedPhone: string | null
  /** החותם שחושב עכשיו מהמספר הנוכחי, ו-null כשאין מספר תקין */
  currentPhoneHash: string | null
  /** החותם שהוקפא בעת בניית רשימת הקמפיין */
  storedPhoneHash: string
}

export function decideRecipient(s: RecipientState): RecipientDecision {
  // 🔴 החסימה הקשה. קודמת לכל השאר, במכוון.
  if (s.optedOutAt !== null) return { send: false, skipReason: 'opted_out' }
  if (s.archivedAt !== null) return { send: false, skipReason: 'archived' }
  if (s.isBlocked) return { send: false, skipReason: 'blocked' }
  if (!s.normalizedPhone || !s.currentPhoneHash) return { send: false, skipReason: 'invalid_phone' }

  /*
   * 🔴 המספר השתנה בין אישור הרשימה לשליחה. לא שולחים — **ולא למספר
   * החדש**. קמפיין שאושר על רשימה מסוימת לא יזלוג למספר שאיש לא אישר.
   */
  if (s.currentPhoneHash !== s.storedPhoneHash) return { send: false, skipReason: 'phone_changed' }

  return { send: true }
}
