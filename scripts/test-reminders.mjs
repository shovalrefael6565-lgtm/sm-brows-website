/**
 * בדיקות שלב 11 — מערכת התזכורות, מול Postgres אמיתי (PGlite).
 *
 * מריצה את 0001→0011 ברצף, ואז אוכפת את *כוונת* המיגרציה:
 * חישוב הזמנים כולל מעבר שעון, חלונות התוקף, הטריגר בכל מסלול, כללי
 * ההחייאה של snapshot חוזר, ה-lease וה-recovery, ה-backoff, ובעיקר —
 * שאי אפשר לסמן הודעה כ-SMS אמיתי שנשלח כשאין ספק אמיתי.
 *
 * הרצה:  npm run test:reminders
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

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

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, phone text);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  -- ⚠️ bypassrls — כך הוא מוגדר ב-Supabase האמיתי. בלי זה service_role כאן
  -- מסונן ע"י RLS, וכל DELETE שלו מתאים לאפס שורות ו"מצליח" בלי שהטריגר
  -- נורה בכלל. בדיקה כזו הייתה עוברת מהסיבה הלא נכונה ומחמיצה את מה שקורה
  -- בפועל בייצור.
  do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
`)

const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const errOf = async (sql, params = []) => {
  try { await db.query(sql, params); return null } catch (e) { return e.message }
}
const uuid = () => crypto.randomUUID()

/**
 * מספרי בדיקה רצופים ולא אקראיים: phone_e164 הוא UNIQUE, ובדיקה שנופלת
 * אחת ל-500 הרצות על התנגשות אקראית גרועה מבדיקה שלא קיימת.
 */
let phoneSeq = 0
const nextPhone = () => '+9725' + String(41000000 + phoneSeq++)

const ADMIN_AUTH = uuid()

// ════════════════════════════════════════════════════════════════════════════
section('הרצת המיגרציות 0001→0011')
// ════════════════════════════════════════════════════════════════════════════

