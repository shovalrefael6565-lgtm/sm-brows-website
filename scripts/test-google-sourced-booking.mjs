/**
 * 15I — "Google הוא מקור האמת למועד" בתור ידני של מיקרובליידינג.
 *
 * ─── התקלה שהבדיקות האלה נועדו למנוע מלחזור ─────────────────────────────────
 *
 * האימוץ ("זה אותו תור") קישר את האירוע הקיים ביומן — אבל שמר את המועד
 * שהוקלד בטופס. אירוע 10:20–11:20 שאומץ מול הקלדה של 10:30 נשמר במערכת
 * כ-10:30, והיומן נשאר 10:20. שני מועדים לאותו תור, בלי ששום מסך סתר את
 * זה, ועם תזכורות שיוצאות לפי המועד השגוי.
 *
 * הבדיקות כאן מוכיחות את הכלל בשני מישורים:
 *
 *   • **התנהגות** — הפונקציות הטהורות והמוזרקות: מה נגזר מהאירוע, מה דורס
 *     את הטופס, מה נדחה, ומה נשאר מחוץ לחריגה.
 *   • **מבנה** — קביעות שאי אפשר לבטא כקריאה יחידה: שהמסלול המאומץ אינו
 *     יוצר אירוע, שה-patch אינו נוגע בשעות, ושהזרימה הציבורית לא נגעה.
 *
 * אפס רשת, אפס DB, אפס Google. כל התלויות מוזרקות.
 *
 * הרצה:  npm run test:google-sourced-booking
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

let pass = 0, fail = 0
const chk = (name, ok = true, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = p => readFileSync(join(ROOT, p), 'utf8')

const {
  supportsGoogleSourcedSlot, googleEventToSlot, applyGoogleSourcedSlot,
  resolveAdoptedGoogleSlot, listAdoptableEventsForDate,
  manualSlotWarnings, manualSlotInstants, resolveManualService,
} = await import('../lib/adminBooking.ts')

const { isGoogleTimeLocked, deterministicEventId } = await import('../lib/calendarLink.ts')
const { israelWallTimeToUtc, fmtIsrael, israelDateStr } = await import('../lib/israelTime.ts')
const {
  MICROBLADING_SERVICE, MICROBLADING_CONSULT_SERVICE,
  NATURAL_SERVICE, LIFTING_SERVICE, isBookableService,
} = await import('../lib/services.ts')

const DATE = '2026-08-24'
const EV = 'shovalevent0001'

/** אירוע ביומן, בדיוק בצורה ש-readCalendarEvent מחזירה */
const mkEvent = (startHHMM, endHHMM, over = {}) => ({
  eventId: EV,
  appointmentId: null,
  summary: 'מיקרובליידינג רותי',
  start: israelWallTimeToUtc(DATE, startHHMM),
  end: israelWallTimeToUtc(DATE, endHHMM),
  ...over,
})

