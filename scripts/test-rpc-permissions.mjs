/**
 * שומר ההרשאות: כל RPC רגיש חייב להיות סגור ל-anon ול-authenticated.
 *
 * הבדיקה הזו קוראת את קבצי המיגרציה עצמם ולא את בסיס הנתונים, ולכן היא
 * נכשלת *בזמן פיתוח* — לפני שמישהו מריץ מיגרציה חדשה בפרודקשן. זו בדיוק
 * הטעות שקרתה ב-0003–0005: הדפוס `revoke ... from public` נראה נכון,
 * חזר על עצמו בשלוש מיגרציות, ואף אחד לא הבחין שהוא לא מסיר את ההענקה
 * הישירה ש-Supabase נותנת ל-anon ול-authenticated.
 *
 * מה נדרש מכל פונקציה חדשה בסכמה public:
 *   revoke execute on function public.X(<חתימה מלאה>) from public, anon, authenticated;
 *   grant  execute on function public.X(<חתימה מלאה>) to service_role;
 *
 * פונקציות שמותר להן להישאר פתוחות מפורטות ב-INTENTIONALLY_OPEN למטה, כל
 * אחת עם הנימוק שלה. הוספה לרשימה היא החלטה מודעת שנשארת מתועדת.
 *
 * הרצה:  npm run test:rpc-permissions
 */

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

/**
 * פונקציות שנשארות נגישות בכוונה, עם הנימוק. כל תוספת כאן היא החלטת
 * אבטחה מודעת — לא דרך לעקוף בדיקה שנכשלה.
 */
/**
 * 13 החתימות הרגישות, במפורש. הרשימה הזו אינה נגזרת מהמיגרציות אלא
 * מוצבת מולן: אם פונקציה תיעלם, תשנה חתימה או תיווצר חדשה — ההשוואה
 * תיפול, ולא נסתמך על כך שהפרסר "מצא את מה שיש".
 */
/**
 * כל חתימה רגישה משויכת למיגרציה שמחזיקה את בלוק ה-assertion שמוכיח את
 * ההרשאות שלה בפועל. הפיצול אינו קוסמטי: 0007 היא קובץ *קיים שכבר רץ
 * בפרודקשן* ואין לשנות אותו, ולכן פונקציות חדשות מוכיחות את עצמן בבלוק
 * משלהן ב-0008.
 */