for (const name of MIGRATIONS) {
  if (name.startsWith('0010')) {
    await db.exec(`
      insert into auth.users values ('${ADMIN_AUTH}', '972541110002');
      insert into customers (id, phone_e164, full_name)
        values ('${ADMIN_AUTH}', '+972541110002', 'שובל');
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

chk('0011 קיימת ברשימת המיגרציות', MIGRATIONS.includes('0011_appointment_reminders.sql'))

// ════════════════════════════════════════════════════════════════════════════
section('⚠️ אין catch-all שמסתיר שגיאות ב-0011')
// ════════════════════════════════════════════════════════════════════════════

const SQL_0011 = readFileSync(join(MIGRATIONS_DIR, '0011_appointment_reminders.sql'), 'utf8')
const codeOnly0011 = SQL_0011.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')

// `exception when duplicate_object then null` הוא דפוס לגיטימי ליצירת role
// בבדיקות; מה שאסור הוא WHEN OTHERS, שבולע *כל* שגיאה כולל סכמה ו-corruption.
chk('⚠️ אין "exception when others" בשום פונקציה של 0011',
  !/exception\s+when\s+others/i.test(codeOnly0011))
chk('⚠️ אין "when others then null"',
  !/when\s+others\s+then\s+null/i.test(codeOnly0011))
chk('⚠️ אין בלוק exception כלל בפונקציות של 0011 (הטיפול הוא ON CONFLICT)',
  !/\bexception\s+when\b/i.test(codeOnly0011))

// ⚠️ אין סודות ואין ספק אמיתי בשלב הזה.
//
// הבדיקה אינה סורקת טקסט חופשי — תיעוד שמסביר "אין כאן טוקן" היה מפיל
// בדיקה כזו, וזה היה הופך אותה לרעש. מה שנבדק הוא מה שבאמת מסוכן:
// כתובת רשת שאפשר לשלוח אליה, ומחרוזת שנראית כמו סוד.
chk('⚠️ אין כתובת רשת במיגרציה — אין למי לשלוח', !/https?:\/\//i.test(codeOnly0011))
chk('⚠️ אין מחרוזת שנראית כמו סוד/טוקן',
  !/'[A-Za-z0-9+/]{24,}={0,2}'/.test(codeOnly0011))

// ⚠️ provider הוא **בדיקת פורמט ולא רשימה סגורה**.
//
// רשימה סגורה הייתה מחייבת אחד משניים, ושניהם רעים: להכניס ערך בדיקה קבוע
// לסכמת הייצור, או לשנות CHECK בשלב 12 רק כדי להכיר שם חדש. ההגנה האמיתית
// היא reminders_sent_requires_live_provider, לא רשימת השמות.
const LIVE_FIXTURE = 'fixture_live'

const providerChecks = await q(`
  select rel.relname t, pg_get_constraintdef(con.oid) d
  from pg_constraint con
  join pg_class rel   on rel.oid = con.conrelid
  join pg_namespace n on n.oid   = rel.relnamespace
  where con.contype = 'c' and n.nspname = 'public'
    and rel.relname in ('appointment_reminders', 'appointment_reminder_attempts')
    and pg_get_constraintdef(con.oid) like '%provider%'
    and pg_get_constraintdef(con.oid) not like '%status%'`)

chk('שתי הטבלאות מגבילות את provider', providerChecks.length === 2,
  `count=${providerChecks.length}`)
chk('⚠️ ההגבלה היא פורמט ולא רשימת שמות',
  providerChecks.every(c => /a-z0-9/.test(c.d) && !c.d.includes("'simulated'")),
  providerChecks.map(c => c.d.slice(0, 40)).join(' | '))

// ⚠️ אף שם ספק אינו קבוע בסכמה — לא של שלב 11 ולא של שלב 12 ולא של בדיקות.
for (const name of ['disabled', 'simulated', 'fake', LIVE_FIXTURE, 'sms_019', '019', 'twilio']) {
  chk(`⚠️ '${name}' אינו מקובע בסכמה`,
    providerChecks.every(c => !c.d.includes(`'${name}'`)))
}

// 🔒 fixture_live הוא ערך זריעה של הבדיקות בלבד — לא בקוד ולא בסכמה.
const srcOf = p => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', ...p), 'utf8')
for (const [label, path] of [
  ['provider.ts', ['lib', 'reminders', 'provider.ts']],
  ['types.ts', ['lib', 'reminders', 'types.ts']],
  ['dispatch.ts', ['lib', 'reminders', 'dispatch.ts']],
  ['db/reminders.ts', ['lib', 'db', 'reminders.ts']],
  ['route.ts', ['app', 'api', 'internal', 'reminders', 'route.ts']],
  ['0011', ['supabase', 'migrations', '0011_appointment_reminders.sql']],
]) {
  chk(`🔒 ${label} אינו מזכיר '${LIVE_FIXTURE}' ואינו מזכיר 'test_live'`,
    !srcOf(path).includes(LIVE_FIXTURE) && !srcOf(path).includes('test_live'))
}

// ════════════════════════════════════════════════════════════════════════════
section('חישוב "יום לפני" — שעת קיר ישראלית, לא החסרת 24 שעות')
// ════════════════════════════════════════════════════════════════════════════

// תור ביום א׳ 2026-10-25 בשעה 10:00 בישראל. באותו לילה ישראל עוברת לשעון
// חורף, ולכן היום שלפניו הוא +3 והתור עצמו +2.
const dst = await one(`
  select public.reminder_scheduled_for('day_before', '2026-10-25T08:00:00Z'::timestamptz, now()) d`)
chk('⚠️ מעבר שעון: התזכורת ב-10:00 שעון ישראל של היום הקודם',
  new Date(dst.d).toISOString() === '2026-10-24T07:00:00.000Z',
  new Date(dst.d).toISOString())
chk('⚠️ ההחסרה הנאיבית (24 שעות) הייתה נותנת 09:00 שעון ישראל — ולכן אינה בשימוש',
  new Date(dst.d).toISOString() !== '2026-10-24T08:00:00.000Z')

const summer = await one(`
  select public.reminder_scheduled_for('day_before', '2026-08-24T07:00:00Z'::timestamptz, now()) d`)
chk('בתוך שעון קיץ: בדיוק 24 שעות (אין מעבר באמצע)',
  new Date(summer.d).toISOString() === '2026-08-23T07:00:00.000Z')

const twoH = await one(`
  select public.reminder_scheduled_for('two_hours_before', '2026-08-24T07:00:00Z'::timestamptz, now()) d`)
chk('שעתיים לפני: שעתיים אמיתיות',
  new Date(twoH.d).toISOString() === '2026-08-24T05:00:00.000Z')

const NOW_REF = '2026-08-01T00:00:00Z'
const manual = await one(`
  select public.reminder_scheduled_for('manual', '2026-08-24T07:00:00Z'::timestamptz,
                                       '${NOW_REF}'::timestamptz) d`)
chk('ידנית: מתוזמנת לעכשיו', new Date(manual.d).toISOString() === new Date(NOW_REF).toISOString())

// ── חלונות תוקף ──────────────────────────────────────────────────────────
const win = await one(`
  select
    public.reminder_expires_at('day_before', '2026-08-24T07:00:00Z'::timestamptz,
      public.reminder_scheduled_for('day_before','2026-08-24T07:00:00Z'::timestamptz, now())) a,
    public.reminder_expires_at('two_hours_before', '2026-08-24T07:00:00Z'::timestamptz,
      '2026-08-24T05:00:00Z'::timestamptz) b,
    public.reminder_expires_at('manual', '2026-08-24T07:00:00Z'::timestamptz, now()) c`)
chk('יום לפני: תוקף 6 שעות אחרי המועד',
  new Date(win.a).toISOString() === '2026-08-23T13:00:00.000Z')
chk('⚠️ 6 שעות אחרי המועד הן עדיין 18 שעות לפני התור — אין חפיפה עם תזכורת השעתיים',
  new Date(win.a).getTime() < new Date('2026-08-24T05:00:00Z').getTime())
chk('שעתיים לפני: תוקף עד רבע שעה לפני התור',
  new Date(win.b).toISOString() === '2026-08-24T06:45:00.000Z')
chk('ידנית: תוקף עד תחילת התור',
  new Date(win.c).toISOString() === '2026-08-24T07:00:00.000Z')

// ════════════════════════════════════════════════════════════════════════════
section('הטריגר: יצירה בכל מסלול')
// ════════════════════════════════════════════════════════════════════════════

const C1 = uuid()
await db.exec(`insert into customers (id, phone_e164, full_name)
               values ('${C1}', '+972541230001', 'TEST לקוחה')`)

/**
 * יוצר תור ומחזיר את ה-id.
 *
 * ⚠️ offset=null נותן לכל תור **יום משלו**. זה אינו קישוט: ה-EXCLUDE
 * constraint appointments_no_overlap מ-0001 חל על כל תור pending/confirmed
 * בלי קשר ללקוחה, ולכן שני תורי בדיקה באותו מועד היו נכשלים על התנגשות
 * במקום לבדוק את מה שהם באו לבדוק. כל הזזה בבדיקות היא +3 שעות, ולכן היא
 * נשארת בתוך היום של אותו תור ואינה יכולה להתנגש באחר.
 */
let slotSeq = 0
const mkAppt = async (customerId, offset = null, status = 'confirmed') => {
  const iv = offset ?? `${2 + slotSeq++} days`
  const r = await one(`
    insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at, status,
                              calendar_sync_status, calendar_sync_operation)
    values ($1, 'natural', now() + $2::interval, 20, now(), $3, 'pending', 'upsert')
    returning id, starts_at`, [customerId, iv, status])
  return r
}
const remindersOf = async apptId =>
  q(`select reminder_kind, status, outcome_reason, appointment_starts_at, attempt_count,
            scheduled_for, expires_at, id
     from appointment_reminders where appointment_id = $1
     order by appointment_starts_at, reminder_kind`, [apptId])

// ── תור ידני (INSERT ישירות כ-confirmed) ─────────────────────────────────
const A1 = await mkAppt(C1)
let rows = await remindersOf(A1.id)
chk('תור confirmed שנוצר ישירות → שתי תזכורות', rows.length === 2, `count=${rows.length}`)
chk('שתיהן scheduled', rows.every(r => r.status === 'scheduled'))
chk('ה-snapshot הוא starts_at של התור',
  rows.every(r => new Date(r.appointment_starts_at).getTime() === new Date(A1.starts_at).getTime()))

// ── בקשת pending אינה מייצרת תזכורות פעילות ──────────────────────────────
const C2 = uuid()
await db.exec(`insert into customers (id, phone_e164, full_name)
               values ('${C2}', '+972541230002', 'TEST ב')`)
const A2 = await mkAppt(C2, null, 'pending')
chk('⚠️ תור pending אינו מקבל תזכורות', (await remindersOf(A2.id)).length === 0)

// ── אישור pending → confirmed ────────────────────────────────────────────
await db.exec(`update appointments set status='confirmed' where id='${A2.id}'`)
rows = await remindersOf(A2.id)
chk('אישור pending→confirmed יוצר שתי תזכורות', rows.length === 2)
chk('שתיהן scheduled אחרי אישור', rows.every(r => r.status === 'scheduled'))

// ── תור קרוב: חלון "יום לפני" כבר חלף ────────────────────────────────────
const C3 = uuid()
await db.exec(`insert into customers (id, phone_e164, full_name)
               values ('${C3}', '+972541230003', 'TEST ג')`)
const A3 = await mkAppt(C3, '3 hours')
rows = await remindersOf(A3.id)
const dayB = rows.find(r => r.reminder_kind === 'day_before')
const twoB = rows.find(r => r.reminder_kind === 'two_hours_before')
chk('תור קרוב: "יום לפני" מסומן skipped', dayB?.status === 'skipped', dayB?.status)
chk('הסיבה מדויקת ומסוננת', dayB?.outcome_reason === 'window_passed_at_creation')
chk('⚠️ התזכורת השנייה נשארת פעילה — כל חלון נבחן לחוד', twoB?.status === 'scheduled')
chk('השורה נוצרה ולא נמחקה (אודיט מלא)', rows.length === 2)

// ── תור קרוב מאוד: גם השנייה מפוספסת ────────────────────────────────────
const C4 = uuid()
await db.exec(`insert into customers (id, phone_e164, full_name)
               values ('${C4}', '+972541230004', 'TEST ד')`)
const A4 = await mkAppt(C4, '10 minutes')
rows = await remindersOf(A4.id)
chk('תור בעוד 10 דקות: שתי התזכורות skipped',
  rows.length === 2 && rows.every(r => r.status === 'skipped'))

// ════════════════════════════════════════════════════════════════════════════
section('שינוי מועד: supersede + snapshot חדש')
// ════════════════════════════════════════════════════════════════════════════

const origStarts = A1.starts_at
await db.exec(`update appointments set starts_at = starts_at + interval '3 hours' where id='${A1.id}'`)
rows = await remindersOf(A1.id)
chk('אחרי הזזה: 4 שורות (2 ישנות + 2 חדשות)', rows.length === 4, `count=${rows.length}`)
const old = rows.filter(r => new Date(r.appointment_starts_at).getTime() === new Date(origStarts).getTime())
const fresh = rows.filter(r => new Date(r.appointment_starts_at).getTime() !== new Date(origStarts).getTime())
chk('⚠️ הישנות לא נמחקו — הן superseded', old.length === 2 && old.every(r => r.status === 'superseded'))
chk('הסיבה: starts_at_changed', old.every(r => r.outcome_reason === 'starts_at_changed'))
chk('החדשות scheduled', fresh.length === 2 && fresh.every(r => r.status === 'scheduled'))

// ── idempotency: אותו update פעמיים ─────────────────────────────────────
const beforeCount = (await remindersOf(A1.id)).length
await db.exec(`select public.sync_appointment_reminders('${A1.id}')`)
await db.exec(`select public.sync_appointment_reminders('${A1.id}')`)
chk('⚠️ אותו סנכרון פעמיים אינו יוצר כפילות',
  (await remindersOf(A1.id)).length === beforeCount)

const dup = await errOf(`
  insert into appointment_reminders (appointment_id, reminder_kind, appointment_starts_at,
                                     scheduled_for, expires_at)
  values ('${A1.id}', 'day_before', (select starts_at from appointments where id='${A1.id}'),
          now(), now() + interval '1 hour')`)
chk('⚠️ אותו snapshot פעמיים נדחה ע"י ה-unique', dup !== null, dup?.slice(0, 40))

// ════════════════════════════════════════════════════════════════════════════
section('A→B→A — מה מוחייה ומה לא')
// ════════════════════════════════════════════════════════════════════════════

/**
 * לכל סטטוס: מסמנים ידנית את שורת ה-snapshot הישן, מחזירים את התור למועד
 * המקורי, ובודקים אם היא הוחייתה. זה מה שמונע שליחה כפולה אחרי A→B→A.
 */
const abaCase = async (label, seedStatus, seedExtra, expectRevived) => {
  const c = uuid()
  const phone = nextPhone()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}', '${phone}', 'TEST aba')`)
  const a = await mkAppt(c)
  const A = a.starts_at

  // מזיזים ל-B (התזכורות של A הופכות superseded), ואז דורסים את הסטטוס
  // של שורת ה-day_before של A כדי לבדוק את הכלל.
  await db.exec(`update appointments set starts_at = starts_at + interval '3 hours' where id='${a.id}'`)
  const seedErr = await errOf(`
    update appointment_reminders
    set status = '${seedStatus}'${seedExtra ? ', ' + seedExtra : ''}
    where appointment_id='${a.id}' and reminder_kind='day_before'
      and appointment_starts_at = $1`, [A])

  // 🔒 'sent' אינו בר-השגה בשלב 11 בשום דרך — ה-CHECK חוסם אותו מול כל
  // אחד משלושת הספקים. זו טענה **חזקה יותר** מ"לא מוחייה": המצב עצמו אינו
  // יכול להתקיים, ולכן אין ממה להחיות.
  if (seedStatus === 'sent') {
    chk('🔒 A→B→A מ-sent: המצב עצמו בלתי אפשרי בשלב 11 (ה-CHECK חוסם)',
      seedErr !== null && seedErr.includes('reminders_sent_requires_live_provider'),
      seedErr?.slice(0, 40) ?? 'לא נחסם')
    return
  }
  if (seedErr !== null) {
    chk(`A→B→A מ-${label}: הכנת המצב הצליחה`, false, seedErr.slice(0, 60))
    return
  }

  // חזרה ל-A
  await db.query(`update appointments set starts_at = $1 where id='${a.id}'`, [A])

  const row = await one(`
    select status from appointment_reminders
    where appointment_id='${a.id}' and reminder_kind='day_before' and appointment_starts_at=$1`, [A])

  const revived = row.status === 'scheduled'
  chk(`A→B→A מ-${label}: ${expectRevived ? 'מוחייה' : '⚠️ לא מוחייה'}`,
    revived === expectRevived, `status=${row.status}`)
}

