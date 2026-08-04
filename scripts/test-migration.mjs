/**
 * מריץ את המיגרציה של האזור האישי מול Postgres אמיתי (PGlite — Postgres
 * מקומפל ל-WASM) ובודק שההתנהגות הקריטית עובדת: מניעת התנגשות סלוטים,
 * חישוב ends_at, שחרור סלוט בביטול, והפרדת ההרשאות ב-RLS.
 *
 * הרצה:  node scripts/test-migration.mjs
 *
 * הערה: Supabase מספק את הסכמה auth ואת auth.uid(). כאן הן מדומות, ולכן
 * הבדיקה מאמתת את הלוגיקה שלנו — לא את Supabase עצמו.
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'fs'

const SQL = readFileSync(new URL('../supabase/migrations/0001_customer_accounts.sql', import.meta.url), 'utf8')

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

// ── Supabase stubs: auth schema + auth.uid() ────────────────────────────────
let CURRENT_UID = null
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
`)
const setUid = async (uid) => {
  CURRENT_UID = uid
  await db.exec(`delete from auth._session; ${uid ? `insert into auth._session values ('${uid}');` : ''}`)
}

// ── 1. run the real migration ───────────────────────────────────────────────
try {
  await db.exec(SQL)
  chk('המיגרציה רצה במלואה ללא שגיאה')
} catch (e) {
  chk('המיגרציה רצה במלואה ללא שגיאה', false, `\n   ${e.message}`)
  console.log('\n⛔ עוצר — אין טעם להמשיך.')
  process.exit(1)
}

// ── 2. schema shape ─────────────────────────────────────────────────────────
const tables = (await db.query(
  `select table_name from information_schema.tables where table_schema='public' order by 1`
)).rows.map(r => r.table_name)
chk('כל 6 הטבלאות נוצרו',
  ['admins','appointment_history','appointments','business_settings','customers','otp_attempts']
    .every(t => tables.includes(t)), tables.join(', '))

const settings = (await db.query(`select count(*)::int c from business_settings`)).rows[0].c
chk('6 הגדרות מדיניות נזרעו', settings === 6, `count=${settings}`)

const rls = (await db.query(
  `select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace
   and relkind='r' order by 1`)).rows
chk('RLS מופעל על כל הטבלאות', rls.every(r => r.relrowsecurity),
  rls.map(r => `${r.relname}=${r.relrowsecurity}`).join(' '))

// ── 3. seed a customer ──────────────────────────────────────────────────────
const U1 = '11111111-1111-1111-1111-111111111111'
const U2 = '22222222-2222-2222-2222-222222222222'
await db.exec(`insert into auth.users values ('${U1}'), ('${U2}');`)
await db.exec(`
  insert into customers (id, phone_e164, full_name) values
    ('${U1}', '+972541234567', 'לקוחה א'),
    ('${U2}', '+972549876543', 'לקוחה ב');
`)
chk('שתי לקוחות נוצרו')

// ── 4. phone format constraint ──────────────────────────────────────────────
const expectFail = async (name, sql, code) => {
  try { await db.exec(sql); chk(name, false, 'לא נכשל כצפוי') }
  catch (e) { chk(name, code ? e.code === code : true, `${e.code}`) }
}
await expectFail('טלפון בפורמט מקומי נדחה',
  `insert into customers (id, phone_e164, full_name) values ('${U1}','0541234567','x')`, '23514')
await expectFail('טלפון כפול נדחה (unique)',
  `insert into auth.users values ('33333333-3333-3333-3333-333333333333');
   insert into customers (id, phone_e164, full_name)
   values ('33333333-3333-3333-3333-333333333333','+972541234567','כפילה')`, '23505')

// ── 5. ends_at trigger ──────────────────────────────────────────────────────
await db.exec(`
  insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status)
  values ('${U1}', 'natural', '2026-09-01T14:00:00Z', 20, '1999-01-01T00:00:00Z', 'pending');
`)
let a = (await db.query(`select starts_at, ends_at, status from appointments`)).rows[0]
const endsOk = new Date(a.ends_at).toISOString() === '2026-09-01T14:20:00.000Z'
chk('הטריגר חישב ends_at ודרס ערך מזויף', endsOk, new Date(a.ends_at).toISOString())

// ── 6. THE critical one: overlap prevention ─────────────────────────────────
await expectFail('סלוט זהה נחסם (התנגשות)',
  `insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status)
   values ('${U2}','natural','2026-09-01T14:00:00Z',20,now(),'pending')`, '23P01')

await expectFail('סלוט חופף חלקית נחסם (40 דק׳ מ-13:40)',
  `insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status)
   values ('${U2}','lifting','2026-09-01T13:40:00Z',40,now(),'pending')`, '23P01')

try {
  await db.exec(`insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status)
    values ('${U2}','natural','2026-09-01T14:20:00Z',20,now(),'pending')`)
  chk('סלוט צמוד (14:20) מתקבל — אין חסימת יתר')
} catch (e) { chk('סלוט צמוד (14:20) מתקבל — אין חסימת יתר', false, e.code) }

// ── 7. cancelling frees the slot ────────────────────────────────────────────
await db.exec(`update appointments set status='cancelled_by_customer'
               where starts_at='2026-09-01T14:00:00Z'`)
try {
  await db.exec(`insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status)
    values ('${U2}','natural','2026-09-01T14:00:00Z',20,now(),'pending')`)
  chk('ביטול משחרר את הסלוט אוטומטית')
} catch (e) { chk('ביטול משחרר את הסלוט אוטומטית', false, e.code) }

// ── 8. reschedule recomputes ends_at and keeps one row ──────────────────────
const before = (await db.query(`select count(*)::int c from appointments`)).rows[0].c
await db.exec(`update appointments set starts_at='2026-09-02T17:00:00Z', duration_min=40,
               reschedule_count=reschedule_count+1
               where starts_at='2026-09-01T14:20:00Z'`)
const moved = (await db.query(
  `select ends_at, reschedule_count from appointments where starts_at='2026-09-02T17:00:00Z'`)).rows[0]
const after = (await db.query(`select count(*)::int c from appointments`)).rows[0].c
chk('הזזה מעדכנת שורה קיימת ולא יוצרת שנייה', before === after, `${before} → ${after}`)
chk('הזזה חישבה ends_at מחדש (17:40)',
  new Date(moved.ends_at).toISOString() === '2026-09-02T17:40:00.000Z',
  new Date(moved.ends_at).toISOString())

// ── 9. RLS isolation ────────────────────────────────────────────────────────
await db.exec(`
  create role customer_role nologin;
  grant usage on schema public, auth to customer_role;
  grant execute on function auth.uid() to customer_role;
  grant select, insert, update, delete on all tables in schema public to customer_role;
`)
const asCustomer = async (uid, sql) => {
  await setUid(uid)
  await db.exec('set role customer_role')
  try { return await db.query(sql) } finally { await db.exec('reset role') }
}

const seenBy1 = await asCustomer(U1, `select count(*)::int c from appointments`)
const seenBy2 = await asCustomer(U2, `select count(*)::int c from appointments`)
const total = (await db.query(`select count(*)::int c from appointments`)).rows[0].c
chk('לקוחה רואה רק את התורים שלה',
  seenBy1.rows[0].c === 1 && seenBy2.rows[0].c === 2 && total === 3,
  `א=${seenBy1.rows[0].c} ב=${seenBy2.rows[0].c} סה"כ=${total}`)

const otherCustomer = await asCustomer(U1, `select count(*)::int c from customers`)
chk('לקוחה לא רואה לקוחות אחרות', otherCustomer.rows[0].c === 1, `count=${otherCustomer.rows[0].c}`)

// customer must NOT be able to insert/update appointments directly
let blockedWrite = false
try {
  await asCustomer(U1, `insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at)
    values ('${U1}','natural','2026-09-05T10:00:00Z',20,now())`)
} catch { blockedWrite = true }
chk('לקוחה לא יכולה ליצור תור ישירות (אין policy ל-INSERT)', blockedWrite)

let blockedSteal = false
try {
  const r = await asCustomer(U1, `update appointments set status='confirmed' where customer_id='${U2}' returning id`)
  blockedSteal = r.rows.length === 0
} catch { blockedSteal = true }
chk('לקוחה לא יכולה לשנות תור של אחרת', blockedSteal)

const otp = await asCustomer(U1, `select count(*)::int c from otp_attempts`).then(r => ({ ok: false, r })).catch(() => ({ ok: true }))
chk('otp_attempts חסום ללקוחה', otp.ok || otp.r.rows[0].c === 0)

// ── 10. admin sees everything ───────────────────────────────────────────────
await setUid(null)
await db.exec(`insert into admins (user_id) values ('${U1}')`)
const asAdmin = await asCustomer(U1, `select count(*)::int c from appointments`)
chk('מנהלת רואה את כל התורים', asAdmin.rows[0].c === 3, `count=${asAdmin.rows[0].c}`)

// ── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
