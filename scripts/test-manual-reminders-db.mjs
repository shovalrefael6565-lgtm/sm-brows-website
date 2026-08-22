/**
 * תור ידני שנקבע ע"י שובל → שתי תזכורות, גם ללקוחה שאין לה חשבון.
 *
 * ⚠️ למה הקובץ הזה קיים בנפרד, ולא כעוד סקשן ב-test-reminders.mjs:
 *
 * test-reminders.mjs מוכיח את מנוע התזכורות מול תור שנוצר ב-INSERT ישיר
 * (`mkAppt`, service_key='natural'). test-manual-booking.mjs מוכיח את
 * create_manual_appointment — ואינו בודק ולו תזכורת אחת. שני הקבצים ירוקים,
 * והחיבור **ביניהם** לא נבדק בשום מקום: תור שנוצר דרך ה-RPC האמיתי, ללקוחה
 * שה-auth_user_id שלה NULL, בטיפול שקיים רק בממשק הניהול.
 *
 * זה בדיוק המסלול שמשמש בפועל: שובל קובעת מיקרובליידינג או ייעוץ ללקוחה
 * שהגיעה בטלפון ומעולם לא עשתה OTP. שלושת ההבדלים האלה מול המסלול הבדוק —
 * ה-RPC, היעדר החשבון, ו-service_key בעברית שאינו בקטלוג הציבורי — כולם
 * נמצאים בין ה-INSERT לבין ההודעה שיוצאת, ולכן כולם יכלו לשבור אותה בשקט.
 *
 * מה נאכף כאן:
 *
 *   1. create_manual_appointment יוצרת confirmed, והטריגר מייצר **שתי**
 *      תזכורות — day_before ו-two_hours_before — לשני ה-service_key
 *      הניהוליים, ללקוחה בלי חשבון.
 *   2. loadReminderRecipient ימצא טלפון: ל-customers של לקוחה ידנית יש
 *      phone_e164 אף שאין לה auth_user_id.
 *   3. שתיהן עוברות claim → finish עם provider='sms_019' ומגיעות ל-'sent'.
 *   4. 🔒 תור שנקבע לפחות מ-24 שעות מראש: day_before נולדת skipped עם
 *      window_passed_at_creation, ו-two_hours_before **עדיין נשלחת**.
 *      זו התנהגות מתוכננת (0011), לא תקלה — והבדיקה כאן היא מה שיחזיק
 *      אותה ככזו אם מישהו "יתקן" אותה בעתיד.
 *
 * PGlite בזיכרון. אפס כתיבות לייצור, אפס רשת, אפס SMS.
 *
 * הרצה:  npm run test:manual-reminders-db
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

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
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
    console.log('\n⛔ עוצר.')
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו ללא שגיאה`)

// admins.user_id הוא ה-PK — אין עמודת id נפרדת, וזה גם מה ש-assert_crm_actor_is_admin בודקת
const ADMIN_ID = ADMIN_AUTH

// ⚠️ שני ה-service_key **בעברית** ובאותיות המדויקות של lib/services.ts.
// הם נשמרים ב-appointments.service_key כמות שהם, ואינם מוכרים לקטלוג
// הציבורי — בדיוק המצב שמסלול הלקוחה לעולם אינו מייצר.
const ADMIN_ONLY = ['מיקרובליידינג', 'ייעוץ מיקרובליידינג']

let phoneSeq = 0
const nextPhone = () => `+9725412${String(20000 + phoneSeq++).slice(-5)}`

/** לקוחה ידנית: נוצרת דרך ה-RPC האמיתי, ויוצאת ממנו בלי auth_user_id */
async function manualCustomer(name) {
  const r = await one(
    `select public.create_manual_customer($1,$2,'whatsapp','active',$3,$4,$5) j`,
    [name, nextPhone(), ADMIN_ID, uuid(), 'a'.repeat(64)],
  )
  return r.j.customer_id
}

async function manualAppointment(customerId, serviceKey, interval) {
  const r = await one(
    `select public.create_manual_appointment(
       $1, $2, '{}'::text[], 350, now() + $3::interval, 150, 'v1', $4, $5, $6) j`,
    [customerId, serviceKey, interval, ADMIN_ID, uuid(), 'b'.repeat(64)],
  )
  return r.j
}

const remindersOf = id => q(
  `select reminder_kind, status, provider, outcome_reason, scheduled_for, expires_at, sent_at
   from appointment_reminders where appointment_id=$1 order by reminder_kind`, [id])

// ════════════════════════════════════════════════════════════════════════════
section('תור ידני ללקוחה ללא חשבון — שתי תזכורות')
// ════════════════════════════════════════════════════════════════════════════

const created = {}

