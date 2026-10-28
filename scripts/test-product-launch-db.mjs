/**
 * בדיקות 0039 (ניהול ההרשמות + סימון "נשלחה הודעה") מול Postgres אמיתי
 * (PGlite). כל המיגרציות רצות מאפס על מסד זמני בזיכרון — אין חיבור
 * ל-Supabase האמיתי ואין סיכון לנתוני פרודקשן. אין כאן SMS.
 *
 * המיקוד הוא בהבטחה שאי אפשר לאמת בדיעבד: ש-`notified` מתאר הודעה
 * שבאמת יצאה.
 *
 *   1.  open ⇄ closed ידנית.
 *   2.  🔴 'notified' נדחה בסימון ידני.
 *   3.  🔒 הסימון עובר רק מ-'open', ורק פעם אחת.
 *   4.  שורה שנשלחה אינה חוזרת ל-'open'.
 *   5.  closed אינה מקבלת הודעה.
 *   6.  ה-CHECK של notified_at ↔ status.
 *   7.  הרשאות שתי הפונקציות.
 *   8.  🔒 אין נגיעה בלקוחות, בדיוור ובקמפיינים.
 *
 * הרצה:  npm run test:product-launch-db
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
chk('0039 ברשימה', migrations.includes('0039_product_interest_admin.sql'))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const count = async (t, where = 'true') =>
  Number((await one(`select count(*)::int c from ${t} where ${where}`)).c)
const errOf = async fn => { try { await fn(); return null } catch (e) { return e.message } }

let ipSeq = 0
const signup = async (phone, slug = 'micro-brow-pen') =>
  one(
    `select * from public.create_product_interest($1,$2,null,'product_page',$3::inet,10,'1.3',true)`,
    [slug, phone, `198.51.100.${++ipSeq}`],
  )
const rowOf = id => one('select * from public.product_interest_requests where id=$1', [id])
const setStatus = (id, s) =>
  one('select * from public.set_product_interest_status($1,$2)', [id, s])
const markNotified = id =>
  one('select * from public.mark_product_interest_notified($1)', [id])

// ─────────────────────────────────────────────────────────────────────────────
section('1 — open ⇄ closed ידנית')

const a = await signup('+972501111111')
chk('נוצרה במצב open', (await rowOf(a.id)).status === 'open')

await setStatus(a.id, 'closed')
chk('open → closed', (await rowOf(a.id)).status === 'closed')
await setStatus(a.id, 'open')
chk('closed → open', (await rowOf(a.id)).status === 'open')
chk('updated_at התעדכן', (await rowOf(a.id)).updated_at !== null)

for (const bad of ['pending', 'sent', '', 'OPEN']) {
  const m = await errOf(() => setStatus(a.id, bad))
  chk(`סטטוס לא חוקי נדחה: ${JSON.stringify(bad)}`, m !== null && /BAD_STATUS/.test(m))
}

// ─────────────────────────────────────────────────────────────────────────────
section("2 — 🔴 'notified' נדחה בסימון ידני")

const manualMsg = await errOf(() => setStatus(a.id, 'notified'))
chk('נדחה', manualMsg !== null)
chk('🔴 עם קוד ייעודי ולא "סטטוס לא תקין"',
  manualMsg !== null && /NOTIFIED_IS_NOT_MANUAL/.test(manualMsg))
chk('🔒 הסטטוס לא השתנה', (await rowOf(a.id)).status === 'open')
chk('🔒 notified_at נשאר null', (await rowOf(a.id)).notified_at === null)

// ─────────────────────────────────────────────────────────────────────────────
section('3 — 🔒 הסימון עובר רק מ-open, ורק פעם אחת')

const marked = await markNotified(a.id)
chk('open → notified', marked.id === a.id && marked.status === 'notified')
chk('notified_at נקבע', (await rowOf(a.id)).notified_at !== null)

const second = await markNotified(a.id)
chk('🔒 קריאה שנייה אינה מחזירה שורה (אין שליחה כפולה)',
  second === undefined || second.id === null)
const notifiedAtAfter = (await rowOf(a.id)).notified_at
chk('🔒 notified_at לא נדרס', notifiedAtAfter !== null)

// ─────────────────────────────────────────────────────────────────────────────
section('4 — שורה שנשלחה אינה חוזרת ל-open')

const reopenMsg = await errOf(() => setStatus(a.id, 'open'))
chk('🔒 notified → open נדחה', reopenMsg !== null && /NOT_FOUND_OR_LOCKED/.test(reopenMsg))
chk('🔒 הסטטוס נשאר notified', (await rowOf(a.id)).status === 'notified')
await setStatus(a.id, 'closed')
chk('notified → closed כן מותר (סגירה לתיעוד)', (await rowOf(a.id)).status === 'closed')

// ─────────────────────────────────────────────────────────────────────────────
section('5 — closed אינה מקבלת הודעה')

const b = await signup('+972502222222')
await setStatus(b.id, 'closed')
const closedMark = await markNotified(b.id)
chk('🔒 closed → notified אינו קורה', closedMark === undefined || closedMark.id === null)
chk('🔒 נשארה closed', (await rowOf(b.id)).status === 'closed')
chk('🔒 notified_at נשאר null', (await rowOf(b.id)).notified_at === null)

// ─────────────────────────────────────────────────────────────────────────────
section('6 — CHECK של notified_at ↔ status')

const c = await signup('+972503333333')
chk('🔒 אי אפשר notified בלי notified_at',
  (await errOf(() => db.query(
    `update public.product_interest_requests set status='notified' where id=$1`, [c.id]))) !== null)
chk('🔒 אי אפשר notified_at בלי status=notified',
  (await errOf(() => db.query(
    `update public.product_interest_requests set notified_at=now() where id=$1`, [c.id]))) !== null)

// ─────────────────────────────────────────────────────────────────────────────
section('7 — הרשאות')

const SIGS = [
  'public.set_product_interest_status(uuid, text)',
  'public.mark_product_interest_notified(uuid)',
]
for (const sig of SIGS) {
  for (const role of ['anon', 'authenticated']) {
    chk(`🔒 ל-${role} אין EXECUTE על ${sig.split('(')[0].replace('public.', '')}`,
      (await one('select has_function_privilege($1,$2,$3) h', [role, sig, 'EXECUTE'])).h === false)
  }
  chk(`ל-service_role יש EXECUTE על ${sig.split('(')[0].replace('public.', '')}`,
    (await one('select has_function_privilege($1,$2,$3) h', ['service_role', sig, 'EXECUTE'])).h === true)
}

// ─────────────────────────────────────────────────────────────────────────────
section('8 — 🔒 אין נגיעה בלקוחות, בדיוור ובקמפיינים')

chk('customers ריקה', (await count('public.customers')) === 0)
chk('sms_campaigns ריקה', (await count('public.sms_campaigns')) === 0)
chk('appointments ריקה', (await count('public.appointments')) === 0)
chk('waitlist_requests ריקה', (await count('public.waitlist_requests')) === 0)
chk('🔒 אף אחת מהפונקציות אינה מזכירה דיוור/לקוחות',
  (await one(`select count(*)::int c from pg_proc
              where proname in ('set_product_interest_status','mark_product_interest_notified')
                and (prosrc like '%marketing_consent%'
                  or prosrc like '%marketing_opted_out_at%'
                  or prosrc like '%sms_campaigns%'
                  or prosrc like '%link_or_create_customer%')`)).c === 0)
chk('אפס טריגרים נוספו',
  (await one(`select count(*)::int c from pg_trigger
              where tgrelid='public.product_interest_requests'::regclass
                and not tgisinternal`)).c === 0)

// ─────────────────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
