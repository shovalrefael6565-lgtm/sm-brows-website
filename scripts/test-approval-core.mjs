/**
 * שלב 15C — אישור ודחיית בקשות, מול Postgres אמיתי (PGlite).
 *
 * ═══ למה הסוויטה הזו קיימת ═══
 *
 * ⚠️ עד 15C הכיסוי היחיד ל-approve_pending_appointment ול-
 * reject_pending_appointment היה scripts/test-appointment-approval-live.mjs,
 * שרץ מול Supabase — ו-Supabase הפך לפרודקשן ב-07.08.2026, כלומר הסוויטה
 * ההיא **חסומה**. reject_pending_appointment היא בדיוק הפונקציה ש-0019
 * משנה, ואי אפשר לשנות פונקציה שאין עליה בדיקה שאפשר להריץ.
 *
 * ═══ מה נבדק ═══
 *
 *   • דחייה כותבת 'rejected' ולא 'cancelled_by_business'  (0019)
 *   • שורת ההיסטוריה: status_changed · pending→rejected · admin
 *   • הסלוט משתחרר מיידית — בלי לגעת ב-appointments_no_overlap
 *   • השורה **נשארת** במסד. תור לעולם לא נמחק
 *   • האטומיות: דחייה כפולה, דחייה על confirmed, דחייה על pending שפג
 *   • approve לא השתנה בכלל (רגרסיה מלאה)
 *   • ה-EXCLUDE constraint עדיין חוסם
 *   • הכלל הגנרי של 0011 ("כל מה שאינו confirmed מבטל") מכסה את הערך החדש
 *   • 0019 idempotent — אפשר להריץ אותה פעמיים
 *   • ההרשאות נשארות service_role בלבד, בפועל ולא רק בטקסט
 *
 * הרצה:  npm run test:approval-core
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(64)}${extra}`)
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url)
const MIGRATIONS = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()

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
for (const f of MIGRATIONS) {
  try {
    await db.exec(readFileSync(new URL(f, MIG_DIR), 'utf8'))
  } catch (e) {
    chk(`${f} רצה`, false, e.message)
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו לפי הסדר`, true, MIGRATIONS[MIGRATIONS.length - 1])
chk('0019 קיימת ברשימת המיגרציות', MIGRATIONS.includes('0019_reject_status.sql'))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows

const ADMIN = '11111111-1111-1111-1111-111111111111'
const ADMIN2 = '22222222-2222-2222-2222-222222222222'

const future = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()

// המגבלה על pending פעילים אינה נושא הסוויטה הזו — מרימים אותה כדי
// שיצירת נתוני הבדיקה לא תיחסם.
await db.query(`update public.business_settings set value = '99'::jsonb
                where key = 'max_active_pending_per_customer'`)

let phoneSeq = 0
async function newCustomer(name = 'לקוחת בדיקה') {
  phoneSeq += 1
  const phone = `+9725411${String(phoneSeq).padStart(5, '0')}`
  return one(
    `insert into public.customers (phone_e164, full_name) values ($1, $2) returning *`,
    [phone, name],
  )
}

/**
 * בקשת pending. INSERT ישיר ולא דרך RPC — הסוויטה הזו בודקת את
 * approve/reject, ולא את מסלול היצירה (שמכוסה ב-test:public-booking-db).
 * ends_at נכתב ע"י הטריגר set_appointment_end מ-0001.
 */
