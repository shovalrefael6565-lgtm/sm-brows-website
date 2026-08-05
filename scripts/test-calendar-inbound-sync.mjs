/**
 * בדיקת שלב 8 מול Postgres אמיתי (PGlite), בדפוס של test-migration.mjs,
 * test-pending-expiration.mjs ו-test-reschedule-cancel.mjs: מריצה 0001→0008
 * ובודקת את מה ש-0008 מבטיחה.
 *
 * המיקוד כאן הוא בשלושה דברים שרק Postgres יכול להוכיח:
 *   1. הטרנזקציה ששומרת שינויים ומקדמת את ה-cursor היא באמת אחת — הטוקן
 *      לא מתקדם לפני שהשינויים נשמרו, ולא בעמוד אמצעי.
 *   2. ה-transitions של ה-state machines נאכפים ב-DB ולא בקוד, כולל
 *      דחיית ערכי enum פסולים ובעלות על lease.
 *   3. ההזזה והביטול מ-Google הם אטומיים, כותבים היסטוריה פעם אחת בדיוק,
 *      ואינם נוגעים במה שאסור להם.
 *
 * מה *לא* נבדק כאן: Google Calendar עצמו (אין רשת) — הלוגיקה שמולו נבדקת
 * ב-test-calendar-sync-core.mjs, והמחזור המלא ב-test-calendar-inbound-sync-live.mjs.
 *
 * הרצה:  npm run test:calendar-inbound-sync
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'fs'

const migration = name =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')

const MIGRATIONS = [
  '0001_customer_accounts.sql',
  '0002_pending_expiration_enum_values.sql',
  '0003_pending_expiration.sql',
  '0004_appointment_approval.sql',
  '0005_customer_reschedule_cancel.sql',
  '0006_restrict_sensitive_rpcs.sql',
  '0007_reapply_rpc_permissions.sql',
  '0008_google_calendar_inbound_sync.sql',
]

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

const q = async (sql, params = []) => (await db.query(sql, params)).rows
/** מריצה ומחזירה את הודעת השגיאה, או null אם הצליחה */
const errOf = async (sql, params = []) => {
  try { await db.query(sql, params); return null } catch (e) { return e.message }
}

section('הרצת המיגרציות')
for (const name of MIGRATIONS) {
  try {
    await db.exec(migration(name))
    chk(`${name.slice(0, 4)} רצה במלואה ללא שגיאה`)
  } catch (e) {
    chk(`${name.slice(0, 4)} רצה במלואה ללא שגיאה`, false, e.message)
    process.exit(1)
  }
}

// ============================================================================
section('הסכמה של 0008')
// ============================================================================

const tables = (await q(
  `select table_name from information_schema.tables where table_schema='public'
   and table_name in ('calendar_sync_state','calendar_change_queue','calendar_sync_issues')`
)).map(r => r.table_name).sort()
chk('שלוש הטבלאות החדשות נוצרו', tables.length === 3, tables.join(', '))

const rls = await q(
  `select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace
   and relname in ('calendar_sync_state','calendar_change_queue','calendar_sync_issues')`
)
chk('RLS מופעל על שלושתן', rls.length === 3 && rls.every(r => r.relrowsecurity))

const policies = await q(
  `select count(*)::int c from pg_policies where schemaname='public'
   and tablename in ('calendar_sync_state','calendar_change_queue','calendar_sync_issues')`
)
chk('אין אף policy — service_role בלבד, כמו otp_attempts', policies[0].c === 0)

const singleton = await q(`select count(*)::int c from calendar_sync_state`)
chk('calendar_sync_state מכילה שורה אחת בדיוק', singleton[0].c === 1)

const dupSingleton = await errOf(`insert into calendar_sync_state (id) values (true)`)
chk('לא ניתן ליצור שורת state שנייה', dupSingleton !== null)

const srcCol = await q(
  `select is_nullable from information_schema.columns
   where table_name='appointment_history' and column_name='source'`
)
chk('appointment_history.source נוספה כ-nullable', srcCol.length === 1 && srcCol[0].is_nullable === 'YES')

const idx = await q(
  `select indexname from pg_indexes where tablename='appointments' and indexname='appointments_google_event_idx'`
)
chk('אינדקס appointments_google_event_idx נוצר', idx.length === 1)

const statusEnum = (await q(
  `select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid
   where t.typname='appointment_status' order by e.enumsortorder`
)).map(r => r.enumlabel)
chk('appointment_status נשאר 8 ערכים ולא הוסף אף אחד', statusEnum.length === 8, statusEnum.join(','))
chk('rescheduled ו-expired הם ערכי status קיימים',
  statusEnum.includes('rescheduled') && statusEnum.includes('expired'))

