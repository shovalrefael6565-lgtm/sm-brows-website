/**
 * 15I — תור מיקרובליידינג שנקבע לפי אירוע קיים ביומן, מול DB אמיתי (PGlite).
 *
 * ─── מה נבדק כאן ואי אפשר לבדוק בשום מקום אחר ─────────────────────────────
 *
 * test-google-sourced-booking.mjs מוכיח ש**המועד שנגזר** הוא של Google.
 * הוא אינו נוגע ב-DB, ולכן אינו יכול להוכיח את מה שקורה אחרי הכתיבה:
 *
 *   1. לקוחה חדשה לגמרי — בלי חשבון, בלי OTP, בלי auth_user_id — מקבלת
 *      תור, ושומרת בדיוק את המועד שנקרא מהיומן.
 *   2. ends_at ו-duration_min מסכימים עם אותו מועד (הטריגר מחשב ends_at,
 *      ולא הקורא).
 *   3. אירוע אחרי שעות הפעילות נשמר כמות שהוא — ל-DB אין ולידציית שעות
 *      פעילות, וזו בדיוק הסיבה שהחריגה אפשרית.
 *   4. **התזכורות נגזרות מהמועד של Google**: day_before ו-two_hours_before
 *      מחושבות מ-starts_at, ולכן שעה שגויה בשמירה הייתה שעה שגויה גם
 *      בהודעה ללקוחה.
 *   5. נירמול טלפון — '054…' ו-'+972…' הם אותה לקוחה, ולא שתיים.
 *
 * PGlite בזיכרון. אפס כתיבות לייצור, אפס רשת, אפס SMS, אפס Google.
 *
 * הרצה:  npm run test:google-adoption-db
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

let pass = 0, fail = 0
const chk = (name, ok = true, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, phone text);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
`)

const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const uuid = () => crypto.randomUUID()

const ADMIN_AUTH = uuid()

section('הרצת כל המיגרציות')
for (const name of MIGRATIONS) {
  if (name.startsWith('0010')) {
    await db.exec(`
      insert into auth.users values ('${ADMIN_AUTH}', '972541110002');
      insert into customers (id, phone_e164, full_name)
        values ('${ADMIN_AUTH}', '+972541110002', 'שובל');
      insert into admins (user_id) values ('${ADMIN_AUTH}');
    `)
  }
  try {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  } catch (e) {
    chk(`${name.slice(0, 4)} רצה ללא שגיאה`, false, e.message)
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו ללא שגיאה`)

const ADMIN_ID = ADMIN_AUTH

// ⚠️ אותה פונקציה בדיוק שהאפליקציה משתמשת בה. הבדיקה אינה מנרמלת בעצמה.
const { normalizePhone } = await import('../lib/phone.ts')

/** לקוחה ידנית דרך ה-RPC האמיתי — יוצאת ממנו בלי auth_user_id */
async function manualCustomer(name, rawPhone) {
  const e164 = normalizePhone(rawPhone)
  const r = await one(
    `select public.create_manual_customer($1,$2,'whatsapp','active',$3,$4,$5) j`,
    [name, e164, ADMIN_ID, uuid(), 'a'.repeat(64)],
  )
  return r.j
}

/**
 * יצירת התור **מהמועד של Google**: אלה בדיוק הערכים ש-
 * resolveAdoptedGoogleSlot מחזירה, ושהשרת מעביר ל-RPC.
 */
async function appointmentFromGoogleEvent(customerId, serviceKey, startsAt, durationMin) {
  const r = await one(
    `select public.create_manual_appointment(
       $1, $2, '{}'::text[], null, $3::timestamptz, $4, 'v1', $5, $6, $7) j`,
    [customerId, serviceKey, startsAt.toISOString(), durationMin, ADMIN_ID, uuid(), 'b'.repeat(64)],
  )
  return r.j
}

const remindersOf = id => q(
  `select reminder_kind, status, appointment_starts_at, scheduled_for, expires_at
   from appointment_reminders where appointment_id=$1 order by reminder_kind`, [id])

/** רגע UTC משעון קיר ישראלי — אותה שיטה של lib/israelTime */
const { israelWallTimeToUtc, fmtIsrael, israelDateStr } = await import('../lib/israelTime.ts')

