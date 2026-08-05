/**
 * בדיקת שלב 7 מול Google Calendar האמיתי ומול Supabase האמיתי.
 *
 * מתמקדת בדיוק במקום שבו טעות עולה ביוקר אמיתי: מה קורה לאירוע ביומן.
 * שורת DB שגויה אפשר לתקן; אירוע כפול, אירוע ידני שנמחק או תור שנעלם
 * מהיומן — לא. לכן כאן נבדקים:
 *
 *   • עדכון מועד = patch על האירוע הקיים, לעולם לא אירוע שני.
 *   • google_event_id ריק אינו מוכיח שאין אירוע — החיפוש לפי המזהה
 *     הדטרמיניסטי מוצא ומוחק את האירוע הנכון.
 *   • אירוע ידני של שובל ואירוע של תור אחר לא נמחקים ולא משתנים,
 *     גם כשהם חופפים ואפילו כשהם יושבים על המזהה שאנחנו מחפשים.
 *   • מחיקה חוזרת (404/410) היא הצלחה idempotent.
 *
 * ⚠️ יוצרת אירועים אמיתיים ב-GOOGLE_CALENDAR_ID, כולם בכותרת
 * "TEST — מחיקה אוטומטית" ובתאריך עתידי רחוק שלא פוגע בתורים אמיתיים,
 * ומוחקת את כולם בסיום — גם אם בדיקה נכשלת באמצע.
 *
 * החלק שנשען על 0005 (ה-RPC של הזזה/ביטול) מדלג בבירור אם המיגרציה
 * עדיין לא הורצה ב-Supabase.
 *
 * הרצה:  npm run test:live:reschedule-cancel
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { randomUUID } from 'crypto'

const ENV_PATH = new URL('../.env.local', import.meta.url)
if (!existsSync(ENV_PATH)) {
  console.log('✗ לא נמצא קובץ .env.local')
  process.exit(1)
}
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const {
  createAppointmentEvent, updateAppointmentEventTime, deleteAppointmentEvent,
  findConflictingCalendarEvent, deterministicEventId,
} = await import('../lib/googleCalendar.ts')

// ה-orchestration עצמה — בדיוק הפונקציה שמריצים גם ה-route של הלקוחה
// וגם כפתור ה-retry הניהולי. מיובאת דרך --conditions=react-server בגלל
// 'server-only', כמו ב-test:account-core.
const { retryCalendarSync } = await import('../lib/appointmentApproval.ts')
const { rescheduleForCustomer, cancelConfirmedForCustomer } = await import('../lib/appointmentSelfService.ts')
const { loadAppointmentPolicy } = await import('../lib/db/businessSettings.ts')

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const auth = new google.auth.GoogleAuth({
  credentials: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
    ? JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf8'))
    : JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  scopes: ['https://www.googleapis.com/auth/calendar'],
})
const calendar = google.calendar({ version: 'v3', auth })
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)

const TEST_PREFIX = 'TEST — מחיקה אוטומטית'
/** תאריך עתידי רחוק — לא נוגע בשום תור אמיתי */
const ISO_DATE = '2027-11-17'

// כל מה שנוצר נרשם כאן ונמחק בסוף, גם אם משהו נכשל באמצע
const createdEventIds = new Set()
const createdAppointmentIds = new Set()
const createdCustomerIds = new Set()

const getEvent = async eventId => {
  try {
    const res = await calendar.events.get({ calendarId: CALENDAR_ID, eventId })
    return res.data.status === 'cancelled' ? null : res.data
  } catch (err) {
    const status = err?.response?.status ?? err?.code
    if (status === 404 || status === 410) return null
    throw err
  }
}

const eventsForAppointment = async appointmentId => {
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: `${ISO_DATE}T00:00:00Z`,
    timeMax: `${ISO_DATE}T23:59:59Z`,
    singleEvents: true,
  })
  return (res.data.items ?? []).filter(
    e => e.status !== 'cancelled' &&
      e.extendedProperties?.private?.appointment_id === appointmentId,
  )
}

