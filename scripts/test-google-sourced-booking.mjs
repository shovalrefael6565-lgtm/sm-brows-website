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

  /*
   * ⚠️ ההזזה הישירה אינה הדרך היחידה שהמועד יכול לזוז: אישור בקשת שינוי
   * מועד של הלקוחה עושה בדיוק אותו דבר. אילו רק ה-route הראשון היה חסום,
   * הכלל היה נשבר במסלול השני בלי שאיש ישים לב.
   */
  const approve = src('app/api/admin/appointments/[id]/reschedule-approve/route.ts')
  chk('אישור בקשת שינוי מועד חסום גם הוא לתור נעול', approve.includes('isGoogleTimeLocked'))
  chk('והנעילה נבדקת על התור המקורי ולא על שורת הבקשה',
    approve.includes('requestRow.reschedule_of_appointment_id'))

  const selfService = src('lib/appointmentSelfService.ts')
  chk('הלקוחה אינה יכולה לפתוח בקשה על תור נעול', selfService.includes('isGoogleTimeLocked'))
  chk('ומקבלת הצעה לפנות בוואטסאפ במקום מבוי סתום',
    /isGoogleTimeLocked[\s\S]{0,400}offerWhatsApp: true/.test(selfService))
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
section('12 · 🔓 15J — כל טיפול ידני זכאי לאמץ אירוע')
// ════════════════════════════════════════════════════════════════════════════
//
// עד 15J החזירה supportsGoogleSourcedSlot false לעיצוב גבות ולהרמת גבות,
// ואירוע יומן פנוי לחלוטין לא היה ניתן לקישור לשום טיפול אחר. זו הייתה
// התקלה, ולא הגנה.

