/**
 * בדיקות שלב 10 מול Supabase האמיתי, אחרי הרצת 0010.
 *
 * scripts/test-manual-booking.mjs אוכף את *כוונת* המיגרציה (PGlite).
 * הקובץ הזה מאמת שהמצב בפועל בבסיס הנתונים תואם לה — כי מיגרציה יכולה
 * להיראות נכונה ולא לרוץ, ובסיס נתונים יכול להיות סגור היום ולהיפתח מחר.
 *
 * שלושה דברים נבדקים כאן ואי אפשר לבדוק אותם ב-PGlite:
 *
 *   1. **ההרשאות בפועל** — anon, לקוחה מחוברת זרה, ולקוחה שהרשומה שלה.
 *      אף אחת מהן לא אמורה להריץ RPC של שלב 10 או לקרוא idempotency.
 *
 *   2. **החשיפה שנסגרה** — לקוחה מחוברת מנסה לשנות is_blocked,
 *      admin_notes, phone_e164 ו-auth_user_id של עצמה דרך PostgREST.
 *      לפני 0010 כל ארבעתם הצליחו בפרויקט הזה.
 *
 *   3. **המנהלות** — נשארות בדיוק שתיים, נשארות מוחרגות מה-CRM,
 *      וה-auth_user_id שלהן קושר כראוי ע"י ה-backfill.
 *
 * ⚠️ יוצר משתמשי בדיקה, לקוחות ותורים אמיתיים ב-Supabase ומוחק את כולם
 * בסיום, גם אם בדיקה נכשלת. אינו נוגע ב-Google Calendar, ב-admins,
 * ובלקוחות אמיתיות.
 *
 * הרצה:  npm run test:live:manual-booking
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { randomUUID, createHash } from 'crypto'

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
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const fp = obj => createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex')
const FP_A = fp({ a: 1 })
const FP_B = fp({ b: 2 })

/** מספר בדיקה אקראי בטווח שלא בשימוש אמיתי */
const testPhone = () => '+9725' + String(Math.floor(10000000 + Math.random() * 89999999))

// כל מה שנוצר כאן, כדי שהניקוי יהיה מלא גם אם בדיקה נפלה באמצע
const created = { authUsers: [], customers: [], appointments: [], idempotency: [] }

async function cleanup() {
  section('ניקוי')

  // ⚠️ admin_idempotency אינה קשורה ב-FK ל-customers/appointments
  // (target_id מצביע לשתי טבלאות), ולכן היא **חייבת** ניקוי מפורש.
  if (created.idempotency.length) {
    const { error } = await svc.from('admin_idempotency')
      .delete().in('client_request_id', created.idempotency)
    chk('רשומות ה-idempotency של הבדיקה נמחקו', !error, error?.message ?? '')
  }

  if (created.appointments.length) {
    await svc.from('appointment_history').delete().in('appointment_id', created.appointments)
    const { error } = await svc.from('appointments').delete().in('id', created.appointments)
    chk('תורי הבדיקה נמחקו', !error, error?.message ?? '')
  }

  if (created.customers.length) {
    // customer_crm_profiles / notes / activity יורדים ב-CASCADE
    const { error } = await svc.from('customers').delete().in('id', created.customers)
    chk('לקוחות הבדיקה נמחקו', !error, error?.message ?? '')
  }

  for (const id of created.authUsers) {
    const { error } = await svc.auth.admin.deleteUser(id)
    if (error) chk('משתמש בדיקה נמחק מ-auth.users', false, error.message)
  }
  chk('משתמשי הבדיקה נמחקו מ-auth.users', true, `${created.authUsers.length} משתמשים`)

  // ── הוכחה שלא נשאר כלום ──────────────────────────────────────────────────
  const { count: leftCust } = await svc.from('customers')
    .select('id', { count: 'exact', head: true }).ilike('full_name', 'TEST %')
  chk('לא נשארו לקוחות TEST', (leftCust ?? 0) === 0, `count=${leftCust}`)

  const { count: leftIdem } = await svc.from('admin_idempotency')
    .select('client_request_id', { count: 'exact', head: true })
    .in('client_request_id', created.idempotency.length ? created.idempotency : [randomUUID()])
  chk('לא נשארו רשומות idempotency של הבדיקה', (leftIdem ?? 0) === 0, `count=${leftIdem}`)

  const { count: adminCount } = await svc.from('admins')
    .select('user_id', { count: 'exact', head: true })
    .limit(100)
  chk('⚠️ admins נשאר בדיוק 2', adminCount === 2, `count=${adminCount}`)
}

