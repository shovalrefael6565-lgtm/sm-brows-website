/**
 * דיוור SMS מול DB אמיתי (PGlite), עם כל המיגרציות כולל 0035.
 *
 * ─── מה נבדק כאן ואי אפשר לבדוק בשום מקום אחר ─────────────────────────────
 *
 * test-bulk-sms.mjs מוכיח את ההחלטות. כאן נבדק מה שה-**מסד** אוכף, ושעליו
 * הזרימה נשענת במקום על תנאי בקוד:
 *
 *   1. 0035 עצמה: הסכמה, הסרה, ושתי טבלאות הקמפיין.
 *   2. 🔴 אפס הסכמה רטרואקטיבית.
 *   3. `unique (campaign_id, phone_hash)` — אותו מספר לא נשלח פעמיים.
 *   4. תפיסת שורה מותנית — שתי ריצות מקבילות לא שולחות לאותה נמענת.
 *   5. `unique (client_request_id)` — הגשה כפולה אינה יוצרת קמפיין שני.
 *   6. הסרה אידמפוטנטית, ו-token ישן שנשאר תקף.
 *   7. המסלול התפעולי לא נגוע.
 *
 * PGlite בזיכרון. אפס כתיבות לייצור, אפס רשת, אפס SMS.
 *
 * הרצה:  npm run test:bulk-sms-db
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

let pass = 0, fail = 0
const chk = (name, ok = true, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
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
const fails = async (sql, p = []) => { try { await db.query(sql, p); return false } catch { return true } }

const ADMIN = uuid()
section('הרצת כל המיגרציות, כולל 0035')
for (const name of MIGRATIONS) {
  if (name.startsWith('0010')) {
    await db.exec(`
      insert into auth.users values ('${ADMIN}', '972541110002');
      insert into customers (id, phone_e164, full_name) values ('${ADMIN}', '+972541110002', 'שובל');
      insert into admins (user_id) values ('${ADMIN}');`)
  }
  // ⚠️ לקוחות נוצרות **לפני** 0035, כדי שהבדיקה "אפס הסכמה רטרואקטיבית"
  // תהיה בעלת משמעות: הן קיימות ברגע שהעמודות נוספות.
  if (name.startsWith('0035')) {
    await db.exec(`insert into customers (id, phone_e164, full_name) values
      ('${(globalThis.C1 = uuid())}', '+972521111111', 'לקוחה ותיקה'),
      ('${(globalThis.C2 = uuid())}', '+972522222222', 'לקוחה שנייה'),
      ('${(globalThis.C3 = uuid())}', '+972523333333', 'לקוחה שלישית');`)
  }
  try {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  } catch (e) {
    chk(`${name.slice(0, 4)} רצה ללא שגיאה`, false, e.message)
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו, ו-0035 אימתה את עצמה`)
const { C1, C2, C3 } = globalThis

process.env.MARKETING_OPT_OUT_SECRET_V1 = 'db-test-secret-'.padEnd(48, 'y')
const T = await import('../lib/marketing/tokens.ts')
const { normalizePhone } = await import('../lib/phone.ts')
const hashOf = raw => T.phoneHash(normalizePhone(raw)).hash

// ════════════════════════════════════════════════════════════════════════════
section('🔴 אפס הסכמה רטרואקטיבית')
// ════════════════════════════════════════════════════════════════════════════

chk('שלוש לקוחות קיימו לפני 0035',
  (await one(`select count(*)::int n from customers where id in ($1,$2,$3)`, [C1, C2, C3])).n === 3)
chk('🔴 אף אחת לא סומנה כמסכימה',
  (await one(`select count(*)::int n from customers where marketing_consent`)).n === 0)
chk('ואף שדה דיוור אחר לא מולא', (await one(`select count(*)::int n from customers
  where marketing_consent_at is not null or marketing_consent_source is not null
     or marketing_opted_out_at is not null or marketing_opt_out_token_hash is not null`)).n === 0)
chk('ברירת המחדל של לקוחה חדשה היא false', await (async () => {
  const id = uuid()
  await db.query(`insert into customers (id, phone_e164, full_name) values ($1,'+972524444444','חדשה')`, [id])
  const r = await one(`select marketing_consent c from customers where id=$1`, [id])
  await db.query(`delete from customers where id=$1`, [id])
  return r.c === false
})())

// ════════════════════════════════════════════════════════════════════════════
section('מקור ההסכמה — רשימה סגורה ועדות חובה')
// ════════════════════════════════════════════════════════════════════════════

for (const srcKey of ['booking_form', 'admin_recorded', 'sms_optin']) {
  await db.query(`update customers set marketing_consent=true, marketing_consent_at=now(),
    marketing_consent_source=$2 where id=$1`, [C3, srcKey])
  chk(`מקור "${srcKey}" מתקבל`, true)
}
await db.query(`update customers set marketing_consent=false, marketing_consent_at=null,
  marketing_consent_source=null where id=$1`, [C3])
chk('מקור שאינו ברשימה נדחה', await fails(
  `update customers set marketing_consent=true, marketing_consent_at=now(),
   marketing_consent_source='instagram' where id=$1`, [C3]))
chk('הסכמה בלי עדות נדחית', await fails(
  `update customers set marketing_consent=true where id=$1`, [C3]))

// ════════════════════════════════════════════════════════════════════════════
section('🔒 dedup — 05… ו-+972… הם נמען אחד')
// ════════════════════════════════════════════════════════════════════════════

const CAMP = uuid(), RID = uuid()
await db.query(`insert into sms_campaigns (id, created_by, client_request_id, body, segments, provider)
  values ($1,$2,$3,'תזכורת לקבוע תור לחג',1,'sms_019')`, [CAMP, ADMIN, RID])

const h1 = hashOf('052-111-1111')
await db.query(`insert into sms_campaign_recipients (campaign_id, customer_id, phone_hash)
  values ($1,$2,$3)`, [CAMP, C1, h1])

chk('אותו מספר בפורמט בינלאומי מייצר אותו חותם', hashOf('+972521111111') === h1)
chk('🔒 ולכן שורה שנייה נדחית',
  await fails(`insert into sms_campaign_recipients (campaign_id, customer_id, phone_hash)
    values ($1,$2,$3)`, [CAMP, C2, hashOf('+972521111111')]))
const skipped = await q(`insert into sms_campaign_recipients (campaign_id, customer_id, phone_hash)
  values ($1,$2,$3) on conflict (campaign_id, phone_hash) do nothing returning id`,
  [CAMP, C2, hashOf('0521111111')])
chk('on conflict do nothing מדלג בשקט', skipped.length === 0)
chk('נשארה נמענת אחת בלבד למספר הזה',
  (await one(`select count(*)::int n from sms_campaign_recipients where campaign_id=$1 and phone_hash=$2`,
    [CAMP, h1])).n === 1)
chk('⚠️ אותו מספר בקמפיין **אחר** כן מותר', await (async () => {
  const c2 = uuid()
  await db.query(`insert into sms_campaigns (id, created_by, client_request_id, body, segments, provider)
    values ($1,$2,$3,'קמפיין אחר',1,'sms_019')`, [c2, ADMIN, uuid()])
  await db.query(`insert into sms_campaign_recipients (campaign_id, customer_id, phone_hash)
    values ($1,$2,$3)`, [c2, C1, h1])
  return true
})())

// ════════════════════════════════════════════════════════════════════════════
section('🔒 תפיסת שורה — שתי ריצות לא שולחות פעמיים')
// ════════════════════════════════════════════════════════════════════════════

{
  const claim = `update sms_campaign_recipients set attempted_at=now()
    where id=$1 and status='pending' and attempted_at is null returning id`
  const row = await one(`select id from sms_campaign_recipients where campaign_id=$1 and phone_hash=$2`,
    [CAMP, h1])
  const a = await q(claim, [row.id])
  const b = await q(claim, [row.id])
  chk('הריצה הראשונה תופסת', a.length === 1)
  chk('🔒 הריצה השנייה אינה תופסת דבר', b.length === 0)

  await db.query(`update sms_campaign_recipients set status='sent' where id=$1`, [row.id])
  const c = await q(claim, [row.id])
  chk('🔒 נמענת שכבר sent אינה נתפסת שוב', c.length === 0)

  // retry אחרי כשל חלקי: שורה שנתפסה ולא הושלמה מסומנת failed ולא נשלחת שוב
  const orphan = await one(`insert into sms_campaign_recipients (campaign_id, customer_id, phone_hash, attempted_at)
    values ($1,$2,$3, now()) returning id`, [CAMP, C3, hashOf('052-333-3333')])
  const rescued = await q(`update sms_campaign_recipients set status='failed', error_code='interrupted'
    where campaign_id=$1 and status='pending' and attempted_at is not null returning id`, [CAMP])
  chk('שורה שנתפסה בריצה שקרסה מסומנת failed', rescued.some(r => r.id === orphan.id))
  chk('⚠️ ולא נשלחת שוב — היא כבר אינה pending',
    (await one(`select status s from sms_campaign_recipients where id=$1`, [orphan.id])).s === 'failed')
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 הגשה כפולה אינה יוצרת קמפיין שני')
// ════════════════════════════════════════════════════════════════════════════

chk('אותו client_request_id נדחה', await fails(
  `insert into sms_campaigns (created_by, client_request_id, body, segments, provider)
   values ($1,$2,'שוב',1,'sms_019')`, [ADMIN, RID]))
chk('גם ממנהלת אחרת (unique גלובלי)', await fails(
  `insert into sms_campaigns (created_by, client_request_id, body, segments, provider)
   values (null,$1,'שוב',1,'sms_019')`, [RID]))
chk('ואפשר לאתר את הקמפיין הקיים לפי המזהה',
  (await one(`select id from sms_campaigns where client_request_id=$1`, [RID])).id === CAMP)

// ════════════════════════════════════════════════════════════════════════════
section('🔴 הסרה מדיוור — חסימה קשה, אידמפוטנטית, ו-token יציב')
// ════════════════════════════════════════════════════════════════════════════

{
  const tok = T.deriveOptOutToken(C2).token
  await db.query(`update customers set marketing_opt_out_token_hash=$2,
    marketing_opt_out_token_version=1 where id=$1`, [C2, T.optOutTokenHash(tok)])

  const found = await one(`select id from customers where marketing_opt_out_token_hash=$1`,
    [T.optOutTokenHash(tok)])
  chk('העמוד מוצא את הלקוחה לפי חותם ה-token', found?.id === C2)
  chk('⚠️ ה-token עצמו אינו במסד',
    (await one(`select count(*)::int n from customers where marketing_opt_out_token_hash=$1`, [tok])).n === 0)

  // 🔒 קישור ישן נשאר תקף — ה-token נגזר, וקמפיין נוסף מייצר אותו token
  chk('🔒 קמפיין נוסף מייצר את אותו token', T.deriveOptOutToken(C2).token === tok)
  chk('ולכן קישור מהודעה ישנה עדיין מוצא אותה',
    (await one(`select id from customers where marketing_opt_out_token_hash=$1`,
      [T.optOutTokenHash(T.deriveOptOutToken(C2).token)]))?.id === C2)

  // ההסרה עצמה, ואידמפוטנטיות
  const optOut = `update customers set marketing_opted_out_at=now()
    where id=$1 and marketing_opted_out_at is null returning marketing_opted_out_at`
  const first = await q(optOut, [C2])
  const second = await q(optOut, [C2])
  chk('ההסרה הראשונה מסמנת', first.length === 1)
  chk('🔒 השנייה אינה משנה דבר (אידמפוטנטי)', second.length === 0)
  chk('וזמן ההסרה נשאר של הפעם הראשונה',
    String((await one(`select marketing_opted_out_at o from customers where id=$1`, [C2])).o)
      === String(first[0].marketing_opted_out_at))

  // 🔴 הסרה גוברת על הסכמה
  await db.query(`update customers set marketing_consent=true, marketing_consent_at=now(),
    marketing_consent_source='booking_form' where id=$1`, [C2])
  chk('🔴 גם עם הסכמה — מי שהסירה אינה זכאית',
    (await one(`select count(*)::int n from customers where id=$1 and marketing_consent
      and marketing_opted_out_at is null`, [C2])).n === 0)

  /*
   * 🔴 הסרה עצמית **אינה** נכתבת ל-customer_crm_activity.
   *
   * actor_admin_id שם הוא NOT NULL, והטבלה היא יומן פעולות של מנהלת.
   * ללקוחה שמסירה את עצמה אין actor, וניסיון לכתוב בלי אחד נכשל ב-23502
   * — כלומר היה מפיל את ההסרה הראשונה שלקוחה כלשהי מבצעת.
   */
  chk('🔴 כתיבת אודיט בלי actor אכן נכשלת — ולכן אין כזו במסלול ההסרה',
    await fails(`insert into customer_crm_activity (customer_id, action, new_value)
      values ($1,'marketing_opted_out','self')`, [C2]))
  chk('ומסלול ההסרה אינו כותב ל-customer_crm_activity',
    !/from\('customer_crm_activity'\)[\s\S]{0,80}insert/.test(
      readFileSync(join(ROOT, 'lib', 'db', 'marketing.ts'), 'utf8')))
  chk('הרישום הסמכותי הוא marketing_opted_out_at עצמו',
    (await one(`select marketing_opted_out_at o from customers where id=$1`, [C2])).o !== null)
  chk('⚠️ אבל הערך קיים ב-CHECK, למקרה שמנהלת מתעדת הסרה (שם יש actor)',
    await (async () => {
      await db.query(`insert into customer_crm_activity (customer_id, action, actor_admin_id, new_value)
        values ($1,'marketing_opted_out',$2,'admin')`, [C2, ADMIN])
      return true
    })())
}

