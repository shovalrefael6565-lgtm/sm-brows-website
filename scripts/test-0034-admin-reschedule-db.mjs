/**
 * בדיקות 0034 (שינוי מועד ניהולי + סימון "הושלם") מול Postgres אמיתי
 * (PGlite). כל המיגרציות רצות מאפס על מסד זמני בזיכרון — אין כאן שום
 * חיבור ל-Supabase האמיתי, ולכן אין שום סיכון לנתוני פרודקשן.
 *
 * המיקוד — חמישה דברים שאין דרך לתקן בדיעבד:
 *
 *   1. 🔒 **התזכורות מתעדכנות דרך המנגנון הקיים, בלי כפילות.** ההזזה אינה
 *      כותבת לתזכורות בכלל; הטריגר appointments_sync_reminders_update
 *      (0011) הוא שמסמן את הישנות 'superseded' ויוצר חדשות למועד החדש.
 *      נבדק שיש בדיוק שתי תזכורות פעילות אחרי ההזזה — לא ארבע.
 *
 *   2. 🔒 **היומן חוזר למסלול upsert על אותו אירוע.** google_event_id
 *      נשמר כפי שהוא, ה-operation נשאר 'upsert' (ולא 'delete'), והשורה
 *      הופכת ל-claimable — כלומר patch על האירוע הקיים, לא אירוע שני.
 *
 *   3. 🔒 **אין SMS.** לא על הזזה ולא על סימון הושלם. נבדק מול
 *      appointment_notifications בפועל, לא מול קוד המקור.
 *
 *   4. 🔒 **reschedule_count אינו גדל** — מכסת ההזזות העצמיות של הלקוחה
 *      אינה נשרפת בגלל הזזה שיזמה שובל.
 *
 *   5. 🔒 כל שערי הזכאות: לא-confirmed, שורת בקשה, עבר משני הכיוונים,
 *      בקשת שינוי מועד ממתינה, lease סנכרון פעיל, חפיפה, ו-idempotency.
 *
 * הרצה:  npm run test:0034-admin-reschedule-db
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(70)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url)

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
  create role service_role; create role authenticated; create role anon;
`)

section('מיגרציות')
const migrations = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()
for (const f of migrations) {
  try {
    await db.exec(readFileSync(new URL(f, MIG_DIR), 'utf8'))
  } catch (e) {
    chk(`${f} רצה`, false, e.message)
    process.exit(1)
  }
}
chk(`כל ${migrations.length} המיגרציות רצו לפי הסדר`)
chk('0034 ברשימה', migrations.includes('0034_admin_reschedule_and_completion.sql'))

// 🔒 בלי זה כל בדיקת "אין התראה" הייתה עוברת מול אפס שורות בין כה וכה.
await db.query(
  `update public.business_settings set value='true'::jsonb where key='notifications_enabled'`)

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
const hours = h => new Date(Date.now() + h * 3600_000).toISOString()

const ADMIN = '11111111-1111-1111-1111-111111111111'
const OUTSIDER = '22222222-2222-2222-2222-222222222222'

await db.query(`insert into auth.users (id) values ($1), ($2)`, [ADMIN, OUTSIDER])
await db.query(`insert into public.admins (user_id) values ($1)`, [ADMIN])

let phoneSeq = 0
const nextPhone = () => `+9725${String(40000000 + phoneSeq++).slice(-8)}`

async function makeCustomer(name = 'לקוחה בדיקה') {
  return one(
    `insert into public.customers (phone_e164, full_name) values ($1,$2) returning *`,
    [nextPhone(), name],
  )
}

/**
 * ⚠️ appointments_no_overlap (0001) חל על **כל** תור pending/confirmed בלי
 * תלות בלקוחה, ולכן כל תור בקובץ מקבל שעה משלו. מרווח של 4 שעות בין
 * סלוטים מבטל התנגשויות מקריות בין בדיקות.
 */
let slot = 0
const futureHours = () => 100 + (slot++ * 4)
let pastSlot = 0
const pastHours = () => -(3 + (pastSlot++ * 4))

