/**
 * שלב 15H — השלמת פרטי הלקוחה.
 *
 * ═══ מה הקובץ הזה קובע, ומה במפורש לא ═══
 *
 * הוא קובע שני דברים בלבד:
 *   1. מתי שם נחשב **שם placeholder ידוע** ולכן יש לבקש שם אמיתי.
 *   2. איך שני שדות טופס (פרטי + משפחה) הופכים ל-full_name אחד תקין.
 *
 * ⚠️ הוא **אינו** מכריע "האם זה שם אמיתי". אין דרך לדעת את זה, וכל ניסיון
 * לנחש פוגע בלקוחות אמיתיות:
 *
 *   • שם ללא רווח **אינו** שם פסול. "מיכל" הוא שם מלא לגיטימי שלקוחה
 *     הזינה בעצמה בטופס ההזמנה, ולבקש ממנה להשלים אותו שוב זו הטרדה על
 *     לא עוול בכפה.
 *   • שם קצר אינו פסול, שם באות אחת בלועזית אינו פסול, וכינוי אינו פסול.
 *
 * לכן הבדיקה היא **רשימה סגורה של ערכים ידועים** ולא היוריסטיקה. כל ערך
 * ברשימה נכתב ע"י המערכת עצמה, ואנחנו יודעים בוודאות שהלקוחה לא הקלידה
 * אותו.
 *
 * 🔒 אין כאן שום גישה ל-DB ואין 'server-only': הקובץ נטען גם בדפדפן, כדי
 * שהטופס יראה את אותה ולידציה בדיוק שהשרת אוכף. **השרת הוא האוכף** —
 * הבדיקה בצד הלקוח היא נוחות, לא הגנה.
 */

/**
 * ה-placeholder היחיד שהמערכת כותבת בפועל.
 *
 * מקורו ב-`link_or_create_customer_for_auth` (0010:414):
 *   `values (p_phone_e164, coalesce(v_name, 'לקוחה'), p_auth_user_id)`
 * כלומר לקוחה שהגיעה דרך התחברות OTP בלי שם — היום זהו כל מי שנכנסת
 * מ-`/login`, שאינו מבקש שם כלל.
 *
 * ⚠️ המסלול הציבורי (`link_or_create_customer_by_phone`, 0018) **אינו**
 * מייצר placeholder: הוא זורק BAD_NAME על שם קצר מ-2 תווים, ולכן לקוחה
 * שהגיעה משם תמיד נושאת שם שהיא עצמה הקלידה. גם יצירה ידנית ב-CRM
 * מחייבת שם. זו הסיבה שהרשימה כאן קצרה — ונכון שתישאר כך.
 *
 * ⚠️ בהוספת placeholder חדש כאן יש לזכור שהוא משנה **התנהגות רטרואקטיבית**
 * לכל הלקוחות שכבר נושאות את הערך הזה.
 */
const PLACEHOLDER_FULL_NAMES: readonly string[] = ['לקוחה']

/** אורך שדה בודד בטופס. 40 לכל צד נותן 81 עם הרווח, ולכן נבדק גם הצירוף. */
const PART_MIN = 1
const PART_MAX = 40

/** אותו טווח בדיוק של ה-CHECK ב-DB: length(trim(full_name)) between 2 and 80 */
const FULL_NAME_MIN = 2
const FULL_NAME_MAX = 80

/**
 * עברית (כולל גרש/גרשיים עבריים וניקוד), לטינית, רווח, מקף, גרש ונקודה.
 *
 * ⚠️ ספרות נדחות בכוונה — שדה שם שמכיל מספר הוא כמעט תמיד טלפון שהודבק
 * לשדה הלא נכון, ועדיף לומר זאת מפורשות מאשר לשמור אותו.
 *
 * ⚠️ בלי unicode property escapes (`\p{L}`): הפרויקט מריץ `tsc` בלי
 * `target`, כלומר ES5, ושם הן שגיאת קומפילציה.
 */
