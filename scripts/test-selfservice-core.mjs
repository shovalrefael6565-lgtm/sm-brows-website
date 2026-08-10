/**
 * בדיקות שלב 7 שאינן דורשות DB או רשת.
 *
 * העיקר כאן הוא בדיקת *שקילות*: אלגוריתם הצגת הזמינות חולץ מתוך
 * BookingForm.tsx ל-lib/slotSelection.ts כדי שמסך שינוי המועד ישתמש בו
 * גם הוא. חילוץ כזה שווה בדיוק כמה שהוא נאמן למקור — ולכן הקובץ הזה
 * מחזיק עותק *מקורי* של האלגוריתם (כפי שהיה בתוך BookingForm לפני
 * החילוץ) ומשווה אליו סלוט-בסלוט על פני עשרות תאריכים ותרחישי תפוסה.
 *
 * בנוסף נבדק שאין עותק שני של האלגוריתם באף קומפוננטה — כלומר ששינוי
 * ב-helper באמת ישפיע על שני המסכים.
 *
 * הרצה:  npm run test:selfservice-core
 */

import { readFileSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const {
  selectVisibleSlots, selectDisplaySlots, filterLiftingStarts, FALLBACK_MAX,
} = await import('../lib/slotSelection.ts')
const { specialSlotsFor } = await import('../lib/specialAvailability.ts')
const { TIME_SLOTS } = await import('../lib/bookingWindow.ts')

// ════════════════════════════════════════════════════════════════════════════
// עותק מקורי של האלגוריתם, כפי שהיה בתוך components/booking/BookingForm.tsx
// לפני שלב 7. ⚠️ אין לתקן אותו כדי "להתאים" ל-helper — הוא ההגדרה של
// ההתנהגות הקיימת באתר, וכל הבדל בינו לבין ה-helper הוא רגרסיה אמיתית.
// ════════════════════════════════════════════════════════════════════════════

const pad = n => n.toString().padStart(2, '0')
const toMin = hhmm => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function refBuildTimeSlots() {
  const slots = []
  for (let m = 9 * 60; m <= 10 * 60 + 40; m += 20) slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  for (let m = 15 * 60; m <= 18 * 60 + 40; m += 20) slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  return slots
}

function refIsraelToday(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now)
  const y = parseInt(parts.find(p => p.type === 'year').value)
  const m = parseInt(parts.find(p => p.type === 'month').value) - 1
  const d = parseInt(parts.find(p => p.type === 'day').value)
  return new Date(y, m, d, 0, 0, 0, 0)
}

function refDateSeed(year, month, day) {
  return ((year * 31 + (month + 1)) * 31 + day) >>> 0
}

function refBusinessDayOffset(year, month, day, now) {
  const today = refIsraelToday(now)
  const target = new Date(year, month, day)
  target.setHours(0, 0, 0, 0)
  if (target.getTime() <= today.getTime()) return 0
  let count = 0
  const d = new Date(today)
  while (d.getTime() < target.getTime()) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 5 && dow !== 6) count++
  }
  return count
}

function refSlotsForOffset(offset, seed) {
  if (offset === 0) return 3
  if (offset === 1) return 5
  if (offset <= 6) return 6 + (seed % 2)
  return 0
}

