/**
 * שלב 9 — CRM: בדיקות מול Supabase האמיתי, אחרי הרצת 0009.
 *
 * scripts/test-customer-crm.mjs אוכף את *כוונת* המיגרציה (הקובץ); הקובץ
 * הזה מאמת שהמצב בפועל בבסיס הנתונים תואם לה — שהטבלאות קיימות, שה-RLS
 * מופעל, שההרשאות נשללו, ושלקוחה מחוברת אינה יכולה לעקוף את ה-API.
 *
 * שלושה תפקידים נבדקים:
 *   anon                  — מפתח שממילא נשלח לדפדפן
 *   authenticated (זרה)   — לקוחה מחוברת שהנתונים אינם שלה
 *   authenticated (בעלים) — הלקוחה שהנתונים *כן* שלה, מנסה לעקוף את ה-API
 *
 * ⚠️ יוצר משתמשי בדיקה ולקוחות אמיתיים ב-Supabase ומוחק את כולם בסיום,
 * גם אם בדיקה נכשלת. אינו נוגע ב-Google Calendar, ב-admins ובלקוחות אמיתיות.
 *
 * הרצה:  npm run test:live:customer-crm
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const ENV_PATH = new URL('../.env.local', import.meta.url)
if (!existsSync(ENV_PATH)) {
  console.log('✗ לא נמצא קובץ .env.local')
  process.exit(1)
}
const env = {}
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const opts = { auth: { autoRefreshToken: false, persistSession: false } }

const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, opts)
const anon = createClient(URL_, ANON, opts)

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 50 - t.length))}`)

const TEST_NAME = 'TEST — מחיקה אוטומטית'
const ZERO = '00000000-0000-0000-0000-000000000000'

const createdUsers = []

/** ההרשאה נשללה = PostgREST לא חושף את הפונקציה/הטבלה לתפקיד הזה */
function isBlocked(error) {
  if (!error) return false
  return error.message.includes('Could not find the function') ||
    error.message.includes('permission denied') ||
    error.message.includes('does not exist') ||
    error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42501'
}

/** קריאה שהוחזרה ריקה בגלל RLS — לא שגיאה, אבל גם לא נתונים */
const noRows = res => !res.error && (res.data ?? []).length === 0

const CRM_TABLES = ['customer_sources', 'customer_crm_profiles', 'customer_notes', 'customer_crm_activity']
const CRM_RPCS = [
  ['list_crm_customers',       {}],
  ['get_crm_customer',         { p_customer_id: ZERO }],
  ['set_customer_crm_status',  { p_customer_id: ZERO, p_status: 'inactive', p_admin_id: ZERO }],
  ['set_customer_source',      { p_customer_id: ZERO, p_source_key: 'website', p_admin_id: ZERO }],
  ['create_customer_note',     { p_customer_id: ZERO, p_body: 'x', p_admin_id: ZERO, p_client_request_id: ZERO }],
  ['update_customer_note',     { p_note_id: ZERO, p_customer_id: ZERO, p_body: 'x', p_admin_id: ZERO }],
  ['archive_customer_note',    { p_note_id: ZERO, p_customer_id: ZERO, p_admin_id: ZERO }],
  ['assert_crm_actor_is_admin', { p_admin_id: ZERO }],
]

