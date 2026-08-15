/**
 * בדיקות שלב 14 — ביטול session בצד השרת (app_sessions, מיגרציה 0015).
 *
 * המיקוד: מה שהמימוש הקודם לא יכול היה להבטיח —
 *   1. ש-JWT שהועתק **לפני** logout מפסיק לעבוד מיד אחריו.
 *   2. ש-token מלפני שלב 14 (בלי jti) אינו תקף — בלי תקופת חסד.
 *   3. שהתנתקות במכשיר אחד אינה מפילה מכשיר אחר, והפרדת admin/customer נשמרת.
 *   4. שהטבלה סגורה הרמטית ל-anon ול-authenticated.
 *   5. שהחלפת SESSION_SECRET הורגת את כל ה-token-ים הישנים.
 *
 * ⚠️ **מגבלה שיש להכיר:** החיווט עצמו — שהקוד ב-lib/auth/session.ts באמת
 * קורא לבדיקות האלה בסדר הנכון — אינו נבדק כאן מקצה לקצה: `getSession`
 * מייבאת `next/headers` ומדברת עם Supabase, ולכן אינה ניתנת לייבוא לסקריפט.
 * מה שכן נבדק כאן במלואו: הסמנטיקה של הטבלה מול Postgres אמיתי, הלוגיקה
 * הטהורה של קריאת ה-claims מול token-ים אמיתיים חתומים ב-jose, וסדר
 * הפעולות בקוד — ע"י assertions על המקור. החוליה האחרונה נסגרת ב-QA ידני
 * אחד אחרי הפריסה.
 *
 * ⚠️ אין כאן SMS, אין OTP אמיתי, אין Cron, ואין נגיעה בנתוני production.
 * ה-Postgres כאן הוא PGlite — Postgres מקומפל ל-WASM, בזיכרון בלבד.
 *
 * הרצה:  npm run test:session-revocation
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

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', 'supabase', 'migrations')
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

const read = (...parts) => readFileSync(join(HERE, '..', ...parts), 'utf8')
const SESSION_TS = read('lib', 'auth', 'session.ts')
const CLAIMS_TS = read('lib', 'auth', 'sessionClaims.ts')
const STORE_TS = read('lib', 'db', 'sessionStore.ts')
const LOGOUT_TS = read('app', 'api', 'auth', 'logout', 'route.ts')
const VERIFY_TS = read('app', 'api', 'auth', 'otp', 'verify', 'route.ts')
const MIDDLEWARE_TS = read('proxy.ts')
const LOGOUT_BUTTON_TSX = read('components', 'account', 'LogoutButton.tsx')

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

// ── Supabase stubs: סכמת auth, auth.uid(), ותפקידי ה-API ────────────────────
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, phone text);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  -- bypassrls — כך service_role מוגדר ב-Supabase האמיתי
  do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
`)

const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const errOf = async (sql, params = []) => {
  try { await db.query(sql, params); return null } catch (e) { return e.message }
}
const uuid = () => crypto.randomUUID()

let phoneSeq = 0
const nextPhone = () => '+9725' + String(46000000 + phoneSeq++)

/** יוצר auth user ומחזיר את המזהה */
const newAuthUser = async () => {
  const id = uuid()
  await db.query('insert into auth.users (id, phone) values ($1, $2)', [id, nextPhone()])
  return id
}

// ════════════════════════════════════════════════════════════════════════════
section('המיגרציות רצות במלואן')

