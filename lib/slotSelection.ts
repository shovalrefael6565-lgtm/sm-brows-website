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
import {
  isWithinBookingHorizon, isFridayOrSaturday, TIME_SLOTS, MIN_LEAD_MINUTES,
  BUSINESS_SHIFTS, SLOT_INTERVAL_MINUTES,
} from './bookingWindow'

export interface BusyRange {
  start: string
  end: string
}

/** משך סלוט הבסיס ברשת — גם תור של 40 דק' נבנה משני סלוטים רצופים */
const SLOT_DURATION = SLOT_INTERVAL_MINUTES

/** תחילת משמרת אחה"צ/ערב — נגזרת משעות העבודה, אין כאן מספר משלנו */
const EVENING_FROM = toMin(BUSINESS_SHIFTS[1].start)

/** מכאן ומעלה מחפשים שלישייה רצופה — תחילת משמרת הערב */
const TRIPLE_FROM = EVENING_FROM

/** תקרת ה-fallback המבוקר — לעולם לא "כל הזמינות" */
export const FALLBACK_MAX = 3

/**
 * כמה סלוטים מציגים ביום פנוי — נקודת הפתיחה של ההצגה המצומצמת.
 *
 * ⚠️ עד 06.09.2026 הכמות הייתה סולם לפי מרחק (3 היום, 5 מחר, 6-7 בהמשך).
 * הסולם הוחלף בכמות אחידה: יום פנוי מציג 8, וההצטמצמות בפועל נובעת
 * מזמינות אמיתית (תפוסה, חלון הכנה) ולא ממספר מלאכותי.
 */
export const INITIAL_SLOTS = 8

/**
 * יעד המינימום: כמה אפשרויות **זמינות** הלקוחה אמורה לראות.
 *
 * כשהזמנות/חסימות מורידות את המוצג מתחת לזה, `selectDisplaySlots` חושף
 * סלוטים נוספים מתוך המאגר החוקי של אותו יום — עד שחוזרים ליעד או עד
 * שנגמרו הסלוטים החוקיים. 🔒 אין המצאה של שעות: כל סלוט שנחשף עבר בדיוק
 * את אותן בדיקות (רשת/משמרת, חלון הכנה, תפוסה מ-Google ומה-DB).
 */
export const MIN_AVAILABLE_SLOTS = 6

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
 * 🔒 **מאגר הסלוטים החוקיים והפנויים של היום — מקור אמת יחיד.**
 *
 * כל סלוט כאן עבר את *כל* בדיקות הזמינות הקיימות:
 *   • היום אינו שישי/שבת;
 *   • הוא ברשת שנגזרת משעות העבודה (BUSINESS_SHIFTS), ולכן הטיפול נכנס
 *     בתוך המשמרת — או שהוא נפתח במפורש בזמינות המיוחדת;
 *   • התאריך בתוך טווח ההזמנה (30 יום) — אחרת הרשת הרגילה כלל אינה חלה;
 *   • חלון ההכנה (MIN_LEAD_MINUTES) עבור היום;
 *   • אינו חופף שום טווח תפוסה — ו-busyRanges הוא בדיוק מה שהחזיר
 *     `resolveAvailability`: Google Calendar + תורים/pending מה-DB, ממוזגים.
 *
 * ⚠️ גם ההצגה הרגילה וגם החשיפה ההדרגתית (`selectDisplaySlots`) שואבות
 * מכאן, ורק מכאן. אין דרך שנייה שסלוט יגיע למסך, ולכן אין דרך לחשוף
 * שעה שאינה חוקית או שאינה פנויה באמת.
 */
function legalFreeSlots({
  year, month, day, busyRanges, now = new Date(),
}: SelectSlotsParams): { regular: string[]; special: string[] } {
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

  // 🔒 שישי/שבת סגורים — גם בתוך חלון זמינות מיוחדת. בפועל הלוח כלל אינו
  // מאפשר לבחור יום כזה (isBookableDate), אבל החשיפה ההדרגתית אסור לה
  // להסתמך על כך שהקורא כבר סינן: כאן זה נאכף מקומית.
  if (isFridayOrSaturday(year, month, day)) return { regular: [], special: [] }

  const usable = (slots: string[]) => slots
    .filter(slot => toMin(slot) >= minStartMin)
    .filter(slot => !isSlotTaken(slot, busyRanges))

  return {
    // מעבר לטווח ההזמנה הרשת הרגילה אינה חלה כלל
    regular: isWithinBookingHorizon(year, month, day, now) ? usable(TIME_SLOTS) : [],
    // ── זמינות מיוחדת (חריגה זמנית, lib/specialAvailability.ts) ──
    // תוספת בלבד: אותו חלון הכנה ואותה בדיקת תפוסה.
    special: usable(specialSlotsFor(year, month, day)),
  }
}

/**
 * בוחר את הזמינות המוצגת: INITIAL_SLOTS ביום פנוי, בעיקר ערב, גיוון יומי.
 *
 * הועתק כלשונו מ-BookingForm.visibleSlots. כל שינוי כאן משנה גם את עמוד
 * קביעת התור וגם את מסך שינוי המועד — וזו בדיוק המטרה.
 */