const ASSERTION_MIGRATIONS = {
  '0007_reapply_rpc_permissions.sql': [
    'expire_stale_pending_appointments()',
    'create_pending_appointment(uuid,text,text[],integer,timestamptz,integer,text,text)',
    'cancel_pending_appointment(uuid,uuid)',
    'approve_pending_appointment(uuid,uuid)',
    'reject_pending_appointment(uuid,uuid)',
    'claim_calendar_sync(uuid)',
    'complete_calendar_sync(uuid,text)',
    'fail_calendar_sync(uuid,text)',
    'setting_numeric(text,numeric)',
    'setting_boolean(text,boolean)',
    'reschedule_appointment_by_customer(uuid,uuid,timestamptz,timestamptz)',
    'cancel_confirmed_appointment_by_customer(uuid,uuid)',
    'complete_calendar_delete(uuid)',
  ],
  // שלב 8 — הסנכרון הנכנס מ-Google Calendar
  '0008_google_calendar_inbound_sync.sql': [
    'claim_calendar_sync_run(uuid,integer,text)',
    'record_calendar_changes(uuid,jsonb,text,text)',
    'reset_calendar_sync_cursor(uuid,boolean,text)',
    'finish_calendar_sync_run(uuid,calendar_sync_run_status,text,jsonb)',
    'claim_calendar_change(uuid,integer,integer)',
    'finish_calendar_change(bigint,uuid,calendar_queue_status,calendar_change_result,text)',
    'retry_calendar_change(bigint)',
    'record_calendar_sync_issue(bigint,calendar_sync_issue_kind,calendar_sync_issue_status,text,uuid,timestamptz,timestamptz,text)',
    'apply_google_reschedule(uuid,text,timestamptz,boolean,bigint)',
    'mark_calendar_correction_required(uuid,text)',
    'apply_google_cancellation(uuid,text,bigint)',
  ],
  // שלב 9 — CRM ופרופיל לקוחה
  '0009_customer_crm.sql': [
    'assert_crm_actor_is_admin(uuid)',
    'list_crm_customers(text,text,text,text,timestamptz,timestamptz,integer,integer)',
    'get_crm_customer(uuid)',
    'set_customer_crm_status(uuid,text,uuid)',
    'set_customer_source(uuid,text,uuid)',
    'create_customer_note(uuid,text,uuid,uuid)',
    'update_customer_note(uuid,uuid,text,uuid)',
    'archive_customer_note(uuid,uuid,uuid)',
  ],
  /**
   * 0010 מוסיפה שלוש פונקציות ומחליפה שתיים קיימות. שתי המוחלפות
   * (list_crm_customers, get_crm_customer) נשארות ממופות ל-0009, שם עדיין
   * יושב בלוק ה-assertion שמוכיח את ההרשאות שלהן — CREATE OR REPLACE
   * משמר ACL, ו-0010 מוסיפה את ה-REVOKE/GRANT שוב מפורשות.
   */
  '0010_manual_customers_and_admin_booking.sql': [
    'link_or_create_customer_for_auth(uuid,text,text)',
    'create_manual_customer(text,text,text,text,uuid,uuid,text)',
    'create_manual_appointment(uuid,text,text[],integer,timestamptz,integer,text,uuid,uuid,text)',
  ],
  /**
   * שלב 11 — מערכת התזכורות.
   *
   * ⚠️ גם שתי פונקציות החישוב (reminder_scheduled_for/expires_at) סגורות,
   * למרות שהן טהורות ואינן חושפות נתונים. הן נקראות אך ורק ע"י ה-RPCs
   * ובטריגר, ואין סיבה שיהיו זמינות כ-RPC לאף תפקיד — כל פונקציה פתוחה
   * בסכמה public היא משטח תקיפה, גם כשהיא נראית תמימה.
   *
   * פונקציות הטריגר (tg_sync_appointment_reminders,
   * reject_reminder_attempt_mutation) אינן נגישות כ-RPC ולכן אינן כאן.
   */
  '0011_appointment_reminders.sql': [
    'reminder_scheduled_for(reminder_kind,timestamptz,timestamptz)',
    'reminder_expires_at(reminder_kind,timestamptz,timestamptz)',
    'sync_appointment_reminders(uuid)',
    'sweep_expired_reminders()',
    'create_manual_reminder(uuid,uuid,uuid,text,text)',
    'claim_due_reminder(uuid,integer,integer,text)',
    'reminder_precheck(uuid,uuid)',
    'finish_reminder_attempt(uuid,uuid,text,text,text,text,integer,boolean)',
    'abort_reminder_attempt(uuid,uuid,text)',
    'retry_reminder(uuid,uuid,boolean)',
  ],
  /**
   * שלב 12B — הנפקת OTP ואימות OTP אטומיים.
   *
   * ⚠️ otp_hash_equals נראית תמימה — היא משווה שתי מחרוזות ואינה נוגעת
   * בשום טבלה. היא סגורה בכל זאת: היא ההשוואה בזמן קבוע של גיבוב הקוד,
   * ו-RPC פתוח שמקבל גיבוב ומחזיר בוליאני הוא אורקל השוואה זמין לכל מי
   * שמחזיק את מפתח ה-anon.
   */
  '0013_atomic_otp_operations.sql': [
    'otp_hash_equals(text,text)',
    'issue_otp_atomic(text,text,text,inet,integer,integer,integer,integer,integer)',
    'verify_otp_atomic(text,text,text,integer)',
    'discard_otp_issue_atomic(bigint,text,text)',
  ],
  /**
   * שלב 15B — המסלול הציבורי.
   *
   * ⚠️ שתי אלה הן ה-RPCs הרגישים ביותר שנוספו מאז 0001, כי הן משרתות
   * endpoint שאינו מאומת:
   *
   *   • link_or_create_customer_by_phone — חשיפה ל-anon הופכת אותה לאורקל
   *     שמאפשר לברר אילו מספרי טלפון קיימים במערכת, ולזהם את טבלת
   *     הלקוחות ברשומות מזויפות.
   *
   *   • create_public_pending_appointment — מקבלת customer_id ו-expires_at
   *     כפרמטרים. חשיפה ל-anon הייתה מאפשרת ליצור בקשות עבור **כל** לקוחה,
   *     לעקוף את כל הוולידציה ב-route, ולדלג על חלון הזמינות כולו.
   *
   * create_manual_appointment נשארת ממופה ל-0010: היא מוחלפת ב-0018
   * ב-CREATE OR REPLACE (שמשמר ACL), ו-0018 מוסיפה את ה-REVOKE/GRANT
   * שוב מפורשות — אותו דפוס בדיוק כמו list_crm_customers ב-0009/0010.
   */
  '0018_public_booking_rpcs.sql': [
    'link_or_create_customer_by_phone(text,text)',
    'create_public_pending_appointment(uuid,text,text[],integer,timestamptz,integer,text,text,timestamptz,inet,integer)',
  ],
}

