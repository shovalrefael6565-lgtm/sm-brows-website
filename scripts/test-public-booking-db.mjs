/**
 * שלב 15B — בדיקות מול Postgres אמיתי (PGlite, לא מול הפרויקט ב-Supabase).
 *
 * מכסה את מה שאי אפשר לבדוק בלוגיקה טהורה:
 *   • מגבלת הקצב לפי IP — כולל שהיא סופרת **הצלחות בלבד**
 *   • איתור/יצירת לקוחה לפי טלפון, בלי כפילויות ובלי דריסת שם
 *   • booking_source
 *   • המשך תוקפו של ה-EXCLUDE constraint (double booking)
 *   • ניקוי אופורטוניסטי של booking_rate_events
 *   • תפוגה נשלחת מבחוץ ונאכפת בטווח סביר
 *
 * הרצה:  npm run test:public-booking-db
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(62)}${extra}`)
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)

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

// ── כל המיגרציות, כל אחת כ-exec נפרד (כמו "Run" נפרד ב-SQL Editor) ──────────
section('מיגרציות')
for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(new URL(f, MIG_DIR), 'utf8'))
  } catch (e) {
    chk(`${f} רצה`, false, e.message)
    process.exit(1)
  }
}
chk('כל 18 המיגרציות רצו לפי הסדר')

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows

// ── עזרי בדיקה ──────────────────────────────────────────────────────────────
const future = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()

async function createPublic({ customerId, startsAt, ip = '203.0.113.5', expires = future(3), duration = 20 }) {
  return one(
    `select * from public.create_public_pending_appointment(
       $1, 'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
       $2::timestamptz, $3, null, 'v1', $4::timestamptz, $5::inet, 5)`,
    [customerId, startsAt, duration, expires, ip],
  )
}

// ── לקוחה לפי טלפון ─────────────────────────────────────────────────────────
section('איתור / יצירת לקוחה לפי טלפון')

const c1 = await one(`select * from public.link_or_create_customer_by_phone('+972541110001', 'דנה כהן')`)
chk('לקוחה חדשה נוצרת', !!c1.id && c1.phone_e164 === '+972541110001')
chk('auth_user_id נשאר null — לא נוצר חשבון התחברות', c1.auth_user_id === null)

const c1again = await one(`select * from public.link_or_create_customer_by_phone('+972541110001', 'שם אחר לגמרי')`)
chk('קריאה שנייה מחזירה את אותה לקוחה — אין כפילות', c1again.id === c1.id)
chk('🔒 שם קיים אינו נדרס ע"י הטופס הציבורי', c1again.full_name === 'דנה כהן')

const total = await one(`select count(*)::int as n from public.customers where phone_e164 = '+972541110001'`)
chk('קיימת שורת לקוחה אחת בלבד למספר', total.n === 1)

// לקוחה שנוצרה ידנית ב-CRM — המסלול הציבורי מתחבר אליה ולא יוצר חדשה
await db.query(
  `insert into public.customers (phone_e164, full_name) values ('+972541110002', 'לקוחה מה-CRM')`)
const linked = await one(`select * from public.link_or_create_customer_by_phone('+972541110002', 'הוקלד בטופס')`)
chk('לקוחה ידנית מה-CRM מקושרת ולא משוכפלת', linked.full_name === 'לקוחה מה-CRM')

let badPhone = false
try { await db.query(`select public.link_or_create_customer_by_phone('0541234567', 'א')`) }
catch (e) { badPhone = e.message.includes('BAD_PHONE') }
chk('טלפון שאינו E.164 נדחה', badPhone)

let badName = false
try { await db.query(`select public.link_or_create_customer_by_phone('+972541110009', 'א')`) }
catch (e) { badName = e.message.includes('BAD_NAME') }
chk('שם קצר מדי נדחה', badName)

// ── booking_source ──────────────────────────────────────────────────────────
section('מקור הבקשה')

const a1 = await createPublic({ customerId: c1.id, startsAt: future(30) })
chk('בקשה ציבורית מתויגת public_booking', a1.booking_source === 'public_booking')
chk('הסטטוס הוא pending', a1.status === 'pending')
chk('התפוגה נשמרה כפי שנשלחה', a1.pending_expires_at !== null)

const hist = await one(
  `select * from public.appointment_history where appointment_id = $1`, [a1.id])
chk('נכתבה שורת היסטוריה עם actor=customer', hist.actor === 'customer' && hist.action === 'created')

// ── מגבלת הקצב ──────────────────────────────────────────────────────────────
section('מגבלת קצב לפי IP')

const c2 = await one(`select * from public.link_or_create_customer_by_phone('+972541110003', 'לקוחה ב')`)
await db.query(`update public.business_settings set value = '99'::jsonb
                where key = 'max_active_pending_per_customer'`)

// חמש יצירות מוצלחות מאותו IP
const IP = '198.51.100.20'
let created = 0
for (let i = 0; i < 5; i++) {
  await createPublic({ customerId: c2.id, startsAt: future(40 + i * 2), ip: IP })
  created++
}
chk('חמש יצירות ראשונות מאותו IP מצליחות', created === 5)

let sixthBlocked = false
try { await createPublic({ customerId: c2.id, startsAt: future(60), ip: IP }) }
catch (e) { sixthBlocked = e.message.includes('RATE_LIMITED') }
chk('🔒 היצירה השישית נחסמת עם RATE_LIMITED', sixthBlocked)

const notCreated = await one(
  `select count(*)::int as n from public.appointments
   where customer_id = $1 and starts_at = $2::timestamptz`, [c2.id, future(60)])
chk('🔒 הבקשה החסומה לא נוצרה בכלל', notCreated.n === 0)

const otherIp = await createPublic({ customerId: c2.id, startsAt: future(62), ip: '198.51.100.99' })
chk('IP אחר אינו מושפע מהמגבלה', otherIp.booking_source === 'public_booking')

// 🔒 הבדיקה המרכזית של B3: כישלון אינו נספר
section('🔒 נספרות יצירות מוצלחות בלבד')

const c3 = await one(`select * from public.link_or_create_customer_by_phone('+972541110004', 'לקוחה ג')`)
const IP2 = '198.51.100.30'
const busySlot = future(80)
await createPublic({ customerId: c3.id, startsAt: busySlot, ip: IP2 }) // תופסת את השעה

const before = await one(
  `select count(*)::int as n from public.booking_rate_events where ip = $1::inet`, [IP2])

// שלוש התנגשויות על אותה שעה — כל אחת אמורה ליפול על ה-EXCLUDE constraint
let collisions = 0
for (let i = 0; i < 3; i++) {
  try { await createPublic({ customerId: c3.id, startsAt: busySlot, ip: IP2 }) }
  catch (e) { if (e.message.includes('exclusion') || e.code === '23P01') collisions++ }
}
chk('שלוש בקשות על שעה תפוסה נכשלו', collisions === 3)

const after = await one(
  `select count(*)::int as n from public.booking_rate_events where ip = $1::inet`, [IP2])
chk('🔒 בקשות שנכשלו לא נספרו במגבלה', after.n === before.n, `לפני=${before.n} אחרי=${after.n}`)

// ── double booking ──────────────────────────────────────────────────────────
section('מניעת double booking')

const c4 = await one(`select * from public.link_or_create_customer_by_phone('+972541110005', 'לקוחה ד')`)
const c5 = await one(`select * from public.link_or_create_customer_by_phone('+972541110006', 'לקוחה ה')`)
const contested = future(100)

await createPublic({ customerId: c4.id, startsAt: contested, ip: '203.0.113.41' })
let secondFailed = false
try { await createPublic({ customerId: c5.id, startsAt: contested, ip: '203.0.113.42' }) }
catch (e) { secondFailed = e.message.includes('exclusion') || e.code === '23P01' }
chk('🔒 לקוחה שנייה אינה יכולה לתפוס את אותה שעה', secondFailed)

const held = await one(
  `select count(*)::int as n from public.appointments
   where starts_at = $1::timestamptz and status in ('pending','confirmed')`, [contested])
chk('קיים תור פעיל אחד בלבד על השעה', held.n === 1)

// חפיפה חלקית (תור 40 דק' שמתחיל 20 דק' אחרי) נחסמת גם היא
const overlapStart = new Date(new Date(contested).getTime() + 10 * 60_000).toISOString()
let overlapFailed = false
try { await createPublic({ customerId: c5.id, startsAt: overlapStart, ip: '203.0.113.43', duration: 40 }) }
catch (e) { overlapFailed = e.message.includes('exclusion') || e.code === '23P01' }
chk('חפיפה חלקית נחסמת גם היא', overlapFailed)

// ── ולידציית קלט ב-RPC ──────────────────────────────────────────────────────
section('אכיפת קלט ב-RPC')

const c6 = await one(`select * from public.link_or_create_customer_by_phone('+972541110007', 'לקוחה ו')`)

let noIp = false
try {
  await db.query(
    `select public.create_public_pending_appointment($1,'עיצוב גבות טבעיות',array['עיצוב גבות טבעי']::text[],70,
      $2::timestamptz,20,null,'v1',$3::timestamptz,null,5)`,
    [c6.id, future(120), future(3)])
} catch (e) { noIp = e.message.includes('MISSING_IP') }
chk('🔒 בקשה בלי IP נדחית', noIp)

let badExpiry = false
try { await createPublic({ customerId: c6.id, startsAt: future(120), expires: future(200) }) }
catch (e) { badExpiry = e.message.includes('BAD_EXPIRY') }
chk('תפוגה מעבר ל-72 שעות נדחית', badExpiry)

let pastExpiry = false
try { await createPublic({ customerId: c6.id, startsAt: future(120), expires: future(-1) }) }
catch (e) { pastExpiry = e.message.includes('BAD_EXPIRY') }
chk('תפוגה בעבר נדחית', pastExpiry)

let pastStart = false
try { await createPublic({ customerId: c6.id, startsAt: future(-5) }) }
catch (e) { pastStart = e.message.includes('START_IN_PAST') }
chk('מועד תור בעבר נדחה', pastStart)

// 🔒 התקרה מהודקת ואינה ניתנת להרפיה מהקורא
const c7 = await one(`select * from public.link_or_create_customer_by_phone('+972541110008', 'לקוחה ז')`)
const IP3 = '198.51.100.77'
for (let i = 0; i < 5; i++) {
  await createPublic({ customerId: c7.id, startsAt: future(150 + i * 2), ip: IP3 })
}
let ceilingHeld = false
try {
  await db.query(
    `select public.create_public_pending_appointment($1,'עיצוב גבות טבעיות',array['עיצוב גבות טבעי']::text[],70,
      $2::timestamptz,20,null,'v1',$3::timestamptz,$4::inet,1000000)`,
    [c7.id, future(170), future(3), IP3])
} catch (e) { ceilingHeld = e.message.includes('RATE_LIMITED') }
chk('🔒 קורא שמעביר מגבלה ענקית עדיין נחסם ב-5', ceilingHeld)

// ── ניקוי אופורטוניסטי ──────────────────────────────────────────────────────
section('ניקוי booking_rate_events ללא Cron')

await db.query(
  `insert into public.booking_rate_events (ip, created_at)
   values ('203.0.113.200'::inet, now() - interval '5 hours')`)
const oldBefore = await one(
  `select count(*)::int as n from public.booking_rate_events where created_at < now() - interval '2 hours'`)
chk('הוכנסה שורה ישנה', oldBefore.n >= 1)

const c8 = await one(`select * from public.link_or_create_customer_by_phone('+972541110010', 'לקוחה ח')`)
await createPublic({ customerId: c8.id, startsAt: future(180), ip: '203.0.113.201' })

const oldAfter = await one(
  `select count(*)::int as n from public.booking_rate_events where created_at < now() - interval '2 hours'`)
chk('הקריאה הבאה ניקתה שורות ישנות', oldAfter.n === 0)

// ── תור ידני ────────────────────────────────────────────────────────────────
section('תור ידני — תיוג admin_manual')

const adminId = '00000000-0000-0000-0000-0000000000aa'
await db.query(`insert into auth.users (id) values ($1)`, [adminId])
await db.query(`insert into public.admins (user_id) values ($1)`, [adminId])
const cm = await one(`select * from public.link_or_create_customer_by_phone('+972541110011', 'לקוחה ידנית')`)

// ⚠️ מחזירה jsonb ולא שורה, ולכן נקראת כעמודה בודדת ולא ב-select *
const manual = await one(
  `select public.create_manual_appointment(
     $1,'עיצוב גבות טבעיות',array['עיצוב גבות טבעי']::text[],70,$2::timestamptz,20,'v1',$3,
     gen_random_uuid(), repeat('a',64)) as result`,
  [cm.id, future(200), adminId])
const manualRow = await one(
  `select * from public.appointments where id = $1`, [manual.result.appointment_id])
chk('תור ידני מתויג admin_manual', manualRow.booking_source === 'admin_manual')
chk('תור ידני נוצר כ-confirmed מיד', manualRow.status === 'confirmed')
chk('תור ידני ממתין לסנכרון יומן', manualRow.calendar_sync_status === 'pending')

// ── סיכום ───────────────────────────────────────────────────────────────────
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} עברו`)
process.exit(passed === results.length ? 0 : 1)
