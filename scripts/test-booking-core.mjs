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
  BUSINESS_SHIFTS, SLOT_INTERVAL_MINUTES,
} = await import('../lib/bookingWindow.ts')
const {
  selectVisibleSlots, selectDisplaySlots, slotsForOffset,
  INITIAL_SLOTS, MIN_AVAILABLE_SLOTS,
} = await import('../lib/slotSelection.ts')

const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const mins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

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

// (8) הרשת נגזרת משעות העבודה — נבדקת בסעיף "שעות העבודה" למטה.

chk('TIME_SLOTS מכיל 09:00 ו-18:40, לא מכיל 12:00',
  TIME_SLOTS.includes('09:00') && TIME_SLOTS.includes('18:40') && !TIME_SLOTS.includes('12:00'))
chk('שעה תקינה בתוך חלון רגיל: 10:40', isValidTimeSlot(2026, 7, 12, '10:40', now))
chk('שעה לא תקינה — פער הצהריים: 13:00', !isValidTimeSlot(2026, 7, 12, '13:00', now))
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
chk('הרמת גבות: 11:40 לא תקין (12:00 סוף המשמרת)', !isValidLiftingStart(2026, 7, 12, '11:40', now))
chk('הרמת גבות: 18:40 לא תקין (19:00 לא ברשת)', !isValidLiftingStart(2026, 7, 12, '18:40', now))
chk('הרמת גבות: 18:20 תקין', isValidLiftingStart(2026, 7, 12, '18:20', now))

// ⚠️ שלב 15B: חלון ההכנה קוצר מ-90 ל-40 דקות (MIN_LEAD_MINUTES).
// now~12:00 ⟶ הסלוט הקביל הראשון הוא 12:40.
chk('חלון הכנה: היום 12:20 מוקדם מדי (now~12:00, +40=12:40)', !hasLeadTime(2026, 7, 4, '12:20', now))
chk('חלון הכנה: היום 12:40 תקין בדיוק על הגבול', hasLeadTime(2026, 7, 4, '12:40', now))
chk('חלון הכנה: היום 13:20 תקין (היה חסום ב-90 דק׳)', hasLeadTime(2026, 7, 4, '13:20', now))
chk('חלון הכנה: היום 15:00 תקין', hasLeadTime(2026, 7, 4, '15:00', now))
chk('חלון הכנה: לא רלוונטי לתאריך עתידי', hasLeadTime(2026, 7, 12, '09:00', now))

// ════════════════════════════════════════════════════════════════════════════
section('שעות העבודה — 09:00–12:00 ו-16:00–19:00')
// ════════════════════════════════════════════════════════════════════════════

chk('המשמרות המוגדרות הן 09:00–12:00 ו-16:00–19:00',
  JSON.stringify(BUSINESS_SHIFTS) ===
  JSON.stringify([{ start: '09:00', end: '12:00' }, { start: '16:00', end: '19:00' }]),
  JSON.stringify(BUSINESS_SHIFTS))

{
  const EXPECTED_GRID = [
    '09:00','09:20','09:40','10:00','10:20','10:40','11:00','11:20','11:40',
    '16:00','16:20','16:40','17:00','17:20','17:40','18:00','18:20','18:40',
  ]
  chk('הרשת נגזרת מהמשמרות: 9 בוקר + 9 ערב = 18 סלוטים',
    JSON.stringify(TIME_SLOTS) === JSON.stringify(EXPECTED_GRID), TIME_SLOTS.join(','))
  chk('מרווח 20 דק׳ בין סלוטים רצופים בתוך כל משמרת',
    SLOT_INTERVAL_MINUTES === 20 &&
    TIME_SLOTS.every((t, i) => i === 0 || mins(t) - mins(TIME_SLOTS[i - 1]) === 20 ||
      mins(t) === mins(BUSINESS_SHIFTS[1].start)))
}

// (4) שעות לפני 09:00 לא מופיעות
chk('🔒 (4) אין שעות לפני 09:00',
  !TIME_SLOTS.some(t => mins(t) < mins('09:00')) &&
  !isValidTimeSlot(2026, 7, 12, '08:40', now))

// (5) בין 12:00 ל-16:00 אין תורים
{
  const midday = []
  for (let m = mins('12:00'); m < mins('16:00'); m += 20) midday.push(hhmm(m))
  chk('🔒 (5) אף שעה בין 12:00 ל-15:59 אינה ברשת',
    midday.every(t => !TIME_SLOTS.includes(t)))
  chk('🔒 (5) והשרת דוחה כל אחת מהן',
    midday.every(t => !isValidTimeSlot(2026, 7, 12, t, now)), midday.join(','))
}