const PROTECTED_SIGNATURES = Object.values(ASSERTION_MIGRATIONS).flat()
const PROTECTED_COUNT = PROTECTED_SIGNATURES.length

const INTENTIONALLY_OPEN = {
  is_admin:
    'נקראת מתוך מדיניות RLS, שמוערכת בהרשאות התפקיד השואל. שלילת EXECUTE ' +
    'מ-authenticated הייתה שוברת כל קריאה של לקוחה מחוברת. SECURITY DEFINER, ' +
    'מחזירה בוליאני על הקורא בלבד.',
}

// ── קריאת המיגרציות ─────────────────────────────────────────────────────────

const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
const sources = files.map(f => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }))

/** מסיר הערות שורה כדי שדוגמאות בתוך תיעוד לא ייחשבו לקוד אמיתי */
const stripComments = sql =>
  sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n')

/**
 * ⚠️ שתי צורות שונות לאותה חתימה:
 *   CREATE FUNCTION מפרט שם *ושם טיפוס*  → 'p_variants text[]'
 *   REVOKE/GRANT מפרטים טיפוסים בלבד     → 'text[]'
 * שתיהן חייבות להצטמצם לאותו מפתח, אחרת ההשוואה שקטה ולא נכשלת.
 */
function declaredParamType(param) {
  const cleaned = param.trim().replace(/\s+default\s+.*$/i, '').trim()
  if (!cleaned) return null
  const parts = cleaned.split(/\s+/)
  return parts.slice(1).join(' ').toLowerCase() || null
}

function bareParamType(param) {
  const cleaned = param.trim().toLowerCase()
  return cleaned || null
}

function parseArgs(argList, mode = 'declared') {
  if (!argList.trim()) return []
  const parse = mode === 'bare' ? bareParamType : declaredParamType
  return argList.split(',').map(parse).filter(Boolean)
}

/** מפתח השוואה יציב: 'name(type,type)' */
const sigKey = (name, types) => `${name}(${types.join(',')})`

// ── כל הפונקציות שנוצרות ─────────────────────────────────────────────────────

const CREATE_RE = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([^)]*)\)([\s\S]{0,120})/gi

const defined = new Map()   // sigKey → { name, types, files:Set, isTrigger }
for (const { file, sql } of sources) {
  const clean = stripComments(sql)
  for (const m of clean.matchAll(CREATE_RE)) {
    const [, name, argList, tail] = m
    const types = parseArgs(argList)
    const key = sigKey(name, types)
    const isTrigger = /returns\s+trigger/i.test(tail)
    const entry = defined.get(key) ?? { name, types, files: new Set(), isTrigger }
    entry.files.add(file)
    entry.isTrigger = entry.isTrigger || isTrigger
    defined.set(key, entry)
  }
}

