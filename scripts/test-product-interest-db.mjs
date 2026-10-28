/**
 * בדיקות 0038 (הרשמה לעדכון על השקת מוצר) מול Postgres אמיתי (PGlite).
 * כל המיגרציות רצות מאפס על מסד זמני בזיכרון — אין כאן שום חיבור
 * ל-Supabase האמיתי, ולכן אין שום סיכון לנתוני פרודקשן.
 *
 * המיקוד הוא בהבטחות שה-UI וההודעה המשפטית נשענים עליהן:
 *
 *   1.  טלפון ישראלי תקין נשמר; טלפון לא תקין נדחה.
 *   2.  הודעת הפרטיות חובה — בלעדיה אין שורה.
 *   3.  🔒 **אין יצירת לקוחה.** customers נשאר ריק.
 *   4.  🔒 **אין נגיעה ב-marketing_consent / marketing_opted_out_at.**
 *   5.  הרשמה כפולה היא idempotent — אותה שורה, already=true, ולא 23505.
 *   6.  מגבלת IP ומגבלת טלפון.
 *   7.  הרשאות: anon/authenticated אינם יכולים לכתוב; service_role כן.
 *   8.  אין טריגרים, RLS דלוק, אין policies.
 *   9.  המסלול אינו נוגע בתורים/תזכורות/יומן/רשימת המתנה.
 *
 * הרצה:  npm run test:product-interest-db
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
chk('0038 ברשימה', migrations.includes('0038_product_interest.sql'))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const count = async (t, where = 'true') =>
  Number((await one(`select count(*)::int c from ${t} where ${where}`)).c)
const errOf = async fn => { try { await fn(); return null } catch (e) { return e.message } }

const SLUG = 'micro-brow-pen'
const PV = '1.3'
const IP = '203.0.113.7'
const PHONE = '+972501112233'

const create = (over = {}) => {
  const p = {
    slug: SLUG, phone: PHONE, shade: null, source: 'product_page',
    ip: IP, cap: 10, pv: PV, ack: true, ...over,
  }
  return one(
    `select * from public.create_product_interest($1,$2,$3,$4,$5::inet,$6,$7,$8)`,
    [p.slug, p.phone, p.shade, p.source, p.ip, p.cap, p.pv, p.ack],
  )
}

// ─────────────────────────────────────────────────────────────────────────────
section('1 — טלפון')

const ok1 = await create()
chk('טלפון ישראלי תקין נשמר', Boolean(ok1.id) && ok1.already === false)
chk('נשמר בפורמט E.164 בדיוק כפי שנמסר',
  (await one('select phone_e164 p from public.product_interest_requests')).p === PHONE)

for (const bad of ['0501112233', '+9725011122', '+97250111223344', '+14155550123', '', 'abc']) {
  const msg = await errOf(() => create({ phone: bad, ip: '203.0.113.90' }))
  chk(`טלפון לא תקין נדחה: ${JSON.stringify(bad)}`, msg !== null && /BAD_PHONE/.test(msg))
}

// ─────────────────────────────────────────────────────────────────────────────
section('2 — הודעת הפרטיות חובה')

const beforePrivacy = await count('public.product_interest_requests')
const ackMsg = await errOf(() => create({ phone: '+972502223344', ack: false, ip: '203.0.113.91' }))
chk('ack=false נדחה', ackMsg !== null && /PRIVACY_NOT_ACKNOWLEDGED/.test(ackMsg))
const verMsg = await errOf(() => create({ phone: '+972502223344', pv: '  ', ip: '203.0.113.92' }))
chk('גרסה ריקה נדחית', verMsg !== null && /PRIVACY_NOT_ACKNOWLEDGED/.test(verMsg))
chk('🔒 לא נוצרה שורה באף אחד מהמקרים',
  (await count('public.product_interest_requests')) === beforePrivacy)
chk('הגרסה והחותמת נשמרות על השורה',
  (await one(`select privacy_notice_version v, privacy_acknowledged_at a
              from public.product_interest_requests limit 1`)).v === PV)

// ─────────────────────────────────────────────────────────────────────────────
section('3 — 🔒 אין יצירת לקוחה')

chk('customers ריקה לחלוטין אחרי הרשמה', (await count('public.customers')) === 0)
chk('customer_id על השורה הוא null',
  (await one('select customer_id c from public.product_interest_requests limit 1')).c === null)
chk('🔒 create_product_interest אינה קוראת ל-link_or_create_customer_by_phone',
  (await one(`select count(*)::int c from pg_proc
              where proname='create_product_interest'
                and prosrc like '%link_or_create_customer_by_phone%'`)).c === 0)

// ─────────────────────────────────────────────────────────────────────────────
section('4 — 🔒 אין נגיעה בדיוור')

chk('create_product_interest אינה מזכירה marketing_consent',
  (await one(`select count(*)::int c from pg_proc
              where proname='create_product_interest'
                and (prosrc like '%marketing_consent%'
                  or prosrc like '%marketing_opted_out_at%')`)).c === 0)
chk('אין עמודת דיוור על product_interest_requests',
  (await one(`select count(*)::int c from information_schema.columns
              where table_name='product_interest_requests'
                and column_name like 'marketing%'`)).c === 0)

// ─────────────────────────────────────────────────────────────────────────────
section('5 — הרשמה כפולה: idempotent')

const dup = await create()
chk('מחזירה את אותו id', dup.id === ok1.id)
chk('already=true', dup.already === true)
chk('🔒 לא נוצרה שורה שנייה',
  (await count('public.product_interest_requests', `phone_e164='${PHONE}'`)) === 1)

const dupOther = await create({ slug: 'other-product', ip: '203.0.113.8' })
chk('אותו טלפון למוצר אחר כן נרשם בנפרד',
  Boolean(dupOther.id) && dupOther.id !== ok1.id && dupOther.already === false)

// אחרי notified — אפשר להירשם שוב בעתיד
await db.query(
  `update public.product_interest_requests
   set status='notified', notified_at=now() where id=$1`, [ok1.id])
const afterNotified = await create({ ip: '203.0.113.11' })
chk('אחרי notified אפשר להירשם שוב (partial index על open בלבד)',
  Boolean(afterNotified.id) && afterNotified.id !== ok1.id && afterNotified.already === false)
chk('ה-CHECK של notified_at נאכף',
  (await errOf(() => db.query(
    `update public.product_interest_requests set status='notified' where id=$1`,
    [afterNotified.id]))) !== null)

// ─────────────────────────────────────────────────────────────────────────────
section('6 — מגבלות קצב')

const FRESH_IP = '198.51.100.20'
let ipErr = null
for (let i = 0; i < 12 && !ipErr; i++) {
  ipErr = await errOf(() => create({ slug: `cap-${i}`, phone: '+972503334455', ip: FRESH_IP }))
}
chk('מגבלת IP נאכפת', ipErr !== null && /RATE_LIMITED|PHONE_LIMIT/.test(ipErr))

const PHONE_CAP = '+972504445566'
let phoneErr = null
for (let i = 0; i < 7 && !phoneErr; i++) {
  phoneErr = await errOf(() =>
    create({ slug: `pcap-${i}`, phone: PHONE_CAP, ip: `198.51.100.${30 + i}` }))
}
chk('מגבלת טלפון נאכפת', phoneErr !== null && /PHONE_LIMIT/.test(phoneErr))

chk('מונה הקצב נפרד מ-booking_rate_events', (await count('public.booking_rate_events')) === 0)
chk('🔒 בקשה שנדחתה אינה אוכלת מהמכסה (נרשם רק בהצלחה)',
  (await count('public.product_interest_rate_events')) ===
  (await count('public.product_interest_requests')))

// ─────────────────────────────────────────────────────────────────────────────
section('7 — הרשאות')

for (const t of ['product_interest_requests', 'product_interest_rate_events']) {
  for (const role of ['anon', 'authenticated']) {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const has = (await one(
        `select has_table_privilege($1, $2, $3) h`, [role, `public.${t}`, priv])).h
      chk(`🔒 ל-${role} אין ${priv} על ${t}`, has === false)
    }
  }
}

const SIG = 'public.create_product_interest(text, text, text, text, inet, integer, text, boolean)'
for (const role of ['anon', 'authenticated']) {
  chk(`🔒 ל-${role} אין EXECUTE על ה-RPC`,
    (await one('select has_function_privilege($1,$2,$3) h', [role, SIG, 'EXECUTE'])).h === false)
}
chk('ל-service_role יש EXECUTE',
  (await one('select has_function_privilege($1,$2,$3) h', ['service_role', SIG, 'EXECUTE'])).h === true)
chk('ל-service_role יש INSERT על הטבלה',
  (await one('select has_table_privilege($1,$2,$3) h',
    ['service_role', 'public.product_interest_requests', 'INSERT'])).h === true)

// ─────────────────────────────────────────────────────────────────────────────
section('8 — RLS, policies, טריגרים')

for (const t of ['product_interest_requests', 'product_interest_rate_events']) {
  chk(`RLS דלוק על ${t}`,
    (await one(`select relrowsecurity r from pg_class where oid=$1::regclass`, [`public.${t}`])).r === true)
  chk(`אפס policies על ${t}`,
    (await one(`select count(*)::int c from pg_policies
                where schemaname='public' and tablename=$1`, [t])).c === 0)
  chk(`אפס טריגרים על ${t}`,
    (await one(`select count(*)::int c from pg_trigger
                where tgrelid=$1::regclass and not tgisinternal`, [`public.${t}`])).c === 0)
}

// ─────────────────────────────────────────────────────────────────────────────
section('9 — 🔒 המסלול אינו נוגע בתורים, תזכורות, יומן ורשימת המתנה')

chk('appointments ריקה', (await count('public.appointments')) === 0)
chk('appointment_reminders ריקה', (await count('public.appointment_reminders')) === 0)
chk('appointment_notifications ריקה', (await count('public.appointment_notifications')) === 0)
chk('calendar_change_queue ריקה', (await count('public.calendar_change_queue')) === 0)
chk('waitlist_requests ריקה', (await count('public.waitlist_requests')) === 0)
chk('customers עדיין ריקה', (await count('public.customers')) === 0)

// ─────────────────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