async function makeAppointment(customerId, status, startsAt, extra = {}) {
  return one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, calendar_sync_status, calendar_sync_operation, google_event_id,
        reschedule_of_appointment_id, calendar_sync_started_at)
     values ($1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, $3, $4, $5, 'upsert', $6, $7, $8::timestamptz)
     returning *`,
    [
      customerId, startsAt, extra.durationMin ?? 20, status,
      extra.syncStatus ?? 'synced', extra.eventId ?? 'smbapptexistingevent0001',
      extra.rescheduleOf ?? null, extra.syncStartedAt ?? null,
    ],
  )
}

async function history(appointmentId) {
  return all(
    `select action, from_status, to_status, from_starts_at, to_starts_at, actor, actor_id, source
     from public.appointment_history where appointment_id=$1 order by id`,
    [appointmentId],
  )
}

async function notifsFor(appointmentId) {
  const rows = await all(
    `select event, recipient_role from public.appointment_notifications where appointment_id=$1`,
    [appointmentId],
  )
  return rows.map(r => `${r.event}/${r.recipient_role}`)
}

async function reminders(appointmentId) {
  return all(
    `select reminder_kind, status, outcome_reason, appointment_starts_at
     from public.appointment_reminders where appointment_id=$1 order by id`,
    [appointmentId],
  )
}

const move = (apptId, startsAt, durationMin = null, adminId = ADMIN) =>
  one(`select public.admin_reschedule_appointment($1,$2::timestamptz,$3,$4) as r`,
    [apptId, startsAt, durationMin, adminId])

const complete = (apptId, adminId = ADMIN) =>
  one(`select public.mark_appointment_completed($1,$2) as r`, [apptId, adminId])

// ════════════════════════════════════════════════════════════════════════════
section('0034 — הזזה מוצלחת')

{
  const c = await makeCustomer()
  const from = hours(futureHours())
  const to = hours(futureHours())
  const a = await makeAppointment(c.id, 'confirmed', from)

  const before = await reminders(a.id)
  chk('לפני ההזזה: שתי תזכורות מתוזמנות למועד המקורי',
    before.filter(r => r.status === 'scheduled').length === 2, `n=${before.length}`)

  const res = (await move(a.id, to)).r
  chk('outcome=applied', res.outcome === 'applied', res.outcome)

  const row = await one(`select * from public.appointments where id=$1`, [a.id])
  chk('starts_at זז למועד החדש',
    new Date(row.starts_at).getTime() === new Date(to).getTime())
  chk('ends_at חושב מחדש ע"י הטריגר (starts_at + 20 דק׳)',
    new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime() === 20 * 60_000)
  chk('הסטטוס נשאר confirmed', row.status === 'confirmed', row.status)
  chk('original_starts_at שומר את המועד המקורי',
    new Date(row.original_starts_at).getTime() === new Date(from).getTime())

  // ── 🔒 מכסת ההזזות העצמיות של הלקוחה ──
  chk('🔒 reschedule_count אינו גדל (מכסת הלקוחה אינה נשרפת)',
    row.reschedule_count === 0, `count=${row.reschedule_count}`)

  // ── 🔒 היומן: אותו אירוע, מסלול upsert ──
  chk('🔒 google_event_id נשמר — אין אירוע שני',
    row.google_event_id === 'smbapptexistingevent0001', String(row.google_event_id))
  chk('🔒 operation=upsert (ולא delete — האירוע זז, לא נמחק)',
    row.calendar_sync_operation === 'upsert', row.calendar_sync_operation)
  chk('calendar_sync_status=pending — חוזר למסלול הסנכרון הקיים',
    row.calendar_sync_status === 'pending', row.calendar_sync_status)
  chk('calendar_sync_error התאפס', row.calendar_sync_error === null)

  const claimed = await one(`select public.claim_calendar_sync($1) as r`, [a.id])
  chk('🔒 השורה claimable ע"י claim_calendar_sync הקיימת (בלי שינוי ב-0027)',
    claimed.r !== null)

  // ── היסטוריה ──
  const hist = await history(a.id)
  chk('שורת היסטוריה אחת בדיוק', hist.length === 1, `n=${hist.length}`)
  chk('action=rescheduled · confirmed→confirmed · actor=admin · source=admin_dashboard',
    hist[0]?.action === 'rescheduled' && hist[0]?.from_status === 'confirmed' &&
    hist[0]?.to_status === 'confirmed' && hist[0]?.actor === 'admin' &&
    hist[0]?.actor_id === ADMIN && hist[0]?.source === 'admin_dashboard',
    JSON.stringify(hist[0]))
  chk('שתי השעות מתועדות בהיסטוריה',
    new Date(hist[0]?.from_starts_at).getTime() === new Date(from).getTime() &&
    new Date(hist[0]?.to_starts_at).getTime() === new Date(to).getTime())

  // ── 🔒 אין SMS ──
  chk('🔒 אין שום התראה על הזזה ניהולית', (await notifsFor(a.id)).length === 0)

  // ── 🔒 תזכורות: המנגנון הקיים, בלי כפילות ──
  const after = await reminders(a.id)
  const active = after.filter(r => ['scheduled', 'retrying'].includes(r.status))
  const superseded = after.filter(r => r.status === 'superseded')
  chk('🔒 בדיוק שתי תזכורות פעילות אחרי ההזזה — לא ארבע',
    active.length === 2, `active=${active.length} total=${after.length}`)
  chk('🔒 התזכורות של המועד הישן סומנו superseded/starts_at_changed',
    superseded.length === 2 &&
    superseded.every(r => r.outcome_reason === 'starts_at_changed'),
    `n=${superseded.length}`)
  chk('🔒 התזכורות הפעילות מצביעות על המועד **החדש**',
    active.every(r => new Date(r.appointment_starts_at).getTime() === new Date(to).getTime()))
  chk('שתי התזכורות הפעילות הן day_before ו-two_hours_before',
    new Set(active.map(r => r.reminder_kind)).size === 2)
}

// ════════════════════════════════════════════════════════════════════════════
section('0034 — שינוי משך')

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(futureHours()))
  const to = hours(futureHours())

  const res = (await move(a.id, to, 90)).r
  chk('משך חדש מתקבל', res.outcome === 'applied', res.outcome)
  const row = await one(`select * from public.appointments where id=$1`, [a.id])
  chk('duration_min עודכן ל-90', row.duration_min === 90, String(row.duration_min))
  chk('ends_at נגזר מהמשך החדש',
    new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime() === 90 * 60_000)
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(futureHours()), { durationMin: 40 })
  const to = hours(futureHours())
  await move(a.id, to, null)
  const row = await one(`select duration_min from public.appointments where id=$1`, [a.id])
  chk('משך null = המשך הקיים נשמר', row.duration_min === 40, String(row.duration_min))
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(futureHours()))
  const to = hours(futureHours())
  let threw = null
  try { await move(a.id, to, 4) } catch (e) { threw = e.message }
  chk('משך מתחת ל-5 → INVALID_DURATION', /INVALID_DURATION/.test(threw ?? ''), String(threw))
  threw = null
  try { await move(a.id, to, 481) } catch (e) { threw = e.message }
  chk('משך מעל 480 → INVALID_DURATION', /INVALID_DURATION/.test(threw ?? ''), String(threw))
}

// ════════════════════════════════════════════════════════════════════════════
section('0034 — שערי זכאות')

{
  const c = await makeCustomer()
  const start = hours(futureHours())
  const a = await makeAppointment(c.id, 'confirmed', start)
  const res = (await move(a.id, start)).r
  chk('🔒 אותו מועד בדיוק → no_change, בלי כתיבה', res.outcome === 'no_change', res.outcome)
  chk('no_change אינו כותב היסטוריה', (await history(a.id)).length === 0)
  const rem = await reminders(a.id)
  chk('no_change אינו מסמן תזכורות superseded',
    rem.every(r => r.status !== 'superseded'))
  const row = await one(`select calendar_sync_status from public.appointments where id=$1`, [a.id])
  chk('no_change אינו מחזיר את השורה לסנכרון', row.calendar_sync_status === 'synced',
    row.calendar_sync_status)
}

for (const status of ['pending', 'completed', 'cancelled_by_customer', 'cancelled_by_business', 'no_show', 'rejected']) {
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, status, hours(futureHours()))
  const res = (await move(a.id, hours(futureHours()))).r
  chk(`סטטוס '${status}' → not_confirmed`,
    res.outcome === 'not_confirmed' && res.current_status === status, res.outcome)
}

{
  const c = await makeCustomer()
  const orig = await makeAppointment(c.id, 'confirmed', hours(futureHours()))
  const req = await makeAppointment(c.id, 'confirmed', hours(futureHours()), { rescheduleOf: orig.id })
  const res = (await move(req.id, hours(futureHours()))).r
  chk('🔒 שורת בקשת שינוי מועד → is_request_row', res.outcome === 'is_request_row', res.outcome)
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(pastHours()))
  const res = (await move(a.id, hours(futureHours()))).r
  chk('🔒 תור שכבר התחיל → in_past (אין הזזה רטרואקטיבית)',
    res.outcome === 'in_past', res.outcome)
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(futureHours()))
  const res = (await move(a.id, hours(pastHours()))).r
  chk('🔒 יעד בעבר → target_in_past', res.outcome === 'target_in_past', res.outcome)
}

{
  const c = await makeCustomer()
  const orig = await makeAppointment(c.id, 'confirmed', hours(futureHours()))
  await makeAppointment(c.id, 'pending', hours(futureHours()), { rescheduleOf: orig.id })
  const res = (await move(orig.id, hours(futureHours()))).r
  chk('🔒 בקשת שינוי מועד ממתינה → open_reschedule_request (לא סוגרים אותה בשקט)',
    res.outcome === 'open_reschedule_request', res.outcome)
  chk('התור המקורי לא זז', (await history(orig.id)).length === 0)
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(futureHours()), {
    syncStatus: 'syncing', syncStartedAt: new Date().toISOString(),
  })
  const res = (await move(a.id, hours(futureHours()))).r
  chk('🔒 lease סנכרון פעיל → sync_in_progress', res.outcome === 'sync_in_progress', res.outcome)
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(futureHours()), {
    syncStatus: 'syncing',
    syncStartedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  })
  const res = (await move(a.id, hours(futureHours()))).r
  chk('lease שפג (מעל 2 דק׳) אינו חוסם', res.outcome === 'applied', res.outcome)
}

{
  const c1 = await makeCustomer()
  const c2 = await makeCustomer()
  const taken = hours(futureHours())
  await makeAppointment(c1.id, 'confirmed', taken)
  const a = await makeAppointment(c2.id, 'confirmed', hours(futureHours()))
  let threw = null
  try { await move(a.id, taken) } catch (e) { threw = e.message }
  chk('🔒 הזזה למועד תפוס נחסמת ע"י appointments_no_overlap (23P01)',
    /overlap|23P01|exclu/i.test(threw ?? ''), String(threw).slice(0, 60))
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(futureHours()))
  let threw = null
  try { await move(a.id, hours(futureHours()), null, OUTSIDER) } catch (e) { threw = e.message }
  chk('🔒 משתמש שאינו מנהל → NOT_ADMIN', /NOT_ADMIN/.test(threw ?? ''), String(threw))
  threw = null
  try { await move(a.id, hours(futureHours()), null, null) } catch (e) { threw = e.message }
  chk('🔒 בלי מזהה מנהל → ADMIN_REQUIRED', /ADMIN_REQUIRED/.test(threw ?? ''), String(threw))
  chk('אף אחד מהניסיונות לא הזיז את התור', (await history(a.id)).length === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('0034 — סימון "הושלם"')

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(pastHours()))
  const res = (await complete(a.id)).r
  chk('confirmed שהסתיים → applied', res.outcome === 'applied', res.outcome)

  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk('הסטטוס completed', row.status === 'completed', row.status)

  const hist = await history(a.id)
  chk('שורת היסטוריה אחת בדיוק', hist.length === 1, `n=${hist.length}`)
  chk('action=status_changed · confirmed→completed · actor=admin',
    hist[0]?.action === 'status_changed' && hist[0]?.from_status === 'confirmed' &&
    hist[0]?.to_status === 'completed' && hist[0]?.actor === 'admin' &&
    hist[0]?.actor_id === ADMIN, JSON.stringify(hist[0]))

  chk('🔒 אין שום התראה על סימון הושלם', (await notifsFor(a.id)).length === 0)

  const again = (await complete(a.id)).r
  chk('🔒 לחיצה חוזרת → already_completed (ולא "לא זכאי")',
    again.outcome === 'already_completed', again.outcome)
  chk('🔒 idempotent — אין שורת היסטוריה שנייה', (await history(a.id)).length === 1)
  chk('🔒 גם בלחיצה החוזרת אין התראה', (await notifsFor(a.id)).length === 0)
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(futureHours()))
  const res = (await complete(a.id)).r
  chk('🔒 תור שטרם הסתיים → not_ended', res.outcome === 'not_ended', res.outcome)
  chk('לא נכתבה היסטוריה', (await history(a.id)).length === 0)
}

for (const status of ['pending', 'cancelled_by_customer', 'cancelled_by_business', 'no_show', 'rejected', 'expired']) {
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, status, hours(pastHours()))
  const res = (await complete(a.id)).r
  chk(`סטטוס '${status}' → not_eligible`,
    res.outcome === 'not_eligible' && res.current_status === status, res.outcome)
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(pastHours()))
  let threw = null
  try { await complete(a.id, OUTSIDER) } catch (e) { threw = e.message }
  chk('🔒 משתמש שאינו מנהל → NOT_ADMIN', /NOT_ADMIN/.test(threw ?? ''), String(threw))
  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk('התור לא סומן', row.status === 'confirmed', row.status)
}

{
  // ה-sweep של 0029 וה-סימון הידני כותבים בדיוק את אותו מעבר. הראשון
  // שמגיע מנצח, והשני רואה שורה שכבר completed.
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(pastHours()))
  await db.query(`select public.complete_past_confirmed_appointments()`)
  const res = (await complete(a.id)).r
  chk('🔒 אחרי ה-sweep של 0029 → already_completed, בלי היסטוריה כפולה',
    res.outcome === 'already_completed' && (await history(a.id)).length === 1, res.outcome)
}

// ════════════════════════════════════════════════════════════════════════════
section('0034 — הרשאות ורגרסיה')

{
  const rows = await all(
    `select p.proname,
            has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
            has_function_privilege('service_role', p.oid, 'EXECUTE')  as svc
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public'
       and p.proname in ('admin_reschedule_appointment','mark_appointment_completed')`)
  chk('שתי הפונקציות קיימות', rows.length === 2, `n=${rows.length}`)
  chk('🔒 anon=false, authenticated=false, service_role=true לשתיהן',
    rows.every(r => r.anon === false && r.auth === false && r.svc === true),
    JSON.stringify(rows.map(r => [r.proname, r.anon, r.auth, r.svc])))
}

{
  // רגרסיה: 0034 לא נגעה בפונקציות קיימות.
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(pastHours()))
  const res = (await one(
    `select public.cancel_confirmed_appointment_by_admin($1,$2) as r`, [a.id, ADMIN])).r
  chk('רגרסיה: ביטול ניהולי ממשיך לדחות תור שהתחיל (in_past)',
    res.outcome === 'in_past', res.outcome)

  const c2 = await makeCustomer()
  const a2 = await makeAppointment(c2.id, 'confirmed', hours(pastHours()))
  const ns = (await one(`select public.mark_appointment_no_show($1,$2) as r`, [a2.id, ADMIN])).r
  chk('רגרסיה: סימון אי-הגעה (0029) ממשיך לעבוד', ns.outcome === 'applied', ns.outcome)
}

// ════════════════════════════════════════════════════════════════════════════
const passed = results.filter(Boolean).length
console.log(`\n${'═'.repeat(60)}`)
if (passed === results.length) {
  console.log(`✓ כל ${results.length} הבדיקות עברו`)
} else {
  console.log(`✗ ${results.length - passed} מתוך ${results.length} נכשלו`)
  process.exit(1)
}