function refSeededShuffle(arr, seed) {
  const result = [...arr]
  let s = seed || 1
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * visibleSlots כפי שהיה ב-BookingForm — מילה במילה, עם now מוזרק.
 *
 * ⚠️ **חלון ההכנה כאן הוא ליטרל בכוונה ולא import של MIN_LEAD_MINUTES.**
 * כל תפקידה של הפונקציה הזו הוא להיות עותק *עצמאי* של האלגוריתם, כדי
 * שסטייה בקוד האמיתי תיתפס. import מהקוד הנבדק היה הופך את ההשוואה
 * לריקה. פינון הערך עצמו נעשה במקום אחר, ובמפורש:
 * scripts/test-public-booking-core.mjs — `MIN_LEAD_MINUTES = 40`.
 *
 * ⚠️ ולכן: **שינוי MIN_LEAD_MINUTES מחייב עדכון גם כאן.** הליטרל היה 90
 * ונשאר 90 אחרי ש-15B קיצר את החלון ל-40. הכשל היה סמוי — הוא צף רק
 * כשאחד מתאריכי הבדיקה (09.08.2026) הוא "היום" בשעון ישראל, כי רק אז
 * minStartMin שונה מאפס. זהו בדיוק הסיכון "90→40 בקובץ אחד בלבד"
 * שתועד ב-Risks של 15A.
 */
function refVisibleSlots(viewYear, viewMonth, selectedDay, busyRanges, now) {
  const REF_MIN_LEAD_MINUTES = 40
  const SLOT_DURATION = 20
  const EVENING_FROM = 15 * 60
  const timeSlots = refBuildTimeSlots()
  const isSlotTaken = slot => {
    const slotStart = toMin(slot)
    const slotEnd = slotStart + SLOT_DURATION
    return busyRanges.some(({ start, end }) => toMin(start) < slotEnd && toMin(end) > slotStart)
  }

  const seed = refDateSeed(viewYear, viewMonth, selectedDay)
  const offset = refBusinessDayOffset(viewYear, viewMonth, selectedDay, now)
  let maxSlots = refSlotsForOffset(offset, seed)

  const nowParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now)
  const nowYear = parseInt(nowParts.find(p => p.type === 'year').value)
  const nowMonth = parseInt(nowParts.find(p => p.type === 'month').value) - 1
  const nowDay = parseInt(nowParts.find(p => p.type === 'day').value)
  const nowHour = parseInt(nowParts.find(p => p.type === 'hour').value)
  const nowMin = parseInt(nowParts.find(p => p.type === 'minute').value)
  const isViewingToday = selectedDay === nowDay && viewMonth === nowMonth && viewYear === nowYear
  const minStartMin = isViewingToday ? nowHour * 60 + nowMin + REF_MIN_LEAD_MINUTES : 0

  const specialFree = specialSlotsFor(viewYear, viewMonth, selectedDay)
    .filter(slot => toMin(slot) >= minStartMin)
    .filter(slot => !isSlotTaken(slot))

  if (maxSlots === 0) return specialFree

  const free = timeSlots
    .filter(slot => toMin(slot) >= minStartMin)
    .filter(slot => !isSlotTaken(slot))

  maxSlots = Math.max(maxSlots, Math.min(4, free.length))

  const evening = refSeededShuffle(free.filter(s => toMin(s) >= EVENING_FROM), seed)
  const morning = refSeededShuffle(free.filter(s => toMin(s) < EVENING_FROM), seed + 1)

  const targetMorning = maxSlots <= 5 ? 1 : 2
  const targetEvening = maxSlots - targetMorning

  let picked = [...morning.slice(0, targetMorning), ...evening.slice(0, targetEvening)]

  if (picked.length < maxSlots) {
    const remaining = free.filter(s => !picked.includes(s))
    picked.push(...remaining.slice(0, maxSlots - picked.length))
  }

  const freeSorted = [...free].sort((a, b) => toMin(a) - toMin(b))

  const TRIPLE_FROM = 16 * 60
  const eveningTriples = []
  for (let i = 0; i < freeSorted.length - 2; i++) {
    if (
      toMin(freeSorted[i]) >= TRIPLE_FROM &&
      toMin(freeSorted[i + 1]) - toMin(freeSorted[i]) === 20 &&
      toMin(freeSorted[i + 2]) - toMin(freeSorted[i + 1]) === 20
    ) {
      eveningTriples.push([freeSorted[i], freeSorted[i + 1], freeSorted[i + 2]])
    }
  }
  const hasEveningTriple = arr => {
    const s = [...arr].sort((a, b) => toMin(a) - toMin(b))
    return s.some((_, i) =>
      i >= 2 &&
      toMin(s[i - 2]) >= TRIPLE_FROM &&
      toMin(s[i]) - toMin(s[i - 1]) === 20 &&
      toMin(s[i - 1]) - toMin(s[i - 2]) === 20
    )
  }
  if (maxSlots >= 3 && eveningTriples.length > 0 && !hasEveningTriple(picked)) {
    const chosen = refSeededShuffle(eveningTriples, seed + 3)[0]
    const others = picked.filter(s => !chosen.includes(s))
    picked = [...chosen, ...others.slice(0, maxSlots - chosen.length)]
  }

  const hasAdjacentPair = arr => {
    const s = [...arr].sort((a, b) => toMin(a) - toMin(b))
    return s.some((v, i) => i > 0 && toMin(v) - toMin(s[i - 1]) === 20)
  }
  const freePairs = []
  for (let i = 0; i < freeSorted.length - 1; i++) {
    if (toMin(freeSorted[i + 1]) - toMin(freeSorted[i]) === 20)
      freePairs.push([freeSorted[i], freeSorted[i + 1]])
  }
  if (!hasAdjacentPair(picked) && freePairs.length > 0 && picked.length >= 2) {
    const chosen = refSeededShuffle(freePairs, seed + 2)[0]
    const need = chosen.filter(s => !picked.includes(s))
    if (need.length > 0) {
      const removable = picked.filter(s => !chosen.includes(s))
      const toRemove = removable.slice(removable.length - need.length)
      picked = picked.filter(s => !toRemove.includes(s)).concat(need)
    }
  }

  const merged = picked.concat(specialFree.filter(s => !picked.includes(s)))
  return merged.sort((a, b) => toMin(a) - toMin(b))
}

