/**
 * שלב 15D — בדיקות מול Postgres אמיתי (PGlite, לא מול הפרויקט ב-Supabase).
 *
 * מכסה את מה שאי אפשר לבדוק בלוגיקה טהורה:
 *   • create_personal_area_booking_request — booking_source, תפוגה, היסטוריה
 *   • 🔒 הפריסה הדו-שלבית: אחרי 0020 בלבד **שתי** הפונקציות חיות (אין חלון
 *     שבירה), ואחרי 0021 הישנה נעלמה
 *   • נעילת namespace 5 ומגבלת ה-pending
 *   • לקוחה חסומה, קלט פסול, EXCLUDE constraint
 *   • 🔴 **המקרה הקריטי**: הזמנה ציבורית ללא התחברות → OTP עם אותו מספר
 *     → אותה customer בדיוק, בלי כפילות, השם לא נדרס, התור הישן נשאר
 *
 * הרצה:  npm run test:personal-area-db
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(66)}${extra}`)
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

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
chk('0020 קיימת ברשימה', migrations.includes('0020_personal_area_booking.sql'))
chk('0021 קיימת ברשימה', migrations.includes('0021_drop_legacy_create_pending.sql'))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows

const future = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()

/** בקשה מהאזור האישי — אותם ארגומנטים שה-wrapper ב-lib/db שולח */
const bookPA = ({ customerId, startsAt, expires = future(3), duration = 20,
                  service = 'עיצוב גבות טבעיות', variants = ['עיצוב גבות טבעי'],
                  price = 70, notes = null }) =>
  one(
    `select * from public.create_personal_area_booking_request(
       $1::uuid, $2, $3::text[], $4, $5::timestamptz, $6, $7, 'v1', $8::timestamptz)`,
    [customerId, service, variants, price, startsAt, duration, notes, expires],
  )

const tryPA = async (args) => {
  try { return { ok: true, row: await bookPA(args) } }
  catch (e) { return { ok: false, msg: e.message } }
}

/** בקשה מהמסלול הציבורי — לשם ההשוואה ולמקרה הקריטי */
const bookPublic = ({ phone, name = 'לקוחת בדיקה', startsAt, ip = '203.0.113.5',
                      expires = future(3), duration = 20 }) =>
  one(
    `select * from public.create_public_booking_request(
       $1, $2, 'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
       $3::timestamptz, $4, null, 'v1', $5::timestamptz, $6::inet, 5)`,
    [phone, name, startsAt, duration, expires, ip],
  )

const counts = async () => one(`select
  (select count(*)::int from public.customers)    as customers,
  (select count(*)::int from public.appointments) as appointments`)

/** לקוחה קיימת (בלי auth user) — כמו לקוחה שנוצרה במסלול הציבורי */
async function makeCustomer(phone, name = 'לקוחה', blocked = false) {
  const row = await one(
    `insert into public.customers (phone_e164, full_name, is_blocked)
     values ($1, $2, $3) returning *`, [phone, name, blocked])
  return row
}

await db.query(`update public.business_settings set value = '99'::jsonb
                where key = 'max_active_pending_per_customer'`)


// ════════════════════════════════════════════════════════════════════════════
section('1. ה-RPC הישן הוסר (אחרי 0021)')

