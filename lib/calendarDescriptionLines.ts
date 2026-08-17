/**
 * 9C.2 — פיצול טקסט לשורות תוך שימור terminators בדיוק, לשימוש ע"י
 * lib/calendarPhoneCleanup.ts ו-lib/legacyCalendarAudit.ts.
 *
 * ⚠️ לא split('\n') + join('\n') — זה היה מנרמל CRLF ל-LF בכל שורה, גם
 * בשורות שלא נגעו בהן. כל איבר במערך המוחזר כולל את ה-terminator שלו
 * (אם יש) בדיוק כפי שהופיע במקור, כך ש-`lines.join('')` משחזר את
 * המחרוזת המקורית באופן מדויק, בית אחר בית.
 */
export function splitLinesPreservingTerminators(text: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

/** תוכן שורה בלי ה-terminator שלה (\n או \r\n) — לבדיקת regex בלבד, לעולם לא לבנייה מחדש. */
export function lineContent(line: string): string {
  return line.replace(/\r?\n$/, '')
}