/** תלויות מזויפות. reads סופר כמה פעמים באמת פנינו ל"יומן". */
function mkDeps({ event = mkEvent('10:20', '11:20'), missing = false, linked = new Set(), list = [] } = {}) {
  const calls = { reads: 0, lists: 0 }
  return {
    calls,
    deps: {
      readEvent: async () => {
        calls.reads++
        return missing ? { ok: false, reason: 'gone' } : { ok: true, event }
      },
      listEvents: async () => { calls.lists++; return list },
      linkedEventIds: async () => linked,
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('2 · Google 10:20–11:20 מול שעה אחרת בטופס')
// ════════════════════════════════════════════════════════════════════════════

{
  const { deps } = mkDeps({ event: mkEvent('10:20', '11:20') })
  const res = await resolveAdoptedGoogleSlot(MICROBLADING_SERVICE, EV, deps)
  chk('האירוע נפתר בהצלחה', res.ok, res.ok ? '' : res.error)

  const slot = res.ok ? res.data : null
  chk('התאריך נלקח מהאירוע', slot?.isoDate === DATE, slot?.isoDate)
  chk('שעת ההתחלה נלקחה מהאירוע', slot?.startTime === '10:20', slot?.startTime)
  chk('שעת הסיום נלקחה מהאירוע', slot?.endTime === '11:20', slot?.endTime)
  chk('המשך הוא end − start ולא ברירת מחדל של הטיפול', slot?.durationMin === 60, String(slot?.durationMin))

  // ⚠️ לב הבדיקה: הטופס הזין 10:30 ו-150 דקות — בדיוק המצב שיצר את התקלה.
  const form = manualSlotInstants(DATE, '10:30', 150)
  const applied = applyGoogleSourcedSlot(
    { startsAt: form.startsAt, endsAt: form.endsAt, durationMin: 150 }, slot,
  )
  chk('מה שהוזן בטופס (10:30) לא שרד', fmtIsrael(applied.startsAt) === '10:20', fmtIsrael(applied.startsAt))
  chk('שעת הסיום היא של האירוע', fmtIsrael(applied.endsAt) === '11:20', fmtIsrael(applied.endsAt))
  chk('המשך שנשמר הוא 60 ולא 150', applied.durationMin === 60, String(applied.durationMin))
  chk('התאריך שנשמר הוא של האירוע', israelDateStr(applied.startsAt) === DATE)
  chk('הדגל מסמן שהמועד מ-Google', applied.googleSourced === true)
}

// ════════════════════════════════════════════════════════════════════════════
section('3 · אירוע אחרי שעות הפעילות')
// ════════════════════════════════════════════════════════════════════════════

{
  // שעות הפעילות מסתיימות ב-19:00. האירוע 20:30–21:30 חורג מהן לגמרי.
  const { deps } = mkDeps({ event: mkEvent('20:30', '21:30') })
  const res = await resolveAdoptedGoogleSlot(MICROBLADING_SERVICE, EV, deps)
  chk('אירוע מחוץ לשעות הפעילות נפתר בהצלחה', res.ok, res.ok ? '' : res.error)

  const slot = res.ok ? res.data : null
  chk('המועד נשמר כפי שהוא ביומן', slot?.startTime === '20:30' && slot?.endTime === '21:30')
  chk('המשך 60 דקות', slot?.durationMin === 60)

  // ⚠️ האזהרה עדיין מחושבת — אבל היא מידע ולא שער. הטופס אינו דורש אישור
  // חריגה כשיש googleSlot, וה-route אינו בודק שעות פעילות בכלל.
  const w = manualSlotWarnings(slot.startsAt, slot.endsAt)
  chk('האזהרה על חריגה משעות הפעילות עדיין מדווחת', w.outsideBusinessHours === true)

  const form = src('components/admin/NewAppointmentForm.tsx')
  chk(
    'הטופס אינו דורש אישור חריגה כשהמועד מגיע מהיומן',
    /const needsAck = Boolean\(\s*\n\s*!googleSlot &&/.test(form),
  )
}

// ════════════════════════════════════════════════════════════════════════════
section('4 · אין צורך להזין שעה או משך כשנבחר אירוע')
// ════════════════════════════════════════════════════════════════════════════

{
  // בלי אירוע, המשך הוא שדה חובה בטיפול ניהולי — זו ההתנהגות הקיימת.
  const without = resolveManualService(MICROBLADING_SERVICE, [], {})
  chk('בלי אירוע — משך חסר נדחה', !without.ok && without.error === 'invalid_duration')

  // עם אירוע, המשך מגיע מ-Google והשרת מזין אותו בעצמו.
  const withGoogle = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: 60 })
  chk('עם אירוע — המשך של היומן מתקבל', withGoogle.ok && withGoogle.data.durationMin === 60)

  const create = src('app/api/admin/appointments/route.ts')
  const avail = src('app/api/admin/appointments/availability/route.ts')
  chk(
    'route היצירה אינו דורש שעה כשיש אירוע מאומץ',
    create.includes('(!adopted && !TIME_RE.test(time))'),
  )
  chk(
    'route הזמינות אינו דורש שעה כשיש אירוע מאומץ',
    avail.includes('(!adopted && !TIME_RE.test(time))'),
  )
  chk(
    'המשך שנשלח מהטופס מוחלף במשך של האירוע',
    create.includes('durationMin: adopted ? adopted.durationMin : body.durationMin'),
  )
  chk(
    'הטופס אינו שולח שעה כשהמועד מהיומן',
    src('components/admin/NewAppointmentForm.tsx').includes('time: googleMode ? undefined : time'),
  )
}

// ════════════════════════════════════════════════════════════════════════════
section('5 · המועד נעול אחרי הקישור')
// ════════════════════════════════════════════════════════════════════════════

{
  const apptId = '7f2b1c40-2a1d-4d5e-8f9a-0b1c2d3e4f50'
  chk('בלי אירוע ביומן — לא נעול', isGoogleTimeLocked(apptId, null) === false)
  chk(
    'אירוע שהמערכת יצרה (מזהה דטרמיניסטי) — לא נעול',
    isGoogleTimeLocked(apptId, deterministicEventId(apptId)) === false,
  )
  chk('אירוע של שובל שאומץ — נעול', isGoogleTimeLocked(apptId, 'shovalevent0001') === true)

  const route = src('app/api/admin/appointments/[id]/reschedule/route.ts')
  chk('route ההזזה חוסם תור נעול', route.includes('isGoogleTimeLocked'))
  chk('ומחזיר calendar_time_locked', route.includes('calendar_time_locked'))
  chk(
    'רשימת התורים מסתירה את כפתור ההזזה לתור נעול',
    src('app/admin/(protected)/appointments/page.tsx').includes('canCancel && !googleTimeLocked'),
  )
}

// ════════════════════════════════════════════════════════════════════════════
section('6 · אירוע שכבר מקושר אינו ניתן לאימוץ')
// ════════════════════════════════════════════════════════════════════════════

{
  // (א) האירוע נושא חתימת מערכת של תור אחר
  const signed = mkDeps({ event: mkEvent('10:20', '11:20', { appointmentId: 'other-appt' }) })
  const a = await resolveAdoptedGoogleSlot(MICROBLADING_SERVICE, EV, signed.deps)
  chk('אירוע עם חתימת מערכת נדחה', !a.ok && a.error === 'adopt_event_taken', a.ok ? '' : a.error)

  // (ב) החתימה ביומן נמחקה, אבל ב-DB יש תור שמצביע עליו
  const inDb = mkDeps({ linked: new Set([EV]) })
  const b = await resolveAdoptedGoogleSlot(MICROBLADING_SERVICE, EV, inDb.deps)
  chk('אירוע שמקושר ב-DB נדחה גם בלי חתימה', !b.ok && b.error === 'adopt_event_taken')

  // (ג) האירוע נעלם בין הבחירה לשמירה
  const gone = mkDeps({ missing: true })
  const c = await resolveAdoptedGoogleSlot(MICROBLADING_SERVICE, EV, gone.deps)
  chk('אירוע שנמחק מהיומן נדחה', !c.ok && c.error === 'adopt_event_gone')

  // (ד) ⚠️ כשל DB אינו "אין קישור": במצב הזה אין לאמץ שום דבר.
  const blind = { readEvent: async () => ({ ok: true, event: mkEvent('10:20', '11:20') }),
                  listEvents: async () => [], linkedEventIds: async () => 'unknown' }
  const d = await resolveAdoptedGoogleSlot(MICROBLADING_SERVICE, EV, blind)
  chk('כשל בבדיקת הקישור חוסם ולא מאפשר', !d.ok && d.error === 'calendar_unavailable')

  // (ה) רשימת הגילוי אינה מציגה אירוע מקושר
  const listDeps = {
    readEvent: async () => ({ ok: false, reason: 'gone' }),
    listEvents: async () => ([
      { eventId: 'freeevent0001', summary: 'פנוי', start: '', end: '', durationMin: 60 },
      { eventId: EV, summary: 'תפוס', start: '', end: '', durationMin: 60 },
    ]),
    linkedEventIds: async () => new Set([EV]),
  }
  const list = await listAdoptableEventsForDate(DATE, listDeps)
  chk('רשימת הגילוי מסננת אירוע מקושר', list.ok && list.events.length === 1)
  chk('ומשאירה את הפנוי', list.ok && list.events[0].eventId === 'freeevent0001')

  const listBlind = { ...listDeps, linkedEventIds: async () => 'unknown' }
  const blindList = await listAdoptableEventsForDate(DATE, listBlind)
  chk('כשל DB אינו מציג רשימה "פנויה"', !blindList.ok && blindList.error === 'calendar_unavailable')
}

// ════════════════════════════════════════════════════════════════════════════
section('7 · לא נוצר אירוע Google נוסף')
// ════════════════════════════════════════════════════════════════════════════

{
  const booking = src('lib/adminBooking.ts')
  const adoptFn = booking.slice(booking.indexOf('async function finishWithAdoptedEvent'))

  chk('המסלול המאומץ קורא ל-adoptExistingCalendarEvent', adoptFn.includes('adoptExistingCalendarEvent('))
  chk('ואינו יוצר אירוע', !adoptFn.includes('createAppointmentEvent('))
  chk('ואינו נופל למסלול הסנכרון שיוצר אירוע', !adoptFn.includes('retryCalendarSync('))

  const cal = src('lib/googleCalendar.ts')
  const adoptApi = cal.slice(cal.indexOf('export async function adoptExistingCalendarEvent'))
  chk('האימוץ ביומן הוא patch ולא insert', adoptApi.includes('events.patch(') && !adoptApi.includes('events.insert('))
  // ⚠️ ה-patch נוגע ב-extendedProperties בלבד. שליחת start/end הייתה
  // מכריחה את היומן להסכים עם האתר — בדיוק ההיפך מהכלל.
  const patchBody = adoptApi.slice(adoptApi.indexOf('requestBody:'), adoptApi.indexOf('return { ok: true'))
  chk('ה-patch אינו שולח start', !patchBody.includes('start:'))
  chk('ה-patch אינו שולח end', !patchBody.includes('end:'))
  chk('ה-patch אינו שולח summary', !patchBody.includes('summary:'))

  const listNew = src('lib/googleCalendar.ts')
  const discovery = listNew.slice(listNew.indexOf('export async function listAdoptableCalendarEvents'),
                                 listNew.indexOf('export type CalendarEventReadResult'))
  chk('הגילוי הוא קריאה בלבד', !/events\.(insert|patch|delete)\(/.test(discovery))
}

// ════════════════════════════════════════════════════════════════════════════
section('10 · מצב ידני בלי Google ממשיך לעבוד')
// ════════════════════════════════════════════════════════════════════════════

{
  const form = manualSlotInstants(DATE, '10:30', 150)
  const applied = applyGoogleSourcedSlot(
    { startsAt: form.startsAt, endsAt: form.endsAt, durationMin: 150 }, null,
  )
  chk('בלי אירוע — השעה מהטופס נשמרת', fmtIsrael(applied.startsAt) === '10:30')
  chk('בלי אירוע — המשך מהטופס נשמר', applied.durationMin === 150)
  chk('בלי אירוע — הדגל כבוי', applied.googleSourced === false)

  // הטיפולים הרגילים לא איבדו דבר
  const natural = resolveManualService(NATURAL_SERVICE, ['עיצוב גבות טבעי'], {})
  chk('עיצוב גבות טבעיות עדיין נפתר מהקטלוג', natural.ok && natural.data.durationMin === 20)
  const lifting = resolveManualService(LIFTING_SERVICE, [], {})
  chk('הרמת גבות עדיין נפתרת מהקטלוג', lifting.ok && lifting.data.durationMin === 40)
}

// ════════════════════════════════════════════════════════════════════════════
section('11 · ההזמנה הציבורית לא השתנתה')
// ════════════════════════════════════════════════════════════════════════════

{
  const publicSources = [
    'app/api/bookings/request/route.ts',
    'app/api/bookings/slots/route.ts',
    'app/api/appointments/route.ts',
    'lib/bookingAvailability.ts',
  ]
  const leaked = publicSources.filter(p => {
    const s = src(p)
    return /adoptCalendarEventId|resolveAdoptedGoogleSlot|supportsGoogleSourcedSlot|applyGoogleSourcedSlot/.test(s)
  })
  chk('אף מסלול ציבורי אינו מכיר את זרימת האימוץ', leaked.length === 0, leaked.join(', '))
  chk('מיקרובליידינג עדיין אינו טיפול ציבורי', isBookableService(MICROBLADING_SERVICE) === false)
  chk('ייעוץ מיקרובליידינג עדיין אינו טיפול ציבורי', isBookableService(MICROBLADING_CONSULT_SERVICE) === false)
}

// ════════════════════════════════════════════════════════════════════════════
section('12 · טיפולים אחרים אינם מקבלים את החריגה')
// ════════════════════════════════════════════════════════════════════════════

{
  chk('מיקרובליידינג זכאי', supportsGoogleSourcedSlot(MICROBLADING_SERVICE) === true)
  chk('ייעוץ מיקרובליידינג זכאי', supportsGoogleSourcedSlot(MICROBLADING_CONSULT_SERVICE) === true)
  chk('עיצוב גבות טבעיות אינו זכאי', supportsGoogleSourcedSlot(NATURAL_SERVICE) === false)
  chk('הרמת גבות אינה זכאית', supportsGoogleSourcedSlot(LIFTING_SERVICE) === false)
  chk('ערך שאינו מחרוזת אינו זכאי', supportsGoogleSourcedSlot(undefined) === false)

  // ⚠️ הדחייה קורית **לפני** כל קריאה חיצונית: טיפול ציבורי אינו גורם
  // אפילו לקריאה אחת ליומן.
  const { deps, calls } = mkDeps()
  const res = await resolveAdoptedGoogleSlot(NATURAL_SERVICE, EV, deps)
  chk('טיפול ציבורי נדחה', !res.ok && res.error === 'adopt_not_supported')
  chk('ובלי לפנות ליומן בכלל', calls.reads === 0)

  // גם אם קורא עתידי יעביר adoptedSlot לטיפול ציבורי — הוא לא ייכנס.
  chk(
    'createManualAppointment מסננת adoptedSlot לפי הטיפול',
    src('lib/adminBooking.ts').includes(
      'const adoptedSlot = supportsGoogleSourcedSlot(input.serviceKey) ? (input.adoptedSlot ?? null) : null'),
  )
}

// ════════════════════════════════════════════════════════════════════════════
section('גבולות המשך שנגזר מהיומן')
// ════════════════════════════════════════════════════════════════════════════

{
  const short = googleEventToSlot({
    eventId: EV, summary: '', start: israelWallTimeToUtc(DATE, '10:00'),
    end: new Date(israelWallTimeToUtc(DATE, '10:00').getTime() + 4 * 60000),
  })
  chk('אירוע של 4 דקות נדחה (מתחת ל-5)', !short.ok && short.error === 'adopt_event_invalid')

  const long = googleEventToSlot({
    eventId: EV, summary: '', start: israelWallTimeToUtc(DATE, '08:00'),
    end: israelWallTimeToUtc(DATE, '17:00'),
  })
  chk('אירוע של 9 שעות נדחה (מעל 480)', !long.ok && long.error === 'adopt_event_invalid')

  const edge = googleEventToSlot({
    eventId: EV, summary: '', start: israelWallTimeToUtc(DATE, '10:00'),
    end: israelWallTimeToUtc(DATE, '10:05'),
  })
  chk('אירוע של 5 דקות מתקבל', edge.ok && edge.data.durationMin === 5)

  // אירוע "יום שלם" אין לו טווח שעות — readCalendarEvent מסווגת אותו
  // 'unsupported', וזה מתורגם לשגיאה ברורה ולא לתור שרירותי.
  const allDay = mkDeps()
  allDay.deps.readEvent = async () => ({ ok: false, reason: 'unsupported' })
  const ad = await resolveAdoptedGoogleSlot(MICROBLADING_SERVICE, EV, allDay.deps)
  chk('אירוע יום שלם נדחה', !ad.ok && ad.error === 'adopt_event_invalid')
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} עברו, ${fail} נכשלו`)
process.exit(fail === 0 ? 0 : 1)