async function pending({ customerId, startsAt, expiresAt = future(3), duration = 20 }) {
  return one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, pending_expires_at, policy_version, booking_source)
     values ($1, 'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, $3, 'pending', $4::timestamptz, 'v1', 'public_booking')
     returning *`,
    [customerId, startsAt, duration, expiresAt],
  )
}

const tryRpc = async (sql, params) => {
  try { return { ok: true, row: await one(sql, params) } }
  catch (e) { return { ok: false, msg: e.message } }
}

const reject = (id, admin = ADMIN) =>
  tryRpc(`select * from public.reject_pending_appointment($1, $2)`, [id, admin])
const approve = (id, admin = ADMIN) =>
  tryRpc(`select * from public.approve_pending_appointment($1, $2)`, [id, admin])

const historyOf = (id) =>
  all(`select * from public.appointment_history where appointment_id = $1 order by id`, [id])
const statusOf = async (id) =>
  (await one(`select status from public.appointments where id = $1`, [id]))?.status
const apptCount = async () =>
  (await one(`select count(*)::int as n from public.appointments`)).n


// ════════════════════════════════════════════════════════════════════════════
section('1. דחייה — pending → rejected')

{
  const c = await newCustomer('דנה כהן')
  const slot = future(30)
  const a = await pending({ customerId: c.id, startsAt: slot })

  const before = await apptCount()
  const r = await reject(a.id)

  chk('הדחייה הצליחה', r.ok, r.ok ? '' : r.msg)
  chk('🔒 status = rejected (ולא cancelled_by_business)', r.ok && r.row.status === 'rejected',
    r.ok ? r.row.status : '')
  chk('הערך נשמר גם בקריאה חוזרת מהטבלה', (await statusOf(a.id)) === 'rejected')

  // ── היסטוריה ──
  const h = await historyOf(a.id)
  chk('נכתבה שורת היסטוריה אחת בדיוק', h.length === 1, `count=${h.length}`)
  chk('action = status_changed', h[0]?.action === 'status_changed', h[0]?.action)
  chk('from_status = pending', h[0]?.from_status === 'pending', h[0]?.from_status)
  chk('to_status = rejected', h[0]?.to_status === 'rejected', h[0]?.to_status)
  chk('actor = admin', h[0]?.actor === 'admin', h[0]?.actor)
  chk('actor_id = המנהלת שדחתה', h[0]?.actor_id === ADMIN)

  // ── השורה נשארת ──
  chk('🔒 התור לא נמחק — הספירה לא ירדה', (await apptCount()) === before)
  const still = await one(`select * from public.appointments where id = $1`, [a.id])
  chk('🔒 השורה קיימת ושמורה במלואה',
    !!still && still.customer_id === c.id && still.price_total === 70)
  chk('🔒 booking_source נשמר גם אחרי דחייה', still.booking_source === 'public_booking')

  // ── הסלוט משתחרר ──
  const c2 = await newCustomer('לקוחה אחרת')
  const retake = await tryRpc(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, pending_expires_at, policy_version)
     values ($1, 'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, 20, 'pending', $3::timestamptz, 'v1')
     returning *`,
    [c2.id, slot, future(3)])
  chk('🔒 הסלוט השתחרר — לקוחה אחרת יכולה לתפוס אותו', retake.ok, retake.ok ? '' : retake.msg)

  // 🔒 לא ע"י שינוי ה-constraint אלא כי rejected אינו נמנה בו כלל
  const excl = await one(`
    select pg_get_constraintdef(con.oid) as d
    from pg_constraint con join pg_class rel on rel.oid = con.conrelid
    where con.conname = 'appointments_no_overlap'`)
  chk('🔒 appointments_no_overlap לא שונה — עדיין pending/confirmed בלבד',
    excl.d.includes("'pending'") && excl.d.includes("'confirmed'") &&
    !excl.d.includes("'rejected'"))
}


// ════════════════════════════════════════════════════════════════════════════
section('2. אטומיות הדחייה')