// ════════════════════════════════════════════════════════════════════════════

section('שקילות מלאה ל-BookingForm המקורי')

/** תרחישי תפוסה מייצגים: ריק, בוקר תפוס, ערב תפוס, מפוזר, כמעט מלא */
const BUSY_CASES = [
  { name: 'יום פנוי לגמרי', busy: [] },
  { name: 'כל הבוקר תפוס', busy: [{ start: '09:00', end: '11:00' }] },
  { name: 'כל הערב תפוס', busy: [{ start: '15:00', end: '19:00' }] },
  { name: 'תפוסה מפוזרת', busy: [
    { start: '09:20', end: '09:40' }, { start: '10:20', end: '10:40' },
    { start: '15:40', end: '16:20' }, { start: '17:00', end: '17:20' },
    { start: '18:20', end: '18:40' },
  ] },
  { name: 'כמעט מלא — שני סלוטים פנויים', busy: [
    { start: '09:00', end: '10:40' }, { start: '15:00', end: '18:20' },
  ] },
  { name: 'מלא לגמרי', busy: [{ start: '09:00', end: '19:00' }] },
]

const NOW = new Date()
const today = refIsraelToday(NOW)

let mismatches = 0
let comparisons = 0
const sample = []

for (const testCase of BUSY_CASES) {
  for (let i = 0; i < 45; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate()

    const expected = refVisibleSlots(y, m, day, testCase.busy, NOW)
    const actual = selectVisibleSlots({ year: y, month: m, day, busyRanges: testCase.busy, now: NOW })
    comparisons++

    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      mismatches++
      if (sample.length < 3) {
        sample.push(`${y}-${pad(m + 1)}-${pad(day)} [${testCase.name}]\n     צפוי: ${expected.join(',')}\n     בפועל: ${actual.join(',')}`)
      }
    }
  }
}

chk(`ה-helper מחזיר בדיוק את אותם סלוטים כמו BookingForm המקורי`,
  mismatches === 0, `${comparisons} השוואות${mismatches ? '\n   ' + sample.join('\n   ') : ''}`)

// גם מספר הסלוטים ליום — הדרישה המפורשת ש"לא ישתנה בפועל"
{
  let countMismatch = 0
  for (let i = 0; i < 45; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    const a = refVisibleSlots(d.getFullYear(), d.getMonth(), d.getDate(), [], NOW).length
    const b = selectVisibleSlots({
      year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), busyRanges: [], now: NOW,
    }).length
    if (a !== b) countMismatch++
  }
  chk('מספר הסלוטים ליום לא השתנה', countMismatch === 0)
}

section('הצגה מצומצמת — לא כל הזמינות')

{
  // יום בתוך החלון, פנוי לגמרי: 16 סלוטים אמיתיים ברשת, מוצגים לכל היותר 7
  let checkedDay = null
  for (let i = 1; i < 20; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    const offset = refBusinessDayOffset(d.getFullYear(), d.getMonth(), d.getDate(), NOW)
    const dow = d.getDay()
    if (offset >= 2 && offset <= 6 && dow !== 5 && dow !== 6) { checkedDay = d; break }
  }

  if (!checkedDay) {
    chk('נמצא יום בתוך החלון לבדיקה', false)
  } else {
    const slots = selectVisibleSlots({
      year: checkedDay.getFullYear(), month: checkedDay.getMonth(), day: checkedDay.getDate(),
      busyRanges: [], now: NOW,
    })
    const specialExtra = specialSlotsFor(
      checkedDay.getFullYear(), checkedDay.getMonth(), checkedDay.getDate(),
    ).length
    chk('ברשת האמיתית יש 18 סלוטים (6 בוקר + 12 ערב)',
      TIME_SLOTS.length === 18, `count=${TIME_SLOTS.length}`)
    chk('ביום פנוי לגמרי מוצגים לכל היותר 7 (+זמינות מיוחדת), ולא כל הרשת',
      slots.length <= 7 + specialExtra && slots.length < TIME_SLOTS.length,
      `הוצגו ${slots.length}`)
    chk('הסלוטים המוצגים הם תת-קבוצה של הרשת האמיתית',
      slots.every(s => TIME_SLOTS.includes(s) || specialSlotsFor(
        checkedDay.getFullYear(), checkedDay.getMonth(), checkedDay.getDate()).includes(s)))
  }
}

