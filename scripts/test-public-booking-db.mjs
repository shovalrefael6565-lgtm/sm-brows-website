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
chk(`כל ${readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).length} המיגרציות רצו לפי הסדר`)

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows

// ── עזרי בדיקה ──────────────────────────────────────────────────────────────
const future = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()

async function book({ phone, name = 'לקוחת בדיקה', startsAt, ip = '203.0.113.5',
                      expires = future(3), duration = 20 }) {
  return one(
    `select * from public.create_public_booking_request(
       $1, $2, 'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
       $3::timestamptz, $4, null, 'v1', $5::timestamptz, $6::inet, 5)`,
    [phone, name, startsAt, duration, expires, ip],
  )
}
const tryBook = async (args) => {
  try { return { ok: true, row: await book(args) } }
  catch (e) { return { ok: false, msg: e.message } }
}
const counts = async () => one(`select
  (select count(*)::int from public.customers)           as customers,
  (select count(*)::int from public.appointments)        as appointments,
  (select count(*)::int from public.booking_rate_events) as rate_events`)

await db.query(`update public.business_settings set value = '99'::jsonb
                where key = 'max_active_pending_per_customer'`)

// ── 1. booking מוצלח ────────────────────────────────────────────────────────
section('1. booking מוצלח — לקוחה + תור + היסטוריה + אירוע קצב')

const before1 = await counts()
const a1 = await book({ phone: '+972541110001', name: 'דנה כהן', startsAt: future(30) })
const after1 = await counts()

chk('נוצר תור', !!a1.id && a1.status === 'pending')
chk('10. booking_source = public_booking', a1.booking_source === 'public_booking')
chk('נוצרה לקוחה אחת', after1.customers === before1.customers + 1)
chk('נוצר תור אחד', after1.appointments === before1.appointments + 1)
chk('נרשם אירוע קצב אחד', after1.rate_events === before1.rate_events + 1)
const h1 = await one(`select * from public.appointment_history where appointment_id = $1`, [a1.id])
chk('נכתבה היסטוריה עם actor=customer', h1.actor === 'customer' && h1.action === 'created')
chk('התפוגה נשמרה כפי שנשלחה', a1.pending_expires_at !== null)

// ── 2. conflict — אפס שאריות ────────────────────────────────────────────────
section('2. conflict — לא נשארת לקוחה, לא תור, לא אירוע קצב')

const busySlot = future(40)
await book({ phone: '+972541110002', startsAt: busySlot })
const before2 = await counts()
const conflict = await tryBook({ phone: '+972549990001', name: 'לקוחה חדשה לגמרי', startsAt: busySlot })
const after2 = await counts()

chk('הבקשה נכשלה על ה-EXCLUDE constraint',
  !conflict.ok && (conflict.msg.includes('exclusion') || conflict.msg.includes('23P01')))
chk('🔒 לא נוצרה לקוחה חדשה', after2.customers === before2.customers)
chk('🔒 לא נוצר תור', after2.appointments === before2.appointments)
chk('🔒 לא נרשם אירוע קצב', after2.rate_events === before2.rate_events)
const orphan = await one(
  `select count(*)::int as n from public.customers where phone_e164 = '+972549990001'`)
chk('🔒 המספר שנכשל אינו קיים כלקוחה', orphan.n === 0)

// ── 3. RATE_LIMITED — אפס לקוחות חדשות ──────────────────────────────────────
section('3. RATE_LIMITED — הקצב נאכף לפני יצירת הלקוחה')

const IP = '198.51.100.20'
for (let i = 0; i < 5; i++) {
  await book({ phone: `+97254200000${i}`, startsAt: future(60 + i * 2), ip: IP })
}
const before3 = await counts()
const limited = await tryBook({ phone: '+972549990002', name: 'עוד אחת חדשה', startsAt: future(80), ip: IP })
const after3 = await counts()

chk('הבקשה השישית נחסמה', !limited.ok && limited.msg.includes('RATE_LIMITED'))
chk('🔒 לא נוצרה לקוחה חדשה למרות שהמספר חדש', after3.customers === before3.customers)
chk('🔒 לא נוצר תור', after3.appointments === before3.appointments)
chk('🔒 לא נרשם אירוע קצב נוסף', after3.rate_events === before3.rate_events)
chk('IP אחר אינו מושפע',
  (await tryBook({ phone: '+972549990003', startsAt: future(84), ip: '198.51.100.99' })).ok)