await abaCase('superseded', 'superseded', null, true)
await abaCase('cancelled לפני שליחה', 'cancelled', 'cancelled_at = now()', true)
// ⚠️ 'sent' עם ספק מזויף חסום ע"י ה-CHECK — נבדק כאן, ומסלול ה-sent
// האמיתי נבדק במלואו בסעיף הייעודי למטה עם provider='fixture_live'.
await abaCase('sent', 'sent', "provider='fake', sent_at = now()", false)
await abaCase('simulated', 'simulated', "provider='fake', sent_at = now()", false)
await abaCase('delivery_unknown', 'delivery_unknown', null, false)
await abaCase('failed', 'failed', "outcome_reason='max_attempts_exhausted'", false)
await abaCase('skipped (window_passed_at_creation)', 'skipped',
  "outcome_reason='window_passed_at_creation'", false)
await abaCase('skipped (expired_before_send)', 'skipped',
  "outcome_reason='expired_before_send'", false)
await abaCase('processing', 'processing',
  "lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes'", false)

// ════════════════════════════════════════════════════════════════════════════
section('🔒 תזכורת שנשלחה באמת — מסלול שלב 12, נבדק כבר עכשיו')
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ הבדיקה הזו קיימת כי ה-CHECK בלבד אינו מספיק. הוא חוסם 'sent' עם ספק
// מזויף, אבל שלב 12 **כן** ייצור 'sent' עם ספק חי — ואז הלוגיקה של A→B→A,
// של ביטול ושל הזזה מופעלת על שורה שמאחוריה יצא SMS אמיתי. באג שם היה
// מתגלה רק אחרי חיבור 019, כלומר על לקוחה אמיתית שתקבל הודעה כפולה.
//
// 'fixture_live' הוא ערך זריעה בלבד: אין מסלול ריצה שמייצר אותו (ראה
// resolveReminderProvider ו-ReminderProviderName), והוא נכתב כאן ב-SQL ישיר.
// אין חיבור לספק ואין שליחה.
{
  const c = uuid()
  await db.exec(`insert into customers (id, phone_e164, full_name)
                 values ('${c}','${nextPhone()}','TEST sent')`)
  const a = await mkAppt(c)
  const A = a.starts_at

  const R = (await one(`select id from appointment_reminders
    where appointment_id='${a.id}' and reminder_kind='day_before'`)).id

  // זריעה: תזכורת שנשלחה בפועל ע"י ספק חי, עם ניסיון סגור כ-accepted.
  const seedErr = await errOf(`
    update appointment_reminders
    set status='sent', provider='fixture_live', sent_at=now(),
        provider_message_id='msg-fake-not-real', attempt_count=1
    where id='${R}'`)
  chk('🔒 ספק חי מאפשר status=sent (זו בדיוק ההתנהגות של שלב 12)',
    seedErr === null, seedErr?.slice(0, 60) ?? '')

  await db.exec(`
    insert into appointment_reminder_attempts
      (reminder_id, attempt_number, provider, worker_id, started_at, finished_at,
       outcome, provider_message_id)
    values ('${R}', 1, 'fixture_live', gen_random_uuid(), now(), now(),
            'accepted', 'msg-fake-not-real')`)

  const beforeRow = await one(`select scheduled_for, expires_at, attempt_count, sent_at
    from appointment_reminders where id='${R}'`)

  // ── A → B → A ───────────────────────────────────────────────────────────
  await db.exec(`update appointments set starts_at = starts_at + interval '3 hours' where id='${a.id}'`)

  const afterMove = await one(`select status, outcome_reason from appointment_reminders where id='${R}'`)
  chk('⚠️ הזזה: התזכורת שנשלחה נשארת sent כהיסטוריה', afterMove.status === 'sent',
    afterMove.status)
  const newSnapshot = await q(`select reminder_kind, status from appointment_reminders
    where appointment_id='${a.id}' and appointment_starts_at <> $1`, [A])
  chk('⚠️ הזזה: נוצרות תזכורות רק ל-snapshot החדש',
    newSnapshot.length === 2 && newSnapshot.every(r => r.status === 'scheduled'),
    newSnapshot.map(r => r.status).join(','))

  await db.query(`update appointments set starts_at = $1 where id='${a.id}'`, [A])

  const afterBack = await one(`select status, scheduled_for, expires_at, attempt_count,
    sent_at, outcome_reason, provider from appointment_reminders where id='${R}'`)

  chk('🔒 A→B→A מ-sent: נשארת sent', afterBack.status === 'sent', afterBack.status)
  chk('🔒 A→B→A מ-sent: לא הוחזרה ל-scheduled/retrying',
    !['scheduled', 'retrying'].includes(afterBack.status))
  chk('🔒 A→B→A מ-sent: scheduled_for לא שונה',
    new Date(afterBack.scheduled_for).getTime() === new Date(beforeRow.scheduled_for).getTime())
  chk('🔒 A→B→A מ-sent: expires_at לא שונה',
    new Date(afterBack.expires_at).getTime() === new Date(beforeRow.expires_at).getTime())
  chk('🔒 A→B→A מ-sent: attempt_count נשמר',
    afterBack.attempt_count === beforeRow.attempt_count, `${afterBack.attempt_count}`)
  chk('🔒 A→B→A מ-sent: sent_at לא נמחק', afterBack.sent_at !== null)
  chk('🔒 A→B→A מ-sent: הספק נשאר fixture_live', afterBack.provider === 'fixture_live')

  const attemptsKept = await q(`select attempt_number, outcome, provider_message_id
    from appointment_reminder_attempts where reminder_id='${R}' order by attempt_number`)
  chk('🔒 A→B→A מ-sent: רשומות הניסיון נשמרו',
    attemptsKept.length === 1 && attemptsKept[0].outcome === 'accepted')

  const snapshotRows = await q(`select id, status from appointment_reminders
    where appointment_id='${a.id}' and reminder_kind='day_before'
      and appointment_starts_at = $1`, [A])
  chk('🔒 A→B→A מ-sent: לא נוצרה תזכורת אוטומטית שנייה לאותו snapshot+kind',
    snapshotRows.length === 1 && snapshotRows[0].id === R, `count=${snapshotRows.length}`)

  const totalAttempts = await one(`select count(*)::int c
    from appointment_reminder_attempts where reminder_id='${R}'`)
  chk('🔒 A→B→A מ-sent: לא בוצעה שליחה נוספת', totalAttempts.c === 1, `attempts=${totalAttempts.c}`)

  // ── ביטול אחרי sent ─────────────────────────────────────────────────────
  await db.exec(`update appointments set status='cancelled_by_customer' where id='${a.id}'`)
  const afterCancel = await one(`select status, cancelled_at from appointment_reminders where id='${R}'`)
  chk('🔒 ביטול התור אחרי sent אינו הופך אותה ל-cancelled',
    afterCancel.status === 'sent', afterCancel.status)
  chk('🔒 ביטול אינו כותב cancelled_at על תזכורת שנשלחה', afterCancel.cancelled_at === null)

  const siblings = await q(`select status from appointment_reminders
    where appointment_id='${a.id}' and id <> '${R}'`)
  chk('שאר התזכורות של אותו תור כן בוטלו',
    siblings.every(s => ['cancelled', 'superseded'].includes(s.status)),
    siblings.map(s => s.status).join(','))
}