// (6) אחרי 19:00 אין תורים
chk('🔒 (6) הסלוט האחרון הוא 18:40 (מסתיים 19:00), ו-19:00 עצמה אינה ברשת',
  TIME_SLOTS[TIME_SLOTS.length - 1] === '18:40' && !TIME_SLOTS.includes('19:00'))
chk('🔒 (6) השרת דוחה 19:00 ו-19:20',
  !isValidTimeSlot(2026, 7, 12, '19:00', now) && !isValidTimeSlot(2026, 7, 12, '19:20', now))

// (7) הטיפול חייב להסתיים בתוך המשמרת
chk('✅ (7) 11:40 תקין ל-20 דק׳ (מסתיים בדיוק ב-12:00)',
  isValidTimeSlot(2026, 7, 12, '11:40', now))
chk('🔒 (7) 11:40 אינו תקין ל-40 דק׳ (היה מסתיים 12:20, אחרי סוף המשמרת)',
  !isValidLiftingStart(2026, 7, 12, '11:40', now))
chk('✅ (7) 11:20 כן תקין ל-40 דק׳ (11:20–12:00)',
  isValidLiftingStart(2026, 7, 12, '11:20', now))
chk('🔒 (7) 18:40 אינו תקין ל-40 דק׳ (היה מסתיים 19:20)',
  !isValidLiftingStart(2026, 7, 12, '18:40', now))
chk('✅ (7) 18:20 כן תקין ל-40 דק׳ (18:20–19:00)',
  isValidLiftingStart(2026, 7, 12, '18:20', now))

// ════════════════════════════════════════════════════════════════════════════
section('חשיפה הדרגתית — יעד 6 אפשרויות זמינות')
// ════════════════════════════════════════════════════════════════════════════

// יום עבודה פנוי, רחוק מספיק שאין בו חלון הכנה ולא זמינות מיוחדת: 20.08
const FREE_DAY = { year: 2026, month: 7, day: 20 }
const show = (busy, durationMin) =>
  selectDisplaySlots({ ...FREE_DAY, busyRanges: busy, durationMin, now })

chk('הקבועים: 8 בקצה הסולם, יעד מינימום 6',
  INITIAL_SLOTS === 8 && MIN_AVAILABLE_SLOTS === 6)

// ── סולם המחסור: 3-4 היום · 6 מחר · 8 מכאן והלאה ──────────────────────────
{
  chk('היום — 3 או 4 סלוטים (יציב לתאריך)',
    [0, 1, 2, 3].every(k => [3, 4].includes(slotsForOffset(0, k))))
  chk('מחר — 6', [0, 1].every(k => slotsForOffset(1, k) === 6))
  chk('מיום 2 והלאה — 8',
    [2, 3, 6, 12, 20].every(o => slotsForOffset(o, 0) === 8 && slotsForOffset(o, 1) === 8))

  // now = שלישי 04.08 ~12:00. חלון ההכנה חוסם עד 12:40, ולכן היום פנוי
  // רק בערב — 9 סלוטים חוקיים, הרבה מעל הסולם.
  const today = selectDisplaySlots({ year: 2026, month: 7, day: 4, busyRanges: [], durationMin: 20, now })
  chk('🔒 היום מציג 3-4 בלבד למרות ש-9 סלוטים פנויים — תחושת ביקוש',
    today.length >= 3 && today.length <= 4, `${today.length}: ${today.join(',')}`)
  const tomorrow = selectDisplaySlots({ year: 2026, month: 7, day: 5, busyRanges: [], durationMin: 20, now })
  chk('🔒 מחר מציג 6 — גג הסולם, לא 8',
    tomorrow.length === 6, `${tomorrow.length}: ${tomorrow.join(',')}`)

  // 🔒 הסולם גובר על היעד: תפוסה כבדה היום לא מטפסת אותו חזרה ל-6
  const busyToday = selectDisplaySlots({
    year: 2026, month: 7, day: 4, durationMin: 40, now,
    busyRanges: [{ start: '16:00', end: '16:40' }],
  })
  chk('🔒 היום, טיפול 40 דק׳ אחרי תפוסה — עדיין ≤4, החשיפה לא מטפסת ל-6',
    busyToday.length <= 4, `${busyToday.length}: ${busyToday.join(',')}`)
  chk('🔒 מחר, אחרי תפוסה — עדיין ≤6',
    selectDisplaySlots({
      year: 2026, month: 7, day: 5, durationMin: 40, now,
      busyRanges: [{ start: '09:00', end: '10:00' }],
    }).length <= 6)
}

// (1) יום פתוח מציג ~8 סלוטים ראשוניים
{
  const free20 = show([], 20)
  chk('✅ (1) יום פנוי רחוק — 8 סלוטים ראשוניים (טיפול 20 דק׳)',
    free20.length === INITIAL_SLOTS, free20.join(','))
  const morning = free20.filter(t => mins(t) < mins('16:00')).length
  chk('✅ (1) הפיזור נשמר בין שתי המשמרות (בוקר וערב, לא הכול ברצף אחד)',
    morning >= 2 && morning <= 4 && free20.length - morning >= 4,
    `בוקר=${morning} ערב=${free20.length - morning}`)
}

