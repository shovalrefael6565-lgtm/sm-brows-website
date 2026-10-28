/**
 * Retention להרשמות לעדכון מוצר (0040) מול Postgres אמיתי (PGlite).
 * כל המיגרציות רצות מאפס על מסד זמני בזיכרון — אין חיבור ל-Supabase
 * האמיתי ואין סיכון לנתוני פרודקשן.
 *
 * ⚠️ כל הבדיקות מזריקות `p_now` במקום לחכות — התקופות הן 12 חודשים
 * ו-90 יום, ובדיקה שמסתמכת על השעון האמיתי לא הייתה יכולה לרוץ.
 *
 *   1.  closed_at: open→closed קובע, closed→open מאפס, notified נשמר.
 *   2.  ה-CHECK: כל סטטוס נושא בדיוק את החותמות שמתארות אותו.
 *   3.  גבולות התקופות — מתחת לסף לא נמחק, מעל נמחק.
 *   4.  dry-run סופר ואינו מוחק.
 *   5.  dry-run וה-execute מסכימים על אותן שורות.
 *   6.  🔒 המחיקה אינה נוגעת ב-product_launch_runs, ב-customers ובדיוור.
 *   7.  הרשאות.
 *
 * הרצה:  npm run test:product-interest-retention-db
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
  try { await db.exec(readFileSync(new URL(f, MIG_DIR), 'utf8')) }
  catch (e) { chk(`${f} רצה`, false, e.message); process.exit(1) }
}
chk(`כל ${migrations.length} המיגרציות רצו`)
chk('0040 ברשימה', migrations.includes('0040_product_interest_retention.sql'))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
const count = async (t, where = 'true') =>
  Number((await one(`select count(*)::int c from ${t} where ${where}`)).c)
const errOf = async fn => { try { await fn(); return null } catch (e) { return e.message } }

let seq = 0
const phone = () => `+97250${String(1000000 + (++seq)).slice(-7)}`
const SLUG = 'micro-brow-pen'

/** יוצרת שורה ישירות, כדי לשלוט בחותמות בלי לחכות. */
async function row({ status = 'open', createdAgo = '0 days', notifiedAgo = null, closedAgo = null }) {
  const r = await one(
    `insert into public.product_interest_requests
       (product_slug, phone_e164, source, status, privacy_notice_version,
        created_at, notified_at, closed_at)
     values ($1,$2,'product_page',$3,'1.3',
             now() - $4::interval,
             case when $5::text is null then null else now() - $5::interval end,
             case when $6::text is null then null else now() - $6::interval end)
     returning *`,
    [SLUG, phone(), status, createdAgo, notifiedAgo, closedAgo])
  return r
}

const dryRun = () => one(`select public.privacy_retention_product_interest_dry_run() d`)
const purge = () => one(`select public.privacy_retention_purge_product_interest() d`)

// ─────────────────────────────────────────────────────────────────────────────
section('1 — closed_at במעברי סטטוס')

const a = await row({})
chk('שורה חדשה: closed_at ריק', a.closed_at === null)

await one('select * from public.set_product_interest_status($1,$2)', [a.id, 'closed'])
let cur = await one('select * from public.product_interest_requests where id=$1', [a.id])
chk('open → closed קובע closed_at', cur.closed_at !== null)
chk('🔒 notified_at נשאר null', cur.notified_at === null)

await one('select * from public.set_product_interest_status($1,$2)', [a.id, 'open'])
cur = await one('select * from public.product_interest_requests where id=$1', [a.id])
chk('closed → open מאפס closed_at', cur.closed_at === null)

// notified → closed
await one('select * from public.mark_product_interest_notified($1)', [a.id])
const notifiedAt = (await one('select notified_at from public.product_interest_requests where id=$1', [a.id])).notified_at
await one('select * from public.set_product_interest_status($1,$2)', [a.id, 'closed'])
cur = await one('select * from public.product_interest_requests where id=$1', [a.id])
chk('notified → closed קובע closed_at', cur.closed_at !== null)
chk('🔴 notified → closed **שומר** את notified_at',
  cur.notified_at !== null && String(cur.notified_at) === String(notifiedAt))

