/**
 * בדיקות שלב 9B — migration 0032 (retention hold + ניקוי retention) מול
 * Postgres אמיתי (PGlite). PGlite בלבד — אין חיבור ל-Supabase, אין נתוני
 * TEST במסד production.
 *
 * המיקוד:
 *   1. 🔒 גבולות cutoff מדויקים לכל קטגוריה (7/30/90 יום) — לפני/בדיוק/אחרי.
 *   2. 🔒 session חי לעולם אינו נבחר; session מבוטל נשפט לפי revoked_at,
 *      לא לפי expires_at.
 *   3. 🔒 retention_hold חוסם איפוס notes; ביטולו מחזיר למסלול הרגיל.
 *   4. 🔒 anon/authenticated אינם יכולים להריץ אף RPC ואינם יכולים לעדכן
 *      ישירות אף עמודת retention — נבדק גם ב-has_*_privilege וגם בניסיון
 *      אמיתי (SET ROLE). service_role יכול.
 *   5. 🔒 appointment_notification_attempts נמחקים בלי לגעת בהורה;
 *      appointment_reminder_attempts וההורים שלהם אינם נגועים כלל.
 *   6. 🔒 dry-run/execute מחזירים ספירות בלבד — אין PII/UUID/notes/phone.
 *   7. 🔒 rejected אינה נמחקת; report-only אינו מבצע mutation.
 *   8. batch/NULL/idempotency/FK-on-delete-set-null.
 *
 * הרצה:  npm run test:privacy-retention
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(74)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', 'supabase', 'migrations')

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
`)

// ════════════════════════════════════════════════════════════════════════════
section('מיגרציות')

const migrations = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
for (const f of migrations) {
  try {
    await db.exec(readFileSync(new URL(f, `file://${MIGRATIONS_DIR}/`), 'utf8'))
  } catch (e) {
    chk(`${f} רצה`, false, `\n   ${e.message}`)
    console.log('\n⛔ עוצר — אין טעם להמשיך.')
    process.exit(1)
  }
}
chk(`כל ${migrations.length} המיגרציות רצו לפי הסדר`)
chk('0032 ברשימה', migrations.includes('0032_privacy_retention.sql'))

/*
 * ⚠️ service_role בפרודקשן מקבל GRANT מלא על כל הטבלאות ברמת הפלטפורמה
 * (חלק מהקמת פרויקט Supabase), לא ממיגרציה כלשהי — ולכן BYPASSRLS לבדו
 * (שעוקף רק RLS, לא הרשאות טבלה) אינו מספיק לבדיקת "SET ROLE service_role"
 * אמיתית כאן. משחזרים את אותה הרשאה בבדיקה בלבד, אחרי שכל הטבלאות כבר
 * קיימות — לא כחלק מהמיגרציה עצמה.
 */
await db.exec(`
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;
`)

// ── helpers ──────────────────────────────────────────────────────────────────

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
const errOf = async (sql, params) => {
  try { await db.query(sql, params); return null } catch (e) { return e.message }
}
const uuid = () => crypto.randomUUID()

const P_NOW = new Date('2026-06-01T00:00:00.000Z')
const isoMinus = (ms) => new Date(P_NOW.getTime() - ms).toISOString()
const DAY = 24 * 3600_000
const P_NOW_ISO = P_NOW.toISOString()

const ADMIN = uuid()
const OUTSIDER = uuid()
await db.query(`insert into auth.users (id) values ($1), ($2)`, [ADMIN, OUTSIDER])
await db.query(`insert into public.admins (user_id) values ($1)`, [ADMIN])

let phoneSeq = 0
const nextPhone = () => `+9725${String(30000000 + phoneSeq++).slice(-8)}`

async function newAuthUser() {
  const id = uuid()
  await db.query(`insert into auth.users (id) values ($1)`, [id])
  return id
}

async function makeCustomer(name = 'לקוחה בדיקה', authUserId = null) {
  return one(
    `insert into public.customers (phone_e164, full_name, auth_user_id)
     values ($1,$2,$3) returning *`,
    [nextPhone(), name, authUserId],
  )
}

