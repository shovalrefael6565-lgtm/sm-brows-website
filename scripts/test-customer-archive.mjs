/**
 * הסרת לקוחה מרשימת הלקוחות (ארכוב) — רגרסיה מלאה.
 *
 * ─── מה נבדק כאן ולמה דווקא כאן ─────────────────────────────────────────────
 *
 *   1. **אין hard delete.** הארכוב מסמן שני שדות, ותו לא. כל ההיסטוריה —
 *      תורים, יומן, הערות, תזכורות, הסכמת דיוור, הסרה מדיוור וקמפיינים —
 *      נשארת בדיוק כפי שהייתה. זו הבדיקה שהופכת "ארכיון" למשהו שאפשר
 *      לסמוך עליו.
 *   2. **הסתרה אמיתית + שלושת המצבים** (0036): פעילות / בארכיון / הכל.
 *   3. **החזרה** מנקה את שני השדות יחד (ה-CHECK אוסר אחרת).
 *   4. 🔴 **לקוחה בארכיון עם אותו מספר אינה יכולה לייצר כרטיס כפול** —
 *      לא במסלול ההזמנה הציבורי ולא ביצירה ידנית של מנהלת.
 *   5. 🔴 **לקוחה שחזרה לקבוע תור מוחזרת אוטומטית לרשימה** — אחרת היה
 *      נשאר תור חי בעתיד על כרטיס שנעלם מהמסך, בדיוק המצב
 *      ש-archive_customer חוסמת מהכיוון ההפוך.
 *   6. **דיוור:** לקוחה בארכיון אינה מועמדת לקמפיין, ואינה נכנסת ל"בחרי
 *      הכול" — בלי לגעת בהסכמה או בהסרה שלה.
 *
 * PGlite בזיכרון. אפס כתיבות לייצור, אפס רשת, אפס SMS.
 *
 * הרצה:  npm run test:customer-archive
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

let pass = 0, fail = 0
const chk = (name, ok = true, extra = '') => {
  if (ok) pass++; else fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = p => readFileSync(join(ROOT, p), 'utf8')
const stripComments = s =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const listPageSrc    = src('app/admin/(protected)/customers/page.tsx')
const buttonSrc      = src('components/admin/CustomerArchiveButton.tsx')
const controlsSrc    = src('components/admin/CustomerAdminControls.tsx')
const filtersSrc     = src('components/admin/CustomerFilters.tsx')
const crmDbSrc       = src('lib/db/crm.ts')
const marketingDbSrc = src('lib/db/marketing.ts')
const publicRouteSrc = src('app/api/bookings/request/route.ts')
const acctRouteSrc   = src('app/api/appointments/route.ts')
const adminApptSrc   = src('app/api/admin/appointments/route.ts')
const archiveApiSrc  = src('app/api/admin/customers/[id]/archive/route.ts')

// ════════════════════════════════════════════════════════════════════════════
section('הפעולה קיימת בכל שורת לקוחה, ובנוסח אחד')
// ════════════════════════════════════════════════════════════════════════════

const CONFIRM = 'הלקוחה תוסר מהרשימה הפעילה אך היסטוריית התורים והפעילות שלה תישמר.'
chk('נוסח האישור הוא בדיוק הנוסח שנדרש',
  buttonSrc.includes(`export const ARCHIVE_CONFIRM_TEXT =\n  '${CONFIRM}'`))
chk("תווית הפעולה היא 'הסרה מרשימת הלקוחות'",
  /ARCHIVE_ACTION_LABEL = 'הסרה מרשימת הלקוחות'/.test(buttonSrc))
chk("תווית ההחזרה היא 'החזרה לרשימת הלקוחות'",
  /RESTORE_ACTION_LABEL = 'החזרה לרשימת הלקוחות'/.test(buttonSrc))
chk('🔒 האישור מוצג לפני הקריאה ל-API, ולא אחריה',
  /confirmArchive\(fullName\)\) return[\s\S]{0,400}fetch\(`\/api\/admin\/customers/.test(stripComments(buttonSrc)))
chk('🔒 החזרה מהארכיון אינה דורשת אישור (אינה הרסנית)',
  /if \(!isArchived && !confirmArchive\(fullName\)\) return/.test(buttonSrc))

{
  const code = stripComments(listPageSrc)
  chk('שורת הטבלה מציגה את הפעולה',
    /<CustomerArchiveButton[\s\S]{0,160}\/>[\s\S]{0,40}<\/td>/.test(code))
  chk('כרטיס המובייל מציג את הפעולה',
    (code.match(/<CustomerArchiveButton/g) ?? []).length === 2)
  chk('🔒 הכפתור אינו מקונן בתוך ה-<Link> של הכרטיס',
    code.indexOf('</Link>') < code.lastIndexOf('<CustomerArchiveButton'))
  chk('לטבלה נוספה כותרת עמודה לפעולות', /<th[^>]*>פעולות<\/th>/.test(code))
}
chk('🔒 כרטיס הלקוחה משתמש באותו נוסח ולא בעותק משלו',
  /confirmArchive, ARCHIVE_ACTION_LABEL, RESTORE_ACTION_LABEL/.test(controlsSrc) &&
  !controlsSrc.includes(CONFIRM) &&
  !/העברה לארכיון|החזרה מהארכיון/.test(stripComments(controlsSrc)))

// ════════════════════════════════════════════════════════════════════════════
section('🔴 אין מחיקה — הפעולה מסמנת שני שדות בלבד')
// ════════════════════════════════════════════════════════════════════════════

chk('הפעולה קוראת ל-endpoint הארכוב (POST) ולמחיקה (DELETE) של אותו משאב',
  /method: isArchived \? 'DELETE' : 'POST'/.test(buttonSrc))
chk('🔒 ה-DELETE של המשאב הזה הוא "החזרה מהארכיון" ולא מחיקת לקוחה',
  /unarchiveCustomer\(params\.id, guard\.userId\)/.test(archiveApiSrc) &&
  !/deleteCustomerIfSafe/.test(archiveApiSrc))
chk('🔒 הכפתור אינו נוגע ב-endpoint המחיקה של הלקוחה',
  !/\/api\/admin\/customers\/\$\{customerId\}`/.test(buttonSrc))
chk('🔒 שכבת ה-CRM אינה מוחקת שורת לקוחה בשום מסלול ארכוב',
  !/from\('customers'\)[\s\S]{0,80}\.delete\(\)/.test(crmDbSrc))

// ════════════════════════════════════════════════════════════════════════════
section('פילטר מצב הכרטיס — פעילות / בארכיון / הכל')
// ════════════════════════════════════════════════════════════════════════════

chk('שלוש האפשרויות קיימות בדיוק בנוסח שנדרש',
  /\{ value: 'all',\s+label: 'פעילות' \}/.test(filtersSrc) &&
  /\{ value: 'archived',\s+label: 'בארכיון' \}/.test(filtersSrc) &&
  /\{ value: 'all_including_archived', label: 'הכל' \}/.test(filtersSrc))
chk('הן מוצגות כקבוצה נפרדת מהחיתוכים', /optgroup label="מצב הכרטיס"/.test(filtersSrc))
chk("🔒 'פעילה'/'לא פעילה' סומנו כסטטוס CRM, כדי שלא יתחזו למצב ארכיון",
  /label: 'סטטוס: פעילה'/.test(filtersSrc) && /label: 'סטטוס: לא פעילה'/.test(filtersSrc))
chk('CRM_FILTERS מכיר את הערך החדש', /'archived', 'all_including_archived'/.test(crmDbSrc))

// ════════════════════════════════════════════════════════════════════════════
section('החזרה אוטומטית כשלקוחה בארכיון קובעת תור')
// ════════════════════════════════════════════════════════════════════════════

chk('🔒 ההחזרה מותנית — לקוחה שאינה בארכיון אינה נכתבת כלל',
  (crmDbSrc.match(/\.not\('archived_at', 'is', null\)/g) ?? []).length === 2)
chk('🔒 שני השדות מתנקים יחד (ה-CHECK אוסר אחרת)',
  (crmDbSrc.match(/update\(\{ archived_at: null, archived_by: null \}\)/g) ?? []).length === 2)
chk('🔒 ההחזרה אינה כותבת customer_crm_activity (אין actor ללקוחה עצמה)',
  !/restoreArchivedCustomer[\s\S]{0,900}customer_crm_activity/.test(crmDbSrc))

for (const [name, code, call] of [
  ['bookings/request (ציבורי)', publicRouteSrc, 'restoreArchivedCustomerByPhoneOnBooking(phone)'],
  ['appointments (אזור אישי)',  acctRouteSrc,   'restoreArchivedCustomerOnBooking(customer.id)'],
  ['admin/appointments (ידני)', adminApptSrc,   'restoreArchivedCustomerOnBooking(customer.id)'],
]) {
  const clean = stripComments(code)
  chk(`${name}: מחזיר את הכרטיס מהארכיון אחרי יצירת התור`, clean.includes(call))
  const iCreate = Math.max(
    clean.indexOf('createPublicBookingRequest('),
    clean.indexOf('createPersonalAreaBookingRequest('),
    clean.indexOf('createManualAppointment('),
  )
  chk(`🔒 ${name}: ההחזרה קורית אחרי היצירה, לא לפניה`,
    iCreate !== -1 && clean.indexOf(call) > iCreate)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 דיוור: לקוחה בארכיון אינה מועמדת, וההסכמה שלה לא נגעה')
// ════════════════════════════════════════════════════════════════════════════

chk('רשימת המועמדות לקמפיין מסננת ארכיון ב-DB',
  /listMarketingCandidates[\s\S]{0,700}\.is\('archived_at', null\)/.test(marketingDbSrc))
chk("🔒 גם בזמן השליחה קיים דילוג 'archived' (לקוחה שאורכבה אחרי בניית הרשימה)",
  /skipReason: 'archived'/.test(src('lib/marketing/decide.ts')))
chk('🔒 הארכוב אינו נוגע בעמודות ההסכמה או ההסרה',
  !/marketing_consent|marketing_opted_out_at/.test(stripComments(buttonSrc)) &&
  !/marketing_consent|marketing_opted_out_at/.test(stripComments(archiveApiSrc)))

// ════════════════════════════════════════════════════════════════════════════
section('מול DB אמיתי (PGlite) — כל המיגרציות, כולל 0036')
// ════════════════════════════════════════════════════════════════════════════

const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, phone text);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid language sql stable
    security definer set search_path = auth as $$ select uid from auth._session limit 1 $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
`)

const q = async (sql, p = []) => (await db.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const uuid = () => crypto.randomUUID()

const ADMIN = uuid()
for (const name of MIGRATIONS) {
  if (name.startsWith('0010')) {
    await db.exec(`
      insert into auth.users values ('${ADMIN}', '972541110002');
      insert into customers (id, phone_e164, full_name) values ('${ADMIN}', '+972541110002', 'שובל');
      insert into admins (user_id) values ('${ADMIN}');`)
  }
  try {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  } catch (e) {
    chk(`${name.slice(0, 4)} רצה ללא שגיאה`, false, e.message)
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו, ו-0036 אימתה את עצמה`)

const PHONE = '+972521230001'
const GONE = uuid(), STAYS = uuid(), BUSY_C = uuid()
await db.exec(`insert into customers (id, phone_e164, full_name) values
  ('${GONE}',   '${PHONE}',        'לקוחה שמוסרת'),
  ('${STAYS}',  '+972521230002',   'לקוחה שנשארת'),
  ('${BUSY_C}', '+972521230003',   'לקוחה עם תור עתידי');`)

const mkAppt = async (customerId, startsAt, status) => {
  const id = uuid()
  await db.query(
    `insert into appointments (id, customer_id, service_key, variants, price_total,
       starts_at, ends_at, duration_min, status)
     values ($1,$2,'עיצוב גבות טבעיות','{}',120,$3::timestamptz,$3::timestamptz + interval '20 minutes',20,$4)`,
    [id, customerId, startsAt, status])
  return id
}

// היסטוריה שחייבת לשרוד: תור שהושלם, תזכורת, הערה, יומן, הסכמת דיוור וקמפיין
const pastAppt = await mkAppt(GONE, new Date(Date.now() - 30 * 864e5).toISOString(), 'completed')
await db.query(
  `insert into appointment_reminders (appointment_id, reminder_kind, appointment_starts_at,
     scheduled_for, expires_at, status)
   values ($1, 'day_before', now() - interval '31 days', now() - interval '31 days',
           now() - interval '30 days', 'scheduled')`, [pastAppt])
await db.query(
  `insert into customer_notes (customer_id, body, created_by_admin_id, client_request_id)
   values ($1, 'הערה פנימית', $2, $3)`,
  [GONE, ADMIN, uuid()])
await db.query(
  `update customers set marketing_consent = true, marketing_consent_at = now(),
     marketing_consent_source = 'booking_form' where id = $1`, [GONE])

const campaign = uuid()
await db.query(
  `insert into sms_campaigns (id, created_by, client_request_id, body, segments, provider, status)
   values ($1, $2, $3, 'הודעה', 1, 'sms_019', 'completed')`, [campaign, ADMIN, uuid()])
await db.query(
  `insert into sms_campaign_recipients (campaign_id, customer_id, phone_hash, status)
   values ($1, $2, $3, 'sent')`, [campaign, GONE, 'a'.repeat(64)])

const snapshot = async () => ({
  appts:     Number((await one(`select count(*) n from appointments where customer_id = $1`, [GONE])).n),
  history:   Number((await one(
    `select count(*) n from appointment_history h join appointments a on a.id = h.appointment_id
     where a.customer_id = $1`, [GONE])).n),
  reminders: Number((await one(
    `select count(*) n from appointment_reminders r join appointments a on a.id = r.appointment_id
     where a.customer_id = $1`, [GONE])).n),
  reminderStatus: (await one(
    `select r.status::text s from appointment_reminders r join appointments a on a.id = r.appointment_id
     where a.customer_id = $1`, [GONE]))?.s ?? null,
  notes:     Number((await one(`select count(*) n from customer_notes where customer_id = $1`, [GONE])).n),
  activity:  Number((await one(`select count(*) n from customer_crm_activity where customer_id = $1`, [GONE])).n),
  campaign:  Number((await one(`select count(*) n from sms_campaign_recipients where customer_id = $1`, [GONE])).n),
  consent:   (await one(
    `select marketing_consent, marketing_consent_at, marketing_opted_out_at from customers where id = $1`,
    [GONE])),
})

const before = await snapshot()

// ── הארכוב עצמו ────────────────────────────────────────────────────────────
const archived = await one(`select public.archive_customer($1, $2) as j`, [GONE, ADMIN])
chk("archive_customer מחזירה 'archived'", archived.j.outcome === 'archived')
{
  const row = await one(`select archived_at, archived_by from customers where id = $1`, [GONE])
  chk('archived_at נכתב', row.archived_at !== null)
  chk('archived_by = מזהה המנהלת שביצעה', row.archived_by === ADMIN)
}
chk('הלקוחה עדיין קיימת בטבלה (אין hard delete)',
  Number((await one(`select count(*) n from customers where id = $1`, [GONE])).n) === 1)

const after = await snapshot()
chk('🔴 התורים נשארו', after.appts === before.appts && after.appts > 0)
chk('🔴 היסטוריית התורים נשארה', after.history === before.history)
chk('🔴 התזכורות לא נמחקו', after.reminders === before.reminders && after.reminders === 1)
chk('🔴 סטטוס התזכורת לא השתנה בגלל הארכוב',
  after.reminderStatus === before.reminderStatus && after.reminderStatus === 'scheduled')
chk('🔴 ההערות נשארו', after.notes === before.notes && after.notes === 1)
chk('🔴 שורת הקמפיין נשארה', after.campaign === before.campaign && after.campaign === 1)
chk('🔴 הסכמת הדיוור לא השתנתה',
  after.consent.marketing_consent === before.consent.marketing_consent &&
  String(after.consent.marketing_consent_at) === String(before.consent.marketing_consent_at) &&
  after.consent.marketing_opted_out_at === null)
chk('יומן ה-CRM קיבל שורת ארכוב אחת (עם actor)',
  after.activity === before.activity + 1 &&
  (await one(`select action, actor_admin_id from customer_crm_activity
              where customer_id = $1 order by created_at desc limit 1`, [GONE])).action === 'archived')

// ── הסתרה + שלושת המצבים ───────────────────────────────────────────────────
const listIds = async filter => {
  const r = await one(
    `select public.list_crm_customers(null, $1, null, 'name', null, null, 100, 0) as j`, [filter])
  return r.j.items.map(i => i.id)
}
chk('ברירת המחדל אינה מציגה לקוחה בארכיון', !(await listIds('all')).includes(GONE))
chk('חיתוך רגיל אינו מציג אותה גם הוא', !(await listIds('no_show')).includes(GONE))
{
  const archivedOnly = await listIds('archived')
  chk("'בארכיון' מציג אותה", archivedOnly.includes(GONE))
  chk("'בארכיון' אינו מציג לקוחה פעילה", !archivedOnly.includes(STAYS))
}
{
  const all = await listIds('all_including_archived')
  chk("'הכל' מציג את שתי הקבוצות יחד", all.includes(GONE) && all.includes(STAYS))
}
chk('🔒 ערך פילטר לא מוכר נופל לרשימה הפעילה (ולא חושף ארכיון)',
  !(await listIds('made_up_value')).includes(GONE))
chk('הכרטיס הבודד ממשיך להיטען (אחרת אי אפשר להחזיר אותה)',
  (await one(`select public.get_crm_customer($1) as j`, [GONE])).j.id === GONE)

// ── חסימה כשיש תור פעיל בעתיד ──────────────────────────────────────────────
await mkAppt(BUSY_C, new Date(Date.now() + 5 * 864e5).toISOString(), 'confirmed')
{
  const r = await one(`select public.archive_customer($1, $2) as j`, [BUSY_C, ADMIN])
  chk('🔒 הסרה חסומה כשיש תור פעיל בעתיד', r.j.outcome === 'blocked_active_appointments')
  chk('הכרטיס נשאר פעיל אחרי החסימה',
    (await one(`select archived_at from customers where id = $1`, [BUSY_C])).archived_at === null)
}

// ── 🔴 אין כפילות: אותו מספר, אותה לקוחה ───────────────────────────────────
{
  const r = await one(
    `select (public.link_or_create_customer_by_phone($1, $2)).id as id`,
    [PHONE, 'לקוחה שמוסרת'])
  chk('🔴 הזמנה ציבורית עם מספר של לקוחה בארכיון מחזירה את אותה לקוחה',
    r.id === GONE, r.id === GONE ? '' : String(r.id))
  chk('🔴 ולא נוצר כרטיס שני לאותו מספר',
    Number((await one(`select count(*) n from customers where phone_e164 = $1`, [PHONE])).n) === 1)
}
{
  const r = await one(
    `select public.create_manual_customer($1, $2, 'instagram', 'active', $3, $4, $5) as j`,
    ['לקוחה שמוסרת', PHONE, ADMIN, uuid(), 'b'.repeat(64)])
  chk('🔴 יצירה ידנית של מנהלת עם אותו מספר מחזירה את הכרטיס הקיים',
    r.j.result === 'existing_customer' && r.j.customer_id === GONE)
  chk('🔴 ועדיין אין כפילות',
    Number((await one(`select count(*) n from customers where phone_e164 = $1`, [PHONE])).n) === 1)
}

// ── ההחזרה האוטומטית שהאפליקציה מבצעת ──────────────────────────────────────
{
  // בדיוק ה-UPDATE של restoreArchivedCustomer*OnBooking
  await db.query(
    `update customers set archived_at = null, archived_by = null
     where phone_e164 = $1 and archived_at is not null`, [PHONE])
  const row = await one(`select archived_at, archived_by from customers where id = $1`, [GONE])
  chk('🔴 לקוחה שקבעה תור חזרה לרשימה הפעילה',
    row.archived_at === null && row.archived_by === null)
  chk('היא מופיעה שוב בברירת המחדל', (await listIds('all')).includes(GONE))
  chk('🔒 ההיסטוריה שרדה גם את החזרה',
    (await snapshot()).appts === before.appts)
}
{
  const untouched = await one(
    `with upd as (
       update customers set archived_at = null, archived_by = null
       where id = $1 and archived_at is not null returning 1)
     select count(*) n from upd`, [STAYS])
  chk('🔒 לקוחה פעילה אינה נכתבת כלל ע"י ההחזרה', Number(untouched.n) === 0)
}

// ── ההחזרה הידנית של המנהלת ────────────────────────────────────────────────
{
  await db.query(`select public.archive_customer($1, $2)`, [GONE, ADMIN])
  const r = await one(`select public.unarchive_customer($1, $2) as j`, [GONE, ADMIN])
  chk("unarchive_customer מחזירה 'unarchived'", r.j.outcome === 'unarchived')
  const row = await one(`select archived_at, archived_by from customers where id = $1`, [GONE])
  chk('שני השדות נוקו יחד', row.archived_at === null && row.archived_by === null)
  const again = await one(`select public.unarchive_customer($1, $2) as j`, [GONE, ADMIN])
  chk('קריאה שנייה אינה שגיאה (אידמפוטנטית)', again.j.outcome === 'not_archived')
}
chk('🔒 אי אפשר לנקות רק אחד מהשדות (CHECK של 0028)',
  await (async () => {
    try {
      await db.query(`update customers set archived_at = now() where id = $1`, [STAYS])
      return false
    } catch { return true }
  })())

// ── דיוור ──────────────────────────────────────────────────────────────────
{
  await db.query(`select public.archive_customer($1, $2)`, [GONE, ADMIN])
  // בדיוק השאילתה של listMarketingCandidates
  const candidates = await q(
    `select id from customers where archived_at is null and is_blocked = false`)
  const ids = candidates.map(c => c.id)
  chk('🔴 לקוחה בארכיון אינה מועמדת לקמפיין ואינה נכנסת ל"בחרי הכול"', !ids.includes(GONE))
  chk('לקוחה פעילה כן מועמדת', ids.includes(STAYS))
  const c = await one(
    `select marketing_consent, marketing_opted_out_at from customers where id = $1`, [GONE])
  chk('🔒 והכל בלי לגעת בהסכמה או בהסרה שלה',
    c.marketing_consent === true && c.marketing_opted_out_at === null)
}

await db.close()

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} עברו, ${fail} נכשלו`)
process.exit(fail === 0 ? 0 : 1)