/** תאריך עתידי קבוע ליום מסוים בעוד N ימים, כדי שהתור לא ייפול בעבר */
function futureDate(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return israelDateStr(d)
}

// ════════════════════════════════════════════════════════════════════════════
section('1 · לקוחה חדשה ללא חשבון + אירוע Google → נוצר תור')
// ════════════════════════════════════════════════════════════════════════════

let firstApptId = null
{
  const created = await manualCustomer('TEST רותי מיקרו', '054-999-0001')
  chk('הלקוחה נוצרה', created.result === 'customer_created', created.result)

  const cust = await one(
    `select auth_user_id, phone_e164 from customers where id=$1`, [created.customer_id])
  chk('⚠️ ללקוחה אין auth_user_id — לא נפתח חשבון ולא נשלח OTP', cust.auth_user_id === null)
  chk('ובכל זאת יש לה טלפון מנורמל', cust.phone_e164 === '+972549990001', cust.phone_e164)

  // האירוע ביומן: 10:20–11:20 (60 דקות) — בדיוק הדוגמה מהדרישה.
  const date = futureDate(6)
  const startsAt = israelWallTimeToUtc(date, '10:20')
  const appt = await appointmentFromGoogleEvent(
    created.customer_id, 'מיקרובליידינג', startsAt, 60)

  chk('התור נוצר', appt.result === 'appointment_created', appt.result)
  firstApptId = appt.appointment_id

  const row = await one(
    `select status, starts_at, ends_at, duration_min, price_total, booking_source, service_key
     from appointments where id=$1`, [appt.appointment_id])
  chk('התור confirmed מיד', row.status === 'confirmed', row.status)
  chk('booking_source הוא admin_manual', row.booking_source === 'admin_manual')

  // ════════════════════════════════════════════════════════════════════════
  section('2 · המועד שנשמר הוא של Google, 10:20–11:20')
  // ════════════════════════════════════════════════════════════════════════

  chk('שעת ההתחלה שנשמרה היא 10:20', fmtIsrael(new Date(row.starts_at)) === '10:20',
    fmtIsrael(new Date(row.starts_at)))
  chk('🔒 שעת הסיום שנגזרה היא 11:20', fmtIsrael(new Date(row.ends_at)) === '11:20',
    fmtIsrael(new Date(row.ends_at)))
  chk('המשך שנשמר הוא 60', row.duration_min === 60, String(row.duration_min))
  chk('התאריך שנשמר הוא של האירוע', israelDateStr(new Date(row.starts_at)) === date)
  chk('⚠️ 150 (ברירת המחדל של מיקרובליידינג) לא נכנס לשום מקום', row.duration_min !== 150)
  chk('מחיר ריק נשמר כ-null ולא כ-0', row.price_total === null, String(row.price_total))
}

// ════════════════════════════════════════════════════════════════════════════
section('8 · התזכורות נגזרות מהמועד של Google')
// ════════════════════════════════════════════════════════════════════════════