section('פונקציות שנמצאו במיגרציות')
chk(`נמצאו ${defined.size} חתימות פונקציה ב-${files.length} מיגרציות`, defined.size > 0)

// ── REVOKE / GRANT ──────────────────────────────────────────────────────────

const REVOKE_RE =
  /revoke\s+execute\s+on\s+function\s+public\.(\w+)\s*\(([^)]*)\)\s*from\s+([^;]+);/gi
const GRANT_RE =
  /grant\s+execute\s+on\s+function\s+public\.(\w+)\s*\(([^)]*)\)\s*to\s+([^;]+);/gi

const revokedFrom = new Map()   // sigKey → Set(roles)
const grantedTo = new Map()     // sigKey → Set(roles)

for (const { sql } of sources) {
  const clean = stripComments(sql)
  for (const m of clean.matchAll(REVOKE_RE)) {
    const key = sigKey(m[1], parseArgs(m[2], 'bare'))
    const roles = m[3].split(',').map(r => r.trim().toLowerCase())
    const set = revokedFrom.get(key) ?? new Set()
    roles.forEach(r => set.add(r))
    revokedFrom.set(key, set)
  }
  for (const m of clean.matchAll(GRANT_RE)) {
    const key = sigKey(m[1], parseArgs(m[2], 'bare'))
    const roles = m[3].split(',').map(r => r.trim().toLowerCase())
    const set = grantedTo.get(key) ?? new Set()
    roles.forEach(r => set.add(r))
    grantedTo.set(key, set)
  }
}

// ── האכיפה ──────────────────────────────────────────────────────────────────

section('כל RPC רגיש סגור ל-anon ול-authenticated')

const sensitive = [...defined.entries()].filter(([, e]) =>
  !e.isTrigger && !(e.name in INTENTIONALLY_OPEN))

chk(`${sensitive.length} פונקציות מסווגות כרגישות`, sensitive.length > 0)

{
  const found = new Set(sensitive.map(([key]) => key))
  const expected = new Set(PROTECTED_SIGNATURES)

  // פונקציה רגישה חדשה שלא נוספה לרשימת ההגנה — הבדיקה חייבת ליפול
  const unlisted = [...found].filter(k => !expected.has(k))
  chk('אין פונקציה רגישה שאינה ברשימת ההגנה', unlisted.length === 0,
    unlisted.length ? `חדשות ולא מוגנות: ${unlisted.join(', ')}` : '')

  // פונקציה שנעלמה או ששינתה חתימה
  const vanished = [...expected].filter(k => !found.has(k))
  chk(`כל ${PROTECTED_COUNT} הפונקציות המוגנות עדיין קיימות באותן חתימות`, vanished.length === 0,
    vanished.length ? `חסרות: ${vanished.join(', ')}` : `${expected.size} חתימות`)

  chk(`רשימת ההגנה מונה בדיוק ${PROTECTED_COUNT} פונקציות`,
    PROTECTED_SIGNATURES.length === PROTECTED_COUNT && expected.size === PROTECTED_COUNT,
    `count=${PROTECTED_SIGNATURES.length}`)
}

for (const [key, entry] of sensitive) {
  const revoked = revokedFrom.get(key) ?? new Set()
  const missing = ['public', 'anon', 'authenticated'].filter(r => !revoked.has(r))
  chk(`${key} — REVOKE מ-PUBLIC, anon ו-authenticated`,
    missing.length === 0,
    missing.length ? `חסר: ${missing.join(', ')} (נוצרה ב-${[...entry.files].join(', ')})` : '')
}

section('service_role עדיין מורשה')

for (const [key] of sensitive) {
  const granted = grantedTo.get(key) ?? new Set()
  chk(`${key} — GRANT ל-service_role`, granted.has('service_role'))
}

