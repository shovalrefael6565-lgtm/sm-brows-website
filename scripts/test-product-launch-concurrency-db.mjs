/**
 * 🔴 נעילת ריצת השליחה (0039) — הבדיקה שמוכיחה שאי אפשר לשלוח פעמיים.
 *
 * ═══ מה נבדק כאן, ולמה זה קובץ נפרד ═══
 *
 * `test-product-launch-db.mjs` בודק את מעברי הסטטוס של שורה בודדת.
 * כאן נבדקת השכבה שמעליהם: **ריצה פעילה אחת לכל מוצר**, שנתפסת לפני
 * ששולפים נמען אחד.
 *
 * הפער שהקובץ הזה סוגר: המעבר האטומי `open → notified` מונע **סימון**
 * כפול, לא **שליחה** כפולה. שתי בקשות מקבילות היו קוראות את אותה שורה
 * כ-open, שתיהן שולחות SMS, ורק אז מתחרות על הסימון.
 *
 *   1.  שתי פתיחות מקבילות → רק אחת מצליחה.
 *   2.  ריצה פעילה חוסמת פתיחה נוספת.
 *   3.  delivery_unknown → needs_review.
 *   4.  mark_failed → needs_review.
 *   5.  needs_review חוסמת ריצה חדשה.
 *   6.  completed מאפשרת ריצה נוספת.
 *   7.  ריצה 'running' תקועה אינה משתחררת מעצמה.
 *   8.  הרשאות, RLS, ואי-נגיעה בדיוור.
 *
 * הרצה:  npm run test:product-launch-concurrency-db
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

const ADMIN = '11111111-1111-1111-1111-111111111111'
await db.query('insert into auth.users (id) values ($1)', [ADMIN])

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const count = async (t, where = 'true') =>
  Number((await one(`select count(*)::int c from ${t} where ${where}`)).c)
const errOf = async fn => { try { await fn(); return null } catch (e) { return e.message } }

const SLUG = 'micro-brow-pen'
const begin = (slug = SLUG) =>
  one('select * from public.begin_product_launch_run($1,$2)', [slug, ADMIN])
const finish = (id, { ok = 0, fail = 0, skip = 0, mark = 0, unknown = 0 } = {}) =>
  one('select * from public.finish_product_launch_run($1,$2,$3,$4,$5,$6)',
    [id, ok, fail, skip, mark, unknown])

// ─────────────────────────────────────────────────────────────────────────────
section('1 — שתי פתיחות מקבילות: רק אחת מצליחה')

/*
 * ⚠️ שתי טרנזקציות אמיתיות במקביל, ולא שתי קריאות סדרתיות: זו בדיוק
 * התבנית שבה הבאג המקורי התבטא.
 */
const results2 = await Promise.allSettled([begin(), begin()])
const fulfilled = results2.filter(r => r.status === 'fulfilled')
const rejected = results2.filter(r => r.status === 'rejected')
chk('🔴 בדיוק אחת הצליחה', fulfilled.length === 1, `הצליחו: ${fulfilled.length}`)
chk('🔴 השנייה נדחתה', rejected.length === 1)
chk('הדחייה היא LAUNCH_ALREADY_RUNNING',
  rejected.length === 1 && /LAUNCH_ALREADY_RUNNING/.test(String(rejected[0].reason?.message)))
chk('🔒 נוצרה שורת ריצה אחת בלבד', (await count('public.product_launch_runs')) === 1)

const run1 = fulfilled[0].value
chk('הריצה במצב running', run1.status === 'running')
chk('started_by נשמר', run1.started_by === ADMIN)
chk('finished_at ריק', run1.finished_at === null)

/*
 * ⚠️ PGlite מריץ על חיבור אחד, ולכן `Promise.allSettled` למעלה אינו מוכיח
 * מקביליות אמיתית — הוא מוכיח שהלוגיקה דוחה את השנייה.
 *
 * 🔴 מה שמוכיח את ההגנה **תחת מקביליות אמיתית** הוא האינדקס הייחודי
 * החלקי עצמו: הוא נבדק כאן ישירות, בעקיפת ה-RPC ובעקיפת כל בדיקת
 * `exists` שבתוכו. גם אם שתי טרנזקציות יעברו את הבדיקה בו-זמנית, השנייה
 * תיפול ב-INSERT.
 */