// ─────────────────────────────────────────────────────────────────────────────
section('2 — ה-CHECK של שלוש החותמות')

chk('🔒 open עם closed_at נדחה',
  (await errOf(() => row({ status: 'open', closedAgo: '1 days' }))) !== null)
chk('🔒 open עם notified_at נדחה',
  (await errOf(() => row({ status: 'open', notifiedAgo: '1 days' }))) !== null)
chk('🔒 notified עם closed_at נדחה',
  (await errOf(() => row({ status: 'notified', notifiedAgo: '1 days', closedAgo: '1 days' }))) !== null)
chk('🔒 notified בלי notified_at נדחה',
  (await errOf(() => row({ status: 'notified' }))) !== null)
chk('🔒 closed בלי closed_at נדחה',
  (await errOf(() => row({ status: 'closed' }))) !== null)
chk('✓ closed עם notified_at **וגם** closed_at מותר',
  (await errOf(() => row({ status: 'closed', notifiedAgo: '10 days', closedAgo: '5 days' }))) === null)
chk('✓ closed עם closed_at בלבד מותר',
  (await errOf(() => row({ status: 'closed', closedAgo: '5 days' }))) === null)

// ─────────────────────────────────────────────────────────────────────────────
section('3 — גבולות התקופות')

await db.query('delete from public.product_interest_requests')

const keepOpen     = await row({ status: 'open',     createdAgo: '11 months' })
const dropOpen     = await row({ status: 'open',     createdAgo: '13 months' })
const keepNotified = await row({ status: 'notified', createdAgo: '6 months', notifiedAgo: '89 days' })
const dropNotified = await row({ status: 'notified', createdAgo: '6 months', notifiedAgo: '91 days' })
const keepClosed   = await row({ status: 'closed',   createdAgo: '6 months', closedAgo: '89 days' })
const dropClosed   = await row({ status: 'closed',   createdAgo: '6 months', closedAgo: '91 days' })

chk('נוצרו 6 שורות', (await count('public.product_interest_requests')) === 6)

const dry = (await dryRun()).d
chk('dry-run: open — שורה אחת כשירה', dry.product_interest_open.total_eligible === 1)
chk('dry-run: notified — שורה אחת כשירה', dry.product_interest_notified.total_eligible === 1)
chk('dry-run: closed — שורה אחת כשירה', dry.product_interest_closed.total_eligible === 1)

// ─────────────────────────────────────────────────────────────────────────────
section('4 — 🔒 dry-run אינו מוחק')

chk('🔒 עדיין 6 שורות אחרי dry-run', (await count('public.product_interest_requests')) === 6)
await dryRun()
await dryRun()
chk('🔒 גם אחרי שלוש הרצות', (await count('public.product_interest_requests')) === 6)

// ─────────────────────────────────────────────────────────────────────────────
section('5 — execute מוחק בדיוק את הכשירות')

const res = (await purge()).d
chk('נמחקה open אחת', res.product_interest_open_deleted === 1)
chk('נמחקה notified אחת', res.product_interest_notified_deleted === 1)
chk('נמחקה closed אחת', res.product_interest_closed_deleted === 1)
chk('נותרו 3 שורות', (await count('public.product_interest_requests')) === 3)

const left = (await all('select id from public.product_interest_requests')).map(r => r.id)
chk('✓ open בן 11 חודשים נשאר', left.includes(keepOpen.id))
chk('✓ notified בן 89 יום נשאר', left.includes(keepNotified.id))
chk('✓ closed בן 89 יום נשאר', left.includes(keepClosed.id))
chk('🔒 open בן 13 חודשים נמחק', !left.includes(dropOpen.id))
chk('🔒 notified בן 91 יום נמחק', !left.includes(dropNotified.id))
chk('🔒 closed בן 91 יום נמחק', !left.includes(dropClosed.id))

const dryAfter = (await dryRun()).d
chk('dry-run אחרי המחיקה: אפס כשירות',
  dryAfter.product_interest_open.total_eligible === 0
  && dryAfter.product_interest_notified.total_eligible === 0
  && dryAfter.product_interest_closed.total_eligible === 0)
