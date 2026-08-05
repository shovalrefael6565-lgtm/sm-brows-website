/**
 * בדיקת שלב 7 מול Postgres אמיתי (PGlite), בדיוק כמו test-migration.mjs
 * ו-test-pending-expiration.mjs: מריצה 0001→0005 ובודקת את מה ש-0005
 * מבטיחה — אטומיות, אכיפת מדיניות מ-business_settings, מונה ההזזות,
 * שמירת המועד המקורי, ההיסטוריה, ה-EXCLUDE constraint, ו-state machine
 * הסנכרון לשני הכיוונים (upsert/delete).
 *
 * מה *לא* נבדק כאן: Google Calendar עצמו (אין רשת) — זה נבדק ב-
 * test-reschedule-cancel-live.mjs מול היומן האמיתי.
 *
 * הרצה:  npm run test:reschedule-cancel
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'fs'

const migration = name =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')

const SQL_0001 = migration('0001_customer_accounts.sql')
const SQL_0002 = migration('0002_pending_expiration_enum_values.sql')
const SQL_0003 = migration('0003_pending_expiration.sql')
const SQL_0004 = migration('0004_appointment_approval.sql')
const SQL_0005 = migration('0005_customer_reschedule_cancel.sql')

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

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

section('הרצת המיגרציות')
for (const [name, sql] of [
  ['0001', SQL_0001], ['0002', SQL_0002], ['0003', SQL_0003],
  ['0004', SQL_0004], ['0005', SQL_0005],
]) {
  try {
    await db.exec(sql)
    chk(`${name} רצה במלואה ללא שגיאה`)
  } catch (e) {
    chk(`${name} רצה במלואה ללא שגיאה`, false, e.message)
    process.exit(1)
  }
}

const opCol = (await db.query(
  `select column_name, column_default from information_schema.columns
   where table_name='appointments' and column_name='calendar_sync_operation'`
)).rows
chk('appointments.calendar_sync_operation נוסף עם default upsert',
  opCol.length === 1 && String(opCol[0].column_default).includes('upsert'))

// ── עוזרים ──────────────────────────────────────────────────────────────────
const C1 = '11111111-1111-1111-1111-111111111111'
const C2 = '22222222-2222-2222-2222-222222222222'
const ADMIN = '99999999-9999-9999-9999-999999999999'

await db.exec(`insert into auth.users values ('${C1}'), ('${C2}'), ('${ADMIN}');`)
await db.exec(`
  insert into customers (id, phone_e164, full_name) values
    ('${C1}', '+972541234567', 'לקוחת בדיקה א'),
    ('${C2}', '+972549876543', 'לקוחת בדיקה ב');
  insert into admins (user_id) values ('${ADMIN}');
`)

const iso = d => new Date(d).toISOString()
const plusHours = h => iso(Date.now() + h * 3600_000)

/**
 * מקצה חותמות זמן ייחודיות.
 *
 * ה-EXCLUDE constraint אמיתי גם בבדיקה: שני תורים באותו זמן ייכשלו.
 * לכן כל תור וכל יעד הזזה מקבלים חלון משלהם, במרווח של שעתיים, החל
 * מ-500 שעות קדימה. כל הזמנים האלה רחוקים בהרבה מכל סף מדיניות
 * (24/48 שעות), ולכן המרווח לא משפיע על מה שנבדק.
 *
 * הבדיקות שכן תלויות בסף מדיניות משתמשות ב-nearFuture עם שעות מפורשות.
 */
let farSlotIndex = 0
const farFuture = () => plusHours(500 + (farSlotIndex++) * 2)

/** תורים בטווח 24–48 שעות, לבדיקות מדיניות. מרווח שעה בין אחד לשני. */
let nearSlotIndex = 0
const nearFuture = base => plusHours(base + (nearSlotIndex++))