// ⚠️ החייאה אינה מאפסת את היסטוריית הניסיונות
{
  const c = uuid()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}','+972547000001','TEST hist')`)
  const a = await mkAppt(c)
  const A = a.starts_at
  await db.exec(`update appointments set starts_at = starts_at + interval '3 hours' where id='${a.id}'`)
  await db.query(`update appointment_reminders set attempt_count = 2
                 where appointment_id='${a.id}' and reminder_kind='day_before'
                   and appointment_starts_at = $1`, [A])
  await db.query(`update appointments set starts_at = $1 where id='${a.id}'`, [A])
  const row = await one(`select status, attempt_count from appointment_reminders
    where appointment_id='${a.id}' and reminder_kind='day_before' and appointment_starts_at=$1`, [A])
  chk('⚠️ החייאה שומרת את attempt_count — היסטוריית הניסיונות אינה נמחקת',
    row.status === 'scheduled' && row.attempt_count === 2, `attempts=${row.attempt_count}`)
}

// ⚠️ אין החייאה לחלון שכבר נסגר
{
  const c = uuid()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}','+972547000002','TEST win')`)
  const a = await mkAppt(c)
  const A = a.starts_at
  await db.exec(`update appointments set starts_at = starts_at + interval '3 hours' where id='${a.id}'`)
  // מזייפים חלון שנסגר על שורת ה-snapshot הישן
  await db.query(`update appointment_reminders
                 set scheduled_for = now() - interval '3 days', expires_at = now() - interval '2 days'
                 where appointment_id='${a.id}' and appointment_starts_at = $1`, [A])
  await db.query(`update appointments set starts_at = $1 where id='${a.id}'`, [A])
  const rs = await q(`select status, expires_at from appointment_reminders
    where appointment_id='${a.id}' and appointment_starts_at=$1`, [A])
  // הזמנים מחושבים מחדש מה-snapshot, ולכן החלון שוב פתוח — ההחייאה
  // לגיטימית. מה שנבדק כאן הוא שהחישוב אכן דטרמיניסטי ולא נשאר על הישן.
  chk('⚠️ החייאה מחשבת scheduled_for/expires_at מחדש ולא משאירה ערכים ישנים',
    rs.every(r => new Date(r.expires_at).getTime() > Date.now()))
}

// ════════════════════════════════════════════════════════════════════════════
section('ביטול וסיום תור — כל סטטוס שאינו confirmed')
// ════════════════════════════════════════════════════════════════════════════

const enumValues = (await q(`
  select e.enumlabel v from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'appointment_status' order by e.enumsortorder`)).map(r => r.v)
chk('enum appointment_status מכיל 8 ערכים', enumValues.length === 8, enumValues.join(','))
chk("⚠️ אין ערך 'rejected' — דחייה נרשמת כ-cancelled_by_business",
  !enumValues.includes('rejected'))

for (const st of enumValues.filter(v => v !== 'confirmed' && v !== 'pending')) {
  const c = uuid()
  const phone = nextPhone()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}','${phone}','TEST ${st}')`)
  const a = await mkAppt(c)
  await db.exec(`update appointments set status = '${st}' where id='${a.id}'`)
  const rs = await remindersOf(a.id)
  chk(`סטטוס ${st}: כל התזכורות בוטלו ואף אחת לא נמחקה`,
    rs.length === 2 && rs.every(r => r.status === 'cancelled'), rs.map(r => r.status).join(','))
  chk(`סטטוס ${st}: הסיבה נרשמה`, rs.every(r => !!r.outcome_reason))
}

// ── תזכורת שנשלחה נשארת כהיסטוריה גם אחרי ביטול ─────────────────────────
{
  const c = uuid()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}','+972547100001','TEST keep')`)
  const a = await mkAppt(c)
  await db.exec(`update appointment_reminders set status='simulated', provider='fake', sent_at=now()
                 where appointment_id='${a.id}' and reminder_kind='day_before'`)
  await db.exec(`update appointments set status='cancelled_by_customer' where id='${a.id}'`)
  const rs = await remindersOf(a.id)
  const sent = rs.find(r => r.reminder_kind === 'day_before')
  chk('⚠️ תזכורת שכבר יצאה נשארת כהיסטוריה גם אחרי ביטול התור',
    sent.status === 'simulated', sent.status)
}

// ── is_blocked ו-crm_status אינם מבטלים ─────────────────────────────────
{
  const c = uuid()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}','+972547100002','TEST blocked')`)
  const a = await mkAppt(c)
  await db.exec(`update customers set is_blocked = true where id='${c}'`)
  await db.exec(`update customer_crm_profiles set crm_status='inactive' where customer_id='${c}'`)
  const rs = await remindersOf(a.id)
  chk('⚠️ is_blocked אינו מבטל תזכורת לתור confirmed קיים',
    rs.every(r => r.status === 'scheduled'), rs.map(r => r.status).join(','))
  chk('⚠️ crm_status=inactive אינו מבטל תזכורת לתור confirmed',
    rs.every(r => r.status === 'scheduled'))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 אי אפשר לסמן SMS אמיתי כשאין ספק אמיתי')
// ════════════════════════════════════════════════════════════════════════════

const target = (await remindersOf(A1.id)).find(r => r.status === 'scheduled')
for (const p of ['disabled', 'simulated', 'fake']) {
  const e = await errOf(
    `update appointment_reminders set status='sent', provider='${p}' where id=$1`, [target.id])
  chk(`🔒 status='sent' עם provider='${p}' נדחה ברמת ה-DB`, e !== null, e?.slice(0, 45))
}
const okSim = await errOf(
  `update appointment_reminders set status='simulated', provider='fake', sent_at=now() where id=$1`,
  [target.id])
chk("'simulated' עם ספק שאינו אמיתי — מותר וזה הסימון הנכון", okSim === null)
await db.query(`update appointment_reminders set status='scheduled', sent_at=null, provider='disabled'
               where id=$1`, [target.id])

// ── פורמט ה-provider ─────────────────────────────────────────────────────
//
// ⚠️ נבדק על שורה אמיתית, ולא ב-INSERT מבודד: עמודות NOT NULL אחרות היו
// נכשלות ראשונות ומסתירות בדיוק את מה שנבדק כאן.
const provFmt = async v =>
  errOf(`update appointment_reminders set provider=$1 where id=$2`, [v, target.id])

// ⚠️ שם הספק של שלב 12 הוא 'sms_019' ולא '019'.
//
// הפורמט דורש אות ראשונה, ולכן '019' אינו ערך חוקי כלל — ואין לשנות את
// ה-CHECK כדי לאפשר שם שמתחיל בספרה. שתי הבדיקות הבאות הן שמקבעות את
// ההחלטה הזו, כדי ששלב 12 לא ייתקל בה כהפתעה.
chk("⚠️ 'sms_019' — שם הספק של שלב 12 — עובר בלי שינוי סכמה",
  (await provFmt('sms_019')) === null)
chk("🔒 '019' עצמו **נדחה** (הפורמט דורש אות ראשונה)",
  (await provFmt('019')) !== null)

for (const bad of ['', 'A_BAD', '1abc', 'has space', 'x'.repeat(40), 'ספק']) {
  chk(`🔒 provider בפורמט פסול נדחה: "${bad.slice(0, 12)}"`, (await provFmt(bad)) !== null)
}
await db.query(`update appointment_reminders set provider='disabled' where id=$1`, [target.id])

// ════════════════════════════════════════════════════════════════════════════
section('claim, lease ו-recovery')
// ════════════════════════════════════════════════════════════════════════════

// מכינים תזכורת אחת שהגיע זמנה
const C9 = uuid()
await db.exec(`insert into customers (id, phone_e164, full_name) values ('${C9}','+972547200001','TEST worker')`)
const A9 = await mkAppt(C9)
await db.exec(`update appointment_reminders set status='cancelled'
               where appointment_id='${A9.id}' and reminder_kind='two_hours_before'`)
const R9 = (await one(`select id from appointment_reminders
  where appointment_id='${A9.id}' and reminder_kind='day_before'`)).id
await db.exec(`update appointment_reminders set scheduled_for = now() - interval '1 minute'
               where id='${R9}'`)

const W1 = uuid()
let claim = await one(`select public.claim_due_reminder('${W1}', 120, 4, 'fake') c`)
chk('claim תופס תזכורת שהגיע זמנה', claim.c.claimed === true)
chk('הסטטוס עבר ל-processing', claim.c.reminder.status === 'processing')
chk('attempt_count עלה ל-1', claim.c.reminder.attempt_count === 1)
chk('⚠️ ה-claim פתח רשומת ניסיון בעצמו',
  (await one(`select count(*)::int c from appointment_reminder_attempts where reminder_id='${R9}'`)).c === 1)