async function makeAppointment(customerId, { startsAt, status = 'confirmed', notes = null }) {
  return one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, notes, calendar_sync_status, calendar_sync_operation)
     values ($1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, 20, $3, $4, 'not_applicable', 'upsert')
     returning *`,
    [customerId, startsAt, status, notes],
  )
}

async function makeHistory(appointmentId) {
  return one(
    `insert into public.appointment_history
       (appointment_id, action, to_status, actor)
     values ($1, 'created', 'confirmed', 'system')
     returning *`,
    [appointmentId],
  )
}

// ⚠️ 9B.2 — status ניתן לקביעה: eligibility של ה-attempts תלוי כעת במצב
// ה-notification ההורה (notification_is_terminal), לא ב-outcome של
// הניסיון עצמו. ברירת המחדל 'queued' — לא-סופי, בדיוק כמו שנוצר במציאות
// ע"י enqueue_appointment_notification (0025).
async function makeNotification(
  appointmentId, historyId, { event = 'booking_approved', status = 'queued' } = {},
) {
  return one(
    `insert into public.appointment_notifications
       (source_history_id, appointment_id, event, recipient_role, status)
     values ($1, $2, $3, 'customer', $4)
     returning *`,
    [historyId, appointmentId, event, status],
  )
}

async function setNotificationStatus(notificationId, status) {
  await db.query(
    `update public.appointment_notifications set status = $1 where id = $2`,
    [status, notificationId],
  )
}

async function makeNotificationAttempt(
  notificationId, { finishedAt = null, attemptNumber = 1, outcome = null },
) {
  // ⚠️ notification_attempts_closed_together (0025): (finished_at is null) =
  // (outcome is null) — אי אפשר attempt "פתוח" עם outcome, ולהפך.
  const resolvedOutcome = finishedAt ? (outcome ?? 'simulated') : null
  return one(
    `insert into public.appointment_notification_attempts
       (notification_id, attempt_number, provider, started_at, finished_at, outcome)
     values ($1, $2, 'disabled', $3, $4, $5)
     returning *`,
    [notificationId, attemptNumber, finishedAt ?? P_NOW_ISO, finishedAt, resolvedOutcome],
  )
}

async function makeReminder(appointmentId) {
  // reminder_kind='manual' דורש created_by_admin_id (reminders_manual_has_admin, 0011) —
  // ונבחר בכוונה כי הוא היחיד שמוחרג מ-appointment_reminders_snapshot_uniq,
  // ולכן אינו מתנגש עם התזכורות שהטריגר האוטומטי כבר יצר לאותו תור.
  // status='failed' ולא 'sent': reminders_sent_requires_live_provider (0011)
  // חוסמת status='sent' עם provider='disabled' (ברירת המחדל) — וזה בדיוק
  // המנגנון שמונע "sent" מזויף. הסטטוס עצמו לא רלוונטי לבדיקה הזו.
  return one(
    `insert into public.appointment_reminders
       (appointment_id, reminder_kind, appointment_starts_at, scheduled_for, expires_at,
        status, created_by_admin_id)
     values ($1, 'manual', now() + interval '1 day', now(), now() + interval '2 days',
             'failed', $2)
     returning *`,
    [appointmentId, ADMIN],
  )
}

async function makeReminderAttempt(reminderId, { finishedAt }) {
  return one(
    `insert into public.appointment_reminder_attempts
       (reminder_id, attempt_number, provider, started_at, finished_at, outcome)
     values ($1, 1, 'disabled', $2, $2, 'simulated')
     returning *`,
    [reminderId, finishedAt],
  )
}

async function insertOtp(createdAt) {
  return one(
    `insert into public.otp_attempts (phone_e164, code_hash, expires_at, created_at)
     values ($1, 'hash', $2::timestamptz + interval '15 minutes', $2::timestamptz)
     returning *`,
    [nextPhone(), createdAt],
  )
}

async function insertSession(authUserId, { expiresAt, revokedAt = null, createdAt = null }) {
  const created = createdAt ?? isoMinus(60 * DAY)
  return one(
    `insert into public.app_sessions (id, auth_user_id, role, created_at, expires_at, revoked_at)
     values ($1, $2, 'customer', $3::timestamptz, $4::timestamptz, $5::timestamptz)
     returning *`,
    [uuid(), authUserId, created, expiresAt, revokedAt],
  )
}

const dryRun = (batchLimit = 1000, now = P_NOW_ISO) =>
  one(`select public.privacy_retention_dry_run($1::timestamptz, $2::integer) as r`, [now, batchLimit])
    .then(row => row.r)

const purgeOtpSessions = (batchLimit = 1000, now = P_NOW_ISO) =>
  one(`select public.privacy_retention_purge_otp_sessions($1::timestamptz, $2::integer) as r`,
    [now, batchLimit]).then(row => row.r)

const purgeNotificationAttempts = (batchLimit = 1000, now = P_NOW_ISO) =>
  one(`select public.privacy_retention_purge_notification_attempts($1::timestamptz, $2::integer) as r`,
    [now, batchLimit]).then(row => row.r)

const resetOldNotes = (batchLimit = 1000, now = P_NOW_ISO) =>
  one(`select public.privacy_retention_reset_old_notes($1::timestamptz, $2::integer) as r`,
    [now, batchLimit]).then(row => row.r)

const setHold = (customerId, hold, adminId = ADMIN) =>
  one(`select public.set_customer_retention_hold($1,$2,$3) as r`, [customerId, adminId, hold])
    .then(row => row.r)

// ════════════════════════════════════════════════════════════════════════════
section('סכמה — retention_hold על customers')

{
  const cols = await all(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'customers'
      and column_name in ('retention_hold', 'retention_hold_updated_at', 'retention_hold_updated_by')`)
  const byName = Object.fromEntries(cols.map(c => [c.column_name, c]))

  chk('שלוש העמודות נוצרו', cols.length === 3, cols.map(c => c.column_name).join(', '))
  chk('retention_hold הוא boolean NOT NULL DEFAULT false',
    byName.retention_hold?.data_type === 'boolean' && byName.retention_hold?.is_nullable === 'NO'
    && String(byName.retention_hold?.column_default).includes('false'))
  chk('retention_hold_updated_at ניתן ל-NULL', byName.retention_hold_updated_at?.is_nullable === 'YES')
  chk('retention_hold_updated_by ניתן ל-NULL', byName.retention_hold_updated_by?.is_nullable === 'YES')

  const fk = await one(`
    select confdeltype from pg_constraint
    where conrelid = 'public.customers'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (retention_hold_updated_by)%'`)
  chk('🔒 retention_hold_updated_by הוא ON DELETE SET NULL', fk?.confdeltype === 'n',
    `confdeltype=${fk?.confdeltype}`)
}

{
  // הכלל המצומצם שאושר: updated_by IS NULL OR updated_at IS NOT NULL.
  const c = await makeCustomer('לבדיקת constraint')
  const bad = await errOf(
    `update public.customers set retention_hold_updated_by = $1, retention_hold_updated_at = null
     where id = $2`, [ADMIN, c.id])
  chk('🔒 updated_by לא-NULL עם updated_at NULL נדחה (הכלל שאושר)',
    bad !== null && /check/i.test(bad))

  const ok1 = await errOf(
    `update public.customers set retention_hold_updated_by = null, retention_hold_updated_at = now()
     where id = $2`.replace('$2', '$1'), [c.id])
  chk('updated_by=NULL עם updated_at לא-NULL מותר (admin נמחק, at נשאר)', ok1 === null)
}

// ════════════════════════════════════════════════════════════════════════════
section('הרשאות RPC — has_function_privilege')

const RETENTION_SIGS = [
  'public.set_customer_retention_hold(uuid, uuid, boolean)',
  'public.privacy_retention_dry_run(timestamptz, integer)',
  'public.privacy_retention_purge_otp_sessions(timestamptz, integer)',
  'public.privacy_retention_purge_notification_attempts(timestamptz, integer)',
  'public.privacy_retention_reset_old_notes(timestamptz, integer)',
]