{
  // מעבר לחלון השבוע — אין זמינות רגילה, גם אם היום פנוי לחלוטין
  const far = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 40)
  const slots = selectVisibleSlots({
    year: far.getFullYear(), month: far.getMonth(), day: far.getDate(),
    busyRanges: [], now: NOW,
  })
  const special = specialSlotsFor(far.getFullYear(), far.getMonth(), far.getDate())
  chk('מעבר לחלון השבוע מוצגים רק סלוטים של זמינות מיוחדת (או כלום)',
    slots.every(s => special.includes(s)), `הוצגו ${slots.length}`)
}

{
  chk('יום תפוס לגמרי מחזיר אפס סלוטים', (() => {
    for (let i = 1; i < 10; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
      if (d.getDay() === 5 || d.getDay() === 6) continue
      const slots = selectVisibleSlots({
        year: d.getFullYear(), month: d.getMonth(), day: d.getDate(),
        busyRanges: [{ start: '00:00', end: '23:59' }], now: NOW,
      })
      if (slots.length !== 0) return false
    }
    return true
  })())

  chk('ה-fallback המבוקר חסום ל-3 סלוטים לכל היותר', FALLBACK_MAX === 3, `FALLBACK_MAX=${FALLBACK_MAX}`)
}

section('הרמת גבות — שני סלוטים רצופים')

{
  chk('filterLiftingStarts משאיר רק התחלות עם שכן מוצג',
    JSON.stringify(filterLiftingStarts(['15:00', '15:20', '16:40', '18:00'])) ===
    JSON.stringify(['15:00']))
  chk('בלי רצף — אין התחלות אפשריות',
    filterLiftingStarts(['09:00', '15:00', '17:00']).length === 0)

  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3)
  const visible = selectVisibleSlots({
    year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), busyRanges: [], now: NOW,
  })
  const display40 = selectDisplaySlots({
    year: d.getFullYear(), month: d.getMonth(), day: d.getDate(),
    busyRanges: [], durationMin: 40, now: NOW,
  })
  const display20 = selectDisplaySlots({
    year: d.getFullYear(), month: d.getMonth(), day: d.getDate(),
    busyRanges: [], durationMin: 20, now: NOW,
  })
  chk('טיפול 20 דק׳ מציג את הסלוטים כמו שהם',
    JSON.stringify(display20) === JSON.stringify(visible))
  chk('טיפול 40 דק׳ מציג תת-קבוצה בלבד (התחלות עם רצף)',
    display40.every(s => visible.includes(s)) && display40.length <= visible.length)
}

section('מקור אמת יחיד — אין עותק שני של האלגוריתם')

{
  const bookingForm = readFileSync(new URL('../components/booking/BookingForm.tsx', import.meta.url), 'utf8')
  const dialog = readFileSync(new URL('../components/account/RescheduleDialog.tsx', import.meta.url), 'utf8')

  chk('BookingForm מייבא את ה-helper המשותף',
    bookingForm.includes("from '@/lib/slotSelection'"))
  chk('RescheduleDialog מייבא את ה-helper המשותף',
    dialog.includes("from '@/lib/slotSelection'"))

  // הפונקציות שמרכיבות את האלגוריתם חייבות להיות מוגדרות רק בקובץ אחד
  for (const fn of ['slotsForOffset', 'seededShuffle', 'dateSeed']) {
    chk(`אין הגדרה מקומית של ${fn} בקומפוננטות`,
      !bookingForm.includes(`function ${fn}`) && !dialog.includes(`function ${fn}`))
  }
  chk('אין חישוב תפוסה משוכפל (isSlotTaken) בקומפוננטות',
    !bookingForm.includes('const isSlotTaken') && !dialog.includes('const isSlotTaken'))
  chk('אין רשת סלוטים משוכפלת (buildTimeSlots) בקומפוננטות',
    !bookingForm.includes('function buildTimeSlots') && !dialog.includes('function buildTimeSlots'))
}