{
  const rem = await remindersOf(firstApptId)
  const appt = await one(`select starts_at from appointments where id=$1`, [firstApptId])
  const startMs = new Date(appt.starts_at).getTime()

  chk('נוצרו שתי תזכורות', rem.length === 2, `count=${rem.length}`)
  chk('שתיהן מצביעות על אותו snapshot של המועד',
    rem.every(r => new Date(r.appointment_starts_at).getTime() === startMs))

  const twoHours = rem.find(r => r.reminder_kind === 'two_hours_before')
  chk('🔒 two_hours_before מתוזמנת בדיוק שעתיים לפני המועד של Google',
    new Date(twoHours.scheduled_for).getTime() === startMs - 2 * 60 * 60 * 1000,
    fmtIsrael(new Date(twoHours.scheduled_for)))

  const dayBefore = rem.find(r => r.reminder_kind === 'day_before')
  chk('🔒 day_before מתוזמנת לאותה שעת קיר יום קודם',
    fmtIsrael(new Date(dayBefore.scheduled_for)) === '10:20',
    fmtIsrael(new Date(dayBefore.scheduled_for)))
  chk('שתיהן scheduled (התור בעוד 6 ימים — שני החלונות פתוחים)',
    rem.every(r => r.status === 'scheduled'),
    rem.map(r => `${r.reminder_kind}=${r.status}`).join(' '))

  // ⚠️ ההתנהגות הקיימת נשמרת: תור שנקבע פחות מ-24 שעות מראש נולד עם
  // day_before שנסגרה — window_passed_at_creation, בדיוק כמו קודם.
  const late = await manualCustomer('TEST מיקרו היום', '054-999-0009')
  const lateStart = new Date(Date.now() + 4 * 60 * 60 * 1000)
  const lateAppt = await appointmentFromGoogleEvent(
    late.customer_id, 'ייעוץ מיקרובליידינג', lateStart, 30)
  const lateRem = await remindersOf(lateAppt.appointment_id)
  const lateDay = lateRem.find(r => r.reminder_kind === 'day_before')
  chk('⚠️ window_passed_at_creation נשמר כפי שהיה',
    lateDay.status === 'skipped', lateDay.status)
  chk('two_hours_before של אותו תור עדיין scheduled',
    lateRem.find(r => r.reminder_kind === 'two_hours_before').status === 'scheduled')
}

// ════════════════════════════════════════════════════════════════════════════
section('3 · אירוע אחרי שעות הפעילות נוצר ונשמר כמות שהוא')
// ════════════════════════════════════════════════════════════════════════════

{
  // שעות הפעילות מסתיימות ב-19:00. האירוע ביומן: 20:30–21:30.
  const created = await manualCustomer('TEST ערב מאוחר', '054-999-0002')
  const date = futureDate(9)
  const startsAt = israelWallTimeToUtc(date, '20:30')
  const appt = await appointmentFromGoogleEvent(
    created.customer_id, 'מיקרובליידינג', startsAt, 60)

  chk('🔒 התור נוצר למרות שהוא מחוץ לשעות הפעילות',
    appt.result === 'appointment_created', appt.result)

  const row = await one(
    `select starts_at, ends_at, duration_min from appointments where id=$1`,
    [appt.appointment_id])
  chk('נשמר 20:30', fmtIsrael(new Date(row.starts_at)) === '20:30', fmtIsrael(new Date(row.starts_at)))
  chk('נשמר עד 21:30', fmtIsrael(new Date(row.ends_at)) === '21:30', fmtIsrael(new Date(row.ends_at)))
  chk('משך 60', row.duration_min === 60)
}

// ════════════════════════════════════════════════════════════════════════════
section('9 · נירמול טלפון מונע לקוחה כפולה')
// ════════════════════════════════════════════════════════════════════════════

{
  const a = await manualCustomer('TEST כפילות', '0541230077')
  chk('הלקוחה נוצרה בפעם הראשונה', a.result === 'customer_created', a.result)

  // אותה לקוחה, פורמט אחר לגמרי — כולל מקפים וקידומת בינלאומית.
  const b = await manualCustomer('TEST כפילות אחרת', '+972-54-123-0077')
  chk('🔒 הפורמט הבינלאומי זוהה כלקוחה הקיימת', b.result === 'existing_customer', b.result)
  chk('🔒 אותו מזהה — לא נוצרה כפילות', b.customer_id === a.customer_id)

  const c = await manualCustomer('TEST כפילות שלישית', '972541230077')
  chk('גם בלי + וגם בלי 0 — אותה לקוחה', c.customer_id === a.customer_id)

  const count = await one(
    `select count(*)::int n from customers where phone_e164 = '+972541230077'`)
  chk('קיימת שורה אחת בלבד לטלפון הזה', count.n === 1, `n=${count.n}`)

  // ⚠️ השם של הלקוחה הקיימת אינו נדרס ע"י מה שהוקלד עכשיו.
  const name = await one(`select full_name from customers where id=$1`, [a.customer_id])
  chk('⚠️ שם הלקוחה הקיימת נשאר כפי שהוא', name.full_name === 'TEST כפילות', name.full_name)
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} עברו, ${fail} נכשלו`)
process.exit(fail === 0 ? 0 : 1)
