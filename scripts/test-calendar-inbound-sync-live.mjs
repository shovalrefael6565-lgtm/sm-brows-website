/**
 * בדיקת שלב 8 מול Google Calendar האמיתי ומול Supabase האמיתי.
 *
 * זו הבדיקה היחידה שמריצה את המנוע השלם — runCalendarSync — מקצה לקצה:
 * קריאת שינויים אמיתיים מ-Google, שמירתם בעמידות, ועיבודם. כל השאר
 * (PGlite, לוגיקה טהורה) בודק חלקים.
 *
 * ⚠️ מה הריצה הזו נוגעת ביומן האמיתי:
 *   • יוצרת, מזיזה ומוחקת אירועים שכותרתם מתחילה ב-"TEST — מחיקה אוטומטית",
 *     בתאריכים עתידיים רחוקים (2029) שאינם פוגעים בשום תור אמיתי.
 *   • קוראת את כל היומן ב-full sync הראשוני — קריאה בלבד.
 *   • אירועים ידניים של שובל אינם משתנים, אינם נמחקים ואינם מיובאים.
 *     הבדיקה מוודאת את זה במפורש על אירוע ידני שהיא יוצרת בעצמה.
 *
 * ⚠️ מצב הסנכרון (calendar_sync_state) מאופס בסיום, כדי שההרצה האמיתית
 * הראשונה בפרודקשן תתחיל מדף חלק.
 *
 * הרצה:  npm run test:live:calendar-inbound-sync
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

const { createAppointmentEvent, deterministicEventId } = await import('../lib/googleCalendar.ts')
const { runCalendarSync } = await import('../lib/calendarInboundSync.ts')

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const opts = { auth: { autoRefreshToken: false, persistSession: false } }
const db = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, opts)
const anon = createClient(URL_, ANON, opts)

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
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 50 - t.length))}`)

const TEST_PREFIX = 'TEST — מחיקה אוטומטית'
const ISO_DATE = '2029-03-14'
const TZ = '+02:00'
const at = hhmm => `${ISO_DATE}T${hhmm}:00${TZ}`

const createdEventIds = new Set()
const createdAppointmentIds = new Set()
const createdCustomerIds = new Set()

function isBlocked(error) {
  if (!error) return false
  return error.message.includes('Could not find the function') ||
    error.message.includes('permission denied')
}

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

const apptRow = async id =>
  (await db.from('appointments').select('*').eq('id', id).single()).data

const historyOf = async id =>
  (await db.from('appointment_history').select('*').eq('appointment_id', id).order('id')).data ?? []

async function makeCustomer(label) {
  const email = `test-${randomUUID()}@sm-brows-test.invalid`
  const { data, error } = await db.auth.admin.createUser({
    email, password: randomUUID(), email_confirm: true,
  })
  if (error) throw new Error(`יצירת משתמש בדיקה נכשלה: ${error.message}`)
  const uid = data.user.id
  createdCustomerIds.add(uid)
  const phone = `+9725${Math.floor(10000000 + Math.random() * 89999999)}`
  const { error: cErr } = await db.from('customers')
    .insert({ id: uid, phone_e164: phone, full_name: `${TEST_PREFIX} ${label}` })
  if (cErr) throw new Error(`יצירת לקוחה נכשלה: ${cErr.message}`)
  return uid
}

async function makeAppointment(customerId, startHHMM, durationMin = 20) {
  const { data, error } = await db.from('appointments').insert({
    customer_id: customerId,
    service_key: 'עיצוב גבות טבעיות',
    variants: [], price_total: 70,
    starts_at: at(startHHMM), ends_at: at(startHHMM),
    duration_min: durationMin, status: 'confirmed',
    calendar_sync_status: 'synced', calendar_sync_operation: 'upsert',
  }).select().single()
  if (error) throw new Error(`יצירת תור נכשלה: ${error.message}`)
  createdAppointmentIds.add(data.id)
  return data
}

/** יוצרת את אירוע היומן האמיתי של התור ומקשרת אותו */
async function makeSystemEvent(appt, customerName, startHHMM) {
  const { eventId } = await createAppointmentEvent({
    appointmentId: appt.id,
    customerName: `${TEST_PREFIX} ${customerName}`,
    phone: '+972500000000',
    treatment: 'עיצוב גבות טבעיות',
    isoDate: ISO_DATE,
    startHHMM,
    durationMin: appt.duration_min,
  })
  createdEventIds.add(eventId)
  await db.from('appointments').update({ google_event_id: eventId }).eq('id', appt.id)
  return eventId
}