/** יוצר תור confirmed ישירות, בלי לעבור דרך זרימת האישור */
async function makeConfirmed({
  customer = C1, startsAt = null, durationMin = 20,
  eventId = 'evt_' + Math.random().toString(36).slice(2, 10),
  syncStatus = 'synced',
} = {}) {
  const at = startsAt ?? farFuture()
  const r = await db.query(`
    insert into appointments (
      customer_id, service_key, variants, price_total, starts_at, duration_min,
      ends_at, status, google_event_id, calendar_sync_status, calendar_sync_operation
    ) values (
      '${customer}', 'עיצוב גבות טבעיות', '{}', 70,
      '${at}', ${durationMin},
      now(), 'confirmed', ${eventId ? `'${eventId}'` : 'null'},
      '${syncStatus}', 'upsert'
    ) returning id, starts_at, ends_at
  `)
  return r.rows[0]
}

const call = async (fn, args) => {
  const params = args.map(a => (a === null ? 'null' : `'${a}'`)).join(', ')
  return (await db.query(`select ${fn}(${params}) as r`)).rows[0].r
}

const expectError = async (name, fn, args, needle) => {
  try {
    await call(fn, args)
    chk(name, false, 'לא נכשל כצפוי')
  } catch (e) {
    chk(name, e.message.includes(needle), e.message.slice(0, 60))
  }
}

const historyFor = async id =>
  (await db.query(`select * from appointment_history where appointment_id='${id}' order by id`)).rows

const apptById = async id =>
  (await db.query(`select * from appointments where id='${id}'`)).rows[0]

// ── הרשאות ובעלות ───────────────────────────────────────────────────────────
section('הרשאות, בעלות וסטטוס')

{
  const a = await makeConfirmed()
  await expectError('לקוחה אחרת אינה יכולה להזיז תור שאינו שלה',
    'reschedule_appointment_by_customer', [a.id, C2, farFuture(), null], 'NOT_FOUND')
  await expectError('לקוחה אחרת אינה יכולה לבטל תור שאינו שלה',
    'cancel_confirmed_appointment_by_customer', [a.id, C2], 'NOT_FOUND')

  const untouched = await apptById(a.id)
  chk('התור של הלקוחה האחרת לא השתנה כלל',
    untouched.status === 'confirmed' && iso(untouched.starts_at) === iso(a.starts_at))
  chk('לא נכתבה היסטוריה בניסיון הכושל', (await historyFor(a.id)).length === 0)
}

{
  // בקשת pending אינה ניתנת להזזה דרך המסלול של confirmed
  const p = (await db.query(`
    select * from create_pending_appointment('${C1}', 'עיצוב גבות טבעיות', '{}', 70,
      '${farFuture()}', 20, null, 'v1')
  `)).rows[0]
  await expectError('pending אינו ניתן להזזה דרך ה-RPC של confirmed',
    'reschedule_appointment_by_customer', [p.id, C1, farFuture(), null], 'NOT_RESCHEDULABLE')
  await expectError('pending אינו ניתן לביטול דרך ה-RPC של confirmed',
    'cancel_confirmed_appointment_by_customer', [p.id, C1], 'NOT_CANCELLABLE')

  // ביטול pending הקיים ממשיך לעבוד בדיוק כמו קודם (רגרסיה)
  await db.query(`select cancel_pending_appointment('${p.id}', '${C1}')`)
  const after = await apptById(p.id)
  const h = await historyFor(p.id)
  chk('רגרסיה: ביטול pending הקיים ממשיך לעבוד',
    after.status === 'cancelled_by_customer' &&
    h.some(x => x.action === 'cancelled' && x.actor === 'customer'))
  chk('רגרסיה: ביטול pending לא נגע ב-calendar_sync_operation',
    after.calendar_sync_operation === 'upsert' && after.calendar_sync_status === 'not_applicable')
}

