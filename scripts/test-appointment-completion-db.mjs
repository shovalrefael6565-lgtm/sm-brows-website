/**
 * בדיקות שלב 16 — 0029 (סיום תור אוטומטי + סימון אי-הגעה) מול Postgres
 * אמיתי (PGlite). כל המיגרציות (0001–0029) רצות מאפס על מסד זמני בזיכרון —
 * אין כאן שום חיבור ל-Supabase האמיתי, ולכן אין שום סיכון לנתוני פרודקשן.
 *
 * המיקוד:
 *
 *   1. 🔒 complete_past_confirmed_appointments — confirmed שה-ends_at שלו
 *      עבר הופך ל-completed, שורת היסטוריה אחת בדיוק, actor='system'.
 *      idempotent: ריצה שנייה לא כותבת שורה נוספת. תור עתידי, וסטטוסים
 *      אחרים, אינם נגועים.
 *
 *   2. 🔒 mark_appointment_no_show — עובד משני מצבים (completed, ו-
 *      confirmed שה-ends_at שלו עבר) וכותב שורת היסטוריה אחת עם ה-
 *      from_status **האמיתי** (אין completed מדומה בדרך confirmed→no_show
 *      הישירה). חסום לפני שהתור הסתיים, ו-idempotent על לחיצה כפולה.
 *
 *   3. 🔒 **אין שום התראה** — לא על סיום ולא על אי-הגעה. שתי הפעולות
 *      נבדקות מול appointment_notifications בפועל, לא רק מול קוד המקור.
 *
 *   4. 🔒 רגרסיה — cancel_confirmed_appointment_by_admin ממשיכה לדחות תור
 *      שכבר התחיל (in_past), בדיוק כמו לפני 0029.
 *
 * הרצה:  npm run test:appointment-completion-db
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
chk('0029 ברשימה', migrations.includes('0029_appointment_completion.sql'))

// 🔒 בדיוק כמו test-15h-db: בלי זה כל בדיקת "אין התראה" הייתה עוברת מול
// אפס שורות בין כה וכה — ולא הייתה בודקת דבר.
await db.query(
  `update public.business_settings set value='true'::jsonb where key='notifications_enabled'`)

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
const hours = h => new Date(Date.now() + h * 3600_000).toISOString()

/*
 * 🔒 appointments_no_overlap (0001) בודק חפיפת טווחים על **כל** תור
 * pending/confirmed, בלי תלות בלקוחה. שימוש חזרתי באותו "לפני שעתיים" בכמה
 * תורים היה מייצר 23P01 אצל שני תורי pending/confirmed שחופפים בטעות.
 * מרווח קבוע של 3 שעות בין כל שני תורי-עבר בקובץ מבטל את הסיכון הזה כליל.
 */
let pastSlot = 0
const pastHours = () => -(3 + (pastSlot++ * 3))

const ADMIN = '11111111-1111-1111-1111-111111111111'
const OUTSIDER = '22222222-2222-2222-2222-222222222222'

await db.query(`insert into auth.users (id) values ($1), ($2)`, [ADMIN, OUTSIDER])
await db.query(`insert into public.admins (user_id) values ($1)`, [ADMIN])

let phoneSeq = 0
const nextPhone = () => `+9725${String(30000000 + phoneSeq++).slice(-8)}`

async function makeCustomer(name = 'לקוחה בדיקה') {
  return one(
    `insert into public.customers (phone_e164, full_name) values ($1,$2) returning *`,
    [nextPhone(), name],
  )
}