const NAME_CHARS_RE = /^[֐-׿a-zA-Z\s'’".\-]+$/

/** רווחים כפולים, טאבים ושורות חדשות → רווח בודד. */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * האם יש לבקש מהלקוחה שם אמיתי.
 *
 * true אך ורק כששם הלקוחה ריק, או **זהה בדיוק** לאחד מה-placeholders
 * הידועים. כל שם אחר — לרבות שם מילה אחת — מתקבל כפי שהוא, והלקוחה
 * לא תישאל שוב לעולם.
 */
export function needsNameCompletion(fullName: string | null | undefined): boolean {
  const normalized = collapseWhitespace(fullName ?? '')
  if (normalized === '') return true
  return PLACEHOLDER_FULL_NAMES.includes(normalized)
}

/**
 * האם ערך נתון הוא placeholder ידוע. משמש את שכבת ה-DB כדי לבנות עדכון
 * מותנה — ראה completeCustomerName ב-lib/db/customers.ts.
 */
export function placeholderFullNames(): readonly string[] {
  return PLACEHOLDER_FULL_NAMES
}

export type NameValidationError =
  | 'first_required'
  | 'last_required'
  | 'first_too_long'
  | 'last_too_long'
  | 'bad_chars'
  | 'too_short'
  | 'too_long'

export const NAME_ERROR_MESSAGES: Record<NameValidationError, string> = {
  first_required: 'יש להזין שם פרטי.',
  last_required: 'יש להזין שם משפחה.',
  first_too_long: `שם פרטי ארוך מדי (עד ${PART_MAX} תווים).`,
  last_too_long: `שם משפחה ארוך מדי (עד ${PART_MAX} תווים).`,
  bad_chars: 'השם יכול להכיל אותיות בלבד, בלי ספרות או סימנים מיוחדים.',
  too_short: 'השם קצר מדי.',
  too_long: `השם ארוך מדי (עד ${FULL_NAME_MAX} תווים).`,
}

export type BuildFullNameResult =
  | { ok: true; fullName: string }
  | { ok: false; error: NameValidationError }

/**
 * שני שדות → `full_name` אחד.
 *
 * 🔒 **שדה אחד ב-DB, שני שדות בטופס.** כל המערכת — SMS של 15F, תבניות
 * WhatsApp, כותרת אירוע היומן, ה-CRM והחיפוש — קוראת `customers.full_name`
 * ואינה מכירה שום פיצול. הפיצול הוא צורת הזנה בלבד, וכאן הוא נסגר.
 */
export function buildFullName(firstName: string, lastName: string): BuildFullNameResult {
  const first = collapseWhitespace(firstName ?? '')
  const last = collapseWhitespace(lastName ?? '')

  if (first.length < PART_MIN) return { ok: false, error: 'first_required' }
  if (last.length < PART_MIN) return { ok: false, error: 'last_required' }
  if (first.length > PART_MAX) return { ok: false, error: 'first_too_long' }
  if (last.length > PART_MAX) return { ok: false, error: 'last_too_long' }

  if (!NAME_CHARS_RE.test(first) || !NAME_CHARS_RE.test(last)) {
    return { ok: false, error: 'bad_chars' }
  }

  const fullName = `${first} ${last}`
  if (fullName.length < FULL_NAME_MIN) return { ok: false, error: 'too_short' }
  if (fullName.length > FULL_NAME_MAX) return { ok: false, error: 'too_long' }

  /*
   * ⚠️ מקרה קצה אמיתי: הצירוף עצמו הוא placeholder ידוע. לא ייתכן היום
   * ('לקוחה' הוא מילה אחת ואילו כאן תמיד יש רווח), אבל אם יתווסף
   * placeholder דו-מילתי — שמירתו הייתה מחזירה את הלקוחה לאותו שער
   * בדיוק בטעינה הבאה, כלומר לולאה שאי אפשר לצאת ממנה.
   */
  if (PLACEHOLDER_FULL_NAMES.includes(fullName)) {
    return { ok: false, error: 'bad_chars' }
  }

  return { ok: true, fullName }
}
