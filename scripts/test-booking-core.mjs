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
  BOOKING_HORIZON_DAYS, calendarDayOffset, isWithinBookingHorizon,
} = await import('../lib/bookingWindow.ts')
const { selectVisibleSlots } = await import('../lib/slotSelection.ts')

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
chk('ניתן להזמין: תאריך בזמינות המיוחדת (23.8)', isBookableDate(2026, 7, 23, now))

// ─── טווח ההזמנה: 30 ימים קלנדריים ──────────────────────────────────────────
//
// ⚠️ הטווח היה "עד 6 ימי עסקים" (≈שבוע). ההרחבה נוגעת **אך ורק** בשאלה
// עד כמה רחוק מותר להסתכל. כל שאר החסימות — שישי/שבת, יומן Google, חגים
// שנחסמו ביומן, תורים קיימים — נבדקות במנגנון שלהן ולא השתנו.
section('טווח ההזמנה — 30 ימים קדימה')

chk('הקבוע הוא 30 ימים', BOOKING_HORIZON_DAYS === 30)
chk('calendarDayOffset: היום 0, מחר 1', 
  calendarDayOffset(2026, 7, 4, now) === 0 && calendarDayOffset(2026, 7, 5, now) === 1)
chk('calendarDayOffset סופר ימים קלנדריים ולא ימי עסקים (13.8 ⟶ 9)',
  calendarDayOffset(2026, 7, 13, now) === 9 && businessDayOffset(2026, 7, 13, now) === 7)
chk('גבול עליון: יום 30 בדיוק (03.09) בטווח', isWithinBookingHorizon(2026, 8, 3, now))
chk('🔒 יום 31 (04.09) כבר מחוץ לטווח', !isWithinBookingHorizon(2026, 8, 4, now))

// (1) יום עד 30 יום קדימה שנפתח **רק** בזכות ההרחבה: 20.08 הוא חמישי,
//     16 ימים קלנדריים / 12 ימי עסקים מהיום, ואינו בשום חלון מיוחד.
chk('✅ (1) יום בתוך 30 יום, מחוץ לחלון הישן ומחוץ לזמינות המיוחדת — פתוח',
  isBookableDate(2026, 7, 20, now))
chk('✅ (1) גם +7 ימי עסקים (13.8) פתוח עכשיו', isBookableDate(2026, 7, 13, now))

// (2) מעבר ל-30 יום — לא מוצג. 14.09 הוא שני, 41 יום קדימה, ומחוץ לכל
//     החלונות המיוחדים (האחרון מסתיים 10.09).
chk('🔒 (2) מעבר ל-30 יום (14.09) — סגור', !isBookableDate(2026, 8, 14, now))
chk('🔒 (2) גם ללא רשת שעות: 09:00 ב-14.09 אינו קביל',
  !isValidTimeSlot(2026, 8, 14, '09:00', now))

// (3) שבת — סגורה לחלוטין, גם בתוך 30 יום וגם כשהיא נופלת בתוך חלון
//     זמינות מיוחדת פעיל (29.08 נמצא בתוך 23.08–09.09).
chk('🔒 (3) שבת 22.08 סגורה למרות שהיא בתוך 30 יום', !isBookableDate(2026, 7, 22, now))
chk('🔒 (3) שבת 29.08 סגורה גם בתוך חלון הזמינות המיוחדת',
  !isBookableDate(2026, 7, 29, now) && isFridayOrSaturday(2026, 7, 29))
chk('🔒 (3) שישי 21.08 סגור למרות שהוא בתוך 30 יום', !isBookableDate(2026, 7, 21, now))
{
  // כל השבתות והשישי בתוך הטווח — אף אחד מהם לא נפתח ע"י ההרחבה
  let openWeekend = 0
  for (let i = 0; i <= BOOKING_HORIZON_DAYS; i++) {
    const d = new Date(2026, 7, 4 + i)
    if (d.getDay() !== 5 && d.getDay() !== 6) continue
    if (isBookableDate(d.getFullYear(), d.getMonth(), d.getDate(), now)) openWeekend++
  }
  chk('🔒 (3) אף שישי/שבת בכל 30 הימים אינו פתוח', openWeekend === 0, `נפתחו=${openWeekend}`)
}

// (4)+(5) חג / יום ששובל סימנה כלא-עובדת: אין במערכת לוח חגים — יום כזה
//     נחסם ע"י אירוע ביומן Google, שמגיע לכאן כ-busyRanges. חסימת יום מלא
//     ⟶ אפס סלוטים, בכל מרחק בתוך הטווח.
const FULL_DAY_BLOCK = [{ start: '00:00', end: '23:59' }]
chk('🔒 (4)(5) יום חסום ביומן (חג / יום שאינה עובדת) — אפס סלוטים ביום 16',
  selectVisibleSlots({ year: 2026, month: 7, day: 20, busyRanges: FULL_DAY_BLOCK, now }).length === 0)
chk('🔒 (4)(5) יום חסום ביומן — אפס סלוטים גם ביום 30 (03.09)',
  selectVisibleSlots({ year: 2026, month: 8, day: 3, busyRanges: FULL_DAY_BLOCK, now }).length === 0)