let dayOffset = 4
for (const service of ADMIN_ONLY) {
  dayOffset += 3   // ⚠️ מועד נפרד לכל תור — appointments_no_overlap אוסר חפיפה
  const cid = await manualCustomer(`TEST ${service}`)
  const cust = await one(`select auth_user_id, phone_e164 from customers where id=$1`, [cid])

  chk(`[${service}] ⚠️ ללקוחה אין חשבון — auth_user_id הוא NULL`,
    cust.auth_user_id === null)
  chk(`[${service}] 🔒 ובכל זאת יש לה phone_e164 — loadReminderRecipient ימצא נמען`,
    typeof cust.phone_e164 === 'string' && cust.phone_e164.startsWith('+972'))

  // 5 ימים קדימה: שני החלונות פתוחים לגמרי בזמן היצירה
  const appt = await manualAppointment(cid, service, `${dayOffset} days`)
  chk(`[${service}] create_manual_appointment החזירה appointment_created`,
    appt.result === 'appointment_created', appt.result)

  const row = await one(
    `select status, booking_source, service_key from appointments where id=$1`,
    [appt.appointment_id])
  chk(`[${service}] התור נוצר confirmed`, row.status === 'confirmed', row.status)
  chk(`[${service}] booking_source הוא admin_manual`, row.booking_source === 'admin_manual')
  chk(`[${service}] ה-service_key נשמר בעברית כמות שהוא`, row.service_key === service)

  const rem = await remindersOf(appt.appointment_id)
  chk(`[${service}] 🔒 נוצרו בדיוק שתי תזכורות`, rem.length === 2, `count=${rem.length}`)
  chk(`[${service}] 🔒 day_before + two_hours_before, שתיהן scheduled`,
    rem.map(r => r.reminder_kind).sort().join(',') === 'day_before,two_hours_before'
      && rem.every(r => r.status === 'scheduled'),
    rem.map(r => `${r.reminder_kind}=${r.status}`).join(' '))

  created[service] = appt.appointment_id
}

// ════════════════════════════════════════════════════════════════════════════
section('שתיהן נשלחות בפועל דרך sms_019')
// ════════════════════════════════════════════════════════════════════════════

for (const service of ADMIN_ONLY) {
  const apptId = created[service]

  // מקדימים את שתי התזכורות כדי שיהיו due — הזזת scheduled_for בלבד,
  // בלי לגעת ב-starts_at, כדי שה-snapshot יישאר תואם ל-precheck.
  await db.query(
    `update appointment_reminders set scheduled_for = now() - interval '1 minute'
     where appointment_id=$1`, [apptId])

  // ⚠️ ה-worker אינו בוחר תזכורת — הוא מקבל את מה ש-claim_due_reminder
  // מחזיר, לפי סדר הזמן. הבדיקה עובדת באותו כיוון בכוונה: היא תופסת פעמיים
  // ומאמתת שמה שנתפס שייך לתור הזה, במקום להניח סדר מסוים בין שני הסוגים.
  const sentKinds = []
  for (let i = 0; i < 2; i++) {
    const lease = uuid()
    const claimed = await one(
      `select public.claim_due_reminder($1, 120, 4, 'sms_019') c`, [lease])
    const r = claimed.c?.reminder
    chk(`[${service}] תפיסה ${i + 1}: worker קיבל תזכורת של התור הזה`,
      !!r && r.appointment_id === apptId, r ? r.reminder_kind : 'לא נתפס דבר')
    if (!r) break

    const pre = await one(`select public.reminder_precheck($1,$2) p`, [r.id, lease])
    chk(`[${service}] ${r.reminder_kind}: precheck לפני השליחה עובר`,
      pre.p.ok === true, pre.p.ok ? '' : pre.p.reason)

    const res = await one(
      `select public.finish_reminder_attempt($1,$2,'accepted',null,$3,'sms_019',4,false) r`,
      [r.id, lease, `msg-${r.reminder_kind}`])
    chk(`[${service}] 🔒 ${r.reminder_kind}: status='sent'`, res.r.status === 'sent', res.r.status)
    sentKinds.push(r.reminder_kind)
  }

  chk(`[${service}] 🔒 שני הסוגים נשלחו, כל אחד פעם אחת`,
    sentKinds.slice().sort().join(',') === 'day_before,two_hours_before',
    sentKinds.join(','))

  const finalRows = await remindersOf(apptId)
  chk(`[${service}] 🔒 שתי התזכורות sent, שתיהן דרך sms_019, לשתיהן sent_at`,
    finalRows.length === 2
      && finalRows.every(r => r.status === 'sent' && r.provider === 'sms_019' && r.sent_at !== null),
    finalRows.map(r => `${r.reminder_kind}=${r.status}/${r.provider}`).join(' '))
}

// ════════════════════════════════════════════════════════════════════════════
section('⚠️ תור לפחות מ-24 שעות מראש — day_before נולדת skipped')
// ════════════════════════════════════════════════════════════════════════════
//
// זה בדיוק מה שקרה בייצור לתור ייעוץ שנקבע באותו יום. ההתנהגות מתוכננת:
// החלון של day_before (scheduled_for + 6h) כבר נסגר ברגע היצירה, ולכן
// השורה נוצרת skipped ולעולם אינה נשלחת — בזמן ש-two_hours_before, שהיא
// התזכורת שהלקוחה באמת צריכה, נשלחת כרגיל.

{
  const cid = await manualCustomer('TEST תור באותו יום')
  const appt = await manualAppointment(cid, 'מיקרובליידינג', '4 hours')
  const rem = await remindersOf(appt.appointment_id)

  const dayBefore = rem.find(r => r.reminder_kind === 'day_before')
  const twoHours  = rem.find(r => r.reminder_kind === 'two_hours_before')

  chk('גם כאן נוצרות שתי שורות', rem.length === 2, `count=${rem.length}`)
  chk('⚠️ day_before היא skipped / window_passed_at_creation',
    dayBefore?.status === 'skipped' && dayBefore?.outcome_reason === 'window_passed_at_creation',
    `${dayBefore?.status}/${dayBefore?.outcome_reason}`)
  chk('🔒 two_hours_before נשארת scheduled — התזכורת שכן תצא',
    twoHours?.status === 'scheduled', twoHours?.status)
  chk('🔒 החלון של two_hours_before עדיין פתוח',
    new Date(twoHours.expires_at).getTime() > Date.now())
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass}/${pass + fail} עברו`)
process.exit(fail === 0 ? 0 : 1)