{
  const done = await makeConfirmed()
  await db.exec(`update appointments set status='completed' where id='${done.id}'`)
  await expectError('תור completed אינו ניתן להזזה',
    'reschedule_appointment_by_customer', [done.id, C1, farFuture(), null], 'NOT_RESCHEDULABLE')
  await expectError('תור completed אינו ניתן לביטול',
    'cancel_confirmed_appointment_by_customer', [done.id, C1], 'NOT_CANCELLABLE')

  const ns = await makeConfirmed()
  await db.exec(`update appointments set status='no_show' where id='${ns.id}'`)
  await expectError('תור no_show אינו ניתן לביטול',
    'cancel_confirmed_appointment_by_customer', [ns.id, C1], 'NOT_CANCELLABLE')
}

{
  const past = await makeConfirmed()
  await db.exec(`update appointments set starts_at = now() - interval '2 hours' where id='${past.id}'`)
  await expectError('תור שכבר עבר אינו ניתן להזזה',
    'reschedule_appointment_by_customer', [past.id, C1, farFuture(), null], 'IN_PAST')
  await expectError('תור שכבר עבר אינו ניתן לביטול',
    'cancel_confirmed_appointment_by_customer', [past.id, C1], 'IN_PAST')

  const future = await makeConfirmed()
  await expectError('אי אפשר להזיז תור למועד שכבר עבר',
    'reschedule_appointment_by_customer', [future.id, C1, plusHours(-5), null], 'NEW_IN_PAST')
}

// ── מדיניות מ-business_settings ─────────────────────────────────────────────
section('אכיפת מדיניות מ-business_settings')

{
  const soon = await makeConfirmed({ startsAt: plusHours(12) })  // מתחת ל-24 שעות
  await expectError('הזזה בתוך חלון 24 השעות נחסמת',
    'reschedule_appointment_by_customer', [soon.id, C1, farFuture(), null], 'TOO_LATE')
  await expectError('ביטול בתוך חלון 24 השעות נחסם',
    'cancel_confirmed_appointment_by_customer', [soon.id, C1], 'TOO_LATE')

  const row = await apptById(soon.id)
  chk('שום דבר לא השתנה אחרי חסימת מדיניות',
    row.status === 'confirmed' && row.reschedule_count === 0 &&
    (await historyFor(soon.id)).length === 0)
}

{
  // שינוי ההגדרה בטבלה משנה את ההתנהגות בפועל — הטבלה היא מקור האמת
  await db.exec(`update business_settings set value='48'::jsonb where key='reschedule_cutoff_hours'`)
  const a = await makeConfirmed({ startsAt: nearFuture(30) })
  await expectError('הגדלת reschedule_cutoff_hours ל-48 חוסמת תור בעוד 36 שעות',
    'reschedule_appointment_by_customer', [a.id, C1, farFuture(), null], 'TOO_LATE')
  await db.exec(`update business_settings set value='24'::jsonb where key='reschedule_cutoff_hours'`)

  const b = await makeConfirmed({ startsAt: nearFuture(30) })
  const okRes = await call('reschedule_appointment_by_customer', [b.id, C1, farFuture(), null])
  chk('החזרת ההגדרה ל-24 מאפשרת שוב את אותה הזזה', okRes.outcome === 'applied')
}

{
  // key חסר → ברירת מחדל לאותו key בלבד
  await db.exec(`delete from business_settings where key='max_reschedules'`)
  const a = await makeConfirmed()
  await db.exec(`update appointments set reschedule_count=2 where id='${a.id}'`)
  await expectError('key חסר (max_reschedules) נופל לברירת המחדל 2 ולא לאינסוף',
    'reschedule_appointment_by_customer', [a.id, C1, farFuture(), null], 'MAX_RESCHEDULES')

  // ושאר ההגדרות ממשיכות להיקרא מהטבלה כרגיל — ה-key החסר לא "מפיל"
  // את כל המדיניות לברירות מחדל
  const near = await makeConfirmed({ startsAt: nearFuture(30) })
  await db.exec(`update business_settings set value='72'::jsonb where key='cancel_cutoff_hours'`)
  await expectError('שאר ההגדרות עדיין נקראות מהטבלה למרות ה-key החסר',
    'cancel_confirmed_appointment_by_customer', [near.id, C1], 'TOO_LATE')
  await db.exec(`update business_settings set value='24'::jsonb where key='cancel_cutoff_hours'`)
  await db.exec(`insert into business_settings (key, value) values ('max_reschedules','2'::jsonb)`)
}