// ============================================================================
section('lease של ריצת סנכרון')
// ============================================================================

const OWNER_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const OWNER_B = 'bbbbbbbb-0000-0000-0000-000000000002'
const FP_A = 'fingerprint-calendar-a'
const FP_B = 'fingerprint-calendar-b'

let plan = (await q(`select claim_calendar_sync_run($1,300,$2) r`, [OWNER_A, FP_A]))[0].r
chk('ריצה ראשונה מתוכננת כ-full sync', plan.mode === 'full' && plan.resumed === false)
chk('החלפת יומן אינה מדווחת בריצה הראשונה', plan.calendar_reset === false)

const locked = await errOf(`select claim_calendar_sync_run($1,300,$2)`, [OWNER_B, FP_A])
chk('ריצה מקבילה שנייה נחסמת — רק אחת מקבלת lease', locked?.includes('SYNC_RUN_LOCKED'))

// ============================================================================
section('שמירת עמוד + קידום cursor (טרנזקציה אחת)')
// ============================================================================

const APPT_1 = '10000000-0000-4000-8000-000000000001'
const change = (id, version, extra = {}) => ({
  google_event_id: id,
  event_version: version,
  ownership: 'extended_properties',
  event_shape: 'timed_single',
  appointment_id: APPT_1,
  event_status: 'confirmed',
  event_start: '2028-06-06T08:00:00Z',
  event_end: '2028-06-06T08:20:00Z',
  event_updated: '2028-01-01T00:00:00Z',
  ...extra,
})

let rec = (await q(
  `select record_calendar_changes($1,$2::jsonb,'PAGE-2',null) r`,
  [OWNER_A, JSON.stringify([change('ev1', 'etag-1'), change('ev2', 'etag-2')])],
))[0].r
chk('עמוד אמצעי: שני שינויים נשמרו', rec.inserted === 2)

let state = (await q(`select * from calendar_sync_state`))[0]
chk('עמוד אמצעי: page_token התקדם', state.page_token === 'PAGE-2')
chk('⚠️ עמוד אמצעי: sync_token *לא* התקדם', state.sync_token === null)
chk('עמוד אמצעי: sync_mode נשמר', state.sync_mode === 'full')

const dup = (await q(
  `select record_calendar_changes($1,$2::jsonb,'PAGE-3',null) r`,
  [OWNER_A, JSON.stringify([change('ev1', 'etag-1')])],
))[0].r
chk('אותה גרסת אירוע אינה נשמרת פעמיים', dup.inserted === 0 && dup.duplicate === 1)

const wrongOwner = await errOf(
  `select record_calendar_changes($1,'[]'::jsonb,'X',null)`, [OWNER_B])
chk('בעלים שאינו מחזיק ב-lease אינו יכול לקדם cursor', wrongOwner?.includes('LEASE_LOST'))

const bothCursors = await errOf(
  `select record_calendar_changes($1,'[]'::jsonb,'A','B')`, [OWNER_A])
chk('אסור לשלוח גם pageToken וגם syncToken', bothCursors?.includes('AMBIGUOUS_CURSOR'))

const noCursor = await errOf(
  `select record_calendar_changes($1,'[]'::jsonb,null,null)`, [OWNER_A])
chk('חייב להגיע אחד משניהם', noCursor?.includes('MISSING_CURSOR'))

// ── העמוד האחרון ────────────────────────────────────────────────────────────
rec = (await q(
  `select record_calendar_changes($1,$2::jsonb,null,'SYNC-TOKEN-1') r`,
  [OWNER_A, JSON.stringify([change('ev3', 'etag-3')])],
))[0].r
chk('העמוד האחרון מדווח completed', rec.completed === true)

state = (await q(`select * from calendar_sync_state`))[0]
chk('⚠️ רק בעמוד האחרון sync_token נשמר', state.sync_token === 'SYNC-TOKEN-1')
chk('העמוד האחרון מנקה page_token', state.page_token === null)
chk('העמוד האחרון מנקה sync_mode ו-base_sync_token',
  state.sync_mode === null && state.base_sync_token === null)
chk('last_full_sync_at נרשם בסיום full sync', state.last_full_sync_at !== null)
chk('last_incremental_sync_at לא נרשם ב-full sync', state.last_incremental_sync_at === null)

await q(`select finish_calendar_sync_run($1,'success',null,'{"eventsRead":3}'::jsonb)`, [OWNER_A])

// ============================================================================
section('recovery: resume אחרי קטיעה')
// ============================================================================