chk('⚠️ ה-claim אינו מחזיר טלפון או שם',
  !JSON.stringify(claim.c).includes('+9725') && !JSON.stringify(claim.c).includes('TEST worker'))

const W2 = uuid()
const claim2 = await one(`select public.claim_due_reminder('${W2}', 120, 4, 'fake') c`)
chk('⚠️ worker שני אינו יכול לתפוס תזכורת עם lease חי', claim2.c.claimed === false)

// ── worker שנקטע ─────────────────────────────────────────────────────────
await db.exec(`update appointment_reminders set lease_expires_at = now() - interval '1 second'
               where id='${R9}'`)
const claim3 = await one(`select public.claim_due_reminder('${W2}', 120, 4, 'fake') c`)
chk('recovery: lease שפג נתפס מחדש', claim3.c.claimed === true)
chk('attempt_count עלה ל-2', claim3.c.reminder.attempt_count === 2)

const attempts = await q(`select attempt_number, outcome, finished_at, worker_id
  from appointment_reminder_attempts where reminder_id='${R9}' order by attempt_number`)
chk('שני ניסיונות רשומים', attempts.length === 2)
chk('⚠️ הניסיון של ה-worker שנקטע נסגר כ-lease_expired',
  attempts[0].outcome === 'lease_expired' && attempts[0].finished_at !== null)
chk('הניסיון החדש פתוח ושייך ל-worker החדש',
  attempts[1].outcome === null && attempts[1].worker_id === W2)

// ── worker ישן שחזר מאוחר ────────────────────────────────────────────────
const staleFinish = await errOf(
  `select public.finish_reminder_attempt('${R9}','${W1}','accepted',null,null,'fake',4,false)`)
chk('🔒 worker ישן אינו יכול לסגור את הניסיון החדש', staleFinish !== null,
  staleFinish?.includes('NOT_LEASE_OWNER') ? 'NOT_LEASE_OWNER' : staleFinish?.slice(0, 30))

const staleClose = await errOf(
  `update appointment_reminder_attempts set finished_at=now(), outcome='accepted'
   where reminder_id='${R9}' and attempt_number=1`)
chk('🔒 ניסיון שכבר נסגר אינו ניתן לעדכון שני', staleClose !== null)

// ════════════════════════════════════════════════════════════════════════════
section('שמירת האודיט (append-only עם סגירה יחידה)')
// ════════════════════════════════════════════════════════════════════════════

const delAttempt = await errOf(`delete from appointment_reminder_attempts where reminder_id='${R9}'`)
chk('🔒 אין למחוק רשומת ניסיון כשהתזכורת קיימת', delAttempt !== null)

for (const [field, value] of [
  ['attempt_number', '99'], ['provider', "'disabled'"], ['worker_id', 'gen_random_uuid()'],
  ['started_at', 'now()'],
]) {
  const e = await errOf(`update appointment_reminder_attempts
    set finished_at=now(), outcome='accepted', ${field}=${value}
    where reminder_id='${R9}' and attempt_number=2`)
  chk(`🔒 אין לשנות ${field} בסגירת הניסיון`, e !== null)
}

const halfClose = await errOf(`update appointment_reminder_attempts set finished_at=now()
  where reminder_id='${R9}' and attempt_number=2`)
chk('🔒 סגירה חלקית (בלי outcome) נדחית', halfClose !== null)

// ════════════════════════════════════════════════════════════════════════════
section('0012 — cascade מנקה אודיט, מחיקה ישירה עדיין נדחית')
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ הבאג ש-0012 מתקן: 0011 חסם DELETE ללא תנאי, וטריגר שורה נורה גם על
// מחיקת cascade. ניסיון אחד הפך את התזכורת, את התור, ובעקיפין גם את
// הלקוחה (ה-FK אליה הוא restrict) לבלתי ניתנים למחיקה — לצמיתות.
{
  const mkChain = async label => {
    const c = uuid()
    await db.exec(`insert into customers (id, phone_e164, full_name)
      values ('${c}','${nextPhone()}','TEST ${label}')`)
    const a = await mkAppt(c)
    const rid = (await remindersOf(a.id))[0].id
    await db.exec(`insert into appointment_reminder_attempts
      (reminder_id, attempt_number, provider) values ('${rid}', 1, 'disabled')`)
    return { c, a, rid }
  }
  const attemptsOf = async rid =>
    (await one(`select count(*)::int c from appointment_reminder_attempts
                where reminder_id='${rid}'`)).c

  // ── 1. מחיקה ישירה כשהאב קיים → נדחית ────────────────────────────────
  const x1 = await mkChain('0012 direct')
  const direct = await errOf(`delete from appointment_reminder_attempts
    where reminder_id='${x1.rid}'`)
  chk('🔒 1. מחיקה ישירה של אודיט כשהתזכורת קיימת → נדחית', direct !== null,
    direct?.includes('APPEND_ONLY') ? 'APPEND_ONLY' : direct?.slice(0, 40))
  chk('   האודיט אכן נשאר במקומו', (await attemptsOf(x1.rid)) === 1)

  // ── 10. גם service_role אינו יכול, למרות שיש לו grant על DELETE ──────
  await db.exec('set role service_role')
  const svcDirect = await errOf(`delete from appointment_reminder_attempts
    where reminder_id='${x1.rid}'`)
  await db.exec('reset role')
  chk('🔒 10. גם service_role אינו מוחק אודיט ישירות כשהתזכורת קיימת',
    svcDirect !== null, svcDirect?.includes('APPEND_ONLY') ? 'APPEND_ONLY' : '')
  // ⚠️ נבדק גם בתוצאה ולא רק בשגיאה: תפקיד שמסונן ע"י RLS היה "מצליח" על
  // אפס שורות, והבדיקה הייתה עוברת בלי שהטריגר בכלל נורה.
  chk('   האודיט שרד גם את הניסיון של service_role', (await attemptsOf(x1.rid)) === 1)

  // ── 9. anon ו-authenticated אינם נוגעים בשתי הטבלאות ─────────────────
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    const dAtt = await errOf(`delete from appointment_reminder_attempts
      where reminder_id='${x1.rid}'`)
    const dRem = await errOf(`delete from appointment_reminders where id='${x1.rid}'`)
    await db.exec('reset role')
    chk(`🔒 9. ${role} אינו יכול למחוק רשומות ניסיון`, dAtt !== null)
    chk(`🔒 9. ${role} אינו יכול למחוק תזכורות`, dRem !== null)
  }

  // ── 2. מחיקת התזכורת → cascade מנקה את האודיט ────────────────────────
  const delRem = await errOf(`delete from appointment_reminders where id='${x1.rid}'`)
  chk('⚠️ 2. מחיקת תזכורת מצליחה גם כשיש לה אודיט', delRem === null,
    delRem?.slice(0, 60) ?? '')
  chk('   ה-cascade ניקה את רשומות הניסיון', (await attemptsOf(x1.rid)) === 0)

  // ── 3. מחיקת התור → cascade מנקה תזכורות ואודיט ──────────────────────
  const x2 = await mkChain('0012 appt')
  const delAppt = await errOf(`delete from appointments where id='${x2.a.id}'`)
  chk('⚠️ 3. מחיקת תור מצליחה גם כשלתזכורותיו יש אודיט', delAppt === null,
    delAppt?.slice(0, 60) ?? '')
  chk('   לא נשארו תזכורות',
    (await one(`select count(*)::int c from appointment_reminders
                where appointment_id='${x2.a.id}'`)).c === 0)
  chk('   לא נשארו רשומות ניסיון', (await attemptsOf(x2.rid)) === 0)

  // ── 4. מחיקת הלקוחה → שרשרת הניקוי כולה עוברת ────────────────────────
  // ⚠️ ה-FK מ-appointments ל-customers הוא restrict, ולכן התור חייב לרדת
  // ראשון. זה בדיוק המסלול שהיה חסום לחלוטין לפני 0012.
  const delCust = await errOf(`delete from customers where id='${x2.c}'`)
  chk('⚠️ 4. מחיקת לקוחת TEST מצליחה בסוף השרשרת', delCust === null,
    delCust?.slice(0, 60) ?? '')

  // ── 5. אין אודיט יתום ────────────────────────────────────────────────
  const orphans = await one(`select count(*)::int c from appointment_reminder_attempts a
    where not exists (select 1 from appointment_reminders r where r.id = a.reminder_id)`)
  chk('⚠️ 5. אין ולו רשומת ניסיון יתומה אחת', orphans.c === 0, `count=${orphans.c}`)

  // ── 6/7/8. כללי ה-UPDATE לא נפגעו מהתיקון ────────────────────────────
  const x3 = await mkChain('0012 update')
  const close1 = await errOf(`update appointment_reminder_attempts
    set finished_at=now(), outcome='simulated'
    where reminder_id='${x3.rid}' and attempt_number=1`)
  chk('6. סגירה ראשונה של ניסיון → מצליחה', close1 === null, close1?.slice(0, 50) ?? '')

  const close2 = await errOf(`update appointment_reminder_attempts
    set finished_at=now(), outcome='accepted'
    where reminder_id='${x3.rid}' and attempt_number=1`)
  chk('🔒 7. סגירה שנייה → נדחית', close2 !== null,
    close2?.includes('APPEND_ONLY') ? 'APPEND_ONLY' : '')

  await db.exec(`insert into appointment_reminder_attempts
    (reminder_id, attempt_number, provider) values ('${x3.rid}', 2, 'disabled')`)
  for (const [field, value] of [
    ['reminder_id', 'gen_random_uuid()'], ['attempt_number', '77'],
    ['provider', "'simulated'"], ['started_at', 'now()'], ['worker_id', 'gen_random_uuid()'],
  ]) {
    const e = await errOf(`update appointment_reminder_attempts
      set finished_at=now(), outcome='simulated', ${field}=${value}
      where reminder_id='${x3.rid}' and attempt_number=2`)
    chk(`🔒 8. שינוי ${field} בסגירה → נדחה`, e !== null)
  }

  await db.exec(`delete from appointments where id='${x3.a.id}';`)
  await db.exec(`delete from customers where id='${x3.c}'`)
  await db.exec(`delete from appointments where id='${x1.a.id}'`)
  await db.exec(`delete from customers where id='${x1.c}'`)
}