{
  chk('מיקרובליידינג זכאי', supportsGoogleSourcedSlot(MICROBLADING_SERVICE) === true)
  chk('ייעוץ מיקרובליידינג זכאי', supportsGoogleSourcedSlot(MICROBLADING_CONSULT_SERVICE) === true)
  chk('עיצוב גבות טבעיות זכאי', supportsGoogleSourcedSlot(NATURAL_SERVICE) === true)
  chk('הרמת גבות זכאית', supportsGoogleSourcedSlot(LIFTING_SERVICE) === true)
  chk('ערך שאינו מחרוזת אינו זכאי', supportsGoogleSourcedSlot(undefined) === false)
  chk('טיפול שאינו בקטלוג כלל אינו זכאי', supportsGoogleSourcedSlot('קורס מקצועי') === false)

  // 🔓 טיפול ציבורי מגיע עד קריאת האירוע ומאמץ אותו, בדיוק כמו ניהולי.
  const { deps, calls } = mkDeps()
  const res = await resolveAdoptedGoogleSlot(NATURAL_SERVICE, EV, deps)
  chk('עיצוב גבות טבעיות מאמץ את האירוע', res.ok === true)
  chk('והמועד נגזר מהיומן', res.ok && fmtIsrael(res.data.startsAt) === '10:20')
  chk('והיומן אכן נקרא', calls.reads === 1)

  // הבדיקה על ה-service_key עדיין נאכפת בתוך הפונקציה שכותבת, ולא רק ב-route.
  chk(
    'createManualAppointment בודקת את ה-service_key בעצמה',
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
  chk('אירוע של 4 דקות נדחה (מתחת ל-5)', !short.ok && short.error === 'adopt_event_duration')

  const long = googleEventToSlot({
    eventId: EV, summary: '', start: israelWallTimeToUtc(DATE, '08:00'),
    end: israelWallTimeToUtc(DATE, '17:00'),
  })
  chk('אירוע של 9 שעות נדחה (מעל 480)', !long.ok && long.error === 'adopt_event_duration')

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

// ════════════════════════════════════════════════════════════════════════════
section('15J · כל אירוע לא-מקושר ניתן לבחירה, בכל טיפול')
// ════════════════════════════════════════════════════════════════════════════
//
// ─── התקלה שהבדיקות האלה נועדו למנוע מלחזור ─────────────────────────────────
//
// אירוע ביומן הופיע ברשימה אבל לא היה ניתן לקישור. הסיבות שנמצאו בקוד היו
// כולן חיצוניות לשאלה "האם האירוע פנוי": סוג הטיפול, חפיפה עם אירוע יומן
// אחר, וכשל בקריאת היומן. שלושתן ירדו. מה שנשאר חוסם הוא **רק** מה שה-DB
// עצמו אוסר, ומה שחוסם קישור בכלל הוא **רק** אירוע ששייך כבר לתור אחר.

/** כל טיפול שאפשר לקבוע ידנית באדמין */
const EVERY_MANUAL_SERVICE = [
  MICROBLADING_CONSULT_SERVICE,   // 1 · ייעוץ — המקרה שדווח
  MICROBLADING_SERVICE,           // 2
  NATURAL_SERVICE,                // 3
  LIFTING_SERVICE,                // 4
]

{
  // ── 1–4 · כל טיפול ידני יכול לאמץ אירוע לא-מקושר ──────────────────────
  for (const svc of EVERY_MANUAL_SERVICE) {
    const { deps } = mkDeps({ event: mkEvent('10:20', '11:20') })
    const res = await resolveAdoptedGoogleSlot(svc, EV, deps)
    chk(`«${svc}» מאמץ אירוע פנוי`,
      res.ok && fmtIsrael(res.data.startsAt) === '10:20' && res.data.durationMin === 60)
  }

  // ── והאירוע אכן מוצג לבחירה, בלי תלות בטיפול ──────────────────────────
  const listed = await listAdoptableEventsForDate(DATE, mkDeps({
    list: [{ eventId: EV, summary: 'ייעוץ מיקרובליידינג - טלייה',
             start: israelWallTimeToUtc(DATE, '10:20').toISOString(),
             end: israelWallTimeToUtc(DATE, '11:20').toISOString(), durationMin: 60 }],
  }).deps)
  chk('אירוע פנוי מופיע ברשימה', listed.ok && listed.events.length === 1)

  // ── 5 · אירוע אחרי שעות הפעילות ────────────────────────────────────────
  const night = mkDeps({ event: mkEvent('20:30', '21:30') })
  const nightSlot = await resolveAdoptedGoogleSlot(MICROBLADING_CONSULT_SERVICE, EV, night.deps)
  chk('אירוע 20:30–21:30 ניתן לאימוץ',
    nightSlot.ok && nightSlot.data.startTime === '20:30' && nightSlot.data.endTime === '21:30')
  const nightWarn = manualSlotWarnings(nightSlot.data.startsAt, nightSlot.data.endsAt)
  chk('והמערכת מסמנת אותו כחריג — כאזהרה', nightWarn.outsideBusinessHours === true)
  // האזהרה אינה תנאי: הטופס מבקש אישור חריגה רק כשאין אירוע.
  chk('הטופס אינו דורש אישור חריגה כשיש אירוע',
    src('components/admin/NewAppointmentForm.tsx').includes('!googleSlot &&'))

  // ── 6 · כותרת שאינה תואמת את הטיפול ────────────────────────────────────
  const odd = mkDeps({ event: mkEvent('10:20', '11:20', { summary: 'פגישה עם רואה החשבון' }) })
  const oddRes = await resolveAdoptedGoogleSlot(NATURAL_SERVICE, EV, odd.deps)
  chk('כותרת שאינה קשורה לטיפול אינה חוסמת', oddRes.ok === true)
  const blank = mkDeps({ event: mkEvent('10:20', '11:20', { summary: '' }) })
  chk('גם אירוע בלי כותרת בכלל',
    (await resolveAdoptedGoogleSlot(LIFTING_SERVICE, EV, blank.deps)).ok === true)

  // ── 7 · משך שונה מהקטלוג — Google מנצח ────────────────────────────────
  const catalog = resolveManualService(NATURAL_SERVICE, ['עיצוב גבות טבעי'], {})
  chk('בקטלוג עיצוב גבות טבעיות הוא 20 דקות', catalog.ok && catalog.data.durationMin === 20)
  const won = applyGoogleSourcedSlot(
    { startsAt: israelWallTimeToUtc(DATE, '10:30'), endsAt: israelWallTimeToUtc(DATE, '10:50'),
      durationMin: catalog.data.durationMin },
    oddRes.data,
  )
  chk('משך האירוע (60) דורס את הקטלוג (20)', won.durationMin === 60)
  chk('והדגל דולק', won.googleSourced === true)
  // ה-route מציג ושולח את משך האירוע, ולא את זה של הקטלוג.
  chk('route הזמינות מציג את משך האירוע',
    src('app/api/admin/appointments/availability/route.ts')
      .includes('const durationMin = adopted ? adopted.durationMin : service.data.durationMin'))
  chk('route היצירה שולח את משך האירוע',
    src('app/api/admin/appointments/route.ts')
      .includes('durationMin: adopted ? adopted.durationMin : service.data.durationMin'))

  // ── 8 · שעה אחרת הוקלדה בטופס — Google מנצח ───────────────────────────
  chk('שעת הטופס (10:30) נדרסת ע"י האירוע (10:20)', fmtIsrael(won.startsAt) === '10:20')
  chk('גם הסיום', fmtIsrael(won.endsAt) === '11:20')

  // ── 9 · אין שעה בטופס בכלל ─────────────────────────────────────────────
  // שני ה-routes דורשים שעה **רק** כשאין אירוע מאומץ.
  for (const route of ['app/api/admin/appointments/route.ts',
                       'app/api/admin/appointments/availability/route.ts']) {
    chk(`${route.split('/').slice(-2).join('/')} אינו דורש שעה כשיש אירוע`,
      src(route).includes('(!adopted && !TIME_RE.test(time))'))
  }
  chk('והטופס אינו דורש שעה כשנבחר אירוע',
    src('components/admin/NewAppointmentForm.tsx')
      .includes('const slotReady = googleMode ? Boolean(isoDate) : Boolean(isoDate && time)'))

  // ── 10 · אירוע שכבר מקושר — החסימה היחידה ──────────────────────────────
  const takenByProps = mkDeps({ event: mkEvent('10:20', '11:20', { appointmentId: 'other-appt' }) })
  chk('אירוע עם חתימת מערכת אינו ניתן לאימוץ',
    (await resolveAdoptedGoogleSlot(MICROBLADING_CONSULT_SERVICE, EV, takenByProps.deps)).error
      === 'adopt_event_taken')
  const takenByDb = mkDeps({ linked: new Set([EV]) })
  chk('ואירוע שמופיע ב-appointments.google_event_id',
    (await resolveAdoptedGoogleSlot(NATURAL_SERVICE, EV, takenByDb.deps)).error === 'adopt_event_taken')
  const hidden = await listAdoptableEventsForDate(DATE, mkDeps({
    linked: new Set([EV]),
    list: [{ eventId: EV, summary: 'תור קיים',
             start: israelWallTimeToUtc(DATE, '10:20').toISOString(),
             end: israelWallTimeToUtc(DATE, '11:20').toISOString(), durationMin: 60 }],
  }).deps)
  chk('ואינו מוצג ברשימה כלל', hidden.ok && hidden.events.length === 0)

  // ── 11 · לא נוצר אירוע נוסף ביומן ──────────────────────────────────────
  const gcal = src('lib/googleCalendar.ts')
  const adoptFn = gcal.slice(gcal.indexOf('export async function adoptExistingCalendarEvent'))
    .slice(0, gcal.slice(gcal.indexOf('export async function adoptExistingCalendarEvent')).indexOf('\n}\n') + 3)
  chk('האימוץ אינו קורא ל-events.insert', !/events\.insert/.test(adoptFn))
  chk('האימוץ הוא patch על extendedProperties בלבד',
    /events\.patch/.test(adoptFn) && !/\bstart:/.test(adoptFn) && !/\bend:/.test(adoptFn))

  // ── 12 · תזכורות לפי ה-start של Google ─────────────────────────────────
  // מה שנכתב ל-DB הוא slot.startsAt שאחרי הדריסה, והתזכורות נגזרות
  // מ-appointments.starts_at עצמו — ולכן מהמועד של האירוע.
  const booking = src('lib/adminBooking.ts')
  chk('ה-RPC מקבל את המועד שאחרי הדריסה',
    booking.includes('p_starts_at: slot.startsAt.toISOString()') &&
    booking.includes('p_duration_min: slot.durationMin'))
  chk('גם ה-fingerprint מחושב על המועד שאחרי הדריסה',
    booking.indexOf('const slot = applyGoogleSourcedSlot') <
    booking.indexOf('const fingerprint = appointmentCreateFingerprint'))
  const reminders = src('supabase/migrations/0011_appointment_reminders.sql')
  chk('התזכורות נגזרות מ-appointments.starts_at',
    reminders.includes('public.reminder_scheduled_for(v_kind, v_appt.starts_at, v_now)'))
  chk('ו-snapshot אחד לכל starts_at — בלי כפילויות',
    reminders.includes('on conflict (appointment_id, reminder_kind, appointment_starts_at)'))
  chk('וחלון שכבר עבר נשמר כ-window_passed_at_creation',
    reminders.includes("v_reason := 'window_passed_at_creation'"))

  // ── 13 · ההזמנה הציבורית ─────────────────────────────────────────────
  chk('עיצוב גבות טבעיות עדיין ציבורי ובן 20 דקות',
    isBookableService(NATURAL_SERVICE) && catalog.data.durationMin === 20)
  chk('הרמת גבות עדיין ציבורית ובת 40 דקות', (() => {
    const l = resolveManualService(LIFTING_SERVICE, [], {})
    return isBookableService(LIFTING_SERVICE) && l.ok && l.data.durationMin === 40
  })())
}

// ════════════════════════════════════════════════════════════════════════════
section('15J · מה כן חוסם, ומה הפסיק לחסום')
// ════════════════════════════════════════════════════════════════════════════

{
  const booking = src('lib/adminBooking.ts')

  // חפיפה עם אירוע יומן אחר — אזהרה, לא חסימה.
  chk('חפיפה ביומן באימוץ מפורש מוחזרת כ-calendarOverlap',
    booking.includes('if (explicitAdoption) return { available: true, calendarOverlap: overlap }'))
  // כשל בקריאת היומן — מפסיק לחסום אימוץ מפורש.
  chk('כשל יומן אינו חוסם אימוץ מפורש',
    booking.includes("if (!explicitAdoption) return { available: false, reason: 'calendar_unavailable' }"))
  // שני ה-routes מעבירים את הדגל.
  chk('route הזמינות מסמן אימוץ מפורש',
    src('app/api/admin/appointments/availability/route.ts').includes('Boolean(adopted),'))
  chk('createManualAppointment מסמנת אימוץ מפורש',
    booking.includes('Boolean(adoptEventId),'))

  // ⚠️ שתי החסימות שנשארו אינן מדיניות של האתר אלא של ה-DB עצמו, ולכן
  // אסור שיירדו כאן בלי מיגרציה: הן היו מפילות את ה-INSERT ממילא.
  const rpc = src('supabase/migrations/0018_public_booking_rpcs.sql')
  chk('ה-RPC עדיין אוסר מועד שעבר', rpc.includes("raise exception 'START_IN_PAST'"))
  chk('ה-EXCLUDE constraint עדיין אוסר חפיפת תורים',
    src('supabase/migrations/0001_customer_accounts.sql')
      .includes('exclude using gist (tstzrange(starts_at, ends_at) with &&)'))
  chk('ולכן שתיהן נשארות חסימה גם באימוץ',
    booking.includes("if (availability.reason === 'past') return { ok: false, error: 'start_in_past' }") &&
    booking.includes("return { ok: false, error: 'slot_taken' }"))
  // ...אבל עם הסבר, ולא כמסך ריק.
  const form = src('components/admin/NewAppointmentForm.tsx')
  chk('ולמנהלת מוצג הסבר מה לעשות', form.includes('ADOPT_BLOCK_LABELS'))
  chk('וכשל של בדיקת הזמינות אינו משאיר מסך ריק',
    form.includes('setAvailabilityError') && form.includes('{availabilityError && !checking && ('))

  // הרשימה והבחירה אינן תלויות בטיפול בשום מקום.
  chk('route האירועים אינו בודק טיפול',
    !src('app/api/admin/appointments/calendar-events/route.ts').includes('supportsGoogleSourcedSlot'))
  chk('הטופס טוען אירועים לפי תאריך בלבד', form.includes('}, [isoDate])'))
  chk('והרשימה מוצגת לכל טיפול', form.includes('{isoDate && (') && !form.includes('{adminService && isoDate && ('))
  chk('googleMode אינו תלוי בטיפול', form.includes('const googleMode = Boolean(adoptEventId)'))
  // אף radio ברשימה אינו disabled.
  chk('אין disabled על אירוע ברשימה',
    !/name="adoptEvent"[\s\S]{0,320}?disabled/.test(form))
}

// ════════════════════════════════════════════════════════════════════════════
section('15L · ההודעה אומרת איזה תור חוסם')
// ════════════════════════════════════════════════════════════════════════════
//
// ─── התקלה שהבדיקות האלה נועדו למנוע מלחזור ─────────────────────────────────
//
// "קיים כבר תור אחר במערכת בשעות האלה" נכון — ולא ניתן לפעול לפיו. רשימת
// התורים מציגה 20 תורים לעמוד על פני כל התאריכים, ולכן תור בעוד שבועיים
// יושב כמה עמודים פנימה. שובל נשארה מול הודעה שמספרת שקיים תור, בלי לדעת
// של מי ובלי למצוא אותו — וחיפשה בעיוור.

{
  const { formatBlockingAppointment } = await import('../lib/admin/format.ts')

  const view = formatBlockingAppointment({
    id: 'f5f9548a-3cda-4c61-9124-f1f8b5a99fc5',
    customerId: '8680a691-61dd-4f82-8f0a-7ec21fda8ebe',
    customerName: 'שחר שדי',
    serviceKey: NATURAL_SERVICE,
    variants: ['עיצוב גבות טבעי'],
    startsAt: israelWallTimeToUtc('2026-08-31', '17:00').toISOString(),
    endsAt: israelWallTimeToUtc('2026-08-31', '17:20').toISOString(),
    status: 'confirmed',
  })

  chk('שם הלקוחה מוחזר', view.customerName === 'שחר שדי')
  chk('הטיפול מתורגם לתווית', view.treatment === 'עיצוב גבות טבעיות', view.treatment)
  chk('התאריך בשעון ישראל', view.isoDate === '2026-08-31', view.isoDate)
  // ⚠️ הלב של התקלה: שעה שמוצגת לפי אזור זמן אחר שולחת לחפש תור שלא קיים.
  chk('השעה בשעון ישראל ולא UTC', view.startTime === '17:00' && view.endTime === '17:20',
    `${view.startTime}–${view.endTime}`)
  chk('הסטטוס עובר כמות שהוא', view.status === 'confirmed')
  chk('מזהה הלקוחה עובר, לקישור לכרטיס', view.customerId?.startsWith('8680a691'))

  // תור ניהולי בלי תוספות — התווית היא שם הטיפול עצמו.
  const consult = formatBlockingAppointment({
    id: 'x', customerId: null, customerName: '', serviceKey: MICROBLADING_CONSULT_SERVICE,
    variants: [],
    startsAt: israelWallTimeToUtc('2026-08-31', '17:00').toISOString(),
    endsAt: israelWallTimeToUtc('2026-08-31', '17:20').toISOString(),
    status: 'pending',
  })
  chk('טיפול ניהולי מקבל את שמו', consult.treatment === MICROBLADING_CONSULT_SERVICE)
  chk('לקוחה בלי שם אינה מפילה את המיפוי', consult.customerName === '')
  chk('ובלי customerId — הקישור לכרטיס פשוט לא יוצג', consult.customerId === null)

  // ── השרת: השאילתה בוחרת את מה שדרוש לזיהוי, והתשובה מחזירה אותו ──────
  const booking = src('lib/adminBooking.ts')
  chk('שאילתת החפיפה בוחרת את שם הלקוחה',
    booking.includes("'id, customer_id, service_key, variants, starts_at, ends_at, status, customers(full_name)'"))
  chk('התנאי לא השתנה — אותה חפיפה שה-EXCLUDE אוכף',
    booking.includes(".lt('starts_at', endsAt.toISOString())") &&
    booking.includes(".gt('ends_at', startsAt.toISOString())"))
  chk('רק תורים פעילים חוסמים', booking.includes(".in('status', ['pending', 'confirmed'])"))
  chk('מוחזרים כמה תורים, לא רק אחד', booking.includes('.limit(5)'))
  chk('ה-route מחזיר אותם מפורמטים',
    src('app/api/admin/appointments/availability/route.ts')
      .includes('.map(formatBlockingAppointment)'))

  // 🔒 כשל בקריאת ה-DB אינו "קיים תור אחר".
  chk('כשל DB חוסם עם רשימה ריקה',
    booking.includes("return { available: false, reason: 'db_conflict', blocking: [] }"))
  const form = src('components/admin/NewAppointmentForm.tsx')
  chk('והטופס אומר "לא הצלחנו לבדוק" ולא "קיים תור"',
    form.includes("availability.blocking.length === 0") &&
    form.includes('לא הצלחנו לבדוק מול התורים הקיימים כרגע.'))

  // ── הטופס: שם, מועד, וקישור שמגיע לתור ──────────────────────────────
  chk('הטופס מציג את שם הלקוחה החוסמת', form.includes('{b.customerName || '))
  chk('ואת המועד המדויק', form.includes('{b.startTime}–{b.endTime}'))
  chk('ומקשר לרשימת התורים לפי שם',
    form.includes('/admin/appointments?q=${encodeURIComponent(b.customerName)}'))
  chk('ומקשר לכרטיס הלקוחה', form.includes('/admin/customers/${b.customerId}'))
  chk('כמה תורים חוסמים מוצגים כרשימה', form.includes('availability.blocking.map(b => ('))

  // ⚠️ מידע מינימלי בלבד — הטלפון וההערות אינם עוברים במסלול הזה.
  const blockingSelect = /\.select\('id, customer_id, service_key[^']*'\)/.exec(booking)?.[0] ?? ''
  chk('שאילתת החסימה אינה בוחרת טלפון', blockingSelect !== '' && !blockingSelect.includes('phone'))
  chk('ואינה בוחרת הערות', blockingSelect !== '' && !blockingSelect.includes('note'))
  const view2 = Object.keys(view)
  chk('רק שדות זיהוי מוחזרים',
    view2.every(k => ['id','customerId','customerName','treatment','isoDate','startTime','endTime','status'].includes(k)),
    view2.join(','))
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} עברו, ${fail} נכשלו`)
process.exit(fail === 0 ? 0 : 1)
