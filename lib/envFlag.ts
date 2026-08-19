import 'server-only'

/**
 * נרמול ערכים של משתני סביבה שהם **דגלים ובחירות**, לא סודות.
 *
 * ═══ למה זה קיים ═══
 *
 * ⚠️ `REMINDERS_ENABLED === 'true'` ו-`REMINDER_PROVIDER.toLowerCase()`
 * נראים בטוחים עד שמישהו מדביק ערך לממשק של Vercel. הדבקה גוררת איתה
 * שורה חדשה או רווח בסוף, ולוח בקרה אינו מציג אותם. `"true\n" !== 'true'`,
 * ולכן מערכת שלמה נשארת כבויה בזמן שהלוח מראה בדיוק את הערך הנכון —
 * בלי שגיאה אחת, בלי סימן, ובלי דרך לראות את זה מבחוץ.
 *
 * ⚠️ גם מרכאות: מי שמעתיק שורה מקובץ `.env` או מתיעוד מביא איתו
 * `"sms_019"` על המרכאות. אותה תוצאה בדיוק — נפילה שקטה ל-disabled.
 *
 * 🔒 **הנרמול הזה מיועד לדגלים בלבד.** אין להעביר דרכו token, סוד או
 * סיסמה: גזימת רווחים מערך סודי משנה סוד, ולא מתקנת טעות הקלדה.
 * `readSms019Config` גוזמת את ה-credentials בעצמה ובמקום שבו זה נכון.
 */

/** גוזם רווחים, מסיר זוג מרכאות עוטף, ומוריד לאותיות קטנות. */
export function normalizeEnvFlag(raw: string | undefined | null): string {
  if (typeof raw !== 'string') return ''
  let v = raw.trim()
  if (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      v = v.slice(1, -1).trim()
    }
  }
  return v.toLowerCase()
}

/**
 * דגל בוליאני. **רק `true` מדליק** — כל ערך אחר, כולל חסר, כבוי.
 *
 * ⚠️ ברירת המחדל נשארת "כבוי" בכוונה ולא השתנתה: הנרמול מרחיב את מה
 * שנחשב `true` לכתיב שהמשתמש התכוון אליו, ואינו מדליק שום דבר שהיה כבוי
 * בכוונה.
 */
export function envFlagEnabled(raw: string | undefined | null): boolean {
  return normalizeEnvFlag(raw) === 'true'
}