plan = (await q(`select claim_calendar_sync_run($1,300,$2) r`, [OWNER_A, FP_A]))[0].r
chk('ריצה עם sync_token קיים מתוכננת כ-incremental', plan.mode === 'incremental')
chk('⚠️ base_sync_token נכתב כבר ב-claim — קריסה מיד אחריו לא תאבד את הסדרה',
  plan.base_sync_token === 'SYNC-TOKEN-1')
chk('ריצה טרייה מתחילה מעמוד ראשון', plan.page_token === null && plan.resumed === false)

// עמוד אמצעי ואז "קריסה" — פשוט לא ממשיכים
await q(`select record_calendar_changes($1,$2::jsonb,'INC-PAGE-2',null) r`,
  [OWNER_A, JSON.stringify([change('ev4', 'etag-4')])])
await q(`update calendar_sync_state set lease_started_at = now() - interval '10 minutes'`)

plan = (await q(`select claim_calendar_sync_run($1,300,$2) r`, [OWNER_B, FP_A]))[0].r
chk('lease שפג ניתן לתפיסה מחדש ע"י ריצה אחרת', plan.resumed === true)
chk('⚠️ ה-resume ממשיך מהעמוד השמור ולא מעמוד ראשון', plan.page_token === 'INC-PAGE-2')
chk('⚠️ ה-resume נושא את אותו base_sync_token של הסדרה',
  plan.base_sync_token === 'SYNC-TOKEN-1' && plan.mode === 'incremental')

rec = (await q(`select record_calendar_changes($1,$2::jsonb,null,'SYNC-TOKEN-2') r`,
  [OWNER_B, JSON.stringify([change('ev5', 'etag-5')])]))[0].r
state = (await q(`select * from calendar_sync_state`))[0]
chk('סיום ה-resume שומר את הטוקן החדש', state.sync_token === 'SYNC-TOKEN-2')
chk('last_incremental_sync_at נרשם בסיום incremental', state.last_incremental_sync_at !== null)

await q(`select finish_calendar_sync_run($1,'success',null,'{}'::jsonb)`, [OWNER_B])

// ============================================================================
section('איפוס cursor: 410 מול pageToken פסול')
// ============================================================================

plan = (await q(`select claim_calendar_sync_run($1,300,$2) r`, [OWNER_A, FP_A]))[0].r
await q(`select record_calendar_changes($1,'[]'::jsonb,'SOME-PAGE',null)`, [OWNER_A])

// pageToken פסול בלבד — הסדרה מתחילה מחדש מהעמוד הראשון
const partial = (await q(`select reset_calendar_sync_cursor($1,false,'pageToken invalid') r`, [OWNER_A]))[0].r
state = (await q(`select * from calendar_sync_state`))[0]
chk('איפוס חלקי מנקה רק את page_token', state.page_token === null)
chk('⚠️ איפוס חלקי *שומר* את base_sync_token — לא קופצים ל-full sync',
  state.base_sync_token === 'SYNC-TOKEN-2' && partial.mode === 'incremental')
chk('איפוס חלקי אינו מגדיל token_reset_count', state.token_reset_count === 0)

// 410 — הטוקן עצמו פסול
const full = (await q(`select reset_calendar_sync_cursor($1,true,'410 fullSyncRequired') r`, [OWNER_A]))[0].r
state = (await q(`select * from calendar_sync_state`))[0]
chk('⚠️ 410 מנקה את שלושת שדות ה-cursor',
  state.sync_token === null && state.base_sync_token === null && state.page_token === null)
chk('410 מעביר ל-full sync', full.mode === 'full')
chk('410 מגדיל token_reset_count', state.token_reset_count === 1)

const noBase = await errOf(`select reset_calendar_sync_cursor($1,false,'x')`, [OWNER_A])
chk('איפוס חלקי בלי base_sync_token נדחה', noBase?.includes('NO_BASE_TOKEN'))

// ── כשל אינו מאפס cursor ────────────────────────────────────────────────────
await q(`select record_calendar_changes($1,'[]'::jsonb,'KEEP-ME',null)`, [OWNER_A])
await q(`select finish_calendar_sync_run($1,'failed','429 rate limited','{}'::jsonb)`, [OWNER_A])
state = (await q(`select * from calendar_sync_state`))[0]
chk('⚠️ ריצה שנכשלה משאירה את page_token — הבאה תמשיך מאותה נקודה',
  state.page_token === 'KEEP-ME')
chk('ריצה שנכשלה משחררת את ה-lease', state.lease_owner === null)
chk('ריצה שנכשלה שומרת הודעה מסוננת', state.last_run_error === '429 rate limited')