{
  const old = await one(`select count(*)::int as n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_pending_appointment'`)
  chk('🔒 create_pending_appointment אינה קיימת יותר', old.n === 0, `count=${old.n}`)

  const neu = await one(`select count(*)::int as n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_personal_area_booking_request'`)
  chk('create_personal_area_booking_request קיימת בדיוק פעם אחת', neu.n === 1)

  // ⚠️ שתי אלה נשארות בשימוש פעיל ואסור היה למחוק אותן יחד עם הישנה.
  for (const fn of ['cancel_pending_appointment', 'expire_stale_pending_appointments']) {
    const r = await one(`select count(*)::int as n from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [fn])
    chk(`${fn} שרדה את ה-DROP`, r.n === 1)
  }
}


// ════════════════════════════════════════════════════════════════════════════
section('2. בקשה מהאזור האישי — התור, המקור, התפוגה וההיסטוריה')

const c1 = await makeCustomer('+972541220001', 'רונית לוי')
const expires1 = future(3)
const a1 = await bookPA({ customerId: c1.id, startsAt: future(30), expires: expires1 })

chk('נוצר תור pending', a1.status === 'pending' && !!a1.id)
chk('🔒 booking_source = personal_area', a1.booking_source === 'personal_area',
  String(a1.booking_source))
chk('🔒 0030: pending_expires_at הוא null — לא expires1 שנשלח, אין תפוגה מבוססת-זמן',
  a1.pending_expires_at === null, `${a1.pending_expires_at}`)
chk('התור משויך ללקוחה שנשלחה', a1.customer_id === c1.id)
chk('ends_at חושב ע"י הטריגר',
  new Date(a1.ends_at) - new Date(a1.starts_at) === 20 * 60_000)

{
  const h = await one(`select * from public.appointment_history where appointment_id = $1`, [a1.id])
  chk('נכתבה שורת היסטוריה created/customer',
    h.action === 'created' && h.actor === 'customer' && h.to_status === 'pending')
  chk('actor_id הוא מזהה הלקוחה', h.actor_id === c1.id)
  chk('to_starts_at נרשם', h.to_starts_at !== null)
}


// ════════════════════════════════════════════════════════════════════════════
section('3. 0030 — שני המסלולים זהים: אף אחד לא שומר תפוגה אמיתית')

{
  const shared = future(3)
  const cPa = await makeCustomer('+972541220010', 'השוואה א')
  const rPa = await bookPA({ customerId: cPa.id, startsAt: future(200), expires: shared })
  const rPub = await bookPublic({ phone: '+972541220011', name: 'השוואה ב',
                                  startsAt: future(202), expires: shared, ip: '203.0.113.31' })
  chk('🔒 שני המסלולים כותבים null ל-pending_expires_at, לא את מה שנשלח',
    rPa.pending_expires_at === null && rPub.pending_expires_at === null)
  chk('booking_source מבדיל ביניהם',
    rPa.booking_source === 'personal_area' && rPub.booking_source === 'public_booking')
}


// ════════════════════════════════════════════════════════════════════════════
section('4. קלט שנדחה')

{
  const c = await makeCustomer('+972541220020', 'ולידציה')

  const noCustomer = await tryPA({ customerId: null, startsAt: future(40) })
  chk('customer_id ריק → MISSING_CUSTOMER',
    !noCustomer.ok && noCustomer.msg.includes('MISSING_CUSTOMER'))

  const ghost = await tryPA({
    customerId: '00000000-0000-0000-0000-0000000000ff', startsAt: future(41) })
  chk('לקוחה שאינה קיימת → CUSTOMER_NOT_FOUND',
    !ghost.ok && ghost.msg.includes('CUSTOMER_NOT_FOUND'))

  const past = await tryPA({ customerId: c.id, startsAt: future(-1) })
  chk('מועד בעבר → START_IN_PAST', !past.ok && past.msg.includes('START_IN_PAST'))

  const tooFar = await tryPA({ customerId: c.id, startsAt: future(42), expires: future(80) })
  chk('תפוגה מעל 72 שעות → BAD_EXPIRY', !tooFar.ok && tooFar.msg.includes('BAD_EXPIRY'))

  const pastExpiry = await tryPA({ customerId: c.id, startsAt: future(43), expires: future(-1) })
  chk('תפוגה שכבר עברה → BAD_EXPIRY', !pastExpiry.ok && pastExpiry.msg.includes('BAD_EXPIRY'))

  const sane = await tryPA({ customerId: c.id, startsAt: future(44), expires: future(66) })
  chk('66 שעות (חמישי ערב → ראשון 11:00) עדיין מתקבלות', sane.ok)
}


// ════════════════════════════════════════════════════════════════════════════
section('5. לקוחה חסומה')

{
  const blocked = await makeCustomer('+972541220030', 'לקוחה חסומה', true)
  const before = await counts()
  const res = await tryPA({ customerId: blocked.id, startsAt: future(50) })
  const after = await counts()
  chk('נזרק CUSTOMER_BLOCKED', !res.ok && res.msg.includes('CUSTOMER_BLOCKED'))
  chk('🔒 לא נוצר תור', after.appointments === before.appointments)
}


// ════════════════════════════════════════════════════════════════════════════
section('6. EXCLUDE constraint — pending חוסם סלוט, בלי partial write')

{
  const cA = await makeCustomer('+972541220040', 'תופסת')
  const cB = await makeCustomer('+972541220041', 'מתנגשת')
  const slot = future(60)
  await bookPA({ customerId: cA.id, startsAt: slot })

  const before = await counts()
  const clash = await tryPA({ customerId: cB.id, startsAt: slot })
  const after = await counts()

  chk('בקשה חופפת נחסמת (23P01)',
    !clash.ok && (clash.msg.includes('exclusion') || clash.msg.includes('23P01')))
  chk('🔒 לא נוצר תור', after.appointments === before.appointments)
  const hist = await one(
    `select count(*)::int as n from public.appointment_history h
     where h.actor_id = $1`, [cB.id])
  chk('🔒 לא נכתבה שורת היסטוריה יתומה', hist.n === 0)

  // חפיפה גם מול תור מהמסלול הציבורי — אותו constraint, בלי קשר למקור
  const pubSlot = future(62)
  await bookPublic({ phone: '+972541220042', startsAt: pubSlot, ip: '203.0.113.41' })
  const cross = await tryPA({ customerId: cB.id, startsAt: pubSlot })
  chk('🔒 תור ציבורי חוסם בקשה מהאזור האישי על אותה שעה',
    !cross.ok && (cross.msg.includes('exclusion') || cross.msg.includes('23P01')))
}


// ════════════════════════════════════════════════════════════════════════════
section('7. 0030 — pending לעולם לא משחרר סלוט מעצמו')

{
  const cA = await makeCustomer('+972541220050', 'תופסת ללא הגבלת זמן')
  const cB = await makeCustomer('+972541220051', 'מנסה לתפוס')
  const slot = future(70)
  const stale = await bookPA({ customerId: cA.id, startsAt: slot })

  // מדמה שורה עם מועד תפוגה בעבר, כמו שורה ישנה מלפני 0030
  await db.query(`update public.appointments set pending_expires_at = now() - interval '1 hour'
                  where id = $1`, [stale.id])

  // ⚠️ בלי sweep נפרד: expire_stale_pending_appointments רצה בתוך ה-RPC עצמו,
  // אבל אחרי 0030 היא no-op — הסלוט חייב להישאר תפוס
  const reused = await tryPA({ customerId: cB.id, startsAt: slot })
  chk('🔒 0030: הסלוט נשאר חסום — pending_expires_at בעבר לא משחרר אותו',
    !reused.ok && (reused.msg.includes('exclusion') || reused.msg.includes('23P01')))

  const old = await one(`select status from public.appointments where id = $1`, [stale.id])
  chk('🔒 הבקשה נשארת pending — לא expired', old.status === 'pending')

  // רק שינוי סטטוס בפועל (דחייה/ביטול/אישור) משחרר — לא הזמן
  await db.query(`update public.appointments set status = 'rejected' where id = $1`, [stale.id])
  const reused2 = await tryPA({ customerId: cB.id, startsAt: slot })
  chk('אחרי שהסטטוס השתנה בפועל (rejected) הסלוט משתחרר', reused2.ok, reused2.ok ? '' : reused2.msg)
}


// ════════════════════════════════════════════════════════════════════════════
section('8. מגבלת pending ונעילת namespace 5')

{
  await db.query(`update public.business_settings set value = '2'::jsonb
                  where key = 'max_active_pending_per_customer'`)
  const c = await makeCustomer('+972541220060', 'מגבלה')
  await bookPA({ customerId: c.id, startsAt: future(80) })
  await bookPA({ customerId: c.id, startsAt: future(82) })
  const third = await tryPA({ customerId: c.id, startsAt: future(84) })
  chk('בקשה שלישית נחסמת', !third.ok && third.msg.includes('PENDING_LIMIT_REACHED'))

  const n = await one(
    `select count(*)::int as n from public.appointments
     where customer_id = $1 and status = 'pending'`, [c.id])
  chk('🔒 ללקוחה בדיוק 2 pending', n.n === 2)

  // 🔒 המגבלה חוצה מסלולים: pending מהאזור האישי נספר גם מול המסלול הציבורי
  const crossed = await (async () => {
    try {
      await bookPublic({ phone: '+972541220060', startsAt: future(86), ip: '203.0.113.51' })
      return { ok: true }
    } catch (e) { return { ok: false, msg: e.message } }
  })()
  chk('🔒 בקשה ציבורית מאותה לקוחה נחסמת על אותה מגבלה',
    !crossed.ok && crossed.msg.includes('PENDING_LIMIT_REACHED'))

  {
    // 🔒 הנעילה קיימת בקוד, באותו namespace כמו 0018, ולפני הספירה
    const sql = readFileSync(new URL('../supabase/migrations/0020_personal_area_booking.sql', import.meta.url), 'utf8')
    const fnBody = sql.slice(sql.indexOf('create or replace function public.create_personal_area_booking_request'))
    const lockAt = fnBody.indexOf('pg_advisory_xact_lock(5')
    const countAt = fnBody.indexOf('where customer_id = p_customer_id and status =')
    const insertAt = fnBody.indexOf('insert into public.appointments')
    chk('🔒 נעילת namespace 5 קיימת', lockAt !== -1)
    chk('🔒 הנעילה מופיעה לפני הספירה ולפני ה-INSERT',
      lockAt !== -1 && lockAt < countAt && countAt < insertAt)
    chk('🔒 מפתח הנעילה הוא customer_id — אותו מפתח כמו ב-0018',
      /pg_advisory_xact_lock\(5,\s*hashtext\(p_customer_id::text\)\)/.test(fnBody))
  }

  await db.query(`update public.business_settings set value = '99'::jsonb
                  where key = 'max_active_pending_per_customer'`)
}


// ════════════════════════════════════════════════════════════════════════════
section('9. 🔴 המקרה הקריטי — הזמנה ציבורית, ואז התחברות עם אותו מספר')

{
  const PHONE = '+972541230099'
  const AUTH_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001'

  // ── שלב א: הזמנה ציבורית, בלי התחברות ────────────────────────────────
  const before = await counts()
  const publicAppt = await bookPublic({
    phone: PHONE, name: 'מיכל אברהם', startsAt: future(120), ip: '203.0.113.90' })
  const afterPublic = await counts()

  const created = await one(
    `select * from public.customers where phone_e164 = $1`, [PHONE])

  chk('א. נוצרה לקוחה אחת מהמסלול הציבורי', afterPublic.customers === before.customers + 1)
  chk('א. 🔒 auth_user_id ריק — לא נוצר חשבון התחברות', created.auth_user_id === null)
  chk('א. התור נשמר עם booking_source=public_booking',
    publicAppt.booking_source === 'public_booking')
  chk('א. השם שהוקלד נשמר', created.full_name === 'מיכל אברהם')

  const C1 = created.id

  // ── שלב ב: אחר כך — התחברות OTP עם אותו מספר בדיוק ───────────────────
  // זה מה ש-resolveCustomerForLogin עושה אחרי אימות הקוד: יוצרת auth user
  // (כאן: שורה ב-auth.users) ואז קוראת ל-link_or_create_customer_for_auth.
  await db.query(`insert into auth.users (id) values ($1)`, [AUTH_ID])

  const linked = await one(
    `select public.link_or_create_customer_for_auth($1::uuid, $2, $3) as r`,
    [AUTH_ID, PHONE, 'שם אחר לגמרי שהוקלד בטופס ההתחברות'])
  const r = linked.r

  const afterLogin = await counts()
  const nowRow = await one(`select * from public.customers where phone_e164 = $1`, [PHONE])
  const dupes = await one(
    `select count(*)::int as n from public.customers where phone_e164 = $1`, [PHONE])

  chk('ב. 🔴 אותה customer בדיוק — לא נוצרה חדשה', r.customer_id === C1,
    `${r.customer_id} vs ${C1}`)
  chk('ב. 🔴 אין כפילות: שורת לקוחה אחת למספר', dupes.n === 1, `count=${dupes.n}`)
  chk('ב. 🔴 לא נוצרה שום לקוחה נוספת בכלל',
    afterLogin.customers === afterPublic.customers)
  chk('ב. הקישור בוצע (linked=true, created=false)',
    r.linked === true && r.created === false)
  chk('ב. auth_user_id התמלא', nowRow.auth_user_id === AUTH_ID)
  chk('ב. 🔴 full_name **לא נדרס** ע"י מה שהוקלד בהתחברות',
    nowRow.full_name === 'מיכל אברהם', nowRow.full_name)

  // ── שלב ג: מה שהאזור האישי יראה ──────────────────────────────────────
  // /account טוען את התורים לפי customer_id — אותו מזהה שהתקבל למעלה.
  const visible = await all(
    `select id, status, booking_source from public.appointments
     where customer_id = $1 order by starts_at`, [C1])

  chk('ג. 🔴 התור מלפני ההתחברות מופיע ברשימת הלקוחה',
    visible.some(a => a.id === publicAppt.id), `${visible.length} תורים`)

  // ── שלב ד: מכאן היא יכולה לקבוע תור מהאזור האישי ─────────────────────
  const paAppt = await bookPA({ customerId: C1, startsAt: future(126) })
  const both = await all(
    `select booking_source from public.appointments where customer_id = $1
     order by starts_at`, [C1])

  chk('ד. הבקשה החדשה נשמרה תחת אותה לקוחה', paAppt.customer_id === C1)
  chk('ד. 🔴 שני התורים יחד תחת לקוחה אחת, עם מקורות שונים',
    both.length === 2 &&
    both.some(b => b.booking_source === 'public_booking') &&
    both.some(b => b.booking_source === 'personal_area'),
    both.map(b => b.booking_source).join(' + '))

  // ── ה: התחברות חוזרת אינה משנה דבר (idempotent) ──────────────────────
  const again = await one(
    `select public.link_or_create_customer_for_auth($1::uuid, $2, null) as r`,
    [AUTH_ID, PHONE])
  chk('ה. התחברות חוזרת מחזירה את אותה לקוחה, בלי שינוי',
    again.r.customer_id === C1 && again.r.created === false && again.r.linked === false)
  const stillOne = await one(
    `select count(*)::int as n from public.customers where phone_e164 = $1`, [PHONE])
  chk('ה. 🔒 עדיין שורת לקוחה אחת', stillOne.n === 1)
}


// ════════════════════════════════════════════════════════════════════════════
section('10. מנהלת אינה מקבלת בעלות על לקוחה')

{
  // ⚠️ מנהלת כן מקבלת שורת customers (כדי להתחבר), אבל ההפרדה נאכפת
  // בקוד: getCurrentCustomerId מחזירה null לכל session שאינו 'customer'.
  // כאן נבדק רק שהמודל ב-DB מאפשר את ההפרדה — auth_user_id של מנהלת
  // אינו מקנה שום גישה לתורים של לקוחה אחרת.
  const src = readFileSync(new URL('../lib/auth/currentCustomer.ts', import.meta.url), 'utf8')
  chk("🔒 getCurrentCustomerId חוסמת role שאינו 'customer'",
    /session\.role\s*!==\s*'customer'/.test(src) && /return null/.test(src))
  chk('🔒 הבעלות נשענת על auth_user_id ולא על cid מה-cookie',
    /\.eq\('auth_user_id',\s*session\.userId\)/.test(src))

  const route = readFileSync(new URL('../app/api/appointments/route.ts', import.meta.url), 'utf8')
  chk('🔒 ה-route לוקח customerId מ-getCurrentCustomerId בלבד',
    /getCurrentCustomerId\(\)/.test(route))
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  chk('🔒 אין קריאת טלפון או customerId מגוף הבקשה',
    !/body\.(phone|customerId|customer_id)/.test(code))
}


// ════════════════════════════════════════════════════════════════════════════
section('11. הרשאות')

{
  const grants = await all(`
    select grantee from information_schema.role_routine_grants
    where routine_name = 'create_personal_area_booking_request'`)
  const names = grants.map(g => g.grantee)
  chk('service_role מורשה', names.includes('service_role'), names.join(', '))
  chk('🔒 anon / authenticated / PUBLIC אינם מורשים',
    !names.some(n => ['anon', 'authenticated', 'PUBLIC'].includes(n)), names.join(', '))

  const sec = await one(`select prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_personal_area_booking_request'`)
  chk('🔒 הפונקציה היא SECURITY INVOKER', sec.prosecdef === false)
}


// ════════════════════════════════════════════════════════════════════════════
section('12. 🔒 חלון הפריסה — אחרי 0020 בלבד, שתי הפונקציות חיות')

/*
 * ⚠️ זו הבדיקה שמצדיקה את הפיצול ל-שתי מיגרציות, והיא **חייבת** מסד נפרד:
 * ה-DB שלמעלה כבר הריץ את 0021. כאן נבנה מסד שני שנעצר בדיוק ב-0020 —
 * זהו מצב הפרודקשן בין שלב 1 (מיגרציה) לשלב 4 (ניקוי), כלומר הרגע שבו
 * deployment ישן ו-deployment חדש עשויים לרוץ במקביל.
 *
 * אם הבדיקה הזו נופלת, סימן שה-DROP חזר ל-0020 וחלון השבירה חזר איתו.
 */
{
  const db2 = new PGlite({ extensions: { btree_gist } })
  await db2.waitReady
  await db2.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create table auth._session (uid uuid);
    create or replace function auth.uid() returns uuid
      language sql stable security definer set search_path = auth
      as $$ select uid from auth._session limit 1 $$;
    create role service_role; create role authenticated; create role anon;
  `)

  const upTo20 = migrations.filter(f => f < '0021')
  let ranClean = true
  for (const f of upTo20) {
    try { await db2.exec(readFileSync(new URL(f, MIG_DIR), 'utf8')) }
    catch (e) { ranClean = false; chk(`${f} רצה`, false, e.message); break }
  }
  chk(`${upTo20.length} מיגרציות עד 0020 (כולל) רצו נקי`, ranClean)

  if (ranClean) {
    const one2 = async (sql, params) => (await db2.query(sql, params)).rows[0]

    const both = await one2(`select
      count(*) filter (where p.proname = 'create_pending_appointment')::int           as old,
      count(*) filter (where p.proname = 'create_personal_area_booking_request')::int as neu
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`)

    chk('🔒 ה-RPC הישן **עדיין חי** — deployment ישן ימשיך לעבוד', both.old === 1)
    chk('🔒 ה-RPC החדש כבר קיים — deployment חדש עובד', both.neu === 1)

    // ולא רק קיימות — שתיהן באמת מבצעות
    const cust = await one2(
      `insert into public.customers (phone_e164, full_name)
       values ('+972541240001', 'חלון פריסה') returning id`)
    const soon = (h) => new Date(Date.now() + h * 3600_000).toISOString()

    const viaOld = await one2(
      `select * from public.create_pending_appointment(
         $1::uuid, 'עיצוב גבות טבעיות', '{}'::text[], 70, $2::timestamptz, 20, null, 'v1')`,
      [cust.id, soon(300)])
    chk('🔒 קריאה למסלול הישן מצליחה (הקוד הישן אינו נשבר)',
      viaOld.status === 'pending')
    chk('התור הישן נשמר בלי booking_source — כמו שהיה',
      viaOld.booking_source === null, String(viaOld.booking_source))

    const viaNew = await one2(
      `select * from public.create_personal_area_booking_request(
         $1::uuid, 'עיצוב גבות טבעיות', '{}'::text[], 70, $2::timestamptz, 20, null, 'v1', $3::timestamptz)`,
      [cust.id, soon(302), soon(3)])
    chk('🔒 קריאה למסלול החדש מצליחה באותו מסד בדיוק',
      viaNew.status === 'pending' && viaNew.booking_source === 'personal_area')

    // 🔒 והכלל שבגללו מחליפים: הישן עדיין נותן 12 שעות, החדש נותן מה שנשלח
    const oldGap = (new Date(viaOld.pending_expires_at) - new Date(viaOld.created_at)) / 3600_000
    const newGap = (new Date(viaNew.pending_expires_at) - new Date(viaNew.created_at)) / 3600_000
    chk('🔒 ההבדל שבגללו מחליפים: הישן 12 שעות, החדש 3',
      Math.round(oldGap) === 12 && Math.round(newGap) === 3,
      `old=${oldGap.toFixed(1)}h new=${newGap.toFixed(1)}h`)

    // ── ואז 0021 סוגרת את החלון ─────────────────────────────────────────
    await db2.exec(readFileSync(new URL('0021_drop_legacy_create_pending.sql', MIG_DIR), 'utf8'))
    const after = await one2(`select
      count(*) filter (where p.proname = 'create_pending_appointment')::int           as old,
      count(*) filter (where p.proname = 'create_personal_area_booking_request')::int as neu
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`)
    chk('0021 על אותו מסד מוחקת את הישן ומשאירה את החדש',
      after.old === 0 && after.neu === 1)

    // 🔒 והתורים שנוצרו לפני המחיקה לא נגעו — DROP על פונקציה אינו נוגע בנתונים
    const survived = await one2(
      `select count(*)::int as n from public.appointments where customer_id = $1`, [cust.id])
    chk('🔒 התורים שנוצרו לפני המחיקה שרדו', survived.n === 2, `count=${survived.n}`)
  }

  await db2.close()
}


// ── סיכום ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(70))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
