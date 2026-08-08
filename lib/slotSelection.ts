/**
 * אלגוריתם *הצגת* הזמינות — מקור אמת יחיד ומשותף.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * חשוב להבין את ההפרדה בין שני דברים שונים לגמרי:
 *
 *   • כללי הזמינות העסקיים (lib/bookingWindow.ts + lib/specialAvailability.ts):
 *     אילו ימים פתוחים, אילו שעות קיימות ברשת, חלון ההכנה, שישי/שבת.
 *     אלה כללים אמיתיים והשרת אוכף אותם.
 *
 *   • אלגוריתם ההצגה (הקובץ הזה): מתוך הסלוטים שבאמת פנויים, אילו להראות
 *     ללקוחה. זו החלטת חוויית משתמש — הצגה מצומצמת ומבוקרת במקום חשיפת כל
 *     היומן. השרת *לא* אוכף אותה (ראה ההערה ב-lib/bookingWindow.ts).
 *
 * עד שלב 7 האלגוריתם הזה חי רק בתוך BookingForm.tsx. שינוי מועד באזור
 * האישי חייב להציג בדיוק את אותה זמינות — ולכן הוא חולץ לכאן במקום
 * להשתכפל. BookingForm ו-RescheduleDialog מייבאים שניהם מהקובץ הזה, כך
 * ששינוי כאן משפיע על שניהם באופן זהה.
 *
 * ⚠️ החילוץ הזה חייב לשמר התנהגות ביט-בביט: מספר הסלוטים, הפיזור
 * בוקר/ערב, הערבוב מבוסס-הזרע והעדפת הרצף — כולם הועתקו כלשונם.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { specialSlotsFor } from './specialAvailability'
import { businessDayOffset, TIME_SLOTS, MIN_LEAD_MINUTES } from './bookingWindow'

export interface BusyRange {
  start: string
  end: string
}

/** משך סלוט הבסיס ברשת — גם תור של 40 דק' נבנה משני סלוטים רצופים */
const SLOT_DURATION = 20

/** 15:00 — תחילת משמרת אחה"צ/ערב */
const EVENING_FROM = 15 * 60

/** 16:00 — מכאן ומעלה מחפשים שלישייה רצופה */
const TRIPLE_FROM = 16 * 60

/** תקרת ה-fallback המבוקר — לעולם לא "כל הזמינות" */
export const FALLBACK_MAX = 3

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minToHHMM(m: number): string {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** מחזיר את "היום" לפי שעון ישראל — נכון גם בחצות ובשינויי שעון */
export function getIsraelToday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now)
  const y = parseInt(parts.find(p => p.type === 'year')!.value)
  const m = parseInt(parts.find(p => p.type === 'month')!.value) - 1
  const d = parseInt(parts.find(p => p.type === 'day')!.value)
  return new Date(y, m, d, 0, 0, 0, 0)
}

/** הופך תאריך לזרע מספרי (כל יום מקבל זרע יציב משלו) */
export function dateSeed(year: number, month: number, day: number): number {
  return ((year * 31 + (month + 1)) * 31 + day) >>> 0
}

/** כמה משבצות להציג ביום הזה (3 היום, 5 מחר, 6-7 בהמשך השבוע, מעבר ל-6 ימי עסקים — אין) */
export function slotsForOffset(offset: number, seed: number): number {
  if (offset === 0) return 3
  if (offset === 1) return 5
  if (offset <= 6) return 6 + (seed % 2) // 6 או 7, יציב לתאריך
  return 0 // מעבר ל-6 ימי עסקים — לא זמין
}