const badRunStatus = await errOf(`select finish_calendar_sync_run($1,'running',null,null)`, [OWNER_A])
chk("finish עם 'running' נדחה", badRunStatus?.includes('BAD_RUN_STATUS'))

const badEnum = await errOf(`select finish_calendar_sync_run($1,'bogus',null,null)`, [OWNER_A])
chk('ערך enum שאינו קיים נדחה ע"י Postgres עצמו', badEnum !== null)

// ============================================================================
section('קשירה ליומן')
// ============================================================================

await q(`update calendar_sync_state set sync_token='TOKEN-CAL-A', page_token=null,
         base_sync_token=null, sync_mode=null, lease_owner=null, lease_started_at=null`)
plan = (await q(`select claim_calendar_sync_run($1,300,$2) r`, [OWNER_A, FP_B]))[0].r
state = (await q(`select * from calendar_sync_state`))[0]
chk('⚠️ החלפת יומן מאפסת את הטוקן — הישן לעולם לא נשלח ליומן החדש',
  state.sync_token === null && plan.mode === 'full')
chk('החלפת יומן מדווחת ל-caller', plan.calendar_reset === true)
chk('החלפת יומן נספרת', state.calendar_changed_count === 1)
chk('טביעת האצבע החדשה נשמרה', state.calendar_fingerprint === FP_B)
await q(`select finish_calendar_sync_run($1,'success',null,'{}'::jsonb)`, [OWNER_A])

// ============================================================================
section('state machine של פריט בתור')
// ============================================================================

await db.exec(`delete from calendar_sync_issues; delete from calendar_change_queue;`)
await q(`update calendar_sync_state set lease_owner=$1, lease_started_at=now()`, [OWNER_A])
await q(`select record_calendar_changes($1,$2::jsonb,null,'T') r`,
  [OWNER_A, JSON.stringify([change('q1', 'v1'), change('q2', 'v2'), change('q3', 'v3')])])

let item = (await q(`select claim_calendar_change($1,5,120) r`, [OWNER_A]))[0].r
chk('claim מעביר pending → processing', item.status === 'processing')
chk('claim מגדיל attempt_count', item.attempt_count === 1)
chk('claim רושם את בעל ה-lease', item.lease_owner === OWNER_A)

const notOwner = await errOf(
  `select finish_calendar_change($1,$2,'processed','echo',null)`, [item.id, OWNER_B])
chk('⚠️ רק בעל ה-lease רשאי לסגור פריט', notOwner?.includes('NOT_LEASE_OWNER'))

const badQueueStatus = await errOf(
  `select finish_calendar_change($1,$2,'pending','echo',null)`, [item.id, OWNER_A])
chk("סגירה ל-'pending' נדחית", badQueueStatus?.includes('BAD_QUEUE_STATUS'))

const badResult = await errOf(
  `select finish_calendar_change($1,$2,'processed','not_a_real_result',null)`, [item.id, OWNER_A])
chk('result שאינו ב-enum נדחה ע"י Postgres', badResult !== null)

await q(`select finish_calendar_change($1,$2,'processed','echo',null)`, [item.id, OWNER_A])
let row = (await q(`select * from calendar_change_queue where id=$1`, [item.id]))[0]
chk('פריט שנסגר מקבל processed_at', row.status === 'processed' && row.processed_at !== null)

const reclaim = await q(`select id from calendar_change_queue where status='processed'`)
const claimed2 = (await q(`select claim_calendar_change($1,5,120) r`, [OWNER_A]))[0].r
chk('⚠️ processed לעולם אינו נתפס שוב', claimed2.id !== reclaim[0].id)

const retryProcessed = await errOf(`select retry_calendar_change($1)`, [reclaim[0].id])
chk('⚠️ processed אינו ניתן ל-retry ידני', retryProcessed?.includes('NOT_RETRYABLE'))

// failed → retry ידני
await q(`select finish_calendar_change($1,$2,'failed',null,'boom')`, [claimed2.id, OWNER_A])
await q(`update calendar_change_queue set attempt_count=99 where id=$1`, [claimed2.id])
const exhausted = (await q(`select claim_calendar_change($1,5,120) r`, [OWNER_A]))[0].r
chk('פריט שמיצה ניסיונות אינו נתפס אוטומטית', exhausted.id !== claimed2.id)
await q(`select finish_calendar_change($1,$2,'ignored','echo',null)`, [exhausted.id, OWNER_A])