// ════════════════════════════════════════════════════════════════════════════
section('precheck — אימות מחדש לפני השליחה')
// ════════════════════════════════════════════════════════════════════════════

let pre = await one(`select public.reminder_precheck('${R9}','${W2}') p`)
chk('precheck עובר כשהכול תקין', pre.p.ok === true)

pre = await one(`select public.reminder_precheck('${R9}','${uuid()}') p`)
chk('🔒 precheck נכשל עם lease token זר', pre.p.ok === false && pre.p.reason === 'lease_lost')

await db.exec(`update appointment_reminders set cancel_requested_at = now() where id='${R9}'`)
pre = await one(`select public.reminder_precheck('${R9}','${W2}') p`)
chk('precheck מזהה בקשת ביטול', pre.p.ok === false && pre.p.reason === 'cancel_requested')
await db.exec(`update appointment_reminders set cancel_requested_at = null where id='${R9}'`)

// שינוי מועד תוך כדי processing → cancel_requested_at, לא חטיפה
await db.exec(`update appointments set starts_at = starts_at + interval '3 hours' where id='${A9.id}'`)
const during = await one(`select status, cancel_requested_at, outcome_reason
  from appointment_reminders where id='${R9}'`)
chk('⚠️ הזזה בזמן processing אינה חוטפת את ה-lease',
  during.status === 'processing', during.status)
chk('⚠️ במקום זה נרשמת בקשת ביטול', during.cancel_requested_at !== null)
chk('הסיבה: starts_at_changed', during.outcome_reason === 'starts_at_changed')

pre = await one(`select public.reminder_precheck('${R9}','${W2}') p`)
chk('precheck עוצר את השליחה', pre.p.ok === false)

const aborted = await one(`select public.abort_reminder_attempt('${R9}','${W2}','starts_at_changed') a`)
chk('abort מסמן superseded', aborted.a.status === 'superseded')
const abAttempt = await one(`select outcome from appointment_reminder_attempts
  where reminder_id='${R9}' and attempt_number=2`)
chk('⚠️ הניסיון נסגר כ-aborted_precondition — לא הייתה קריאה לספק',
  abAttempt.outcome === 'aborted_precondition')

// ════════════════════════════════════════════════════════════════════════════
section('backoff ו-retry_window_expired')
// ════════════════════════════════════════════════════════════════════════════

/** מכינה תזכורת נתפסת בודדת ומחזירה את מזהיה */
const freshClaimable = async (offset, kind = 'day_before', tweak = null) => {
  const c = uuid()
  const phone = nextPhone()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}','${phone}','TEST bo')`)
  const a = await mkAppt(c, offset)
  await db.exec(`update appointment_reminders set status='cancelled'
                 where appointment_id='${a.id}' and reminder_kind <> '${kind}'`)
  const r = await one(`select id from appointment_reminders
    where appointment_id='${a.id}' and reminder_kind='${kind}'`)
  await db.exec(`update appointment_reminders
                 set scheduled_for = now() - interval '1 minute'${tweak ? ', ' + tweak : ''}
                 where id='${r.id}'`)
  return { apptId: a.id, reminderId: r.id }
}