// ════════════════════════════════════════════════════════════════════════════
section('סיבות דילוג — כולן, כולל השתיים החדשות')
// ════════════════════════════════════════════════════════════════════════════

{
  const camp = uuid()
  await db.query(`insert into sms_campaigns (id, created_by, client_request_id, body, segments, provider)
    values ($1,$2,$3,'בדיקת סיבות',1,'sms_019')`, [camp, ADMIN, uuid()])
  for (const r of ['no_consent','opted_out','archived','blocked','duplicate_phone','invalid_phone','phone_changed']) {
    await db.query(`insert into sms_campaign_recipients (campaign_id, phone_hash, status, skip_reason)
      values ($1,$2,'skipped',$3)`, [camp, T.optOutTokenHash(r), r])
  }
  chk('שבע הסיבות מתקבלות',
    (await one(`select count(*)::int n from sms_campaign_recipients where campaign_id=$1`, [camp])).n === 7)
  chk('סיבה שאינה ברשימה נדחית', await fails(
    `insert into sms_campaign_recipients (campaign_id, phone_hash, status, skip_reason)
     values ($1,$2,'skipped','because')`, [camp, 'f'.repeat(64)]))

  // 🔴 מספר שהוחלף: החותם מחושב מחדש, אינו תואם, והשורה מדולגת
  const stored = hashOf('052-777-7777')
  const rid = (await one(`insert into sms_campaign_recipients (campaign_id, customer_id, phone_hash)
    values ($1,$2,$3) returning id`, [camp, C1, stored])).id
  await db.query(`update customers set phone_e164='+972528888888' where id=$1`, [C1])
  const now = hashOf((await one(`select phone_e164 p from customers where id=$1`, [C1])).p)
  chk('החותם החדש אינו תואם לשמור', now !== stored)
  await db.query(`update sms_campaign_recipients set status='skipped', skip_reason='phone_changed'
    where id=$1`, [rid])
  chk('🔴 השורה מדולגת כ-phone_changed',
    (await one(`select skip_reason s from sms_campaign_recipients where id=$1`, [rid])).s === 'phone_changed')
  chk('⚠️ ולא נוצרה שורה למספר החדש',
    (await one(`select count(*)::int n from sms_campaign_recipients where campaign_id=$1 and phone_hash=$2`,
      [camp, now])).n === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 המסלול התפעולי לא נגוע')
// ════════════════════════════════════════════════════════════════════════════

chk('אין עמודת דיוור בטבלאות ה-SMS התפעולי',
  (await one(`select count(*)::int n from information_schema.columns where table_schema='public'
    and table_name in ('appointment_reminders','appointment_notifications')
    and column_name like '%marketing%'`)).n === 0)
chk('ואין בהן עמודת opt-out',
  (await one(`select count(*)::int n from information_schema.columns where table_schema='public'
    and table_name in ('appointment_reminders','appointment_notifications')
    and column_name like '%opt%'`)).n === 0)
chk('טבלאות הקמפיין סגורות בפני anon/authenticated',
  (await one(`select count(*)::int n from information_schema.role_table_grants
    where table_schema='public' and table_name in ('sms_campaigns','sms_campaign_recipients')
      and grantee in ('anon','authenticated')`)).n === 0)
/*
 * 🔴 ההוכחה המרכזית להפרדה: כל הפונקציות שמזמנות, תופסות ומסיימות תזכורת
 * והתראה — אף אחת מהן אינה מזכירה דיוור או הסרה ממנו. הסרה מדיוור אינה
 * יכולה למנוע תזכורת, ביטול, שינוי מועד או OTP, כי הקוד שם פשוט אינו
 * קורא את השדה.
 */
{
  const names = ['sync_appointment_reminders', 'claim_due_reminder', 'reminder_precheck',
                 'finish_reminder_attempt', 'sweep_expired_reminders', 'create_manual_reminder']
  const rows = await q(`select p.proname, p.prosrc from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname = any($1)`, [names])
  chk(`נמצאו ${rows.length} מפונקציות התזכורות`, rows.length >= 5, rows.map(r => r.proname).join(', '))
  const polluted = rows.filter(r => /marketing|opted_out/i.test(r.prosrc))
  chk('🔴 אף פונקציית תזכורת אינה קוראת דיוור/הסרה', polluted.length === 0,
    polluted.map(r => r.proname).join(', '))

  // וגם בפועל: לקוחה שהסירה את עצמה מקבלת תזכורות על תור חדש.
  await db.query(`update customers set marketing_opted_out_at=now()
    where id=$1 and marketing_opted_out_at is null`, [C3])
  const appt = (await one(`select public.create_manual_appointment(
      $1,'ייעוץ מיקרובליידינג','{}'::text[],null, now() + interval '5 days',30,'v1',$2,$3,$4) j`,
    [C3, ADMIN, uuid(), 'a'.repeat(64)])).j
  const reminders = await one(`select count(*)::int n from appointment_reminders where appointment_id=$1`,
    [appt.appointment_id])
  chk('🔴 לקוחה שהסירה את עצמה מדיוור — התזכורות שלה נוצרו כרגיל',
    reminders.n === 2, `reminders=${reminders.n}`)
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} עברו, ${fail} נכשלו`)
process.exit(fail === 0 ? 0 : 1)