{
  await db.exec(`update business_settings set value='1'::jsonb where key='max_reschedules'`)
  const a = await makeConfirmed()
  await call('reschedule_appointment_by_customer', [a.id, C1, farFuture(), null])
  await expectError('max_reschedules=1 נאכף אחרי הזזה אחת',
    'reschedule_appointment_by_customer', [a.id, C1, farFuture(), null], 'MAX_RESCHEDULES')
  const row = await apptById(a.id)
  chk('מונה ההזזות לא גדל בניסיון שנחסם', row.reschedule_count === 1)
  chk('reschedule_count אינו מתאפס אחרי חסימה', row.reschedule_count === 1)
  await db.exec(`update business_settings set value='2'::jsonb where key='max_reschedules'`)
}

{
  const dep = await makeConfirmed({ startsAt: nearFuture(30) })
  await db.exec(`update appointments set has_deposit=true where id='${dep.id}'`)
  await expectError('תור עם מקדמה — חלון 48 השעות המחמיר נאכף',
    'reschedule_appointment_by_customer', [dep.id, C1, farFuture(), null], 'TOO_LATE')
  await expectError('תור עם מקדמה — ביטול עצמי חסום לגמרי',
    'cancel_confirmed_appointment_by_customer', [dep.id, C1], 'DEPOSIT_LOCKED')

  const dep2 = await makeConfirmed()
  await db.exec(`update appointments set has_deposit=true where id='${dep2.id}'`)
  const r = await call('reschedule_appointment_by_customer', [dep2.id, C1, farFuture(), null])
  chk('תור עם מקדמה מעל 48 שעות — הזזה מותרת', r.outcome === 'applied')
}

// ── שינוי מועד: הנתונים אחרי הפעולה ─────────────────────────────────────────
section('שינוי מועד — נתוני ה-DB')

let moved
{
  const a = await makeConfirmed({ durationMin: 40, eventId: 'evt_move_1' })
  const before = (await db.query(`select count(*)::int c from appointments`)).rows[0].c
  const target = farFuture()

  const res = await call('reschedule_appointment_by_customer', [a.id, C1, target, iso(a.starts_at)])
  chk('הזזה תקינה מחזירה outcome=applied', res.outcome === 'applied')

  moved = await apptById(a.id)
  const after = (await db.query(`select count(*)::int c from appointments`)).rows[0].c

  chk('לא נוצר appointment חדש', before === after, `${before} → ${after}`)
  chk('אותו appointment id', moved.id === a.id)
  chk('starts_at התעדכן', iso(moved.starts_at) === iso(target))
  chk('ends_at חושב מחדש לפי duration_min הקיים',
    new Date(moved.ends_at) - new Date(moved.starts_at) === 40 * 60_000)
  chk('status נשאר confirmed', moved.status === 'confirmed')
  chk('reschedule_count גדל בדיוק ב-1', moved.reschedule_count === 1)
  chk('original_starts_at נשמר עם המועד המקורי',
    iso(moved.original_starts_at) === iso(a.starts_at))
  chk('duration_min, price_total ו-service_key לא השתנו',
    moved.duration_min === 40 && moved.price_total === 70 &&
    moved.service_key === 'עיצוב גבות טבעיות')
  chk('google_event_id נשאר משויך לאותו תור', moved.google_event_id === 'evt_move_1')
  chk('פעולת הסנכרון היא upsert והמצב חזר ל-pending',
    moved.calendar_sync_operation === 'upsert' && moved.calendar_sync_status === 'pending')

  const h = await historyFor(a.id)
  chk('נכתבה שורת היסטוריה אחת בדיוק', h.length === 1, `count=${h.length}`)
  chk('ההיסטוריה היא rescheduled, confirmed→confirmed, actor=customer',
    h[0].action === 'rescheduled' && h[0].from_status === 'confirmed' &&
    h[0].to_status === 'confirmed' && h[0].actor === 'customer' && h[0].actor_id === C1)
  chk('ההיסטוריה שמרה את שני המועדים',
    iso(h[0].from_starts_at) === iso(a.starts_at) && iso(h[0].to_starts_at) === iso(target))
}