let exitCode = 1
try {
  // ── האם 0009 הורצה בכלל ───────────────────────────────────────────────────
  const canary = await svc.from('customer_crm_profiles').select('customer_id').limit(1)
  if (canary.error) {
    console.log('⛔ 0009_customer_crm.sql עדיין לא הורצה ב-Supabase.')
    console.log(`   (${canary.error.message})`)
    console.log('   הרץ אותה ב-SQL Editor ואז הרץ את הבדיקה הזו שוב.')
    process.exit(1)
  }
  chk('0009 הורצה — טבלאות ה-CRM קיימות')

  // ── הכנת נתוני בדיקה ──────────────────────────────────────────────────────
  async function makeCustomer(label) {
    const email = `test-${randomUUID()}@sm-brows-test.invalid`
    const password = randomUUID()
    const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw new Error(`יצירת משתמש בדיקה נכשלה: ${error.message}`)
    const uid = data.user.id
    createdUsers.push(uid)

    const phone = `+9725${Math.floor(10000000 + Math.random() * 89999999)}`
    const { error: cErr } = await svc.from('customers')
      .insert({ id: uid, phone_e164: phone, full_name: `${TEST_NAME} ${label}` })
    if (cErr) throw new Error(`יצירת לקוחה נכשלה: ${cErr.message}`)

    const client = createClient(URL_, ANON, opts)
    const { error: sErr } = await client.auth.signInWithPassword({ email, password })
    if (sErr) throw new Error(`התחברות נכשלה: ${sErr.message}`)
    return { uid, client }
  }

  const owner = await makeCustomer('בעלת הפרופיל')
  const stranger = await makeCustomer('לקוחה זרה')
  chk('נוצרו שתי לקוחות בדיקה')

  // ── הטריגר של 0009 עובד בפרודקשן ──────────────────────────────────────────
  const { data: autoProfile } = await svc.from('customer_crm_profiles')
    .select('crm_status, source_key').eq('customer_id', owner.uid).maybeSingle()
  chk('לקוחה חדשה קיבלה פרופיל CRM אוטומטית', autoProfile !== null)
  chk('ברירת המחדל היא active + unknown',
    autoProfile?.crm_status === 'active' && autoProfile?.source_key === 'unknown',
    `${autoProfile?.crm_status}/${autoProfile?.source_key}`)

  // מנהל אמיתי לצורך בדיקת ה-RPCs
  const { data: admins } = await svc.from('admins').select('user_id')
  const adminId = admins?.[0]?.user_id
  chk('נמצא מנהל אמיתי לבדיקה', Boolean(adminId))

  // ── service_role יכול לבצע את הפעולות ─────────────────────────────────────
  section('service_role מבצע את הפעולות')

  const noteRid = randomUUID()
  const created = await svc.rpc('create_customer_note', {
    p_customer_id: owner.uid, p_body: 'הערת בדיקה', p_admin_id: adminId,
    p_client_request_id: noteRid,
  })
  chk('service_role יוצר הערה', !created.error && created.data?.created === true,
    created.error?.message ?? '')
  const noteId = created.data?.note_id

  const retry = await svc.rpc('create_customer_note', {
    p_customer_id: owner.uid, p_body: 'הערת בדיקה', p_admin_id: adminId,
    p_client_request_id: noteRid,
  })
  chk('retry עם אותו מפתח מחזיר את אותה הערה',
    !retry.error && retry.data?.created === false && retry.data?.note_id === noteId)

  const reused = await svc.rpc('create_customer_note', {
    p_customer_id: owner.uid, p_body: 'תוכן אחר', p_admin_id: adminId,
    p_client_request_id: noteRid,
  })
  chk('אותו מפתח עם תוכן שונה נדחה',
    reused.error?.message.includes('IDEMPOTENCY_KEY_REUSED'), reused.error?.message ?? '')

  const st1 = await svc.rpc('set_customer_crm_status', {
    p_customer_id: owner.uid, p_status: 'inactive', p_admin_id: adminId })
  chk('service_role משנה סטטוס', !st1.error && st1.data?.changed === true)

  const st2 = await svc.rpc('set_customer_crm_status', {
    p_customer_id: owner.uid, p_status: 'inactive', p_admin_id: adminId })
  chk('שינוי לאותו סטטוס הוא no-op', !st2.error && st2.data?.changed === false)

  const notAdmin = await svc.rpc('set_customer_crm_status', {
    p_customer_id: owner.uid, p_status: 'active', p_admin_id: stranger.uid })
  chk('⚠️ actor שאינו ב-admins נדחה גם ב-service_role',
    notAdmin.error?.message.includes('NOT_ADMIN'), notAdmin.error?.message ?? '')

  const listed = await svc.rpc('list_crm_customers', { p_search: TEST_NAME })
  chk('service_role קורא את הרשימה', !listed.error && listed.data?.total_count >= 2,
    `total=${listed.data?.total_count}`)

  // ── המנהלות מוחרגות מה-CRM ────────────────────────────────────────────────
  section('שובל ורפאל אינן לקוחות CRM')

  const all = await svc.rpc('list_crm_customers', { p_limit: 100 })
  const adminIds = new Set((admins ?? []).map(a => a.user_id))
  const leaked = (all.data?.items ?? []).filter(i => adminIds.has(i.id))
  chk('⚠️ אף חשבון מנהל אינו מופיע ברשימת ה-CRM', leaked.length === 0, `n=${leaked.length}`)

  const adminProfile = await svc.rpc('get_crm_customer', { p_customer_id: adminId })
  chk('⚠️ פרופיל ישיר של חשבון מנהל מחזיר null (→404)',
    !adminProfile.error && adminProfile.data === null)

  const { data: adminCust } = await svc.from('customers').select('full_name').eq('id', adminId).maybeSingle()
  chk('שורת המנהל עדיין קיימת ולא נמחקה', adminCust !== null)

  // ── anon חסום ─────────────────────────────────────────────────────────────
  section('anon חסום מכל נתוני ה-CRM')

  for (const t of CRM_TABLES) {
    const res = await anon.from(t).select('*').limit(1)
    chk(`anon אינו קורא מ-${t}`, isBlocked(res.error) || noRows(res),
      res.error ? '' : `rows=${res.data?.length}`)
  }

  for (const [fn, args] of CRM_RPCS) {
    const res = await anon.rpc(fn, args)
    chk(`anon אינו יכול להריץ ${fn}`, isBlocked(res.error), res.error?.message ?? 'הצליח!')
  }

  const anonView = await anon.from('customer_crm_metrics').select('*').limit(1)
  chk('anon אינו קורא מ-view המדדים', isBlocked(anonView.error) || noRows(anonView))

  // ── לקוחה מחוברת זרה חסומה ────────────────────────────────────────────────
  section('לקוחה מחוברת (זרה) חסומה')

  for (const t of CRM_TABLES) {
    const res = await stranger.client.from(t).select('*').limit(1)
    chk(`לקוחה זרה אינה קוראת מ-${t}`, isBlocked(res.error) || noRows(res),
      res.error ? '' : `rows=${res.data?.length}`)
  }

  for (const [fn, args] of CRM_RPCS) {
    const res = await stranger.client.rpc(fn, args)
    chk(`לקוחה זרה אינה יכולה להריץ ${fn}`, isBlocked(res.error), res.error?.message ?? 'הצליח!')
  }

  // ── ⚠️ הבעלים עצמה חסומה — הבדיקה החשובה ביותר ────────────────────────────
  section('⚠️ הלקוחה עצמה אינה יכולה לעקוף את ה-API')

  const ownNotes = await owner.client.from('customer_notes')
    .select('*').eq('customer_id', owner.uid)
  chk('⚠️ לקוחה אינה קוראת את ההערות שנכתבו עליה',
    isBlocked(ownNotes.error) || noRows(ownNotes),
    ownNotes.error ? '' : `rows=${ownNotes.data?.length}`)

  const ownProfile = await owner.client.from('customer_crm_profiles')
    .select('*').eq('customer_id', owner.uid)
  chk('⚠️ לקוחה אינה קוראת את פרופיל ה-CRM שלה',
    isBlocked(ownProfile.error) || noRows(ownProfile),
    ownProfile.error ? '' : `rows=${ownProfile.data?.length}`)

  const ownActivity = await owner.client.from('customer_crm_activity')
    .select('*').eq('customer_id', owner.uid)
  chk('⚠️ לקוחה אינה קוראת את ה-activity שלה',
    isBlocked(ownActivity.error) || noRows(ownActivity))

  const ownSources = await owner.client.from('customer_sources').select('*')
  chk('⚠️ לקוחה אינה קוראת אפילו את טבלת המקורות',
    isBlocked(ownSources.error) || noRows(ownSources))

  const ownRpc = await owner.client.rpc('get_crm_customer', { p_customer_id: owner.uid })
  chk('⚠️ לקוחה אינה יכולה להריץ get_crm_customer על עצמה', isBlocked(ownRpc.error),
    ownRpc.error?.message ?? 'הצליח!')

  const ownList = await owner.client.rpc('list_crm_customers', {})
  chk('⚠️ לקוחה אינה יכולה להריץ list_crm_customers', isBlocked(ownList.error))

  const selfPromote = await owner.client.rpc('set_customer_crm_status', {
    p_customer_id: owner.uid, p_status: 'active', p_admin_id: owner.uid })
  chk('⚠️ לקוחה אינה יכולה לשנות את הסטטוס של עצמה', isBlocked(selfPromote.error))

  const selfNote = await owner.client.rpc('create_customer_note', {
    p_customer_id: owner.uid, p_body: 'פריצה', p_admin_id: owner.uid,
    p_client_request_id: randomUUID() })
  chk('⚠️ לקוחה אינה יכולה לכתוב הערה על עצמה', isBlocked(selfNote.error))

  const ownView = await owner.client.from('customer_crm_metrics')
    .select('*').eq('customer_id', owner.uid)
  chk('⚠️ לקוחה אינה קוראת את המדדים שלה מה-view',
    isBlocked(ownView.error) || noRows(ownView))

  // ── בידוד בין לקוחות ──────────────────────────────────────────────────────
  section('בידוד בין לקוחות')

  const crossUpdate = await svc.rpc('update_customer_note', {
    p_note_id: noteId, p_customer_id: stranger.uid, p_body: 'פריצה', p_admin_id: adminId })
  chk('⚠️ עדכון הערה דרך customer_id של לקוחה אחרת נחסם',
    crossUpdate.error?.message.includes('NOTE_NOT_FOUND'), crossUpdate.error?.message ?? '')

  const { data: intact } = await svc.from('customer_notes').select('body').eq('id', noteId).maybeSingle()
  chk('ההערה לא שונתה בניסיון הפריצה', intact?.body === 'הערת בדיקה')

  // ── append-only ───────────────────────────────────────────────────────────
  section('append-only של activity')

  const updAct = await svc.from('customer_crm_activity')
    .update({ action: 'source_changed' }).eq('customer_id', owner.uid)
  chk('⚠️ UPDATE על activity נחסם גם ל-service_role',
    updAct.error !== null && updAct.error.message.includes('append-only'),
    updAct.error?.message ?? 'הצליח!')

  exitCode = 0
} catch (e) {
  chk('הבדיקה רצה ללא חריגה', false, e.message)
} finally {
  section('ניקוי נתוני בדיקה')

  for (const uid of createdUsers) {
    // מחיקת ה-customer מפילה ב-cascade את הפרופיל, ההערות וה-activity
    await svc.from('customer_notes').delete().eq('customer_id', uid)
    await svc.from('customers').delete().eq('id', uid)
    const { error } = await svc.auth.admin.deleteUser(uid)
    chk('משתמש בדיקה נמחק מ-customers ומ-auth.users', !error, error?.message ?? '')
  }

  const { data: leftCust } = await svc.from('customers')
    .select('id').like('full_name', `${TEST_NAME}%`)
  chk('לא נשארה אף לקוחת בדיקה', (leftCust ?? []).length === 0, `count=${leftCust?.length}`)

  const leftIds = new Set(createdUsers)
  const { data: leftProfiles } = await svc.from('customer_crm_profiles').select('customer_id')
  const orphanProfiles = (leftProfiles ?? []).filter(p => leftIds.has(p.customer_id))
  chk('לא נשאר אף פרופיל CRM של בדיקה', orphanProfiles.length === 0, `count=${orphanProfiles.length}`)

  const { data: leftNotes } = await svc.from('customer_notes').select('customer_id')
  const orphanNotes = (leftNotes ?? []).filter(n => leftIds.has(n.customer_id))
  chk('לא נשארה אף הערת בדיקה', orphanNotes.length === 0, `count=${orphanNotes.length}`)

  const { data: leftActivity } = await svc.from('customer_crm_activity').select('customer_id')
  const orphanActivity = (leftActivity ?? []).filter(a => leftIds.has(a.customer_id))
  chk('לא נשארה אף activity של בדיקה', orphanActivity.length === 0, `count=${orphanActivity.length}`)

  const { data: adminsAfter } = await svc.from('admins').select('user_id')
  chk('טבלת admins ללא שינוי — בדיוק שני מנהלים', adminsAfter?.length === 2,
    `count=${adminsAfter?.length}`)

  const failed = results.filter(r => !r).length
  console.log('\n' + '═'.repeat(60))
  console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
  process.exit(failed === 0 && exitCode === 0 ? 0 : 1)
}