const rawDup = await errOf(() => db.query(
  `insert into public.product_launch_runs (product_slug, status) values ($1, 'running')`,
  [SLUG]))
chk('🔴 INSERT ישיר של ריצה פעילה שנייה נדחה ע"י האינדקס',
  rawDup !== null && /duplicate key|unique/i.test(rawDup))
chk('🔒 הדחייה מצביעה על האינדקס הנכון',
  rawDup !== null && /product_launch_runs_running_unique/.test(rawDup))

// ─────────────────────────────────────────────────────────────────────────────
section('2 — ריצה פעילה חוסמת פתיחה נוספת')

const blockedMsg = await errOf(() => begin())
chk('🔴 פתיחה שלישית נדחית', blockedMsg !== null && /LAUNCH_ALREADY_RUNNING/.test(blockedMsg))
chk('🔒 עדיין ריצה אחת', (await count('public.product_launch_runs')) === 1)
chk('מוצר אחר אינו חסום', Boolean((await begin('other-product')).id))

// ─────────────────────────────────────────────────────────────────────────────
section('3 — delivery_unknown → needs_review')

const finished1 = await finish(run1.id, { ok: 3, unknown: 1 })
chk('🔴 הריצה נסגרה כ-needs_review', finished1.status === 'needs_review')
chk('🔒 הקורא לא ביקש סטטוס — ה-RPC החליט', finished1.delivery_unknown_count === 1)
chk('finished_at נקבע', finished1.finished_at !== null)
chk('successful_count נשמר', finished1.successful_count === 3)

// ─────────────────────────────────────────────────────────────────────────────
section('4 — needs_review חוסמת ריצה חדשה')

const nrMsg = await errOf(() => begin())
chk('🔴 פתיחה נדחית', nrMsg !== null && /LAUNCH_NEEDS_REVIEW/.test(nrMsg))
chk('🔒 קוד שונה מריצה פעילה (שני מצבים, שתי סיבות)',
  nrMsg !== null && !/LAUNCH_ALREADY_RUNNING/.test(nrMsg))
chk('🔒 לא נוצרה ריצה חדשה',
  (await count('public.product_launch_runs', `product_slug='${SLUG}'`)) === 1)

// ─────────────────────────────────────────────────────────────────────────────
section('5 — mark_failed → needs_review')

const SLUG2 = 'second-product'
const r2 = await begin(SLUG2)
const f2 = await finish(r2.id, { ok: 5, mark: 1 })
chk('🔴 גם סימון שנכשל סוגר כ-needs_review', f2.status === 'needs_review')
chk('mark_failed_count נשמר', f2.mark_failed_count === 1)
chk('🔒 חוסם ריצה חדשה',
  /LAUNCH_NEEDS_REVIEW/.test(String(await errOf(() => begin(SLUG2)))))

// ─────────────────────────────────────────────────────────────────────────────
section('6 — completed מאפשרת ריצה נוספת')

const SLUG3 = 'third-product'
const r3 = await begin(SLUG3)
const f3 = await finish(r3.id, { ok: 2, fail: 3 })
chk('ריצה עם כשלים ודאיים בלבד נסגרת כ-completed', f3.status === 'completed')
chk('failed_count נשמר', f3.failed_count === 3)
chk('✓ ריצה נוספת מותרת (retry לשורות שנותרו open)',
  Boolean((await begin(SLUG3)).id))

// ─────────────────────────────────────────────────────────────────────────────
section('7 — ריצה תקועה אינה משתחררת מעצמה')

const SLUG4 = 'crashed-product'
const r4 = await begin(SLUG4)
// מדמים תהליך שמת: הריצה נשארת running, והזמן עובר.
await db.query(
  `update public.product_launch_runs
   set started_at = now() - interval '3 days' where id=$1`, [r4.id])