{
  // הזזה שנייה — לא דורסת את המועד המקורי הראשון
  const originalFirst = moved.original_starts_at
  const target2 = farFuture()
  await call('reschedule_appointment_by_customer', [moved.id, C1, target2, iso(moved.starts_at)])
  const twice = await apptById(moved.id)
  chk('הזזה שנייה: reschedule_count = 2', twice.reschedule_count === 2)
  chk('הזזה שנייה אינה דורסת את original_starts_at',
    iso(twice.original_starts_at) === iso(originalFirst))
  chk('הזזה שנייה כתבה שורת היסטוריה שנייה',
    (await historyFor(moved.id)).length === 2)
}

// ── מועד זהה, idempotency והתאוששות ─────────────────────────────────────────
section('מועד זהה, לחיצה כפולה והתאוששות')

{
  const a = await makeConfirmed()
  const same = iso(a.starts_at)
  const res = await call('reschedule_appointment_by_customer', [a.id, C1, same, same])
  chk('בחירת המועד הקיים מחזירה no_change', res.outcome === 'no_change')

  const row = await apptById(a.id)
  chk('מועד זהה: אפס כתיבות (מונה, מועד מקורי, סטטוס סנכרון)',
    row.reschedule_count === 0 && row.original_starts_at === null &&
    row.calendar_sync_status === 'synced')
  chk('מועד זהה: לא נכתבה היסטוריה', (await historyFor(a.id)).length === 0)
}

{
  // לחיצה כפולה / timeout: הבקשה השנייה מגיעה אחרי שהראשונה כבר הצליחה
  const a = await makeConfirmed()
  const original = iso(a.starts_at)
  const target = farFuture()

  const first = await call('reschedule_appointment_by_customer', [a.id, C1, target, original])
  const second = await call('reschedule_appointment_by_customer', [a.id, C1, target, original])

  chk('הבקשה הראשונה applied', first.outcome === 'applied')
  chk('הבקשה החוזרת מזוהה כהתאוששות ולא כ"לא נבחר מועד חדש"',
    second.outcome === 'already_applied')

  const row = await apptById(a.id)
  chk('לחיצה כפולה: reschedule_count גדל פעם אחת בלבד', row.reschedule_count === 1)
  chk('לחיצה כפולה: היסטוריה נכתבה פעם אחת בלבד',
    (await historyFor(a.id)).length === 1)
  chk('לחיצה כפולה: original_starts_at נשאר המועד המקורי',
    iso(row.original_starts_at) === original)
}

// ── התנגשות ─────────────────────────────────────────────────────────────────
section('התנגשות — ה-EXCLUDE constraint')

{
  const mine = await makeConfirmed({ customer: C1 })
  const hers = await makeConfirmed({ customer: C2 })
  const taken = iso(hers.starts_at)

  try {
    await call('reschedule_appointment_by_customer', [mine.id, C1, taken, iso(mine.starts_at)])
    chk('סלוט תפוס ב-DB נחסם', false, 'לא נכשל כצפוי')
  } catch (e) {
    chk('סלוט תפוס ב-DB נחסם ע"י ה-EXCLUDE constraint', e.code === '23P01', `code=${e.code}`)
  }

  const row = await apptById(mine.id)
  chk('אחרי התנגשות: התור נשאר במועד המקורי', iso(row.starts_at) === iso(mine.starts_at))
  chk('אחרי התנגשות: מונה ההזזות לא גדל', row.reschedule_count === 0)
  chk('אחרי התנגשות: לא נכתבה היסטוריה', (await historyFor(mine.id)).length === 0)
  chk('אחרי התנגשות: התור של הלקוחה האחרת לא נגוע',
    iso((await apptById(hers.id)).starts_at) === taken)

  // הזזה קלה שחופפת לטווח של התור *עצמו* מותרת — הוא לא מתנגש עם עצמו
  const selfShift = new Date(new Date(mine.starts_at).getTime() + 10 * 60_000).toISOString()
  const r = await call('reschedule_appointment_by_customer', [mine.id, C1, selfShift, iso(mine.starts_at)])
  chk('הזזה שחופפת לטווח הנוכחי של אותו תור מותרת (אין התנגשות עצמית)',
    r.outcome === 'applied')
}