export function selectVisibleSlots(params: SelectSlotsParams): string[] {
  const { year, month, day } = params
  const seed = dateSeed(year, month, day)
  const { regular: free, special: specialFree } = legalFreeSlots(params)
  // 🔒 גבול הטווח (30 יום) כבר נאכף ב-legalFreeSlots: מחוץ לטווח הרשת
  // הרגילה ריקה, ולכן maxSlots יוצא 0 — בדיוק אותו ענף שהיה קודם.
  const maxSlots = free.length > 0 ? INITIAL_SLOTS : 0

  // מעבר לטווח ההזמנה: רק הסלוטים המיוחדים (אם יש), אחרת אין זמינות
  if (maxSlots === 0) return specialFree

  // ערבוב יציב לפי תאריך — ריענון לא משנה, אבל כל יום שונה
  const evening = seededShuffle(free.filter(s => toMin(s) >= EVENING_FROM), seed)
  const morning = seededShuffle(free.filter(s => toMin(s) < EVENING_FROM), seed + 1)

  // פיזור בין שתי המשמרות. שתיהן באורך זהה (9 סלוטים כל אחת), וההטיה
  // לערב נשמרת כפי שהייתה — היא מכוונת, הערב מבוקש יותר.
  const targetMorning = 3
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

  // איחוד עם הזמינות המיוחדת (אם התאריך נופל גם בטווח ההזמנה וגם בחלון
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

/** מה הלקוחה רואה בפועל מתוך קבוצת סלוטים, לפי משך הטיפול */
function displayedFor(visible: string[], durationMin: number): string[] {
  return durationMin > SLOT_DURATION ? filterLiftingStarts(visible) : visible
}

/**
 * סדר החשיפה ההדרגתית — איזה סלוט מהמאגר לחשוף הבא.
 *
 * שתי עדיפויות בלבד, ובכוונה לא יותר מזה:
 *   1. סלוט שצמוד לסלוט שכבר מוצג. הוא זה שמייצר שעת התחלה חוקית חדשה
 *      לטיפול של 40 דק' — ולכן זה בדיוק המקרה שבו התצוגה "נתקעת" על
 *      2-3 אפשרויות למרות שהיום כמעט ריק.
 *   2. כל השאר, לסירוגין ערב/בוקר, כדי שהתוספת לא תתרכז כולה במשמרת אחת
 *      ותשמור על הפיזור בין 09:00–12:00 ל-16:00–19:00.
 *
 * שתי הקבוצות מעורבבות עם אותו ערבוב מבוסס-זרע של שאר האלגוריתם, כך
 * שהתוצאה יציבה לתאריך: ריענון הדף לא מזיז את השעות.
 */
function revealOrder(pool: string[], visible: string[], seed: number): string[] {
  const touches = (s: string) =>
    visible.includes(minToHHMM(toMin(s) + SLOT_DURATION)) ||
    visible.includes(minToHHMM(toMin(s) - SLOT_DURATION))

  const adjacent = seededShuffle(pool.filter(touches), seed + 5)
  const restEvening = seededShuffle(pool.filter(s => !touches(s) && toMin(s) >= EVENING_FROM), seed + 6)
  const restMorning = seededShuffle(pool.filter(s => !touches(s) && toMin(s) < EVENING_FROM), seed + 7)

  const interleaved: string[] = []
  for (let i = 0; i < Math.max(restEvening.length, restMorning.length); i++) {
    if (i < restEvening.length) interleaved.push(restEvening[i])
    if (i < restMorning.length) interleaved.push(restMorning[i])
  }
  return [...adjacent, ...interleaved]
}

/**
 * הסלוטים להצגה בפועל, לפי משך הטיפול, **עם חשיפה הדרגתית**.
 *
 * ── הבעיה שזה פותר ─────────────────────────────────────────────────────
 * ההצגה המצומצמת בוחרת INITIAL_SLOTS סלוטים מפוזרים. כשהזמנות וחסימות
 * אוכלות מהם — ובמיוחד בטיפול של 40 דק', שדורש **שני** סלוטים מוצגים
 * רצופים — היום עלול להיראות כמעט מלא בזמן שנותרו בו שעות חוקיות ופנויות
 * לגמרי שפשוט לא נבחרו להצגה.
 *
 * ── הפתרון ─────────────────────────────────────────────────────────────
 * כל עוד המוצג נמוך מ-MIN_AVAILABLE_SLOTS, חושפים עוד סלוט מהמאגר
 * ובודקים שוב. עוצרים ברגע שהגענו ליעד או שהמאגר נגמר.
 *
 * 🔒 **אין כאן המצאה של שעות.** המאגר הוא `legalFreeSlots` — אותן בדיקות
 * בדיוק שההצגה הרגילה עוברת: רשת שנגזרת משעות העבודה (ולכן הטיפול נכנס
 * כולו במשמרת), טווח 30 יום, חלון ההכנה, ואי-חפיפה מול Google Calendar
 * ומול תורים/pending ב-DB. יום סגור, שבת, חג או יום חסום ביומן מגיעים
 * לכאן עם מאגר ריק, ואז אין מה לחשוף. אם נותרו 3 סלוטים חוקיים — יוצגו 3.
 */
export function selectDisplaySlots(
  params: SelectSlotsParams & { durationMin: number },
): string[] {
  const { durationMin, year, month, day } = params
  let visible = selectVisibleSlots(params)
  let shown = displayedFor(visible, durationMin)
  if (shown.length >= MIN_AVAILABLE_SLOTS) return shown

  const { regular, special } = legalFreeSlots(params)
  const pool = [...regular, ...special].filter(s => !visible.includes(s))
  const seed = dateSeed(year, month, day)

  // ⚠️ סדר החשיפה מחושב מחדש בכל סיבוב: סלוט שנחשף זה עתה יוצר צמידויות
  // חדשות, ובלי החישוב מחדש התוספת הבאה לא הייתה מנצלת אותן.
  let remaining = pool
  while (remaining.length > 0 && shown.length < MIN_AVAILABLE_SLOTS) {
    const next = revealOrder(remaining, visible, seed)[0]
    visible = [...visible, next].sort((a, b) => toMin(a) - toMin(b))
    remaining = remaining.filter(s => s !== next)
    shown = displayedFor(visible, durationMin)
  }
  return shown
}