await q(`select retry_calendar_change($1)`, [claimed2.id])
row = (await q(`select * from calendar_change_queue where id=$1`, [claimed2.id]))[0]
chk('retry ידני מחזיר failed → pending ומאפס את המונה',
  row.status === 'pending' && row.attempt_count === 0 && row.last_error === null)

const reclaimed = (await q(`select claim_calendar_change($1,5,120) r`, [OWNER_A]))[0].r
chk('אחרי retry ידני הפריט נתפס שוב', reclaimed.id === claimed2.id)

// lease שפג
await q(`update calendar_change_queue set lease_started_at = now() - interval '30 minutes'
         where id=$1`, [claimed2.id])
const afterExpiry = (await q(`select claim_calendar_change($1,5,120) r`, [OWNER_B]))[0].r
chk('lease שפג על פריט ניתן לתפיסה מחדש', afterExpiry.id === claimed2.id)
await q(`select finish_calendar_change($1,$2,'ignored','echo',null)`, [claimed2.id, OWNER_B])

const nothing = await errOf(`select claim_calendar_change($1,5,120)`, [OWNER_A])
chk('תור ריק מחזיר NOTHING_TO_CLAIM', nothing?.includes('NOTHING_TO_CLAIM'))

// ============================================================================
section('dedup של תקלות')
// ============================================================================

const qid = (await q(`select id from calendar_change_queue order by id limit 1`))[0].id

for (let i = 0; i < 3; i++) {
  await q(`select record_calendar_sync_issue($1,'conflict_slot_taken','open','ev',null,null,null,$2)`,
    [qid, `ניסיון ${i}`])
}
let issues = await q(`select * from calendar_sync_issues where queue_id=$1`, [qid])
chk('⚠️ שלושה ניסיונות על אותו פריט יוצרים תקלה אחת בלבד', issues.length === 1)
chk('הפירוט מתעדכן לניסיון האחרון', issues[0].detail === 'ניסיון 2')
chk('תקלה פתוחה אינה מקבלת resolved_at', issues[0].resolved_at === null)

await q(`select record_calendar_sync_issue($1,'conflict_slot_taken','resolved','ev',null,null,null,'הוחזר')`, [qid])
issues = await q(`select * from calendar_sync_issues where queue_id=$1`, [qid])
const firstResolvedAt = issues[0].resolved_at
chk('מעבר open→resolved רושם resolved_at', firstResolvedAt !== null)

await q(`select record_calendar_sync_issue($1,'conflict_slot_taken','resolved','ev',null,null,null,'שוב')`, [qid])
issues = await q(`select * from calendar_sync_issues where queue_id=$1`, [qid])
chk('resolved_at נכתב פעם אחת בלבד',
  issues[0].resolved_at.getTime() === firstResolvedAt.getTime())

await q(`select record_calendar_sync_issue($1,'duplicate_event','open','ev',null,null,null,'סוג אחר')`, [qid])
issues = await q(`select * from calendar_sync_issues where queue_id=$1`, [qid])
chk('סוג תקלה אחר על אותו פריט הוא שורה נפרדת', issues.length === 2)

const qid2 = (await q(`select id from calendar_change_queue order by id desc limit 1`))[0].id
await q(`select record_calendar_sync_issue($1,'conflict_slot_taken','open','ev',null,null,null,'גרסה חדשה')`, [qid2])
const total = await q(`select count(*)::int c from calendar_sync_issues where kind='conflict_slot_taken'`)
chk('⚠️ גרסת אירוע חדשה (פריט חדש) יכולה לפתוח תקלה חדשה', total[0].c === 2)

// ============================================================================
section('הזזה שהגיעה מ-Google')
// ============================================================================

const CUST = '11111111-1111-1111-1111-111111111111'
const CUST2 = '22222222-2222-2222-2222-222222222222'
await db.exec(`insert into auth.users values ('${CUST}'), ('${CUST2}');`)
await db.exec(`
  insert into customers (id, phone_e164, full_name) values
    ('${CUST}', '+972541234567', 'לקוחה א'),
    ('${CUST2}', '+972549876543', 'לקוחה ב');
`)

let seq = 0
async function mkAppt(opts = {}) {
  const {
    startsAt = `2028-07-0${(seq % 9) + 1}T09:00:00Z`,
    status = 'confirmed',
    duration = 20,
    customer = CUST,
    eventId = null,
  } = opts
  seq++
  const r = await q(
    `insert into appointments (customer_id, service_key, variants, price_total, starts_at,
        duration_min, status, google_event_id, calendar_sync_status, calendar_sync_operation,
        calendar_synced_at)
     values ($1,'natural','{}',150,$2,$3,$4::appointment_status,$5,
             'synced'::calendar_sync_status,'upsert'::calendar_sync_operation,now())
     returning *`,
    [customer, startsAt, duration, status, eventId],
  )
  return r[0]
}