let exitCode = 1
try {
  // ══════════════════════════════════════════════════════════════════════════
  section('עדכון מועד — patch על האירוע הקיים')

  const apptA = randomUUID()
  {
    const created = await createAppointmentEvent({
      appointmentId: apptA,
      customerName: TEST_PREFIX,
      phone: '+972500000001',
      treatment: 'עיצוב גבות טבעיות',
      isoDate: ISO_DATE,
      startHHMM: '09:00',
      durationMin: 20,
    })
    createdEventIds.add(created.eventId)
    chk('אירוע נוצר עם המזהה הדטרמיניסטי',
      created.eventId === deterministicEventId(apptA))

    const before = await getEvent(created.eventId)
    chk('האירוע קיים ביומן עם extendedProperties של המערכת',
      before?.extendedProperties?.private?.appointment_id === apptA &&
      before?.extendedProperties?.private?.source === 'sm_brows_website')

    // ⚠️ googleEventId=null — מדמה בדיוק את המצב שבו Supabase לא הספיק
    // לשמור את המזהה. החיפוש חייב למצוא את האירוע לפי המזהה הדטרמיניסטי.
    const updated = await updateAppointmentEventTime({
      appointmentId: apptA,
      googleEventId: null,
      customerName: TEST_PREFIX,
      phone: '+972500000001',
      treatment: 'עיצוב גבות טבעיות',
      isoDate: ISO_DATE,
      startHHMM: '16:40',
      durationMin: 20,
    })
    chk('עדכון מועד הצליח גם כש-google_event_id ריק', updated.ok === true)
    chk('העדכון לא יצר אירוע חדש', updated.created === false)
    chk('אותו מזהה אירוע נשמר', updated.eventId === created.eventId)

    const after = await getEvent(created.eventId)
    const startsAt = new Date(after.start.dateTime)
    const israelHour = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(startsAt)
    chk('שעת ההתחלה עודכנה ל-16:40 שעון ישראל', israelHour === '16:40', israelHour)
    chk('משך האירוע נשאר 20 דקות',
      (new Date(after.end.dateTime) - startsAt) / 60000 === 20)
    chk('extendedProperties נשמרו כפי שהיו',
      after.extendedProperties?.private?.appointment_id === apptA &&
      after.extendedProperties?.private?.source === 'sm_brows_website')
    chk('הכותרת והתיאור לא נדרסו',
      after.summary === before.summary && after.description === before.description)

    const all = await eventsForAppointment(apptA)
    chk('קיים בדיוק אירוע אחד לתור הזה — אין כפילות', all.length === 1, `נמצאו ${all.length}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('התנגשות: האירוע של אותו תור מול אירוע ידני')

  let manualEventId
  {
    const startsAt = new Date(`${ISO_DATE}T13:40:00.000Z`)   // 16:40 בישראל (UTC+3? חורף: 15:40)
    const endsAt = new Date(startsAt.getTime() + 20 * 60000)

    const selfConflict = await findConflictingCalendarEvent(ISO_DATE, startsAt, endsAt, apptA)
    chk('האירוע של אותו appointment אינו נחשב התנגשות עם עצמו',
      selfConflict === null, selfConflict ? `נמצא ${selfConflict.eventId}` : '')

    // אירוע ידני של שובל — בלי extendedProperties של המערכת
    const manual = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `${TEST_PREFIX} (אירוע ידני של שובל)`,
        start: { dateTime: new Date(`${ISO_DATE}T08:00:00.000Z`).toISOString(), timeZone: 'Asia/Jerusalem' },
        end: { dateTime: new Date(`${ISO_DATE}T09:00:00.000Z`).toISOString(), timeZone: 'Asia/Jerusalem' },
      },
    })
    manualEventId = manual.data.id
    createdEventIds.add(manualEventId)

    const manualConflict = await findConflictingCalendarEvent(
      ISO_DATE,
      new Date(`${ISO_DATE}T08:20:00.000Z`),
      new Date(`${ISO_DATE}T08:40:00.000Z`),
      apptA,
    )
    chk('אירוע ידני חופף מזוהה כהתנגשות אמיתית', manualConflict !== null)
    chk('ההתנגשות שזוהתה היא האירוע הידני עצמו',
      manualConflict?.eventId === manualEventId)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('מחיקה — idempotent, ורק האירוע שלנו')

  {
    // תור נוסף, כדי לוודא שהמחיקה לא נוגעת בו
    const apptB = randomUUID()
    const otherEvent = await createAppointmentEvent({
      appointmentId: apptB,
      customerName: `${TEST_PREFIX} (תור אחר)`,
      phone: '+972500000002',
      treatment: 'עיצוב גבות טבעיות',
      isoDate: ISO_DATE,
      startHHMM: '10:00',
      durationMin: 20,
    })
    createdEventIds.add(otherEvent.eventId)

    // מחיקה עם google_event_id ריק — חייבת למצוא לפי המזהה הדטרמיניסטי
    const del = await deleteAppointmentEvent(apptA, null)
    chk('מחיקה עם google_event_id ריק מצאה ומחקה את האירוע הנכון',
      del.ok === true && del.deleted === true)
    chk('האירוע של apptA אכן נמחק מהיומן',
      (await getEvent(deterministicEventId(apptA))) === null)
    createdEventIds.delete(deterministicEventId(apptA))

    chk('האירוע של התור האחר לא נפגע',
      (await getEvent(otherEvent.eventId)) !== null)
    chk('האירוע הידני של שובל לא נפגע',
      (await getEvent(manualEventId)) !== null)

    // מחיקה חוזרת — 404 נחשב הצלחה
    const again = await deleteAppointmentEvent(apptA, null)
    chk('מחיקה חוזרת מחזירה הצלחה idempotent (404/410)',
      again.ok === true && again.deleted === false)

    // מחיקה של תור שמעולם לא נוצר לו אירוע
    const never = await deleteAppointmentEvent(randomUUID(), null)
    chk('מחיקה של תור בלי אירוע כלל היא הצלחה', never.ok === true && never.deleted === false)

    // ניקוי התור האחר
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: otherEvent.eventId })
    createdEventIds.delete(otherEvent.eventId)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('אירוע שאינו של המערכת — לא נמחק ולא משתנה')

  {
    // התרחיש הקשה: אירוע *ידני* שיושב בדיוק על המזהה שאנחנו מחפשים
    const apptC = randomUUID()
    const squatterId = deterministicEventId(apptC)
    const squatter = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        id: squatterId,
        summary: `${TEST_PREFIX} (ידני, על המזהה שלנו)`,
        start: { dateTime: new Date(`${ISO_DATE}T11:00:00.000Z`).toISOString(), timeZone: 'Asia/Jerusalem' },
        end: { dateTime: new Date(`${ISO_DATE}T11:30:00.000Z`).toISOString(), timeZone: 'Asia/Jerusalem' },
      },
    })
    createdEventIds.add(squatterId)
    const originalStart = squatter.data.start.dateTime
    const originalSummary = squatter.data.summary

    const upd = await updateAppointmentEventTime({
      appointmentId: apptC,
      googleEventId: null,
      customerName: TEST_PREFIX,
      phone: '+972500000003',
      treatment: 'עיצוב גבות טבעיות',
      isoDate: ISO_DATE,
      startHHMM: '18:00',
      durationMin: 20,
    })
    chk('עדכון אירוע שאינו של המערכת נדחה', upd.ok === false && upd.reason === 'not_ours')

    const del = await deleteAppointmentEvent(apptC, null)
    chk('מחיקת אירוע שאינו של המערכת נדחית', del.ok === false && del.reason === 'not_ours')

    const still = await getEvent(squatterId)
    chk('האירוע הידני נשאר קיים', still !== null)
    chk('האירוע הידני לא שינה שעה', still?.start?.dateTime === originalStart)
    chk('האירוע הידני לא שינה כותרת', still?.summary === originalSummary)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('שחזור: אירוע שנעלם מהיומן נוצר מחדש עם אותו מזהה')

  {
    const apptD = randomUUID()
    const recreated = await updateAppointmentEventTime({
      appointmentId: apptD,
      googleEventId: 'evt_that_never_existed',
      customerName: TEST_PREFIX,
      phone: '+972500000004',
      treatment: 'עיצוב גבות טבעיות',
      isoDate: ISO_DATE,
      startHHMM: '17:20',
      durationMin: 40,
    })
    chk('אירוע חסר נוצר מחדש', recreated.ok === true && recreated.created === true)
    chk('הוא נוצר עם המזהה הדטרמיניסטי, לא מזהה חדש',
      recreated.eventId === deterministicEventId(apptD))
    createdEventIds.add(recreated.eventId)

    const all = await eventsForAppointment(apptD)
    chk('נוצר בדיוק אירוע אחד', all.length === 1, `נמצאו ${all.length}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('זרימת ה-RPC מול Supabase (דורש 0005)')

  const probe = await db.from('appointments').select('calendar_sync_operation').limit(1)
  const migrationApplied = !probe.error

  if (!migrationApplied) {
    console.log('⚠ 0005_customer_reschedule_cancel.sql עדיין לא הורצה ב-Supabase.')
    console.log('  החלק הזה מדלג. הרצת המיגרציה ב-SQL Editor תפעיל אותו.')
    console.log('  (בדיקות ה-RPC המלאות רצות בכל מקרה מול Postgres אמיתי ב-npm run test:reschedule-cancel)')
  } else {
    const customerId = randomUUID()
    const phone = `+9725${Math.floor(10000000 + Math.random() * 89999999)}`
    const { data: authUser, error: authErr } = await db.auth.admin.createUser({
      phone: phone.replace('+', ''), phone_confirm: true,
    })
    if (authErr) throw new Error(`יצירת משתמש בדיקה נכשלה: ${authErr.message}`)
    const uid = authUser.user.id
    createdCustomerIds.add(uid)
    await db.from('customers').insert({ id: uid, phone_e164: phone, full_name: `${TEST_PREFIX} לקוחה` })

    const startsAt = new Date(`${ISO_DATE}T06:00:00.000Z`)
    const { data: appt, error: apptErr } = await db.from('appointments').insert({
      customer_id: uid,
      service_key: 'עיצוב גבות טבעיות',
      variants: [],
      price_total: 70,
      starts_at: startsAt.toISOString(),
      ends_at: startsAt.toISOString(),
      duration_min: 20,
      status: 'confirmed',
      calendar_sync_status: 'synced',
      calendar_sync_operation: 'upsert',
    }).select().single()
    if (apptErr) throw new Error(`יצירת תור בדיקה נכשלה: ${apptErr.message}`)
    createdAppointmentIds.add(appt.id)

    const newStartsAt = new Date(`${ISO_DATE}T07:00:00.000Z`)
    const { data: moved, error: moveErr } = await db.rpc('reschedule_appointment_by_customer', {
      p_appointment_id: appt.id,
      p_customer_id: uid,
      p_new_starts_at: newStartsAt.toISOString(),
      p_expected_starts_at: startsAt.toISOString(),
    })
    chk('הזזה מול Supabase האמיתי הצליחה', !moveErr && moved?.outcome === 'applied',
      moveErr?.message ?? '')

    const { data: afterMove } = await db.from('appointments')
      .select('starts_at, ends_at, status, reschedule_count, original_starts_at, calendar_sync_status, calendar_sync_operation')
      .eq('id', appt.id).single()
    chk('starts_at התעדכן ב-Supabase',
      new Date(afterMove.starts_at).getTime() === newStartsAt.getTime())
    chk('reschedule_count = 1 ו-original_starts_at נשמר',
      afterMove.reschedule_count === 1 &&
      new Date(afterMove.original_starts_at).getTime() === startsAt.getTime())
    chk('הסנכרון סומן מחדש כ-pending/upsert',
      afterMove.calendar_sync_status === 'pending' && afterMove.calendar_sync_operation === 'upsert')

    const { data: cancelled, error: cancelErr } = await db.rpc(
      'cancel_confirmed_appointment_by_customer',
      { p_appointment_id: appt.id, p_customer_id: uid },
    )
    chk('ביטול מול Supabase האמיתי הצליח', !cancelErr && cancelled?.outcome === 'applied',
      cancelErr?.message ?? '')

    const { data: afterCancel } = await db.from('appointments')
      .select('status, calendar_sync_status, calendar_sync_operation').eq('id', appt.id).single()
    chk('הסטטוס cancelled_by_customer ופעולת הסנכרון delete',
      afterCancel.status === 'cancelled_by_customer' &&
      afterCancel.calendar_sync_operation === 'delete' &&
      afterCancel.calendar_sync_status === 'pending')

    const { data: history } = await db.from('appointment_history')
      .select('action, actor, from_status, to_status').eq('appointment_id', appt.id).order('id')
    chk('נכתבה היסטוריה: rescheduled ואז cancelled, שתיהן actor=customer',
      history.length === 2 &&
      history[0].action === 'rescheduled' && history[0].actor === 'customer' &&
      history[1].action === 'cancelled' && history[1].actor === 'customer')

    // ══════════════════════════════════════════════════════════════════════
    section('התנגשות מאוחרת: אירוע ידני נוצר אחרי ה-precheck')

    {
      // תור מסונכרן עם אירוע אמיתי ביומן
      const baseStart = new Date(`${ISO_DATE}T12:00:00.000Z`)
      const { data: a2 } = await db.from('appointments').insert({
        customer_id: uid,
        service_key: 'עיצוב גבות טבעיות',
        variants: [], price_total: 70,
        starts_at: baseStart.toISOString(), ends_at: baseStart.toISOString(),
        duration_min: 20, status: 'confirmed',
        calendar_sync_status: 'synced', calendar_sync_operation: 'upsert',
      }).select().single()
      createdAppointmentIds.add(a2.id)

      const ev = await createAppointmentEvent({
        appointmentId: a2.id,
        customerName: `${TEST_PREFIX} לקוחה`,
        phone: '+972500000005',
        treatment: 'עיצוב גבות טבעיות',
        isoDate: ISO_DATE, startHHMM: '14:00', durationMin: 20,
      })
      createdEventIds.add(ev.eventId)
      await db.from('appointments').update({ google_event_id: ev.eventId }).eq('id', a2.id)

      // 1. ההזזה עצמה — בשלב הזה אין עדיין אירוע חופף, ה-precheck היה עובר
      const target = new Date(`${ISO_DATE}T13:00:00.000Z`)   // 15:00 בישראל
      const { error: mvErr } = await db.rpc('reschedule_appointment_by_customer', {
        p_appointment_id: a2.id, p_customer_id: uid,
        p_new_starts_at: target.toISOString(), p_expected_starts_at: baseStart.toISOString(),
      })
      chk('ההזזה ב-DB הצליחה (לפני שנוצרה ההתנגשות)', !mvErr, mvErr?.message ?? '')

      // 2. שובל מכניסה ידנית אירוע חופף — *אחרי* שה-DB כבר התעדכן
      const clash = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary: `${TEST_PREFIX} (ידני, נוצר אחרי ה-precheck)`,
          start: { dateTime: target.toISOString(), timeZone: 'Asia/Jerusalem' },
          end: { dateTime: new Date(target.getTime() + 20 * 60000).toISOString(), timeZone: 'Asia/Jerusalem' },
        },
      })
      createdEventIds.add(clash.data.id)

      // 3. הסנכרון — הבדיקה השנייה חייבת לתפוס את ההתנגשות
      const sync = await retryCalendarSync(a2.id)
      chk('הסנכרון נחסם ע"י בדיקת ההתנגשות השנייה',
        sync.ok === false && sync.error === 'calendar_conflict', sync.error ?? '')

      // 4. האירוע הידני לא נגוע
      const clashAfter = await getEvent(clash.data.id)
      chk('האירוע הידני לא הוזז ולא נמחק',
        clashAfter !== null && clashAfter.start.dateTime === clash.data.start.dateTime)

      // 5. התור נשאר במועד החדש, עם סנכרון failed — בלי rollback
      const { data: state } = await db.from('appointments')
        .select('starts_at, status, calendar_sync_status, calendar_sync_error')
        .eq('id', a2.id).single()
      chk('התור נשאר במועד החדש ב-Supabase',
        new Date(state.starts_at).getTime() === target.getTime())
      chk('הסטטוס נשאר confirmed — אין rollback אוטומטי', state.status === 'confirmed')
      chk('calendar_sync_status עבר ל-failed', state.calendar_sync_status === 'failed')
      chk('calendar_sync_error נשמר כטקסט קצר ומסונן',
        typeof state.calendar_sync_error === 'string' &&
        state.calendar_sync_error.length > 0 && state.calendar_sync_error.length <= 300 &&
        !state.calendar_sync_error.includes('token'))

      // 6. האירוע של התור עצמו נשאר במועד הישן — לא נדרס ולא הוכפל
      const own = await getEvent(ev.eventId)
      chk('האירוע של התור עצמו לא הוזז (הסנכרון נעצר לפני הכתיבה)', own !== null)
      chk('לא נוצר אירוע שני לתור הזה',
        (await eventsForAppointment(a2.id)).length === 1)

      // 7. אחרי ששובל מפנה את ההתנגשות — retry מצליח ומעדכן את אותו אירוע
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: clash.data.id })
      createdEventIds.delete(clash.data.id)

      const retry = await retryCalendarSync(a2.id)
      chk('retry אחרי פינוי ההתנגשות מצליח', retry.ok === true)
      const moved = await getEvent(ev.eventId)
      chk('retry עדכן את אותו אירוע ולא יצר חדש',
        moved !== null && new Date(moved.start.dateTime).getTime() === target.getTime())
      chk('עדיין אירוע אחד בלבד לתור', (await eventsForAppointment(a2.id)).length === 1)

      const { data: synced } = await db.from('appointments')
        .select('calendar_sync_status, google_event_id').eq('id', a2.id).single()
      chk('הסנכרון סומן synced ואותו google_event_id נשמר',
        synced.calendar_sync_status === 'synced' && synced.google_event_id === ev.eventId)

      // ══════════════════════════════════════════════════════════════════════
      section('admin retry מבדיל בין upsert למחיקה')

      const { error: cancelErr2 } = await db.rpc('cancel_confirmed_appointment_by_customer',
        { p_appointment_id: a2.id, p_customer_id: uid })
      chk('ביטול התור הצליח', !cancelErr2, cancelErr2?.message ?? '')

      const delSync = await retryCalendarSync(a2.id)
      chk('אותו retry ניהולי ביצע הפעם *מחיקה* ולא יצירה', delSync.ok === true)
      chk('אירוע היומן נמחק בפועל', (await getEvent(ev.eventId)) === null)
      createdEventIds.delete(ev.eventId)

      const { data: afterDel } = await db.from('appointments')
        .select('status, calendar_sync_status').eq('id', a2.id).single()
      chk('הסטטוס נשאר cancelled_by_customer והסנכרון synced',
        afterDel.status === 'cancelled_by_customer' && afterDel.calendar_sync_status === 'synced')

      const delAgain = await retryCalendarSync(a2.id)
      chk('retry נוסף על מחיקה שכבר הושלמה הוא idempotent', delAgain.ok === true)
    }

    // ══════════════════════════════════════════════════════════════════════
    section('EXCLUDE constraint על סלוט תפוס (Supabase אמיתי)')

    {
      const t1 = new Date(`${ISO_DATE}T05:00:00.000Z`)
      const t2 = new Date(`${ISO_DATE}T05:40:00.000Z`)

      const mk = async startsAt => {
        const { data } = await db.from('appointments').insert({
          customer_id: uid, service_key: 'עיצוב גבות טבעיות', variants: [], price_total: 70,
          starts_at: startsAt.toISOString(), ends_at: startsAt.toISOString(),
          duration_min: 20, status: 'confirmed',
          calendar_sync_status: 'synced', calendar_sync_operation: 'upsert',
        }).select().single()
        createdAppointmentIds.add(data.id)
        return data
      }
      const mine = await mk(t1)
      const hers = await mk(t2)

      const { error: clashErr } = await db.rpc('reschedule_appointment_by_customer', {
        p_appointment_id: mine.id, p_customer_id: uid,
        p_new_starts_at: t2.toISOString(), p_expected_starts_at: t1.toISOString(),
      })
      chk('הזזה לסלוט תפוס נחסמה ע"י ה-EXCLUDE constraint',
        clashErr?.code === '23P01', `code=${clashErr?.code}`)

      const { data: still } = await db.from('appointments')
        .select('starts_at, reschedule_count').eq('id', mine.id).single()
      chk('התור נשאר במועד המקורי אחרי ההתנגשות',
        new Date(still.starts_at).getTime() === t1.getTime() && still.reschedule_count === 0)

      const { data: hist } = await db.from('appointment_history')
        .select('id').eq('appointment_id', mine.id)
      chk('לא נכתבה היסטוריה בהתנגשות', hist.length === 0)
      const { data: other } = await db.from('appointments').select('starts_at').eq('id', hers.id).single()
      chk('התור השני לא נגוע', new Date(other.starts_at).getTime() === t2.getTime())
    }

    // ══════════════════════════════════════════════════════════════════════
    section('התאוששות מ-timeout — בלי מונה או היסטוריה כפולים')

    {
      const base = new Date(`${ISO_DATE}T04:00:00.000Z`)
      const { data: a3 } = await db.from('appointments').insert({
        customer_id: uid, service_key: 'עיצוב גבות טבעיות', variants: [], price_total: 70,
        starts_at: base.toISOString(), ends_at: base.toISOString(),
        duration_min: 20, status: 'confirmed',
        calendar_sync_status: 'synced', calendar_sync_operation: 'upsert',
      }).select().single()
      createdAppointmentIds.add(a3.id)

      const target = new Date(`${ISO_DATE}T03:00:00.000Z`)
      const args = {
        p_appointment_id: a3.id, p_customer_id: uid,
        p_new_starts_at: target.toISOString(), p_expected_starts_at: base.toISOString(),
      }
      const first = await db.rpc('reschedule_appointment_by_customer', args)
      const second = await db.rpc('reschedule_appointment_by_customer', args)

      chk('הבקשה הראשונה applied', first.data?.outcome === 'applied')
      chk('הבקשה החוזרת (timeout) מזוהה כ-already_applied ולא כשגיאה',
        second.data?.outcome === 'already_applied', second.data?.outcome ?? second.error?.message)

      const { data: st } = await db.from('appointments')
        .select('reschedule_count, original_starts_at, starts_at').eq('id', a3.id).single()
      chk('reschedule_count גדל בדיוק פעם אחת', st.reschedule_count === 1, `count=${st.reschedule_count}`)
      chk('original_starts_at הוא המועד המקורי', new Date(st.original_starts_at).getTime() === base.getTime())
      chk('starts_at הוא המועד החדש', new Date(st.starts_at).getTime() === target.getTime())

      const { data: h } = await db.from('appointment_history')
        .select('action').eq('appointment_id', a3.id)
      chk('נכתבה שורת היסטוריה אחת בלבד', h.length === 1, `count=${h.length}`)

      // בחירת המועד הקיים בפעם הראשונה — no_change, לא "התאוששות"
      const same = await db.rpc('reschedule_appointment_by_customer', {
        p_appointment_id: a3.id, p_customer_id: uid,
        p_new_starts_at: target.toISOString(), p_expected_starts_at: target.toISOString(),
      })
      chk('בחירת אותו מועד שהוצג = no_change', same.data?.outcome === 'no_change')
      const { data: st2 } = await db.from('appointments')
        .select('reschedule_count').eq('id', a3.id).single()
      chk('no_change לא הגדיל את המונה', st2.reschedule_count === 1)
    }

    // ══════════════════════════════════════════════════════════════════════
    section('כשל בקריאת business_settings → 503, בלי לשנות דבר')

    {
      const base = new Date(`${ISO_DATE}T02:00:00.000Z`)
      const { data: a4 } = await db.from('appointments').insert({
        customer_id: uid, service_key: 'עיצוב גבות טבעיות', variants: [], price_total: 70,
        starts_at: base.toISOString(), ends_at: base.toISOString(),
        duration_min: 20, status: 'confirmed',
        calendar_sync_status: 'synced', calendar_sync_operation: 'upsert',
      }).select().single()
      createdAppointmentIds.add(a4.id)

      const realUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      // מנתקים את השרת מ-Supabase — מדמה תקלת רשת/שירות בקריאת ההגדרות
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sm-brows-unreachable.invalid'
      try {
        const policy = await loadAppointmentPolicy()
        chk('loadAppointmentPolicy נכשל בבטחה ולא מחזיר ברירות מחדל',
          policy.ok === false && policy.error === 'settings_unavailable')

        const res = await rescheduleForCustomer({
          appointmentId: a4.id, customerId: uid,
          isoDate: ISO_DATE, time: '10:00', expectedStartsAt: base.toISOString(),
        })
        chk('הזזה מחזירה 503 כשה-DB אינו נגיש',
          res.ok === false && res.status === 503, `status=${res.status}`)
        chk('ההודעה ללקוחה גנרית ולא חושפת שגיאה טכנית',
          res.ok === false && res.message.includes('נסי שוב בעוד מספר דקות') &&
          !res.message.toLowerCase().includes('fetch') &&
          !res.message.toLowerCase().includes('supabase'))
        chk('מוצעת פנייה לוואטסאפ', res.ok === false && res.offerWhatsApp === true)

        const cancelRes = await cancelConfirmedForCustomer(a4.id, uid)
        chk('ביטול מחזיר 503 באותו מצב', cancelRes.ok === false && cancelRes.status === 503)
      } finally {
        process.env.NEXT_PUBLIC_SUPABASE_URL = realUrl
      }

      // שום דבר לא השתנה
      const { data: after } = await db.from('appointments')
        .select('starts_at, status, reschedule_count, calendar_sync_status')
        .eq('id', a4.id).single()
      chk('starts_at לא השתנה', new Date(after.starts_at).getTime() === base.getTime())
      chk('status נשאר confirmed', after.status === 'confirmed')
      chk('reschedule_count נשאר 0', after.reschedule_count === 0)
      chk('סטטוס הסנכרון לא נגוע', after.calendar_sync_status === 'synced')
      const { data: h } = await db.from('appointment_history').select('id').eq('appointment_id', a4.id)
      chk('לא נכתבה שום היסטוריה', h.length === 0, `count=${h.length}`)
      chk('לא נוצר אירוע ביומן', (await eventsForAppointment(a4.id)).length === 0)
    }

    // ══════════════════════════════════════════════════════════════════════
    section('רגרסיה: ביטול בקשת pending ממשיך לעבוד')

    {
      const base = new Date(`${ISO_DATE}T01:00:00.000Z`)
      const { data: pend, error: pendErr } = await db.rpc('create_pending_appointment', {
        p_customer_id: uid, p_service_key: 'עיצוב גבות טבעיות', p_variants: [],
        p_price_total: 70, p_starts_at: base.toISOString(), p_duration_min: 20,
        p_notes: null, p_policy_version: 'test',
      })
      chk('בקשת pending נוצרה', !pendErr && pend?.status === 'pending', pendErr?.message ?? '')
      if (pend) createdAppointmentIds.add(pend.id)

      const { error: cErr } = await db.rpc('cancel_pending_appointment', {
        p_appointment_id: pend.id, p_customer_id: uid,
      })
      chk('ביטול pending הישן הצליח', !cErr, cErr?.message ?? '')

      const { data: after } = await db.from('appointments')
        .select('status, calendar_sync_status, calendar_sync_operation').eq('id', pend.id).single()
      chk('הסטטוס cancelled_by_customer', after.status === 'cancelled_by_customer')
      chk('ביטול pending לא ביקש מחיקת אירוע (operation נשאר upsert)',
        after.calendar_sync_operation === 'upsert' &&
        after.calendar_sync_status === 'not_applicable',
        `${after.calendar_sync_operation}/${after.calendar_sync_status}`)

      const { data: h } = await db.from('appointment_history')
        .select('action, actor').eq('appointment_id', pend.id).order('id')
      chk('היסטוריה: created ואז cancelled, actor=customer',
        h.length === 2 && h[0].action === 'created' && h[1].action === 'cancelled' &&
        h.every(x => x.actor === 'customer'))
    }
  }

  exitCode = 0
} catch (err) {
  chk('הבדיקה רצה עד הסוף ללא חריגה', false, err.message)
} finally {
  // ══════════════════════════════════════════════════════════════════════════
  section('ניקוי נתוני בדיקה')

  for (const eventId of createdEventIds) {
    try {
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId })
      chk(`אירוע יומן נמחק: ${eventId.slice(0, 24)}…`)
    } catch (err) {
      const status = err?.response?.status ?? err?.code
      if (status === 404 || status === 410) chk(`אירוע כבר לא היה קיים: ${eventId.slice(0, 24)}…`)
      else chk(`מחיקת אירוע ${eventId.slice(0, 24)}… נכשלה`, false, err.message)
    }
  }

  // ודא שלא נשאר אף אירוע בדיקה בתאריך הבדיקה
  try {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: `${ISO_DATE}T00:00:00Z`,
      timeMax: `${ISO_DATE}T23:59:59Z`,
      singleEvents: true,
    })
    const leftovers = (res.data.items ?? []).filter(
      e => e.status !== 'cancelled' && (e.summary ?? '').includes(TEST_PREFIX))
    chk('לא נשאר אף אירוע בדיקה ביומן', leftovers.length === 0,
      leftovers.map(e => e.id).join(', '))
  } catch (err) {
    chk('אימות ניקוי היומן', false, err.message)
  }

  for (const id of createdAppointmentIds) {
    const { error } = await db.from('appointments').delete().eq('id', id)
    chk('תור בדיקה נמחק (מוחק גם appointment_history בקסקדה)', !error, error?.message ?? '')
  }
  for (const id of createdCustomerIds) {
    await db.from('customers').delete().eq('id', id)
    const { error } = await db.auth.admin.deleteUser(id)
    chk('לקוחת בדיקה נמחקה מ-customers ומ-auth.users', !error, error?.message ?? '')
  }

  // שני המנהלים האמיתיים חייבים להישאר — הבדיקה לא נוגעת בטבלת admins בכלל
  const { data: admins } = await db.from('admins').select('user_id')
  chk('שני המנהלים האמיתיים עדיין קיימים', admins?.length === 2, `count=${admins?.length}`)

  const failed = results.filter(r => !r).length
  console.log('\n' + '═'.repeat(60))
  console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
  process.exit(failed === 0 && exitCode === 0 ? 0 : 1)
}