{
  // ── דחייה כפולה ──
  const c = await newCustomer()
  const a = await pending({ customerId: c.id, startsAt: future(34) })
  await reject(a.id)
  const second = await reject(a.id, ADMIN2)

  chk('דחייה שנייה נכשלת ב-NOT_PENDING', !second.ok && second.msg.includes('NOT_PENDING'),
    second.ok ? 'הצליחה!' : '')
  chk('🔒 לא נוספה שורת היסטוריה שנייה', (await historyOf(a.id)).length === 1)
  chk('🔒 הסטטוס נשאר rejected', (await statusOf(a.id)) === 'rejected')

  // ── דחייה על confirmed ──
  const c2 = await newCustomer()
  const a2 = await pending({ customerId: c2.id, startsAt: future(38) })
  await approve(a2.id)
  const onConfirmed = await reject(a2.id)

  chk('דחייה על תור confirmed נכשלת', !onConfirmed.ok && onConfirmed.msg.includes('NOT_PENDING'))
  chk('🔒 התור נשאר confirmed', (await statusOf(a2.id)) === 'confirmed')
  chk('🔒 ההיסטוריה של האישור לא נפגעה', (await historyOf(a2.id)).length === 1)

  // ── 0030: pending_expires_at בעבר כבר לא חוסם דחייה — אין יותר תפוגה
  // מבוססת-זמן. שורה כזו יכולה להיות שורה ישנה מלפני 0030 (אין backfill
  // לנתוני פרודקשן) והיא חייבת להישאר ניתנת לדחייה כרגיל.
  const c3 = await newCustomer()
  const a3 = await pending({ customerId: c3.id, startsAt: future(42), expiresAt: future(-1) })
  const onOldExpiry = await reject(a3.id)

  chk('🔒 0030: דחייה מצליחה גם עם pending_expires_at בעבר', onOldExpiry.ok,
    onOldExpiry.ok ? '' : onOldExpiry.msg)
  chk('status = rejected', (await statusOf(a3.id)) === 'rejected')

  // ── pending_expires_at = null (המצב הרגיל אחרי 0030) גם לא חוסם ──
  const c4 = await newCustomer()
  const a4 = await pending({ customerId: c4.id, startsAt: future(46), expiresAt: null })
  const noExpiry = await reject(a4.id)
  chk('בקשה ללא תפוגה ניתנת לדחייה', noExpiry.ok)
}


// ════════════════════════════════════════════════════════════════════════════
section('3. אישור — רגרסיה מלאה, 0019 לא נגעה בו')

{
  const c = await newCustomer('לקוחה לאישור')
  const slot = future(50)
  const a = await pending({ customerId: c.id, startsAt: slot })
  const r = await approve(a.id)

  chk('האישור הצליח', r.ok, r.ok ? '' : r.msg)
  chk('status = confirmed', r.row?.status === 'confirmed')
  chk('calendar_sync_status = pending', r.row?.calendar_sync_status === 'pending')
  chk('calendar_sync_operation = upsert', r.row?.calendar_sync_operation === 'upsert')

  const h = await historyOf(a.id)
  chk('שורת היסטוריה אחת', h.length === 1)
  chk('action = status_changed · pending→confirmed · admin',
    h[0]?.action === 'status_changed' && h[0]?.from_status === 'pending' &&
    h[0]?.to_status === 'confirmed' && h[0]?.actor === 'admin')

  // 🔒 0019 במפורש לא נגעה בזה — pending_expires_at נשאר כפי שהיה
  chk('🔒 pending_expires_at לא אופס באישור (0019 לא נגעה ב-approve)',
    r.row?.pending_expires_at !== null)

  // ── והוא עדיין לא יכול לפוג ──
  await db.query(`update public.appointments set pending_expires_at = now() - interval '1 hour'
                  where id = $1`, [a.id])
  await db.query(`select public.expire_stale_pending_appointments()`)
  chk('🔒 תור confirmed אינו פג גם כשה-pending_expires_at בעבר (AT-19)',
    (await statusOf(a.id)) === 'confirmed')

  // ── הסלוט נשאר תפוס ──
  const c2 = await newCustomer()
  const clash = await tryRpc(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, policy_version)
     values ($1, 'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, 20, 'pending', 'v1') returning *`,
    [c2.id, slot])
  chk('🔒 הסלוט של תור מאושר נשאר תפוס (EXCLUDE)',
    !clash.ok && (clash.msg.includes('exclusion') || clash.msg.includes('23P01')))

  // ── אישור כפול ──
  const c3 = await newCustomer()
  const a3 = await pending({ customerId: c3.id, startsAt: future(54) })
  await approve(a3.id)
  const twice = await approve(a3.id, ADMIN2)
  chk('אישור כפול נכשל ב-NOT_PENDING', !twice.ok && twice.msg.includes('NOT_PENDING'))
  chk('🔒 שורת היסטוריה אחת בלבד', (await historyOf(a3.id)).length === 1)

  // ── 0030: אישור בקשה עם pending_expires_at בעבר כן מצליח ──
  // אין יותר תפוגה מבוססת-זמן — status='pending' הוא כל מה שקובע.
  const c4 = await newCustomer()
  const a4 = await pending({ customerId: c4.id, startsAt: future(58), expiresAt: future(-1) })
  const oldExpiry = await approve(a4.id)
  chk('🔒 0030: אישור מצליח גם עם pending_expires_at בעבר', oldExpiry.ok,
    oldExpiry.ok ? '' : oldExpiry.msg)
  chk('status = confirmed', oldExpiry.ok && oldExpiry.row?.status === 'confirmed')

  // ── אישור אחרי דחייה ──
  const c5 = await newCustomer()
  const a5 = await pending({ customerId: c5.id, startsAt: future(62) })
  await reject(a5.id)
  const afterReject = await approve(a5.id)
  chk('🔒 אי אפשר לאשר בקשה שנדחתה', !afterReject.ok && afterReject.msg.includes('NOT_PENDING'))
  chk('🔒 הסטטוס נשאר rejected', (await statusOf(a5.id)) === 'rejected')
}