// (6)+(7) אירוע Google עם שעות / תור קיים ב-DB — חוסם **רק** את הסלוטים
//     החופפים. שניהם מגיעים דרך אותו busyRanges (resolveAvailability ממזג).
{
  const busy = [{ start: '17:00', end: '17:40' }]
  const withBusy = selectVisibleSlots({ year: 2026, month: 7, day: 20, busyRanges: busy, now })
  const withoutBusy = selectVisibleSlots({ year: 2026, month: 7, day: 20, busyRanges: [], now })
  chk('🔒 (6)(7) הסלוטים החופפים (17:00, 17:20) אינם מוצגים',
    !withBusy.includes('17:00') && !withBusy.includes('17:20'), withBusy.join(','))
  chk('🔒 (6)(7) 17:40 ואילך לא נחסמו — החסימה נקודתית ולא יומית',
    withBusy.length > 0 && !withBusy.some(s => s === '17:00' || s === '17:20'))
  chk('(6)(7) יום פנוי לגמרי כן מציג סלוטים', withoutBusy.length > 0)
}

// (8) שעות הפעילות והרשת — לא נגענו בהן. הרשת המדויקת, מקובעת כאן.
{
  const EXPECTED_GRID = [
    '09:00','09:20','09:40','10:00','10:20','10:40',
    '15:00','15:20','15:40','16:00','16:20','16:40',
    '17:00','17:20','17:40','18:00','18:20','18:40',
  ]
  chk('🔒 (8) רשת הסלוטים זהה בדיוק לפני ואחרי (18 סלוטים, 09:00–10:40 ו-15:00–18:40)',
    JSON.stringify(TIME_SLOTS) === JSON.stringify(EXPECTED_GRID), TIME_SLOTS.join(','))
  chk('🔒 (8) מרווח 20 דק\' נשמר',
    TIME_SLOTS.every((s, i, a) => i === 0 || s !== a[i - 1]) && TIME_SLOTS.length === 18)
  // צפיפות התצוגה לימים הקרובים לא השתנתה: 3 היום, 5 מחר
  chk('🔒 (8) היום מציג 3 סלוטים ומחר 5 — כמו לפני השינוי',
    selectVisibleSlots({ year: 2026, month: 7, day: 5, busyRanges: [], now }).length === 5)
}

chk('TIME_SLOTS מכיל 09:00 ו-18:40, לא מכיל 11:00',
  TIME_SLOTS.includes('09:00') && TIME_SLOTS.includes('18:40') && !TIME_SLOTS.includes('11:00'))
chk('שעה תקינה בתוך חלון רגיל: 10:40', isValidTimeSlot(2026, 7, 12, '10:40', now))
chk('שעה לא תקינה — פער הצהריים: 11:00', !isValidTimeSlot(2026, 7, 12, '11:00', now))
chk('שעה לא תקינה — פורמט שגוי', !isValidTimeSlot(2026, 7, 12, '9:00', now))
chk('שעת בוקר מהזמינות המיוחדת (23.8, בתוך התוספת) תקינה',
  isValidTimeSlot(2026, 7, 23, '09:00', now))
// ⚠️ 01.09 (שלישי) הוא 28 ימים קדימה — מאז הרחבת הטווח הוא יום עבודה
// רגיל לכל דבר, ולכן חלה עליו הרשת המלאה ולא רק חלון הערב המיוחד. זו
// בדיוק משמעות ההרחבה: הימים הרחוקים מקבלים את **שעות הפעילות הרגילות**.
chk('יום רגיל בתוך הטווח (01.9) — הרשת המלאה חלה: גם 09:00 וגם 17:00',
  isValidTimeSlot(2026, 8, 1, '09:00', now) && isValidTimeSlot(2026, 8, 1, '17:00', now))
// מעבר לטווח נשמר הכלל הישן כלשונו: רק הסלוטים המיוחדים, לא כל הרשת.
// 08.09 (שלישי) הוא 35 יום קדימה ויש בו חלון ערב מיוחד בלבד.
chk('🔒 מעבר לטווח (08.9) — רק הסלוטים המיוחדים: 17:00 כן, 09:00 לא',
  isValidTimeSlot(2026, 8, 8, '17:00', now) && !isValidTimeSlot(2026, 8, 8, '09:00', now))
chk('רשת מלאה לא חלה מעבר לטווח בלי זמינות מיוחדת: 09:00 ב-14.09 לא תקין',
  !isValidTimeSlot(2026, 8, 14, '09:00', now))

chk('הרמת גבות: זוג תקין 10:20+10:40', isValidLiftingStart(2026, 7, 12, '10:20', now))
chk('הרמת גבות: 10:40 לא תקין (11:00 לא ברשת)', !isValidLiftingStart(2026, 7, 12, '10:40', now))
chk('הרמת גבות: 18:40 לא תקין (19:00 לא ברשת)', !isValidLiftingStart(2026, 7, 12, '18:40', now))
chk('הרמת גבות: 18:20 תקין', isValidLiftingStart(2026, 7, 12, '18:20', now))

// ⚠️ שלב 15B: חלון ההכנה קוצר מ-90 ל-40 דקות (MIN_LEAD_MINUTES).
// now~12:00 ⟶ הסלוט הקביל הראשון הוא 12:40.
chk('חלון הכנה: היום 12:20 מוקדם מדי (now~12:00, +40=12:40)', !hasLeadTime(2026, 7, 4, '12:20', now))
chk('חלון הכנה: היום 12:40 תקין בדיוק על הגבול', hasLeadTime(2026, 7, 4, '12:40', now))
chk('חלון הכנה: היום 13:20 תקין (היה חסום ב-90 דק׳)', hasLeadTime(2026, 7, 4, '13:20', now))
chk('חלון הכנה: היום 15:00 תקין', hasLeadTime(2026, 7, 4, '15:00', now))
chk('חלון הכנה: לא רלוונטי לתאריך עתידי', hasLeadTime(2026, 7, 12, '09:00', now))

// ─── סיכום ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${'═'.repeat(60)}`)
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} בדיקות נכשלו`)
process.exit(failed === 0 ? 0 : 1)