for (const name of MIGRATIONS) {
  const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
  try {
    await db.exec(sql)
  } catch (e) {
    chk(`${name} רצה`, false, `\n   ${e.message}`)
    console.log('\n⛔ עוצר — אין טעם להמשיך.')
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו ללא שגיאה`, true, MIGRATIONS[MIGRATIONS.length - 1])
chk('0015 קיימת ברשימה', MIGRATIONS.includes('0015_app_sessions.sql'))

// ⚠️ הדרישה המפורשת של שלב 14: אין נגיעה במיגרציות קיימות.
{
  const legacy = MIGRATIONS.filter(m => m < '0015')
  const touching = legacy.filter(m => {
    const sql = readFileSync(join(MIGRATIONS_DIR, m), 'utf8')
    return /app_sessions/i.test(sql)
  })
  chk('אף מיגרציה 0001–0014 אינה מזכירה app_sessions', touching.length === 0, touching.join(', '))
}
{
  const sql = readFileSync(join(MIGRATIONS_DIR, '0015_app_sessions.sql'), 'utf8')
  const stripped = sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')
  chk('0015 אינה מבצעת ALTER על טבלה קיימת',
    !/alter\s+table\s+public\.(customers|appointments|admins|otp_attempts|business_settings|appointment_history|appointment_reminders)/i
      .test(stripped))
  chk('0015 אינה מוחקת שום דבר', !/\bdrop\s+(table|column|function|policy|index)\b/i.test(stripped))
  chk('0015 אינה נוגעת ב-OTP ובתזכורות',
    !/otp_attempts|appointment_reminders/i.test(stripped))
}

// ════════════════════════════════════════════════════════════════════════════
section('סכמת app_sessions')

{
  const cols = await q(`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'app_sessions'
    order by ordinal_position`)

  const byName = Object.fromEntries(cols.map(c => [c.column_name, c]))
  chk('הטבלה נוצרה עם 6 עמודות', cols.length === 6, cols.map(c => c.column_name).join(', '))
  chk('id uuid, לא NULL', byName.id?.data_type === 'uuid' && byName.id?.is_nullable === 'NO')
  chk('auth_user_id uuid, לא NULL',
    byName.auth_user_id?.data_type === 'uuid' && byName.auth_user_id?.is_nullable === 'NO')
  chk('role text, לא NULL', byName.role?.data_type === 'text' && byName.role?.is_nullable === 'NO')
  chk('expires_at timestamptz, לא NULL',
    byName.expires_at?.data_type === 'timestamp with time zone' && byName.expires_at?.is_nullable === 'NO')
  chk('revoked_at ניתן ל-NULL (NULL = session חי)', byName.revoked_at?.is_nullable === 'YES')

  const pk = await one(`
    select a.attname from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.app_sessions'::regclass and i.indisprimary`)
  chk('id הוא המפתח הראשי (ה-jti)', pk?.attname === 'id')

  const fk = await one(`
    select confdeltype from pg_constraint
    where conrelid = 'public.app_sessions'::regclass and contype = 'f'`)
  chk('FK ל-auth.users הוא ON DELETE CASCADE', fk?.confdeltype === 'c', `confdeltype=${fk?.confdeltype}`)

  const idx = (await q(`
    select indexname from pg_indexes where schemaname='public' and tablename='app_sessions'`))
    .map(r => r.indexname)
  chk('קיים אינדקס על expires_at (לניקוי)', idx.includes('app_sessions_expires_at_idx'), idx.join(', '))
  chk('קיים אינדקס על auth_user_id (לניתוק כל המכשירים)',
    idx.includes('app_sessions_auth_user_id_idx'))
}

{
  const u = await newAuthUser()
  const badRole = await errOf(
    `insert into app_sessions (id, auth_user_id, role, expires_at)
     values ($1, $2, 'root', now() + interval '30 days')`, [uuid(), u])
  chk('role שאינו customer/admin נדחה', badRole !== null && /check/i.test(badRole))

  const badExpiry = await errOf(
    `insert into app_sessions (id, auth_user_id, role, expires_at)
     values ($1, $2, 'customer', now() - interval '1 day')`, [uuid(), u])
  chk('expires_at בעבר נדחה בהכנסה', badExpiry !== null && /check/i.test(badExpiry))

  const orphan = await errOf(
    `insert into app_sessions (id, auth_user_id, role, expires_at)
     values ($1, $2, 'customer', now() + interval '30 days')`, [uuid(), uuid()])
  chk('session לא יכול להצביע על auth user שאינו קיים', orphan !== null)
}

// ════════════════════════════════════════════════════════════════════════════
section('הרשאות — הטבלה סגורה לתפקידי ה-API')

{
  const rls = await one(`select relrowsecurity from pg_class where oid='public.app_sessions'::regclass`)
  chk('RLS מופעל', rls?.relrowsecurity === true)

  const policies = await q(`select policyname from pg_policies where tablename='app_sessions'`)
  chk('אפס policies — הטבלה סגורה לחלוטין', policies.length === 0, `${policies.length}`)

  for (const role of ['anon', 'authenticated']) {
    for (const priv of ['select', 'insert', 'update', 'delete']) {
      const r = await one(`select has_table_privilege($1, 'public.app_sessions', $2) as ok`, [role, priv])
      chk(`ל-${role} אין הרשאת ${priv}`, r?.ok === false)
    }
  }
  for (const priv of ['select', 'insert', 'update', 'delete']) {
    const r = await one(`select has_table_privilege('service_role', 'public.app_sessions', $1) as ok`, [priv])
    chk(`ל-service_role יש הרשאת ${priv}`, r?.ok === true)
  }
}

{
  // ⚠️ לא רק has_table_privilege — ניסיון קריאה אמיתי בתור anon.
  const u = await newAuthUser()
  await db.query(
    `insert into app_sessions (id, auth_user_id, role, expires_at)
     values ($1, $2, 'customer', now() + interval '30 days')`, [uuid(), u])

  await db.exec('set role anon')
  const denied = await errOf('select * from app_sessions')
  const deniedWrite = await errOf(
    `insert into app_sessions (id, auth_user_id, role, expires_at)
     values ($1, $2, 'admin', now() + interval '30 days')`, [uuid(), u])
  await db.exec('reset role')

  chk('anon אינו יכול לקרוא את app_sessions בפועל', denied !== null && /permission denied/i.test(denied))
  chk('anon אינו יכול לכתוב ל-app_sessions בפועל', deniedWrite !== null)
}

// ════════════════════════════════════════════════════════════════════════════
section('מחזור החיים של session')

/**
 * מראה בדיוק את ארבעת התנאים של isSessionActive (lib/db/sessionStore.ts):
 * שורה קיימת, לא בוטלה, לא פגה, ו-auth_user_id/role תואמים ל-token.
 */
async function isActive(jti, authUserId, role) {
  const row = await one(
    `select auth_user_id, role, expires_at, revoked_at from app_sessions where id = $1`, [jti])
  if (!row) return false
  if (row.revoked_at !== null) return false
  if (new Date(row.expires_at).getTime() <= Date.now()) return false
  if (row.auth_user_id !== authUserId) return false
  if (row.role !== role) return false
  return true
}

const createRow = async (authUserId, role, ttlSql = `now() + interval '30 days'`) => {
  const jti = uuid()
  await db.query(
    `insert into app_sessions (id, auth_user_id, role, expires_at) values ($1, $2, $3, ${ttlSql})`,
    [jti, authUserId, role])
  return jti
}
const revoke = async jti =>
  (await db.query(`update app_sessions set revoked_at = now() where id = $1`, [jti])).affectedRows

{
  const user = await newAuthUser()
  const jti = await createRow(user, 'customer')

  chk('session חדש — פעיל', (await isActive(jti, user, 'customer')) === true)

  // ═══ הבדיקה המרכזית של שלב 14 ═══
  await revoke(jti)
  chk('🔒 replay של אותו token אחרי logout — נכשל',
    (await isActive(jti, user, 'customer')) === false)

  const row = await one(`select revoked_at from app_sessions where id = $1`, [jti])
  chk('השורה נשמרת כראיה ולא נמחקת בהתנתקות', row !== undefined && row.revoked_at !== null)

  await revoke(jti)
  chk('ביטול חוזר אינו משנה דבר (idempotent)',
    (await isActive(jti, user, 'customer')) === false)
}

/**
 * מזקין שורה כאילו נוצרה לפני יותר מ-30 יום.
 *
 * ⚠️ גם created_at מוזז אחורה, ולא רק expires_at: ה-CHECK
 * (expires_at > created_at) חל גם על UPDATE, ולכן "לדחוף רק את התפוגה
 * לעבר" הוא מצב שהמסד לא מרשה לו להיווצר מלכתחילה. זו הזקנה אמיתית של
 * session ישן, לא עקיפה של האילוץ.
 */
const ageOut = jti => db.query(
  `update app_sessions
      set created_at = now() - interval '31 days',
          expires_at = now() - interval '1 day'
    where id = $1`, [jti])

{
  const user = await newAuthUser()
  const jti = await createRow(user, 'customer')
  await ageOut(jti)
  chk('session שפג תוקפו אינו פעיל — גם בלי ביטול',
    (await isActive(jti, user, 'customer')) === false)
}

{
  // האילוץ עצמו: אי אפשר "לקצר" session לנקודה שקדמה ליצירתו
  const user = await newAuthUser()
  const jti = await createRow(user, 'customer')
  const err = await errOf(
    `update app_sessions set expires_at = created_at - interval '1 second' where id = $1`, [jti])
  chk('לא ניתן להזיז את התפוגה לפני מועד היצירה', err !== null && /check/i.test(err))
}

{
  const alice = await newAuthUser()
  const mallory = await newAuthUser()
  const jti = await createRow(alice, 'customer')

  chk('jti של משתמשת אחת אינו תקף עבור אחרת',
    (await isActive(jti, mallory, 'customer')) === false)
  chk('אי-התאמה ב-role בין ה-token לשורה נדחית',
    (await isActive(jti, alice, 'admin')) === false)
  chk('jti שאינו קיים כלל נדחה', (await isActive(uuid(), alice, 'customer')) === false)
}

section('הפרדת מכשירים והפרדת admin/customer')

{
  const user = await newAuthUser()
  const phone = await createRow(user, 'customer')
  const laptop = await createRow(user, 'customer')

  await revoke(phone)
  chk('התנתקות במכשיר אחד מבטלת אותו', (await isActive(phone, user, 'customer')) === false)
  chk('...ואינה נוגעת במכשיר השני', (await isActive(laptop, user, 'customer')) === true)
}

{
  const admin = await newAuthUser()
  const customer = await newAuthUser()
  const adminSession = await createRow(admin, 'admin')
  const customerSession = await createRow(customer, 'customer')

  await revoke(adminSession)
  chk('🔒 ביטול session של מנהלת חוסם אותו', (await isActive(adminSession, admin, 'admin')) === false)
  chk('...ואינו נוגע ב-session של לקוחה', (await isActive(customerSession, customer, 'customer')) === true)
  chk('session של לקוחה אינו הופך ל-admin ע"י החלפת role',
    (await isActive(customerSession, customer, 'admin')) === false)
}

{
  // ניתוק כל המכשירים של משתמשת — צעד תגובה לחשד לדליפה
  const user = await newAuthUser()
  const a = await createRow(user, 'customer')
  const b = await createRow(user, 'customer')
  const other = await newAuthUser()
  const c = await createRow(other, 'customer')

  await db.query(`update app_sessions set revoked_at = now()
                  where auth_user_id = $1 and revoked_at is null`, [user])
  chk('ניתן לנתק את כל מכשירי משתמשת אחת בפעולה אחת',
    (await isActive(a, user, 'customer')) === false && (await isActive(b, user, 'customer')) === false)
  chk('...בלי לגעת במשתמשות אחרות', (await isActive(c, other, 'customer')) === true)
}

{
  // מחיקת חשבון ההתחברות חייבת להרוג את כל ה-sessions שלו
  const user = await newAuthUser()
  const jti = await createRow(user, 'customer')
  await db.query('delete from auth.users where id = $1', [user])
  const left = await one('select id from app_sessions where id = $1', [jti])
  chk('מחיקת auth user מוחקת את ה-sessions שלו (CASCADE)', left === undefined)
}

section('ניקוי opportunistic')

{
  const user = await newAuthUser()
  const live = await createRow(user, 'customer')
  const revoked = await createRow(user, 'customer')
  const expired = await createRow(user, 'customer')

  await revoke(revoked)
  await ageOut(expired)

  // בדיוק המשפט שב-deleteExpiredSessions
  await db.query(`delete from app_sessions where expires_at < now()`)

  const survives = async jti => (await one('select id from app_sessions where id = $1', [jti])) !== undefined
  chk('הניקוי מוחק שורות שפג תוקפן', (await survives(expired)) === false)
  chk('...ואינו נוגע ב-session חי', (await survives(live)) === true)
  chk('...ואינו מוחק שורה שבוטלה ותוקפה בתוקף (הראיה נשמרת)', (await survives(revoked)) === true)
}

// ════════════════════════════════════════════════════════════════════════════
section('קריאת claims מ-token אמיתי (jose)')

const { SignJWT, jwtVerify } = await import('jose')
const { readSessionClaims } = await import('../lib/auth/sessionClaims.ts')

const SECRET = new TextEncoder().encode('test-secret-for-session-revocation-suite-0123456789')
const OTHER_SECRET = new TextEncoder().encode('a-completely-different-secret-value-9876543210xyz')

const sign = async (claims, { jti, secret = SECRET, sub = uuid() } = {}) => {
  let t = new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setSubject(sub)
    .setIssuedAt().setExpirationTime('30d')
  if (jti) t = t.setJti(jti)
  return t.sign(secret)
}
const claimsOf = async (token, secret = SECRET) => {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
  return readSessionClaims(payload)
}

{
  const sub = uuid()
  const jti = uuid()
  const cid = uuid()

  const good = await sign({ phone: '+972541234567', role: 'customer', cid }, { jti, sub })
  const parsed = await claimsOf(good)
  chk('token תקין — נקרא במלואו',
    parsed?.userId === sub && parsed?.phone === '+972541234567' &&
    parsed?.role === 'customer' && parsed?.jti === jti && parsed?.cid === cid)

  const adminToken = await sign({ phone: '+972541234567', role: 'admin' }, { jti: uuid() })
  chk('role: admin נשמר', (await claimsOf(adminToken))?.role === 'admin')

  const weird = await sign({ phone: '+972541234567', role: 'superuser' }, { jti: uuid() })
  chk('role לא מוכר יורד ל-customer ולא מסלים ל-admin',
    (await claimsOf(weird))?.role === 'customer')
}

{
  // ═══ ההחלטה המרכזית: אין תקופת חסד ═══
  const legacy = await sign({ phone: '+972541234567', role: 'customer' })  // בלי jti
  chk('🔒 token מלפני שלב 14 (בלי jti) — נדחה', (await claimsOf(legacy)) === null)

  const legacyAdmin = await sign({ phone: '+972541234567', role: 'admin' })
  chk('🔒 גם token של מנהלת בלי jti — נדחה', (await claimsOf(legacyAdmin)) === null)

  const emptyJti = await sign({ phone: '+972541234567', role: 'customer', jti: '' })
  chk('jti ריק אינו נחשב ל-jti', (await claimsOf(emptyJti)) === null)
}

{
  const noPhone = await sign({ role: 'customer' }, { jti: uuid() })
  chk('token בלי phone נדחה', (await claimsOf(noPhone)) === null)

  const numericPhone = await sign({ phone: 972541234567, role: 'customer' }, { jti: uuid() })
  chk('phone שאינו מחרוזת נדחה', (await claimsOf(numericPhone)) === null)

  const numericJti = await sign({ phone: '+972541234567', role: 'customer', jti: 12345 })
  chk('jti שאינו מחרוזת נדחה', (await claimsOf(numericJti)) === null)

  const badCid = await sign({ phone: '+972541234567', role: 'customer', cid: 42 }, { jti: uuid() })
  chk('cid שאינו מחרוזת מושמט ואינו מפיל את ה-session',
    (await claimsOf(badCid))?.cid === undefined)
}

{
  // ═══ החלפת SESSION_SECRET במעבר — השכבה השנייה ═══
  const old = await sign({ phone: '+972541234567', role: 'customer' }, { jti: uuid(), secret: OTHER_SECRET })
  let rejected = false
  try { await claimsOf(old, SECRET) } catch { rejected = true }
  chk('🔒 token שנחתם בסוד הישן נופל באימות החתימה', rejected)
}

// ════════════════════════════════════════════════════════════════════════════
section('חיווט הקוד')

const has = (src, re) => re.test(src)

/**
 * ⚠️ נדרש לבדיקות "אין X בקוד": הקבצים כאן מתעדים בהערות *למה* אין בהם
 * SESSION_SECRET מתחלף ולמה הם שונים מ-otpStore. בלי הסרת ההערות,
 * בדיקה כזו נופלת על התיעוד שמסביר את ההחלטה שהיא באה לאכוף.
 */
const stripComments = src =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

const SESSION_CODE = stripComments(SESSION_TS)
const STORE_CODE = stripComments(STORE_TS)
const CLAIMS_CODE = stripComments(CLAIMS_TS)

chk('createSession חותם jti', has(SESSION_TS, /\.setJti\(jti\)/))
chk('ה-jti נוצר אקראית ולא נגזר מהמשתמשת', has(SESSION_TS, /crypto\.randomUUID\(\)/))
chk('רשומת ה-session נכתבת לפני ה-cookie',
  SESSION_TS.indexOf('createSessionRecord(') < SESSION_TS.indexOf('cookieStore.set('))
chk('כשל בכתיבת הרשומה מונע יצירת cookie', has(SESSION_TS, /if\s*\(!stored\)\s*return false/))
chk('getSession בודקת את הרשומה בשרת', has(SESSION_TS, /isSessionActive\(/))
chk('getSession דוחה כשה-session אינו פעיל', has(SESSION_TS, /if\s*\(!active\)\s*return null/))
chk('getSession מפעילה את readSessionClaims (ולכן את כלל ה-jti)',
  has(SESSION_TS, /readSessionClaims\(/))

// ⚠️ הסדר ב-destroySession הוא כל העניין — מחיקה לפני ביטול הייתה מאבדת
// את ה-jti, כלומר את היכולת לבטל בכלל.
{
  const body = SESSION_TS.slice(SESSION_TS.indexOf('export async function destroySession'))
  chk('logout מבטל בשרת לפני מחיקת ה-cookie',
    body.indexOf('revokeSessionRecord(') < body.indexOf('cookieStore.delete('))
  chk('ה-cookie נמחק גם כשהביטול נכשל', has(body, /cookieStore\.delete\(COOKIE_NAME\)/))
  chk('כשל ביטול מוחזר כ-revocation_failed', has(body, /'revocation_failed'/))
  chk('destroySession אינה נשענת על getSession', !has(body, /getSession\(/))
}

chk('route ההתנתקות מחזיר שגיאה כשהביטול לא הובטח',
  has(LOGOUT_TS, /revocation_failed/) && has(LOGOUT_TS, /ok:\s*false/) && has(LOGOUT_TS, /status:\s*503/))
chk('LogoutButton אינו מנווט החוצה בכשל',
  has(LOGOUT_BUTTON_TSX, /if\s*\(!res\.ok\)/) && has(LOGOUT_BUTTON_TSX, /role="alert"/))
chk('otp/verify נכשל בגלוי כשלא נוצר session',
  has(VERIFY_TS, /sessionCreationFailed\(\)/) && has(VERIFY_TS, /if\s*\(!created\)/))

// ── מה שאסור להשתנות ────────────────────────────────────────────────────────
chk('ה-cookie נשאר httpOnly', has(SESSION_TS, /httpOnly:\s*true/))
chk('ה-cookie נשאר Secure בפרודקשן',
  has(SESSION_TS, /secure:\s*process\.env\.NODE_ENV === 'production'/))
chk('ה-cookie נשאר SameSite=lax', has(SESSION_TS, /sameSite:\s*'lax'/))
chk('שם ה-cookie והנתיב לא השתנו',
  has(SESSION_TS, /COOKIE_NAME = 'sm_session'/) && has(SESSION_TS, /path:\s*'\/'/))
chk('תוקף 30 יום נשמר', has(SESSION_TS, /SESSION_TTL_DAYS = 30/))
chk('cid עדיין נכתב ללקוחה בלבד',
  has(SESSION_TS, /payload\.role === 'customer' \? payload\.cid : undefined/))

// ── fail-closed ─────────────────────────────────────────────────────────────
chk('isSessionActive מחזירה false על שגיאת מסד (fail-closed)',
  has(STORE_TS, /if\s*\(error\)\s*\{[\s\S]{0,200}?return false/))
chk('הניקוי לעולם אינו זורק החוצה',
  has(STORE_TS, /export async function deleteExpiredSessions\(\): Promise<void>/) &&
  has(STORE_TS.slice(STORE_TS.indexOf('deleteExpiredSessions')), /try\s*\{[\s\S]*?catch/))
chk('הניקוי מוחק לפי expires_at בלבד',
  has(STORE_TS, /\.delete\(\)\.lt\('expires_at'/))
chk('אימות אינו כותב למסד (אין הארכת session שקטה)',
  !has(STORE_TS.slice(STORE_TS.indexOf('export async function isSessionActive'),
                      STORE_TS.indexOf('export type RevokeOutcome')), /\.update\(|\.insert\(/))

// ── גבולות שהוגדרו לשלב 14 ──────────────────────────────────────────────────
chk('🔒 בדיקת app_sessions אינה רצה ב-proxy (לשעבר middleware)',
  !has(MIDDLEWARE_TS, /app_sessions|isSessionActive|sessionStore/) ||
  /אין להוסיף כאן קריאה ל-app_sessions/.test(MIDDLEWARE_TS))
chk('proxy אינו מייבא את sessionStore', !has(MIDDLEWARE_TS, /from '@\/lib\/db\/sessionStore'/))
chk('אין React.cache על אימות ה-session',
  !has(SESSION_TS, /from 'react'/) && !has(SESSION_TS, /\bcache\(/))
// ⚠️ הסוד נקרא בלבד. החלפה בכל logout הייתה מנתקת את כל המשתמשות במערכת
// בכל התנתקות של מישהי — הוא מוחלף ידנית פעם אחת, במעבר לשלב 14.
chk('SESSION_SECRET נקרא בלבד ואינו נכתב בקוד',
  !has(SESSION_CODE, /process\.env\.SESSION_SECRET\s*=[^=]/) &&
  !has(STORE_CODE, /SESSION_SECRET/) && !has(CLAIMS_CODE, /SESSION_SECRET/))
chk('sessionStore נשאר server-only', has(STORE_TS, /^import 'server-only'/m))
chk('sessionClaims נשאר server-only', has(CLAIMS_TS, /^import 'server-only'/m))
chk('הקוד החדש אינו נוגע ב-SMS, ב-OTP, בתזכורות או ב-Cron',
  ![SESSION_CODE, STORE_CODE, CLAIMS_CODE].some(src =>
    /sms|019|cron|reminder|otp/i.test(src)))

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
