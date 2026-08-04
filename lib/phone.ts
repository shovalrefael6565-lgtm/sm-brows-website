/**
 * נירמול מספרי טלפון ישראליים לפורמט E.164 — מקור אמת יחיד.
 *
 * כל מספר נשמר בבסיס הנתונים בפורמט אחד בלבד: +9725XXXXXXXX.
 * זה מה שמונע חשבונות כפולים כשאותה לקוחה מזינה 0541234567 בפעם אחת
 * ו-+972-54-123-4567 בפעם אחרת.
 *
 * הנירמול מיושם גם בצד השרת וגם כ-CHECK constraint בבסיס הנתונים, כדי
 * שאי אפשר יהיה להכניס מספר בפורמט אחר גם בעקיפת הקוד.
 */

/** מספר נייד ישראלי תקין ב-E.164: +972 ואחריו 5 (קידומת נייד) ועוד 8 ספרות */
export const E164_IL_MOBILE = /^\+9725\d{8}$/

/**
 * הופך קלט חופשי למספר E.164, או מחזיר null אם זה לא נייד ישראלי תקין.
 *
 * מקבל, בין השאר:
 *   '0541234567' · '054-123-4567' · '054 123 4567'
 *   '+972541234567' · '972541234567' · '00972541234567'
 * ומחזיר תמיד: '+972541234567'
 */
export function normalizePhone(input: string): string | null {
  if (!input) return null

  // משאירים ספרות בלבד; ה-+ המוביל נגזר מהתבנית ולא מהקלט
  let digits = input.replace(/\D/g, '')
  if (!digits) return null

  // 00972... → 972...  (חיוג בינלאומי בפורמט הישן)
  if (digits.startsWith('00')) digits = digits.slice(2)

  let national: string
  if (digits.startsWith('972')) {
    national = digits.slice(3)
    // '+972 054...' — מספרים שהוזנו עם קידומת בינלאומית וגם עם ה-0 המקומי
    if (national.startsWith('0')) national = national.slice(1)
  } else if (digits.startsWith('0')) {
    national = digits.slice(1)
  } else {
    // מספר בלי קידומת בכלל, למשל '541234567'
    national = digits
  }

  const e164 = `+972${national}`
  return E164_IL_MOBILE.test(e164) ? e164 : null
}

/** האם הקלט הוא נייד ישראלי תקין (בלי להחזיר את הערך המנורמל) */
export function isValidIsraeliMobile(input: string): boolean {
  return normalizePhone(input) !== null
}

/**
 * תצוגה ידידותית ללקוחה: +972541234567 → 054-123-4567
 * לתצוגה בלבד — לעולם לא לשמירה בבסיס הנתונים.
 */
export function formatPhoneForDisplay(e164: string): string {
  if (!E164_IL_MOBILE.test(e164)) return e164
  const national = `0${e164.slice(4)}` // '+972' → '0'
  return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
}

/**
 * מיסוך לתצוגה במסך אימות: +972541234567 → 054-***-4567
 * משמש במסך "שלחנו קוד ל..." בלי לחשוף את המספר המלא בצילום מסך.
 */
export function maskPhone(e164: string): string {
  const display = formatPhoneForDisplay(e164)
  return display.replace(/^(\d{3})-(\d{3})-(\d{4})$/, '$1-***-$3')
}