/** ערבוב פסאודו-אקראי מבוסס זרע — אותו תאריך תמיד חוזר עם אותה תוצאה */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
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
 * האם הסלוט תפוס לפי טווחי התפוסה. תמיד נבדק מול 20 דק' — גם עבור הרמת
 * גבות (40 דק'), כי שם ההגבלה נאכפת ע"י דרישת *שני* סלוטים רצופים מוצגים
 * (ראה filterLiftingStarts), בדיוק כפי שהיה ב-BookingForm.
 */
function isSlotTaken(slot: string, busyRanges: BusyRange[]): boolean {
  const slotStart = toMin(slot)
  const slotEnd = slotStart + SLOT_DURATION
  return busyRanges.some(({ start, end }) => toMin(start) < slotEnd && toMin(end) > slotStart)
}

export interface SelectSlotsParams {
  year: number
  /** 0-based, כמו ב-Date */
  month: number
  day: number
  busyRanges: BusyRange[]
  now?: Date
}

/**
 * בוחר את הזמינות המוצגת: כמות לפי מרחק ביום-עסקים, בעיקר ערב, גיוון יומי.
 *
 * הועתק כלשונו מ-BookingForm.visibleSlots. כל שינוי כאן משנה גם את עמוד
 * קביעת התור וגם את מסך שינוי המועד — וזו בדיוק המטרה.
 */
export function selectVisibleSlots({
  year, month, day, busyRanges, now = new Date(),
}: SelectSlotsParams): string[] {
  const seed = dateSeed(year, month, day)
  const offset = businessDayOffset(year, month, day, now)
  let maxSlots = slotsForOffset(offset, seed)

  const nowParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now)
  const nowYear  = parseInt(nowParts.find(p => p.type === 'year')!.value)
  const nowMonth = parseInt(nowParts.find(p => p.type === 'month')!.value) - 1
  const nowDay   = parseInt(nowParts.find(p => p.type === 'day')!.value)
  const nowHour  = parseInt(nowParts.find(p => p.type === 'hour')!.value)
  const nowMinute = parseInt(nowParts.find(p => p.type === 'minute')!.value)
  const isViewingToday = day === nowDay && month === nowMonth && year === nowYear
  // בהיום — רק שעות שמתחילות לפחות MIN_LEAD_MINUTES מעכשיו.
  // 🔒 אותו קבוע שהשרת אוכף ב-hasLeadTime. אין כאן מספר משלנו.
  const minStartMin = isViewingToday ? nowHour * 60 + nowMinute + MIN_LEAD_MINUTES : 0

  // ── זמינות מיוחדת (חריגה זמנית, מוגדרת ב-lib/specialAvailability.ts) ──
  // תוספת בלבד: אותו חלון הכנה (MIN_LEAD_MINUTES) ואותה בדיקת תפוסה מול Google Calendar.
  const specialFree = specialSlotsFor(year, month, day)
    .filter(slot => toMin(slot) >= minStartMin)
    .filter(slot => !isSlotTaken(slot, busyRanges))

  // מעבר לחלון השבוע קדימה: רק הסלוטים המיוחדים (אם יש), אחרת אין זמינות
  if (maxSlots === 0) return specialFree

  const free = TIME_SLOTS
    .filter(slot => toMin(slot) >= minStartMin)
    .filter(slot => !isSlotTaken(slot, busyRanges))

  // מינימום 4 סלוטים ביום אם קיימת זמינות אמיתית מספקת (≥4 פנויים) — בלי
  // לפתוח את כל היומן ובלי להוריד ימים שכבר מציגים 4+ (max בין שניהם).
  maxSlots = Math.max(maxSlots, Math.min(4, free.length))

  // ערבוב יציב לפי תאריך — ריענון לא משנה, אבל כל יום שונה
  const evening = seededShuffle(free.filter(s => toMin(s) >= EVENING_FROM), seed)
  const morning = seededShuffle(free.filter(s => toMin(s) < EVENING_FROM), seed + 1)

  const targetMorning = maxSlots <= 5 ? 1 : 2
  const targetEvening = maxSlots - targetMorning

  let picked = [
    ...morning.slice(0, targetMorning),
    ...evening.slice(0, targetEvening),
  ]

  // אם בקבוצה אחת אין מספיק — לאכלס מהשנייה
  if (picked.length < maxSlots) {
    const remaining = free.filter(s => !picked.includes(s))
    picked.push(...remaining.slice(0, maxSlots - picked.length))
  }

  const freeSorted = [...free].sort((a, b) => toMin(a) - toMin(b))

  // העדפה ראשונה: שלישיית סלוטים רצופה אמיתית בערב, החל מ-16:00 ומעלה
  // (S, S+20, S+40). אם קיימת — לכלול אותה במלואה, תוך הסרת אותו מספר סלוטים
  // מפוזרים, כך שמספר הסלוטים ביום נשאר זהה בדיוק. הבוקר נשאר מפוזר.
  const eveningTriples: [string, string, string][] = []
  for (let i = 0; i < freeSorted.length - 2; i++) {
    if (
      toMin(freeSorted[i]) >= TRIPLE_FROM &&
      toMin(freeSorted[i + 1]) - toMin(freeSorted[i]) === 20 &&
      toMin(freeSorted[i + 2]) - toMin(freeSorted[i + 1]) === 20
    ) {
      eveningTriples.push([freeSorted[i], freeSorted[i + 1], freeSorted[i + 2]])
    }
  }
  const hasEveningTriple = (arr: string[]) => {
    const s = [...arr].sort((a, b) => toMin(a) - toMin(b))
    return s.some((_, i) =>
      i >= 2 &&
      toMin(s[i - 2]) >= TRIPLE_FROM &&
      toMin(s[i]) - toMin(s[i - 1]) === 20 &&
      toMin(s[i - 1]) - toMin(s[i - 2]) === 20
    )
  }
  if (maxSlots >= 3 && eveningTriples.length > 0 && !hasEveningTriple(picked)) {
    const chosen = seededShuffle(eveningTriples, seed + 3)[0]
    const others = picked.filter(s => !chosen.includes(s))
    picked = [...chosen, ...others.slice(0, maxSlots - chosen.length)]
  }

  // fallback: אם אין שלישיית ערב, לוודא לפחות זוג רצוף אמיתי (S, S+20) —
  // בלי להוסיף/להוריד סלוטים, בלי לחשוף שעות מוסתרות ובלי לשנות זמינות אמיתית.
  const hasAdjacentPair = (arr: string[]) => {
    const s = [...arr].sort((a, b) => toMin(a) - toMin(b))
    return s.some((v, i) => i > 0 && toMin(v) - toMin(s[i - 1]) === 20)
  }
  const freePairs: [string, string][] = []
  for (let i = 0; i < freeSorted.length - 1; i++) {
    if (toMin(freeSorted[i + 1]) - toMin(freeSorted[i]) === 20)
      freePairs.push([freeSorted[i], freeSorted[i + 1]])
  }
  if (!hasAdjacentPair(picked) && freePairs.length > 0 && picked.length >= 2) {
    // בחירת זוג יציבה לפי זרע התאריך
    const chosen = seededShuffle(freePairs, seed + 2)[0]
    const need = chosen.filter(s => !picked.includes(s))
    if (need.length > 0) {
      // מפנים מקום ע"י הסרת סלוטים שאינם חלק מהזוג — כך הכמות נשמרת בדיוק
      const removable = picked.filter(s => !chosen.includes(s))
      const toRemove = removable.slice(removable.length - need.length)
      picked = picked.filter(s => !toRemove.includes(s)).concat(need)
    }
  }

  // רשת ביטחון מבוקרת: אם משום מה לא נבחר אף סלוט למרות שקיימת זמינות
  // אמיתית — מציגים את המוקדמים ביותר בלבד, עד FALLBACK_MAX. זו *לא*
  // חשיפה של כל היומן, והיא לא נדרסת ע"י הפרמטרים הנוכחיים (maxSlots
  // תמיד ≥3 בתוך החלון, ולכן picked לעולם לא ריק כש-free אינו ריק) —
  // היא קיימת כדי שגם שינוי עתידי בפרמטרים לא ייצור יום "ריק" מזויף.
  if (picked.length === 0 && freeSorted.length > 0) {
    picked = freeSorted.slice(0, FALLBACK_MAX)
  }

  // איחוד עם הזמינות המיוחדת (אם התאריך נופל גם בחלון השבוע קדימה וגם בחלון
  // המיוחד) — התוספת לא גורעת מהבחירה הרגילה ולא משנה אותה.
  const merged = picked.concat(specialFree.filter(s => !picked.includes(s)))
  return merged.sort((a, b) => toMin(a) - toMin(b))
}

/**
 * הרמת גבות = 40 דק׳ → שני סלוטים רצופים. שעות ההתחלה האפשריות הן רק
 * סלוטים מתוך אלה שכבר מוצגים שיש להם שכן רצוף מוצג (S וגם S+20) — בלי
 * לחשוף שעות נוספות מעבר לאלה שכבר נבחרו להצגה.
 */
export function filterLiftingStarts(visible: string[]): string[] {
  return visible.filter(s => visible.includes(minToHHMM(toMin(s) + 20)))
}

/**
 * הסלוטים להצגה בפועל, לפי משך הטיפול. 40 דק' → רק התחלות עם רצף מוצג.
 * זו הפונקציה שמסך שינוי המועד משתמש בה.
 */
export function selectDisplaySlots(
  params: SelectSlotsParams & { durationMin: number },
): string[] {
  const visible = selectVisibleSlots(params)
  return params.durationMin > SLOT_DURATION ? filterLiftingStarts(visible) : visible
}