// ════════════════════════════════════════════════════════════════════════════
section('4. 0030 — הטאטוא הוא no-op, אין יותר תפוגה מבוססת-זמן')

{
  const c = await newCustomer()
  const a = await pending({ customerId: c.id, startsAt: future(66), expiresAt: future(-1) })
  await db.query(`select public.expire_stale_pending_appointments()`)

  chk('🔒 0030: הטאטוא לא נוגע בבקשה גם כש-pending_expires_at בעבר',
    (await statusOf(a.id)) === 'pending')
  chk('🔒 לא נכתבה היסטוריה ע"י הטאטוא', (await historyOf(a.id)).length === 0)

  // ואפילו כמה קריאות חוזרות — עדיין no-op
  await db.query(`select public.expire_stale_pending_appointments()`)
  await db.query(`select public.expire_stale_pending_appointments()`)
  chk('🔒 idempotent: עדיין pending אחרי כמה קריאות', (await statusOf(a.id)) === 'pending')

  // ── היא עדיין ניתנת לאישור רגיל אחרי כל זה ──
  const r = await approve(a.id)
  chk('🔒 עדיין ניתנת לאישור', r.ok && r.row?.status === 'confirmed')
}


// ════════════════════════════════════════════════════════════════════════════
section('5. תזכורות — הכלל הגנרי של 0011 מכסה את rejected')

{
  const c = await newCustomer()
  // תור מאושר רחוק מספיק כדי שיווצרו לו שתי תזכורות
  const a = await pending({ customerId: c.id, startsAt: future(72) })
  await approve(a.id)

  const created = await all(
    `select * from public.appointment_reminders where appointment_id = $1 order by reminder_kind`, [a.id])
  chk('נוצרו תזכורות לתור המאושר', created.length > 0, `count=${created.length}`)

  // ⚠️ UPDATE ישיר ולא דרך ה-RPC: המעבר confirmed→rejected אינו מסלול
  // עסקי קיים. מה שנבדק כאן הוא **הכלל הגנרי** ב-0011 ("כל מה שאינו
  // confirmed מבטל"), כלומר שערך enum חדש מכוסה בלי לגעת ב-0011 בכלל.
  await db.query(`update public.appointments set status = 'rejected' where id = $1`, [a.id])

  const after = await all(
    `select * from public.appointment_reminders where appointment_id = $1`, [a.id])
  chk('🔒 כל התזכורות בוטלו', after.every(r => r.status === 'cancelled'),
    after.map(r => r.status).join(','))
  chk('🔒 outcome_reason נגזר מהכלל הגנרי ולא נפל על null',
    after.every(r => r.outcome_reason === 'appointment_not_confirmed'),
    after.map(r => r.outcome_reason).join(','))
}


// ════════════════════════════════════════════════════════════════════════════
section('6. 0019 — idempotent')

{
  const sql0019 = readFileSync(new URL('0019_reject_status.sql', MIG_DIR), 'utf8')
  let rerunOk = true, rerunErr = ''
  try { await db.exec(sql0019) } catch (e) { rerunOk = false; rerunErr = e.message }
  chk('0019 רצה פעם שנייה בלי שגיאה', rerunOk, rerunErr)

  // והפונקציה עדיין עושה את הדבר הנכון אחרי ההרצה החוזרת
  const c = await newCustomer()
  const a = await pending({ customerId: c.id, startsAt: future(80) })
  const r = await reject(a.id)
  chk('הדחייה עדיין כותבת rejected אחרי הרצה חוזרת', r.ok && r.row.status === 'rejected')
}


