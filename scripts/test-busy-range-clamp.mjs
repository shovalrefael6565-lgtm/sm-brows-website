/**
 * טווחי תפוסה — ללא גזימה לשעות הפעילות, וללא fail-open.
 *
 * ─── התקלה שזה נועל ────────────────────────────────────────────────────────
 *
 * עד 06.09.2026 שני קוראי התפוסה — getBusyRanges (Google Calendar) ו-
 * getDbBusyRangesForDate (Supabase) — גזמו כל טווח לחלון [09:00, 19:00)
 * וזרקו כל טווח שנפל כולו מחוצה לו:
 *
 *     const s = Math.max(startMin, BUSINESS_START_MIN)  // 09:00
 *     const e = Math.min(endMin,   BUSINESS_END_MIN)    // 19:00
 *     if (s < e) ranges.push(...)                       // 19:20–19:40 ⟹ נזרק
 *
 * lib/specialAvailability.ts פותח ימים בשעות חריגות (19:30–21:30 ב-08.09
 * וב-10.09.2026). הזמינות המוצגת כללה את השעות האלה — התפוסה בהן לא.
 * בייצור זה הסתיר 9 תורים confirmed אמיתיים: הלקוחה ראתה שעה פנויה, בחרה
 * אותה, ונחסמה רק ע"י ה-EXCLUDE constraint בשליחה ("השעה שנבחרה נתפסה
 * הרגע"). אותו באג בדיוק גם הציג שעות שכבר נקבע בהן תור כפנויות.
 *
 * ─── מה נבדק כאן ───────────────────────────────────────────────────────────
 *
 *   1. אין יותר גזימה בשני הקוראים, ושניהם הפסיקו לייבא את הקבועים.
 *   2. טווח תפוסה שכולו אחרי 19:00 אכן חוסם את הסלוט המיוחד שמעליו.
 *   3. יום רגיל (בלי חלון מיוחד) לא זז — אין רגרסיה בזמינות הרגילה.
 *   4. getDbBusyRangesForDate זורק בכישלון קריאה ולא מחזיר [] —
 *      resolveAvailability חייב לקבל דחייה כדי להחזיר 503.
 *
 * אפס רשת, אפס DB.
 *
 * הרצה:  npm run test:busy-range-clamp
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { selectDisplaySlots } from '../lib/slotSelection.ts'
import { specialSlotsFor } from '../lib/specialAvailability.ts'

let pass = 0, fail = 0
const chk = (name, ok = true, extra = '') => {
  if (ok) pass++; else fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = p => readFileSync(join(ROOT, p), 'utf8')
const stripComments = s =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const CAL = stripComments(src('lib/googleCalendar.ts'))
const DB  = stripComments(src('lib/db/appointments.ts'))

// ════════════════════════════════════════════════════════════════════════════
section('1. הגזימה לשעות הפעילות הוסרה משני הקוראים')
// ════════════════════════════════════════════════════════════════════════════

for (const [name, code] of [['lib/googleCalendar.ts', CAL], ['lib/db/appointments.ts', DB]]) {
  chk(`🔒 ${name}: אין Math.max מול BUSINESS_START_MIN`,
    !/Math\.max\([^)]*BUSINESS_START_MIN/.test(code))
  chk(`🔒 ${name}: אין Math.min מול BUSINESS_END_MIN`,
    !/Math\.min\([^)]*BUSINESS_END_MIN/.test(code))
  chk(`🔒 ${name}: הקבועים כבר לא מיובאים בכלל`,
    !/BUSINESS_START_MIN|BUSINESS_END_MIN/.test(code))
  chk(`${name}: הטווח נדחף כפי שהוא כשהוא חיובי`,
    /if \(startMin < endMin\) ranges\.push\(\{ start: minToHHMM\(startMin\), end: minToHHMM\(endMin\) \}\)/.test(code))
}

// ════════════════════════════════════════════════════════════════════════════
section('2. תפוסה אחרי 19:00 חוסמת את השעות החריגות')
// ════════════════════════════════════════════════════════════════════════════

// 10.09.2026 — חלון מיוחד 19:30–21:30 (lib/specialAvailability.ts)
const NOW = new Date('2026-09-06T09:00:00+03:00')
const special = specialSlotsFor(2026, 8, 10)
chk('לתאריך הבדיקה יש בכלל חלון מיוחד אחרי 19:00',
  special.includes('19:30') && special.every(s => s >= '19:30'), special.join(','))

const day = { year: 2026, month: 8, day: 10, now: NOW, durationMin: 20 }
const free = selectDisplaySlots({ ...day, busyRanges: [] })
chk('בלי תפוסה — 19:30 מוצגת', free.includes('19:30'))

// טווח שכולו אחרי 19:00 — בדיוק מה שהגזימה הישנה הייתה זורקת
const busy = [{ start: '19:20', end: '19:40' }]
const blocked = selectDisplaySlots({ ...day, busyRanges: busy })
chk('🔒 עם תפוסה 19:20–19:40 — 19:30 כבר לא מוצגת', !blocked.includes('19:30'))
chk('🔒 גם 19:20 עצמה חסומה', !blocked.includes('19:20'))
chk('שעה חריגה שאינה חופפת נשארת מוצגת', blocked.includes('20:50') || blocked.includes('21:10'))

// מה שהגזימה הישנה הייתה עושה לטווח הזה
const oldClamped = [{ start: '19:20', end: '19:40' }].flatMap(({ start, end }) => {
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const s = Math.max(toMin(start), 9 * 60), e = Math.min(toMin(end), 19 * 60)
  return s < e ? [{ start, end }] : []
})
chk('⚠️ הגזימה הישנה אכן מוחקת את הטווח לגמרי (זה היה הבאג)', oldClamped.length === 0)

// ════════════════════════════════════════════════════════════════════════════
section('3. יום רגיל — אין רגרסיה')
// ════════════════════════════════════════════════════════════════════════════

// 14.09.2026 — אין לו חלון מיוחד, רק הרשת הרגילה
chk('לתאריך הביקורת אין זמינות מיוחדת', specialSlotsFor(2026, 8, 14).length === 0)
const plain = { year: 2026, month: 8, day: 14, now: NOW, durationMin: 20 }
const plainBusy = [{ start: '10:00', end: '10:20' }]
const plainSlots = selectDisplaySlots({ ...plain, busyRanges: plainBusy })
chk('תפוסה בתוך שעות הפעילות ממשיכה לחסום', !plainSlots.includes('10:00'))
chk('שאר היום ממשיך להיות מוצג', plainSlots.length > 0)
// טווח מחוץ לשעות הפעילות ביום רגיל אינו יכול לפתוח או לסגור כלום
const withOutside = selectDisplaySlots({
  ...plain, busyRanges: [...plainBusy, { start: '07:00', end: '08:00' }, { start: '22:00', end: '23:00' }],
})
chk('🔒 טווח מחוץ לשעות הפעילות ביום רגיל אינו משנה את המוצג',
  JSON.stringify(withOutside) === JSON.stringify(plainSlots))

// ════════════════════════════════════════════════════════════════════════════
section('4. כישלון קריאה מה-DB הוא כישלון, לא "יום פנוי"')
// ════════════════════════════════════════════════════════════════════════════

const busyFn = DB.match(/export async function getDbBusyRangesForDate[\s\S]*?\n\}/)?.[0] ?? ''
chk('getDbBusyRangesForDate זורק בכישלון', /throw new Error\(`db busy lookup failed/.test(busyFn))
chk('🔒 ואינו מחזיר [] בענף השגיאה',
  !/if \(error\) \{[\s\S]{0,200}?return \[\]/.test(busyFn))
chk('🔒 resolveAvailability עדיין fail-closed מול שני המקורות',
  /Promise\.all\(\[[\s\S]*?calendarBusy\(isoDate\),[\s\S]*?dbBusy\(isoDate\),[\s\S]*?\]\)/
    .test(stripComments(src('lib/bookingAvailability.ts'))))

console.log(`\n${'─'.repeat(64)}`)
console.log(`${pass}/${pass + fail} בדיקות עברו`)
if (fail) { console.log('✗ נכשל'); process.exit(1) }
console.log('✓ טווחי התפוסה אינם נגזמים ואינם נבלעים')