chk('הרצה חוזרת אינה מוחקת עוד (idempotent)',
  (await purge()).d.product_interest_open_deleted === 0
  && (await count('public.product_interest_requests')) === 3)

// ─────────────────────────────────────────────────────────────────────────────
section('6 — 🔒 מה שהמחיקה אינה נוגעת בו')

const ADMIN = '22222222-2222-2222-2222-222222222222'
await db.query('insert into auth.users (id) values ($1)', [ADMIN])
const run = await one('select * from public.begin_product_launch_run($1,$2)', ['old-product', ADMIN])
await db.query(
  `update public.product_launch_runs set started_at = now() - interval '5 years' where id=$1`,
  [run.id])
const runsBefore = await count('public.product_launch_runs')

await db.query(`insert into public.customers (id, phone_e164, full_name)
                values (gen_random_uuid(), '+972509999999', 'לקוחה קיימת')`)
const customersBefore = await count('public.customers')

// שורה כשירה נוספת, כדי שה-purge באמת ירוץ ויעשה עבודה
await row({ status: 'closed', createdAgo: '2 years', closedAgo: '1 year' })
await purge()

chk('🔒 product_launch_runs לא נמחקו (גם ריצה בת 5 שנים)',
  (await count('public.product_launch_runs')) === runsBefore)
chk('🔒 customers לא נגעה', (await count('public.customers')) === customersBefore)
chk('🔒 appointments ריקה', (await count('public.appointments')) === 0)
chk('🔒 waitlist_requests ריקה', (await count('public.waitlist_requests')) === 0)
chk('🔒 sms_campaigns ריקה', (await count('public.sms_campaigns')) === 0)
chk('🔒 marketing_consent של הלקוחה הקיימת לא השתנה',
  (await one(`select marketing_consent m from public.customers limit 1`)).m === false)

chk('🔒 ה-purge אינה מזכירה טבלה אחרת', (await one(
  `select count(*)::int c from pg_proc
   where proname='privacy_retention_purge_product_interest'
     and (prosrc like '%product_launch_runs%' or prosrc like '%customers%'
       or prosrc like '%marketing_consent%' or prosrc like '%sms_campaigns%'
       or prosrc like '%appointments%' or prosrc like '%waitlist_requests%')`)).c === 0)
chk('🔒 ה-dry-run אינו מכיל DML', (await one(
  `select count(*)::int c from pg_proc
   where proname='privacy_retention_product_interest_dry_run'
     and (prosrc ~* '\\mdelete\\M' or prosrc ~* '\\mupdate\\M' or prosrc ~* '\\minsert\\M')`)).c === 0)

// ─────────────────────────────────────────────────────────────────────────────
section('7 — הרשאות')

const SIGS = [
  'public.privacy_retention_product_interest_dry_run(timestamptz, integer)',
  'public.privacy_retention_purge_product_interest(timestamptz, integer)',
]
for (const sig of SIGS) {
  const short = sig.split('(')[0].replace('public.privacy_retention_', '')
  for (const role of ['anon', 'authenticated']) {
    chk(`🔒 ל-${role} אין EXECUTE על ${short}`,
      (await one('select has_function_privilege($1,$2,$3) h', [role, sig, 'EXECUTE'])).h === false)
  }
  chk(`ל-service_role יש EXECUTE על ${short}`,
    (await one('select has_function_privilege($1,$2,$3) h', ['service_role', sig, 'EXECUTE'])).h === true)
}

section('8 — ולידציית פרמטרים (דפוס 0032)')
for (const [label, sql] of [
  ['batch_limit = 0', `select public.privacy_retention_purge_product_interest(now(), 0)`],
  ['batch_limit = 99999', `select public.privacy_retention_purge_product_interest(now(), 99999)`],
  ['p_now = null', `select public.privacy_retention_purge_product_interest(null, 100)`],
]) {
  chk(`🔒 נדחה: ${label}`, (await errOf(() => db.query(sql))) !== null)
}

// ─────────────────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
