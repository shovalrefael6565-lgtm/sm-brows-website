/**
 * בדיקות שלב 11 מול Supabase האמיתי, אחרי הרצת 0011.
 *
 * scripts/test-reminders.mjs אוכף את *כוונת* המיגרציה (PGlite). הקובץ הזה
 * מאמת שהמצב בפועל בבסיס הנתונים תואם לה — כי מיגרציה יכולה להיראות נכונה
 * ולא לרוץ, ובסיס נתונים יכול להיות סגור היום ולהיפתח מחר.
 *
 * שלושה דברים נבדקים כאן ואי אפשר לבדוק אותם ב-PGlite:
 *
 *   1. **ההרשאות בפועל** — anon ולקוחה מחוברת מול עשרת ה-RPCs ומול שתי
 *      הטבלאות. אף אחת מהן לא אמורה לקרוא, לכתוב או להריץ שום דבר.
 *
 *   2. **ה-CHECK שחוסם SMS אמיתי** — שהוא באמת קיים בפרודקשן ולא רק בקובץ.
 *
 *   3. **הטריגר על appointments** — שהוא באמת מותקן ופועל על הסכמה החיה.
 *
 * ⚠️ יוצר משתמש בדיקה, לקוחה ותורים אמיתיים ב-Supabase ומוחק את כולם
 * בסיום, גם אם בדיקה נכשלת. אינו נוגע ב-Google Calendar, ב-admins,
 * בלקוחות אמיתיות, ואינו שולח שום הודעה.
 *
 * ⚠️ הבדיקה **נכשלת** אם 0011 לא הורצה. זה מכוון: היא השער שמוכיח שהיא
 * הורצה, ודילוג שקט היה הופך אותה לחסרת ערך.
 *
 * הרצה:  npm run test:live:reminders
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

// ⚠️ מוזרם ל-process.env כדי ש-lib/supabase/admin ו-lib/featureFlags יראו
// אותו — הבדיקה מריצה את ה-dispatcher **האמיתי**, לא העתק שלו.
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
// שני הדגלים נדלקים לתהליך הבדיקה בלבד. הספק עצמו מוזרק כ-fake, ולכן
// אין כאן שום מסלול שמגיע לספק אמיתי.
process.env.NEW_BOOKING_SYSTEM_ENABLED = 'true'
process.env.REMINDERS_ENABLED = 'true'

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const opts = { auth: { autoRefreshToken: false, persistSession: false } }

const { runReminderDispatch } = await import('../lib/reminders/dispatch.ts')
const { DisabledReminderProvider } = await import('../lib/reminders/provider.ts')
const remindersDb = await import('../lib/db/reminders.ts')

const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, opts)
const anon = createClient(URL_, ANON, opts)

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

let phoneSeq = 0
const testPhone = () => '+9725' + String(49000000 + phoneSeq++)

const created = { authUsers: [], customers: [], appointments: [], idempotency: [] }

async function cleanup() {
  section('ניקוי')

  if (created.idempotency.length) {
    const { error } = await svc.from('admin_idempotency')
      .delete().in('client_request_id', created.idempotency)
    chk('רשומות ה-idempotency של הבדיקה נמחקו', !error, error?.message ?? '')
  }

  // ⚠️ appointment_reminders ו-appointment_reminder_attempts נמחקות
  // ב-cascade דרך ה-FK ל-appointments, אבל המחיקה המפורשת כאן היא ההוכחה
  // לכך — ולא הנחה.
  if (created.appointments.length) {
    await svc.from('appointment_reminders').delete().in('appointment_id', created.appointments)
    await svc.from('appointment_history').delete().in('appointment_id', created.appointments)
    const { error } = await svc.from('appointments').delete().in('id', created.appointments)
    chk('תורי הבדיקה נמחקו', !error, error?.message ?? '')
  }

  if (created.customers.length) {
    const { error } = await svc.from('customers').delete().in('id', created.customers)
    chk('לקוחות הבדיקה נמחקו', !error, error?.message ?? '')
  }

  for (const id of created.authUsers) {
    const { error } = await svc.auth.admin.deleteUser(id)
    chk('משתמש הבדיקה נמחק', !error, error?.message ?? '')
  }

  const { count: leftCust } = await svc.from('customers')
    .select('id', { count: 'exact', head: true }).ilike('full_name', 'TEST %')
  chk('לא נשארו לקוחות TEST', (leftCust ?? 0) === 0, `count=${leftCust}`)

  const { count: leftRem } = await svc.from('appointment_reminders')
    .select('id', { count: 'exact', head: true })
    .in('appointment_id', created.appointments.length ? created.appointments : [randomUUID()])
  chk('לא נשארו תזכורות של הבדיקה', (leftRem ?? 0) === 0, `count=${leftRem}`)
}

try {
  // ══════════════════════════════════════════════════════════════════════════
  section('0011 הורצה — הטבלאות קיימות')
  // ══════════════════════════════════════════════════════════════════════════

  const { error: remErr } = await svc.from('appointment_reminders')
    .select('id', { count: 'exact', head: true })
  chk('appointment_reminders קיימת', !remErr, remErr?.message ?? '')

  const { error: attErr } = await svc.from('appointment_reminder_attempts')
    .select('id', { count: 'exact', head: true })
  chk('appointment_reminder_attempts קיימת', !attErr, attErr?.message ?? '')

  if (remErr || attErr) {
    console.log('\n⛔ נראה ש-0011 לא הורצה ב-Supabase. עוצר.')
    await cleanup()
    process.exit(1)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 ההרשאות בפועל — anon')
  // ══════════════════════════════════════════════════════════════════════════

  for (const table of ['appointment_reminders', 'appointment_reminder_attempts']) {
    const { data, error } = await anon.from(table).select('id').limit(1)
    chk(`🔒 anon אינו יכול לקרוא מ-${table}`,
      !!error || (data?.length ?? 0) === 0, error?.code ?? `rows=${data?.length}`)
  }

  const RPCS = [
    ['sweep_expired_reminders', {}],
    ['sync_appointment_reminders', { p_appointment_id: randomUUID() }],
    ['reminder_scheduled_for', {
      p_kind: 'day_before', p_starts_at: new Date().toISOString(),
      p_created_at: new Date().toISOString(),
    }],
    ['reminder_expires_at', {
      p_kind: 'day_before', p_starts_at: new Date().toISOString(),
      p_scheduled_for: new Date().toISOString(),
    }],
    ['create_manual_reminder', {
      p_appointment_id: randomUUID(), p_admin_id: randomUUID(),
      p_client_request_id: randomUUID(), p_payload_fingerprint: 'a'.repeat(64),
      p_template_version: 'v1',
    }],
    ['claim_due_reminder', {
      p_lease_token: randomUUID(), p_lease_seconds: 120,
      p_max_attempts: 4, p_provider: 'fake',
    }],
    ['reminder_precheck', { p_reminder_id: randomUUID(), p_lease_token: randomUUID() }],
    ['finish_reminder_attempt', {
      p_reminder_id: randomUUID(), p_lease_token: randomUUID(), p_outcome: 'accepted',
      p_error_code: null, p_provider_message_id: null, p_provider: 'fake',
      p_max_attempts: 4, p_appointment_changed: false,
    }],
    ['abort_reminder_attempt', {
      p_reminder_id: randomUUID(), p_lease_token: randomUUID(), p_reason: 'lease_lost',
    }],
    ['retry_reminder', {
      p_reminder_id: randomUUID(), p_admin_id: randomUUID(), p_confirm_duplicate_risk: false,
    }],
  ]

  for (const [fn, args] of RPCS) {
    const { error } = await anon.rpc(fn, args)
    chk(`🔒 anon אינו יכול להריץ ${fn}`, !!error, error?.code ?? 'הצליח!')
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 ההרשאות בפועל — לקוחה מחוברת')
  // ══════════════════════════════════════════════════════════════════════════

  const email = `test-stage11-${randomUUID()}@example.com`
  const password = randomUUID()
  const { data: authData, error: authErr } =
    await svc.auth.admin.createUser({ email, password, email_confirm: true })
  chk('משתמש בדיקה נוצר', !authErr, authErr?.message ?? '')
  if (authErr) throw new Error('לא ניתן להמשיך בלי משתמש בדיקה')
  const TEST_AUTH = authData.user.id
  created.authUsers.push(TEST_AUTH)

  const TEST_PHONE = testPhone()
  const { data: testCust, error: custErr } = await svc.from('customers')
    .insert({ phone_e164: TEST_PHONE, full_name: 'TEST לקוחה תזכורות', auth_user_id: TEST_AUTH })
    .select('id').single()
  chk('לקוחת בדיקה נוצרה', !custErr, custErr?.message ?? '')
  const TEST_CUST = testCust.id
  created.customers.push(TEST_CUST)

  const client = createClient(URL_, ANON, opts)
  const { error: signErr } = await client.auth.signInWithPassword({ email, password })
  chk('לקוחת הבדיקה התחברה', !signErr, signErr?.message ?? '')

  for (const table of ['appointment_reminders', 'appointment_reminder_attempts']) {
    const { data, error } = await client.from(table).select('id').limit(1)
    chk(`🔒 לקוחה מחוברת אינה יכולה לקרוא מ-${table}`,
      !!error || (data?.length ?? 0) === 0, error?.code ?? `rows=${data?.length}`)
  }

  for (const [fn, args] of RPCS) {
    const { error } = await client.rpc(fn, args)
    chk(`🔒 לקוחה מחוברת אינה יכולה להריץ ${fn}`, !!error, error?.code ?? '⚠️ הצליחה!')
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('הטריגר פועל על הסכמה החיה')
  // ══════════════════════════════════════════════════════════════════════════

  // נמדד לפני כל פעולה על התור, כדי שההשוואה בסוף תהיה אמיתית ולא הנחה.
  const { count: histBefore } = await svc.from('appointment_history')
    .select('id', { count: 'exact', head: true })

  const startsAt = new Date(Date.now() + 30 * 24 * 3600 * 1000)
  startsAt.setUTCMinutes(0, 0, 0)

  const { data: appt, error: apptErr } = await svc.from('appointments').insert({
    customer_id: TEST_CUST,
    service_key: 'עיצוב גבות טבעיות',
    variants: ['עיצוב גבות טבעי'],
    price_total: 70,
    starts_at: startsAt.toISOString(),
    duration_min: 20,
    status: 'confirmed',
    calendar_sync_status: 'pending',
    calendar_sync_operation: 'upsert',
  }).select('id, starts_at').single()
  chk('תור בדיקה confirmed נוצר', !apptErr, apptErr?.message ?? '')
  if (apptErr) throw new Error('לא ניתן להמשיך בלי תור בדיקה')
  created.appointments.push(appt.id)

  const readReminders = async () => {
    const { data } = await svc.from('appointment_reminders')
      .select('id, reminder_kind, status, outcome_reason, appointment_starts_at, provider')
      .eq('appointment_id', appt.id)
      .order('appointment_starts_at')
    return data ?? []
  }

  let rems = await readReminders()
  chk('⚠️ הטריגר יצר שתי תזכורות אוטומטית', rems.length === 2, `count=${rems.length}`)
  chk('שתיהן scheduled', rems.every(r => r.status === 'scheduled'),
    rems.map(r => r.status).join(','))
  chk('הספק הוא disabled — לא נשלח דבר', rems.every(r => r.provider === 'disabled'))

  // ── הזזה ────────────────────────────────────────────────────────────────
  const moved = new Date(startsAt.getTime() + 3 * 3600 * 1000)
  await svc.from('appointments').update({ starts_at: moved.toISOString() }).eq('id', appt.id)
  rems = await readReminders()
  chk('אחרי הזזה: 4 שורות', rems.length === 4, `count=${rems.length}`)
  const supers = rems.filter(r => r.status === 'superseded')
  chk('⚠️ הישנות superseded ולא נמחקו', supers.length === 2)
  chk('הסיבה: starts_at_changed', supers.every(r => r.outcome_reason === 'starts_at_changed'))

  // ── ביטול ───────────────────────────────────────────────────────────────
  await svc.from('appointments').update({ status: 'cancelled_by_business' }).eq('id', appt.id)
  rems = await readReminders()
  chk('אחרי ביטול: אף תזכורת אינה פעילה',
    !rems.some(r => ['scheduled', 'retrying', 'processing'].includes(r.status)),
    rems.map(r => r.status).join(','))
  chk('⚠️ אף שורה לא נמחקה', rems.length === 4, `count=${rems.length}`)

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 ה-CHECK שחוסם SMS אמיתי — בפועל')
  // ══════════════════════════════════════════════════════════════════════════

  const victim = rems[0]
  for (const provider of ['disabled', 'simulated', 'fake']) {
    const { error } = await svc.from('appointment_reminders')
      .update({ status: 'sent', provider }).eq('id', victim.id)
    chk(`🔒 status='sent' עם provider='${provider}' נדחה גם בפרודקשן`,
      !!error, error?.code ?? 'הצליח!')
  }

  // ⚠️ '019' נדחה בגלל **הפורמט** (נדרשת אות ראשונה), לא בגלל רשימת שמות.
  // זו הסיבה ששם הספק של שלב 12 נקבע ל-'sms_019'.
  const { error: provErr } = await svc.from('appointment_reminders')
    .update({ provider: '019' }).eq('id', victim.id)
  chk("🔒 provider='019' נדחה — הפורמט דורש אות ראשונה", !!provErr, provErr?.code ?? 'הצליח!')

  const { count: sentCount } = await svc.from('appointment_reminders')
    .select('id', { count: 'exact', head: true }).eq('status', 'sent')
  chk('⚠️ אין ולו תזכורת אחת בסטטוס sent בכל בסיס הנתונים',
    (sentCount ?? 0) === 0, `count=${sentCount}`)

  // ── מערכת התזכורות אינה כותבת להיסטוריית התורים ─────────────────────────
  //
  // ⚠️ יצירה, הזזה וביטול של התור עברו כולם דרך הטריגר של התזכורות. אילו
  // הוא היה כותב ל-appointment_history, ההיסטוריה העסקית של כל תור הייתה
  // מזדהמת ברשומות שאינן פעולות של אדם.
  const { count: histAfter } = await svc.from('appointment_history')
    .select('id', { count: 'exact', head: true })
  chk('⚠️ מערכת התזכורות לא הוסיפה ולו שורת appointment_history אחת',
    (histAfter ?? 0) === (histBefore ?? 0), `${histBefore} → ${histAfter}`)

  // ══════════════════════════════════════════════════════════════════════════
  section('0012 — cascade מנקה אודיט, מחיקה ישירה עדיין נדחית')
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ⚠️ עד 0012 רשומת ניסיון אחת הפכה את התזכורת, את התור ובעקיפין גם את
  // הלקוחה לבלתי ניתנים למחיקה. הבדיקות כאן הן מה שמונע חזרה של זה.

  const mkAppt = async (daysAhead, label) => {
    const s = new Date(Date.now() + daysAhead * 24 * 3600 * 1000)
    s.setUTCMinutes(0, 0, 0)
    const { data, error } = await svc.from('appointments').insert({
      customer_id: TEST_CUST, service_key: 'עיצוב גבות טבעיות',
      variants: ['עיצוב גבות טבעי'], price_total: 70,
      starts_at: s.toISOString(), duration_min: 20, status: 'confirmed',
      calendar_sync_status: 'pending', calendar_sync_operation: 'upsert',
    }).select('id, starts_at').single()
    if (error) throw new Error(`${label}: ${error.message}`)
    created.appointments.push(data.id)
    return data
  }
  const remsOf = async apptId => {
    const { data } = await svc.from('appointment_reminders')
      .select('*').eq('appointment_id', apptId).order('scheduled_for')
    return data ?? []
  }
  const attemptsOf = async reminderId => {
    const { data } = await svc.from('appointment_reminder_attempts')
      .select('*').eq('reminder_id', reminderId).order('attempt_number')
    return data ?? []
  }
  /** תופס תזכורת מסוימת ע"י הקדמת מועדה, כדי לא להיות תלוי בשעון */
  const claimNow = async (reminderId, leaseToken, provider = 'fake') => {
    await svc.from('appointment_reminders')
      .update({ scheduled_for: new Date(Date.now() - 60_000).toISOString(), next_attempt_at: null })
      .eq('id', reminderId)
    return remindersDb.claimDueReminder(leaseToken, provider)
  }

  const a12 = await mkAppt(20, 'תור 0012')
  const r12 = (await remsOf(a12.id))[0]

  // ניסיון אמיתי, דרך ה-claim — לא INSERT ידני
  const lease12 = randomUUID()
  const claimed12 = await claimNow(r12.id, lease12)
  chk('claim תפס תזכורת ופתח רשומת ניסיון', claimed12?.reminder?.id === r12.id)
  chk('נוצרה רשומת ניסיון אחת', (await attemptsOf(r12.id)).length === 1)

  // 4. מחיקה ישירה כשהאב קיים → נדחית
  const { error: directErr } = await svc.from('appointment_reminder_attempts')
    .delete().eq('reminder_id', r12.id)
  chk('🔒 4. DELETE ישיר של attempt כשה-reminder קיים → נדחה',
    !!directErr, directErr?.code ?? '⚠️ הצליח!')
  chk('   האודיט נשאר במקומו', (await attemptsOf(r12.id)).length === 1)

  // 9/10/11. כללי ה-UPDATE לא נפגעו
  const open12 = (await attemptsOf(r12.id))[0]
  const { error: close1Err } = await svc.from('appointment_reminder_attempts')
    .update({ finished_at: new Date().toISOString(), outcome: 'simulated' })
    .eq('id', open12.id)
  chk('9. UPDATE סגירה ראשון עובד', !close1Err, close1Err?.message?.slice(0, 40) ?? '')

  const { error: close2Err } = await svc.from('appointment_reminder_attempts')
    .update({ finished_at: new Date().toISOString(), outcome: 'accepted' })
    .eq('id', open12.id)
  chk('🔒 10. UPDATE סגירה שני נדחה', !!close2Err, close2Err?.code ?? '⚠️ הצליח!')

  for (const [field, value] of [
    ['reminder_id', randomUUID()], ['attempt_number', 77],
    ['started_at', new Date().toISOString()], ['worker_id', randomUUID()],
  ]) {
    const { error } = await svc.from('appointment_reminder_attempts')
      .update({ [field]: value }).eq('id', open12.id)
    chk(`🔒 11. שינוי ${field} של attempt נדחה`, !!error, error?.code ?? '⚠️ הצליח!')
  }

  // 5. מחיקת reminder → cascade מוחק attempts
  const { error: delRemErr } = await svc.from('appointment_reminders')
    .delete().eq('id', r12.id)
  chk('⚠️ 5. DELETE של reminder מצליח גם כשיש לו attempts', !delRemErr,
    delRemErr?.message?.slice(0, 50) ?? '')
  chk('   ה-cascade מחק את ה-attempts', (await attemptsOf(r12.id)).length === 0)

  // 6. מחיקת appointment → cascade מוחק reminders ו-attempts
  const r12b = (await remsOf(a12.id))[0]
  const lease12b = randomUUID()
  await claimNow(r12b.id, lease12b)
  chk('   נוצרה attempt נוספת לפני מחיקת התור', (await attemptsOf(r12b.id)).length === 1)

  await svc.from('appointment_history').delete().eq('appointment_id', a12.id)
  const { error: delApptErr } = await svc.from('appointments').delete().eq('id', a12.id)
  chk('⚠️ 6. DELETE של appointment מצליח ומוחק reminders+attempts', !delApptErr,
    delApptErr?.message?.slice(0, 50) ?? '')
  chk('   לא נשארו תזכורות', (await remsOf(a12.id)).length === 0)
  chk('   לא נשארו attempts', (await attemptsOf(r12b.id)).length === 0)
  created.appointments = created.appointments.filter(id => id !== a12.id)

  // ══════════════════════════════════════════════════════════════════════════
  section('dispatch חי — ספק fake מוזרק, נוצרות attempts אמיתיות')
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ⚠️ הספק מוזרק כתלות. אין 019, אין SMS, ואין קריאת רשת החוצה.

  /** ספק בדיקה. שומר את מפתחות ה-idempotency שקיבל, ואינו שולח דבר. */
  const fakeProvider = (outcome, keys) => ({
    name: 'fake', isLive: false,
    async send(message) {
      keys.push(message.idempotencyKey)
      if (outcome === 'throw') throw new Error('provider exploded')
      return outcome === 'accepted'
        ? { outcome: 'accepted', providerMessageId: 'fake-msg-1' }
        : { outcome, errorCode: 'fake_error' }
    },
  })

  // ── 1. accepted מספק שאינו חי → simulated, לעולם לא sent ────────────────
  const aAcc = await mkAppt(25, 'תור accepted')
  const rAcc = (await remsOf(aAcc.id))[0]
  await svc.from('appointment_reminders')
    .update({ scheduled_for: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', rAcc.id)
  // התזכורת השנייה מורחקת כדי שהריצה תטפל בדיוק באחת
  await svc.from('appointment_reminders')
    .update({ scheduled_for: new Date(Date.now() + 5 * 24 * 3600e3).toISOString() })
    .eq('appointment_id', aAcc.id).neq('id', rAcc.id)

  const accKeys = []
  const statsAcc = await runReminderDispatch({
    provider: fakeProvider('accepted', accKeys), maxAttempts: 4,
  })
  const rAccAfter = (await remsOf(aAcc.id)).find(r => r.id === rAcc.id)
  chk('⚠️ 1. accepted מספק fake → הסטטוס simulated ולא sent',
    rAccAfter.status === 'simulated', `status=${rAccAfter.status}`)
  chk('   ה-dispatcher ספר simulated ולא sent',
    statsAcc.simulated >= 1 && statsAcc.sent === 0,
    `simulated=${statsAcc.simulated} sent=${statsAcc.sent}`)
  const accAttempts = await attemptsOf(rAcc.id)
  chk('   נרשמה attempt אחת עם outcome=simulated',
    accAttempts.length === 1 && accAttempts[0].outcome === 'simulated',
    `n=${accAttempts.length} outcome=${accAttempts[0]?.outcome}`)
  chk('   5. מפתח ה-idempotency הוא reminder.id',
    accKeys.length === 1 && accKeys[0] === rAcc.id)

  // ── 2. retryable error → attempt נשמרת, retrying, next_attempt_at ────────
  const aRet = await mkAppt(30, 'תור retryable')
  const rRet = (await remsOf(aRet.id))[0]
  await svc.from('appointment_reminders')
    .update({ scheduled_for: new Date(Date.now() + 5 * 24 * 3600e3).toISOString() })
    .eq('appointment_id', aRet.id).neq('id', rRet.id)
  await svc.from('appointment_reminders')
    .update({ scheduled_for: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', rRet.id)

  const retKeys = []
  await runReminderDispatch({ provider: fakeProvider('retryable_error', retKeys), maxAttempts: 4 })
  const rRetAfter = (await remsOf(aRet.id)).find(r => r.id === rRet.id)
  chk('2. retryable → הסטטוס retrying', rRetAfter.status === 'retrying', `status=${rRetAfter.status}`)
  chk('   next_attempt_at חושב', rRetAfter.next_attempt_at !== null,
    rRetAfter.next_attempt_at ?? 'null')
  const retAttempts = await attemptsOf(rRet.id)
  chk('   ה-attempt נשמרה עם outcome=retryable_error',
    retAttempts.length === 1 && retAttempts[0].outcome === 'retryable_error',
    retAttempts[0]?.outcome ?? '')

  // ── 3. lease recovery ───────────────────────────────────────────────────
  const aLease = await mkAppt(35, 'תור lease')
  const rLease = (await remsOf(aLease.id))[0]
  const staleToken = randomUUID()
  await claimNow(rLease.id, staleToken)
  const openAtt = await attemptsOf(rLease.id)
  chk('3. ה-worker הראשון השאיר attempt פתוחה',
    openAtt.length === 1 && openAtt[0].finished_at === null)

  // ה-lease פג
  await svc.from('appointment_reminders')
    .update({ lease_expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', rLease.id)

  const freshToken = randomUUID()
  const reclaimed = await remindersDb.claimDueReminder(freshToken, 'fake')
  chk('   claim חדש תפס את התזכורת בחזרה', reclaimed?.reminder?.id === rLease.id)
  const afterReclaim = await attemptsOf(rLease.id)
  const prev = afterReclaim.find(a => a.attempt_number === openAtt[0].attempt_number)
  chk('   ⚠️ הניסיון הקודם נסגר כ-lease_expired',
    prev?.outcome === 'lease_expired', prev?.outcome ?? '')
  chk('   נפתחה attempt חדשה', afterReclaim.length === openAtt.length + 1,
    `n=${afterReclaim.length}`)

  const staleFinish = await remindersDb.finishReminderAttempt({
    reminderId: rLease.id, leaseToken: staleToken, outcome: 'accepted',
    errorCode: null, providerMessageId: null, provider: 'fake',
    appointmentChanged: false,
  })
  chk('   🔒 ה-token הישן נדחה', staleFinish === null)

  await remindersDb.finishReminderAttempt({
    reminderId: rLease.id, leaseToken: freshToken, outcome: 'permanent_error',
    errorCode: 'fake_error', providerMessageId: null, provider: 'fake',
    appointmentChanged: false,
  })

  // ── 4. delivery_unknown ─────────────────────────────────────────────────
  const aDU = await mkAppt(40, 'תור delivery_unknown')
  const rDU = (await remsOf(aDU.id))[0]
  await svc.from('appointment_reminders')
    .update({ scheduled_for: new Date(Date.now() + 5 * 24 * 3600e3).toISOString() })
    .eq('appointment_id', aDU.id).neq('id', rDU.id)
  await svc.from('appointment_reminders')
    .update({ scheduled_for: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', rDU.id)

  const duKeys = []
  await runReminderDispatch({ provider: fakeProvider('throw', duKeys), maxAttempts: 4 })
  const rDUAfter = (await remsOf(aDU.id)).find(r => r.id === rDU.id)
  chk('4. חריגה של הספק → delivery_unknown', rDUAfter.status === 'delivery_unknown',
    `status=${rDUAfter.status}`)
  chk('   ה-attempt נשמרה', (await attemptsOf(rDU.id)).length === 1)
  chk('   ⚠️ next_attempt_at ריק — אין retry אוטומטי', rDUAfter.next_attempt_at === null)

  // ריצה נוספת אינה נוגעת בה
  const statsAgain = await runReminderDispatch({
    provider: fakeProvider('accepted', []), maxAttempts: 4,
  })
  const rDUAgain = (await remsOf(aDU.id)).find(r => r.id === rDU.id)
  chk('   ⚠️ ריצה נוספת אינה תופסת delivery_unknown',
    rDUAgain.status === 'delivery_unknown' && (await attemptsOf(rDU.id)).length === 1,
    `status=${rDUAgain.status}`)

  const { data: admins } = await svc.from('admins').select('user_id').limit(1)
  const ADMIN_ID = admins?.[0]?.user_id
  const noConfirm = await remindersDb.retryReminder({
    reminderId: rDU.id, adminId: ADMIN_ID, confirmDuplicateRisk: false,
  })
  chk('   🔒 retry ידני בלי confirm_duplicate_risk נדחה',
    noConfirm?.ok === false, noConfirm?.error ?? JSON.stringify(noConfirm))
  const withConfirm = await remindersDb.retryReminder({
    reminderId: rDU.id, adminId: ADMIN_ID, confirmDuplicateRisk: true,
  })
  chk('   retry ידני עם confirm מפורש הצליח', withConfirm?.ok === true,
    withConfirm?.error ?? '')

  // ── 6. disabled = אפס נגיעה ─────────────────────────────────────────────
  const { count: remBefore } = await svc.from('appointment_reminders')
    .select('id', { count: 'exact', head: true })
  const { count: attBefore } = await svc.from('appointment_reminder_attempts')
    .select('id', { count: 'exact', head: true })

  const statsOff = await runReminderDispatch({ provider: new DisabledReminderProvider() })

  const { count: remAfter } = await svc.from('appointment_reminders')
    .select('id', { count: 'exact', head: true })
  const { count: attAfter } = await svc.from('appointment_reminder_attempts')
    .select('id', { count: 'exact', head: true })
  chk('🔒 6. ספק disabled → dispatchable=false', statsOff.dispatchable === false)
  chk('   אין sweep', statsOff.sweptExpired === 0 && statsOff.sweptCancelled === 0)
  chk('   אין claim', statsOff.claimed === 0)
  chk('   ⚠️ אפס שינוי במסד', remAfter === remBefore && attAfter === attBefore,
    `reminders ${remBefore}→${remAfter}, attempts ${attBefore}→${attAfter}`)

  const { count: sentEver } = await svc.from('appointment_reminders')
    .select('id', { count: 'exact', head: true }).eq('status', 'sent')
  chk("⚠️ אין ולו תזכורת אחת בסטטוס 'sent' — גם אחרי dispatch אמיתי",
    (sentEver ?? 0) === 0, `count=${sentEver}`)

  await cleanup()

  // ══════════════════════════════════════════════════════════════════════════
  section('⚠️ אחרי הניקוי — המסד חזר לאפס')
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ⚠️ נבדק **אחרי** ה-cleanup ולא לפניו: לפני 0012 מחיקת תור עם attempts
  // הייתה נכשלת, והבדיקה הזו היא מה שמוכיח שהשרשרת באמת מתנקה.

  const { count: attEnd } = await svc.from('appointment_reminder_attempts')
    .select('id', { count: 'exact', head: true })
  chk('אין ולו רשומת ניסיון אחת בכל בסיס הנתונים', (attEnd ?? 0) === 0, `count=${attEnd}`)

  const { count: remEnd } = await svc.from('appointment_reminders')
    .select('id', { count: 'exact', head: true })
  chk('אין ולו תזכורת אחת בכל בסיס הנתונים', (remEnd ?? 0) === 0, `count=${remEnd}`)

  const { count: simEnd } = await svc.from('appointment_reminders')
    .select('id', { count: 'exact', head: true }).eq('status', 'simulated')
  chk('אין ולו תזכורת אחת בסטטוס simulated', (simEnd ?? 0) === 0, `count=${simEnd}`)

  const { count: apptEnd } = await svc.from('appointments')
    .select('id', { count: 'exact', head: true })
  chk('לא נשארו תורים', (apptEnd ?? 0) === 0, `count=${apptEnd}`)

  const { count: histEnd } = await svc.from('appointment_history')
    .select('id', { count: 'exact', head: true })
  chk('לא נשארו שורות appointment_history', (histEnd ?? 0) === 0, `count=${histEnd}`)

  const { count: idemEnd } = await svc.from('admin_idempotency')
    .select('client_request_id', { count: 'exact', head: true })
  chk('לא נשארו רשומות admin_idempotency', (idemEnd ?? 0) === 0, `count=${idemEnd}`)

  const { count: adminsEnd } = await svc.from('admins')
    .select('user_id', { count: 'exact', head: true })
  chk('admins=2', adminsEnd === 2, `count=${adminsEnd}`)

  const { count: custEnd } = await svc.from('customers')
    .select('id', { count: 'exact', head: true })
  chk('customers=2', custEnd === 2, `count=${custEnd}`)
} catch (e) {
  console.log(`\n✗ שגיאה: ${e.message}`)
  results.push(false)
  await cleanup()
}

const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