const a1 = await mkAppt({ startsAt: '2028-07-01T09:00:00Z', eventId: 'gev-a1' })
const NEW_START = '2028-07-01T12:00:00Z'

let res = (await q(`select apply_google_reschedule($1,'gev-a1',$2,true,null) r`, [a1.id, NEW_START]))[0].r
chk('הזזה תקינה מדווחת applied', res.outcome === 'applied')

let after = (await q(`select * from appointments where id=$1`, [a1.id]))[0]
chk('starts_at התעדכן', after.starts_at.toISOString() === new Date(NEW_START).toISOString())
chk('⚠️ ends_at חושב מ-duration_min ולא מ-Google',
  after.ends_at.getTime() - after.starts_at.getTime() === 20 * 60 * 1000)
chk('הסטטוס נשאר confirmed', after.status === 'confirmed')
chk('⚠️ reschedule_count אינו גדל — זו אינה הזזה עצמית של הלקוחה',
  after.reschedule_count === 0)
chk('original_starts_at נשמר', after.original_starts_at.toISOString() === new Date('2028-07-01T09:00:00Z').toISOString())
chk('duration_min, מחיר וטיפול לא השתנו',
  after.duration_min === 20 && after.price_total === 150 && after.service_key === 'natural')
chk('calendar_matches=true → הסנכרון נשאר synced', after.calendar_sync_status === 'synced')

let hist = await q(`select * from appointment_history where appointment_id=$1 and action='rescheduled'`, [a1.id])
chk('נכתבה שורת היסטוריה אחת בדיוק', hist.length === 1)
chk('ההיסטוריה מסומנת actor=system', hist[0].actor === 'system')
chk('⚠️ אין actor_id — Google אינו מוכיח מי גרר את האירוע', hist[0].actor_id === null)
chk("ההיסטוריה מסומנת source='google_calendar'", hist[0].source === 'google_calendar')
chk('ההיסטוריה שומרת את שני המועדים',
  hist[0].from_starts_at !== null && hist[0].to_starts_at !== null)
chk('ההיסטוריה confirmed→confirmed',
  hist[0].from_status === 'confirmed' && hist[0].to_status === 'confirmed')

// echo
res = (await q(`select apply_google_reschedule($1,'gev-a1',$2,true,null) r`, [a1.id, NEW_START]))[0].r
chk('⚠️ אותו מועד = echo', res.outcome === 'echo')
hist = await q(`select count(*)::int c from appointment_history where appointment_id=$1 and action='rescheduled'`, [a1.id])
chk('echo אינו כותב היסטוריה שנייה', hist[0].c === 1)
after = (await q(`select * from appointments where id=$1`, [a1.id]))[0]
chk('echo אינו מגדיל reschedule_count', after.reschedule_count === 0)

// original_starts_at לא נדרס
await q(`select apply_google_reschedule($1,'gev-a1','2028-07-01T14:00:00Z',true,null)`, [a1.id])
after = (await q(`select * from appointments where id=$1`, [a1.id]))[0]
chk('⚠️ original_starts_at נשמר פעם אחת ואינו נדרס',
  after.original_starts_at.toISOString() === new Date('2028-07-01T09:00:00Z').toISOString())

// calendar_matches=false
const a2 = await mkAppt({ startsAt: '2028-07-02T09:00:00Z', eventId: 'gev-a2' })
await q(`select apply_google_reschedule($1,'gev-a2','2028-07-02T15:00:00Z',false,null)`, [a2.id])
after = (await q(`select * from appointments where id=$1`, [a2.id]))[0]
chk('⚠️ end שגוי ביומן → התור נשאר pending כדי שה-upsert יתקן אותו',
  after.calendar_sync_status === 'pending' && after.calendar_sync_operation === 'upsert')

// חסימות
const a3 = await mkAppt({ startsAt: '2028-07-03T09:00:00Z', status: 'cancelled_by_customer' })
const notConfirmed = await errOf(`select apply_google_reschedule($1,'x','2028-07-03T15:00:00Z',true,null)`, [a3.id])
chk('תור שאינו confirmed אינו זז', notConfirmed?.includes('NOT_CONFIRMED'))

const a4 = await mkAppt({ startsAt: '2028-07-04T09:00:00Z' })
const inPast = await errOf(`select apply_google_reschedule($1,'x','2020-01-01T09:00:00Z',true,null)`, [a4.id])
chk('⚠️ הזזה לעבר נחסמת', inPast?.includes('NEW_IN_PAST'))