chk('🔴 ריצה בת 3 ימים עדיין running', (await one(
  'select status from public.product_launch_runs where id=$1', [r4.id])).status === 'running')
chk('🔴 היא עדיין חוסמת — אין auto-release',
  /LAUNCH_ALREADY_RUNNING/.test(String(await errOf(() => begin(SLUG4)))))
chk('🔒 אין פונקציה שמשחררת ריצות ישנות אוטומטית',
  (await one(`select count(*)::int c from pg_proc
              where prosrc like '%product_launch_runs%'
                and (prosrc like '%interval%' and proname like '%release%')`)).c === 0)

// ─────────────────────────────────────────────────────────────────────────────
section('8 — סגירה כפולה ושלמות')

chk('🔒 ריצה שנסגרה אינה נסגרת שוב',
  /RUN_NOT_RUNNING/.test(String(await errOf(() => finish(r3.id)))))
chk('🔒 מזהה ריצה שאינו קיים נדחה',
  /RUN_NOT_RUNNING/.test(String(await errOf(() =>
    finish('00000000-0000-0000-0000-000000000000')))))
chk('🔒 CHECK: running בלי finished_at',
  (await errOf(() => db.query(
    `update public.product_launch_runs set finished_at=now() where id=$1`, [r4.id]))) !== null)

// ─────────────────────────────────────────────────────────────────────────────
section('9 — הרשאות ו-RLS')

const SIGS = [
  'public.begin_product_launch_run(text, uuid)',
  'public.finish_product_launch_run(uuid, integer, integer, integer, integer, integer)',
]
for (const sig of SIGS) {
  const short = sig.split('(')[0].replace('public.', '')
  for (const role of ['anon', 'authenticated']) {
    chk(`🔒 ל-${role} אין EXECUTE על ${short}`,
      (await one('select has_function_privilege($1,$2,$3) h', [role, sig, 'EXECUTE'])).h === false)
  }
  chk(`ל-service_role יש EXECUTE על ${short}`,
    (await one('select has_function_privilege($1,$2,$3) h', ['service_role', sig, 'EXECUTE'])).h === true)
}
for (const role of ['anon', 'authenticated']) {
  for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    chk(`🔒 ל-${role} אין ${priv} על product_launch_runs`,
      (await one('select has_table_privilege($1,$2,$3) h',
        [role, 'public.product_launch_runs', priv])).h === false)
  }
}
chk('RLS דלוק', (await one(
  `select relrowsecurity r from pg_class where oid='public.product_launch_runs'::regclass`)).r === true)
chk('אפס policies', (await one(
  `select count(*)::int c from pg_policies
   where schemaname='public' and tablename='product_launch_runs'`)).c === 0)
chk('אפס טריגרים', (await one(
  `select count(*)::int c from pg_trigger
   where tgrelid='public.product_launch_runs'::regclass and not tgisinternal`)).c === 0)
chk('האינדקס הייחודי החלקי קיים', (await one(
  `select count(*)::int c from pg_indexes
   where indexname='product_launch_runs_running_unique'`)).c === 1)

// ─────────────────────────────────────────────────────────────────────────────
section('10 — 🔒 אין נגיעה בדיוור, בקמפיינים ובלקוחות')

chk('customers ריקה', (await count('public.customers')) === 0)
chk('sms_campaigns ריקה', (await count('public.sms_campaigns')) === 0)
chk('appointments ריקה', (await count('public.appointments')) === 0)
chk('🔒 אף פונקציית ריצה אינה מזכירה דיוור/לקוחות', (await one(
  `select count(*)::int c from pg_proc
   where proname in ('begin_product_launch_run','finish_product_launch_run')
     and (prosrc like '%marketing_consent%' or prosrc like '%marketing_opted_out_at%'
       or prosrc like '%sms_campaigns%' or prosrc like '%link_or_create_customer%')`)).c === 0)

// ─────────────────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
