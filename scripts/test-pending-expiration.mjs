/**
 * בדיקת שלב 4 מול Postgres אמיתי (PGlite — לא מול הפרויקט האמיתי ב-Supabase,
 * בדיוק כמו test-migration.mjs): מריצה 0001, ואז 0002 ו-0003 כשני db.exec
 * נפרדים (כך שכל אחד רץ ב"סבב" משלו, בדיוק כמו שני "Run" נפרדים ב-Supabase
 * SQL Editor) — ובודקת את הפונקציות שחלק 3–5 של המסירה מתארים: תפוגת
 * pending, אכיפת המגבלה, ביטול, והמשך תוקף ה-EXCLUDE constraint.
 *
 * ⚠️ הבדיקה טוענת **רק** את 0001–0003, ולכן היא ממשיכה להריץ את
 * create_pending_appointment ואת כלל 12 השעות שלה — למרות ש-0020 מחקה את
 * הפונקציה. זה מכוון: היא מאמתת את 0003 בנקודת הזמן שלה, לא את המצב
 * הנוכחי של המסד. מה שקורה אחרי 0020 נבדק ב-test-personal-area-db.mjs.
 *
 * הרצה:  npm run test:pending-expiration
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'fs'

const SQL_0001 = readFileSync(new URL('../supabase/migrations/0001_customer_accounts.sql', import.meta.url), 'utf8')
const SQL_0002_ENUM = readFileSync(new URL('../supabase/migrations/0002_pending_expiration_enum_values.sql', import.meta.url), 'utf8')
const SQL_0003 = readFileSync(new URL('../supabase/migrations/0003_pending_expiration.sql', import.meta.url), 'utf8')

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

// ── Supabase stubs: auth schema + auth.uid() + roles שה-GRANT/REVOKE ב-0002 מצפה להם ──
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
  create role service_role;
  create role authenticated;
  create role anon;
`)

// ── 1. run all migrations in order, 0002 ו-0003 כשני exec נפרדים ───────────
try {
  await db.exec(SQL_0001)
  chk('0001 רצה במלואה ללא שגיאה')
} catch (e) {
  chk('0001 רצה במלואה ללא שגיאה', false, e.message)
  process.exit(1)
}
try {
  await db.exec(SQL_0002_ENUM)
  chk('0002 (ערכי enum) רץ במלואו ללא שגיאה')
} catch (e) {
  chk('0002 (ערכי enum) רץ במלואו ללא שגיאה', false, e.message)
  process.exit(1)
}
try {
  await db.exec(SQL_0003)
  chk('0003 רץ במלואו ללא שגיאה, בלי לגעת ב-0001/0002')
} catch (e) {
  chk('0003 רץ במלואו ללא שגיאה, בלי לגעת ב-0001/0002', false, e.message)
  process.exit(1)
}

// ── 2. shape ─────────────────────────────────────────────────────────────────
const cols = (await db.query(
  `select column_name from information_schema.columns where table_name='appointments' and column_name='pending_expires_at'`
)).rows
chk('appointments.pending_expires_at נוסף', cols.length === 1)

const settings = (await db.query(`select key, value from business_settings order by key`)).rows
chk('8 הגדרות מדיניות בסה"כ (6 מ-0001 + 2 חדשות)', settings.length === 8, `count=${settings.length}`)
chk('pending_expiration_hours=12',
  settings.find(s => s.key === 'pending_expiration_hours')?.value === 12)
chk('max_active_pending_per_customer=2',
  settings.find(s => s.key === 'max_active_pending_per_customer')?.value === 2)

const U1 = '11111111-1111-1111-1111-111111111111'
const U2 = '22222222-2222-2222-2222-222222222222'
await db.exec(`insert into auth.users values ('${U1}'), ('${U2}');`)
await db.exec(`
  insert into customers (id, phone_e164, full_name) values
    ('${U1}', '+972541234567', 'לקוחה א'),
    ('${U2}', '+972549876543', 'לקוחה ב');
`)

const create = (uid, start, notes = null) => db.query(`
  select * from create_pending_appointment(
    '${uid}', 'natural', '{}', 100, '${start}'::timestamptz, 20, ${notes ? `'${notes}'` : 'null'}, 'v1'
  )
`)

// ── 3. יצירה רגילה ────────────────────────────────────────────────────────────
const r1 = await create(U1, '2026-09-01T14:00:00Z')
chk('בקשה ראשונה נוצרה כ-pending', r1.rows[0]?.status === 'pending')
chk('pending_expires_at נקבע ל-12 שעות קדימה', (() => {
  const created = new Date(r1.rows[0].created_at)
  const exp = new Date(r1.rows[0].pending_expires_at)
  return Math.round((exp - created) / 3600000) === 12
})())

const historyAfterCreate = (await db.query(
  `select action, from_status, to_status, actor from appointment_history where appointment_id='${r1.rows[0].id}'`
)).rows
chk('נרשמה היסטוריית created',
  historyAfterCreate.length === 1 && historyAfterCreate[0].action === 'created' && historyAfterCreate[0].actor === 'customer')

// ── 4. pending פעיל חוסם סלוט חופף (EXCLUDE עדיין תקף) ──────────────────────
let overlapBlocked = false
try { await create(U2, '2026-09-01T14:00:00Z') }
catch (e) { overlapBlocked = e.code === '23P01' }
chk('שתי בקשות פעילות חופפות עדיין נחסמות (23P01)', overlapBlocked)

// ── 5. מגבלת 2 pending פעילים ללקוחה ──────────────────────────────────────────
await create(U1, '2026-09-02T14:00:00Z')
let limitBlocked = false
try { await create(U1, '2026-09-03T14:00:00Z') }
catch (e) { limitBlocked = e.message.includes('PENDING_LIMIT_REACHED') }
chk('בקשה שלישית ללקוחה אחת נחסמת (מגבלת 2 pending)', limitBlocked)

// completed/cancelled לא נספרים במגבלה
await db.exec(`update appointments set status='cancelled_by_customer' where id='${r1.rows[0].id}'`)
const r2 = await create(U1, '2026-09-03T14:00:00Z')
chk('אחרי ביטול אחת — מותר ליצור בקשה נוספת', r2.rows[0]?.status === 'pending')

// ── 6. תפוגה ──────────────────────────────────────────────────────────────────
const pend = (await db.query(`select id from appointments where customer_id='${U1}' and status='pending' order by created_at limit 1`)).rows[0]
await db.exec(`update appointments set pending_expires_at = now() - interval '1 hour' where id='${pend.id}'`)

await db.exec(`select expire_stale_pending_appointments()`)
const afterExpire = (await db.query(`select status from appointments where id='${pend.id}'`)).rows[0]
chk('בקשה שפג תוקפה מסומנת expired', afterExpire.status === 'expired')

const expireHistory = (await db.query(
  `select action, from_status, to_status, actor from appointment_history where appointment_id='${pend.id}' order by created_at desc limit 1`
)).rows[0]
chk('נרשמה היסטוריית expired (action=expired, from=pending, to=expired, actor=system)',
  expireHistory.action === 'expired' && expireHistory.from_status === 'pending'
  && expireHistory.to_status === 'expired' && expireHistory.actor === 'system')

const notDeleted = (await db.query(`select count(*)::int c from appointments where id='${pend.id}'`)).rows[0].c
chk('הרשומה לא נמחקה', notDeleted === 1)

// confirmed לעולם לא פג
const confirmedRow = await create(U2, '2026-09-05T10:00:00Z')
await db.exec(`update appointments set status='confirmed', pending_expires_at = now() - interval '1 day' where id='${confirmedRow.rows[0].id}'`)
await db.exec(`select expire_stale_pending_appointments()`)
const confirmedAfter = (await db.query(`select status from appointments where id='${confirmedRow.rows[0].id}'`)).rows[0]
chk('תור confirmed אינו פג לעולם דרך המנגנון הזה', confirmedAfter.status === 'confirmed')

// ── 7. pending שפג לא חוסם סלוט חדש (התפוגה רצה בתוך create_pending_appointment עצמה) ──
// pend פג על 2026-09-02T14:00:00Z — אמורה להתאפשר בקשה חדשה על אותו סלוט בדיוק
const freedSlot = await create(U2, '2026-09-02T14:00:00Z')
chk('סלוט של pending שפג משתחרר אוטומטית ל-INSERT הבא (בלי לחכות ל-sweep נפרד)',
  freedSlot.rows[0]?.status === 'pending')

// ── 8. ביטול ע"י הלקוחה ────────────────────────────────────────────────────────
const toCancel = await create(U1, '2026-09-06T10:00:00Z')
const cancelRes = await db.query(`select * from cancel_pending_appointment('${toCancel.rows[0].id}', '${U1}')`)
chk('ביטול מצליח לבעלת הבקשה', cancelRes.rows[0]?.status === 'cancelled_by_customer')

const cancelHistory = (await db.query(
  `select action, to_status, actor from appointment_history where appointment_id='${toCancel.rows[0].id}' order by created_at desc limit 1`
)).rows[0]
chk('נרשמה היסטוריית cancelled', cancelHistory.action === 'cancelled' && cancelHistory.to_status === 'cancelled_by_customer')

// סלוט שבוטל משתחרר (ה-EXCLUDE כבר מוכיח את זה, אבל בודקים ישירות גם כאן)
const afterCancelFree = await create(U2, '2026-09-06T10:00:00Z')
chk('ביטול משחרר את הסלוט', afterCancelFree.rows[0]?.status === 'pending')

// ניסיון ביטול ע"י לקוחה אחרת נכשל
const toCancel2 = await create(U1, '2026-09-07T10:00:00Z')
let cancelByOtherBlocked = false
try { await db.query(`select * from cancel_pending_appointment('${toCancel2.rows[0].id}', '${U2}')`) }
catch (e) { cancelByOtherBlocked = e.message.includes('NOT_FOUND') }
chk('לקוחה לא יכולה לבטל בקשה של לקוחה אחרת', cancelByOtherBlocked)

// ניסיון ביטול תור שכבר confirmed נכשל (רק pending ניתן לביטול בשלב זה)
await db.exec(`update appointments set status='confirmed' where id='${toCancel2.rows[0].id}'`)
let cancelConfirmedBlocked = false
try { await db.query(`select * from cancel_pending_appointment('${toCancel2.rows[0].id}', '${U1}')`) }
catch (e) { cancelConfirmedBlocked = e.message.includes('NOT_FOUND') }
chk('לא ניתן לבטל תור confirmed דרך cancel_pending_appointment', cancelConfirmedBlocked)

// ── 9. הרשאות RPC ─────────────────────────────────────────────────────────────
// grantee 'postgres' הוא בעלת הפונקציה (הרשאה מובנית, לא PUBLIC/anon/authenticated) —
// מה שחשוב הוא ש-anon/authenticated/PUBLIC לא מופיעים בכלל, ו-service_role כן.
const grants = (await db.query(`
  select routine_name, grantee from information_schema.role_routine_grants
  where routine_name in ('create_pending_appointment','cancel_pending_appointment','expire_stale_pending_appointments')
`)).rows
const hasServiceRole = ['create_pending_appointment', 'cancel_pending_appointment', 'expire_stale_pending_appointments']
  .every(fn => grants.some(g => g.routine_name === fn && g.grantee === 'service_role'))
const noPublicLeak = grants.every(g => !['anon', 'authenticated', 'PUBLIC'].includes(g.grantee))
chk('הפונקציות מוענקות ל-service_role, ולא ל-anon/authenticated/PUBLIC',
  hasServiceRole && noPublicLeak,
  grants.map(g => `${g.routine_name}→${g.grantee}`).join(', '))

// ── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