for (const sig of RETENTION_SIGS) {
  const anonOk = await one(`select has_function_privilege('anon', $1, 'EXECUTE') as ok`, [sig])
  const authOk = await one(`select has_function_privilege('authenticated', $1, 'EXECUTE') as ok`, [sig])
  const svcOk = await one(`select has_function_privilege('service_role', $1, 'EXECUTE') as ok`, [sig])
  chk(`🔒 ${sig.split('(')[0].replace('public.', '')} — anon=false`, anonOk.ok === false)
  chk(`🔒 ${sig.split('(')[0].replace('public.', '')} — authenticated=false`, authOk.ok === false)
  chk(`${sig.split('(')[0].replace('public.', '')} — service_role=true`, svcOk.ok === true)
}

{
  const anonUpd = await one(`select has_table_privilege('anon', 'public.customers', 'UPDATE') as ok`)
  const authUpd = await one(`select has_table_privilege('authenticated', 'public.customers', 'UPDATE') as ok`)
  chk('🔒 anon אין UPDATE על customers (revoke קיים מ-0010, מכסה גם עמודות retention)',
    anonUpd.ok === false)
  chk('🔒 authenticated אין UPDATE על customers', authUpd.ok === false)
}

// ════════════════════════════════════════════════════════════════════════════
section('הרשאות — ניסיון אמיתי (SET ROLE), לא רק has_*_privilege')

{
  const c = await makeCustomer('להגנת role')

  await db.exec('set role authenticated')
  const deniedUpdate = await errOf(
    `update public.customers set retention_hold = true where id = $1`, [c.id])
  const deniedRpc = await errOf(
    `select public.set_customer_retention_hold($1, $2, true)`, [c.id, ADMIN])
  const deniedDryRun = await errOf(`select public.privacy_retention_dry_run()`)
  await db.exec('reset role')

  chk('🔒 authenticated אינו יכול UPDATE ישיר על retention_hold בפועל',
    deniedUpdate !== null && /permission denied/i.test(deniedUpdate))
  chk('🔒 authenticated אינו יכול להריץ set_customer_retention_hold בפועל',
    deniedRpc !== null && /permission denied/i.test(deniedRpc))
  chk('🔒 authenticated אינו יכול להריץ privacy_retention_dry_run בפועל',
    deniedDryRun !== null && /permission denied/i.test(deniedDryRun))

  await db.exec('set role anon')
  const anonDenied = await errOf(
    `update public.customers set retention_hold = true where id = $1`, [c.id])
  await db.exec('reset role')
  chk('🔒 anon אינו יכול UPDATE ישיר על retention_hold בפועל',
    anonDenied !== null && /permission denied/i.test(anonDenied))

  await db.exec('set role service_role')
  const svcOk = await errOf(
    `select public.set_customer_retention_hold($1, $2, true)`, [c.id, ADMIN])
  await db.exec('reset role')
  chk('service_role כן יכול להריץ set_customer_retention_hold', svcOk === null)

  // ניקוי לבדיקות הבאות
  await setHold(c.id, false)
}

// ════════════════════════════════════════════════════════════════════════════
section('set_customer_retention_hold — idempotency ו-audit')