try {
  // ══════════════════════════════════════════════════════════════════════════
  section('הסכמה בפועל')
  // ══════════════════════════════════════════════════════════════════════════

  const probe = await svc.from('customers').select('id, auth_user_id').limit(1)
  chk('העמודה customers.auth_user_id קיימת בפרודקשן', !probe.error, probe.error?.message ?? '')
  if (probe.error) {
    console.log('\n⛔ המיגרציה 0010 ככל הנראה לא הותקנה. עוצר.')
    process.exit(1)
  }

  const idem = await svc.from('admin_idempotency').select('scope').limit(1)
  chk('הטבלה admin_idempotency קיימת', !idem.error, idem.error?.message ?? '')

  // ── המנהלות ──────────────────────────────────────────────────────────────
  const { data: admins } = await svc.from('admins').select('user_id')
  chk('⚠️ admins מכילה בדיוק שתי מנהלות', admins?.length === 2, `count=${admins?.length}`)

  const { data: adminCustomers } = await svc.from('customers')
    .select('id, auth_user_id').in('auth_user_id', admins.map(a => a.user_id))
  chk('⚠️ שתי שורות המנהלות ב-customers קושרו ע"י ה-backfill',
    adminCustomers?.length === 2, `count=${adminCustomers?.length}`)
  chk('⚠️ ה-backfill שמר auth_user_id = id למבנה הישן',
    adminCustomers?.every(c => c.id === c.auth_user_id))

  // ══════════════════════════════════════════════════════════════════════════
  section('ההרשאות בפועל: anon')
  // ══════════════════════════════════════════════════════════════════════════

  const RPCS = [
    ['link_or_create_customer_for_auth', {
      p_auth_user_id: randomUUID(), p_phone_e164: testPhone(), p_full_name: 'TEST' }],
    ['create_manual_customer', {
      p_full_name: 'TEST', p_phone_e164: testPhone(), p_source_key: 'website',
      p_crm_status: 'active', p_admin_id: randomUUID(),
      p_client_request_id: randomUUID(), p_payload_fingerprint: FP_A }],
    ['create_manual_appointment', {
      p_customer_id: randomUUID(), p_service_key: 'הרמת גבות', p_variants: [],
      p_price_total: 250, p_starts_at: '2030-01-01T10:00:00Z', p_duration_min: 40,
      p_policy_version: '1.0', p_admin_id: randomUUID(),
      p_client_request_id: randomUUID(), p_payload_fingerprint: FP_A }],
  ]

  for (const [fn, args] of RPCS) {
    const { error } = await anon.rpc(fn, args)
    chk(`anon אינו יכול להריץ ${fn}`, Boolean(error), error ? '' : '⚠️ הצליח!')
  }

  const anonIdem = await anon.from('admin_idempotency').select('scope').limit(1)
  chk('anon אינו קורא מ-admin_idempotency',
    Boolean(anonIdem.error) || (anonIdem.data ?? []).length === 0)

  // ══════════════════════════════════════════════════════════════════════════
  section('הכנת לקוחת בדיקה מחוברת')
  // ══════════════════════════════════════════════════════════════════════════

  const email = `test-stage10-${randomUUID()}@example.com`
  const password = randomUUID()
  const { data: authData, error: authErr } =
    await svc.auth.admin.createUser({ email, password, email_confirm: true })
  chk('נוצר משתמש בדיקה', !authErr, authErr?.message ?? '')
  const TEST_AUTH = authData.user.id
  created.authUsers.push(TEST_AUTH)

  const TEST_PHONE = testPhone()
  const { data: testCust, error: custErr } = await svc.from('customers')
    .insert({ phone_e164: TEST_PHONE, full_name: 'TEST לקוחה מחוברת', auth_user_id: TEST_AUTH })
    .select('id').single()
  chk('נוצרה לקוחת בדיקה מקושרת', !custErr, custErr?.message ?? '')
  const TEST_CUST = testCust.id
  created.customers.push(TEST_CUST)

  const client = createClient(URL_, ANON, opts)
  const { error: signErr } = await client.auth.signInWithPassword({ email, password })
  chk('לקוחת הבדיקה התחברה', !signErr, signErr?.message ?? '')

  // ══════════════════════════════════════════════════════════════════════════
  section('ההרשאות בפועל: לקוחה מחוברת')
  // ══════════════════════════════════════════════════════════════════════════

  for (const [fn, args] of RPCS) {
    const { error } = await client.rpc(fn, args)
    chk(`לקוחה מחוברת אינה יכולה להריץ ${fn}`, Boolean(error), error ? '' : '⚠️ הצליחה!')
  }

  const custIdem = await client.from('admin_idempotency').select('scope').limit(1)
  chk('לקוחה מחוברת אינה קוראת מ-admin_idempotency',
    Boolean(custIdem.error) || (custIdem.data ?? []).length === 0)

  // ── RLS: רואה את עצמה בלבד ───────────────────────────────────────────────
  const { data: seen } = await client.from('customers').select('id, phone_e164')
  chk('הלקוחה רואה בדיוק שורה אחת — שלה',
    seen?.length === 1 && seen[0].id === TEST_CUST, `count=${seen?.length}`)

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 החשיפה שנסגרה ב-0010')
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ⚠️ ארבע הבדיקות האלה נכשלו לפני 0010 בפרויקט הזה: RLS הגבילה שורות,
  // אבל הרשאת ה-UPDATE הייתה ברמת טבלה ולכן כל עמודה הייתה פתוחה.

  const cannotUpdate = async (label, patch, column, expected) => {
    const { error } = await client.from('customers').update(patch).eq('id', TEST_CUST)
    // גם אם PostgREST לא החזיר שגיאה — הערך בפועל חייב להישאר כשהיה
    const { data: after } = await svc.from('customers').select(column).eq('id', TEST_CUST).single()
    const unchanged = String(after?.[column] ?? null) === String(expected)
    chk(`⚠️ לקוחה אינה יכולה לשנות ${label}`, unchanged,
      unchanged ? (error ? 'נדחה' : 'לא השתנה') : '⚠️ הערך השתנה!')
  }

  await cannotUpdate('is_blocked', { is_blocked: true }, 'is_blocked', false)
  await cannotUpdate('admin_notes', { admin_notes: 'הוזרק ע"י הלקוחה' }, 'admin_notes', null)
  await cannotUpdate('phone_e164', { phone_e164: testPhone() }, 'phone_e164', TEST_PHONE)
  await cannotUpdate('auth_user_id (ניתוק החשבון)', { auth_user_id: null }, 'auth_user_id', TEST_AUTH)

  // העברת החשבון ללקוחה אחרת
  const OTHER_PHONE = testPhone()
  const { data: otherCust } = await svc.from('customers')
    .insert({ phone_e164: OTHER_PHONE, full_name: 'TEST לקוחה ידנית' })
    .select('id, auth_user_id').single()
  created.customers.push(otherCust.id)

  await client.from('customers').update({ auth_user_id: TEST_AUTH }).eq('id', otherCust.id)
  const { data: otherAfter } = await svc.from('customers')
    .select('auth_user_id').eq('id', otherCust.id).single()
  chk('⚠️ לקוחה אינה יכולה להעביר את החשבון שלה ללקוחה אחרת',
    otherAfter?.auth_user_id === null)

  // ── לקוחה ידנית אינה נגישה בכלל ──────────────────────────────────────────
  const { data: manualSeen } = await client.from('customers').select('id').eq('id', otherCust.id)
  chk('⚠️ לקוחה ידנית (auth_user_id=NULL) אינה נראית ללקוחה מחוברת',
    (manualSeen ?? []).length === 0)

  const { data: anonSeen } = await anon.from('customers').select('id').eq('id', otherCust.id)
  chk('⚠️ לקוחה ידנית אינה נראית ל-anon', (anonSeen ?? []).length === 0)

  // ══════════════════════════════════════════════════════════════════════════
  section('service_role מבצע את הזרימות')
  // ══════════════════════════════════════════════════════════════════════════

  // ── יצירת לקוחה ידנית ────────────────────────────────────────────────────
  const ADMIN_ID = admins[0].user_id
  const MANUAL_PHONE = testPhone()
  const REQ1 = randomUUID()
  created.idempotency.push(REQ1)

  const { data: mk1, error: mkErr } = await svc.rpc('create_manual_customer', {
    p_full_name: 'TEST לקוחה ידנית חדשה', p_phone_e164: MANUAL_PHONE,
    p_source_key: 'website', p_crm_status: 'active',
    p_admin_id: ADMIN_ID, p_client_request_id: REQ1, p_payload_fingerprint: FP_A,
  })
  chk('service_role יצר לקוחה ידנית', !mkErr && mk1?.result === 'customer_created',
    mkErr?.message ?? '')
  const MANUAL_ID = mk1?.customer_id
  if (MANUAL_ID) created.customers.push(MANUAL_ID)

  const { data: manualRow } = await svc.from('customers')
    .select('auth_user_id, full_name').eq('id', MANUAL_ID).single()
  chk('⚠️ ללקוחה הידנית אין auth_user_id', manualRow?.auth_user_id === null)

  const { data: manualAct } = await svc.from('customer_crm_activity')
    .select('action, actor_admin_id, new_value').eq('customer_id', MANUAL_ID)
  chk('customer_created נכתבה פעם אחת', manualAct?.length === 1)
  chk('ה-actor הוא המנהלת', manualAct?.[0]?.actor_admin_id === ADMIN_ID)
  chk('⚠️ אין טלפון ב-activity', manualAct?.[0]?.new_value === 'website')

  // idempotency
  const { data: mk2 } = await svc.rpc('create_manual_customer', {
    p_full_name: 'TEST לקוחה ידנית חדשה', p_phone_e164: MANUAL_PHONE,
    p_source_key: 'website', p_crm_status: 'active',
    p_admin_id: ADMIN_ID, p_client_request_id: REQ1, p_payload_fingerprint: FP_A,
  })
  chk('⚠️ retry מחזיר את אותה לקוחה', mk2?.customer_id === MANUAL_ID && mk2?.replayed === true)

  const { error: reuseErr } = await svc.rpc('create_manual_customer', {
    p_full_name: 'TEST שם אחר', p_phone_e164: MANUAL_PHONE,
    p_source_key: 'website', p_crm_status: 'active',
    p_admin_id: ADMIN_ID, p_client_request_id: REQ1, p_payload_fingerprint: FP_B,
  })
  chk('⚠️ payload שונה עם אותו request → IDEMPOTENCY_KEY_REUSED',
    reuseErr?.message?.includes('IDEMPOTENCY_KEY_REUSED'), reuseErr?.message ?? '')

  // ── יצירת תור ידני ───────────────────────────────────────────────────────
  // ⚠️ מועד רחוק בעתיד ובשעה לא שגרתית, כדי לא להתנגש בתור אמיתי
  const FAR = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000)
  FAR.setUTCHours(3, 17, 0, 0)
  const REQ2 = randomUUID()
  created.idempotency.push(REQ2)

  const { data: ap1, error: apErr } = await svc.rpc('create_manual_appointment', {
    p_customer_id: MANUAL_ID, p_service_key: 'הרמת גבות', p_variants: [],
    p_price_total: 250, p_starts_at: FAR.toISOString(), p_duration_min: 40,
    p_policy_version: '1.0', p_admin_id: ADMIN_ID,
    p_client_request_id: REQ2, p_payload_fingerprint: FP_A,
  })
  chk('service_role יצר תור ידני ללקוחה ללא חשבון',
    !apErr && ap1?.result === 'appointment_created', apErr?.message ?? '')
  const APPT_ID = ap1?.appointment_id
  if (APPT_ID) created.appointments.push(APPT_ID)

  const { data: apRow } = await svc.from('appointments')
    .select('status, calendar_sync_status, calendar_sync_operation, pending_expires_at, price_total, duration_min')
    .eq('id', APPT_ID).single()
  chk('התור נוצר confirmed', apRow?.status === 'confirmed')
  chk('pending_expires_at ריק', apRow?.pending_expires_at === null)
  chk('הסנכרון ממתין (upsert/pending)',
    apRow?.calendar_sync_operation === 'upsert' && apRow?.calendar_sync_status === 'pending')

  const { data: apHist } = await svc.from('appointment_history')
    .select('action, actor, actor_id, source, to_status').eq('appointment_id', APPT_ID)
  chk('⚠️ נכתבה שורת היסטוריה אחת בדיוק', apHist?.length === 1)
  chk('actor=admin, source=admin_dashboard',
    apHist?.[0]?.actor === 'admin' && apHist?.[0]?.source === 'admin_dashboard' &&
    apHist?.[0]?.actor_id === ADMIN_ID)

  const { data: ap2 } = await svc.rpc('create_manual_appointment', {
    p_customer_id: MANUAL_ID, p_service_key: 'הרמת גבות', p_variants: [],
    p_price_total: 250, p_starts_at: FAR.toISOString(), p_duration_min: 40,
    p_policy_version: '1.0', p_admin_id: ADMIN_ID,
    p_client_request_id: REQ2, p_payload_fingerprint: FP_A,
  })
  chk('⚠️ retry מחזיר את אותו תור', ap2?.appointment_id === APPT_ID && ap2?.replayed === true)

  const { data: apHist2 } = await svc.from('appointment_history')
    .select('id').eq('appointment_id', APPT_ID)
  chk('⚠️ retry לא כתב היסטוריה נוספת', apHist2?.length === 1)

  // תור לחשבון מנהל נדחה
  const { data: adminCust } = await svc.from('customers')
    .select('id').eq('auth_user_id', ADMIN_ID).single()
  const { error: adminApptErr } = await svc.rpc('create_manual_appointment', {
    p_customer_id: adminCust.id, p_service_key: 'הרמת גבות', p_variants: [],
    p_price_total: 250, p_starts_at: new Date(FAR.getTime() + 86400000).toISOString(),
    p_duration_min: 40, p_policy_version: '1.0', p_admin_id: ADMIN_ID,
    p_client_request_id: randomUUID(), p_payload_fingerprint: FP_A,
  })
  chk('⚠️ תור לחשבון מנהל נדחה', adminApptErr?.message?.includes('CUSTOMER_IS_ADMIN'),
    adminApptErr?.message ?? '')

  // ══════════════════════════════════════════════════════════════════════════
  section('קישור OTP ללקוחה ידנית')
  // ══════════════════════════════════════════════════════════════════════════

  // ⚠️ הלב של השלב: הלקוחה הידנית שיצרנו למעלה מקבלת חשבון, ושומרת על
  // אותו customer.id ועל התור שכבר נקבע לה.
  const { data: linkAuth } = await svc.auth.admin.createUser({
    phone: MANUAL_PHONE.replace('+', ''), phone_confirm: true,
  })
  chk('נוצר חשבון התחברות לבדיקת הקישור', Boolean(linkAuth?.user))
  const LINK_AUTH = linkAuth.user.id
  created.authUsers.push(LINK_AUTH)

  const { data: linked, error: linkErr } = await svc.rpc('link_or_create_customer_for_auth', {
    p_auth_user_id: LINK_AUTH, p_phone_e164: MANUAL_PHONE, p_full_name: 'TEST שם מהטופס',
  })
  chk('הקישור בוצע', !linkErr && linked?.linked === true, linkErr?.message ?? '')
  chk('⚠️ אותו customer.id נשמר', linked?.customer_id === MANUAL_ID)
  chk('⚠️ השם הידני מה-CRM לא נדרס', linked?.full_name === 'TEST לקוחה ידנית חדשה')

  const { count: apptsAfterLink } = await svc.from('appointments')
    .select('id', { count: 'exact', head: true }).eq('customer_id', MANUAL_ID)
  chk('⚠️ התור שנקבע לפני הקישור נשאר', apptsAfterLink === 1)

  const { count: dupes } = await svc.from('customers')
    .select('id', { count: 'exact', head: true }).eq('phone_e164', MANUAL_PHONE)
  chk('⚠️ לא נוצרה לקוחה כפולה', dupes === 1)

  const { data: relink } = await svc.rpc('link_or_create_customer_for_auth', {
    p_auth_user_id: LINK_AUTH, p_phone_e164: MANUAL_PHONE, p_full_name: null,
  })
  chk('קישור חוזר idempotent', relink?.customer_id === MANUAL_ID && relink?.linked === false)

  // ── מצב 4: הטלפון כבר מקושר ל-auth user אחר ──────────────────────────────
  // ⚠️ ה-auth user חייב להיות **לא מקושר** בעצמו. auth שכבר מקושר ללקוחה
  // אחרת נעצר קודם ב-AUTH_CUSTOMER_CONFLICT (מצב 5), שהוא ההתנגשות
  // הספציפית יותר — וזה הסדר הנכון.
  const { data: freshAuth } = await svc.auth.admin.createUser({
    phone: testPhone().replace('+', ''), phone_confirm: true,
  })
  created.authUsers.push(freshAuth.user.id)

  const { error: stealErr } = await svc.rpc('link_or_create_customer_for_auth', {
    p_auth_user_id: freshAuth.user.id, p_phone_e164: MANUAL_PHONE, p_full_name: null,
  })
  chk('⚠️ auth חדש שמנסה לתפוס טלפון מקושר נדחה',
    stealErr?.message?.includes('PHONE_LINKED_TO_OTHER_AUTH'), stealErr?.message ?? '')

  const { data: stillMine } = await svc.from('customers')
    .select('auth_user_id').eq('id', MANUAL_ID).single()
  chk('⚠️ ה-ownership לא הועבר', stillMine?.auth_user_id === LINK_AUTH)

  const { count: stillOne } = await svc.from('customers')
    .select('id', { count: 'exact', head: true }).eq('phone_e164', MANUAL_PHONE)
  chk('⚠️ לא נוצרה לקוחה כפולה בניסיון התפיסה', stillOne === 1)

  // ה-auth כבר מקושר ללקוחה עם טלפון אחר
  const { error: conflictErr } = await svc.rpc('link_or_create_customer_for_auth', {
    p_auth_user_id: LINK_AUTH, p_phone_e164: testPhone(), p_full_name: null,
  })
  chk('⚠️ auth מקושר עם טלפון סותר → conflict',
    conflictErr?.message?.includes('AUTH_CUSTOMER_CONFLICT'), conflictErr?.message ?? '')

  // ══════════════════════════════════════════════════════════════════════════
  section('ה-CRM')
  // ══════════════════════════════════════════════════════════════════════════

  const { data: profile } = await svc.rpc('get_crm_customer', { p_customer_id: MANUAL_ID })
  chk('⚠️ הלקוחה מוצגת עכשיו כבעלת חשבון', profile?.has_login_account === true)
  chk('⚠️ auth_user_id אינו נחשף בפרופיל', !('auth_user_id' in (profile ?? {})))

  const { data: manualOnly } = await svc.rpc('get_crm_customer', { p_customer_id: otherCust.id })
  chk('⚠️ לקוחה ידנית מוצגת כ"ללא חשבון"', manualOnly?.has_login_account === false)

  const { data: adminProfile } = await svc.rpc('get_crm_customer', { p_customer_id: adminCust.id })
  chk('⚠️ חשבון מנהל אינו נגיש כפרופיל CRM', adminProfile === null)

  const { data: list } = await svc.rpc('list_crm_customers', {
    p_search: null, p_filter: 'all', p_source_key: null, p_sort: 'last_activity',
    p_created_from: null, p_created_to: null, p_limit: 100, p_offset: 0,
  })
  const adminIds = new Set(adminCustomers.map(c => c.id))
  chk('⚠️ המנהלות מוחרגות מרשימת ה-CRM',
    !(list?.items ?? []).some(i => adminIds.has(i.id)))
  chk('has_login_account מוחזר בכל שורה',
    (list?.items ?? []).every(i => typeof i.has_login_account === 'boolean'))
} catch (err) {
  chk('הבדיקה רצה עד הסוף ללא חריגה', false, err.message)
} finally {
  await cleanup()
}

const passed = results.filter(Boolean).length
console.log(`\n${'═'.repeat(60)}`)
if (passed === results.length) {
  console.log(`✓ כל ${results.length} הבדיקות עברו`)
} else {
  console.log(`✗ ${results.length - passed} מתוך ${results.length} נכשלו`)
  process.exit(1)
}
