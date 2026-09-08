/**
 * בדיקות 0037 (רשימת המתנה) מול Postgres אמיתי (PGlite). כל המיגרציות
 * רצות מאפס על מסד זמני בזיכרון — אין כאן שום חיבור ל-Supabase האמיתי,
 * ולכן אין שום סיכון לנתוני פרודקשן.
 *
 * המיקוד הוא בדיוק בדרישות 8–11: שבקשת המתנה **אינה** תור.
 *
 *   8.  אינה יוצרת appointment
 *   9.  אינה חוסמת availability
 *   10. אינה יוצרת אירוע ביומן (calendar_change_queue)
 *   11. אינה מפעילה תזכורות (appointment_reminders) ואינה מפעילה
 *       התראות/SMS (appointment_notifications)
 *
 * ובנוסף: ה-partial unique index (בקשה סגורה אינה חוסמת מועד עתידי),
 * שלוש מגבלות הקצב, קישור הלקוחה ללא כפילות, ושהדיוור לא נגע.
 *
 * הרצה:  npm run test:waitlist-db
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(66)}${extra}`)
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
chk('0037 ברשימה', migrations.includes('0037_waitlist_requests.sql'))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
const count = async (t, where = 'true') => Number((await one(`select count(*)::int c from ${t} where ${where}`)).c)
const hours = h => new Date(Date.now() + h * 3600_000).toISOString()

const NATURAL = 'עיצוב גבות טבעיות'
const PV = '2026-08-01'
const IP = '203.0.113.9'

const create = (over = {}) => {
  const p = {
    phone: '+972501112233', name: 'לקוחת בדיקה', service: NATURAL, variants: [],
    duration: 20, at: hours(48), ip: IP, cap: 5, pv: PV, ack: true, ...over,
  }
  return one(
    `select * from public.create_waitlist_request($1,$2,$3,$4,$5,$6::timestamptz,$7::inet,$8,$9,$10)`,
    [p.phone, p.name, p.service, p.variants, p.duration, p.at, p.ip, p.cap, p.pv, p.ack],
  )
}
const errOf = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }

// ─────────────────────────────────────────────────────────────────────────────
section('8–11 — 🔒 בקשת המתנה אינה תור')

const before = {
  appointments:  await count('public.appointments'),
  reminders:     await count('public.appointment_reminders'),
  notifications: await count('public.appointment_notifications'),
  calendar:      await count('public.calendar_change_queue'),
}

const row = await create()
chk('נוצרה בקשת המתנה', !!row?.id)
chk('סטטוס פתיחה הוא open', row.status === 'open')
chk('🔒 privacy_notice נשמר עם זמן השרת',
  row.privacy_notice_version === PV && !!row.privacy_notice_acknowledged_at)

chk('8.  🔒 לא נוצר appointment',
  await count('public.appointments') === before.appointments)
chk('11. 🔒 לא נוצרה תזכורת',
  await count('public.appointment_reminders') === before.reminders)
chk('11. 🔒 לא נוצרה התראה/SMS',
  await count('public.appointment_notifications') === before.notifications)
chk('10. 🔒 לא נוצר אירוע ביומן',
  await count('public.calendar_change_queue') === before.calendar)

// 9 — availability: המסלול היחיד שקורא תפוסה מה-DB הוא שאילתת appointments
// (lib/db/appointments.ts). כאן מדובבים אותה בדיוק, ומוודאים שהיא עיוורת
// לרשימת ההמתנה.
const busy = await all(
  `select starts_at, ends_at from public.appointments
   where status in ('pending','confirmed')`)
chk('9.  🔒 שאילתת התפוסה אינה רואה את בקשת ההמתנה', busy.length === 0)

chk('🔒 אין ולו טריגר אחד על waitlist_requests',
  await count(`pg_trigger`, `tgrelid = 'public.waitlist_requests'::regclass and not tgisinternal`) === 0)

// ─────────────────────────────────────────────────────────────────────────────
section('קישור לקוחה — ללא כפילות, ללא נגיעה בדיוור')

const cust = await one(`select * from public.customers where id = $1`, [row.customer_id])
chk('הבקשה קשורה ללקוחה קיימת/חדשה', !!cust)
chk('🔒 הטלפון מנורמל ל-E.164', cust.phone_e164 === '+972501112233')
chk('🔒 אין שם/טלפון על waitlist_requests',
  !('full_name' in row) && !('phone_e164' in row) && !('phone' in row))

await create({ at: hours(72) })
chk('🔒 בקשה שנייה לאותו טלפון לא יצרה לקוחה כפולה',
  await count('public.customers', `phone_e164 = '+972501112233'`) === 1)

chk('🔒 marketing_consent לא נגע', cust.marketing_consent === false)
chk('🔒 marketing_opted_out_at לא נגע', cust.marketing_opted_out_at === null)

// ─────────────────────────────────────────────────────────────────────────────
section('partial unique — פעילה = open + contacted; רק closed משחרר')

const dupAt = hours(96)
await create({ at: dupAt })
chk('🔒 בקשה פתוחה כפולה נדחית',
  (await errOf(() => create({ at: dupAt })))?.includes('WAITLIST_DUPLICATE'))

// 🔴 הלב של התיקון: 'contacted' עדיין פעילה, ולכן עדיין חוסמת.
await db.query(
  `update public.waitlist_requests set status='contacted' where requested_at = $1::timestamptz`, [dupAt])
chk("🔒 'contacted' עדיין חוסמת — היא בקשה פעילה, לא סגורה",
  (await errOf(() => create({ at: dupAt })))?.includes('WAITLIST_DUPLICATE'))

// ורק סגירה משחררת.
await db.query(
  `update public.waitlist_requests set status='closed' where requested_at = $1::timestamptz`, [dupAt])
const reopened = await create({ at: dupAt })
chk("🔒 רק 'closed' משחרר את המועד לבקשה חדשה", !!reopened?.id)
chk('שתי השורות חיות זו לצד זו',
  await count('public.waitlist_requests', `requested_at = '${dupAt}'::timestamptz`) === 2)

chk('🔒 פרדיקט האינדקס כולל contacted',
  await count('pg_indexes',
    `schemaname='public' and indexname='waitlist_requests_active_unique' and indexdef like '%contacted%'`) === 1)

// ─────────────────────────────────────────────────────────────────────────────
section('ולידציה בשרת — לא סומכים על הדפדפן')

chk('🔒 משך שאינו 20/40 נדחה',
  (await errOf(() => create({ duration: 15, at: hours(120) })))?.includes('BAD_DURATION'))
chk('🔒 טיפול שאינו ברשימה הסגורה נדחה',
  (await errOf(() => create({ service: 'מיקרובליידינג', at: hours(121) })))?.includes('BAD_SERVICE'))
chk('🔒 מועד בעבר נדחה',
  (await errOf(() => create({ at: hours(-2) })))?.includes('START_IN_PAST'))
chk('🔒 ללא IP נדחה',
  (await errOf(() => create({ ip: null, at: hours(122) })))?.includes('MISSING_IP'))
chk('🔒 ללא אישור פרטיות נדחה — אין מסלול עוקף',
  (await errOf(() => create({ ack: false, at: hours(123) })))?.includes('PRIVACY_NOT_ACKNOWLEDGED'))
chk('🔒 גרסת פרטיות ריקה נדחית',
  (await errOf(() => create({ pv: '  ', at: hours(124) })))?.includes('PRIVACY_NOT_ACKNOWLEDGED'))

const beforeReject = await count('public.customers')
await errOf(() => create({ phone: '+972509998877', ack: false, at: hours(125) }))
chk('🔒 בקשה שנדחתה על פרטיות לא יצרה לקוחה',
  await count('public.customers') === beforeReject)

// ─────────────────────────────────────────────────────────────────────────────
section('מגבלות קצב')

// המונה של ה-IP משותף עם ההזמנות הציבוריות (booking_rate_events).
const rateRows = await count('public.booking_rate_events', `ip = '${IP}'::inet`)
chk('🔒 כל יצירה מוצלחת רשומה ב-booking_rate_events הקיימת', rateRows > 0,
  `שורות=${rateRows}`)
chk('🔒 לא נוצרה טבלת IP חדשה',
  await count('information_schema.columns',
    `table_schema='public' and table_name='waitlist_requests' and column_name in ('ip','ip_address')`) === 0)

{
  // מגבלת ה-IP: התקרה הקשיחה היא 5 לשעה, משותפת עם ההזמנות.
  const FRESH_IP = '198.51.100.7'
  let blocked = null
  for (let i = 0; i < 8 && !blocked; i++) {
    blocked = await errOf(() => create({
      phone: `+97250100000${i}`, ip: FRESH_IP, at: hours(200 + i),
    }))
  }
  chk('🔒 מגבלת IP נאכפת (5 לשעה, משותפת עם ההזמנות)',
    blocked?.includes('RATE_LIMITED'), blocked ? '' : 'לא נחסם!')
}

{
  // מגבלת הבקשות ה**פעילות** ללקוחה: 5. ה-IP מנוקה כדי לבודד את המגבלה.
  const PHONE = '+972502223344'
  const cid = `(select id from public.customers where phone_e164='${PHONE}')`
  let err = null
  for (let i = 0; i < 7 && !err; i++) {
    await db.query(`delete from public.booking_rate_events`)
    err = await errOf(() => create({ phone: PHONE, at: hours(300 + i) }))
  }
  chk('🔒 עד 5 בקשות פעילות ללקוחה', err?.includes('WAITLIST_OPEN_LIMIT'), err ?? 'לא נחסם!')
  chk('בפועל נשמרו 5 פעילות',
    await count('public.waitlist_requests',
      `customer_id = ${cid} and status in ('open','contacted')`) === 5)

  // 🔴 סימון 'contacted' אינו מפנה מקום במכסה.
  await db.query(
    `update public.waitlist_requests set status='contacted'
     where customer_id = ${cid} and status='open'`)
  await db.query(`delete from public.booking_rate_events`)
  chk("🔒 'contacted' אינו מפנה מקום במכסת הפעילות",
    (await errOf(() => create({ phone: PHONE, at: hours(320) })))?.includes('WAITLIST_OPEN_LIMIT'))

  // ורק סגירה מפנה.
  await db.query(
    `update public.waitlist_requests set status='closed'
     where id = (select id from public.waitlist_requests where customer_id = ${cid} limit 1)`)
  await db.query(`delete from public.booking_rate_events`)
  chk("🔒 אחרי 'closed' אחד — נפתח מקום לבקשה חדשה",
    !!(await create({ phone: PHONE, at: hours(321) }))?.id)
}

{
  // מגבלת הקצב ללקוחה: 10 בשעה. הבקשות הפתוחות נסגרות כדי לבודד אותה.
  const PHONE = '+972503334455'
  let err = null
  for (let i = 0; i < 13 && !err; i++) {
    await db.query(`delete from public.booking_rate_events`)
    err = await errOf(() => create({ phone: PHONE, at: hours(400 + i) }))
    await db.query(
      `update public.waitlist_requests set status='closed'
       where customer_id = (select id from public.customers where phone_e164=$1)
         and status in ('open','contacted')`,
      [PHONE])
  }
  chk('🔒 עד 10 יצירות ללקוחה בשעה', err?.includes('WAITLIST_HOURLY_LIMIT'), err ?? 'לא נחסם!')
}

{
  const PHONE = '+972504445566'
  await db.query(`delete from public.booking_rate_events`)
  const r = await create({ phone: PHONE, at: hours(500) })
  await db.query(`update public.customers set is_blocked = true where id = $1`, [r.customer_id])
  await db.query(`delete from public.booking_rate_events`)
  chk('🔒 לקוחה חסומה אינה יכולה להצטרף',
    (await errOf(() => create({ phone: PHONE, at: hours(501) })))?.includes('CUSTOMER_BLOCKED'))
}

// ─────────────────────────────────────────────────────────────────────────────
section('שינוי סטטוס לאדמין')

{
  await db.query(`delete from public.booking_rate_events`)
  const r = await create({ phone: '+972505556677', at: hours(600) })
  const c1 = await one(`select * from public.set_waitlist_request_status($1,'contacted')`, [r.id])
  chk('open → contacted', c1.status === 'contacted')
  const c2 = await one(`select * from public.set_waitlist_request_status($1,'closed')`, [r.id])
  chk('contacted → closed', c2.status === 'closed')
  chk('🔒 סטטוס שאינו ברשימה נדחה',
    (await errOf(() => one(`select * from public.set_waitlist_request_status($1,'converted')`, [r.id])))
      ?.includes('BAD_STATUS'))
  chk('🔒 מזהה שאינו קיים נדחה',
    (await errOf(() => one(
      `select * from public.set_waitlist_request_status('00000000-0000-0000-0000-000000000000','open')`)))
      ?.includes('NOT_FOUND'))
}

// ─────────────────────────────────────────────────────────────────────────────
section('🔒 הרשאות')

{
  const rls = await one(
    `select relrowsecurity r from pg_class where oid = 'public.waitlist_requests'::regclass`)
  chk('RLS דלוק', rls.r === true)
  chk('אפס policies',
    await count('pg_policies', `schemaname='public' and tablename='waitlist_requests'`) === 0)

  const acl = await all(`
    select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='waitlist_requests'`)
  const forRole = r => acl.filter(a => a.grantee === r).map(a => a.privilege_type)
  chk('🔒 anon/authenticated ללא הרשאות',
    forRole('anon').length === 0 && forRole('authenticated').length === 0)
  chk('service_role: select+insert+update',
    ['SELECT', 'INSERT', 'UPDATE'].every(p => forRole('service_role').includes(p)))

  /*
   * ⚠️ **אין כאן בדיקת "ל-service_role אין DELETE".** היא הייתה עוברת כאן
   * ונכשלת במציאות: ל-Supabase יש `alter default privileges … grant all on
   * tables to service_role` ברמת הסכימה, ולכן בפרודקשן service_role מחזיק
   * DELETE על **כל** טבלה — appointments, sms_campaigns, app_sessions
   * ו-waitlist_requests באותה מידה. בדיקה שעוברת רק כי ל-PGlite אין את
   * ברירת המחדל הזו היא בדיקה שנותנת ביטחון שקרי.
   *
   * 🔒 מה שכן נאכף ונבדק: אין מסלול מחיקה בקוד. `set_waitlist_request_status`
   * היא פונקציית השינוי היחידה על הטבלה, והיא מעדכנת status בלבד.
   */
  const waitlistFnBodies = (await all(`
    select pg_get_functiondef(p.oid) as def from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in ('create_waitlist_request','set_waitlist_request_status')
  `)).map(r => r.def).join('\n').toLowerCase()
  chk('🔒 אף RPC של רשימת ההמתנה אינו מוחק מהטבלה',
    !/delete\s+from\s+public\.waitlist_requests/.test(waitlistFnBodies))
  chk("🔒 set_waitlist_request_status משנה status בלבד",
    /update\s+public\.waitlist_requests\s+set\s+status\s*=/.test(waitlistFnBodies))

  for (const fn of ['create_waitlist_request', 'set_waitlist_request_status']) {
    const pub = await count(
      `information_schema.role_routine_grants`,
      `routine_schema='public' and routine_name='${fn}' and grantee in ('PUBLIC','anon','authenticated')`)
    chk(`🔒 ${fn} — PUBLIC/anon/authenticated אינם יכולים להריץ`, pub === 0)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
section('🔒 appointments לא נגעה')

{
  chk('אין עמודת waitlist על appointments',
    await count('information_schema.columns',
      `table_schema='public' and table_name='appointments' and column_name like '%waitlist%'`) === 0)
  const con = await one(
    `select count(*)::int c from pg_constraint where conname = 'appointments_no_overlap'`)
  chk('appointments_no_overlap עדיין קיים', con.c === 1)
}

// ─────────────────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(72))
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
