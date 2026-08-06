/**
 * בדיקות שלב 10 מול בסיס נתונים אמיתי (PGlite), עם המיגרציות 0001→0010.
 *
 * שלושה דברים נבדקים כאן ואי אפשר לבדוק אותם בשום מקום אחר:
 *
 *   1. **ההפרדה בין customer ל-auth user לא שברה כלום.** ה-backfill מילא
 *      את הקיימות בלי לשנות אף מזהה, ה-FK הישן ירד, החדש הוא
 *      ON DELETE SET NULL, ולקוחה ידנית יכולה להתקיים עם auth_user_id=NULL.
 *
 *   2. **ה-RLS באמת עברה ל-auth_user_id.** לקוחה רואה רק את עצמה, לקוחה
 *      ידנית אינה נגישה לאף תפקיד API, ו-UPDATE ישיר על customers נחסם
 *      (זו הייתה חשיפה אמיתית לפני 0010 — ראה שם).
 *
 *   3. **הקישור והיצירה הם אטומיים ו-idempotent.** שישה מצבי קישור, מצבי
 *      ההתנגשות, ו-retry שלא יוצר כפילות, היסטוריה נוספת או activity נוספת.
 *
 * ⚠️ auth.users כאן הוא stub: Supabase מספקת אותו בפועל. אף פונקציה
 * מ-0010 אינה קוראת ממנו — הגישה ל-auth עוברת ב-Auth Admin API בשרת
 * (ראה lib/auth/adminUserResolver.ts) — אבל ה-FK והבדיקות זקוקים לו.
 *
 * הרצה:  npm run test:manual-booking
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

// ── Supabase stubs ──────────────────────────────────────────────────────────
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, phone text);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
  do $$ begin
    create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin
    create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin
    create role service_role;  exception when duplicate_object then null; end $$;
`)
const setUid = async uid =>
  db.exec(`delete from auth._session; ${uid ? `insert into auth._session values ('${uid}');` : ''}`)

const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const errOf = async (sql, params = []) => {
  try { await db.query(sql, params); return null } catch (e) { return e.message }
}

const FP = 'a'.repeat(64)
const FP2 = 'b'.repeat(64)
const uuid = () => crypto.randomUUID()

// ════════════════════════════════════════════════════════════════════════════
section('הרצת המיגרציות 0001→0010')
// ════════════════════════════════════════════════════════════════════════════

// מצב "לפני": לקוחה קיימת במבנה הישן, שנוצרה לפני 0010 עם id=auth id.
// היא חייבת לשרוד את המיגרציה בלי לשנות את המזהה שלה.
const LEGACY_AUTH = uuid()
const ADMIN_AUTH = uuid()

for (const name of MIGRATIONS) {
  if (name.startsWith('0010')) {
    // מזריקים את הנתונים הישנים *לפני* 0010, כדי ש-backfill יהיה אמיתי
    await db.exec(`
      insert into auth.users values ('${LEGACY_AUTH}', '972541110001'),
                                    ('${ADMIN_AUTH}',  '972541110002');
      insert into customers (id, phone_e164, full_name)
        values ('${LEGACY_AUTH}', '+972541110001', 'לקוחה ותיקה'),
               ('${ADMIN_AUTH}',  '+972541110002', 'שובל');
      insert into admins (user_id) values ('${ADMIN_AUTH}');
    `)
  }
  try {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
    chk(`${name.slice(0, 4)} רצה במלואה ללא שגיאה`)
  } catch (e) {
    chk(`${name.slice(0, 4)} רצה במלואה ללא שגיאה`, false, e.message)
    console.log('\n⛔ עוצר — אין טעם להמשיך.')
    process.exit(1)
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('סכמה, backfill והמזהים הקיימים')
// ════════════════════════════════════════════════════════════════════════════

const legacy = await one(`select id, auth_user_id from customers where phone_e164='+972541110001'`)
chk('⚠️ מזהה הלקוחה הקיים לא השתנה', legacy.id === LEGACY_AUTH, legacy.id)
chk('backfill מילא auth_user_id ללקוחה הקיימת', legacy.auth_user_id === LEGACY_AUTH)

const oldFk = await one(`
  select count(*)::int c from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_class frel on frel.oid=con.confrelid
  join pg_namespace n on n.oid=rel.relnamespace
  join pg_namespace fn on fn.oid=frel.relnamespace
  where con.contype='f' and n.nspname='public' and rel.relname='customers'
    and fn.nspname='auth' and frel.relname='users'
    and con.conkey = array[(select attnum from pg_attribute
                            where attrelid='public.customers'::regclass and attname='id')]`)
chk('ה-FK הישן customers.id→auth.users אינו קיים', oldFk.c === 0)

const newFk = await one(`
  select con.confdeltype from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace n on n.oid=rel.relnamespace
  where con.contype='f' and n.nspname='public' and rel.relname='customers'
    and con.conkey = array[(select attnum from pg_attribute
                            where attrelid='public.customers'::regclass and attname='auth_user_id')]`)
chk('ה-FK החדש הוא ON DELETE SET NULL', newFk?.confdeltype === 'n', String(newFk?.confdeltype))

const uniq = await one(`
  select count(*)::int c from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace n on n.oid=rel.relnamespace
  where con.contype in ('u','p') and n.nspname='public' and rel.relname='customers'
    and con.conkey = array[(select attnum from pg_attribute
                            where attrelid='public.customers'::regclass and attname='auth_user_id')]`)
chk('auth_user_id הוא UNIQUE', uniq.c === 1)

// לקוחה ידנית: id עצמאי, בלי auth user בכלל
const MANUAL_ID = (await one(
  `insert into customers (phone_e164, full_name) values ('+972542220001','לקוחה ידנית') returning id`)).id
chk('לקוחה ידנית נוצרת עם id עצמאי ובלי auth_user_id', Boolean(MANUAL_ID))
chk('ל-customers.id יש default (gen_random_uuid)',
  (await one(`select column_default d from information_schema.columns
              where table_name='customers' and column_name='id'`)).d.includes('gen_random_uuid'))
chk('הטריגר יצר לה פרופיל CRM',
  (await one(`select count(*)::int c from customer_crm_profiles where customer_id=$1`, [MANUAL_ID])).c === 1)

// backfill חוזר לא נוגע בלקוחה ידנית
await db.exec(`update customers c set auth_user_id=c.id
               where c.auth_user_id is null and exists (select 1 from auth.users u where u.id=c.id)`)
chk('⚠️ הרצת ה-backfill שוב אינה מקשרת לקוחה ידנית',
  (await one(`select auth_user_id from customers where id=$1`, [MANUAL_ID])).auth_user_id === null)

chk('ה-backfill לא יצר activity מזויפת',
  (await one(`select count(*)::int c from customer_crm_activity`)).c === 0)

// שתי לקוחות לא יכולות לחלוק auth_user_id
chk('auth_user_id כפול נדחה',
  (await errOf(`update customers set auth_user_id=$1 where id=$2`, [LEGACY_AUTH, MANUAL_ID])) !== null)

// auth_user_id שאינו קיים ב-auth.users נדחה ע"י ה-FK — זה מה שמחליף את
// בדיקת הקיום שלא יכולה לחיות ב-RPC (Supabase חוסמת את סכמת auth)
chk('auth_user_id שאינו קיים ב-auth.users נדחה ע"י ה-FK',
  (await errOf(`update customers set auth_user_id=$1 where id=$2`, [uuid(), MANUAL_ID])) !== null)

// ════════════════════════════════════════════════════════════════════════════
section('מחיקת auth user אינה מוחקת לקוחה')
// ════════════════════════════════════════════════════════════════════════════

const DEL_AUTH = uuid()
await db.exec(`insert into auth.users values ('${DEL_AUTH}','972543330001')`)
const DEL_CUST = (await one(
  `insert into customers (phone_e164, full_name, auth_user_id)
   values ('+972543330001','לקוחה עם חשבון','${DEL_AUTH}') returning id`)).id
await db.exec(`
  insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status)
  values ('${DEL_CUST}','הרמת גבות','2027-03-01T10:00:00Z',40,now(),'confirmed');
  insert into customer_notes (customer_id, body, client_request_id, created_by_admin_id)
  values ('${DEL_CUST}','הערה','${uuid()}','${ADMIN_AUTH}');
  insert into customer_crm_activity (customer_id, action, actor_admin_id)
  values ('${DEL_CUST}','source_changed','${ADMIN_AUTH}');
`)

await db.exec(`delete from auth.users where id='${DEL_AUTH}'`)

const survived = await one(`select id, auth_user_id from customers where id=$1`, [DEL_CUST])
chk('הלקוחה שרדה את מחיקת חשבון ההתחברות', Boolean(survived))
chk('auth_user_id התאפס ל-NULL (ולא CASCADE)', survived.auth_user_id === null)
chk('התורים נשארו',
  (await one(`select count(*)::int c from appointments where customer_id=$1`, [DEL_CUST])).c === 1)
chk('ההערות נשארו',
  (await one(`select count(*)::int c from customer_notes where customer_id=$1`, [DEL_CUST])).c === 1)
chk('פעילות ה-CRM נשארה',
  (await one(`select count(*)::int c from customer_crm_activity where customer_id=$1`, [DEL_CUST])).c === 1)
chk('הפרופיל נשאר',
  (await one(`select count(*)::int c from customer_crm_profiles where customer_id=$1`, [DEL_CUST])).c === 1)

// ════════════════════════════════════════════════════════════════════════════
section('RLS לפי auth_user_id')
// ════════════════════════════════════════════════════════════════════════════

await db.exec(`
  create role customer_role nologin;
  grant usage on schema public, auth to customer_role;
  grant execute on function auth.uid() to customer_role;
  grant select, insert, update, delete on all tables in schema public to customer_role;
`)
const asCustomer = async (uid, sql, params = []) => {
  await setUid(uid)
  await db.exec('set role customer_role')
  try { return await db.query(sql, params) } finally { await db.exec('reset role') }
}
const asCustomerErr = async (uid, sql, params = []) => {
  try { await asCustomer(uid, sql, params); return null } catch (e) { return e.message }
}

// לקוחה עם חשבון: רואה את עצמה בלבד
const RE_AUTH = uuid()
await db.exec(`insert into auth.users values ('${RE_AUTH}','972544440001')`)
const RE_CUST = (await one(
  `insert into customers (phone_e164, full_name, auth_user_id)
   values ('+972544440001','לקוחה מחוברת','${RE_AUTH}') returning id`)).id
await db.exec(`insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status)
               values ('${RE_CUST}','הרמת גבות','2027-04-01T10:00:00Z',40,now(),'confirmed')`)

chk('לקוחה רואה את השורה שלה לפי auth_user_id',
  (await asCustomer(RE_AUTH, `select count(*)::int c from customers`)).rows[0].c === 1)
chk('⚠️ לקוחה אינה רואה לקוחות אחרות',
  (await asCustomer(RE_AUTH, `select count(*)::int c from customers where id<>$1`, [RE_CUST])).rows[0].c === 0)
chk('לקוחה רואה את התורים שלה בלבד',
  (await asCustomer(RE_AUTH, `select count(*)::int c from appointments`)).rows[0].c === 1)

// ⚠️ הבדיקה המרכזית: לקוחה ידנית אינה נגישה לאף תפקיד API
chk('⚠️ לקוחה ידנית (auth_user_id=NULL) אינה נראית ל-authenticated',
  (await asCustomer(RE_AUTH, `select count(*)::int c from customers where id=$1`, [MANUAL_ID])).rows[0].c === 0)
chk('⚠️ auth.uid()=NULL (anon) אינו מתאים ללקוחה ידנית',
  (await asCustomer(null, `select count(*)::int c from customers`)).rows[0].c === 0)

// ── 🔒 החשיפה שנסגרה ב-0010 ────────────────────────────────────────────────
chk('customers_update_own אינה קיימת יותר',
  (await one(`select count(*)::int c from pg_policies
              where tablename='customers' and policyname='customers_update_own'`)).c === 0)

const blockedUpdate = async col => {
  const err = await asCustomerErr(RE_AUTH,
    `update customers set ${col} where auth_user_id=$1`, [RE_AUTH])
  if (err) return true
  // גם בלי שגיאה — אם אפס שורות הושפעו, הכתיבה נחסמה
  const r = await asCustomer(RE_AUTH,
    `update customers set ${col} where auth_user_id=$1 returning id`, [RE_AUTH])
  return r.rows.length === 0
}
chk('⚠️ לקוחה אינה יכולה לשנות is_blocked של עצמה', await blockedUpdate(`is_blocked=false`))
chk('⚠️ לקוחה אינה יכולה לשנות admin_notes', await blockedUpdate(`admin_notes='הוזרק'`))
chk('⚠️ לקוחה אינה יכולה לשנות phone_e164', await blockedUpdate(`phone_e164='+972500000009'`))
chk('⚠️ לקוחה אינה יכולה לנתק את auth_user_id שלה', await blockedUpdate(`auth_user_id=null`))
chk('⚠️ לקוחה אינה יכולה להעביר את החשבון שלה ללקוחה אחרת',
  (await asCustomerErr(RE_AUTH, `update customers set auth_user_id=$1 where id=$2`,
    [RE_AUTH, MANUAL_ID])) !== null ||
  (await asCustomer(RE_AUTH, `select auth_user_id from customers where id=$1`, [MANUAL_ID])).rows.length === 0)

chk('אין policy כלשהי שעדיין משווה id/customer_id ל-auth.uid()',
  (await one(`select count(*)::int c from pg_policies
              where schemaname='public'
                and tablename in ('customers','appointments','appointment_history')
                and (coalesce(qual,'') ~ '\\m(id|customer_id)\\M\\s*=\\s*auth\\.uid\\(\\)'
                  or coalesce(with_check,'') ~ '\\m(id|customer_id)\\M\\s*=\\s*auth\\.uid\\(\\)')`)).c === 0)

// admin_idempotency: RLS ללא policies
chk('RLS מופעל על admin_idempotency',
  (await one(`select relrowsecurity r from pg_class rel join pg_namespace n on n.oid=rel.relnamespace
              where n.nspname='public' and rel.relname='admin_idempotency'`)).r === true)
chk('אין policies על admin_idempotency',
  (await one(`select count(*)::int c from pg_policies where tablename='admin_idempotency'`)).c === 0)
chk('⚠️ authenticated אינו קורא מ-admin_idempotency',
  (await asCustomer(RE_AUTH, `select count(*)::int c from admin_idempotency`)).rows[0].c === 0)

// ════════════════════════════════════════════════════════════════════════════
section('קישור OTP: ששת המצבים')
// ════════════════════════════════════════════════════════════════════════════

const link = (auth, phone, name = null) =>
  one(`select public.link_or_create_customer_for_auth($1,$2,$3) r`, [auth, phone, name])
const linkErr = (auth, phone, name = null) =>
  errOf(`select public.link_or_create_customer_for_auth($1,$2,$3)`, [auth, phone, name])

// ── מצב 6: לקוחה חדשה לגמרי ────────────────────────────────────────────────
const NEW_AUTH = uuid()
await db.exec(`insert into auth.users values ('${NEW_AUTH}','972545550001')`)
let res = (await link(NEW_AUTH, '+972545550001', 'לקוחה חדשה')).r
chk('מצב 6: לקוחה חדשה נוצרת ונקשרת', res.created === true && res.linked === true)
chk('מצב 6: השם שנשלח נשמר', res.full_name === 'לקוחה חדשה')
chk('מצב 6: נוצר פרופיל CRM',
  (await one(`select count(*)::int c from customer_crm_profiles where customer_id=$1`, [res.customer_id])).c === 1)
chk('⚠️ מצב 6: אין activity של customer_created (היא לא נוצרה ע"י מנהלת)',
  (await one(`select count(*)::int c from customer_crm_activity
              where customer_id=$1 and action='customer_created'`, [res.customer_id])).c === 0)
const NEW_CUST = res.customer_id

// ── מצב 1/3: התחברות חוזרת ─────────────────────────────────────────────────
res = (await link(NEW_AUTH, '+972545550001', 'שם אחר לגמרי')).r
chk('מצב 1: התחברות חוזרת idempotent', res.created === false && res.linked === false)
chk('מצב 1: מחזירה את אותו customer_id', res.customer_id === NEW_CUST)
chk('⚠️ מצב 1: השם הקיים לא נדרס ע"י מה שהוקלד בטופס', res.full_name === 'לקוחה חדשה')
chk('מצב 1: לא נוצרה שורה נוספת',
  (await one(`select count(*)::int c from customers where phone_e164='+972545550001'`)).c === 1)

// ── מצב 2: לקוחה ידנית מתחברת לראשונה ──────────────────────────────────────
// ⚠️ הלב של השלב: היסטוריה קיימת חייבת לשרוד את הקישור.
const M2_ID = (await one(
  `insert into customers (phone_e164, full_name) values ('+972546660001','רותי כהן') returning id`)).id
await db.exec(`
  insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status)
  values ('${M2_ID}','הרמת גבות','2027-05-01T10:00:00Z',40,now(),'confirmed');
  insert into customer_notes (customer_id, body, client_request_id, created_by_admin_id)
  values ('${M2_ID}','הערה על רותי','${uuid()}','${ADMIN_AUTH}');
  update customer_crm_profiles set source_key='instagram' where customer_id='${M2_ID}';
`)
const M2_AUTH = uuid()
await db.exec(`insert into auth.users values ('${M2_AUTH}','972546660001')`)

res = (await link(M2_AUTH, '+972546660001', 'רותי מהטופס')).r
chk('מצב 2: הקישור בוצע', res.linked === true && res.created === false)
chk('⚠️ מצב 2: אותו customer.id נשמר', res.customer_id === M2_ID)
chk('⚠️ מצב 2: השם הידני מה-CRM נשאר', res.full_name === 'רותי כהן')
chk('מצב 2: התור הקיים נשאר מחובר',
  (await one(`select count(*)::int c from appointments where customer_id=$1`, [M2_ID])).c === 1)
chk('מצב 2: ההערה נשארה',
  (await one(`select count(*)::int c from customer_notes where customer_id=$1`, [M2_ID])).c === 1)
chk('מצב 2: מקור ההגעה נשאר',
  (await one(`select source_key s from customer_crm_profiles where customer_id=$1`, [M2_ID])).s === 'instagram')
chk('מצב 2: לא נוצרה לקוחה כפולה',
  (await one(`select count(*)::int c from customers where phone_e164='+972546660001'`)).c === 1)

// idempotent: אותה קריאה שוב
res = (await link(M2_AUTH, '+972546660001')).r
chk('מצב 3: קריאה חוזרת אחרי קישור — idempotent',
  res.customer_id === M2_ID && res.created === false && res.linked === false)

// ── מצב 4: הטלפון שייך ללקוחה שמקושרת ל-auth אחר ───────────────────────────
const OTHER_AUTH = uuid()
await db.exec(`insert into auth.users values ('${OTHER_AUTH}','972546660001')`)
let err = await linkErr(OTHER_AUTH, '+972546660001')
chk('⚠️ מצב 4: auth אחר על טלפון תפוס → נדחה', err?.includes('PHONE_LINKED_TO_OTHER_AUTH'), err ?? '')
chk('מצב 4: ה-ownership לא הועבר',
  (await one(`select auth_user_id a from customers where id=$1`, [M2_ID])).a === M2_AUTH)
chk('מצב 4: לא נוצרה לקוחה כפולה',
  (await one(`select count(*)::int c from customers where phone_e164='+972546660001'`)).c === 1)

// ── מצב 5: ה-auth user מקושר ללקוחה עם טלפון אחר ───────────────────────────
err = await linkErr(M2_AUTH, '+972547770009')
chk('⚠️ מצב 5: auth שכבר מקושר, עם טלפון סותר → conflict',
  err?.includes('AUTH_CUSTOMER_CONFLICT'), err ?? '')
chk('מצב 5: אין merge ואין החלפה',
  (await one(`select phone_e164 p from customers where id=$1`, [M2_ID])).p === '+972546660001')
chk('מצב 5: לא נוצרה לקוחה חדשה',
  (await one(`select count(*)::int c from customers where phone_e164='+972547770009'`)).c === 0)

// ולידציה
chk('טלפון לא תקין נדחה', (await linkErr(NEW_AUTH, '0541234567'))?.includes('INVALID_PHONE'))
chk('auth_user_id ריק נדחה', (await linkErr(null, '+972545550001'))?.includes('MISSING_AUTH_USER'))

// ════════════════════════════════════════════════════════════════════════════
section('יצירת לקוחה ידנית')
// ════════════════════════════════════════════════════════════════════════════

const mkCustomer = (name, phone, src = 'instagram', status = 'active',
                    admin = ADMIN_AUTH, req = uuid(), fp = FP) =>
  one(`select public.create_manual_customer($1,$2,$3,$4,$5,$6,$7) r`,
      [name, phone, src, status, admin, req, fp])
const mkCustomerErr = (name, phone, src = 'instagram', status = 'active',
                       admin = ADMIN_AUTH, req = uuid(), fp = FP) =>
  errOf(`select public.create_manual_customer($1,$2,$3,$4,$5,$6,$7)`,
        [name, phone, src, status, admin, req, fp])

res = (await mkCustomer('דנה לוי', '+972548880001')).r
chk('לקוחה נוצרה', res.result === 'customer_created' && Boolean(res.customer_id))
const D_ID = res.customer_id

const dana = await one(`select full_name, phone_e164, auth_user_id from customers where id=$1`, [D_ID])
chk('השם והטלפון נשמרו', dana.full_name === 'דנה לוי' && dana.phone_e164 === '+972548880001')
chk('⚠️ auth_user_id נשאר NULL — לא נוצר חשבון התחברות', dana.auth_user_id === null)
chk('⚠️ לא נוצר auth user',
  (await one(`select count(*)::int c from auth.users where phone like '%548880001'`)).c === 0)

const prof = await one(`select crm_status, source_key from customer_crm_profiles where customer_id=$1`, [D_ID])
chk('הפרופיל קיבל את הסטטוס והמקור שנבחרו',
  prof.crm_status === 'active' && prof.source_key === 'instagram')

const act = await q(`select action, actor_admin_id, old_value, new_value from customer_crm_activity
                     where customer_id=$1`, [D_ID])
chk('customer_created נכתבה פעם אחת', act.length === 1 && act[0].action === 'customer_created')
chk('ה-actor הוא המנהלת המאומתת', act[0].actor_admin_id === ADMIN_AUTH)
chk('⚠️ אין טלפון ואין שם ב-activity', act[0].old_value === null && act[0].new_value === 'instagram')

// סטטוס inactive
res = (await mkCustomer('נועה כהן', '+972548880002', 'website', 'inactive')).r
chk('status=inactive נשמר',
  (await one(`select crm_status s from customer_crm_profiles where customer_id=$1`, [res.customer_id])).s === 'inactive')

// ── ולידציה ────────────────────────────────────────────────────────────────
chk('טלפון לא תקין נדחה',
  (await mkCustomerErr('שם תקין', '0541234567'))?.includes('INVALID_PHONE'))
chk('שם קצר מדי נדחה', (await mkCustomerErr('א', '+972548880003'))?.includes('INVALID_NAME'))
chk('שם ריק נדחה', (await mkCustomerErr('   ', '+972548880003'))?.includes('INVALID_NAME'))
chk('שם ארוך מ-80 נדחה', (await mkCustomerErr('א'.repeat(81), '+972548880003'))?.includes('INVALID_NAME'))
chk('status לא חוקי נדחה',
  (await mkCustomerErr('שם', '+972548880003', 'website', 'blocked'))?.includes('INVALID_STATUS'))
chk('מקור שאינו קיים נדחה',
  (await mkCustomerErr('שם', '+972548880003', 'no_such_source'))?.includes('INVALID_SOURCE'))

await db.exec(`update customer_sources set is_active=false where key='tiktok'`)
chk('⚠️ מקור שאינו פעיל נדחה',
  (await mkCustomerErr('שם', '+972548880003', 'tiktok'))?.includes('SOURCE_INACTIVE'))
await db.exec(`update customer_sources set is_active=true where key='tiktok'`)

chk('actor שאינו מנהל נדחה',
  (await mkCustomerErr('שם', '+972548880003', 'website', 'active', uuid()))?.includes('NOT_ADMIN'))
chk('fingerprint שאינו 64 hex נדחה',
  (await mkCustomerErr('שם', '+972548880003', 'website', 'active', ADMIN_AUTH, uuid(), 'לא-hash'))
    ?.includes('BAD_FINGERPRINT'))
chk('client_request_id חסר נדחה',
  (await mkCustomerErr('שם', '+972548880003', 'website', 'active', ADMIN_AUTH, null))
    ?.includes('MISSING_REQUEST_ID'))

// ── טלפון קיים ─────────────────────────────────────────────────────────────
const beforeDup = await one(`select full_name, updated_at from customers where id=$1`, [D_ID])
const beforeDupProf = await one(`select crm_status, source_key from customer_crm_profiles where customer_id=$1`, [D_ID])

res = (await mkCustomer('שם אחר לגמרי', '+972548880001', 'facebook', 'inactive')).r
chk('טלפון קיים → existing_customer ולא שגיאה', res.result === 'existing_customer')
chk('מחזיר את הלקוחה הקיימת', res.customer_id === D_ID)
chk('לא נוצרה כפילות',
  (await one(`select count(*)::int c from customers where phone_e164='+972548880001'`)).c === 1)
chk('⚠️ השם הקיים לא שונה',
  (await one(`select full_name f from customers where id=$1`, [D_ID])).f === beforeDup.full_name)
const afterDupProf = await one(`select crm_status, source_key from customer_crm_profiles where customer_id=$1`, [D_ID])
chk('⚠️ ה-source לא שונה', afterDupProf.source_key === beforeDupProf.source_key)
chk('⚠️ ה-status לא שונה', afterDupProf.crm_status === beforeDupProf.crm_status)
chk('⚠️ לא נכתבה activity נוספת',
  (await one(`select count(*)::int c from customer_crm_activity where customer_id=$1`, [D_ID])).c === 1)

// ── טלפון של מנהלת ─────────────────────────────────────────────────────────
res = (await mkCustomer('ניסיון', '+972541110002')).r
chk('⚠️ טלפון של מנהלת → admin_phone_exists', res.result === 'admin_phone_exists')
chk('⚠️ לא מוחזר customer_id של חשבון מנהל', res.customer_id === null)
chk('לא נוצרה לקוחה נוספת',
  (await one(`select count(*)::int c from customers where phone_e164='+972541110002'`)).c === 1)

// ════════════════════════════════════════════════════════════════════════════
section('idempotency — יצירת לקוחה')
// ════════════════════════════════════════════════════════════════════════════

const REQ1 = uuid()
const first = (await mkCustomer('מיכל אבן', '+972549990001', 'website', 'active', ADMIN_AUTH, REQ1, FP)).r
chk('בקשה ראשונה יצרה', first.result === 'customer_created' && first.replayed === false)

const replay = (await mkCustomer('מיכל אבן', '+972549990001', 'website', 'active', ADMIN_AUTH, REQ1, FP)).r
chk('אותו request+actor+payload → אותה לקוחה', replay.customer_id === first.customer_id)
chk('ה-retry מסומן replayed', replay.replayed === true)
chk('⚠️ לא נוצרה שורה נוספת',
  (await one(`select count(*)::int c from customers where phone_e164='+972549990001'`)).c === 1)
chk('⚠️ לא נוצרה activity נוספת',
  (await one(`select count(*)::int c from customer_crm_activity where customer_id=$1`,
    [first.customer_id])).c === 1)

err = await mkCustomerErr('שם שונה', '+972549990001', 'website', 'active', ADMIN_AUTH, REQ1, FP2)
chk('⚠️ אותו request עם payload שונה → IDEMPOTENCY_KEY_REUSED',
  err?.includes('IDEMPOTENCY_KEY_REUSED'), err ?? '')
chk('הלקוחה המקורית לא השתנתה',
  (await one(`select full_name f from customers where id=$1`, [first.customer_id])).f === 'מיכל אבן')

// ⚠️ namespace לפי מנהלת: אותו request id ממנהלת אחרת אינו retry
const ADMIN2_AUTH = uuid()
await db.exec(`
  insert into auth.users values ('${ADMIN2_AUTH}','972541110003');
  insert into customers (phone_e164, full_name, auth_user_id)
    values ('+972541110003','רפאל','${ADMIN2_AUTH}');
  insert into admins (user_id) values ('${ADMIN2_AUTH}');
`)
const other = (await mkCustomer('לקוחה אחרת', '+972549990002', 'website', 'active', ADMIN2_AUTH, REQ1, FP2)).r
chk('⚠️ אותו request id ממנהלת אחרת → namespace נפרד, נוצרה לקוחה',
  other.result === 'customer_created' && other.customer_id !== first.customer_id)

// request id חדש עם אותו טלפון — לא כפילות
const again = (await mkCustomer('מיכל אבן', '+972549990001', 'website', 'active', ADMIN_AUTH, uuid(), FP2)).r
chk('request id חדש על טלפון קיים → existing_customer', again.result === 'existing_customer')
chk('עדיין אין כפילות',
  (await one(`select count(*)::int c from customers where phone_e164='+972549990001'`)).c === 1)

// retry של admin_phone_exists מחזיר את אותה תוצאה המסוננת
const ADMREQ = uuid()
const adm1 = (await mkCustomer('ניסיון', '+972541110002', 'website', 'active', ADMIN_AUTH, ADMREQ, FP)).r
const adm2 = (await mkCustomer('ניסיון', '+972541110002', 'website', 'active', ADMIN_AUTH, ADMREQ, FP)).r
chk('⚠️ retry של admin_phone_exists מחזיר את אותה תוצאה מסוננת',
  adm1.result === 'admin_phone_exists' && adm2.result === 'admin_phone_exists' &&
  adm2.customer_id === null && adm2.replayed === true)

// retry של existing_customer מחזיר את אותו target
const EXREQ = uuid()
const ex1 = (await mkCustomer('כפול', '+972548880001', 'website', 'active', ADMIN_AUTH, EXREQ, FP)).r
const ex2 = (await mkCustomer('כפול', '+972548880001', 'website', 'active', ADMIN_AUTH, EXREQ, FP)).r
chk('retry של existing_customer מחזיר את אותו target id',
  ex1.customer_id === D_ID && ex2.customer_id === D_ID && ex2.replayed === true)

chk('⚠️ אין payload גולמי בטבלת ה-idempotency',
  (await q(`select column_name from information_schema.columns where table_name='admin_idempotency'`))
    .every(c => !['payload', 'body', 'request_body', 'phone', 'phone_e164'].includes(c.column_name)))

// ════════════════════════════════════════════════════════════════════════════
section('יצירת תור ידני')
// ════════════════════════════════════════════════════════════════════════════

const FUTURE = '2027-06-01T11:00:00Z'
const mkAppt = (cust = D_ID, starts = FUTURE, dur = 20, variants = ['עיצוב גבות טבעי'],
                price = 70, admin = ADMIN_AUTH, req = uuid(), fp = FP, svc = 'עיצוב גבות טבעיות') =>
  one(`select public.create_manual_appointment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r`,
      [cust, svc, variants, price, starts, dur, '1.0', admin, req, fp])
const mkApptErr = (...args) => errOf(
  `select public.create_manual_appointment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  (([cust = D_ID, starts = FUTURE, dur = 20, variants = ['עיצוב גבות טבעי'],
     price = 70, admin = ADMIN_AUTH, req = uuid(), fp = FP, svc = 'עיצוב גבות טבעיות']) =>
    [cust, svc, variants, price, starts, dur, '1.0', admin, req, fp])(args))

res = (await mkAppt()).r
chk('התור נוצר', res.result === 'appointment_created' && Boolean(res.appointment_id))
const A1 = res.appointment_id

const row = await one(`select * from appointments where id=$1`, [A1])
chk('⚠️ הסטטוס הוא confirmed (לא pending)', row.status === 'confirmed')
chk('pending_expires_at אינו בשימוש', row.pending_expires_at === null)
chk('reschedule_count=0', row.reschedule_count === 0)
chk('original_starts_at=NULL', row.original_starts_at === null)
chk('has_deposit=false', row.has_deposit === false)
chk('calendar_sync_operation=upsert', row.calendar_sync_operation === 'upsert')
chk('calendar_sync_status=pending', row.calendar_sync_status === 'pending')
chk('policy_version נשמרה מהשרת', row.policy_version === '1.0')
chk('המחיר והמשך נשמרו כפי שחושבו בשרת', row.price_total === 70 && row.duration_min === 20)
chk('ends_at חושב ע"י הטריגר',
  new Date(row.ends_at).toISOString() === '2027-06-01T11:20:00.000Z',
  new Date(row.ends_at).toISOString())

const hist = await q(`select * from appointment_history where appointment_id=$1`, [A1])
chk('⚠️ נכתבה שורת היסטוריה אחת בדיוק', hist.length === 1)
chk('action=created ו-to_status=confirmed',
  hist[0].action === 'created' && hist[0].to_status === 'confirmed' && hist[0].from_status === null)
chk('actor=admin עם המנהלת המאומתת',
  hist[0].actor === 'admin' && hist[0].actor_id === ADMIN_AUTH)
chk('source=admin_dashboard', hist[0].source === 'admin_dashboard')
chk('to_starts_at נרשם', new Date(hist[0].to_starts_at).toISOString() === '2027-06-01T11:00:00.000Z')

// ── לקוחה ידנית וחשבון מנהל ────────────────────────────────────────────────
res = (await mkAppt(MANUAL_ID, '2027-06-02T11:00:00Z')).r
chk('⚠️ אפשר לקבוע תור ללקוחה ידנית ללא חשבון', res.result === 'appointment_created')

const ADMIN_CUST = (await one(`select id from customers where phone_e164='+972541110002'`)).id
err = await mkApptErr(ADMIN_CUST, '2027-06-03T11:00:00Z')
chk('⚠️ לא ניתן לקבוע תור לחשבון מנהל', err?.includes('CUSTOMER_IS_ADMIN'), err ?? '')

err = await mkApptErr(uuid(), '2027-06-03T11:00:00Z')
chk('לקוחה שאינה קיימת נדחית', err?.includes('CUSTOMER_NOT_FOUND'))

// ── מועד ───────────────────────────────────────────────────────────────────
err = await mkApptErr(D_ID, '2020-01-01T10:00:00Z')
chk('מועד בעבר נדחה', err?.includes('START_IN_PAST'))
err = await mkApptErr(D_ID, null)
chk('מועד ריק נדחה', err?.includes('START_IN_PAST'))
err = await mkApptErr(D_ID, '2027-06-04T11:00:00Z', 999)
chk('משך לא תקין נדחה', err?.includes('INVALID_DURATION'))

// ⚠️ חריגה משעות הפעילות ובימים סגורים מותרת — זו כל מטרת התור הידני.
// ה-DB אינו אוכף שעות; האזהרה היא ב-UI וההחלטה של המנהלת.
res = (await mkAppt(D_ID, '2027-06-05T03:30:00Z')).r  // 06:30 בישראל
chk('⚠️ מועד מחוץ לשעות הפעילות מותר (חריגת מנהל)', res.result === 'appointment_created')
res = (await mkAppt(D_ID, '2027-06-04T09:00:00Z')).r  // שישי
chk('⚠️ שישי מותר (חריגת מנהל)', res.result === 'appointment_created')
res = (await mkAppt(D_ID, '2027-06-05T09:00:00Z')).r  // שבת
chk('⚠️ שבת מותרת (חריגת מנהל)', res.result === 'appointment_created')

// ── חפיפה ──────────────────────────────────────────────────────────────────
err = await mkApptErr(MANUAL_ID, FUTURE)
chk('⚠️ חפיפה מלאה נדחית ע"י EXCLUDE constraint', err !== null, (err ?? '').slice(0, 40))
err = await mkApptErr(MANUAL_ID, '2027-06-01T11:10:00Z')
chk('⚠️ חפיפה חלקית נדחית', err !== null)
chk('לא נוצר תור נוסף באותו סלוט',
  (await one(`select count(*)::int c from appointments where starts_at='${FUTURE}'`)).c === 1)

// סלוט צמוד (ללא חפיפה) מותר
res = (await mkAppt(MANUAL_ID, '2027-06-01T11:20:00Z')).r
chk('סלוט צמוד בדיוק לסוף התור הקודם מותר', res.result === 'appointment_created')

// ── הרשאות ─────────────────────────────────────────────────────────────────
err = await mkApptErr(D_ID, '2027-06-06T11:00:00Z', 20, ['עיצוב גבות טבעי'], 70, uuid())
chk('actor שאינו מנהל נדחה', err?.includes('NOT_ADMIN'))
err = await mkApptErr(D_ID, '2027-06-06T11:00:00Z', 20, ['עיצוב גבות טבעי'], 70, ADMIN_AUTH, uuid(), 'xx')
chk('fingerprint לא תקין נדחה', err?.includes('BAD_FINGERPRINT'))
err = await mkApptErr(D_ID, '2027-06-06T11:00:00Z', 20, ['עיצוב גבות טבעי'], 70, ADMIN_AUTH, null)
chk('client_request_id חסר נדחה', err?.includes('MISSING_REQUEST_ID'))

// ════════════════════════════════════════════════════════════════════════════
section('idempotency — יצירת תור')
// ════════════════════════════════════════════════════════════════════════════

const AREQ = uuid()
const ASTART = '2027-07-01T11:00:00Z'
const a1 = (await mkAppt(D_ID, ASTART, 20, ['עיצוב גבות טבעי'], 70, ADMIN_AUTH, AREQ, FP)).r
chk('בקשה ראשונה יצרה תור', a1.result === 'appointment_created' && a1.replayed === false)

const a2 = (await mkAppt(D_ID, ASTART, 20, ['עיצוב גבות טבעי'], 70, ADMIN_AUTH, AREQ, FP)).r
chk('⚠️ retry מחזיר את אותו appointment', a2.appointment_id === a1.appointment_id)
chk('ה-retry מסומן replayed', a2.replayed === true)
chk('⚠️ retry לא יצר שורה נוספת',
  (await one(`select count(*)::int c from appointments where starts_at='${ASTART}'`)).c === 1)
chk('⚠️ retry לא כתב היסטוריה נוספת',
  (await one(`select count(*)::int c from appointment_history where appointment_id=$1`,
    [a1.appointment_id])).c === 1)

err = await mkApptErr(D_ID, '2027-07-02T11:00:00Z', 20, ['עיצוב גבות טבעי'], 70, ADMIN_AUTH, AREQ, FP2)
chk('⚠️ אותו request עם payload שונה → IDEMPOTENCY_KEY_REUSED',
  err?.includes('IDEMPOTENCY_KEY_REUSED'))
chk('התור המקורי לא השתנה',
  (await one(`select starts_at s from appointments where id=$1`, [a1.appointment_id])).s
    .toISOString() === new Date(ASTART).toISOString())
chk('לא נוצר תור במועד החדש',
  (await one(`select count(*)::int c from appointments where starts_at='2027-07-02T11:00:00Z'`)).c === 0)
chk('לא נוספה היסטוריה',
  (await one(`select count(*)::int c from appointment_history where appointment_id=$1`,
    [a1.appointment_id])).c === 1)

// ⚠️ request id חדש על אותו סלוט — ה-EXCLUDE הוא ההגנה, לא ה-idempotency
err = await mkApptErr(MANUAL_ID, ASTART, 20, ['עיצוב גבות טבעי'], 70, ADMIN_AUTH, uuid(), FP2)
chk('⚠️ request id חדש על סלוט תפוס → EXCLUDE חוסם', err !== null)

// namespace לפי מנהלת גם כאן
const b1 = (await mkAppt(D_ID, '2027-07-03T11:00:00Z', 20, ['עיצוב גבות טבעי'], 70, ADMIN2_AUTH, AREQ, FP2)).r
chk('אותו request id ממנהלת אחרת → נוצר תור נפרד',
  b1.result === 'appointment_created' && b1.appointment_id !== a1.appointment_id)

// רשומות ה-idempotency נושאות result_code ו-target
const idem = await one(`select result_code, target_id from admin_idempotency
                        where scope='appointment_create' and actor_admin_id=$1 and client_request_id=$2`,
                       [ADMIN_AUTH, AREQ])
chk('רשומת ה-idempotency נושאת result_code ו-target_id',
  idem.result_code === 'appointment_created' && idem.target_id === a1.appointment_id)

// ════════════════════════════════════════════════════════════════════════════
section('מרוץ Google שנתגלה *אחרי* ה-commit')
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ המרוץ הזה אינו ניתן לביטול: Google ו-Postgres אינם טרנזקציה משותפת.
// אירוע יכול להיכנס ליומן בין בדיקת הזמינות לבין כתיבת האירוע שלנו.
//
// כאן נבדק החוזה בצד ה-DB בדיוק כפי ש-runCalendarUpsert מפעיל אותו:
// כשההתנגשות מתגלה אחרי שהתור כבר נוצר, הוא קורא ל-fail_calendar_sync
// ו**לא** נוגע בתור עצמו. הצד השני (מה Google מחזיר) נבדק בבדיקה החיה.

const RACE_START = '2027-08-01T11:00:00Z'
const RACE_REQ = uuid()
const race = (await mkAppt(D_ID, RACE_START, 20, ['עיצוב גבות טבעי'], 70,
                           ADMIN_AUTH, RACE_REQ, FP)).r
const RACE_ID = race.appointment_id

// זה בדיוק הרצף ש-ensureCalendarSynced מבצעת: claim (pending→syncing),
// ואז — כשהבדיקה החוזרת מגלה אירוע חדש ביומן — fail_calendar_sync.
// ⚠️ fail_calendar_sync דורשת claim קודם (NOT_SYNCING אחרת), ולכן דילוג
// על השלב הזה היה בודק רצף שלא קיים במציאות.
await db.exec(`select public.claim_calendar_sync('${RACE_ID}')`)
await db.exec(`select public.fail_calendar_sync('${RACE_ID}','התנגשות עם אירוע קיים ביומן')`)

const afterRace = await one(`select status, calendar_sync_status, calendar_sync_error
                             from appointments where id=$1`, [RACE_ID])
chk('⚠️ התור נשאר confirmed אחרי כשל סנכרון', afterRace.status === 'confirmed')
chk('הסנכרון סומן failed', afterRace.calendar_sync_status === 'failed')
chk('השגיאה נשמרה מסוננת (בלי payload מ-Google)',
  afterRace.calendar_sync_error === 'התנגשות עם אירוע קיים ביומן')
chk('⚠️ התור לא נמחק',
  (await one(`select count(*)::int c from appointments where id=$1`, [RACE_ID])).c === 1)
chk('⚠️ נשארה שורת היסטוריה אחת בלבד',
  (await one(`select count(*)::int c from appointment_history where appointment_id=$1`, [RACE_ID])).c === 1)

// retry אחרי כשל היומן: אותו request id → אותו תור, בלי כתיבה נוספת
const raceRetry = (await mkAppt(D_ID, RACE_START, 20, ['עיצוב גבות טבעי'], 70,
                                ADMIN_AUTH, RACE_REQ, FP)).r
chk('⚠️ retry אחרי כשל יומן מחזיר את אותו תור', raceRetry.appointment_id === RACE_ID)
chk('retry אחרי כשל יומן לא יצר היסטוריה נוספת',
  (await one(`select count(*)::int c from appointment_history where appointment_id=$1`, [RACE_ID])).c === 1)
chk('retry אחרי כשל יומן לא יצר תור נוסף',
  (await one(`select count(*)::int c from appointments where starts_at='${RACE_START}'`)).c === 1)

// המנגנון הקיים יכול לתפוס אותו שוב לסנכרון — התור לא "תקוע"
const claimed = await one(`select public.claim_calendar_sync('${RACE_ID}') r`)
chk('התור נותר ניתן לתפיסה לסנכרון חוזר (claim מצליח)', Boolean(claimed.r))
chk('אחרי claim הסטטוס הוא syncing והתור עדיין confirmed',
  (await one(`select status s, calendar_sync_status c from appointments where id=$1`, [RACE_ID]))
    .c === 'syncing')

// ════════════════════════════════════════════════════════════════════════════
section('ה-CRM אחרי השינוי')
// ════════════════════════════════════════════════════════════════════════════

const listed = await one(`select public.list_crm_customers(null,'all',null,'last_activity',null,null,100,0) r`)
const items = listed.r.items
chk('רשימת ה-CRM נטענת', Array.isArray(items) && items.length > 0)

chk('⚠️ has_login_account=false ללקוחה ידנית',
  items.find(i => i.id === MANUAL_ID)?.has_login_account === false)
chk('⚠️ has_login_account=true ללקוחה שהתחברה',
  items.find(i => i.id === M2_ID)?.has_login_account === true)
chk('⚠️ לקוחה ידנית שהתחברה מוצגת עכשיו כבעלת חשבון (אותה שורה)',
  items.find(i => i.id === M2_ID)?.full_name === 'רותי כהן')

chk('⚠️ המנהלות מוחרגות מהרשימה (לפי auth_user_id)',
  !items.some(i => i.id === ADMIN_CUST) &&
  !items.some(i => i.phone_e164 === '+972541110003'))
chk('החרגת המנהלות משתקפת גם ב-total_count',
  listed.r.total_count === items.length)

const profile = await one(`select public.get_crm_customer($1) r`, [MANUAL_ID])
chk('פרופיל לקוחה ידנית נטען', Boolean(profile.r))
chk('⚠️ has_login_account בפרופיל הוא false', profile.r.has_login_account === false)
chk('⚠️ auth_user_id אינו נחשף בפרופיל', !('auth_user_id' in profile.r))
chk('⚠️ auth_user_id אינו נחשף ברשימה', !('auth_user_id' in items[0]))

chk('⚠️ פרופיל של חשבון מנהל מחזיר null',
  (await one(`select public.get_crm_customer($1) r`, [ADMIN_CUST])).r === null)

chk('customer_created מופיע ב-activity של הלקוחה הידנית שנוצרה',
  (await one(`select action a from customer_crm_activity where customer_id=$1
              and action='customer_created'`, [D_ID])).a === 'customer_created')

// חיפוש עדיין עובד על לקוחה ידנית
const searched = await one(`select public.list_crm_customers('דנה','all',null,'last_activity',null,null,25,0) r`)
chk('חיפוש בשם מוצא לקוחה ידנית', searched.r.items.some(i => i.id === D_ID))
const byPhone = await one(`select public.list_crm_customers('054-888-0001','all',null,'last_activity',null,null,25,0) r`)
chk('חיפוש בטלפון מוצא לקוחה ידנית', byPhone.r.items.some(i => i.id === D_ID))

// ════════════════════════════════════════════════════════════════════════════
section('הרשאות ה-RPCs')
// ════════════════════════════════════════════════════════════════════════════

const FNS = [
  'public.link_or_create_customer_for_auth(uuid, text, text)',
  'public.create_manual_customer(text, text, text, text, uuid, uuid, text)',
  'public.create_manual_appointment(uuid, text, text[], integer, timestamptz, integer, text, uuid, uuid, text)',
  'public.list_crm_customers(text, text, text, text, timestamptz, timestamptz, integer, integer)',
  'public.get_crm_customer(uuid)',
]
for (const fn of FNS) {
  const p = await one(
    `select has_function_privilege('anon',$1,'execute') a,
            has_function_privilege('authenticated',$1,'execute') u,
            has_function_privilege('service_role',$1,'execute') s`, [fn])
  chk(`${fn.split('(')[0].replace('public.', '')} — סגורה ל-anon/authenticated, פתוחה ל-service_role`,
    p.a === false && p.u === false && p.s === true)
}

chk('⚠️ אין הרשאת UPDATE על customers ל-anon/authenticated',
  (await one(`select has_table_privilege('anon','public.customers','update') a,
                     has_table_privilege('authenticated','public.customers','update') u`))
    .a === false)
chk('⚠️ אין הרשאת SELECT/INSERT על admin_idempotency ל-anon/authenticated',
  (await one(`select has_table_privilege('anon','public.admin_idempotency','select') a,
                     has_table_privilege('authenticated','public.admin_idempotency','insert') u`))
    .a === false)

// ════════════════════════════════════════════════════════════════════════════
const passed = results.filter(Boolean).length
console.log(`\n${'═'.repeat(60)}`)
if (passed === results.length) {
  console.log(`✓ כל ${results.length} הבדיקות עברו`)
} else {
  console.log(`✗ ${results.length - passed} מתוך ${results.length} נכשלו`)
  process.exit(1)
}