/** תור גולמי, סטטוס ו-starts_at חופשיים — כדי לשלוט על ends_at ישירות. */
async function makeAppointment(customerId, status, startsAt) {
  return one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, calendar_sync_status, calendar_sync_operation)
     values ($1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, 20, $3, 'synced', 'upsert')
     returning *`,
    [customerId, startsAt, status],
  )
}

async function history(appointmentId) {
  return all(
    `select action, from_status, to_status, actor, actor_id
     from public.appointment_history where appointment_id=$1 order by id`,
    [appointmentId],
  )
}

async function notifsFor(appointmentId) {
  const rows = await all(
    `select event, recipient_role from public.appointment_notifications
     where appointment_id = $1`,
    [appointmentId],
  )
  return rows.map(r => `${r.event}/${r.recipient_role}`)
}

const sweep = () => db.query(`select public.complete_past_confirmed_appointments()`)
const markNoShow = (apptId, adminId = ADMIN) =>
  one(`select public.mark_appointment_no_show($1,$2) as r`, [apptId, adminId])
const cancelByAdmin = (apptId, adminId = ADMIN) =>
  one(`select public.cancel_confirmed_appointment_by_admin($1,$2) as r`, [apptId, adminId])

// ════════════════════════════════════════════════════════════════════════════
section('0029 — סיום תור אוטומטי')

{
  const c = await makeCustomer()
  // ends_at = starts_at(20 min ago) + 20min = now, כדי לוודא <= now() כולל שוויון
  const a = await makeAppointment(c.id, 'confirmed', hours(pastHours()))
  await sweep()

  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk('confirmed שהסתיים לפני שעה → completed', row.status === 'completed', row.status)

  const hist = await history(a.id)
  chk('שורת היסטוריה אחת בדיוק', hist.length === 1, `n=${hist.length}`)
  chk('action=status_changed · confirmed→completed · actor=system, actor_id=null',
    hist[0]?.action === 'status_changed' && hist[0]?.from_status === 'confirmed'
    && hist[0]?.to_status === 'completed' && hist[0]?.actor === 'system'
    && hist[0]?.actor_id === null,
    JSON.stringify(hist[0]))

  chk('🔒 אין שום התראה על סיום תור', (await notifsFor(a.id)).length === 0)

  await sweep()
  const histAgain = await history(a.id)
  chk('🔒 idempotent — ריצה שנייה לא כותבת שורה נוספת', histAgain.length === 1,
    `n=${histAgain.length}`)
}

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(48))
  await sweep()
  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk('confirmed עתידי אינו נגוע ע"י ה-sweep', row.status === 'confirmed', row.status)
  chk('אין שורת היסטוריה על תור עתידי', (await history(a.id)).length === 0)
}

for (const status of ['pending', 'cancelled_by_customer', 'cancelled_by_business', 'rejected', 'no_show', 'completed']) {
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, status, hours(pastHours()))
  await sweep()
  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk(`ה-sweep אינו נוגע בסטטוס '${status}'`, row.status === status, row.status)
}

// ════════════════════════════════════════════════════════════════════════════
section('0029 — סימון אי-הגעה: ממצב completed')

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'completed', hours(pastHours()))
  const res = (await markNoShow(a.id)).r

  chk('outcome=applied', res.outcome === 'applied', res.outcome)
  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk('הסטטוס הוא no_show', row.status === 'no_show', row.status)

  const hist = await history(a.id)
  chk('שורת היסטוריה אחת · completed→no_show · actor=admin עם המזהה האמיתי',
    hist.length === 1 && hist[0].from_status === 'completed' && hist[0].to_status === 'no_show'
    && hist[0].actor === 'admin' && hist[0].actor_id === ADMIN,
    JSON.stringify(hist[0]))

  chk('🔒 אין שום התראה על אי-הגעה', (await notifsFor(a.id)).length === 0)

  const second = (await markNoShow(a.id)).r
  chk('🔒 idempotency — לחיצה שנייה מחזירה already_no_show', second.outcome === 'already_no_show',
    second.outcome)
  chk('🔒 אין שורת היסטוריה שנייה', (await history(a.id)).length === 1)
}

section('0029 — סימון אי-הגעה: ישירות מ-confirmed שהסתיים (ה-sweep עדיין לא רץ)')

{
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(pastHours()))
  const res = (await markNoShow(a.id)).r

  chk('outcome=applied ישירות מ-confirmed', res.outcome === 'applied', res.outcome)
  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk('הסטטוס הוא no_show', row.status === 'no_show', row.status)

  const hist = await history(a.id)
  chk('🔒 שורת היסטוריה אחת בדיוק — אין completed מדומה בדרך',
    hist.length === 1, `n=${hist.length}`)
  chk('🔒 from_status הוא confirmed **האמיתי**, לא completed',
    hist[0]?.from_status === 'confirmed' && hist[0]?.to_status === 'no_show',
    JSON.stringify(hist[0]))
  chk('actor=admin עם המזהה האמיתי', hist[0]?.actor === 'admin' && hist[0]?.actor_id === ADMIN)

  chk('🔒 אין שום התראה', (await notifsFor(a.id)).length === 0)
}

section('0029 — חסימות')

{
  // 🔒 לפני שהתור הסתיים — אסור.
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'confirmed', hours(2))
  const res = (await markNoShow(a.id)).r
  chk('🔒 confirmed עתידי → not_ended (לא ניתן לסמן אי-הגעה מראש)',
    res.outcome === 'not_ended', res.outcome)
  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk('הסטטוס לא השתנה', row.status === 'confirmed', row.status)
  chk('אין שורת היסטוריה', (await history(a.id)).length === 0)
}

for (const status of ['pending', 'cancelled_by_customer', 'cancelled_by_business', 'rejected']) {
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, status, hours(pastHours()))
  const res = (await markNoShow(a.id)).r
  chk(`סטטוס '${status}' → not_eligible`, res.outcome === 'not_eligible', res.outcome)
  chk(`current_status מדווח נכון עבור '${status}'`, res.current_status === status)
  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk(`הסטטוס '${status}' לא השתנה`, row.status === status, row.status)
}

{
  // מנהלת שאינה קיימת בטבלת admins.
  const c = await makeCustomer()
  const a = await makeAppointment(c.id, 'completed', hours(pastHours()))
  let threw = false
  try {
    await markNoShow(a.id, OUTSIDER)
  } catch (e) {
    threw = /NOT_ADMIN/.test(e.message)
  }
  chk('🔒 קריאה עם מזהה שאינו מנהלת נדחית (NOT_ADMIN)', threw)
  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk('התור לא השתנה', row.status === 'completed', row.status)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 רגרסיה — הביטול הניהולי (0027) ממשיך לחסום תור שהתחיל')

{
  const c = await makeCustomer()
  const past = await makeAppointment(c.id, 'confirmed', hours(pastHours()))
  const res = (await cancelByAdmin(past.id)).r
  chk('🔒 ביטול תור שכבר התחיל נדחה (in_past), גם אחרי 0029',
    res.outcome === 'in_past', `outcome=${res.outcome}`)
  const row = await one(`select status from public.appointments where id=$1`, [past.id])
  chk('התור נשאר confirmed', row.status === 'confirmed', row.status)
}

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✓' : '✗'} ${results.length - failed}/${results.length} עברו`)
if (failed > 0) process.exit(1)