{
  const { reminderId } = await freshClaimable()
  const w = uuid()
  await db.exec(`select public.claim_due_reminder('${w}', 120, 4, 'fake')`)
  const res = await one(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','retryable_error','provider_timeout',null,'fake',4,false) r`)
  chk('שגיאה זמנית → retrying', res.r.status === 'retrying', res.r.status)
  const delayMin = (new Date(res.r.next_attempt_at) - Date.now()) / 60000
  chk('backoff ראשון ≈ 3 דקות', delayMin > 2.5 && delayMin < 3.5, `${delayMin.toFixed(1)} דק'`)
  chk('קוד השגיאה מסונן ונשמר', res.r.last_error_code === 'provider_timeout')
}

// ── retry_window_expired: day_before ─────────────────────────────────────
{
  const { reminderId } = await freshClaimable(null, 'day_before',
    "expires_at = now() + interval '2 minutes'")
  const w = uuid()
  await db.exec(`select public.claim_due_reminder('${w}', 120, 4, 'fake')`)
  const res = await one(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','retryable_error','provider_timeout',null,'fake',4,false) r`)
  chk('⚠️ day_before: backoff שחורג מהתוקף → failed ולא retrying',
    res.r.status === 'failed', res.r.status)
  chk('הסיבה: retry_window_expired', res.r.outcome_reason === 'retry_window_expired')
  chk('⚠️ לא נשאר next_attempt_at בלתי אפשרי', res.r.next_attempt_at === null)
}

// ── retry_window_expired: two_hours_before ───────────────────────────────
{
  const { reminderId } = await freshClaimable(null, 'two_hours_before',
    "expires_at = now() + interval '90 seconds'")
  const w = uuid()
  await db.exec(`select public.claim_due_reminder('${w}', 120, 4, 'fake')`)
  const res = await one(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','retryable_error','provider_timeout',null,'fake',4,false) r`)
  chk('⚠️ two_hours_before: backoff שחורג מהתוקף → failed',
    res.r.status === 'failed' && res.r.outcome_reason === 'retry_window_expired', res.r.status)
}

// ── מיצוי ניסיונות ───────────────────────────────────────────────────────
{
  const { reminderId } = await freshClaimable(null, 'day_before', 'attempt_count = 3')
  const w = uuid()
  await db.exec(`select public.claim_due_reminder('${w}', 120, 4, 'fake')`)
  const res = await one(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','retryable_error','provider_down',null,'fake',4,false) r`)
  chk('מיצוי ניסיונות → failed', res.r.status === 'failed')
  chk('הסיבה: max_attempts_exhausted', res.r.outcome_reason === 'max_attempts_exhausted')
}

// ════════════════════════════════════════════════════════════════════════════
section('תוצאות הספק')
// ════════════════════════════════════════════════════════════════════════════

const outcomeCase = async (outcome, expectStatus, extra = '') => {
  const { reminderId } = await freshClaimable()
  const w = uuid()
  await db.exec(`select public.claim_due_reminder('${w}', 120, 4, 'fake')`)
  const res = await one(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','${outcome}',
    ${outcome === 'accepted' ? 'null' : "'err_code'"},
    ${outcome === 'accepted' ? "'msg-1'" : 'null'},'fake',4,false) r`)
  chk(`${outcome} → ${expectStatus}${extra}`, res.r.status === expectStatus, res.r.status)
  return res.r
}

const acc = await outcomeCase('accepted', 'simulated', ' (ספק לא אמיתי)')
chk('⚠️ accepted מספק לא אמיתי לעולם אינו sent', acc.status !== 'sent')
chk('sent_at נרשם גם בסימולציה', acc.sent_at !== null)

// ── 🔒 שלב 12A — 'sms_019' עובד על הסכמה הקיימת, בלי migration ─────────────
//
// ⚠️ הבדיקות האלה הן ההוכחה שלא נדרשה migration חדשה. הן מאמתות את שלוש
// החוליות שביחד הופכות שליחה אמיתית לאפשרית — בלי שאף אחת מהן שונתה:
//   1. ה-CHECK על provider הוא פורמט, ו-'sms_019' עובר אותו.
//   2. reminders_sent_requires_live_provider אינו כולל את 'sms_019'.
//   3. v_live ב-finish_reminder_attempt נגזר מאותה רשימה, ולכן 'sms_019'
//      נחשב ספק אמיתי אוטומטית.
{
  const { reminderId } = await freshClaimable()
  const w = uuid()
  const claimed = await one(`select public.claim_due_reminder('${w}', 120, 4, 'sms_019') c`)
  chk("🔒 claim עם provider='sms_019' מתקבל בסכמה הקיימת", claimed.c !== null)

  const res = await one(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','accepted',null,'SHIP-1','sms_019',4,false) r`)
  chk("🔒 accepted מ-'sms_019' → status='sent' (בלי migration)",
    res.r.status === 'sent', res.r.status)
  chk('provider_message_id נשמר (shipment_id)', res.r.provider_message_id === 'SHIP-1')
  chk("שורת התזכורת רושמת provider='sms_019'", res.r.provider === 'sms_019')
  chk('sent_at נרשם', res.r.sent_at !== null)

  const att = await one(`select outcome::text o, provider_message_id p, provider pr
    from appointment_reminder_attempts where reminder_id='${reminderId}'
    order by attempt_number desc limit 1`)
  chk("שורת הניסיון נסגרה כ-'accepted'", att.o === 'accepted', att.o)
  chk('שורת הניסיון שומרת את ה-shipment_id', att.p === 'SHIP-1')
  chk("שורת הניסיון רושמת provider='sms_019'", att.pr === 'sms_019')
}

// ⚠️ delivery_unknown מ-019 נשאר סופי גם כשהספק אמיתי. זו החוליה שמונעת
// SMS כפול: ל-019 אין idempotency מוכחת, ולכן ניסיון חוזר אוטומטי על תוצאה
// עמומה הוא הימור על חשבון הלקוחה.
{
  const { reminderId } = await freshClaimable()
  const w = uuid()
  await db.exec(`select public.claim_due_reminder('${w}', 120, 4, 'sms_019')`)
  const res = await one(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','delivery_unknown','sms019_timeout',null,'sms_019',4,false) r`)
  chk('🔒 delivery_unknown מספק אמיתי → סטטוס delivery_unknown',
    res.r.status === 'delivery_unknown', res.r.status)
  chk('🔒 אין next_attempt_at — אפס retry אוטומטי', res.r.next_attempt_at === null)
  chk('⚠️ תוצאה עמומה לעולם אינה נרשמת כ-sent', res.r.status !== 'sent')
}

// ⚠️ קודי השגיאה של 019 חייבים לעבור את ה-CHECK על error_code
// (`^[a-z0-9_]{1,60}$`). קוד שנדחה שם היה מפיל את סגירת הניסיון כולה
// ומשאיר את התזכורת תקועה ב-processing עד שה-lease יפוג.
//
// ⚠️ תזכורת טרייה לכל קוד: אחרי retryable_error היא עוברת ל-retrying עם
// next_attempt_at עתידי, ולכן אינה ניתנת ל-claim חוזר באותה שנייה.
for (const code of [
  'sms019_insufficient_credit_4', 'sms019_unverified_source_515',
  'sms019_auth_token_user_mismatch_11', 'sms019_transport_unknown',
  'sms019_http_504', 'sms019_unmapped_status', 'sms019_send_time_not_permitted_5',
]) {
  const { reminderId } = await freshClaimable()
  const w = uuid()
  await db.exec(`select public.claim_due_reminder('${w}', 120, 9, 'sms_019')`)
  const e = await errOf(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','retryable_error','${code}',null,'sms_019',9,false)`)
  chk(`קוד השגיאה '${code}' מתקבל`, e === null, e?.slice(0, 40))
}

// ⚠️ החגורה השנייה: קוד שאינו מסונן עדיין נדחה, גם עם ספק אמיתי.
{
  const { reminderId } = await freshClaimable()
  const w = uuid()
  await db.exec(`select public.claim_due_reminder('${w}', 120, 9, 'sms_019')`)
  const e = await errOf(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','retryable_error','019 said: +972541230001 blocked',null,'sms_019',9,false)`)
  chk('🔒 קוד שגיאה עם טקסט חופשי נדחה גם ל-sms_019', e !== null, e?.slice(0, 40))
}
await outcomeCase('permanent_error', 'failed')
const unk = await outcomeCase('delivery_unknown', 'delivery_unknown')
chk('⚠️ delivery_unknown סופי — אין next_attempt_at', unk.next_attempt_at === null)

// ── שינוי בזמן שהספק עיבד ────────────────────────────────────────────────
{
  const { apptId, reminderId } = await freshClaimable()
  const w = uuid()
  await db.exec(`select public.claim_due_reminder('${w}', 120, 4, 'fake')`)
  await db.exec(`update appointments set status='cancelled_by_customer' where id='${apptId}'`)
  const res = await one(`select public.finish_reminder_attempt(
    '${reminderId}','${w}','accepted',null,'msg-x','fake',4,true) r`)
  chk('⚠️ ההודעה שיצאה נרשמת כפי שקרה, ולא כביטול', res.r.status === 'simulated', res.r.status)
  chk('⚠️ מסומן sent_after_appointment_change',
    res.r.outcome_reason === 'sent_after_appointment_change')
}

// ════════════════════════════════════════════════════════════════════════════
section('sweep — חלונות שנסגרו')
// ════════════════════════════════════════════════════════════════════════════

{
  const { reminderId } = await freshClaimable(null, 'day_before',
    "expires_at = now() - interval '30 seconds'")
  const sw = await one(`select public.sweep_expired_reminders() s`)
  chk('sweep סימן לפחות תזכורת אחת', sw.s.expired >= 1, `expired=${sw.s.expired}`)
  const r = await one(`select status, outcome_reason from appointment_reminders where id='${reminderId}'`)
  chk('חלון שנסגר → skipped', r.status === 'skipped', r.status)
  chk('הסיבה: expired_before_send', r.outcome_reason === 'expired_before_send')

  const c2 = await one(`select public.claim_due_reminder('${uuid()}', 120, 4, 'fake') c`)
  chk('⚠️ תזכורת שפגה אינה ניתנת לתפיסה', c2.c.claimed === false)
}

// ════════════════════════════════════════════════════════════════════════════
section('תזכורת ידנית')
// ════════════════════════════════════════════════════════════════════════════

const CM = uuid()
await db.exec(`insert into customers (id, phone_e164, full_name) values ('${CM}','+972547300001','TEST manual')`)
const AM = await mkAppt(CM)
const REQ1 = uuid()
const FP1 = 'a'.repeat(64)

const man1 = await one(`select public.create_manual_reminder(
  '${AM.id}','${ADMIN_AUTH}','${REQ1}','${FP1}','v1') m`)
chk('תזכורת ידנית נוצרה', man1.m.result === 'manual_reminder_created')
chk('לא replayed בפעם הראשונה', man1.m.replayed === false)

const manRow = await one(`select * from appointment_reminders where id='${man1.m.reminder_id}'`)
chk('scheduled_for = עכשיו', Math.abs(new Date(manRow.scheduled_for) - Date.now()) < 5000)
chk('expires_at = מועד התור',
  new Date(manRow.expires_at).getTime() === new Date(AM.starts_at).getTime())
chk('ה-snapshot נלקח בזמן היצירה',
  new Date(manRow.appointment_starts_at).getTime() === new Date(AM.starts_at).getTime())
chk('created_by_admin_id נרשם', manRow.created_by_admin_id === ADMIN_AUTH)

const man2 = await one(`select public.create_manual_reminder(
  '${AM.id}','${ADMIN_AUTH}','${REQ1}','${FP1}','v1') m`)
chk('⚠️ אותו request id + payload → אותה תזכורת', man2.m.reminder_id === man1.m.reminder_id)
chk('מסומן replayed', man2.m.replayed === true)
chk('⚠️ לא נוצרה תזכורת שנייה',
  (await one(`select count(*)::int c from appointment_reminders
              where appointment_id='${AM.id}' and reminder_kind='manual'`)).c === 1)

const reuse = await errOf(`select public.create_manual_reminder(
  '${AM.id}','${ADMIN_AUTH}','${REQ1}','${'b'.repeat(64)}','v1')`)
chk('🔒 אותו request id עם payload אחר → IDEMPOTENCY_KEY_REUSED',
  reuse?.includes('IDEMPOTENCY_KEY_REUSED'))

// actor אחר = namespace נפרד
const ADMIN2 = uuid()
await db.exec(`insert into auth.users values ('${ADMIN2}','972541110003');
               insert into admins (user_id) values ('${ADMIN2}')`)
const man3 = await one(`select public.create_manual_reminder(
  '${AM.id}','${ADMIN2}','${REQ1}','${FP1}','v1') m`)
chk('⚠️ actor אחר עם אותו request id → namespace נפרד',
  man3.m.reminder_id !== man1.m.reminder_id)

// ⚠️ manual מרובה מותרת — ה-unique מחריג אותה
chk('⚠️ שתי תזכורות ידניות לאותו תור ומועד — מותר',
  (await one(`select count(*)::int c from appointment_reminders
              where appointment_id='${AM.id}' and reminder_kind='manual'`)).c === 2)

const notAdmin = await errOf(`select public.create_manual_reminder(
  '${AM.id}','${uuid()}','${uuid()}','${FP1}','v1')`)
chk('🔒 מי שאינו מנהל אינו יכול ליצור תזכורת ידנית', notAdmin !== null)

// לא לתור שאינו confirmed / בעבר
{
  const c = uuid()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}','+972547300002','TEST mp')`)
  const a = await mkAppt(c, null, 'pending')
  const e = await errOf(`select public.create_manual_reminder(
    '${a.id}','${ADMIN_AUTH}','${uuid()}','${FP1}','v1')`)
  chk('🔒 אין תזכורת ידנית לתור שאינו confirmed', e?.includes('NOT_CONFIRMED'))
}

// ── הזזה מבטלת גם תזכורת ידנית ───────────────────────────────────────────
await db.exec(`update appointments set starts_at = starts_at + interval '3 hours' where id='${AM.id}'`)
const manAfter = await q(`select status, outcome_reason from appointment_reminders
  where appointment_id='${AM.id}' and reminder_kind='manual'`)
chk('⚠️ הזזה מסמנת גם תזכורת ידנית superseded',
  manAfter.every(r => r.status === 'superseded'), manAfter.map(r => r.status).join(','))

// ════════════════════════════════════════════════════════════════════════════
section('retry ידני')
// ════════════════════════════════════════════════════════════════════════════

const mkFailed = async (status, extra = '') => {
  const { reminderId } = await freshClaimable()
  await db.exec(`update appointment_reminders
    set status='${status}', attempt_count=2${extra ? ', ' + extra : ''} where id='${reminderId}'`)
  return reminderId
}

{
  const r = await mkFailed('failed')
  const res = await one(`select public.retry_reminder('${r}','${ADMIN_AUTH}',false) x`)
  chk('retry מ-failed מחזיר לתור', res.x.result === 'requeued')
  chk('⚠️ attempt_count לא אופס', res.x.attempt_count === 2, `attempts=${res.x.attempt_count}`)
  chk('⚠️ לא נוצרה תזכורת חדשה',
    (await one(`select count(*)::int c from appointment_reminders where id='${r}'`)).c === 1)

  // לחיצה שנייה
  const res2 = await one(`select public.retry_reminder('${r}','${ADMIN_AUTH}',false) x`)
  chk('⚠️ לחיצה שנייה idempotent — לא משנה סטטוס', res2.x.result === 'not_retryable',
    res2.x.result)
}

{
  const r = await mkFailed('delivery_unknown')
  const e = await errOf(`select public.retry_reminder('${r}','${ADMIN_AUTH}',false)`)
  chk('🔒 retry מ-delivery_unknown בלי אישור נדחה בשרת',
    e?.includes('DUPLICATE_RISK_NOT_CONFIRMED'))
  const ok = await one(`select public.retry_reminder('${r}','${ADMIN_AUTH}',true) x`)
  chk('עם אישור מפורש — מותר', ok.x.result === 'requeued')
}

{
  const r = await mkFailed('processing',
    "lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes'")
  const e = await errOf(`select public.retry_reminder('${r}','${ADMIN_AUTH}',false)`)
  chk('🔒 אין לגזול lease פעיל מ-worker', e?.includes('LEASE_ACTIVE'))

  await db.exec(`update appointment_reminders set lease_expires_at = now() - interval '1 second'
                 where id='${r}'`)
  const ok = await one(`select public.retry_reminder('${r}','${ADMIN_AUTH}',false) x`)
  chk('lease שפג — retry מותר', ok.x.result === 'requeued')
  const openAttempts = await one(`select count(*)::int c from appointment_reminder_attempts
    where reminder_id='${r}' and finished_at is null`)
  chk('⚠️ retry סוגר ניסיון פתוח של worker מת', openAttempts.c === 0)
}

{
  const r = await mkFailed('failed', "expires_at = now() - interval '30 seconds'")
  const e = await errOf(`select public.retry_reminder('${r}','${ADMIN_AUTH}',false)`)
  chk('🔒 אין retry לחלון שנסגר', e?.includes('WINDOW_CLOSED'))
}

{
  const r = await mkFailed('failed')
  const appt = await one(`select appointment_id from appointment_reminders where id='${r}'`)
  await db.exec(`update appointments set starts_at = starts_at + interval '3 hours'
                 where id='${appt.appointment_id}'`)
  const e = await errOf(`select public.retry_reminder('${r}','${ADMIN_AUTH}',false)`)
  chk('🔒 אין retry ל-snapshot שהתיישן', e?.includes('SNAPSHOT_STALE') || e?.includes('NOT_CONFIRMED'))
}

const notAdminRetry = await errOf(`select public.retry_reminder('${R9}','${uuid()}',false)`)
chk('🔒 מי שאינו מנהל אינו יכול לבצע retry', notAdminRetry !== null)

// ════════════════════════════════════════════════════════════════════════════
section('⚠️ הטריגר אינו בולע שגיאות ואינו מפיל פעולה עסקית')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = uuid()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}','+972547400001','TEST tg')`)
  const a = await mkAppt(c)
  // הזזה חוזרת הלוך ושוב — כל אחת מפעילה את הטריגר ועוברת דרך ON CONFLICT
  const A = a.starts_at
  let threw = null
  try {
    for (let i = 0; i < 4; i++) {
      await db.exec(`update appointments set starts_at = starts_at + interval '3 hours' where id='${a.id}'`)
      await db.query(`update appointments set starts_at = $1 where id='${a.id}'`, [A])
    }
  } catch (e) { threw = e.message }
  chk('⚠️ הזזות חוזרות אינן מפילות את פעולת ה-UPDATE', threw === null, threw?.slice(0, 60) ?? '')
  const rs = await remindersOf(a.id)
  chk('אחרי 8 הזזות: עדיין 4 שורות בלבד (2 snapshots)', rs.length === 4, `count=${rs.length}`)
}

// ════════════════════════════════════════════════════════════════════════════
section('הרשאות ופרטיות')
// ════════════════════════════════════════════════════════════════════════════

const rls = await q(`select relname, relrowsecurity from pg_class
  where relnamespace='public'::regnamespace
    and relname in ('appointment_reminders','appointment_reminder_attempts')`)
chk('RLS מופעל על שתי הטבלאות', rls.length === 2 && rls.every(r => r.relrowsecurity))

const pol = await one(`select count(*)::int c from pg_policies
  where schemaname='public' and tablename in ('appointment_reminders','appointment_reminder_attempts')`)
chk('אין policies — service_role בלבד', pol.c === 0)

const cols = (await q(`select column_name from information_schema.columns
  where table_schema='public' and table_name in
    ('appointment_reminders','appointment_reminder_attempts')`)).map(r => r.column_name)
for (const forbidden of ['phone', 'phone_e164', 'full_name', 'body', 'message', 'raw_response', 'access_token']) {
  chk(`⚠️ אין עמודה '${forbidden}' בטבלאות התזכורות`, !cols.includes(forbidden))
}

// קודי שגיאה מסוננים בלבד
const badCode = await errOf(`update appointment_reminders
  set last_error_code = 'Twilio said: +972541230001 is invalid' where id='${R9}'`)
chk('⚠️ קוד שגיאה שאינו מסונן נדחה (הטלפון לא יכול לדלוף לשם)', badCode !== null)

// ה-FK מנקה תזכורות עם התור
{
  const c = uuid()
  await db.exec(`insert into customers (id, phone_e164, full_name) values ('${c}','+972547500001','TEST fk')`)
  const a = await mkAppt(c)
  const rid = (await remindersOf(a.id))[0].id
  await db.exec(`delete from appointment_history where appointment_id='${a.id}';
                 delete from appointments where id='${a.id}'`)
  chk('מחיקת תור מוחקת את תזכורותיו (cascade)',
    (await one(`select count(*)::int c from appointment_reminders where id='${rid}'`)).c === 0)
}

// ── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