// ── 4. לקוחה חסומה ──────────────────────────────────────────────────────────
section('4. לקוחה חסומה — אין תור, אין אירוע קצב')

await db.query(
  `insert into public.customers (phone_e164, full_name, is_blocked)
   values ('+972541110050', 'לקוחה חסומה', true)`)
const before4 = await counts()
const blocked = await tryBook({ phone: '+972541110050', startsAt: future(90), ip: '203.0.113.60' })
const after4 = await counts()

chk('נזרק CUSTOMER_BLOCKED', !blocked.ok && blocked.msg.includes('CUSTOMER_BLOCKED'))
chk('🔒 לא נוצר תור', after4.appointments === before4.appointments)
chk('🔒 לא נרשם אירוע קצב', after4.rate_events === before4.rate_events)
chk('הלקוחה החסומה נשארה כפי שהייתה', after4.customers === before4.customers)
{
  // 🔒 התשובה הציבורית אינה מסגירה חסימה — נבדק על מקור ה-route:
  //    ענף blocked ו-ענף db_error מחזירים אותו status, error ו-message.
  const raw = readFileSync(new URL('../app/api/bookings/request/route.ts', import.meta.url), 'utf8')
  // ⚠️ הערות מוסרות לפני הסריקה — הן מסבירות את החסימה ולכן מכילות את
  // המילה, אבל הן אינן חלק מהתשובה ללקוחה.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const body = code.split('export async function POST')[1] ?? ''
  // ענף ה-blocked חייב להכיל רישום ללוג בלבד — בלי return משלו, כך
  // שהזרימה נופלת לענף הגנרי ומחזירה בדיוק את אותה תשובה ככשל שרת.
  const i = body.indexOf("result.error === 'blocked'")
  const branch = i === -1 ? '' : body.slice(i, body.indexOf('}', body.indexOf('{', i)))
  chk('🔒 ה-route מזהה blocked, רושם ללוג, ואינו מחזיר עליו תשובה ייעודית',
    i !== -1 && !/return/.test(branch) && /console\.error/.test(branch) && !/חסומה/.test(body))
  // ואין שום אזכור של חסימה בטקסט שנשלח ללקוחה
  chk('🔒 אין נוסח שמסגיר חסימה בשום תשובה',
    !/blocked|חסומ/.test((body.match(/message:\s*'[^']*'/g) ?? []).join(' ')))
}

// ── 5. מקבילות: אותה לקוחה, IP שונים ────────────────────────────────────────
section('5. מגבלת pending אטומית — נעילת namespace 5')

await db.query(`update public.business_settings set value = '2'::jsonb
                where key = 'max_active_pending_per_customer'`)
const P5 = '+972541110060'
await book({ phone: P5, startsAt: future(100), ip: '203.0.113.71' })
await book({ phone: P5, startsAt: future(102), ip: '203.0.113.72' })
const third = await tryBook({ phone: P5, startsAt: future(104), ip: '203.0.113.73' })
chk('הבקשה השלישית נחסמה למרות IP שונה',
  !third.ok && third.msg.includes('PENDING_LIMIT_REACHED'))
const p5count = await one(
  `select count(*)::int as n from public.appointments a join public.customers c on c.id = a.customer_id
   where c.phone_e164 = $1 and a.status = 'pending'`, [P5])
chk('🔒 ללקוחה בדיוק 2 pending, לא יותר', p5count.n === 2)
{
  // 🔒 הנעילה עצמה קיימת בקוד ולפני הספירה
  const sql = readFileSync(new URL('../supabase/migrations/0018_public_booking_rpcs.sql', import.meta.url), 'utf8')
  const lockAt = sql.indexOf('pg_advisory_xact_lock(5')
  const countAt = sql.indexOf('where customer_id = v_customer.id and status = ')
  chk('🔒 נעילת namespace 5 קיימת ומופיעה לפני הספירה',
    lockAt !== -1 && countAt !== -1 && lockAt < countAt)
  // ⚠️ נעילה 3 נלקחת בתוך link_or_create_customer_by_phone, ולכן הסדר
  // נבדק לפי מיקום ה*קריאה* אליה בגוף create_public_booking_request —
  // לא לפי מיקום הטקסט 'pg_advisory_xact_lock(3' בקובץ, שיושב למעלה
  // בהגדרת הפונקציה הנקראת.
  const fnBody = sql.slice(sql.indexOf('create or replace function public.create_public_booking_request'))
  const ipAt = fnBody.indexOf('pg_advisory_xact_lock(4')
  const phoneCallAt = fnBody.indexOf('public.link_or_create_customer_by_phone(')
  const custAt = fnBody.indexOf('pg_advisory_xact_lock(5')
  chk('🔒 סדר הנעילות בגוף הפונקציה: 4 → 3 → 5',
    ipAt !== -1 && ipAt < phoneCallAt && phoneCallAt < custAt)
}
await db.query(`update public.business_settings set value = '99'::jsonb
                where key = 'max_active_pending_per_customer'`)

// ── 6. אותו מספר חדש פעמיים ─────────────────────────────────────────────────
section('6. אותו מספר חדש — לקוחה אחת בלבד')

const P6 = '+972541110070'
await book({ phone: P6, name: 'ראשונה', startsAt: future(110), ip: '203.0.113.81' })
await book({ phone: P6, name: 'ניסיון לדרוס', startsAt: future(112), ip: '203.0.113.82' })
const c6 = await one(`select count(*)::int as n from public.customers where phone_e164 = $1`, [P6])
chk('🔒 נוצרה לקוחה אחת בלבד', c6.n === 1)

// ── 7. שם קיים אינו נדרס ────────────────────────────────────────────────────
section('7. שם קיים אינו נדרס')

const name7 = await one(`select full_name from public.customers where phone_e164 = $1`, [P6])
chk('🔒 השם נשאר של הבקשה הראשונה', name7.full_name === 'ראשונה')

await db.query(
  `insert into public.customers (phone_e164, full_name) values ('+972541110080', 'שם מה-CRM')`)
await book({ phone: '+972541110080', name: 'הוקלד בטופס', startsAt: future(120), ip: '203.0.113.83' })
const crmName = await one(`select full_name from public.customers where phone_e164 = '+972541110080'`)
chk('🔒 שם שנקבע ידנית ב-CRM אינו נדרס', crmName.full_name === 'שם מה-CRM')

// ── 8. חיבור OTP עתידי ──────────────────────────────────────────────────────
section('8. המבנה מאפשר חיבור OTP עתידי בלי כפילות')

const c8 = await one(`select * from public.customers where phone_e164 = $1`, [P6])
chk('auth_user_id נשאר null — אין חשבון התחברות', c8.auth_user_id === null)
const authId = '00000000-0000-0000-0000-0000000000b1'
await db.query(`insert into auth.users (id) values ($1)`, [authId])
// ⚠️ מחזירה jsonb ולא שורה, ולכן נקראת כעמודה בודדת ולא ב-select *
const linked8 = (await one(
  `select public.link_or_create_customer_for_auth($1, $2, 'שם מההתחברות') as result`,
  [authId, P6])).result
chk('🔒 ההתחברות מתקשרת לאותה לקוחה', linked8.customer_id === c8.id)
chk('🔒 לא נוצרה לקוחה כפולה',
  (await one(`select count(*)::int as n from public.customers where phone_e164 = $1`, [P6])).n === 1)
chk('🔒 גם ההתחברות אינה דורסת את השם', linked8.full_name === 'ראשונה')
chk('🔒 auth_user_id קושר לשורה הקיימת',
  (await one(`select auth_user_id from public.customers where phone_e164 = $1`, [P6])).auth_user_id === authId)

// ── 9. הרשאות ───────────────────────────────────────────────────────────────
section('9. הרשאות ה-RPC החדש')

const SIG = 'public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer)'
const perms = await one(`select
  has_function_privilege('anon',          '${SIG}', 'execute') as anon_can,
  has_function_privilege('authenticated', '${SIG}', 'execute') as auth_can,
  has_function_privilege('service_role',  '${SIG}', 'execute') as svc_can,
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_public_booking_request'
      and p.prosecdef) as definers`)
chk('🔒 anon אינו יכול', perms.anon_can === false)
chk('🔒 authenticated אינו יכול', perms.auth_can === false)
chk('service_role כן יכול', perms.svc_can === true)
chk('🔒 הפונקציה נשארה SECURITY INVOKER', perms.definers === 0)

// ── ולידציה ואכיפת קלט ──────────────────────────────────────────────────────
section('אכיפת קלט ב-RPC')

chk('טלפון שאינו E.164 נדחה',
  !(await tryBook({ phone: '0541234567', startsAt: future(130) })).ok)
chk('שם קצר מדי נדחה',
  !(await tryBook({ phone: '+972541110090', name: 'א', startsAt: future(130) })).ok)
chk('תפוגה מעבר ל-72 שעות נדחית',
  !(await tryBook({ phone: '+972541110091', startsAt: future(130), expires: future(200) })).ok)
chk('מועד תור בעבר נדחה',
  !(await tryBook({ phone: '+972541110092', startsAt: future(-5) })).ok)
{
  const r = await tryBook({ phone: '+972541110093', startsAt: future(140), ip: null })
  chk('🔒 בקשה בלי IP נדחית', !r.ok && r.msg.includes('MISSING_IP'))
}
{
  // 🔒 התקרה מהודקת ואינה ניתנת להרפיה
  const IP3 = '198.51.100.77'
  for (let i = 0; i < 5; i++) {
    await book({ phone: `+97254311000${i}`, startsAt: future(150 + i * 2), ip: IP3 })
  }
  let held = false
  try {
    await one(`select * from public.create_public_booking_request(
      '+972543110099','לקוחה','עיצוב גבות טבעיות',array['עיצוב גבות טבעי']::text[],70,
      $1::timestamptz,20,null,'v1',$2::timestamptz,$3::inet,1000000)`,
      [future(170), future(3), IP3])
  } catch (e) { held = e.message.includes('RATE_LIMITED') }
  chk('🔒 קורא שמעביר מגבלה ענקית עדיין נחסם ב-5', held)
}

// ── ניקוי אופורטוניסטי ──────────────────────────────────────────────────────
section('ניקוי booking_rate_events ללא Cron')

await db.query(
  `insert into public.booking_rate_events (ip, created_at)
   values ('203.0.113.200'::inet, now() - interval '5 hours')`)
chk('הוכנסה שורה ישנה',
  (await one(`select count(*)::int as n from public.booking_rate_events
              where created_at < now() - interval '2 hours'`)).n >= 1)
await book({ phone: '+972541110099', startsAt: future(180), ip: '203.0.113.201' })
chk('הקריאה הבאה ניקתה שורות ישנות',
  (await one(`select count(*)::int as n from public.booking_rate_events
              where created_at < now() - interval '2 hours'`)).n === 0)

// ── תור ידני ────────────────────────────────────────────────────────────────
section('תור ידני — תיוג admin_manual')

const adminId = '00000000-0000-0000-0000-0000000000aa'
await db.query(`insert into auth.users (id) values ($1)`, [adminId])
await db.query(`insert into public.admins (user_id) values ($1)`, [adminId])
const cm = await one(`select * from public.link_or_create_customer_by_phone('+972541110011', 'לקוחה ידנית')`)
const manual = await one(
  `select public.create_manual_appointment(
     $1,'עיצוב גבות טבעיות',array['עיצוב גבות טבעי']::text[],70,$2::timestamptz,20,'v1',$3,
     gen_random_uuid(), repeat('a',64)) as result`,
  [cm.id, future(200), adminId])
const manualRow = await one(`select * from public.appointments where id = $1`, [manual.result.appointment_id])
chk('תור ידני מתויג admin_manual', manualRow.booking_source === 'admin_manual')
chk('תור ידני נוצר כ-confirmed מיד', manualRow.status === 'confirmed')

// ── סיכום ───────────────────────────────────────────────────────────────────
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} עברו`)
process.exit(passed === results.length ? 0 : 1)