const a5 = await mkAppt({ startsAt: '2028-07-05T09:00:00Z' })
await q(`update appointments set calendar_sync_status='syncing', calendar_sync_started_at=now()
         where id=$1`, [a5.id])
const syncing = await errOf(`select apply_google_reschedule($1,'x','2028-07-05T15:00:00Z',true,null)`, [a5.id])
chk('lease סנכרון פעיל חוסם הזזה מקבילה', syncing?.includes('SYNC_IN_PROGRESS'))

// ── התנגשות: EXCLUDE constraint ─────────────────────────────────────────────
const busy = await mkAppt({ startsAt: '2028-08-01T10:00:00Z', customer: CUST2 })
const mover = await mkAppt({ startsAt: '2028-08-01T14:00:00Z', eventId: 'gev-mover' })
const clash = await errOf(
  `select apply_google_reschedule($1,'gev-mover','2028-08-01T10:00:00Z',true,null)`, [mover.id])
chk('⚠️ ה-EXCLUDE constraint הוא שחוסם סלוט תפוס', clash?.includes('conflicting key') || clash?.includes('exclusion'))

after = (await q(`select * from appointments where id=$1`, [mover.id]))[0]
chk('אחרי התנגשות התור נשאר במועדו', after.starts_at.toISOString() === new Date('2028-08-01T14:00:00Z').toISOString())
const other = (await q(`select * from appointments where id=$1`, [busy.id]))[0]
chk('אחרי התנגשות התור האחר לא נגע', other.starts_at.toISOString() === new Date('2028-08-01T10:00:00Z').toISOString())
const clashHist = await q(`select count(*)::int c from appointment_history where appointment_id=$1`, [mover.id])
chk('אחרי התנגשות לא נכתבה היסטוריה של הצלחה', clashHist[0].c === 0)

// ============================================================================
section('תיקון end בלבד')
// ============================================================================

const a6 = await mkAppt({ startsAt: '2028-09-01T09:00:00Z', eventId: 'gev-a6' })
const beforeMark = (await q(`select * from appointments where id=$1`, [a6.id]))[0]
chk('התור מתחיל במצב synced (המצב שבו retry היה חוזר idempotent)',
  beforeMark.calendar_sync_status === 'synced')

await q(`select mark_calendar_correction_required($1,'gev-a6')`, [a6.id])
after = (await q(`select * from appointments where id=$1`, [a6.id]))[0]
chk('⚠️ הסימון מחזיר synced → pending כדי שה-patch באמת יתבצע',
  after.calendar_sync_status === 'pending' && after.calendar_sync_operation === 'upsert')
chk('הסימון אינו נוגע ב-starts_at', after.starts_at.getTime() === beforeMark.starts_at.getTime())
chk('הסימון אינו נוגע ב-reschedule_count וב-original_starts_at',
  after.reschedule_count === 0 && after.original_starts_at === null)
chk('הסימון אינו נוגע בסטטוס', after.status === 'confirmed')

const markHist = await q(`select count(*)::int c from appointment_history where appointment_id=$1`, [a6.id])
chk('⚠️ תיקון end אינו כותב היסטוריה של הזזה', markHist[0].c === 0)

await q(`select mark_calendar_correction_required($1,'gev-a6')`, [a6.id])
const markHist2 = await q(`select count(*)::int c from appointment_history where appointment_id=$1`, [a6.id])
chk('סימון חוזר idempotent — עדיין אין היסטוריה', markHist2[0].c === 0)

const notCanonical = await errOf(`select mark_calendar_correction_required($1,'some-other-event')`, [a6.id])
chk('⚠️ אירוע שאינו הקנוני אינו מקבל תיקון אוטומטי', notCanonical?.includes('NOT_CANONICAL'))

const a7 = await mkAppt({ startsAt: '2028-09-02T09:00:00Z', status: 'completed', eventId: 'gev-a7' })
const completedMark = await errOf(`select mark_calendar_correction_required($1,'gev-a7')`, [a7.id])
chk('תור שהושלם אינו מקבל תיקון end', completedMark?.includes('NOT_CONFIRMED'))

// ============================================================================
section('ביטול שהגיע ממחיקה ב-Google')
// ============================================================================

const c1 = await mkAppt({ startsAt: '2028-10-01T09:00:00Z', eventId: 'gev-c1' })
res = (await q(`select apply_google_cancellation($1,'gev-c1',null) r`, [c1.id]))[0].r
chk('מחיקת אירוע של תור confirmed מדווחת applied', res.outcome === 'applied')

