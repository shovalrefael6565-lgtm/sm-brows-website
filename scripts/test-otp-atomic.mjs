/**
 * בדיקות שלב 12B — הנפקת OTP ואימות OTP אטומיים, מול Postgres אמיתי (PGlite).
 *
 * המיקוד: מה שהמימוש הקודם לא יכול היה להבטיח —
 *   1. ששתי בקשות לאותו מספר מייצרות שורה אחת בלבד.
 *   2. שההכרעה אינה נשענת על סדר ה-id, שאינו סדר ה-commit.
 *   3. שמונה הניסיונות אמין, ושקוד נצרך אינו חוזר לחיים.
 *   4. שהתקרות אינן ניתנות להרפיה ע"י הקורא.
 *
 * ⚠️ **מגבלה שיש להכיר:** ל-PGlite יש חיבור אחד, ולכן אי אפשר להריץ בו שתי
 * טרנזקציות שנחתכות זו בזו. הקובץ הזה בודק את *המנגנון* ואת האינווריאנטות
 * שאינן תלויות בתזמון. הריצה המקבילה האמיתית — שתי בקשות בו-זמנית מול אותה
 * שורה — נבדקת ב-scripts/test-otp-atomic-live.mjs מול Supabase האמיתי,
 * ששם יש חיבורים נפרדים. שתי הבדיקות נדרשות; אף אחת אינה מייתרת את השנייה.
 *
 * הרצה:  npm run test:otp-atomic
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

process.env.OTP_PEPPER ??= 'test-pepper-for-otp-atomic-suite-0123456789'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', 'supabase', 'migrations')
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

const MIGRATION_0013 = readFileSync(join(MIGRATIONS_DIR, '0013_atomic_otp_operations.sql'), 'utf8')
const MIGRATION_0014 = readFileSync(join(MIGRATIONS_DIR, '0014_otp_discard_attempted_cleanup.sql'), 'utf8')
const OTP_TS = readFileSync(join(HERE, '..', 'lib', 'otp.ts'), 'utf8')
const STORE_TS = readFileSync(join(HERE, '..', 'lib', 'db', 'otpStore.ts'), 'utf8')

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
  do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
`)

const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const errOf = async (sql, params = []) => {
  try { await db.query(sql, params); return null } catch (e) { return e.message }
}

let phoneSeq = 0
const nextPhone = () => '+9725' + String(42000000 + phoneSeq++)

const ADMIN_AUTH = crypto.randomUUID()

// ════════════════════════════════════════════════════════════════════════════
section('הרצת המיגרציות 0001→0013')
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
  } catch (e) {
    chk(`${name.slice(0, 4)} רצה במלואה`, false, e.message)
    console.log('\n⛔ עוצר — אין טעם להמשיך.')
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו, כולל 0013 ו-0014`)

// ── עזרים ──────────────────────────────────────────────────────────────────

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

/** ברירות מחדל שתואמות ל-lib/otp.ts */
const issue = async (phone, opts = {}) => {
  const {
    purpose = 'login', hash = HASH_A, ip = null,
    ttl = 300, cooldown = 60, perHour = 5, perDay = 10, perIp = 15,
  } = opts
  return (await one(
    `select public.issue_otp_atomic($1,$2,$3,$4::inet,$5,$6,$7,$8,$9) r`,
    [phone, purpose, hash, ip, ttl, cooldown, perHour, perDay, perIp],
  )).r
}

const verify = async (phone, hash, opts = {}) => {
  const { purpose = 'login', maxAttempts = 5 } = opts
  return (await one(
    `select public.verify_otp_atomic($1,$2,$3,$4) r`,
    [phone, purpose, hash, maxAttempts],
  )).r
}

const rowsFor = async phone =>
  await q(`select * from otp_attempts where phone_e164 = $1 order by id`, [phone])

// ════════════════════════════════════════════════════════════════════════════
section('הנפקה — המסלול התקין')
// ════════════════════════════════════════════════════════════════════════════