// ════════════════════════════════════════════════════════════════════════════
section('7. הרשאות — service_role בלבד, בפועל')

{
  const SIG = 'public.reject_pending_appointment(uuid, uuid)'
  const SIG_APPROVE = 'public.approve_pending_appointment(uuid, uuid)'

  const p = await one(`
    select
      has_function_privilege('anon',          $1, 'execute') as anon_reject,
      has_function_privilege('authenticated', $1, 'execute') as auth_reject,
      has_function_privilege('service_role',  $1, 'execute') as svc_reject,
      has_function_privilege('anon',          $2, 'execute') as anon_approve,
      has_function_privilege('authenticated', $2, 'execute') as auth_approve,
      has_function_privilege('service_role',  $2, 'execute') as svc_approve`,
    [SIG, SIG_APPROVE])

  chk('🔒 anon אינו יכול להפעיל reject', p.anon_reject === false)
  chk('🔒 authenticated אינו יכול להפעיל reject', p.auth_reject === false)
  chk('service_role יכול להפעיל reject (ההרשאה שרדה את CREATE OR REPLACE)',
    p.svc_reject === true)
  chk('🔒 anon אינו יכול להפעיל approve', p.anon_approve === false)
  chk('🔒 authenticated אינו יכול להפעיל approve', p.auth_approve === false)
  chk('service_role יכול להפעיל approve', p.svc_approve === true)

  // 🔒 SECURITY INVOKER — DEFINER היה מאחד את ההרשאה ואת ה-RLS לנכס יחיד
  const sec = await all(`
    select proname, prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and proname in ('reject_pending_appointment', 'approve_pending_appointment')`)
  chk('שתי הפונקציות קיימות', sec.length === 2, `count=${sec.length}`)
  chk('🔒 שתיהן SECURITY INVOKER', sec.every(r => r.prosecdef === false))
}


// ════════════════════════════════════════════════════════════════════════════
section('8. הפרדת המשמעויות — rejected מול cancelled_by_business')

{
  // הערך החדש קיים ב-enum, והישן לא נעלם
  const labels = (await all(`
    select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'appointment_status' order by e.enumsortorder`)).map(r => r.enumlabel)

  chk("'rejected' קיים ב-appointment_status", labels.includes('rejected'))
  chk("🔒 'cancelled_by_business' לא הוסר — הוא נשאר לביטול תור מאושר",
    labels.includes('cancelled_by_business'))

  // ⚠️ אין backfill: שורה היסטורית שנכתבה כ-cancelled_by_business נשארת כך
  const c = await newCustomer()
  const a = await pending({ customerId: c.id, startsAt: future(86) })
  await db.query(`update public.appointments set status = 'cancelled_by_business' where id = $1`, [a.id])
  await db.exec(readFileSync(new URL('0019_reject_status.sql', MIG_DIR), 'utf8'))
  chk('🔒 אין backfill — שורה ישנה נשארת cancelled_by_business',
    (await statusOf(a.id)) === 'cancelled_by_business')

  // ── מונה ה-CRM: דחייה אינה נספרת כביטול מצד העסק. זו המטרה של 0019 ──
  //
  // ⚠️ שני תורים לאותה לקוחה בכוונה: אחד נדחה, ואחד בוטל כביטול-עסק אמיתי.
  // בדיקה עם תור אחד בלבד הייתה עוברת גם אם המונה שבור ותמיד 0 — כאן
  // המונה חייב להראות בדיוק 1, כלומר להבחין בין השניים.
  const c2 = await newCustomer()
  const rejectedAppt = await pending({ customerId: c2.id, startsAt: future(90) })
  await reject(rejectedAppt.id)

  const cancelledAppt = await pending({ customerId: c2.id, startsAt: future(94) })
  await db.query(`update public.appointments set status = 'cancelled_by_business' where id = $1`,
    [cancelledAppt.id])

  const m = await one(
    `select cancelled_by_business_count from public.customer_crm_metrics where customer_id = $1`,
    [c2.id])
  chk('🔒 המונה סופר את הביטול האמיתי בלבד — הדחייה אינה נספרת',
    m?.cancelled_by_business_count === 1, `count=${m?.cancelled_by_business_count}`)
}


// ── סיכום ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(66))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