after = (await q(`select * from appointments where id=$1`, [c1.id]))[0]
chk('הסטטוס הפך ל-cancelled_by_business', after.status === 'cancelled_by_business')
chk('התור לא נמחק מהטבלה', after.id === c1.id)
chk('⚠️ הסנכרון מסומן synced — האירוע כבר נמחק, אין outbound delete מיותר',
  after.calendar_sync_status === 'synced' && after.calendar_sync_operation === 'delete')

hist = await q(`select * from appointment_history where appointment_id=$1 and action='cancelled'`, [c1.id])
chk('נכתבה היסטוריית ביטול אחת בדיוק', hist.length === 1)
chk('הביטול confirmed→cancelled_by_business',
  hist[0].from_status === 'confirmed' && hist[0].to_status === 'cancelled_by_business')
chk("הביטול מסומן system + source='google_calendar'",
  hist[0].actor === 'system' && hist[0].actor_id === null && hist[0].source === 'google_calendar')
chk('הביטול שומר את המועד שהיה', hist[0].from_starts_at !== null)

// הסלוט השתחרר
const reuse = await errOf(
  `insert into appointments (customer_id, service_key, variants, starts_at, duration_min, status)
   values ($1,'natural','{}','2028-10-01T09:00:00Z',20,'confirmed')`, [CUST2])
chk('⚠️ הסלוט השתחרר — ניתן לקבוע תור אחר באותה שעה', reuse === null)

// echo של מחיקה
res = (await q(`select apply_google_cancellation($1,'gev-c1',null) r`, [c1.id]))[0].r
chk('מחיקה חוזרת = already_cancelled', res.outcome === 'already_cancelled')
hist = await q(`select count(*)::int c from appointment_history where appointment_id=$1 and action='cancelled'`, [c1.id])
chk('⚠️ מחיקה חוזרת אינה כותבת היסטוריה שנייה', hist[0].c === 1)

// כל ארבעת הסטטוסים ה"כבר סופיים"
for (const st of ['cancelled_by_customer', 'cancelled_by_business', 'expired', 'rescheduled']) {
  const a = await mkAppt({ startsAt: `2028-11-0${seq % 9 + 1}T09:00:00Z`, status: st })
  const r = (await q(`select apply_google_cancellation($1,'x',null) r`, [a.id]))[0].r
  const h = await q(`select count(*)::int c from appointment_history where appointment_id=$1`, [a.id])
  chk(`מחיקה על תור ${st} → already_cancelled, אפס כתיבות`,
    r.outcome === 'already_cancelled' && h[0].c === 0)
}

// completed / no_show
for (const st of ['completed', 'no_show']) {
  const a = await mkAppt({ startsAt: `2028-12-0${seq % 9 + 1}T09:00:00Z`, status: st })
  const r = (await q(`select apply_google_cancellation($1,'x',null) r`, [a.id]))[0].r
  const post = (await q(`select status from appointments where id=$1`, [a.id]))[0]
  const h = await q(`select count(*)::int c from appointment_history where appointment_id=$1`, [a.id])
  chk(`⚠️ מחיקת אירוע של תור ${st} אינה משנה את ההיסטוריה העסקית`,
    r.outcome === 'terminal' && post.status === st && h[0].c === 0)
}

// pending
const p1 = await mkAppt({ startsAt: '2029-01-05T09:00:00Z', status: 'pending' })
res = (await q(`select apply_google_cancellation($1,'x',null) r`, [p1.id]))[0].r
after = (await q(`select status from appointments where id=$1`, [p1.id]))[0]
chk('מחיקה על בקשה שלא אושרה → not_confirmed, אפס כתיבות',
  res.outcome === 'not_confirmed' && after.status === 'pending')

const missing = await errOf(`select apply_google_cancellation($1,'x',null)`,
  ['99999999-9999-4999-8999-999999999999'])
chk('תור שאינו קיים מדווח NOT_FOUND ואינו נוצר', missing?.includes('NOT_FOUND'))
const created = await q(`select count(*)::int c from appointments where id=$1`,
  ['99999999-9999-4999-8999-999999999999'])
chk('⚠️ לא נוצר appointment מאירוע יומן', created[0].c === 0)

// ============================================================================
console.log(`\n${'═'.repeat(60)}`)
const failed = results.filter(r => !r).length
if (failed === 0) {
  console.log(`✓ כל ${results.length} הבדיקות עברו`)
} else {
  console.log(`✗ ${failed} מתוך ${results.length} הבדיקות נכשלו`)
  process.exit(1)
}