{
  const p = nextPhone()
  const r = await issue(p)
  chk('הנפקה ראשונה מותרת', r.allowed === true, JSON.stringify(r))
  chk('הוחזר otp_id', typeof r.otp_id === 'number' || typeof r.otp_id === 'string')
  chk('הוחזר expires_at', Boolean(r.expires_at))
  chk('נוצרה שורה אחת', (await rowsFor(p)).length === 1)

  // 🔒 אין PII בתשובה
  const asText = JSON.stringify(r)
  chk('⚠️ התשובה אינה מכילה את המספר', !asText.includes(p))
  chk('⚠️ התשובה אינה מכילה את הגיבוב', !asText.includes(HASH_A))
  chk('⚠️ התשובה אינה מכילה מפתח phone/hash/ip',
    !/phone|hash|code|"ip"/i.test(asText), asText)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 המרוץ: שתי הנפקות לאותו מספר')
// ════════════════════════════════════════════════════════════════════════════

{
  const p = nextPhone()
  const first = await issue(p)
  const second = await issue(p)

  chk('הראשונה מותרת', first.allowed === true)
  chk('השנייה נחסמת ב-cooldown', second.allowed === false && second.reason === 'cooldown',
    JSON.stringify(second))
  chk('🔒 נוצרה שורה אחת בלבד', (await rowsFor(p)).length === 1)
  chk('retry_after_sec סביר', second.retry_after_sec > 0 && second.retry_after_sec <= 60,
    String(second.retry_after_sec))
}

/**
 * ⚠️ הבדיקה שמפילה את הפתרון שנדחה.
 *
 * הפתרון שנשקל היה "בעל ה-id הנמוך שולח". nextval() אינו טרנזקציוני, ולכן
 * שורה עם id נמוך יכולה להיכתב *אחרי* שורה עם id גבוה. כאן נבנה בדיוק המצב
 * הזה — id נמוך עם created_at מאוחר יותר — ומאומת שההחלטה של הפונקציה אינה
 * משתנה. פונקציה שמכריעה לפי id הייתה מתירה כאן הנפקה שנייה.
 */
{
  const p = nextPhone()

  // שורה עם id *גבוה* אך created_at ישן (מחוץ ל-cooldown)
  await db.query(
    `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
     values ($1,$2,'login', now() + interval '5 min', now() - interval '10 min')`,
    [p, HASH_A],
  )
  // שורה עם id *גבוה עוד יותר* אך created_at טרי — היא זו שחוסמת
  await db.query(
    `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
     values ($1,$2,'login', now() + interval '5 min', now() - interval '2 sec')`,
    [p, HASH_B],
  )

  const r = await issue(p)
  chk('⚠️ ההחלטה נגזרת מ-created_at ולא מסדר ה-id',
    r.allowed === false && r.reason === 'cooldown', JSON.stringify(r))

  // ההפך: השורה הטרייה ביותר היא בעלת ה-id הנמוך ביותר
  const p2 = nextPhone()
  await db.query(
    `insert into otp_attempts (id, phone_e164, code_hash, purpose, expires_at, created_at)
     values (900001, $1, $2, 'login', now() + interval '5 min', now() - interval '2 sec')`,
    [p2, HASH_A],
  )
  await db.query(
    `insert into otp_attempts (id, phone_e164, code_hash, purpose, expires_at, created_at)
     values (900002, $1, $2, 'login', now() + interval '5 min', now() - interval '10 min')`,
    [p2, HASH_B],
  )
  const r2 = await issue(p2)
  chk('⚠️ גם כשה-id הנמוך הוא החדש ביותר — עדיין cooldown',
    r2.allowed === false && r2.reason === 'cooldown', JSON.stringify(r2))
}

{
  // מקור: הפונקציה אינה מכילה הכרעה לפי id בכלל
  const body = MIGRATION_0013.replace(/--.*$/gm, '')
  chk('⚠️ issue_otp_atomic אינה ממיינת ואינה משווה לפי id',
    !/order\s+by\s+id/i.test(body.split('verify_otp_atomic')[0]))
  chk('🔒 pg_advisory_xact_lock ולא pg_advisory_lock',
    body.includes('pg_advisory_xact_lock') && !/[^_]pg_advisory_lock\(/.test(body))
  chk('🔒 שתי הנעילות בסדר קבוע: טלפון (1) ואז IP (2)',
    body.indexOf('pg_advisory_xact_lock(1, hashtext(p_phone_e164))') <
    body.indexOf('pg_advisory_xact_lock(2, hashtext(host(p_ip)))'))
}

// ════════════════════════════════════════════════════════════════════════════
section('הנעילה נלקחת לפני כל קריאה')
// ════════════════════════════════════════════════════════════════════════════

{
  const issueBody = MIGRATION_0013
    .replace(/--.*$/gm, '')
    .split('create or replace function public.issue_otp_atomic')[1]
    .split('$$;')[0]

  const lockAt = issueBody.indexOf('pg_advisory_xact_lock')
  const firstSelect = issueBody.search(/select\s+count\(\*\)|select\s+max\(created_at\)/i)
  chk('🔒 הנעילה קודמת לקריאה הראשונה מהטבלה',
    lockAt > -1 && firstSelect > -1 && lockAt < firstSelect,
    `lock@${lockAt} select@${firstSelect}`)

  const insertAt = issueBody.indexOf('insert into public.otp_attempts')
  chk('🔒 ה-INSERT מגיע אחרי כל הבדיקות', insertAt > firstSelect)
}

// ════════════════════════════════════════════════════════════════════════════
section('התקרות — ואי-אפשרות להרפות אותן')
// ════════════════════════════════════════════════════════════════════════════

{
  const p = nextPhone()
  // 5 שורות בשעה האחרונה, כולן מחוץ ל-cooldown
  for (let i = 0; i < 5; i++) {
    await db.query(
      `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
       values ($1,$2,'login', now(), now() - make_interval(secs => $3))`,
      [p, HASH_A, 120 + i * 60],
    )
  }
  const r = await issue(p)
  chk('תקרת 5 בשעה נאכפת', r.allowed === false && r.reason === 'hourly_limit', JSON.stringify(r))

  // 🔒 ניסיון להרפות דרך הפרמטר
  const relaxed = await issue(p, { perHour: 1000000 })
  chk('🔒 p_max_per_hour גדול אינו מרפה את התקרה',
    relaxed.allowed === false && relaxed.reason === 'hourly_limit', JSON.stringify(relaxed))
}

{
  const p = nextPhone()
  // 10 שורות ביממה, אך רק 1 בשעה האחרונה → daily ולא hourly
  for (let i = 0; i < 10; i++) {
    await db.query(
      `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
       values ($1,$2,'login', now(), now() - make_interval(secs => $3))`,
      [p, HASH_A, 3700 + i * 3600],
    )
  }
  const r = await issue(p)
  chk('תקרת 10 ביום נאכפת', r.allowed === false && r.reason === 'daily_limit', JSON.stringify(r))

  const relaxed = await issue(p, { perDay: 999 })
  chk('🔒 p_max_per_day גדול אינו מרפה את התקרה',
    relaxed.allowed === false && relaxed.reason === 'daily_limit')
}

{
  // ⚠️ מגבלת IP: 15 בקשות מאותו IP, כל אחת ממספר *אחר*.
  const ip = '203.0.113.77'
  for (let i = 0; i < 15; i++) {
    await db.query(
      `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, ip, created_at)
       values ($1,$2,'login', now(), $3::inet, now() - interval '5 min')`,
      [nextPhone(), HASH_A, ip],
    )
  }
  const fresh = nextPhone()
  const r = await issue(fresh, { ip })
  chk('🔒 מספרים שונים מאותו IP אינם עוקפים את תקרת ה-IP',
    r.allowed === false && r.reason === 'ip_limit', JSON.stringify(r))
  chk('לא נוצרה שורה כשה-IP חסום', (await rowsFor(fresh)).length === 0)

  const relaxed = await issue(fresh, { ip, perIp: 999999 })
  chk('🔒 p_max_per_ip_per_hour גדול אינו מרפה את התקרה',
    relaxed.allowed === false && relaxed.reason === 'ip_limit')

  // IP אחר עדיין עובד — המגבלה ממוקדת ולא גורפת
  const other = await issue(nextPhone(), { ip: '198.51.100.5' })
  chk('IP אחר אינו מושפע', other.allowed === true)
}

{
  // ⚠️ מגבלת ה-IP נבדקת *לפני* ה-cooldown, בדיוק כמו ב-checkOtpRateLimit
  const ip = '203.0.113.99'
  for (let i = 0; i < 15; i++) {
    await db.query(
      `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, ip, created_at)
       values ($1,$2,'login', now(), $3::inet, now() - interval '5 min')`,
      [nextPhone(), HASH_A, ip],
    )
  }
  const p = nextPhone()
  await db.query(
    `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
     values ($1,$2,'login', now(), now() - interval '2 sec')`,
    [p, HASH_A],
  )
  const r = await issue(p, { ip })
  chk('סדר הבדיקות: ip_limit גובר על cooldown', r.reason === 'ip_limit', JSON.stringify(r))
}

{
  // cooldown לא ניתן לקיצור
  const p = nextPhone()
  await issue(p)
  const r = await issue(p, { cooldown: 0 })
  chk('🔒 p_cooldown_seconds=0 אינו מקצר את ה-cooldown',
    r.allowed === false && r.reason === 'cooldown', JSON.stringify(r))
}

{
  // ttl לא ניתן להארכה מעבר לתקרה
  const p = nextPhone()
  const r = await issue(p, { ttl: 86400 })
  const row = (await rowsFor(p))[0]
  const ttlSec = (new Date(row.expires_at) - new Date(row.created_at)) / 1000
  chk('🔒 p_ttl_seconds ענק מהודק ל-900 שניות', r.allowed === true && ttlSec <= 901,
    `ttl=${Math.round(ttlSec)}s`)
}

// ════════════════════════════════════════════════════════════════════════════
section('הנפקה — ולידציה')
// ════════════════════════════════════════════════════════════════════════════

{
  chk('מספר לא תקין נדחה',
    (await errOf(`select public.issue_otp_atomic('0541234567','login',$1,null,300,60,5,10,15)`,
      [HASH_A]))?.includes('OTP_BAD_PHONE'))
  chk('purpose לא מוכר נדחה',
    (await errOf(`select public.issue_otp_atomic('+972541234599','admin',$1,null,300,60,5,10,15)`,
      [HASH_A]))?.includes('OTP_BAD_PURPOSE'))
  chk('גיבוב שאינו 64 hex נדחה',
    (await errOf(`select public.issue_otp_atomic('+972541234599','login','123',null,300,60,5,10,15)`))
      ?.includes('OTP_BAD_CODE_HASH'))

  // ⚠️ הודעת החריגה אינה משכפלת את הקלט
  const msg = await errOf(
    `select public.issue_otp_atomic('+972541234599','login',$1,null,300,60,5,10,15)`, [HASH_B])
  chk('הודעות החריגה אינן מכילות את הגיבוב', msg === null || !msg.includes(HASH_B))
}

// ════════════════════════════════════════════════════════════════════════════
section('אימות — המסלול התקין ומונה הניסיונות')
// ════════════════════════════════════════════════════════════════════════════

{
  const p = nextPhone()
  await issue(p, { hash: HASH_A })

  chk('קוד שגוי → wrong', (await verify(p, HASH_B)).result === 'wrong')
  chk('מונה הניסיונות עלה', (await rowsFor(p))[0].attempts === 1)

  chk('קוד נכון → ok', (await verify(p, HASH_A)).result === 'ok')
  chk('consumed_at נכתב', (await rowsFor(p))[0].consumed_at !== null)

  // 🔒 שימוש חוזר
  chk('🔒 קוד שנצרך אינו ניתן לשימוש חוזר', (await verify(p, HASH_A)).result === 'no_code')
}

{
  // חמישה ניחושים → נעילה
  const p = nextPhone()
  await issue(p, { hash: HASH_A })
  const outcomes = []
  for (let i = 0; i < 5; i++) outcomes.push((await verify(p, HASH_B)).result)
  chk('4 ניחושים ראשונים → wrong', outcomes.slice(0, 4).every(o => o === 'wrong'),
    outcomes.join(','))
  chk('החמישי → too_many', outcomes[4] === 'too_many')
  chk('מונה הניסיונות = 5', (await rowsFor(p))[0].attempts === 5)
  chk('🔒 גם הקוד הנכון נדחה אחרי הנעילה', (await verify(p, HASH_A)).result === 'too_many')
  chk('הקוד לא נצרך בנעילה', (await rowsFor(p))[0].consumed_at === null)
}

{
  // 🔒 p_max_attempts גדול אינו מרפה
  const p = nextPhone()
  await issue(p, { hash: HASH_A })
  for (let i = 0; i < 5; i++) await verify(p, HASH_B, { maxAttempts: 1000 })
  chk('🔒 p_max_attempts=1000 אינו מרפה את תקרת 5 הניסיונות',
    (await verify(p, HASH_A, { maxAttempts: 1000 })).result === 'too_many')
}

{
  // תפוגה
  const p = nextPhone()
  await db.query(
    `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
     values ($1,$2,'login', now() - interval '1 min', now() - interval '6 min')`,
    [p, HASH_A],
  )
  chk('קוד שפג תוקפו → expired', (await verify(p, HASH_A)).result === 'expired')

  // ⚠️ אין פרמטר זמן שהקורא יכול לזייף
  chk('⚠️ ל-verify_otp_atomic אין פרמטר זמן',
    !/verify_otp_atomic\([^)]*now|p_now/i.test(MIGRATION_0013.replace(/--.*$/gm, '')))
}

{
  const p = nextPhone()
  chk('אין קוד כלל → no_code', (await verify(p, HASH_A)).result === 'no_code')
}

{
  // רק הקוד האחרון תקף
  const p = nextPhone()
  await db.query(
    `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
     values ($1,$2,'login', now() + interval '5 min', now() - interval '5 min')`,
    [p, HASH_A],
  )
  await db.query(
    `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
     values ($1,$2,'login', now() + interval '5 min', now() - interval '1 min')`,
    [p, HASH_B],
  )
  chk('🔒 הקוד הישן כבר אינו תקף', (await verify(p, HASH_A)).result === 'wrong')
  chk('הקוד האחרון תקף', (await verify(p, HASH_B)).result === 'ok')
}

{
  // הפרדה בין purposes
  const p = nextPhone()
  await issue(p, { purpose: 'login', hash: HASH_A })
  chk('קוד של login אינו מאמת booking',
    (await verify(p, HASH_A, { purpose: 'booking' })).result === 'no_code')
}

{
  // 🔒 אין PII בתוצאת האימות
  const p = nextPhone()
  await issue(p, { hash: HASH_A })
  const r = await verify(p, HASH_B)
  const asText = JSON.stringify(r)
  chk('⚠️ תוצאת האימות אינה מכילה מספר, גיבוב או מונה',
    !asText.includes(p) && !asText.includes(HASH_A) && !asText.includes(HASH_B) &&
    !/attempts|phone|hash/i.test(asText), asText)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 ביטול הנפקה שנדחתה בוודאות')
// ════════════════════════════════════════════════════════════════════════════

const discard = async (otpId, phone, purpose = 'login') =>
  (await one(`select public.discard_otp_issue_atomic($1,$2,$3) r`, [otpId, phone, purpose])).r

/**
 * ⚠️ התרחיש המלא שהפער נוגע בו:
 *   1. קוד A נשלח והגיע ללקוחה.
 *   2. בקשה לקוד B מקבלת permanent_error מהספק.
 *   3. שורת B נמחקת.
 *   4. קוד A נשאר האחרון התקף וניתן לאימות.
 *
 * בלי שלב 3, הקוד שביד הלקוחה מפסיק לעבוד — והיא גם חסומה 60 שניות
 * מלבקש חדש.
 */
{
  const p = nextPhone()

  // 1. קוד A — מחוץ ל-cooldown כדי שאפשר יהיה לבקש שוב
  await db.query(
    `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
     values ($1,$2,'login', now() + interval '5 min', now() - interval '2 min')`,
    [p, HASH_A],
  )

  // 2. קוד B מונפק, ואז השליחה נדחית בוודאות
  const issued = await issue(p, { hash: HASH_B })
  chk('1–2. קוד B הונפק', issued.allowed === true)
  chk('   ושורת B היא כעת האחרונה', (await verify(p, HASH_A)).result === 'wrong')

  // ⚠️ הניסיון הכושל למעלה העלה את attempts של B. עד 0014 זה היה חוסם את
  //    הביטול ומשאיר את B תקועה כקוד האחרון — בדיוק הבאג ש-0014 סגרה.
  //    השורה **אינה** מאופסת כאן יותר: זה החלק שנבדק.
  const bAttempts = (await rowsFor(p)).find(r => String(r.id) === String(issued.otp_id))?.attempts
  chk('   ⚠️ ל-B נרשם ניסיון (הקלדה של A שנפלה עליה)', bAttempts > 0, `attempts=${bAttempts}`)

  // 3. ביטול
  const d = await discard(issued.otp_id, p)
  chk('3. שורת B נמחקה', d.result === 'discarded', JSON.stringify(d))
  chk('   ונשארה שורה אחת בלבד', (await rowsFor(p)).length === 1)

  // 4. קוד A חזר להיות האחרון התקף
  chk('🔒 4. קוד A שוב תקף וניתן לאימות', (await verify(p, HASH_A)).result === 'ok')
}

{
  // ⚠️ 7. אחרי ביטול — אין cooldown והמכסות לא נספרות
  const p = nextPhone()
  const issued = await issue(p)
  chk('הנפקה ראשונה', issued.allowed === true)

  const blockedBefore = await issue(p)
  chk('לפני הביטול — cooldown פעיל', blockedBefore.reason === 'cooldown')

  chk('הביטול הצליח', (await discard(issued.otp_id, p)).result === 'discarded')

  const after = await issue(p)
  chk('🔒 7. אחרי הביטול — אין cooldown', after.allowed === true, JSON.stringify(after))
  chk('🔒 והשורה שנמחקה אינה נספרת במכסות', (await rowsFor(p)).length === 1)
}

{
  // 🔒 5+6. delivery_unknown ו-accepted אינם מוחקים — נאכף בשכבת ה-route,
  // ונבדק שם (test-otp-sms019). כאן מאומת שהמחיקה אינה קורית מעצמה:
  // ה-RPC אינו נקרא אלא במפורש, ואין טריגר שמוחק שורות.
  const triggers = await q(
    `select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'otp_attempts' and not t.tgisinternal`)
  chk('🔒 5–6. אין טריגר על otp_attempts שמוחק שורות מעצמו',
    triggers.length === 0, triggers.map(r => r.tgname).join(','))
}

{
  // 🔒 8. otp_id ישן אינו מוחק שורה חדשה יותר
  const p = nextPhone()
  const older = await issue(p)
  await db.query(
    `update otp_attempts set created_at = now() - interval '5 min' where id = $1`,
    [older.otp_id],
  )
  const newer = await issue(p)
  chk('הונפקה שורה חדשה יותר', newer.allowed === true)

  const d = await discard(older.otp_id, p)
  chk('🔒 8. ביטול של otp_id ישן מסורב כ-superseded', d.result === 'superseded',
    JSON.stringify(d))
  chk('🔒 והשורה החדשה שרדה',
    (await rowsFor(p)).some(r => String(r.id) === String(newer.otp_id)))
  chk('   וגם הישנה לא נמחקה', (await rowsFor(p)).length === 2)
}

{
  // ⚠️ 10. הגנת המרוץ: בקשה שנחסמה אינה מקבלת otp_id, ולכן אין לה מה למחוק
  const p = nextPhone()
  const winner = await issue(p)
  const loser = await issue(p)
  chk('🔒 10. הבקשה שנחסמה אינה מקבלת otp_id',
    winner.otp_id !== undefined && loser.otp_id === undefined,
    `winner=${winner.otp_id} loser=${loser.otp_id}`)
  chk('🔒 ולכן אינה יכולה למחוק את השורה של המנצחת',
    (await rowsFor(p)).length === 1)
}

{
  // סירובים — כל אחד הוא הגנה נפרדת
  const p = nextPhone()
  const issued = await issue(p, { hash: HASH_A })

  chk('מספר לא תואם → not_found',
    (await discard(issued.otp_id, nextPhone())).result === 'not_found')
  chk('purpose לא תואם → not_found',
    (await discard(issued.otp_id, p, 'booking')).result === 'not_found')
  chk('מזהה שאינו קיים → not_found', (await discard(999999999, p)).result === 'not_found')
  chk('⚠️ אף אחד מהסירובים לא מחק כלום', (await rowsFor(p)).length === 1)

  // אחרי צריכה — החוסם היחיד שנשאר
  await verify(p, HASH_A)
  chk('🔒 שורה שנוצלה → consumed', (await discard(issued.otp_id, p)).result === 'consumed')
  chk('   ולא נמחקה — הראיה נשמרת', (await rowsFor(p)).length === 1)
}

// ── 0014: attempts כבר אינו חוסם ────────────────────────────────────────────

{
  // ⚠️ 2. ניסיון שגוי נגד B מגדיל attempts, ואז discard מוחק את B
  const p = nextPhone()
  const issued = await issue(p, { hash: HASH_A })
  await verify(p, HASH_B)
  const row = (await rowsFor(p))[0]
  chk('2. ניסיון שגוי העלה attempts', row.attempts === 1)

  const d = await discard(issued.otp_id, p)
  chk('🔒 2. שורה עם attempts>0 **נמחקת** (0014)', d.result === 'discarded', JSON.stringify(d))
  chk('   ולא נשארה במסד', (await rowsFor(p)).length === 0)
}

{
  // ⚠️ 1. התרחיש המלא: A בידי הלקוחה, B נכשלה, הקלדה של A נפלה על B
  const p = nextPhone()
  await db.query(
    `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
     values ($1,$2,'login', now() + interval '5 min', now() - interval '2 min')`,
    [p, HASH_A],
  )
  const b = await issue(p, { hash: HASH_B })

  // הלקוחה מקלידה את A — הוא נופל על B כי B היא האחרונה
  chk('1. הקלדת A נופלת על B', (await verify(p, HASH_A)).result === 'wrong')
  chk('   ו-A אינו שמיש כל עוד B קיימת', (await rowsFor(p)).length === 2)

  chk('🔒 1. discard מוחק את B למרות ה-attempts', (await discard(b.otp_id, p)).result === 'discarded')
  chk('🔒 1. **A חזר להיות הקוד האחרון התקף**', (await verify(p, HASH_A)).result === 'ok')
}

{
  // ⚠️ 6. אחרי הניקוי — B אינה נספרת ב-cooldown ובמכסות
  const p = nextPhone()
  const issued = await issue(p)
  await verify(p, HASH_B)   // מעלה attempts, שפעם היה חוסם
  chk('6. לפני הניקוי — cooldown', (await issue(p)).reason === 'cooldown')
  chk('6. הניקוי הצליח למרות attempts', (await discard(issued.otp_id, p)).result === 'discarded')
  chk('🔒 6. אחרי הניקוי אין cooldown', (await issue(p)).allowed === true)
}

{
  // 🔒 5. otp_id ישן אינו מוחק שורה חדשה — גם כשלישנה יש attempts
  const p = nextPhone()
  const older = await issue(p)
  await verify(p, HASH_B)
  await db.query(
    `update otp_attempts set created_at = now() - interval '5 min' where id = $1`,
    [older.otp_id],
  )
  const newer = await issue(p)
  chk('5. הונפקה שורה חדשה יותר', newer.allowed === true)
  chk('🔒 5. ביטול מזהה ישן עם attempts → superseded, לא discarded',
    (await discard(older.otp_id, p)).result === 'superseded')
  chk('   ושתי השורות שרדו', (await rowsFor(p)).length === 2)
}

{
  /**
   * ⚠️ המקור עצמו: attempts לא נבדק יותר בפונקציה.
   *
   * חובה להסיר גם הערות `/* *\/` ולא רק `--`: גוף הפונקציה מכיל הערה
   * שמצטטת את התנאי הישן (`if v_row.attempts > 0 ... 'attempted'`) כדי
   * שברור יהיה מה הוסר ולמה. סריקה שלא מסירה אותה מוצאת את הציטוט
   * ומדווחת על באג שכבר תוקן.
   */
  const body = MIGRATION_0014
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .split('create or replace function public.discard_otp_issue_atomic')[1].split('$$;')[0]
  chk('🔒 0014 אינה בודקת attempts כלל', !/v_row\.attempts/.test(body))
  chk('🔒 ואינה מחזירה attempted', !body.includes("'attempted'"))
  chk('🔒 consumed_at עדיין חוסם', body.includes('v_row.consumed_at is not null'))
  chk('🔒 superseded עדיין קיים', body.includes("'superseded'"))
  chk('🔒 אותה נעילה נשמרה',
    body.includes('pg_advisory_xact_lock(1, hashtext(p_phone_e164))'))
  chk('🔒 search_path נשאר נעול ב-CREATE OR REPLACE',
    MIGRATION_0014.includes('set search_path = pg_catalog, public'))
  chk('🔒 0013 לא שונתה — עדיין מכילה את הבדיקה הישנה',
    MIGRATION_0013.includes("'attempted'"))
}

{
  // ולידציה
  chk('מספר לא תקין נדחה',
    (await errOf(`select public.discard_otp_issue_atomic(1,'0541234567','login')`))
      ?.includes('OTP_BAD_PHONE'))
  chk('purpose לא מוכר נדחה',
    (await errOf(`select public.discard_otp_issue_atomic(1,'+972541234599','admin')`))
      ?.includes('OTP_BAD_PURPOSE'))
  chk('מזהה null נדחה',
    (await errOf(`select public.discard_otp_issue_atomic(null,'+972541234599','login')`))
      ?.includes('OTP_BAD_ID'))
}

{
  // 🔒 אין PII בתוצאה, ואין דרך למחוק "את השורה האחרונה"
  const p = nextPhone()
  const issued = await issue(p)
  const r = await discard(issued.otp_id, p)
  const asText = JSON.stringify(r)
  chk('⚠️ תוצאת הביטול אינה מכילה מספר או מזהה',
    !asText.includes(p) && !asText.includes(String(issued.otp_id)), asText)

  const body = MIGRATION_0013.replace(/--.*$/gm, '')
    .split('create or replace function public.discard_otp_issue_atomic')[1].split('$$;')[0]
  chk('🔒 המחיקה היא לפי id יחיד ומדויק',
    body.includes('delete from public.otp_attempts where id = v_row.id'))
  chk('🔒 אין מחיקה לפי טלפון בלבד',
    !/delete[\s\S]*where[\s\S]*phone_e164\s*=\s*p_phone_e164/i.test(body))
  chk('🔒 השורה נבחרת לפי id **וגם** טלפון ו-purpose',
    body.includes('and phone_e164 = p_phone_e164') && body.includes('and purpose    = p_purpose'))
  chk('🔒 הנעילה נלקחת לפני הבחירה',
    body.indexOf('pg_advisory_xact_lock') < body.indexOf('select * into v_row'))
  chk('⚠️ הקוד הגלוי אינו פרמטר של הפונקציה', !/p_code\b|p_candidate/.test(body))
}

// ════════════════════════════════════════════════════════════════════════════
section('השוואה בזמן קבוע')
// ════════════════════════════════════════════════════════════════════════════

{
  chk('גיבובים זהים', (await one(`select public.otp_hash_equals($1,$1) m`, [HASH_A])).m === true)
  chk('גיבובים שונים', (await one(`select public.otp_hash_equals($1,$2) m`, [HASH_A, HASH_B])).m === false)
  chk('אורך שונה', (await one(`select public.otp_hash_equals($1,$2) m`, [HASH_A, 'a'.repeat(63)])).m === false)
  chk('null', (await one(`select public.otp_hash_equals(null,$1) m`, [HASH_A])).m === false)

  const body = MIGRATION_0013.replace(/--.*$/gm, '')
  chk('⚠️ ההשוואה סורקת את כל האורך (generate_series) ולא `=`',
    /generate_series\(1,\s*length\(p_left\)\)/.test(body))
  chk('⚠️ verify_otp_atomic משתמשת ב-otp_hash_equals ולא ב-`=`',
    body.includes('public.otp_hash_equals(v_row.code_hash, p_candidate_hash)') &&
    !/code_hash\s*=\s*p_candidate_hash/.test(body))
}

// ════════════════════════════════════════════════════════════════════════════
section('הרשאות: anon ו-authenticated חסומים')
// ════════════════════════════════════════════════════════════════════════════

const SIGS = [
  ['otp_hash_equals(text, text)', 'otp_hash_equals'],
  ['issue_otp_atomic(text, text, text, inet, integer, integer, integer, integer, integer)', 'issue_otp_atomic'],
  ['verify_otp_atomic(text, text, text, integer)', 'verify_otp_atomic'],
  ['discard_otp_issue_atomic(bigint, text, text)', 'discard_otp_issue_atomic'],
]

for (const [sig, name] of SIGS) {
  for (const role of ['anon', 'authenticated']) {
    const r = await one(`select has_function_privilege($1, $2, 'execute') p`, [role, `public.${sig}`])
    chk(`🔒 ${role} אינו יכול להפעיל את ${name}`, r.p === false)
  }
  const sr = await one(`select has_function_privilege('service_role', $1, 'execute') p`, [`public.${sig}`])
  chk(`service_role כן יכול להפעיל את ${name}`, sr.p === true)
}

{
  const secdef = await q(
    `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prosecdef
       and proname in ('issue_otp_atomic','verify_otp_atomic','otp_hash_equals',
                      'discard_otp_issue_atomic')`)
  chk('🔒 אף פונקציית OTP אינה SECURITY DEFINER', secdef.length === 0,
    secdef.map(r => r.proname).join(','))

  // 🔒 search_path נעול על כל ארבע — הדרישה שהעלית לפני Supabase
  const paths = await q(
    `select proname, proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and proname in
       ('issue_otp_atomic','verify_otp_atomic','otp_hash_equals','discard_otp_issue_atomic')
     order by proname`)
  chk('🔒 כל ארבע הפונקציות עם search_path נעול', paths.length === 4 &&
    paths.every(r => (r.proconfig ?? []).some(c => c === 'search_path=pg_catalog, public')),
    paths.map(r => `${r.proname}:${(r.proconfig ?? []).join('|')}`).join('  '))

  const rls = await one(
    `select relrowsecurity r from pg_class where oid='public.otp_attempts'::regclass`)
  chk('🔒 RLS עדיין מופעל על otp_attempts', rls.r === true)

  const pol = await q(`select policyname from pg_policies where tablename='otp_attempts'`)
  chk('🔒 אין policies על otp_attempts (זהו מודל האבטחה)', pol.length === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('התאמה דיפרנציאלית מול lib/otp.ts')
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ שתי המימושים חייבים להסכים. checkOtpRateLimit נשארה בקוד בדיוק בשביל
 * הבדיקה הזו: היא האורקל, וה-SQL הוא מה שרץ. פיצול ביניהם — למשל שינוי
 * תקרה במקום אחד בלבד — נתפס כאן.
 */
{
  const otp = await import('../lib/otp.ts')

  // התקרות הקשיחות ב-SQL תואמות לקבועים ב-TS
  const clamps = MIGRATION_0013.replace(/--.*$/gm, '')
  chk('תקרת השעה ב-SQL = OTP_MAX_PER_HOUR',
    clamps.includes(`least(coalesce(p_max_per_hour, 5), ${otp.OTP_MAX_PER_HOUR})`),
    String(otp.OTP_MAX_PER_HOUR))
  chk('תקרת היום ב-SQL = OTP_MAX_PER_DAY',
    clamps.includes(`least(coalesce(p_max_per_day, 10), ${otp.OTP_MAX_PER_DAY})`),
    String(otp.OTP_MAX_PER_DAY))
  chk('תקרת ה-IP ב-SQL = OTP_MAX_PER_IP_PER_HOUR',
    clamps.includes(`least(coalesce(p_max_per_ip_per_hour, 15), ${otp.OTP_MAX_PER_IP_PER_HOUR})`),
    String(otp.OTP_MAX_PER_IP_PER_HOUR))
  chk('רצפת ה-cooldown ב-SQL = OTP_RESEND_COOLDOWN_SEC',
    clamps.includes(`greatest(coalesce(p_cooldown_seconds, 60), ${otp.OTP_RESEND_COOLDOWN_SEC})`),
    String(otp.OTP_RESEND_COOLDOWN_SEC))
  chk('תקרת הניסיונות ב-SQL = OTP_MAX_ATTEMPTS',
    clamps.includes(`least(coalesce(p_max_attempts, 5), ${otp.OTP_MAX_ATTEMPTS})`),
    String(otp.OTP_MAX_ATTEMPTS))

  // אותה החלטה על אותם קלטים
  const cases = [
    { name: 'ריק', rows: [], ipCount: 0, expect: null },
    { name: 'cooldown', rows: [10], ipCount: 0, expect: 'cooldown' },
    { name: 'שעה', rows: [120, 300, 600, 900, 1200], ipCount: 0, expect: 'hourly_limit' },
    { name: 'IP', rows: [], ipCount: 15, expect: 'ip_limit' },
  ]

  for (const c of cases) {
    const now = new Date()
    const decision = otp.checkOtpRateLimit({
      recentForPhone: c.rows.map(s => new Date(now.getTime() - s * 1000)),
      countForIpLastHour: c.ipCount,
    }, now)

    const p = nextPhone()
    const ip = c.ipCount > 0 ? '198.51.100.200' : null
    for (const s of c.rows) {
      await db.query(
        `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
         values ($1,$2,'login', now(), now() - make_interval(secs => $3))`,
        [p, HASH_A, s],
      )
    }
    if (ip) {
      for (let i = 0; i < c.ipCount; i++) {
        await db.query(
          `insert into otp_attempts (phone_e164, code_hash, purpose, expires_at, ip, created_at)
           values ($1,$2,'login', now(), $3::inet, now() - interval '5 min')`,
          [nextPhone(), HASH_A, ip],
        )
      }
    }

    const sql = await issue(p, { ip })
    const sqlReason = sql.allowed ? null : sql.reason
    chk(`דיפרנציאלי — ${c.name}: TS ו-SQL מסכימים`,
      (decision.allowed ? null : decision.reason) === sqlReason && sqlReason === c.expect,
      `TS=${decision.reason ?? 'allowed'} SQL=${sqlReason ?? 'allowed'}`)
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('otpStore אינו נוגע בטבלה ישירות')
// ════════════════════════════════════════════════════════════════════════════

{
  chk('🔒 issueOtp קוראת ל-issue_otp_atomic', STORE_TS.includes("rpc('issue_otp_atomic'"))
  chk('🔒 verifyOtp קוראת ל-verify_otp_atomic', STORE_TS.includes("rpc('verify_otp_atomic'"))
  chk('🔒 אין יותר גישה ישירה ל-otp_attempts מהקוד',
    !STORE_TS.includes("from('otp_attempts')"))
  chk('⚠️ הקוד הגלוי אינו נשלח ל-RPC (רק גיבוב)',
    !/p_code:\s|p_candidate:\s/.test(STORE_TS) &&
    STORE_TS.includes('p_candidate_hash: candidateHash'))
  chk('⚠️ נרשם sqlstate בלבד, לא message/details/hint',
    STORE_TS.includes('error?.code ?? ') &&
    !/error\.message|error\.details|error\.hint/.test(STORE_TS))
  /**
   * ⚠️ הבדיקה ממוקדת בגוף hashOtpCode ולא בקובץ כולו, משתי סיבות:
   *   • התיעוד מצטט את הקוד הישן, וחיפוש גלובלי היה "מוצא" באג שתוקן.
   *   • checkOtpPepper *כן* כותבת `env.OTP_PEPPER ?? ''` — שם זה הזיהוי
   *     של הערך החסר, לא נפילה שקטה אליו.
   * מה שאסור הוא שהגיבוב עצמו ייגזר מ-pepper ריק.
   */
  const otpCode = OTP_TS
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const hashBody = otpCode.split('export function hashOtpCode')[1]?.split('\n}')[0] ?? ''

  chk('⚠️ hashOtpCode אינה גוזרת גיבוב מ-pepper ריק',
    hashBody.length > 0 && !hashBody.includes("?? ''"), hashBody.trim().slice(0, 60))
  chk('⚠️ OTP_PEPPER חסר → חריגה, לא גיבוב חלש',
    hashBody.includes('throw new OtpPepperError'))
  chk('⚠️ בפרודקשן נאכף גם אורך מינימלי',
    otpCode.includes('OTP_PEPPER_MIN_LENGTH') && otpCode.includes("env.NODE_ENV === 'production'"))
}

// ── סיכום ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} נכשלו`)
console.log('⚠️ ריצה מקבילה אמיתית נבדקת ב-npm run test:live:otp-atomic')
process.exit(failed === 0 ? 0 : 1)