// (2) כשנשארים פחות מ-6 מוצגים ויש עוד זמינות חוקית — נחשפים סלוטים נוספים
{
  // טיפול 40 דק׳ דורש שני סלוטים מוצגים רצופים. זה בדיוק המקרה שבו
  // 8 סלוטים מפוזרים הניבו 2-3 אפשרויות בלבד למרות שהיום כמעט ריק.
  const lifting = show([], 40)
  chk('✅ (2) טיפול 40 דק׳ ביום פנוי — הוחזרו לפחות 6 אפשרויות',
    lifting.length >= MIN_AVAILABLE_SLOTS, lifting.join(','))
  chk('🔒 (2) כל אפשרות שנחשפה היא באמת התחלה חוקית של 40 דק׳',
    lifting.every(t => isValidLiftingStart(FREE_DAY.year, FREE_DAY.month, FREE_DAY.day, t, now)),
    lifting.join(','))

  // תרחיש הדוגמה: חלק מהיום נתפס, ועדיין נשמר היעד כל עוד יש חוקיים
  const partial = [{ start: '09:00', end: '10:40' }, { start: '17:00', end: '18:00' }]
  const after = show(partial, 20)
  chk('✅ (2) אחרי תפוסה חלקית עדיין מוצגות ≥6 אפשרויות',
    after.length >= MIN_AVAILABLE_SLOTS, after.join(','))
  chk('🔒 (2) ואף אחת מהן אינה חופפת לתפוסה',
    after.every(t => !partial.some(b => mins(b.start) < mins(t) + 20 && mins(b.end) > mins(t))),
    after.join(','))
}

// (3) אין המצאה של סלוטים כשאין זמינות אמיתית
{
  // כל היום תפוס חוץ מ-16:00, 16:20, 16:40 — שלושה סלוטים חוקיים בלבד
  const almostFull = [
    { start: '09:00', end: '12:00' },
    { start: '17:00', end: '19:00' },
  ]
  const three = show(almostFull, 20)
  chk('🔒 (3) נשארו 3 סלוטים חוקיים — מוצגים 3, לא 6',
    JSON.stringify(three) === JSON.stringify(['16:00', '16:20', '16:40']), three.join(','))
  chk('🔒 (3) יום תפוס לחלוטין — אפס סלוטים, לא "המצאה" של שעות',
    show([{ start: '00:00', end: '23:59' }], 20).length === 0)
  chk('🔒 (3) 40 דק׳ ביום עם סלוט בודד פנוי — אפס אפשרויות',
    show([{ start: '09:00', end: '18:40' }], 40).length === 0)
}

// (8)(9) החשיפה ההדרגתית אינה עוקפת את היומן ואת התורים הקיימים
{
  const googleEvent = [{ start: '16:00', end: '17:00' }]
  const withEvent = show(googleEvent, 40)
  chk('🔒 (8)(9) סלוט שחופף אירוע Google / תור קיים לא נחשף גם כשחסרות אפשרויות',
    withEvent.every(t => mins(t) >= mins('17:00') || mins(t) + 40 <= mins('16:00')),
    withEvent.join(','))
  chk('🔒 (8)(9) כל מה שנחשף נמצא בתוך אחת המשמרות',
    withEvent.every(t => BUSINESS_SHIFTS.some(sh =>
      mins(t) >= mins(sh.start) && mins(t) + 40 <= mins(sh.end))),
    withEvent.join(','))
}

// (10)(11) שבת / חג / יום חסום — החשיפה ההדרגתית לא פותחת אותם
chk('🔒 (10) שבת — אפס סלוטים גם עם החשיפה ההדרגתית',
  selectDisplaySlots({ year: 2026, month: 7, day: 22, busyRanges: [], durationMin: 20, now }).length === 0)
chk('🔒 (11) יום חסום ביומן (חג / יום שאינה עובדת) — אפס סלוטים',
  show([{ start: '00:00', end: '23:59' }], 20).length === 0 &&
  show([{ start: '00:00', end: '23:59' }], 40).length === 0)

// (12) טווח ההזמנה נשאר 30 יום
chk('🔒 (12) booking horizon עדיין 30 יום, והחשיפה ההדרגתית אינה חורגת ממנו',
  BOOKING_HORIZON_DAYS === 30 &&
  selectDisplaySlots({ year: 2026, month: 8, day: 14, busyRanges: [], durationMin: 20, now }).length === 0)

// ─── סיכום ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${'═'.repeat(60)}`)
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} בדיקות נכשלו`)
process.exit(failed === 0 ? 0 : 1)
