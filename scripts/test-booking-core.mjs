/**
 * בדיקות ללוגיקה הטהורה של קביעת התור: חשבון אזור הזמן (lib/israelTime.ts)
 * וחלון הזמינות בצד השרת (lib/bookingWindow.ts). לא נדרש בסיס נתונים.
 *
 * הרצה:  npm run test:booking-core
 *
 * ⚠️ אין להריץ עם `node` ישירות: lib/bookingWindow.ts מייבא את
 * './specialAvailability' בלי סיומת (סגנון bundler, כמו ב-tsconfig),
 * ו-node נכשל שם עם ERR_MODULE_NOT_FOUND. tsx פותר את זה.
 */

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(56)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`)
}

// ─── lib/israelTime.ts ──────────────────────────────────────────────────────
section('חשבון אזור זמן ישראל (lib/israelTime.ts)')
const { israelWallTimeToUtc, israelDateStr, fmtIsrael, israelMinutes, minToHHMM } =
  await import('../lib/israelTime.ts')

chk('קיץ (24.08, UTC+3): 17:00 → 14:00Z',
  israelWallTimeToUtc('2026-08-24', '17:00').toISOString() === '2026-08-24T14:00:00.000Z')
chk('חורף (15.01, UTC+2): 09:00 → 07:00Z',
  israelWallTimeToUtc('2026-01-15', '09:00').toISOString() === '2026-01-15T07:00:00.000Z')
chk('חצות: 00:30 קיץ → 21:30Z ביום הקודם',
  israelWallTimeToUtc('2026-08-24', '00:30').toISOString() === '2026-08-23T21:30:00.000Z')
chk('לפני מעבר לשעון קיץ (20.03): 12:00 → 10:00Z',
  israelWallTimeToUtc('2026-03-20', '12:00').toISOString() === '2026-03-20T10:00:00.000Z')
chk('אחרי מעבר לשעון קיץ (01.04): 12:00 → 09:00Z',
  israelWallTimeToUtc('2026-04-01', '12:00').toISOString() === '2026-04-01T09:00:00.000Z')
const rt = israelWallTimeToUtc('2026-08-24', '17:00')
chk('round-trip: fmtIsrael/israelDateStr מחזירים את אותה שעת קיר',
  fmtIsrael(rt) === '17:00' && israelDateStr(rt) === '2026-08-24')
chk('minToHHMM(570) = 09:30', minToHHMM(570) === '09:30')
chk('israelMinutes תואם את fmtIsrael',
  israelMinutes(israelWallTimeToUtc('2026-08-24', '17:20')) === 17 * 60 + 20)

// ─── lib/bookingWindow.ts ───────────────────────────────────────────────────
section('חלון זמינות בצד השרת (lib/bookingWindow.ts)')
const {
  businessDayOffset, isBookableDate, isFridayOrSaturday,
  TIME_SLOTS, isValidTimeSlot, isValidLiftingStart, hasLeadTime,
} = await import('../lib/bookingWindow.ts')

// "עכשיו" קבוע ליום שלישי 04.08.2026, ~12:00 בישראל — יציב לבדיקות
const now = new Date('2026-08-04T09:00:00Z')

chk('היום — offset 0', businessDayOffset(2026, 7, 4, now) === 0)
chk('מחר (ד\') — offset 1', businessDayOffset(2026, 7, 5, now) === 1)
chk('שישי/שבת נפסחים — יום ראשון הבא offset 3', businessDayOffset(2026, 7, 9, now) === 3)
chk('isFridayOrSaturday — שישי 7.8', isFridayOrSaturday(2026, 7, 7))
chk('isFridayOrSaturday — שבת 8.8', isFridayOrSaturday(2026, 7, 8))
chk('לא שישי/שבת — שלישי 4.8', !isFridayOrSaturday(2026, 7, 4))

chk('ניתן להזמין: היום', isBookableDate(2026, 7, 4, now))
chk('לא ניתן להזמין: יום שישי', !isBookableDate(2026, 7, 7, now))
chk('לא ניתן להזמין: אתמול', !isBookableDate(2026, 7, 3, now))
chk('ניתן להזמין: +6 ימי עסקים (12.8)', isBookableDate(2026, 7, 12, now))
chk('לא ניתן להזמין: +7 ימי עסקים (13.8), בלי חלון מיוחד', !isBookableDate(2026, 7, 13, now))
chk('ניתן להזמין: תאריך בזמינות המיוחדת (23.8), מעבר לחלון הרגיל',
  isBookableDate(2026, 7, 23, now))

chk('TIME_SLOTS מכיל 09:00 ו-18:40, לא מכיל 11:00',
  TIME_SLOTS.includes('09:00') && TIME_SLOTS.includes('18:40') && !TIME_SLOTS.includes('11:00'))
chk('שעה תקינה בתוך חלון רגיל: 10:40', isValidTimeSlot(2026, 7, 12, '10:40', now))
chk('שעה לא תקינה — פער הצהריים: 11:00', !isValidTimeSlot(2026, 7, 12, '11:00', now))
chk('שעה לא תקינה — פורמט שגוי', !isValidTimeSlot(2026, 7, 12, '9:00', now))
chk('שעת בוקר מהזמינות המיוחדת (23.8, בתוך התוספת) תקינה',
  isValidTimeSlot(2026, 7, 23, '09:00', now))
chk('שעת בוקר על תאריך שיש בו רק ערב מיוחד (01.9) — לא תקינה, 17:00 כן',
  !isValidTimeSlot(2026, 8, 1, '09:00', now) && isValidTimeSlot(2026, 8, 1, '17:00', now))
chk('רשת מלאה לא חלה מעבר לחלון הרגיל בלי זמינות מיוחדת: 09:00 ב-13.8 לא תקין',
  !isValidTimeSlot(2026, 7, 13, '09:00', now))

chk('הרמת גבות: זוג תקין 10:20+10:40', isValidLiftingStart(2026, 7, 12, '10:20', now))
chk('הרמת גבות: 10:40 לא תקין (11:00 לא ברשת)', !isValidLiftingStart(2026, 7, 12, '10:40', now))
chk('הרמת גבות: 18:40 לא תקין (19:00 לא ברשת)', !isValidLiftingStart(2026, 7, 12, '18:40', now))
chk('הרמת גבות: 18:20 תקין', isValidLiftingStart(2026, 7, 12, '18:20', now))

chk('חלון הכנה: היום 13:20 מוקדם מדי (now~12:00, +90=13:30)', !hasLeadTime(2026, 7, 4, '13:20', now))
chk('חלון הכנה: היום 15:00 תקין', hasLeadTime(2026, 7, 4, '15:00', now))
chk('חלון הכנה: לא רלוונטי לתאריך עתידי', hasLeadTime(2026, 7, 12, '09:00', now))

// ─── סיכום ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${'═'.repeat(60)}`)
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} בדיקות נכשלו`)
process.exit(failed === 0 ? 0 : 1)