section('אין REVOKE גורף שעלול לסגור פונקציה ציבורית')

{
  let broad = null
  for (const { file, sql } of sources) {
    const clean = stripComments(sql)
    if (/revoke\s+execute\s+on\s+all\s+functions\s+in\s+schema/i.test(clean)) broad = file
  }
  chk('אין "revoke execute on all functions in schema"', broad === null, broad ?? '')
}

section('קיים בלוק assertion אמיתי בכל מיגרציה')

for (const [migrationFile, signatures] of Object.entries(ASSERTION_MIGRATIONS)) {
  const assertionFile = sources.find(f => f.file === migrationFile)
  chk(`${migrationFile} קיימת`, Boolean(assertionFile))
  if (!assertionFile) continue

  const clean = stripComments(assertionFile.sql)
  const label = migrationFile.slice(0, 4)

  chk(`${label}: קיים בלוק DO`, /do\s+\$\$/i.test(clean))
  chk(`${label}: הבלוק משתמש ב-has_function_privilege`,
    /has_function_privilege/i.test(clean))
  chk(`${label}: הבלוק זורק חריגה בהפרה`, /raise\s+exception/i.test(clean))

  // שלושת התפקידים נבדקים
  for (const role of ['anon', 'authenticated', 'service_role']) {
    chk(`${label}: הבלוק בודק את התפקיד ${role}`,
      new RegExp(`has_function_privilege\\(\\s*'${role}'`, 'i').test(clean))
  }

  // service_role נבדק בכיוון ההפוך — שההרשאה *נשמרה*
  chk(`${label}: service_role נבדק כ-'not has_function_privilege' (הרשאה שנשמרת)`,
    /not\s+has_function_privilege\(\s*'service_role'/i.test(clean))

  // ⚠️ החיפוש מוגבל לגוף בלוקי ה-DO בלבד. חיפוש בכל הקובץ היה "מוצא" כל
  // חתימה גם בתוך פקודות ה-REVOKE עצמן, ובדיקה שמוצאת תמיד היא בדיקה
  // שלא בודקת כלום.
  const doBlocks = [...clean.matchAll(/do\s+\$\$([\s\S]*?)\$\$\s*;/gi)]
    .map(m => m[1]).join('\n')
  chk(`${label}: גוף בלוק ה-DO אותר לבדיקה`, doBlocks.length > 0)

  const missingFromBlock = signatures.filter(sig => {
    const name = sig.slice(0, sig.indexOf('('))
    const types = sig.slice(sig.indexOf('(') + 1, -1)
    const spaced = types ? types.split(',').join(', ') : ''
    return !doBlocks.includes(`public.${name}(${spaced})`)
  })
  chk(`${label}: כל ${signatures.length} החתימות מופיעות בבלוק ה-assertion`,
    missingFromBlock.length === 0,
    missingFromBlock.length ? `חסרות: ${missingFromBlock.join(', ')}` : '')
}

section('פונקציות שנשארו פתוחות בכוונה')

for (const [name, reason] of Object.entries(INTENTIONALLY_OPEN)) {
  const found = [...defined.values()].some(e => e.name === name)
  chk(`${name} מתועדת ועדיין קיימת`, found, reason.slice(0, 60) + '…')
}

{
  const triggers = [...defined.values()].filter(e => e.isTrigger).map(e => e.name)
  chk('פונקציות טריגר אינן נדרשות ל-REVOKE (לא נגישות כ-RPC)',
    triggers.length > 0, triggers.join(', '))
}

// ── בדיקה שלילית: השומר עצמו חייב ליפול ──────────────────────────────────────
//
// כל הבדיקות עד כאן מדווחות ✓ כשהמצב תקין. אבל בדיקה שמדווחת ✓ תמיד — גם
// כשהיא שבורה — אינה בדיקה. הסעיף הזה מזריק מיגרציה סינתטית *בזיכרון* עם
// RPC לא מוגן, ומריץ עליה את אותה לוגיקת זיהוי בדיוק. אם השומר לא נופל
// כאן, סימן שהוא לא היה נופל גם על RPC אמיתי שיישכח.
//
// המיגרציות עצמן אינן נקראות ואינן משתנות — הכול מחרוזות בזיכרון.

section('בדיקה שלילית: השומר נופל על RPC לא מוגן')

{
  const FAKE_UNPROTECTED = `
    create or replace function public.forgotten_crm_rpc(p_id uuid, p_body text)
    returns void language plpgsql as $$ begin null; end; $$;
  `
  const clean = stripComments(FAKE_UNPROTECTED)

  // 1. הפרסר מזהה את הפונקציה החדשה
  const parsed = [...clean.matchAll(CREATE_RE)].map(m => sigKey(m[1], parseArgs(m[2])))
  chk('הפרסר מזהה RPC חדש שנוסף למיגרציה',
    parsed.includes('forgotten_crm_rpc(uuid,text)'), parsed.join(', '))

  // 2. הוא אינו ברשימת ההגנה → "אין פונקציה רגישה שאינה ברשימה" חייב ליפול
  const expected = new Set(PROTECTED_SIGNATURES)
  const wouldBeUnlisted = parsed.filter(k => !expected.has(k))
  chk('⚠️ RPC לא מוגן מזוהה כחסר מרשימת ההגנה', wouldBeUnlisted.length === 1,
    wouldBeUnlisted.join(', '))

  // 3. אין לו REVOKE כלל → בדיקת ה-REVOKE חייבת ליפול
  const revokes = [...clean.matchAll(REVOKE_RE)]
  const missingRoles = ['public', 'anon', 'authenticated']
    .filter(r => !revokes.some(m => m[3].toLowerCase().includes(r)))
  chk('⚠️ היעדר REVOKE מזוהה', missingRoles.length === 3, missingRoles.join(', '))

  // 4. REVOKE חלקי — הטעות שקרתה בפועל ב-0003–0005 (רק from public)
  const PARTIAL = `
    create or replace function public.partial_revoke_rpc(p_id uuid)
    returns void language plpgsql as $$ begin null; end; $$;
    revoke execute on function public.partial_revoke_rpc(uuid) from public;
    grant  execute on function public.partial_revoke_rpc(uuid) to service_role;
  `
  const pClean = stripComments(PARTIAL)
  const pRevoked = new Set()
  for (const m of pClean.matchAll(REVOKE_RE)) {
    m[3].split(',').forEach(r => pRevoked.add(r.trim().toLowerCase()))
  }
  const stillOpen = ['anon', 'authenticated'].filter(r => !pRevoked.has(r))
  chk('⚠️ REVOKE רק מ-public (הבאג של 0003–0005) מזוהה כחסר',
    stillOpen.length === 2, `נותרו פתוחים: ${stillOpen.join(', ')}`)

  // 5. חתימה שהשתנתה מזוהה כ"נעלמה"
  const RENAMED = `
    create or replace function public.get_crm_customer(p_customer_id uuid, p_extra text)
    returns jsonb language sql stable as $$ select null::jsonb $$;
  `
  const rParsed = [...stripComments(RENAMED).matchAll(CREATE_RE)]
    .map(m => sigKey(m[1], parseArgs(m[2])))
  chk('⚠️ שינוי חתימה של RPC מוגן מזוהה כחתימה אחרת',
    !rParsed.includes('get_crm_customer(uuid)') &&
    rParsed.includes('get_crm_customer(uuid,text)'), rParsed.join(', '))
}

// ── סיכום ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
if (failed > 0) {
  console.log('⛔ RPC רגיש ללא REVOKE ל-anon/authenticated.')
  console.log('   הוסף למיגרציה *חדשה*:')
  console.log('   revoke execute on function public.X(<חתימה>) from public, anon, authenticated;')
  console.log('   grant  execute on function public.X(<חתימה>) to service_role;')
}
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