{
  // סנכרון פעיל חוסם פעולה מקבילה
  const a = await makeConfirmed()
  await db.exec(`update appointments set calendar_sync_status='syncing',
                 calendar_sync_started_at=now() where id='${a.id}'`)
  await expectError('lease סנכרון פעיל חוסם הזזה מקבילה',
    'reschedule_appointment_by_customer', [a.id, C1, farFuture(), null], 'SYNC_IN_PROGRESS')
  await expectError('lease סנכרון פעיל חוסם ביטול מקביל',
    'cancel_confirmed_appointment_by_customer', [a.id, C1], 'SYNC_IN_PROGRESS')

  await db.exec(`update appointments set calendar_sync_started_at = now() - interval '5 minutes'
                 where id='${a.id}'`)
  const r = await call('reschedule_appointment_by_customer', [a.id, C1, farFuture(), null])
  chk('lease שפג אינו חוסם יותר', r.outcome === 'applied')
}

// ── ביטול תור מאושר ─────────────────────────────────────────────────────────
section('ביטול תור מאושר')

{
  const a = await makeConfirmed({ eventId: 'evt_cancel_1' })
  const startsAt = iso(a.starts_at)
  const res = await call('cancel_confirmed_appointment_by_customer', [a.id, C1])
  chk('ביטול תקין מחזיר outcome=applied', res.outcome === 'applied')

  const row = await apptById(a.id)
  chk('הסטטוס הוא cancelled_by_customer', row.status === 'cancelled_by_customer')
  chk('התור לא נמחק מהטבלה', row !== undefined)
  chk('פעולת הסנכרון היא delete והמצב pending',
    row.calendar_sync_operation === 'delete' && row.calendar_sync_status === 'pending')
  chk('google_event_id נשמר לתיעוד מה צריך להימחק', row.google_event_id === 'evt_cancel_1')

  const h = await historyFor(a.id)
  chk('נכתבה היסטוריית ביטול אחת', h.length === 1)
  chk('ההיסטוריה: cancelled, confirmed→cancelled_by_customer, actor=customer',
    h[0].action === 'cancelled' && h[0].from_status === 'confirmed' &&
    h[0].to_status === 'cancelled_by_customer' && h[0].actor === 'customer' && h[0].actor_id === C1)
  chk('ההיסטוריה שמרה את המועד שבוטל', iso(h[0].from_starts_at) === startsAt)

  // הסלוט משתחרר מיד
  const other = await db.query(`
    insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status)
    values ('${C2}', 'עיצוב גבות טבעיות', '${startsAt}', 20, now(), 'pending') returning id
  `)
  chk('הסלוט של התור המבוטל משתחרר מיד ב-DB', other.rows.length === 1)

  // לחיצה חוזרת — idempotent
  const again = await call('cancel_confirmed_appointment_by_customer', [a.id, C1])
  chk('ביטול חוזר מחזיר already_cancelled', again.outcome === 'already_cancelled')
  chk('ביטול חוזר לא כתב היסטוריה שנייה', (await historyFor(a.id)).length === 1)
}

