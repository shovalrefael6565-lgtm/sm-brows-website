/**
 * שלב 9 — CRM ופרופיל לקוחה: בדיקות מול Postgres אמיתי (PGlite).
 *
 * מריצה 0001→0009 ובודקת את מה ש-0009 מבטיחה: הסכמה, ה-RLS, ה-append-only,
 * ה-backfill, החרגת המנהלים, כל הגדרות המדדים, האידמפוטנטיות של כל פעולה,
 * וה-search/filter/sort/pagination.
 *
 * הרצה:  npm run test:customer-crm
 *
 * הערה: Supabase מספק את הסכמה auth ואת auth.uid(). כאן הן מדומות, ולכן
 * הבדיקה מאמתת את הלוגיקה שלנו — לא את Supabase עצמו.
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const migration = name => readFileSync(join(MIGRATIONS_DIR, name), 'utf8')

const MIGRATIONS = [
  '0001_customer_accounts.sql',
  '0002_pending_expiration_enum_values.sql',
  '0003_pending_expiration.sql',
  '0004_appointment_approval.sql',
  '0005_customer_reschedule_cancel.sql',
  '0006_restrict_sensitive_rpcs.sql',
  '0007_reapply_rpc_permissions.sql',
  '0008_google_calendar_inbound_sync.sql',
  '0009_customer_crm.sql',
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
const one = async (sql, params = []) => (await q(sql, params))[0]
const errOf = async (sql, params = []) => {
  try { await db.query(sql, params); return null } catch (e) { return e.message }
}

// ============================================================================
section('הרצת המיגרציות 0001→0009')
// ============================================================================
for (const name of MIGRATIONS) {
  try {
    await db.exec(migration(name))
    chk(`${name.slice(0, 4)} רצה במלואה ללא שגיאה`)
  } catch (e) {
    chk(`${name.slice(0, 4)} רצה במלואה ללא שגיאה`, false, e.message)
    console.log('\n⛔ עוצר — אין טעם להמשיך.')
    process.exit(1)
  }
}

// ============================================================================
section('הסכמה של 0009')
// ============================================================================

const tables = (await q(
  `select table_name from information_schema.tables
   where table_schema='public' and table_name like 'customer%' order by 1`,
)).map(r => r.table_name)
chk('ארבע טבלאות ה-CRM נוצרו',
  ['customer_crm_activity', 'customer_crm_profiles', 'customer_notes', 'customer_sources']
    .every(t => tables.includes(t)), tables.join(', '))

const rls = await one(`
  select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relrowsecurity
    and c.relname in ('customer_sources','customer_crm_profiles','customer_notes','customer_crm_activity')`)
chk('RLS מופעל על כל ארבע הטבלאות', rls.c === 4, `c=${rls.c}`)

const pol = await one(`
  select count(*)::int c from pg_policies where schemaname='public'
    and tablename in ('customer_sources','customer_crm_profiles','customer_notes','customer_crm_activity')`)
chk('אין אף policy — service_role בלבד', pol.c === 0, `c=${pol.c}`)

const srcCount = await one(`select count(*)::int c from customer_sources`)
chk('10 מקורות הגעה נטענו', srcCount.c === 10, `c=${srcCount.c}`)

const unknownActive = await one(`select is_active from customer_sources where key='unknown'`)
chk('unknown קיים ופעיל', unknownActive?.is_active === true)

const unknownOff = await errOf(`update customer_sources set is_active=false where key='unknown'`)
chk('אי אפשר לכבות את unknown', unknownOff !== null)

const deprecated = await one(`
  select col_description('public.customers'::regclass,
    (select ordinal_position from information_schema.columns
     where table_name='customers' and column_name='admin_notes')) d`)
chk('admin_notes מסומנת Deprecated', (deprecated?.d ?? '').includes('Deprecated'))

const adminNotesExists = await one(`
  select count(*)::int c from information_schema.columns
  where table_name='customers' and column_name='admin_notes'`)
chk('admin_notes לא נמחקה', adminNotesExists.c === 1)

const viewExists = await one(`
  select count(*)::int c from information_schema.views
  where table_schema='public' and table_name='customer_crm_metrics'`)
chk('view המדדים נוצר', viewExists.c === 1)

const idx = (await q(`select indexname from pg_indexes where schemaname='public'`)).map(r => r.indexname)
chk('אינדקס לתור הבא נוצר', idx.includes('appointments_customer_next_idx'))
chk('אינדקס להערות פעילות נוצר', idx.includes('customer_notes_customer_idx'))
chk('אינדקס ל-activity נוצר', idx.includes('customer_crm_activity_customer_idx'))

// ⚠️ שלושת האינדקסים למעלה הוכחו ב-EXPLAIN ANALYZE (Index Scan / Index Only
// Scan). אינדקס על crm_status לעומת זאת נמדד ונמצא בלתי שמיש: הסינון הוא
// על coalesce(crm_status,'active') מעל LEFT JOIN, וביטוי כזה אינו נתמך
// ע"י אינדקס btree רגיל. הבדיקה הזו נועלת את ההחלטה כדי שלא יחזור בהיסח הדעת.
chk('⚠️ אין אינדקס מיותר על crm_status', !idx.includes('customer_crm_profiles_status_idx'))

// בדיוק שני אינדקסים מפורשים על ארבע טבלאות ה-CRM — כל השאר הם PK או
// UNIQUE constraint. הספירה מחריגה constraints כדי שתהיה משמעותית.
const explicitCrmIdx = (await q(`
  select i.indexname from pg_indexes i
  where i.schemaname='public'
    and i.tablename in ('customer_sources','customer_crm_profiles',
                        'customer_notes','customer_crm_activity')
    and not exists (
      select 1 from pg_constraint c
      where c.conname = i.indexname and c.connamespace = 'public'::regnamespace)
  order by 1`)).map(r => r.indexname)
chk('⚠️ נוצרו בדיוק 2 אינדקסים מפורשים על טבלאות ה-CRM',
  explicitCrmIdx.length === 2, explicitCrmIdx.join(', '))

// ============================================================================
section('נתוני בדיקה')
// ============================================================================

const ADMIN_A = '99999999-0000-4000-8000-00000000000a'
const ADMIN_B = '99999999-0000-4000-8000-00000000000b'
const C1 = '11111111-0000-4000-8000-000000000001'
const C2 = '11111111-0000-4000-8000-000000000002'
const C3 = '11111111-0000-4000-8000-000000000003'
const C4 = '11111111-0000-4000-8000-000000000004'

const mkCustomer = async (id, name, phone) => {
  await db.query(`insert into auth.users values ($1)`, [id])
  await db.query(`insert into customers (id, phone_e164, full_name) values ($1,$2,$3)`, [id, phone, name])
}

await mkCustomer(ADMIN_A, 'שובל', '+972500000001')
await mkCustomer(ADMIN_B, 'רפאל', '+972500000002')
await db.query(`insert into admins (user_id) values ($1),($2)`, [ADMIN_A, ADMIN_B])

await mkCustomer(C1, 'דנה כהן', '+972521234567')
await mkCustomer(C2, 'מיכל לוי', '+972537654321')
await mkCustomer(C3, 'נועה ישראלי', '+972541112222')
await mkCustomer(C4, 'רונית שמש', '+972553334444')
chk('נוצרו 2 מנהלות ו-4 לקוחות')

// ============================================================================
section('Backfill')
// ============================================================================

const profiles = await one(`select count(*)::int c from customer_crm_profiles`)
const custs = await one(`select count(*)::int c from customers`)
chk('לכל customer יש פרופיל CRM', profiles.c === custs.c, `${profiles.c}/${custs.c}`)

const defaults = await one(`
  select count(*)::int c from customer_crm_profiles
  where crm_status='active' and source_key='unknown'`)
chk('ברירת מחדל active + unknown לכולן', defaults.c === custs.c, `c=${defaults.c}`)

const noSource = await one(`select count(*)::int c from customer_crm_profiles where source_key<>'unknown'`)
chk('⚠️ ה-backfill לא הסיק מקור הגעה', noSource.c === 0)

const noActor = await one(`
  select count(*)::int c from customer_crm_profiles
  where crm_status_changed_by is not null or source_changed_by is not null`)
chk('ה-backfill לא מזייף פעולה ניהולית', noActor.c === 0)

const noActivity = await one(`select count(*)::int c from customer_crm_activity`)
chk('ה-backfill לא יצר activity', noActivity.c === 0)

// הרצה חוזרת של ה-backfill אינה יוצרת כפילות
await db.exec(`insert into customer_crm_profiles (customer_id)
               select c.id from customers c on conflict (customer_id) do nothing`)
const afterRerun = await one(`select count(*)::int c from customer_crm_profiles`)
chk('rerun של ה-backfill אינו יוצר כפילות', afterRerun.c === profiles.c, `c=${afterRerun.c}`)

// טריגר ללקוחה חדשה
const C5 = '11111111-0000-4000-8000-000000000005'
await mkCustomer(C5, 'לקוחה חדשה', '+972566665555')
const newProfile = await one(`select crm_status, source_key from customer_crm_profiles where customer_id=$1`, [C5])
chk('לקוחה חדשה מקבלת active + unknown אוטומטית',
  newProfile?.crm_status === 'active' && newProfile?.source_key === 'unknown')
await db.query(`delete from customers where id=$1`, [C5])

// ============================================================================
section('החרגת מנהלים מה-CRM')
// ============================================================================

let list = (await one(`select list_crm_customers() j`)).j
chk('מנהלות אינן מופיעות ב-items', list.items.length === 4, `n=${list.items.length}`)
chk('מנהלות אינן נספרות ב-total_count', list.total_count === 4, `total=${list.total_count}`)
chk('אף מנהלת לא ברשימה',
  !list.items.some(i => i.id === ADMIN_A || i.id === ADMIN_B))

const searchAdmin = (await one(`select list_crm_customers('שובל') j`)).j
chk('חיפוש שם מנהלת לא מחזיר אותה', searchAdmin.total_count === 0)

const searchAdminPhone = (await one(`select list_crm_customers('500000001') j`)).j
chk('חיפוש טלפון מנהלת לא מחזיר אותה', searchAdminPhone.total_count === 0)

for (const f of ['all', 'active', 'inactive', 'has_future', 'no_future', 'returning', 'no_show', 'cancelled']) {
  const r = (await one(`select list_crm_customers(null,$1) j`, [f])).j
  if (r.items.some(i => i.id === ADMIN_A || i.id === ADMIN_B)) {
    chk(`פילטר ${f} מחריג מנהלות`, false)
  }
}
chk('כל הפילטרים מחריגים מנהלות')

const adminProfile = (await one(`select get_crm_customer($1) j`, [ADMIN_A])).j
chk('get_crm_customer על מנהלת → null (יוביל ל-404)', adminProfile === null)

const realProfile = (await one(`select get_crm_customer($1) j`, [C1])).j
chk('get_crm_customer על לקוחה אמיתית נטען', realProfile !== null && realProfile.full_name === 'דנה כהן')

const missingProfile = (await one(`select get_crm_customer($1) j`,
  ['00000000-0000-4000-8000-000000000000'])).j
chk('get_crm_customer על מזהה לא קיים → null', missingProfile === null)

const adminsStill = await one(`select count(*)::int c from admins`)
chk('המנהלות לא נמחקו ולא השתנו', adminsStill.c === 2)

// ============================================================================
section('חיפוש')
// ============================================================================

let r = (await one(`select list_crm_customers('דנה כהן') j`)).j
chk('חיפוש שם מלא', r.total_count === 1 && r.items[0].id === C1)

r = (await one(`select list_crm_customers('לוי') j`)).j
chk('חיפוש חלק משם', r.total_count === 1 && r.items[0].id === C2)

r = (await one(`select list_crm_customers('052-123-4567') j`)).j
chk('חיפוש טלפון בפורמט מקומי עם מקפים', r.total_count === 1 && r.items[0].id === C1)

r = (await one(`select list_crm_customers('0521234567') j`)).j
chk('חיפוש טלפון בפורמט מקומי רציף', r.total_count === 1 && r.items[0].id === C1)

r = (await one(`select list_crm_customers('+972521234567') j`)).j
chk('חיפוש טלפון ב-E.164', r.total_count === 1 && r.items[0].id === C1)

r = (await one(`select list_crm_customers('7654') j`)).j
chk('חיפוש ספרות חלקיות', r.total_count === 1 && r.items[0].id === C2)

r = (await one(`select list_crm_customers('') j`)).j
chk('חיפוש ריק מחזיר את כולן', r.total_count === 4)

r = (await one(`select list_crm_customers('   ') j`)).j
chk('חיפוש רווחים בלבד מחזיר את כולן', r.total_count === 4)

r = (await one(`select list_crm_customers($1) j`, ['%'])).j
chk('wildcard של ilike אינו מחזיר הכול', r.total_count === 0)

r = (await one(`select list_crm_customers($1) j`, ['_'])).j
chk('underscore אינו wildcard', r.total_count === 0)

r = (await one(`select list_crm_customers($1) j`, ["'; drop table customers; --"])).j
chk('קלט זדוני מטופל כטקסט', r.total_count === 0)
const stillThere = await one(`select count(*)::int c from customers`)
chk('טבלת customers שרדה', stillThere.c === 6)

r = (await one(`select list_crm_customers($1) j`, ['א'.repeat(5000)])).j
chk('query ארוך מאוד מטופל בבטחה', r.total_count === 0)

// ============================================================================
section('Pagination')
// ============================================================================

r = (await one(`select list_crm_customers(null,'all',null,'name',null,null,2,0) j`)).j
chk('עמוד ראשון מחזיר 2 שורות', r.items.length === 2 && r.total_count === 4)

r = (await one(`select list_crm_customers(null,'all',null,'name',null,null,2,2) j`)).j
chk('עמוד שני מחזיר 2 שורות ואותו total', r.items.length === 2 && r.total_count === 4)

// ⚠️ הבדיקה המרכזית של חידוד 2: עמוד מחוץ לטווח שומר על total_count
r = (await one(`select list_crm_customers(null,'all',null,'name',null,null,25,2400) j`)).j
chk('⚠️ עמוד מחוץ לטווח: items ריק אך total_count נשמר',
  r.items.length === 0 && r.total_count === 4, `total=${r.total_count}`)

r = (await one(`select list_crm_customers(null,'all',null,'name',null,null,-5,-10) j`)).j
chk('limit/offset שליליים נחתכים בבטחה', r.items.length === 1 && r.total_count === 4)

r = (await one(`select list_crm_customers(null,'all',null,'name',null,null,99999,0) j`)).j
chk('limit ענק נחתך ל-100', r.items.length === 4)

// ============================================================================
section('מיון')
// ============================================================================

r = (await one(`select list_crm_customers(null,'all',null,'name') j`)).j
const names = r.items.map(i => i.full_name)
chk('מיון לפי שם', names[0] === 'דנה כהן', names.join(', '))

r = (await one(`select list_crm_customers(null,'all',null,'created_asc') j`)).j
chk('מיון הצטרפות ישנה→חדשה', r.items[0].id === C1)

r = (await one(`select list_crm_customers(null,'all',null,'created_desc') j`)).j
chk('מיון הצטרפות חדשה→ישנה', r.items[0].id === C4)

r = (await one(`select list_crm_customers(null,'all',null,$1) j`, ['nonsense'])).j
chk('sort לא מוכר נופל לברירת מחדל', r.total_count === 4)

r = (await one(`select list_crm_customers(null,$1) j`, ['nonsense'])).j
chk('filter לא מוכר נופל ל-all', r.total_count === 4)

r = (await one(`select list_crm_customers(null,'all',null,$1) j`,
  ['name; drop table customers'])).j
chk('⚠️ אין dynamic ORDER BY — sort זדוני אינו מבוצע', r.total_count === 4)

// ============================================================================
section('סטטוס CRM')
// ============================================================================

let res = (await one(`select set_customer_crm_status($1,'active',$2) j`, [C1, ADMIN_A])).j
chk('active→active הוא no-op', res.changed === false)
let acts = await one(`select count(*)::int c from customer_crm_activity where customer_id=$1`, [C1])
chk('active→active לא יצר activity', acts.c === 0)

res = (await one(`select set_customer_crm_status($1,'inactive',$2) j`, [C1, ADMIN_A])).j
chk('active→inactive נכתב', res.changed === true)
acts = await one(`select count(*)::int c from customer_crm_activity
                  where customer_id=$1 and action='crm_status_changed'`, [C1])
chk('נרשמה activity אחת בלבד', acts.c === 1, `c=${acts.c}`)

let act = await one(`select old_value,new_value,actor_admin_id from customer_crm_activity
                     where customer_id=$1 order by id desc limit 1`, [C1])
chk('old/new value נכונים', act.old_value === 'active' && act.new_value === 'inactive')
chk('actor_admin_id נכון', act.actor_admin_id === ADMIN_A)

res = (await one(`select set_customer_crm_status($1,'active',$2) j`, [C1, ADMIN_B])).j
chk('inactive→active נכתב', res.changed === true)
act = await one(`select actor_admin_id from customer_crm_activity
                 where customer_id=$1 order by id desc limit 1`, [C1])
chk('actor שונה נרשם נכון', act.actor_admin_id === ADMIN_B)

let e = await errOf(`select set_customer_crm_status($1,'blocked',$2)`, [C1, ADMIN_A])
chk('סטטוס לא חוקי נדחה', e?.includes('INVALID_STATUS'))

e = await errOf(`select set_customer_crm_status($1,'inactive',$2)`, [C1, C2])
chk('⚠️ actor שאינו מנהל נדחה', e?.includes('NOT_ADMIN'))

e = await errOf(`select set_customer_crm_status($1,'inactive',null)`, [C1])
chk('actor ריק נדחה', e?.includes('NOT_ADMIN'))

const afterReject = await one(`select crm_status from customer_crm_profiles where customer_id=$1`, [C1])
chk('דחייה לא שינתה את הסטטוס', afterReject.crm_status === 'active')

// inactive אינו חוסם דבר — is_blocked הוא החסימה האמיתית ונשאר נפרד
await db.query(`select set_customer_crm_status($1,'inactive',$2)`, [C2, ADMIN_A])
const blocked = await one(`select is_blocked from customers where id=$1`, [C2])
chk('⚠️ inactive אינו משנה is_blocked', blocked.is_blocked === false)

// ============================================================================
section('מקור הגעה')
// ============================================================================

res = (await one(`select set_customer_source($1,'instagram',$2) j`, [C1, ADMIN_A])).j
chk('שינוי מקור נכתב', res.changed === true)

res = (await one(`select set_customer_source($1,'instagram',$2) j`, [C1, ADMIN_A])).j
chk('שינוי לאותו מקור הוא no-op', res.changed === false)

acts = await one(`select count(*)::int c from customer_crm_activity
                  where customer_id=$1 and action='source_changed'`, [C1])
chk('נרשמה activity אחת למקור', acts.c === 1, `c=${acts.c}`)

e = await errOf(`select set_customer_source($1,'myspace',$2)`, [C1, ADMIN_A])
chk('מקור לא חוקי נדחה', e?.includes('INVALID_SOURCE'))

e = await errOf(`select set_customer_source($1,'instagram',$2)`, [C1, C2])
chk('actor שאינו מנהל נדחה', e?.includes('NOT_ADMIN'))

// מקור שהוצא משימוש
await db.exec(`update customer_sources set is_active=false where key='tiktok'`)
e = await errOf(`select set_customer_source($1,'tiktok',$2)`, [C3, ADMIN_A])
chk('מעבר למקור inactive נדחה', e?.includes('SOURCE_INACTIVE'))

await db.exec(`update customer_sources set is_active=true where key='tiktok'`)
await db.query(`select set_customer_source($1,'tiktok',$2)`, [C3, ADMIN_A])
await db.exec(`update customer_sources set is_active=false where key='tiktok'`)
res = (await one(`select set_customer_source($1,'tiktok',$2) j`, [C3, ADMIN_A])).j
chk('שמירה על מקור inactive קיים היא no-op מותר', res.changed === false)

const stillTiktok = await one(`select source_key from customer_crm_profiles where customer_id=$1`, [C3])
chk('המקור ה-inactive עדיין מוצג בפרופיל', stillTiktok.source_key === 'tiktok')
await db.exec(`update customer_sources set is_active=true where key='tiktok'`)

// הרחבה עתידית בלי migration
await db.exec(`insert into customer_sources (key,label_he,sort_order) values ('podcast','פודקאסט',95)`)
res = (await one(`select set_customer_source($1,'podcast',$2) j`, [C4, ADMIN_A])).j
chk('מקור חדש נוסף ב-INSERT בלבד ועובד מיד', res.changed === true)
await db.query(`select set_customer_source($1,'unknown',$2)`, [C4, ADMIN_A])
await db.exec(`delete from customer_sources where key='podcast'`)

// ============================================================================
section('הערות פנימיות')
// ============================================================================

const RID1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const RID2 = 'aaaaaaaa-0000-4000-8000-000000000002'

res = (await one(`select create_customer_note($1,'הערה ראשונה',$2,$3) j`, [C1, ADMIN_A, RID1])).j
const NOTE1 = res.note_id
chk('יצירת הערה', res.created === true && NOTE1)

acts = await one(`select count(*)::int c from customer_crm_activity
                  where customer_id=$1 and action='note_created'`, [C1])
chk('נרשמה activity ליצירה', acts.c === 1)

e = await errOf(`select create_customer_note($1,'   ',$2,$3)`, [C1, ADMIN_A, RID2])
chk('הערה ריקה נדחית', e?.includes('NOTE_EMPTY'))

e = await errOf(`select create_customer_note($1,$2,$3,$4)`, [C1, 'x'.repeat(2001), ADMIN_A, RID2])
chk('הערה ארוכה מדי נדחית', e?.includes('NOTE_TOO_LONG'))

const long = await one(`select create_customer_note($1,$2,$3,$4) j`,
  [C1, 'x'.repeat(2000), ADMIN_A, RID2])
chk('הערה באורך המקסימלי מתקבלת', long.j.created === true)
await db.query(`select archive_customer_note($1,$2,$3)`, [long.j.note_id, C1, ADMIN_A])

e = await errOf(`select create_customer_note($1,'הערה',$2,null)`, [C1, ADMIN_A])
chk('בקשה ללא client_request_id נדחית', e?.includes('MISSING_REQUEST_ID'))

e = await errOf(`select create_customer_note($1,'הערה',$2,$3)`, [C1, C2, RID2])
chk('actor שאינו מנהל נדחה', e?.includes('NOT_ADMIN'))

// XSS נשמר כטקסט; ההצגה עוברת escaping של React
const XSS = '<script>alert(1)</script>'
const RID3 = 'aaaaaaaa-0000-4000-8000-000000000003'
res = (await one(`select create_customer_note($1,$2,$3,$4) j`, [C2, XSS, ADMIN_A, RID3])).j
const xssBody = await one(`select body from customer_notes where id=$1`, [res.note_id])
chk('⚠️ HTML/script נשמר כטקסט גולמי ולא מבוצע', xssBody.body === XSS)

// ── idempotency של יצירה ────────────────────────────────────────────────────
res = (await one(`select create_customer_note($1,'הערה ראשונה',$2,$3) j`, [C1, ADMIN_A, RID1])).j
chk('⚠️ אותו request id + אותו body → אותה note', res.created === false && res.note_id === NOTE1)

acts = await one(`select count(*)::int c from customer_crm_activity
                  where customer_id=$1 and action='note_created'`, [C1])
chk('retry לא יצר activity נוספת', acts.c === 2, `c=${acts.c}`)

let notesCount = await one(`select count(*)::int c from customer_notes where customer_id=$1`, [C1])
chk('retry לא יצר הערה כפולה', notesCount.c === 2, `c=${notesCount.c}`)

e = await errOf(`select create_customer_note($1,'תוכן אחר לגמרי',$2,$3)`, [C1, ADMIN_A, RID1])
chk('⚠️ אותו request id + body שונה → נדחה', e?.includes('IDEMPOTENCY_KEY_REUSED'))

const untouched = await one(`select body from customer_notes where id=$1`, [NOTE1])
chk('התוכן המקורי לא נדרס', untouched.body === 'הערה ראשונה')

acts = await one(`select count(*)::int c from customer_crm_activity
                  where customer_id=$1 and action='note_created'`, [C1])
chk('reuse שנדחה לא יצר activity', acts.c === 2)

const RID4 = 'aaaaaaaa-0000-4000-8000-000000000004'
res = (await one(`select create_customer_note($1,'הערה ראשונה',$2,$3) j`, [C1, ADMIN_A, RID4])).j
chk('request id חדש + אותו body → הערה חדשה מותרת', res.created === true && res.note_id !== NOTE1)
await db.query(`select archive_customer_note($1,$2,$3)`, [res.note_id, C1, ADMIN_A])

// ── עריכה ───────────────────────────────────────────────────────────────────
const beforeEdit = await one(`select updated_at from customer_notes where id=$1`, [NOTE1])
res = (await one(`select update_customer_note($1,$2,'הערה ראשונה',$3) j`, [NOTE1, C1, ADMIN_A])).j
chk('עריכה לאותו תוכן היא no-op', res.changed === false)
const afterNoop = await one(`select updated_at from customer_notes where id=$1`, [NOTE1])
chk('updated_at לא זז ב-no-op',
  beforeEdit.updated_at.getTime() === afterNoop.updated_at.getTime())

res = (await one(`select update_customer_note($1,$2,'תוכן מעודכן',$3) j`, [NOTE1, C1, ADMIN_A])).j
chk('עריכה אמיתית נכתבת', res.changed === true)
const afterEdit = await one(`select body, updated_at from customer_notes where id=$1`, [NOTE1])
chk('התוכן עודכן', afterEdit.body === 'תוכן מעודכן')
chk('updated_at התעדכן', afterEdit.updated_at.getTime() > beforeEdit.updated_at.getTime())

acts = await one(`select count(*)::int c from customer_crm_activity
                  where customer_id=$1 and action='note_updated'`, [C1])
chk('נרשמה activity לעריכה', acts.c === 1)

const noBody = await one(`select count(*)::int c from customer_crm_activity
                          where old_value like '%תוכן%' or new_value like '%תוכן%'`)
chk('⚠️ גוף ההערה אינו נכנס ל-activity', noBody.c === 0)

// ⚠️ בידוד בין לקוחות
e = await errOf(`select update_customer_note($1,$2,'פריצה',$3)`, [NOTE1, C2, ADMIN_A])
chk('⚠️ עריכת הערה דרך customer_id של לקוחה אחרת נחסמת', e?.includes('NOTE_NOT_FOUND'))
const notHacked = await one(`select body from customer_notes where id=$1`, [NOTE1])
chk('ההערה לא שונתה בניסיון הפריצה', notHacked.body === 'תוכן מעודכן')

e = await errOf(`select update_customer_note($1,$2,'   ',$3)`, [NOTE1, C1, ADMIN_A])
chk('עריכה לתוכן ריק נדחית', e?.includes('NOTE_EMPTY'))

// ── ארכוב ───────────────────────────────────────────────────────────────────
res = (await one(`select archive_customer_note($1,$2,$3) j`, [NOTE1, C1, ADMIN_A])).j
chk('ארכוב ראשון נכתב', res.changed === true)

res = (await one(`select archive_customer_note($1,$2,$3) j`, [NOTE1, C1, ADMIN_A])).j
chk('ארכוב חוזר הוא no-op', res.changed === false)

// מסונן ל-NOTE1 בלבד: הערות אחרות של C1 אורכבו קודם במהלך הבדיקה
acts = await one(`select count(*)::int c from customer_crm_activity
                  where customer_id=$1 and action='note_archived' and related_note_id=$2`,
  [C1, NOTE1])
chk('ארכוב כפול רשם activity אחת בלבד', acts.c === 1, `c=${acts.c}`)

const archived = await one(`select body, archived_at, archived_by_admin_id
                            from customer_notes where id=$1`, [NOTE1])
chk('archive אינו מוחק את ה-body', archived.body === 'תוכן מעודכן')
chk('archived_at נכתב', archived.archived_at !== null)
chk('archived_by_admin_id נכתב', archived.archived_by_admin_id === ADMIN_A)

e = await errOf(`select update_customer_note($1,$2,'שינוי',$3)`, [NOTE1, C1, ADMIN_A])
chk('⚠️ אי אפשר לערוך הערה מאורכבת', e?.includes('NOTE_ARCHIVED'))

const openNotes = await one(`select open_notes_count from customer_crm_metrics where customer_id=$1`, [C1])
chk('הערה מאורכבת אינה נספרת כפעילה', openNotes.open_notes_count === 0, `c=${openNotes.open_notes_count}`)

// אין נתיב מחיקה באפליקציה
const deleteRpcs = await one(`
  select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like '%delete%note%'`)
chk('⚠️ אין RPC למחיקת הערה', deleteRpcs.c === 0)

// ============================================================================
section('Append-only של activity')
// ============================================================================

e = await errOf(`update customer_crm_activity set action='source_changed' where customer_id=$1`, [C1])
chk('⚠️ UPDATE על activity נחסם', e?.includes('append-only'))

e = await errOf(`update customer_crm_activity set old_value='x'`)
chk('UPDATE על שדה אחר נחסם גם הוא', e?.includes('append-only'))

// ⚠️ חידוד 6: cascade חייב להמשיך לעבוד למרות הטריגר
const NOTE_C3 = (await one(`select create_customer_note($1,'הערה של נועה',$2,$3) j`,
  [C3, ADMIN_A, 'bbbbbbbb-0000-4000-8000-000000000001'])).j.note_id
await db.query(`select set_customer_crm_status($1,'inactive',$2)`, [C3, ADMIN_A])

const c3Before = await one(`
  select (select count(*)::int from customer_notes where customer_id=$1) n,
         (select count(*)::int from customer_crm_activity where customer_id=$1) a`, [C3])
chk('ללקוחה יש notes ו-activity לפני המחיקה', c3Before.n === 1 && c3Before.a >= 2,
  `n=${c3Before.n} a=${c3Before.a}`)

// מחיקת ההערה לבדה — cascade ל-activity, בלי UPDATE ובלי יתומות
const delNote = await errOf(`delete from customer_notes where id=$1`, [NOTE_C3])
chk('⚠️ מחיקת note עוברת למרות הטריגר', delNote === null, delNote ?? '')
const orphan = await one(`select count(*)::int c from customer_crm_activity
                          where related_note_id=$1`, [NOTE_C3])
chk('⚠️ לא נשארה activity יתומה', orphan.c === 0)

// מחיקת הלקוחה — cascade לכל שורות ה-CRM שלה
const delCustomer = await errOf(`delete from customers where id=$1`, [C3])
chk('⚠️ מחיקת customer עוברת למרות הטריגר', delCustomer === null, delCustomer ?? '')

const c3After = await one(`
  select (select count(*)::int from customer_notes where customer_id=$1) n,
         (select count(*)::int from customer_crm_activity where customer_id=$1) a,
         (select count(*)::int from customer_crm_profiles where customer_id=$1) p`, [C3])
chk('⚠️ כל שורות ה-CRM של הלקוחה נמחקו ב-cascade',
  c3After.n === 0 && c3After.a === 0 && c3After.p === 0,
  `n=${c3After.n} a=${c3After.a} p=${c3After.p}`)

// C1 יצרה 3 הערות במהלך הבדיקה (NOTE1, הערה באורך מקסימלי, ו-RID4).
// כולן — כולל המאורכבות — חייבות לשרוד את מחיקת C3.
const others = await one(`
  select (select count(*)::int from customers where id in ($1,$2,$3)) c,
         (select count(*)::int from customer_notes where customer_id=$1) n,
         (select count(*)::int from customer_crm_activity where customer_id=$1) a`,
  [C1, C2, C4])
chk('⚠️ לקוחות אחרות לא נפגעו ממחיקת ה-cascade',
  others.c === 3 && others.n === 3 && others.a > 0,
  `c=${others.c} n=${others.n} a=${others.a}`)

const adminsAfterCleanup = await one(`select count(*)::int c from admins`)
chk('המנהלות שרדו את הניקוי', adminsAfterCleanup.c === 2)

// ============================================================================
section('מדדים')
// ============================================================================

const now = new Date()
const iso = d => d.toISOString()
const days = n => iso(new Date(now.getTime() + n * 864e5))

const mkAppt = async (id, customerId, startsAt, status, extra = {}) => {
  await db.query(
    `insert into appointments
       (id, customer_id, service_key, variants, price_total, starts_at, ends_at,
        duration_min, status, reschedule_count, pending_expires_at)
     values ($1,$2,'עיצוב גבות טבעיות','{}',120,$3,$3,20,$4,$5,$6)`,
    [id, customerId, startsAt, status, extra.reschedules ?? 0, extra.pendingExpires ?? null])
}

const A = n => `22222222-0000-4000-8000-00000000000${n}`
await mkAppt(A(1), C4, days(-30), 'completed')
await mkAppt(A(2), C4, days(-10), 'completed')
await mkAppt(A(3), C4, days(-5),  'no_show')
await mkAppt(A(4), C4, days(-3),  'cancelled_by_customer')
await mkAppt(A(5), C4, days(-2),  'cancelled_by_business')
await mkAppt(A(6), C4, days(7),   'confirmed', { reschedules: 2 })
await mkAppt(A(7), C4, days(30),  'confirmed')

let m = await one(`select * from customer_crm_metrics where customer_id=$1`, [C4])
chk('completed נספר נכון', m.completed_count === 2, `c=${m.completed_count}`)
chk('⚠️ cancelled אינו נספר כ-completed', m.completed_count === 2)
chk('⚠️ no_show אינו נספר כ-completed', m.completed_count === 2)
chk('no_show נספר בנפרד', m.no_show_count === 1)
chk('⚠️ ביטולי לקוחה ועסק נספרים בנפרד',
  m.cancelled_by_customer_count === 1 && m.cancelled_by_business_count === 1)
chk('טיפול אחרון שהושלם', new Date(m.last_completed_at).toDateString() ===
  new Date(days(-10)).toDateString())
chk('טיפול ראשון שהושלם', new Date(m.first_completed_at).toDateString() ===
  new Date(days(-30)).toDateString())
chk('⚠️ התור הבא הוא ה-confirmed העתידי המוקדם ביותר',
  new Date(m.next_confirmed_starts_at).toDateString() === new Date(days(7)).toDateString())
chk('הזזות עצמיות = סכום reschedule_count', m.self_reschedule_total === 2, `c=${m.self_reschedule_total}`)

// pending פעיל מול pending שפג
await mkAppt(A(8), C1, days(3), 'pending', { pendingExpires: days(1) })
m = await one(`select active_pending_count from customer_crm_metrics where customer_id=$1`, [C1])
chk('בקשת pending פעילה נספרת', m.active_pending_count === 1)

await db.query(`update appointments set pending_expires_at=$2 where id=$1`, [A(8), days(-1)])
m = await one(`select active_pending_count, next_confirmed_starts_at
               from customer_crm_metrics where customer_id=$1`, [C1])
chk('⚠️ pending שפג תוקפו אינו נספר כבקשה ממתינה', m.active_pending_count === 0)
chk('⚠️ pending לעולם אינו התור הבא', m.next_confirmed_starts_at === null)

await db.query(`update appointments set pending_expires_at=null where id=$1`, [A(8)])
m = await one(`select active_pending_count from customer_crm_metrics where customer_id=$1`, [C1])
chk('pending ללא תפוגה נספר כפעיל', m.active_pending_count === 1)

// confirmed שעבר זמנו אינו התור הבא ואינו טיפול שהושלם
await mkAppt(A(9), C2, days(-1), 'confirmed')
m = await one(`select next_confirmed_starts_at, completed_count, last_completed_at
               from customer_crm_metrics where customer_id=$1`, [C2])
chk('⚠️ confirmed שעבר זמנו אינו התור הבא', m.next_confirmed_starts_at === null)
chk('⚠️ confirmed שעבר זמנו אינו טיפול שהושלם',
  m.completed_count === 0 && m.last_completed_at === null)

// שני מדדי ההזזה נפרדים.
// A(6) נושא reschedule_count=2 — שתי הזזות עצמיות של הלקוחה.
// כאן נוספות שלוש רשומות history: שתיים של הלקוחה ואחת שהגיעה מ-Google.
// הזזה מ-Google אינה מגדילה את reschedule_count, ולכן המספרים חייבים
// להיות שונים: 2 עצמיות מול 3 אירועי הזזה בסך הכול.
await db.query(
  `insert into appointment_history (appointment_id, action, actor, source)
   values ($1,'rescheduled','customer',null),
          ($1,'rescheduled','customer',null),
          ($1,'rescheduled','system','google_calendar')`,
  [A(6)])
m = await one(`select self_reschedule_total, all_reschedule_events
               from customer_crm_metrics where customer_id=$1`, [C4])
chk('⚠️ כלל אירועי ההזזה נספרים מ-history', m.all_reschedule_events === 3, `c=${m.all_reschedule_events}`)
chk('⚠️ הזזה מ-Google אינה מגדילה את ההזזות העצמיות',
  m.self_reschedule_total === 2, `c=${m.self_reschedule_total}`)
chk('⚠️ שני המדדים אינם אותו מספר ואינם ניתנים לאיחוד',
  m.self_reschedule_total !== m.all_reschedule_events,
  `self=${m.self_reschedule_total} all=${m.all_reschedule_events}`)

// לקוחה ללא תורים
const noAppts = await one(`select * from customer_crm_metrics where customer_id=$1`, [C2])
chk('לקוחה כמעט ללא נתונים עדיין מקבלת מדדים',
  noAppts.completed_count === 0 && noAppts.no_show_count === 0)

r = (await one(`select list_crm_customers() j`)).j
chk('⚠️ לקוחה ללא appointments עדיין מופיעה ברשימה',
  r.items.some(i => i.id === C2), `n=${r.items.length}`)

// פעילות אחרונה
const la = await one(`select last_activity_at, $2::timestamptz base
                      from customer_crm_metrics where customer_id=$1`, [C1, days(-999)])
chk('פעילות אחרונה מחושבת ואינה ריקה', la.last_activity_at !== null)

const before = await one(`select last_activity_at from customer_crm_metrics where customer_id=$1`, [C4])
await db.query(`select set_customer_crm_status($1,'inactive',$2)`, [C4, ADMIN_A])
const after = await one(`select last_activity_at from customer_crm_metrics where customer_id=$1`, [C4])
chk('⚠️ פעילות CRM מעדכנת את הפעילות האחרונה',
  new Date(after.last_activity_at).getTime() >= new Date(before.last_activity_at).getTime())

// אין כסף בשום מקום ב-view
const viewCols = (await q(`select column_name from information_schema.columns
                           where table_name='customer_crm_metrics'`)).map(r => r.column_name)
chk('⚠️ אין שדה כספי ב-view המדדים',
  !viewCols.some(c => /price|revenue|ltv|paid|amount|total_spent/i.test(c)),
  viewCols.length + ' עמודות')

// ============================================================================
section('פילטרים')
// ============================================================================

const totalNow = (await one(`select list_crm_customers() j`)).j.total_count

r = (await one(`select list_crm_customers(null,'has_future') j`)).j
chk('סינון "עם תור עתידי"', r.items.every(i => i.next_confirmed_starts_at !== null)
  && r.items.some(i => i.id === C4))
chk('⚠️ total_count תואם ל-items בסינון', r.total_count === r.items.length)

r = (await one(`select list_crm_customers(null,'no_future') j`)).j
chk('סינון "ללא תור עתידי"', r.items.every(i => i.next_confirmed_starts_at === null))
chk('שני הסינונים משלימים זה את זה', r.total_count + 1 === totalNow, `${r.total_count}+1 vs ${totalNow}`)

r = (await one(`select list_crm_customers(null,'no_show') j`)).j
chk('סינון אי-הגעה', r.total_count === 1 && r.items[0].id === C4)

r = (await one(`select list_crm_customers(null,'cancelled') j`)).j
chk('סינון ביטולים', r.total_count === 1 && r.items[0].id === C4)

r = (await one(`select list_crm_customers(null,'returning') j`)).j
chk('סינון לקוחות חוזרות (יותר מטיפול אחד)', r.total_count === 1 && r.items[0].id === C4)

r = (await one(`select list_crm_customers(null,'inactive') j`)).j
chk('סינון לא פעילות', r.items.every(i => i.crm_status === 'inactive') && r.total_count >= 1)

r = (await one(`select list_crm_customers(null,'active') j`)).j
chk('סינון פעילות', r.items.every(i => i.crm_status === 'active'))

r = (await one(`select list_crm_customers(null,'all','instagram') j`)).j
chk('סינון לפי מקור הגעה', r.total_count === 1 && r.items[0].id === C1)
chk('⚠️ total_count תואם ל-items בסינון מקור', r.total_count === r.items.length)

r = (await one(`select list_crm_customers(null,'all',null,'name',$1,null) j`, [days(-1)])).j
chk('סינון טווח תאריך הצטרפות (מ-)', r.total_count === totalNow)

r = (await one(`select list_crm_customers(null,'all',null,'name',null,$1) j`, [days(-999)])).j
chk('סינון טווח תאריך הצטרפות (עד-)', r.total_count === 0)

// אותם פילטרים על items ועל total תחת pagination
r = (await one(`select list_crm_customers(null,'has_future',null,'name',null,null,1,0) j`)).j
chk('⚠️ פילטר + pagination: total אינו מושפע מה-limit',
  r.items.length === 1 && r.total_count === 1)

// ============================================================================
section('אין N+1 ואין הרשאות פתוחות')
// ============================================================================

const plan = (await q(`explain (format json)
  select list_crm_customers(null,'all',null,'last_activity',null,null,25,0)`))
chk('הרשימה היא statement יחיד', plan.length === 1)

const funcs = (await q(`
  select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('list_crm_customers','get_crm_customer','set_customer_crm_status','set_customer_source',
     'create_customer_note','update_customer_note','archive_customer_note',
     'assert_crm_actor_is_admin') order by 1`)).map(r => r.proname)
chk('כל 8 הפונקציות של 0009 קיימות', funcs.length === 8, funcs.length + '')

for (const role of ['anon', 'authenticated']) {
  const open = await one(`
    select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('list_crm_customers','get_crm_customer','set_customer_crm_status','set_customer_source',
       'create_customer_note','update_customer_note','archive_customer_note',
       'assert_crm_actor_is_admin')
      and has_function_privilege($1, p.oid, 'EXECUTE')`, [role])
  chk(`אף RPC של 0009 אינו פתוח ל-${role}`, open.c === 0, `c=${open.c}`)
}

const svc = await one(`
  select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('list_crm_customers','get_crm_customer','set_customer_crm_status','set_customer_source',
     'create_customer_note','update_customer_note','archive_customer_note',
     'assert_crm_actor_is_admin')
    and has_function_privilege('service_role', p.oid, 'EXECUTE')`)
chk('כל ה-RPCs פתוחים ל-service_role', svc.c === 8, `c=${svc.c}`)

for (const role of ['anon', 'authenticated']) {
  const v = await one(`select has_table_privilege($1,'public.customer_crm_metrics','SELECT') p`, [role])
  chk(`view המדדים חסום ל-${role}`, v.p === false)
}
const vsvc = await one(`select has_table_privilege('service_role','public.customer_crm_metrics','SELECT') p`)
chk('view המדדים פתוח ל-service_role', vsvc.p === true)

// ============================================================================
console.log(`\n${'═'.repeat(60)}`)
const failed = results.filter(r => !r).length
if (failed === 0) {
  console.log(`✓ כל ${results.length} הבדיקות עברו`)
} else {
  console.log(`✗ ${failed} מתוך ${results.length} הבדיקות נכשלו`)
  process.exit(1)
}