{
  const c = await makeCustomer('לבדיקת hold')
  const on = await setHold(c.id, true)
  chk('הפעלה ראשונה מחזירה updated', on.outcome === 'updated' && on.retention_hold === true)

  const row1 = await one(`select retention_hold, retention_hold_updated_at, retention_hold_updated_by
                           from public.customers where id=$1`, [c.id])
  chk('העמודות נשמרו יחד', row1.retention_hold === true
    && row1.retention_hold_updated_at !== null && row1.retention_hold_updated_by === ADMIN)

  const again = await setHold(c.id, true)
  chk('🔒 קריאה חוזרת עם אותו ערך מחזירה unchanged (idempotent)', again.outcome === 'unchanged')

  const act = await all(
    `select old_value, new_value from public.customer_crm_activity
     where customer_id=$1 and action='retention_hold_changed'`, [c.id])
  chk('🔒 נכתבה שורת activity אחת בדיוק (לא שתיים) — הקריאה החוזרת לא כתבה', act.length === 1)
  chk('old_value/new_value הם true/false בלבד, ללא סיבה חופשית',
    act[0].old_value === 'false' && act[0].new_value === 'true')

  const off = await setHold(c.id, false)
  chk('ביטול מחזיר updated', off.outcome === 'updated' && off.retention_hold === false)

  let blocked = false
  try { await setHold(c.id, true, OUTSIDER) } catch (e) { blocked = /NOT_ADMIN/.test(e.message) }
  chk('🔒 מי שאינו admin נחסם (NOT_ADMIN)', blocked)

  let badHold = false
  try { await one(`select public.set_customer_retention_hold($1,$2,null::boolean) as r`, [c.id, ADMIN]) }
  catch (e) { badHold = /BAD_HOLD/.test(e.message) }
  chk('🔒 p_hold=NULL נדחה (BAD_HOLD)', badHold)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔴 FK on delete set null — admin נמחק, at נשאר')

{
  // ⚠️ עדכון ישיר, לא דרך ה-RPC: set_customer_retention_hold כותבת גם
  // customer_crm_activity.actor_admin_id (FK ללא ON DELETE, כלומר RESTRICT)
  // לאותה מנהלת — וזה היה חוסם את מחיקתה מסיבה שאינה שייכת לבדיקה הזו.
  // כאן בודקים בידוד מוחלט את ה-FK של customers.retention_hold_updated_by
  // בלבד, בדיוק כפי שבלוק ה-DO של 0032 מוודא מבנית.
  const holder = await newAuthUser()
  await db.query(`insert into public.admins (user_id) values ($1)`, [holder])
  const c = await makeCustomer('hold מנהלת שתימחק')
  await db.query(
    `update public.customers
     set retention_hold = true, retention_hold_updated_at = now(), retention_hold_updated_by = $1
     where id = $2`, [holder, c.id])

  const before = await one(
    `select retention_hold, retention_hold_updated_at, retention_hold_updated_by
     from public.customers where id=$1`, [c.id])
  chk('הוגדר ע"י המנהלת', before.retention_hold_updated_by === holder)

  await db.query(`delete from auth.users where id=$1`, [holder])

  const after = await one(
    `select retention_hold, retention_hold_updated_at, retention_hold_updated_by
     from public.customers where id=$1`, [c.id])
  chk('🔴 retention_hold עצמו נשאר true אחרי מחיקת המנהלת', after.retention_hold === true)
  chk('🔒 retention_hold_updated_by התאפס ל-NULL (on delete set null)',
    after.retention_hold_updated_by === null)
  // ⚠️ PGlite מחזירה timestamptz כאובייקט Date — השוואת === בין שני
  // מופעים שונים היא תמיד false גם כשהזמן זהה; משווים getTime().
  chk('🔒 retention_hold_updated_at נשאר — עדות שהערך שונה אי-פעם',
    after.retention_hold_updated_at !== null
    && new Date(after.retention_hold_updated_at).getTime()
       === new Date(before.retention_hold_updated_at).getTime())
}

// ════════════════════════════════════════════════════════════════════════════
section('גבולות cutoff — otp_attempts (7 ימים)')

{
  const before = await insertOtp(isoMinus(8 * DAY))       // ישן יותר מ-7 ימים → זכאי
  const exact = await insertOtp(isoMinus(7 * DAY))        // בדיוק על הגבול → לא זכאי (< ולא <=)
  const after = await insertOtp(isoMinus(7 * DAY - 1))    // מילישנייה אחרי הגבול → לא זכאי

  const dr = await dryRun()
  chk('dry-run רואה בדיוק שורה זכאית אחת (before)', dr.otp_attempts.total_eligible === 1,
    `total=${dr.otp_attempts.total_eligible}`)

  const res = await purgeOtpSessions()
  chk('execute מחק בדיוק שורה אחת', res.otp_deleted === 1, `deleted=${res.otp_deleted}`)

  const survivors = await all(`select id from public.otp_attempts where id in ($1,$2,$3)`,
    [before.id, exact.id, after.id])
  const survivorIds = survivors.map(r => r.id)
  chk('🔒 "לפני הגבול" נמחקה', !survivorIds.includes(before.id))
  chk('🔒 "בדיוק על הגבול" נשארה (לא <=)', survivorIds.includes(exact.id))
  chk('🔒 "מילישנייה אחרי הגבול" נשארה', survivorIds.includes(after.id))

  // ניקוי לבדיקות הבאות
  await db.query(`delete from public.otp_attempts where id in ($1,$2)`, [exact.id, after.id])
}

{
  // NULL/range guards — נבדק פעם אחת לדוגמה על הפונקציה הזו, ושוב על שאר השלוש למטה.
  const nullNow = await errOf(`select public.privacy_retention_purge_otp_sessions(null, 100)`)
  chk('🔒 p_now=NULL נדחה (P_NOW_REQUIRED)', nullNow !== null && /P_NOW_REQUIRED/.test(nullNow))

  const nullBatch = await errOf(
    `select public.privacy_retention_purge_otp_sessions($1::timestamptz, null)`, [P_NOW_ISO])
  chk('🔒 p_batch_limit=NULL נדחה (P_BATCH_LIMIT_REQUIRED)',
    nullBatch !== null && /P_BATCH_LIMIT_REQUIRED/.test(nullBatch))

  const zeroBatch = await errOf(
    `select public.privacy_retention_purge_otp_sessions($1::timestamptz, 0)`, [P_NOW_ISO])
  chk('🔒 p_batch_limit=0 נדחה (מחוץ לטווח 1–5000)',
    zeroBatch !== null && /P_BATCH_LIMIT_OUT_OF_RANGE/.test(zeroBatch))

  const overBatch = await errOf(
    `select public.privacy_retention_purge_otp_sessions($1::timestamptz, 5001)`, [P_NOW_ISO])
  chk('🔒 p_batch_limit=5001 נדחה (מחוץ לטווח 1–5000)',
    overBatch !== null && /P_BATCH_LIMIT_OUT_OF_RANGE/.test(overBatch))

  const okEdgeLow = await errOf(
    `select public.privacy_retention_purge_otp_sessions($1::timestamptz, 1)`, [P_NOW_ISO])
  chk('p_batch_limit=1 מותר (גבול תחתון)', okEdgeLow === null)
  const okEdgeHigh = await errOf(
    `select public.privacy_retention_purge_otp_sessions($1::timestamptz, 5000)`, [P_NOW_ISO])
  chk('p_batch_limit=5000 מותר (גבול עליון)', okEdgeHigh === null)
}

// אותם guards, לשלוש הפונקציות הנותרות + dry_run — בדיקה מקוצרת לכל אחת.
for (const fnName of [
  'privacy_retention_dry_run',
  'privacy_retention_purge_notification_attempts',
  'privacy_retention_reset_old_notes',
]) {
  const nullNow = await errOf(`select public.${fnName}(null, 100)`)
  const nullBatch = await errOf(`select public.${fnName}($1::timestamptz, null)`, [P_NOW_ISO])
  const badRange = await errOf(`select public.${fnName}($1::timestamptz, 6000)`, [P_NOW_ISO])
  chk(`🔒 ${fnName} — p_now=NULL נדחה`, nullNow !== null && /P_NOW_REQUIRED/.test(nullNow))
  chk(`🔒 ${fnName} — p_batch_limit=NULL נדחה`, nullBatch !== null && /P_BATCH_LIMIT_REQUIRED/.test(nullBatch))
  chk(`🔒 ${fnName} — p_batch_limit מחוץ לטווח נדחה`, badRange !== null && /P_BATCH_LIMIT_OUT_OF_RANGE/.test(badRange))
}

// ════════════════════════════════════════════════════════════════════════════
section('גבולות cutoff — app_sessions (30 יום, COALESCE(revoked_at, expires_at))')

{
  const user = await newAuthUser()

  // session חי: expires_at בעתיד, revoked_at NULL — לעולם לא זכאי, לא משנה כמה created_at ישן.
  const live = await insertSession(user, {
    createdAt: isoMinus(400 * DAY), expiresAt: new Date(P_NOW.getTime() + 30 * DAY).toISOString(),
  })

  // מבוטל לפני 31 יום, אבל expires_at רחוק בעתיד — הקובע הוא revoked_at.
  const revokedOld = await insertSession(user, {
    createdAt: isoMinus(60 * DAY),
    expiresAt: new Date(P_NOW.getTime() + 365 * DAY).toISOString(),
    revokedAt: isoMinus(31 * DAY),
  })

  // פג תוקף (לא בוטל) לפני 31 יום — הקובע הוא expires_at.
  const expiredOld = await insertSession(user, {
    createdAt: isoMinus(60 * DAY), expiresAt: isoMinus(31 * DAY),
  })

  // בדיוק על הגבול (30 יום), ומילישנייה אחריו — לא זכאים.
  const exact = await insertSession(user, {
    createdAt: isoMinus(60 * DAY), expiresAt: isoMinus(30 * DAY),
  })
  const justAfter = await insertSession(user, {
    createdAt: isoMinus(60 * DAY), expiresAt: isoMinus(30 * DAY - 1),
  })

  const dr = await dryRun()
  chk('dry-run רואה בדיוק שתי שורות זכאיות (revokedOld + expiredOld)',
    dr.app_sessions.total_eligible === 2, `total=${dr.app_sessions.total_eligible}`)

  const res = await purgeOtpSessions()
  chk('execute מחק בדיוק שתי שורות', res.sessions_deleted === 2, `deleted=${res.sessions_deleted}`)

  const remainingIds = (await all(
    `select id from public.app_sessions where id in ($1,$2,$3,$4,$5)`,
    [live.id, revokedOld.id, expiredOld.id, exact.id, justAfter.id])).map(r => r.id)

  chk('🔒 session חי לעולם לא נמחק', remainingIds.includes(live.id))
  chk('🔒 "בוטל לפני 31 יום" נמחק — הקובע הוא revoked_at, לא expires_at הרחוק',
    !remainingIds.includes(revokedOld.id))
  chk('🔒 "פג תוקף לפני 31 יום" נמחק — הקובע הוא expires_at', !remainingIds.includes(expiredOld.id))
  chk('🔒 "בדיוק על הגבול" נשאר', remainingIds.includes(exact.id))
  chk('"מילישנייה אחרי הגבול" נשאר', remainingIds.includes(justAfter.id))

  await db.query(`delete from public.app_sessions where id in ($1,$2)`, [exact.id, justAfter.id])
}

{
  // idempotency: הרצה שנייה לא מוצאת כלום.
  const res2 = await purgeOtpSessions()
  chk('🔒 idempotency — הרצה שנייה מיד אחרי הראשונה מוחקת 0/0',
    res2.otp_deleted === 0 && res2.sessions_deleted === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('batch continuation')

{
  for (let i = 0; i < 5; i++) await insertOtp(isoMinus((10 + i) * DAY))

  const dr1 = await dryRun(2)
  chk('dry-run: total=5, next_batch_count=2 (batch_limit=2)',
    dr1.otp_attempts.total_eligible === 5 && dr1.otp_attempts.next_batch_count === 2,
    `total=${dr1.otp_attempts.total_eligible} next=${dr1.otp_attempts.next_batch_count}`)

  const r1 = await purgeOtpSessions(2)
  chk('ריצה ראשונה מחקה 2 בדיוק (לא את כל ה-5)', r1.otp_deleted === 2)

  const dr2 = await dryRun(2)
  chk('אחרי ריצה ראשונה נשארו 3 זכאיות', dr2.otp_attempts.total_eligible === 3,
    `total=${dr2.otp_attempts.total_eligible}`)

  const r2 = await purgeOtpSessions(2)
  const r3 = await purgeOtpSessions(2)
  chk('שתי ריצות נוספות מנקות את כל השאר (2 + 1)',
    r2.otp_deleted === 2 && r3.otp_deleted === 1, `r2=${r2.otp_deleted} r3=${r3.otp_deleted}`)

  const dr3 = await dryRun()
  chk('אחרי סבב מלא — אפס זכאיות', dr3.otp_attempts.total_eligible === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('appointment_notification_attempts — eligibility לפי מצב ההורה (9B.2)')

// ── A: notification סופי (sent) — cutoff, open, ופתוח נבדקים כאן ──────────
{
  const c = await makeCustomer('להתראות — הורה סופי')
  const appt = await makeAppointment(c.id, { startsAt: isoMinus(-5 * DAY) })
  const hist = await makeHistory(appt.id)
  const notif = await makeNotification(appt.id, hist.id, { status: 'simulated' })

  const closedOld = await makeNotificationAttempt(notif.id, { finishedAt: isoMinus(91 * DAY), attemptNumber: 1 })
  const closedExact = await makeNotificationAttempt(notif.id, { finishedAt: isoMinus(90 * DAY), attemptNumber: 2 })
  const closedJustAfter = await makeNotificationAttempt(notif.id, { finishedAt: isoMinus(90 * DAY - 1), attemptNumber: 3 })
  const closedRecent = await makeNotificationAttempt(notif.id, { finishedAt: isoMinus(10 * DAY), attemptNumber: 4 })
  const open = await makeNotificationAttempt(notif.id, { finishedAt: null, attemptNumber: 5 })

  const dr = await dryRun()
  chk('dry-run רואה בדיוק ניסיון אחד (closedOld) — ההורה סופי (sent)',
    dr.notification_attempts.total_eligible === 1, `total=${dr.notification_attempts.total_eligible}`)

  const res = await purgeNotificationAttempts()
  chk('execute מחק בדיוק ניסיון אחד', res.notification_attempts_deleted === 1)

  const remaining = (await all(
    `select id from public.appointment_notification_attempts where id in ($1,$2,$3,$4,$5)`,
    [closedOld.id, closedExact.id, closedJustAfter.id, closedRecent.id, open.id])).map(r => r.id)
  chk('🔒 הישן-הסגור-הסופי נמחק (לפני הגבול)', !remaining.includes(closedOld.id))
  chk('🔒 "בדיוק על 90 יום" נשאר (לא <=)', remaining.includes(closedExact.id))
  chk('🔒 "מילישנייה אחרי הגבול" נשאר', remaining.includes(closedJustAfter.id))
  chk('סגור-אך-חדש נשאר', remaining.includes(closedRecent.id))
  chk('🔒 attempt ללא finished_at (פתוח) לעולם לא נמחק, גם כשההורה סופי',
    remaining.includes(open.id))

  const parentStillThere = await one(
    `select id, status from public.appointment_notifications where id=$1`, [notif.id])
  chk('🔒 appointment_notifications (ההורה) לא נגעו בו', parentStillThere?.status === 'simulated')
  const apptStillThere = await one(`select id from public.appointments where id=$1`, [appt.id])
  const histStillThere = await one(`select id from public.appointment_history where id=$1`, [hist.id])
  chk('🔒 appointments לא נגעו בו', apptStillThere !== undefined)
  chk('🔒 appointment_history לא נגעו בו', histStillThere !== undefined)
}

// ── B: notification סופי (failed) + attempt outcome='retryable_error' ישן
//      → כן נמחק. זה בדיוק התיקון של 9B.2: מה שקובע הוא מצב ההורה, לא
//      ה-outcome של הניסיון הבודד — ניסיון ראשון יכול להיכשל זמנית
//      (retryable_error) והניסיון השני להצליח/להיכשל לצמיתות; ברגע
//      שההורה סופי, כל ה-attempts הישנים שלו — כולל הראשון — ברי-מחיקה.
{
  const c = await makeCustomer('להתראות — retryable אחרי סיום')
  const appt = await makeAppointment(c.id, { startsAt: isoMinus(-6 * DAY) })
  const hist = await makeHistory(appt.id)
  const notif = await makeNotification(appt.id, hist.id, { status: 'failed' })
  const retryableButDone = await makeNotificationAttempt(
    notif.id, { finishedAt: isoMinus(200 * DAY), attemptNumber: 1, outcome: 'retryable_error' })

  const dr = await dryRun()
  chk('🔒 dry-run סופרת retryable_error כשההורה כבר סופי (failed)',
    dr.notification_attempts.total_eligible === 1, `total=${dr.notification_attempts.total_eligible}`)

  const res = await purgeNotificationAttempts()
  chk('🔒 execute מוחקת retryable_error ישן כשההורה סופי', res.notification_attempts_deleted === 1)

  const gone = await one(
    `select id from public.appointment_notification_attempts where id=$1`, [retryableButDone.id])
  chk('הניסיון אכן נמחק', gone === undefined)
}

// ── C: notification עדיין 'retrying' (לא-סופי) + retryable_error בן 200 יום
//      → נשאר. זה בדיוק המקרה שההגנה נועדה למנוע: ההורה עדיין ממתין
//      לניסיון הבא, ומחיקת הניסיון הקודם הייתה מוחקת עדות רלוונטית.
{
  const c = await makeCustomer('להתראות — עדיין retrying')
  const appt = await makeAppointment(c.id, { startsAt: isoMinus(-7 * DAY) })
  const hist = await makeHistory(appt.id)
  const notif = await makeNotification(appt.id, hist.id, { status: 'retrying' })
  const stillWaiting = await makeNotificationAttempt(
    notif.id, { finishedAt: isoMinus(200 * DAY), attemptNumber: 1, outcome: 'retryable_error' })

  const dr1 = await dryRun()
  chk('🔒 dry-run אינה סופרת — ההורה עדיין retrying (לא סופי)',
    dr1.notification_attempts.total_eligible === 0, `total=${dr1.notification_attempts.total_eligible}`)

  await purgeNotificationAttempts()
  const stillThere1 = await one(
    `select id from public.appointment_notification_attempts where id=$1`, [stillWaiting.id])
  chk('🔒 הניסיון נשאר — ההורה retrying, גם ישן מ-200 יום', stillThere1 !== undefined)

  // ── E: לאחר שההורה עובר למצב סופי, אותו attempt נהיה eligible ──────────
  await setNotificationStatus(notif.id, 'failed')
  const dr2 = await dryRun()
  chk('🔒 לאחר שהעברנו את ההורה ל-failed — הניסיון הישן נספר עכשיו',
    dr2.notification_attempts.total_eligible === 1, `total=${dr2.notification_attempts.total_eligible}`)

  const res2 = await purgeNotificationAttempts()
  chk('🔒 ...וגם נמחק בפועל', res2.notification_attempts_deleted === 1)
  const stillThere2 = await one(
    `select id from public.appointment_notification_attempts where id=$1`, [stillWaiting.id])
  chk('הניסיון אכן נמחק אחרי המעבר למצב סופי', stillThere2 === undefined)
}

// ── D: notification לא-סופי ('sending') + attempt outcome='lease_expired' ישן
//      → נשאר. lease_expired מסומן ע"י claim_appointment_notification
//      (0025) כשה-worker הקודם נקטע — וההורה חוזר ל-'sending' ונתפס שוב,
//      לא הופך לסופי.
{
  const c = await makeCustomer('להתראות — sending אחרי lease_expired')
  const appt = await makeAppointment(c.id, { startsAt: isoMinus(-8 * DAY) })
  const hist = await makeHistory(appt.id)
  const notif = await makeNotification(appt.id, hist.id, { status: 'sending' })
  const orphanedLease = await makeNotificationAttempt(
    notif.id, { finishedAt: isoMinus(200 * DAY), attemptNumber: 1, outcome: 'lease_expired' })

  const dr = await dryRun()
  chk('🔒 dry-run אינה סופרת — ההורה sending (לא סופי)',
    dr.notification_attempts.total_eligible === 0, `total=${dr.notification_attempts.total_eligible}`)

  await purgeNotificationAttempts()
  const stillThere = await one(
    `select id from public.appointment_notification_attempts where id=$1`, [orphanedLease.id])
  chk('🔒 lease_expired ישן נשאר כל עוד ההורה sending', stillThere !== undefined)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔴 appointment_reminder_attempts — אינם נגועים כלל (v1)')

{
  const c = await makeCustomer('לתזכורות')
  // ⚠️ יום שונה מכל תור 'confirmed' אחר בקובץ: שני תורים 'confirmed'
  // באותו starts_at בדיוק היו מתנגשים ב-appointments_no_overlap.
  const appt = await makeAppointment(c.id, { startsAt: isoMinus(-10 * DAY) })
  const reminder = await makeReminder(appt.id)
  // ניסיון "סגור" וישן מ-90+ יום — אילו purgeNotificationAttempts הייתה
  // נוגעת גם בטבלה הזו בטעות, זו בדיוק השורה שהייתה נמחקת.
  const attempt = await makeReminderAttempt(reminder.id, { finishedAt: isoMinus(200 * DAY) })

  await purgeNotificationAttempts()
  await purgeOtpSessions()
  await resetOldNotes()

  const stillThere = await one(
    `select id from public.appointment_reminder_attempts where id=$1`, [attempt.id])
  chk('🔴 appointment_reminder_attempts לא נגעו בהם ע"י אף פונקציית 0032',
    stillThere !== undefined)
  const reminderStillThere = await one(
    `select id from public.appointment_reminders where id=$1`, [reminder.id])
  chk('🔴 appointment_reminders (ההורה) לא נגעו בו', reminderStillThere !== undefined)

  // וגם: הטריגר append-only עדיין חוסם מחיקה ישירה כשההורה קיים — לא נחלש.
  const blocked = await errOf(
    `delete from public.appointment_reminder_attempts where id=$1`, [attempt.id])
  chk('🔒 הטריגר append-only עדיין חוסם DELETE ישיר כל עוד ההורה קיים',
    blocked !== null && /APPEND_ONLY/.test(blocked))
}

// ════════════════════════════════════════════════════════════════════════════
section('appointments.notes — 90 יום, retention_hold, ו-rejected')

{
  const c = await makeCustomer('להערות')
  const oldAppt = await makeAppointment(c.id, {
    startsAt: isoMinus(91 * DAY), status: 'completed', notes: 'הערה לוגיסטית ישנה',
  })
  const exactAppt = await makeAppointment(c.id, {
    startsAt: isoMinus(90 * DAY), status: 'completed', notes: 'הערה בדיוק על הגבול',
  })
  const justAfterAppt = await makeAppointment(c.id, {
    startsAt: isoMinus(90 * DAY - 1), status: 'completed', notes: 'הערה מילישנייה אחרי הגבול',
  })
  const recentAppt = await makeAppointment(c.id, {
    startsAt: isoMinus(10 * DAY), status: 'completed', notes: 'הערה חדשה',
  })
  const noNotesAppt = await makeAppointment(c.id, {
    startsAt: isoMinus(200 * DAY), status: 'completed', notes: null,
  })

  const dr = await dryRun()
  chk('dry-run רואה בדיוק תור אחד זכאי לאיפוס notes (oldAppt)',
    dr.appointments_notes.total_eligible === 1, `total=${dr.appointments_notes.total_eligible}`)

  const res = await resetOldNotes()
  chk('execute איפס בדיוק notes אחת', res.notes_reset === 1)

  const rows = await all(
    `select id, notes, status from public.appointments where id in ($1,$2,$3,$4,$5)`,
    [oldAppt.id, exactAppt.id, justAfterAppt.id, recentAppt.id, noNotesAppt.id])
  const byId = Object.fromEntries(rows.map(r => [r.id, r]))
  chk('🔒 הישן-מ-90-יום התאפס ל-NULL', byId[oldAppt.id].notes === null)
  chk('🔒 "בדיוק על 90 יום" לא התאפס (לא <=)', byId[exactAppt.id].notes !== null)
  chk('🔒 "מילישנייה אחרי הגבול" לא התאפס', byId[justAfterAppt.id].notes !== null)
  chk('חדש לא נגע בו', byId[recentAppt.id].notes !== null)
  chk('אין שינוי בשורה שכבר notes=NULL (אינה נספרת שוב)', byId[noNotesAppt.id].notes === null)
}

{
  // 🔒 retention_hold חוסם איפוס — וביטולו מחזיר למסלול הרגיל.
  const held = await makeCustomer('תחת hold')
  await setHold(held.id, true)
  const heldAppt = await makeAppointment(held.id, {
    startsAt: isoMinus(120 * DAY), status: 'completed', notes: 'הערה שאסור לגעת בה',
  })

  await resetOldNotes()
  const stillThere = await one(`select notes from public.appointments where id=$1`, [heldAppt.id])
  chk('🔒 retention_hold=true — ה-notes לא התאפסה', stillThere.notes !== null)

  const drWithHold = await dryRun()
  chk('🔒 dry-run לא סופרת אותה בזמן שה-hold פעיל',
    drWithHold.appointments_notes.total_eligible === 0, `total=${drWithHold.appointments_notes.total_eligible}`)

  await setHold(held.id, false)
  const drAfterUnhold = await dryRun()
  chk('לאחר ביטול ה-hold — חוזרת להיספר כזכאית',
    drAfterUnhold.appointments_notes.total_eligible === 1)

  await resetOldNotes()
  const nowReset = await one(`select notes from public.appointments where id=$1`, [heldAppt.id])
  chk('🔒 לאחר ביטול ה-hold — הניקוי הבא מאפס אותה', nowReset.notes === null)
}

{
  // 🔒 rejected — לא נמחקת, רק ה-notes שלה מתאפסת כמו כל סטטוס אחר.
  const c = await makeCustomer('נדחתה')
  const rejected = await makeAppointment(c.id, {
    startsAt: isoMinus(200 * DAY), status: 'rejected', notes: 'הערה לבקשה שנדחתה',
  })
  const historyBefore = await one(
    `select count(*)::integer as n from public.appointment_history where appointment_id=$1`,
    [rejected.id])

  await resetOldNotes()

  const after = await one(
    `select status, notes from public.appointments where id=$1`, [rejected.id])
  chk('🔒 rejected — השורה לא נמחקה', after !== undefined)
  chk('🔒 rejected — הסטטוס נשאר rejected (לא נגעו בו)', after.status === 'rejected')
  chk('rejected — ה-notes כן התאפסה, לפי הכלל הכללי', after.notes === null)

  const historyAfter = await one(
    `select count(*)::integer as n from public.appointment_history where appointment_id=$1`,
    [rejected.id])
  chk('🔒 appointment_history של הבקשה הנדחית לא נגעו בו',
    historyAfter.n === historyBefore.n)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 9B.1 — retention_hold אינו עוצר ניקוי טכני או דוחות report-only')

{
  // לקוחה תחת hold, עם חשבון התחברות אמיתי — otp/session/notification
  // attempts שלה נמחקים בדיוק כמו של כל לקוחה אחרת. hold אינו מתיימר
  // לעצור ניקוי טכני, וזה נבדק כאן על נתונים אמיתיים, לא רק בהיעדר
  // סינון ב-SQL.
  const authId = await newAuthUser()
  const held = await makeCustomer('תחת hold — עם נתונים טכניים', authId)
  await setHold(held.id, true)

  const staleSession = await insertSession(authId, {
    createdAt: isoMinus(60 * DAY), expiresAt: isoMinus(31 * DAY),
  })
  const staleOtp = await insertOtp(isoMinus(8 * DAY))

  const heldAppt = await makeAppointment(held.id, {
    startsAt: isoMinus(-9 * DAY), status: 'confirmed', notes: null,
  })
  const heldHist = await makeHistory(heldAppt.id)
  const heldNotif = await makeNotification(heldAppt.id, heldHist.id, { status: 'simulated' })
  const staleAttempt = await makeNotificationAttempt(
    heldNotif.id, { finishedAt: isoMinus(91 * DAY), attemptNumber: 1 })

  await purgeOtpSessions()
  await purgeNotificationAttempts()

  const sessionGone = await one(`select id from public.app_sessions where id=$1`, [staleSession.id])
  const otpGone = await one(`select id from public.otp_attempts where id=$1`, [staleOtp.id])
  const attemptGone = await one(
    `select id from public.appointment_notification_attempts where id=$1`, [staleAttempt.id])

  chk('🔒 session ישן של לקוחה תחת hold נמחק כרגיל — hold אינו חוסם ניקוי טכני',
    sessionGone === undefined)
  chk('🔒 otp ישן נמחק כרגיל גם כשלקוחה כלשהי במסד תחת hold', otpGone === undefined)
  chk('🔒 notification attempt ישן-סגור של לקוחה תחת hold נמחק כרגיל',
    attemptGone === undefined)

  // report-only: hold אינו מסתיר את הלקוחה מדוחות אי-פעילות/CRM (9B.1 —
  // תוקן; בשלב 9B המקורי דוחות אלה כן הוחרגו, וזה שונה בכוונה).
  await one(
    `insert into public.customer_notes (customer_id, body, created_by_admin_id, client_request_id)
     values ($1,'הערה ישנה',$2,gen_random_uuid())`, [held.id, ADMIN])
  await db.query(
    `update public.appointments set starts_at = $1 where id = $2`,
    [isoMinus(25 * 30 * DAY), heldAppt.id])

  const dr = await dryRun()
  chk('🔒 customer_notes_review סופר לקוחה תחת hold (report-only אינו מוחרג)',
    dr.customer_notes_review.total_eligible >= 1, `total=${dr.customer_notes_review.total_eligible}`)
  chk('🔒 inactive_customers_with_appointments סופר לקוחה תחת hold',
    dr.inactive_customers_with_appointments.total_eligible >= 1,
    `total=${dr.inactive_customers_with_appointments.total_eligible}`)
}

// ════════════════════════════════════════════════════════════════════════════
section('report-only — אינו מבצע mutation')

{
  const before = await all(`select id, notes from public.appointments order by id`)
  const beforeCustomers = await all(`select id, retention_hold from public.customers order by id`)

  await dryRun()
  await dryRun()

  const after = await all(`select id, notes from public.appointments order by id`)
  const afterCustomers = await all(`select id, retention_hold from public.customers order by id`)

  chk('🔒 קריאה כפולה ל-dry_run לא שינתה אף שורת appointments',
    JSON.stringify(before) === JSON.stringify(after))
  chk('🔒 קריאה כפולה ל-dry_run לא שינתה אף שורת customers',
    JSON.stringify(beforeCustomers) === JSON.stringify(afterCustomers))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 אין PII/UUID/notes/phone בתוצאות')

{
  const dr = await dryRun()
  const otpRes = await purgeOtpSessions()
  const notifRes = await purgeNotificationAttempts()
  const notesRes = await resetOldNotes()

  const allText = JSON.stringify({ dr, otpRes, notifRes, notesRes })

  chk('אין מספר טלפון בפורמט E.164 ישראלי בתוצאות',
    !/\+9725\d{8}/.test(allText), allText.length > 300 ? '' : allText)
  chk('אין UUID בתוצאות (אין reminder/notification/customer id חשוף)',
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(allText))
  chk('כל הערכים בתוצאות הם מספרים בלבד (ספירות)',
    Object.values(dr).every(v => Object.values(v).every(val => typeof val === 'number')))
}

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '⛔'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