{
  // ⚠️ הדרישה המרכזית: google_event_id ריק אינו מוכיח שאין אירוע ביומן
  const a = await makeConfirmed({ eventId: null, syncStatus: 'failed' })
  await call('cancel_confirmed_appointment_by_customer', [a.id, C1])
  const row = await apptById(a.id)
  chk('ביטול עם google_event_id ריק עדיין מבקש מחיקה (לא not_applicable)',
    row.calendar_sync_operation === 'delete' && row.calendar_sync_status === 'pending',
    `${row.calendar_sync_operation}/${row.calendar_sync_status}`)
}

// ── state machine של הסנכרון: upsert מול delete ─────────────────────────────
section('סנכרון יומן — upsert מול delete')

{
  const a = await makeConfirmed({ syncStatus: 'pending' })
  const claimed = (await db.query(`select * from claim_calendar_sync('${a.id}')`)).rows[0]
  chk('confirmed + upsert ניתן לתפיסה', claimed.calendar_sync_status === 'syncing')

  await db.query(`select complete_calendar_sync('${a.id}', 'evt_after_sync')`)
  const done = await apptById(a.id)
  chk('complete_calendar_sync סוגר את ה-claim ושומר מזהה',
    done.calendar_sync_status === 'synced' && done.google_event_id === 'evt_after_sync')
}

{
  const a = await makeConfirmed({ eventId: 'evt_del_flow' })
  await call('cancel_confirmed_appointment_by_customer', [a.id, C1])

  const claimed = (await db.query(`select * from claim_calendar_sync('${a.id}')`)).rows[0]
  chk('cancelled_by_customer + delete ניתן לתפיסה (0004 לבדה הייתה חוסמת)',
    claimed.calendar_sync_status === 'syncing' && claimed.calendar_sync_operation === 'delete')

  await db.query(`select complete_calendar_delete('${a.id}')`)
  const done = await apptById(a.id)
  chk('complete_calendar_delete מסמן synced', done.calendar_sync_status === 'synced')
  chk('complete_calendar_delete שומר את המזהה הישן לתיעוד',
    done.google_event_id === 'evt_del_flow')
  chk('אחרי מחיקה מוצלחת הסטטוס נשאר cancelled_by_customer — אין חזרה ל-confirmed',
    done.status === 'cancelled_by_customer')
}

{
  // צירוף לא תקין: תור שבוטל דרך מסלול pending אין לו מה למחוק
  const p = (await db.query(`
    select * from create_pending_appointment('${C2}', 'עיצוב גבות טבעיות', '{}', 70,
      '${farFuture()}', 20, null, 'v1')
  `)).rows[0]
  await db.query(`select cancel_pending_appointment('${p.id}', '${C2}')`)
  await expectError('cancelled_by_customer עם operation=upsert אינו ניתן לתפיסה',
    'claim_calendar_sync', [p.id], 'NOT_CLAIMABLE')
}

{
  // שני claim מקבילים — לכל היותר אחד מצליח
  const a = await makeConfirmed({ syncStatus: 'pending' })
  const settled = await Promise.allSettled([
    db.query(`select * from claim_calendar_sync('${a.id}')`),
    db.query(`select * from claim_calendar_sync('${a.id}')`),
  ])
  const ok = settled.filter(s => s.status === 'fulfilled').length
  chk('משני claim על אותו תור, בדיוק אחד מצליח', ok === 1, `הצליחו: ${ok}`)
}

{
  // תור שאושר מקבל operation=upsert מפורש
  const p = (await db.query(`
    select * from create_pending_appointment('${C1}', 'עיצוב גבות טבעיות', '{}', 70,
      '${farFuture()}', 20, null, 'v1')
  `)).rows[0]
  const approved = (await db.query(
    `select * from approve_pending_appointment('${p.id}', '${ADMIN}')`)).rows[0]
  chk('אישור בקשה מציב operation=upsert ו-sync_status=pending',
    approved.calendar_sync_operation === 'upsert' && approved.calendar_sync_status === 'pending')
  chk('רגרסיה: אישור עדיין כותב היסטוריית status_changed עם actor=admin',
    (await historyFor(p.id)).some(h => h.action === 'status_changed' && h.actor === 'admin'))
}

// ── סיכום ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