let exitCode = 1
try {
  // ── האם 0008 הורצה בכלל ───────────────────────────────────────────────────
  const probe = await db.from('calendar_sync_state').select('id').limit(1)
  if (probe.error) {
    console.log('⛔ 0008_google_calendar_inbound_sync.sql עדיין לא הורצה ב-Supabase.')
    console.log(`   (${probe.error.message})`)
    console.log('   יש להריץ אותה ב-SQL Editor לפני הבדיקה הזו.')
    process.exit(1)
  }
  chk('0008 מותקנת ב-Supabase — calendar_sync_state קיימת')

  // ══════════════════════════════════════════════════════════════════════════
  section('הרשאות ה-RPCs החדשים')

  const NEW_RPCS = [
    ['claim_calendar_sync_run', { p_owner: randomUUID(), p_lease_seconds: 60, p_calendar_fingerprint: 'x' }],
    ['record_calendar_changes', { p_owner: randomUUID(), p_changes: [], p_next_page_token: 'x', p_next_sync_token: null }],
    ['reset_calendar_sync_cursor', { p_owner: randomUUID(), p_full_reset: true, p_reason: 'x' }],
    ['finish_calendar_sync_run', { p_owner: randomUUID(), p_status: 'failed', p_error: null, p_stats: {} }],
    ['claim_calendar_change', { p_owner: randomUUID(), p_max_attempts: 1, p_lease_seconds: 60 }],
    ['finish_calendar_change', { p_queue_id: 1, p_owner: randomUUID(), p_status: 'failed', p_result: null, p_error: null }],
    ['retry_calendar_change', { p_queue_id: 1 }],
    ['record_calendar_sync_issue', { p_queue_id: null, p_kind: 'orphaned_event', p_status: 'open', p_google_event_id: null, p_appointment_id: null, p_db_starts_at: null, p_google_starts_at: null, p_detail: 'x' }],
    ['apply_google_reschedule', { p_appointment_id: randomUUID(), p_google_event_id: 'x', p_new_starts_at: at('09:00'), p_calendar_matches: true, p_queue_id: null }],
    ['mark_calendar_correction_required', { p_appointment_id: randomUUID(), p_google_event_id: 'x' }],
    ['apply_google_cancellation', { p_appointment_id: randomUUID(), p_google_event_id: 'x', p_queue_id: null }],
  ]

  for (const [fn, args] of NEW_RPCS) {
    const { error } = await anon.rpc(fn, args)
    chk(`anon אינו יכול להריץ ${fn}`, isBlocked(error), error ? '' : 'הצליח!')
  }

  // לקוחה מחוברת — לא רק anon
  {
    const email = `test-${randomUUID()}@sm-brows-test.invalid`
    const password = randomUUID()
    const { data } = await db.auth.admin.createUser({ email, password, email_confirm: true })
    createdCustomerIds.add(data.user.id)
    await db.from('customers').insert({
      id: data.user.id,
      phone_e164: `+9725${Math.floor(10000000 + Math.random() * 89999999)}`,
      full_name: `${TEST_PREFIX} מחוברת`,
    })
    const asUser = createClient(URL_, ANON, opts)
    await asUser.auth.signInWithPassword({ email, password })

    let allBlocked = true
    for (const [fn, args] of NEW_RPCS) {
      const { error } = await asUser.rpc(fn, args)
      if (!isBlocked(error)) allBlocked = false
    }
    chk('לקוחה מחוברת אינה יכולה להריץ אף אחד מ-11 ה-RPCs', allBlocked)

    // הטבלאות עצמן סגורות גם הן
    const t1 = await asUser.from('calendar_sync_state').select('sync_token')
    const t2 = await asUser.from('calendar_change_queue').select('id')
    const t3 = await asUser.from('calendar_sync_issues').select('id')
    chk('לקוחה מחוברת אינה רואה שורות בשלוש הטבלאות החדשות',
      (t1.data?.length ?? 0) === 0 && (t2.data?.length ?? 0) === 0 && (t3.data?.length ?? 0) === 0)
  }

  // service_role כן מצליח
  {
    const owner = randomUUID()
    const { error } = await db.rpc('claim_calendar_sync_run', {
      p_owner: owner, p_lease_seconds: 1, p_calendar_fingerprint: 'probe',
    })
    chk('service_role כן יכול להריץ את ה-RPCs', !error, error?.message ?? '')
    await db.rpc('finish_calendar_sync_run', {
      p_owner: owner, p_status: 'success', p_error: null, p_stats: {},
    })
    // מאפסים את מה שה-probe שינה, כדי לא לזייף מצב
    await db.from('calendar_sync_state').update({
      calendar_fingerprint: null, sync_token: null, base_sync_token: null,
      page_token: null, sync_mode: null, calendar_changed_count: 0,
    }).eq('id', true)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('הכנת נתוני בדיקה ביומן האמיתי')

  const custA = await makeCustomer('לקוחה א')
  const custB = await makeCustomer('לקוחה ב')

  const apptA = await makeAppointment(custA, '09:00')
  const eventA = await makeSystemEvent(apptA, 'לקוחה א', '09:00')
  chk('אירוע מערכת נוצר ביומן עם המזהה הדטרמיניסטי',
    eventA === deterministicEventId(apptA.id))

  const apptB = await makeAppointment(custB, '13:00')
  const eventB = await makeSystemEvent(apptB, 'לקוחה ב', '13:00')
  chk('אירוע מערכת שני נוצר')

  // אירוע ידני של שובל — בלי extendedProperties, מזהה אקראי
  const manual = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: `${TEST_PREFIX} — אירוע ידני של שובל`,
      description: 'פרטים פרטיים שאסור שייכנסו למערכת',
      start: { dateTime: at('16:00'), timeZone: 'Asia/Jerusalem' },
      end: { dateTime: at('17:00'), timeZone: 'Asia/Jerusalem' },
    },
  })
  const manualId = manual.data.id
  createdEventIds.add(manualId)
  const manualEtagBefore = manual.data.etag
  chk('אירוע ידני נוצר ביומן')

  // ══════════════════════════════════════════════════════════════════════════
  section('full sync ראשוני')

  let run = await runCalendarSync()
  chk('הריצה הראשונה הצליחה', run.ok, run.ok ? '' : run.message)
  if (!run.ok) throw new Error(run.message)
  chk('הריצה קראה אירועים מהיומן', run.stats.eventsRead > 0, `read=${run.stats.eventsRead}`)

  // ── ניקוז ממוקד עד שאירועי ה-TEST עובדו ───────────────────────────────────
  //
  // ⚠️ שורש הכשל שהתיקון הזה סוגר: ריצת סנכרון חסומה ב-RUN_BUDGET_MS
  // (3.5 דקות) — בכוונה, כדי שריצה ב-serverless לא תיחתך באמצע. ביומן
  // האמיתי הצטברו מאות אירועי מערכת *מחוקים* משלבים 6–10: Google משאיר
  // אירוע מחוק לנצח כ-'cancelled', ו-showDeleted:true (חובה עם syncToken)
  // מחזיר אותו בכל full sync מחדש. נמדד בפועל: 1,646 אירועים נקראו,
  // 188 שינויים נכתבו לתור, והריצה נגמרה ב-budget אחרי 152 מהם — כשהאירועים
  // הטריים של הבדיקה עדיין pending, ולכן echoes=0.
  //
  // זו התנהגות **תקינה** של המנוע: התור עמיד וממשיך להתנקז בריצות הבאות.
  // מה שהיה שבור זו ההנחה של הבדיקה שריצה אחת מנקזת הכול.
  //
  // ⚠️ אין כאן שינוי בקוד המוצר ואין שינוי ב-RUN_BUDGET_MS. הבדיקה ממשיכה
  // להריץ בדיוק כפי שפרודקשן עושה על פני מספר ריצות, ועוצרת ברגע שהאירועים
  // *שלה* עובדו — היא אינה דורשת שכל 188 הישנים יטופלו.
  const DRAIN_MAX_RUNS = 4
  const DRAIN_TIMEOUT_MS = 6 * 60 * 1000
  const testEventIds = [eventA, eventB, manualId]

  // ⚠️ לפי מזהי האירועים המדויקים של הבדיקה, לא לפי גודל התור הכולל
  const pendingTestEvents = async () => {
    const { data } = await db.from('calendar_change_queue')
      .select('google_event_id')
      .in('google_event_id', testEventIds)
      .in('status', ['pending', 'processing'])
    return (data ?? []).map(r => r.google_event_id)
  }

  const drainStartedAt = Date.now()
  let drainRuns = 0
  let stillPending = await pendingTestEvents()

  while (stillPending.length > 0 && drainRuns < DRAIN_MAX_RUNS &&
         Date.now() - drainStartedAt < DRAIN_TIMEOUT_MS) {
    drainRuns++
    const extra = await runCalendarSync()
    if (!extra.ok) throw new Error(`ריצת ניקוז נכשלה: ${extra.message}`)
    for (const k of ['processed', 'ignored', 'failed', 'echoes', 'rescheduled',
                     'cancelled', 'durationCorrections', 'duplicates', 'reverted', 'deleted']) {
      run.stats[k] += extra.stats[k]
    }
    stillPending = await pendingTestEvents()
  }

  const { count: queuePendingLeft } = await db.from('calendar_change_queue')
    .select('id', { count: 'exact', head: true }).in('status', ['pending', 'processing'])

  chk('⚠️ אירועי ה-TEST עובדו ואינם pending',
    stillPending.length === 0,
    `drainRuns=${drainRuns} elapsed=${Date.now() - drainStartedAt}ms ` +
    `queuePendingLeft=${queuePendingLeft ?? 0} echoes=${run.stats.echoes}` +
    (stillPending.length ? ` stillPending=${stillPending.join(', ')}` : ''))

  if (stillPending.length > 0) {
    // נכשל, לא מדלג. ה-cleanup ב-finally ירוץ בכל מקרה.
    throw new Error(
      `אירועי ה-TEST לא עובדו תוך ${Date.now() - drainStartedAt}ms ` +
      `(${drainRuns} ריצות ניקוז, ${stillPending.length} עדיין pending)`,
    )
  }


  let state = (await db.from('calendar_sync_state').select('*').single()).data
  chk('⚠️ nextSyncToken נשמר בסיום ה-full sync', Boolean(state.sync_token))
  chk('ה-cursor התנקה בסיום', state.page_token === null && state.sync_mode === null)
  chk('last_full_sync_at נרשם', state.last_full_sync_at !== null)
  chk('הריצה סומנה כהצלחה', state.last_run_status === 'success')

  chk('⚠️ האירועים הטריים נקלטו כ-echo ולא כשינוי',
    run.stats.echoes >= 2, `echoes=${run.stats.echoes}`)
  chk('אף תור לא הוזז בריצה הראשונה', run.stats.rescheduled === 0)
  chk('אף תור לא בוטל בריצה הראשונה', run.stats.cancelled === 0)

  {
    const h = await historyOf(apptA.id)
    chk('⚠️ echo לא כתב שום היסטוריה', h.length === 0)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('שובל מזיזה אירוע ביומן')

  await calendar.events.patch({
    calendarId: CALENDAR_ID, eventId: eventA,
    requestBody: {
      start: { dateTime: at('10:40'), timeZone: 'Asia/Jerusalem' },
      end: { dateTime: at('11:00'), timeZone: 'Asia/Jerusalem' },
    },
  })

  run = await runCalendarSync()
  chk('הסנכרון אחרי ההזזה הצליח', run.ok, run.ok ? '' : run.message)
  chk('הסנכרון היה incremental ולא מלא',
    run.stats.eventsRead < 50, `read=${run.stats.eventsRead}`)
  chk('דווחה הזזה אחת', run.stats.rescheduled === 1, `rescheduled=${run.stats.rescheduled}`)

  {
    const a = await apptRow(apptA.id)
    chk('⚠️ starts_at התעדכן מ-Google',
      new Date(a.starts_at).toISOString() === new Date(at('10:40')).toISOString(),
      a.starts_at)
    chk('⚠️ ends_at חושב מ-duration_min ולא מ-Google',
      new Date(a.ends_at) - new Date(a.starts_at) === 20 * 60 * 1000)
    chk('הסטטוס נשאר confirmed', a.status === 'confirmed')
    chk('⚠️ reschedule_count לא גדל — זו הזזה מנהלית', a.reschedule_count === 0)
    chk('original_starts_at נשמר',
      new Date(a.original_starts_at).toISOString() === new Date(at('09:00')).toISOString())
    chk('הטיפול, המחיר והמשך לא השתנו',
      a.service_key === 'עיצוב גבות טבעיות' && a.price_total === 70 && a.duration_min === 20)
    chk('הלקוחה לא השתנתה', a.customer_id === custA)

    const h = await historyOf(apptA.id)
    const resched = h.filter(x => x.action === 'rescheduled')
    chk('⚠️ נכתבה שורת היסטוריה אחת בדיוק', resched.length === 1)
    chk('ההיסטוריה actor=system, בלי actor_id',
      resched[0]?.actor === 'system' && resched[0]?.actor_id === null)
    chk("ההיסטוריה source='google_calendar'", resched[0]?.source === 'google_calendar')
  }

  // אותה ריצה שוב — echo, בלי כתיבה שנייה
  run = await runCalendarSync()
  chk('ריצה חוזרת אינה מזיזה שוב', run.stats.rescheduled === 0)
  {
    const h = await historyOf(apptA.id)
    chk('⚠️ אין היסטוריה כפולה', h.filter(x => x.action === 'rescheduled').length === 1)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('שובל משנה רק את אורך האירוע')

  await calendar.events.patch({
    calendarId: CALENDAR_ID, eventId: eventA,
    requestBody: { end: { dateTime: at('12:30'), timeZone: 'Asia/Jerusalem' } },
  })

  run = await runCalendarSync()
  chk('הסנכרון אחרי שינוי האורך הצליח', run.ok, run.ok ? '' : run.message)
  chk('דווח תיקון אורך אחד',
    run.stats.durationCorrections === 1, `corrections=${run.stats.durationCorrections}`)
  chk('⚠️ שינוי אורך אינו נספר כהזזה', run.stats.rescheduled === 0)

  {
    const ev = await getEvent(eventA)
    const dur = new Date(ev.end.dateTime) - new Date(ev.start.dateTime)
    chk('⚠️ ה-end ביומן תוקן לזמן הקנוני', dur === 20 * 60 * 1000, `${dur / 60000} דק׳`)
    chk('ה-start ביומן לא זז',
      new Date(ev.start.dateTime).toISOString() === new Date(at('10:40')).toISOString())

    const a = await apptRow(apptA.id)
    chk('⚠️ duration_min ב-DB לא השתנה — Google אינו מקור אמת למשך', a.duration_min === 20)
    const h = await historyOf(apptA.id)
    chk('⚠️ תיקון אורך לא כתב היסטוריה של הזזה',
      h.filter(x => x.action === 'rescheduled').length === 1)
  }

  // התיקון עצמו חוזר כשינוי — ונעצר
  run = await runCalendarSync()
  chk('⚠️ ה-echo של תיקון האורך אינו יוצר לולאה',
    run.stats.durationCorrections === 0 && run.stats.rescheduled === 0)

  // ══════════════════════════════════════════════════════════════════════════
  section('שינוי כותרת בלבד')

  await calendar.events.patch({
    calendarId: CALENDAR_ID, eventId: eventA,
    requestBody: { summary: `${TEST_PREFIX} — כותרת ששונתה ידנית` },
  })
  const beforeTitle = await apptRow(apptA.id)
  run = await runCalendarSync()
  const afterTitle = await apptRow(apptA.id)
  chk('⚠️ שינוי כותרת אינו משנה שום נתון ב-DB',
    afterTitle.starts_at === beforeTitle.starts_at &&
    afterTitle.status === beforeTitle.status &&
    afterTitle.service_key === beforeTitle.service_key)
  chk('שינוי כותרת אינו יוצר היסטוריה',
    (await historyOf(apptA.id)).filter(x => x.action === 'rescheduled').length === 1)
  {
    const ev = await getEvent(eventA)
    chk('⚠️ הכותרת לא הוחזרה לערכה המקורי',
      ev.summary.includes('כותרת ששונתה ידנית'))
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('אירוע ידני אינו מיובא ואינו משתנה')

  {
    const ev = await getEvent(manualId)
    chk('⚠️ האירוע הידני לא השתנה', ev.etag === manualEtagBefore, 'etag זהה')
    chk('האירוע הידני עדיין קיים ביומן', ev !== null)

    const { count } = await db.from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('google_event_id', manualId)
    chk('⚠️ לא נוצר appointment מהאירוע הידני', count === 0)

    const { data: q } = await db.from('calendar_change_queue')
      .select('id').eq('google_event_id', manualId)
    chk('⚠️ האירוע הידני לא נשמר בתור בכלל', (q ?? []).length === 0)

    const { count: custCount } = await db.from('customers')
      .select('id', { count: 'exact', head: true })
      .like('full_name', '%אירוע ידני%')
    chk('⚠️ לא נוצרה לקוחה מהאירוע הידני', custCount === 0)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('הזזה לסלוט תפוס — Google מוחזר למועד ה-DB')

  const apptAStart = (await apptRow(apptA.id)).starts_at

  await calendar.events.patch({
    calendarId: CALENDAR_ID, eventId: eventA,
    requestBody: {
      start: { dateTime: at('13:00'), timeZone: 'Asia/Jerusalem' },  // הסלוט של apptB
      end: { dateTime: at('13:20'), timeZone: 'Asia/Jerusalem' },
    },
  })

  run = await runCalendarSync()
  chk('הסנכרון אחרי ההתנגשות הצליח (התקלה טופלה, לא הפילה)', run.ok, run.ok ? '' : run.message)
  chk('דווחה החזרה אחת', run.stats.reverted === 1, `reverted=${run.stats.reverted}`)

  {
    const a = await apptRow(apptA.id)
    chk('⚠️ ה-DB לא השתנה בהתנגשות', a.starts_at === apptAStart)
    const b = await apptRow(apptB.id)
    chk('⚠️ התור האחר לא נגע',
      new Date(b.starts_at).toISOString() === new Date(at('13:00')).toISOString() &&
      b.status === 'confirmed')

    const ev = await getEvent(eventA)
    chk('⚠️ אירוע Google הוחזר למועד שב-DB',
      new Date(ev.start.dateTime).toISOString() === new Date(apptAStart).toISOString(),
      ev.start.dateTime)

    const evB = await getEvent(eventB)
    chk('אירוע התור האחר לא נמחק ולא זז',
      evB !== null &&
      new Date(evB.start.dateTime).toISOString() === new Date(at('13:00')).toISOString())

    const { data: issues } = await db.from('calendar_sync_issues')
      .select('*').eq('appointment_id', apptA.id).eq('kind', 'conflict_slot_taken')
    chk('נרשמה תקלת התנגשות אחת בדיוק', (issues ?? []).length === 1)
    chk('התקלה סומנה resolved אחרי ההחזרה', issues?.[0]?.status === 'resolved')
    chk('התקלה שומרת את שני המועדים',
      issues?.[0]?.db_starts_at !== null && issues?.[0]?.google_starts_at !== null)

    const h = await historyOf(apptA.id)
    chk('⚠️ התנגשות לא כתבה היסטוריה של הצלחה',
      h.filter(x => x.action === 'rescheduled').length === 1)
  }

  // ההחזרה עצמה חוזרת כשינוי — ונעצרת
  run = await runCalendarSync()
  chk('⚠️ ה-echo של ההחזרה אינו יוצר לולאה',
    run.stats.rescheduled === 0 && run.stats.reverted === 0)

  // ══════════════════════════════════════════════════════════════════════════
  section('שובל מוחקת אירוע ביומן')

  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: eventB })

  run = await runCalendarSync()
  chk('הסנכרון אחרי המחיקה הצליח', run.ok, run.ok ? '' : run.message)
  chk('דווח ביטול אחד', run.stats.cancelled === 1, `cancelled=${run.stats.cancelled}`)

  {
    const b = await apptRow(apptB.id)
    chk('⚠️ הסטטוס הפך ל-cancelled_by_business', b.status === 'cancelled_by_business')
    chk('התור לא נמחק מהמערכת', b.id === apptB.id)
    chk('⚠️ אין בקשת מחיקה נוספת ליומן — האירוע כבר נמחק',
      b.calendar_sync_status === 'synced' && b.calendar_sync_operation === 'delete')

    const h = await historyOf(apptB.id)
    const cancels = h.filter(x => x.action === 'cancelled')
    chk('⚠️ נכתבה היסטוריית ביטול אחת בדיוק', cancels.length === 1)
    chk('הביטול confirmed→cancelled_by_business',
      cancels[0]?.from_status === 'confirmed' && cancels[0]?.to_status === 'cancelled_by_business')
    chk("הביטול system + source='google_calendar'",
      cancels[0]?.actor === 'system' && cancels[0]?.actor_id === null &&
      cancels[0]?.source === 'google_calendar')

    // הסלוט השתחרר
    const probe = await db.from('appointments').insert({
      customer_id: custA, service_key: 'עיצוב גבות טבעיות', variants: [],
      starts_at: at('13:00'), ends_at: at('13:00'), duration_min: 20, status: 'confirmed',
    }).select().single()
    chk('⚠️ הסלוט השתחרר', !probe.error, probe.error?.message ?? '')
    if (probe.data) await db.from('appointments').delete().eq('id', probe.data.id)
  }

  run = await runCalendarSync()
  chk('ריצה חוזרת אינה מבטלת שוב', run.stats.cancelled === 0)
  chk('⚠️ אין היסטוריית ביטול כפולה',
    (await historyOf(apptB.id)).filter(x => x.action === 'cancelled').length === 1)

  // ══════════════════════════════════════════════════════════════════════════
  section('אירוע ששוחזר אינו מחייה תור מבוטל')

  {
    // ⚠️ שחזור אירוע מחוק ב-Google הוא patch עם status='confirmed', ולא
    // insert מחדש: המזהה נשאר תפוס במצב cancelled, ו-insert עליו מחזיר
    // 409 "The requested identifier already exists". זה גם בדיוק המסלול
    // שבו שובל משחזרת אירוע מהממשק ("בטל מחיקה").
    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId: eventB,
      requestBody: {
        status: 'confirmed',
        summary: `${TEST_PREFIX} — שוחזר מהאשפה`,
        start: { dateTime: at('13:00'), timeZone: 'Asia/Jerusalem' },
        end: { dateTime: at('13:20'), timeZone: 'Asia/Jerusalem' },
      },
    })

    run = await runCalendarSync()
    chk('הסנכרון אחרי השחזור הצליח', run.ok, run.ok ? '' : run.message)

    const b = await apptRow(apptB.id)
    chk('⚠️ התור המבוטל לא חזר לחיים', b.status === 'cancelled_by_business')
    chk('⚠️ לא נכתבה היסטוריה נוספת',
      (await historyOf(apptB.id)).filter(x => x.action === 'cancelled').length === 1)

    const ev = await getEvent(eventB)
    chk('⚠️ האירוע המשוחזר נמחק שוב — היומן חוזר להסכים עם ה-DB', ev === null)

    const { data: issues } = await db.from('calendar_sync_issues')
      .select('*').eq('appointment_id', apptB.id).eq('kind', 'restored_after_cancel')
    chk('נרשמה תקלת שחזור אחת בדיוק', (issues ?? []).length === 1)
    chk('התקלה סומנה resolved אחרי המחיקה החוזרת', issues?.[0]?.status === 'resolved')
  }

  run = await runCalendarSync()
  chk('⚠️ ה-echo של המחיקה החוזרת אינו יוצר לולאה', run.stats.cancelled === 0)

  // ══════════════════════════════════════════════════════════════════════════
  section('שלמות התור והתקלות')

  {
    const { data: q } = await db.from('calendar_change_queue').select('status, result')
    const stuck = (q ?? []).filter(r => r.status === 'pending' || r.status === 'processing')
    chk('לא נשארו פריטים תקועים בתור', stuck.length === 0, `stuck=${stuck.length}`)
    const failedItems = (q ?? []).filter(r => r.status === 'failed')
    chk('לא נשארו פריטים כושלים', failedItems.length === 0, `failed=${failedItems.length}`)

    const { data: openIssues } = await db.from('calendar_sync_issues')
      .select('kind').eq('status', 'open')
    chk('אין תקלות פתוחות בסיום', (openIssues ?? []).length === 0,
      (openIssues ?? []).map(i => i.kind).join(', '))

    // ⚠️ הרגרסיה שהתגלתה ב-full sync הראשון על היומן האמיתי: אירוע מערכת
    // *מחוק* שהתור שלו כבר אינו קיים אינו אנומליה — אין אירוע, אין תור,
    // מצב היעד הושג. הוא חייב להירשם בתור (שרשרת ביקורת) אבל *לא* לפתוח
    // תקלה, אחרת 62 שאריות של בדיקות קודמות קוברות תקלה אמיתית אחת.
    const settledResults = (q ?? []).filter(
      r => r.result === 'orphaned_event' || r.result === 'ambiguous_ownership')
    chk('שאריות מחוקות נרשמו בתור לצורך ביקורת',
      settledResults.length > 0, `רשומות=${settledResults.length}`)
    chk('⚠️ כולן ignored ולא failed',
      settledResults.every(r => r.status === 'ignored'))
    chk('⚠️ אף אחת מהן לא פתחה תקלה למנהלת',
      (openIssues ?? []).filter(
        i => i.kind === 'orphaned_event' || i.kind === 'ambiguous_ownership').length === 0)
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
      chk(`אירוע יומן נמחק: ${eventId.slice(0, 20)}…`)
    } catch (err) {
      const status = err?.response?.status ?? err?.code
      if (status === 404 || status === 410) chk(`אירוע כבר לא היה קיים: ${eventId.slice(0, 20)}…`)
      else chk(`מחיקת אירוע ${eventId.slice(0, 20)}… נכשלה`, false, err.message)
    }
  }

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

  // תקלות ופריטי תור של נתוני הבדיקה
  for (const id of createdAppointmentIds) {
    await db.from('calendar_sync_issues').delete().eq('appointment_id', id)
    await db.from('calendar_change_queue').delete().eq('appointment_id', id)
  }
  {
    const { data: q } = await db.from('calendar_change_queue').select('id')
    for (const row of q ?? []) {
      await db.from('calendar_sync_issues').delete().eq('queue_id', row.id)
    }
    await db.from('calendar_change_queue').delete().neq('id', 0)
    await db.from('calendar_sync_issues').delete().neq('id', 0)
    const { count: qLeft } = await db.from('calendar_change_queue')
      .select('id', { count: 'exact', head: true })
    const { count: iLeft } = await db.from('calendar_sync_issues')
      .select('id', { count: 'exact', head: true })
    chk('תור השינויים ותקלות הסנכרון נוקו', qLeft === 0 && iLeft === 0,
      `queue=${qLeft} issues=${iLeft}`)
  }

  // ⚠️ מצב הסנכרון מאופס — ההרצה האמיתית הראשונה תתחיל מדף חלק
  {
    const { error } = await db.from('calendar_sync_state').update({
      sync_token: null, base_sync_token: null, page_token: null, sync_mode: null,
      sync_started_at: null, calendar_fingerprint: null,
      last_full_sync_at: null, last_incremental_sync_at: null,
      last_run_at: null, last_run_status: null, last_run_error: null, last_run_stats: null,
      token_reset_count: 0, calendar_changed_count: 0,
      lease_owner: null, lease_started_at: null,
    }).eq('id', true)
    chk('מצב הסנכרון אופס לקראת ההרצה האמיתית', !error, error?.message ?? '')
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

  const { data: admins } = await db.from('admins').select('user_id')
  chk('שני המנהלים האמיתיים עדיין קיימים', admins?.length === 2, `count=${admins?.length}`)

  const failed = results.filter(r => !r).length
  console.log('\n' + '═'.repeat(60))
  console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
  process.exit(failed === 0 && exitCode === 0 ? 0 : 1)
}