// ════════════════════════════════════════════════════════════════════════════
section('שלב 15E — בקשת שינוי מועד (בדיקות מבנה קוד)')

{
  const approval = readFileSync(new URL('../lib/appointmentApproval.ts', import.meta.url), 'utf8')
  const dbLayer = readFileSync(new URL('../lib/db/appointments.ts', import.meta.url), 'utf8')
  const selfService = readFileSync(new URL('../lib/appointmentSelfService.ts', import.meta.url), 'utf8')
  const dialog = readFileSync(new URL('../components/account/RescheduleDialog.tsx', import.meta.url), 'utf8')

  /*
   * 🔒 הבאג שנתפס ב-review של 15E: approve_reschedule_request מחזיר
   * to_jsonb(appointments_row) — בלי ה-join ל-customers. שימוש ישיר בשורה
   * הזו לבניית אירוע היומן היה יוצר אירוע עם שם וטלפון undefined, כלומר
   * כשל שקט שנראה כהצלחה. הריפוי: הקורא טוען מחדש דרך getAppointmentForAdmin.
   */
  chk('🔒 approveRescheduleRequest מחזיר מזהים בלבד, לא שורות מלאות',
    /requestId: string; originalId: string/.test(dbLayer))
  chk('🔒 approveRescheduleAndSync טוען מחדש דרך getAppointmentForAdmin',
    /getAppointmentForAdmin\(approved\.requestId\)/.test(approval) &&
    /getAppointmentForAdmin\(approved\.originalId\)/.test(approval))

  /*
   * 🔒 (rescheduled, delete) חייב להיות מוכר בשלושה מקומות. חוסר באחד
   * מהם משאיר את האירוע הישן ביומן — חוסם שעה שהתפנתה, בלי שגיאה.
   */
  chk('🔒 retryCalendarSync מכיר (rescheduled, delete)',
    /'rescheduled'\s*&&\s*row\.calendar_sync_operation === 'delete'/.test(approval))
  chk('🔒 רשימת "דורש טיפול" כוללת status.eq.rescheduled',
    /status\.eq\.rescheduled/.test(dbLayer))

  /*
   * 🔒 15F — הנוסח של "שינוי המועד אושר" **אושר**, והמסלול מחזיר אותו.
   *
   * ⚠️ עד 15E הבדיקה כאן הייתה הפוכה ("אינו מחזיר whatsappUrl"), כי לא
   * היה נוסח מאושר ואסור היה להמציא אחד. מה שנשאר נכון הוא הכלל השני:
   * זהו נוסח **נפרד**, ואין להשתמש בנוסח אישור התור הרגיל כתחליף.
   */
  chk('🔒 approveRescheduleAndSync מחזיר whatsappUrl (נוסח מאושר ב-15F)',
    /RescheduleApprovalResult[\s\S]{0,600}whatsappUrl/.test(approval))
  chk('🔒 ומשתמש בנוסח הייעודי ולא בנוסח אישור התור',
    /buildRescheduleApprovedMessage/.test(approval)
    && !/approveRescheduleAndSync[\s\S]{0,1200}approvalWhatsAppUrl\(/.test(approval))

  /*
   * 🔒 התור של הלקוחה עצמה **אינו** מסונן מרשימת התפוסים. הסינון הישן
   * הציג שעות שחופפות לתור הקיים כפנויות — ובמודל הבקשה הן אינן ניתנות
   * לשמירה כלל (SELF_OVERLAP / EXCLUDE constraint).
   */
  chk('🔒 RescheduleDialog אינו מסנן את התור עצמו מהתפוסים',
    !/ownBusy/.test(dialog))
  chk('🔒 חפיפה עצמית נבדקת בשרת לפני הכתיבה',
    /self_overlap/.test(selfService))

  // 🔒 הבקשה אינה נוגעת ביומן — רק האישור עושה זאת.
  chk('🔒 requestRescheduleForCustomer אינו קורא ל-syncQuietly',
    !/requestRescheduleForCustomer[\s\S]*?\n}/.test(selfService) ||
    !/requestRescheduleForCustomer[\s\S]{0,4000}syncQuietly/.test(selfService))

  // 🔒 התפוגה מגיעה מכלל 15B ולא מחישוב מקומי
  chk('🔒 תפוגת הבקשה מגיעה מ-computePendingExpiresAt',
    /computePendingExpiresAt\(\)/.test(selfService))
}

// ── סיכום ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
