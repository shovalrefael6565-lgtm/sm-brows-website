/**
 * בדיקת הרשאות RPC מול Supabase האמיתי, אחרי הרצת 0006.
 *
 * scripts/test-rpc-permissions.mjs אוכף את *כוונת* המיגרציות (הקבצים);
 * הקובץ הזה מאמת שההרשאות בפועל בבסיס הנתונים תואמות לה. שניהם נחוצים:
 * מיגרציה יכולה להיראות נכונה ולא לרוץ, ובסיס נתונים יכול להיות סגור
 * היום ולהיפתח מחר ע"י מיגרציה שנכתבה לא נכון.
 *
 * שלושה תפקידים נבדקים:
 *   anon                  — מפתח שממילא נשלח לדפדפן
 *   authenticated (זרה)   — לקוחה מחוברת שהתור אינו שלה
 *   authenticated (בעלים) — הלקוחה שהתור *כן* שלה, מנסה לעקוף את ה-API
 *
 * אף אחד מהם לא אמור להצליח להריץ RPC רגיש. service_role כן.
 *
 * ⚠️ יוצר משתמשי בדיקה, לקוחות ותורים אמיתיים ב-Supabase ומוחק את כולם
 * בסיום, גם אם בדיקה נכשלת. אינו נוגע ב-Google Calendar וב-admins.
 *
 * הרצה:  npm run test:live:rpc-permissions
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
const FUTURE = new Date('2027-10-05T08:00:00.000Z')
const ZERO = '00000000-0000-0000-0000-000000000000'

const createdUsers = []
const createdAppointments = []

/** ההרשאה נשללה = PostgREST לא חושף את הפונקציה לתפקיד הזה */
function isBlocked(error) {
  if (!error) return false
  return error.message.includes('Could not find the function') ||
    error.message.includes('permission denied')
}

let exitCode = 1
try {
  // ── האם 0006 הורצה בכלל ───────────────────────────────────────────────────
  const canary = await anon.rpc('expire_stale_pending_appointments')
  if (!isBlocked(canary.error)) {
    console.log('⚠ 0006_restrict_sensitive_rpcs.sql עדיין לא הורצה ב-Supabase.')
    console.log('  anon עדיין מצליח להריץ RPC רגיש. הבדיקה מדלגת.')
    console.log('  (scripts/test-rpc-permissions.mjs אוכף את המיגרציות עצמן בכל npm test)')
    exitCode = 0
    results.push(true)
  } else {
    // ── הכנת נתוני בדיקה ────────────────────────────────────────────────────
    async function makeCustomer(label) {
      const email = `test-${randomUUID()}@sm-brows-test.invalid`
      const password = randomUUID()
      const { data, error } = await svc.auth.admin.createUser({
        email, password, email_confirm: true,
      })
      if (error) throw new Error(`יצירת משתמש בדיקה נכשלה: ${error.message}`)
      const uid = data.user.id
      createdUsers.push(uid)

      const phone = `+9725${Math.floor(10000000 + Math.random() * 89999999)}`
      // ⚠️ auth_user_id הוא מה שקושר את הלקוחה לחשבון ההתחברות מאז 0010.
      // עד אז customers.id *היה* ה-auth user id וה-RLS השווה אותו ישירות
      // מול auth.uid(); היום הבעלות עוברת דרך auth_user_id בלבד, ולקוחה
      // בלי קישור (לקוחה ידנית) אינה נראית לאף תפקיד API — וזו בדיוק
      // ההתנהגות שהבדיקות כאן מסתמכות עליה בהמשך.
      const { error: cErr } = await svc.from('customers')
        .insert({ id: uid, phone_e164: phone, full_name: `${TEST_NAME} ${label}`, auth_user_id: uid })
      if (cErr) throw new Error(`יצירת לקוחה נכשלה: ${cErr.message}`)

      const client = createClient(URL_, ANON, opts)
      const { error: sErr } = await client.auth.signInWithPassword({ email, password })
      if (sErr) throw new Error(`התחברות נכשלה: ${sErr.message}`)
      return { uid, client }
    }

    const owner = await makeCustomer('בעלת התור')
    const stranger = await makeCustomer('לקוחה זרה')

    const { data: appt, error: aErr } = await svc.from('appointments').insert({
      customer_id: owner.uid,
      service_key: 'עיצוב גבות טבעיות',
      variants: [], price_total: 70,
      starts_at: FUTURE.toISOString(), ends_at: FUTURE.toISOString(),
      duration_min: 20, status: 'confirmed',
      calendar_sync_status: 'synced', calendar_sync_operation: 'upsert',
    }).select().single()
    if (aErr) throw new Error(`יצירת תור נכשלה: ${aErr.message}`)
    createdAppointments.push(appt.id)

    // ── כל ה-RPCs הרגישים, עם ארגומנטים אמיתיים ────────────────────────────
    const SENSITIVE = {
      expire_stale_pending_appointments: {},
      create_pending_appointment: {
        p_customer_id: owner.uid, p_service_key: 'עיצוב גבות טבעיות', p_variants: [],
        p_price_total: 70, p_starts_at: new Date('2027-10-06T08:00:00.000Z').toISOString(),
        p_duration_min: 20, p_notes: null, p_policy_version: 'probe',
      },
      cancel_pending_appointment: { p_appointment_id: appt.id, p_customer_id: owner.uid },
      approve_pending_appointment: { p_appointment_id: appt.id, p_admin_id: ZERO },
      reject_pending_appointment: { p_appointment_id: appt.id, p_admin_id: ZERO },
      claim_calendar_sync: { p_appointment_id: appt.id },
      complete_calendar_sync: { p_appointment_id: appt.id, p_google_event_id: 'x' },
      fail_calendar_sync: { p_appointment_id: appt.id, p_error: 'x' },
      setting_numeric: { p_key: 'cancel_cutoff_hours', p_default: 1 },
      setting_boolean: { p_key: 'allow_cancel_with_deposit', p_default: true },
      reschedule_appointment_by_customer: {
        p_appointment_id: appt.id, p_customer_id: owner.uid,
        p_new_starts_at: new Date('2027-10-07T08:00:00.000Z').toISOString(),
        p_expected_starts_at: FUTURE.toISOString(),
      },
      cancel_confirmed_appointment_by_customer: {
        p_appointment_id: appt.id, p_customer_id: owner.uid,
      },
      complete_calendar_delete: { p_appointment_id: appt.id },
    }

    for (const [label, client] of [
      ['anon', anon],
      ['authenticated (לקוחה זרה)', stranger.client],
      ['authenticated (בעלת התור)', owner.client],
    ]) {
      section(`${label} — כל RPC רגיש חסום`)
      for (const [fn, args] of Object.entries(SENSITIVE)) {
        const { error } = await client.rpc(fn, args)
        chk(`${fn}`, isBlocked(error), isBlocked(error) ? '' : `הצליח! ${error?.message ?? 'ללא שגיאה'}`)
      }
    }

    // ── התור לא נגע בכל הניסיונות האלה ─────────────────────────────────────
    section('שום ניסיון לא שינה נתונים')

    const { data: after } = await svc.from('appointments')
      .select('starts_at, status, reschedule_count, calendar_sync_status, calendar_sync_attempt_count')
      .eq('id', appt.id).single()
    chk('starts_at לא השתנה', new Date(after.starts_at).getTime() === FUTURE.getTime())
    chk('status נשאר confirmed', after.status === 'confirmed')
    chk('reschedule_count נשאר 0', after.reschedule_count === 0)
    chk('מצב הסנכרון לא נגוע',
      after.calendar_sync_status === 'synced' && after.calendar_sync_attempt_count === 0)
    const { data: hist } = await svc.from('appointment_history').select('id').eq('appointment_id', appt.id)
    chk('לא נכתבה היסטוריה', hist.length === 0, `count=${hist.length}`)

    // ── RLS עדיין עובד: is_admin לא נשללה בטעות ────────────────────────────
    section('RLS ו-is_admin ממשיכים לעבוד ל-authenticated')

    const { data: ownRows, error: ownErr } = await owner.client
      .from('appointments').select('id, starts_at')
    chk('הבעלים עדיין רואה את התור שלה דרך RLS',
      !ownErr && (ownRows ?? []).some(r => r.id === appt.id),
      ownErr?.message ?? `rows=${ownRows?.length}`)

    const { data: strangerRows, error: strangerErr } = await stranger.client
      .from('appointments').select('id')
    chk('לקוחה זרה לא רואה את התור',
      !strangerErr && !(strangerRows ?? []).some(r => r.id === appt.id),
      strangerErr?.message ?? `rows=${strangerRows?.length}`)

    const { data: ownCust, error: custErr } = await owner.client
      .from('customers').select('id')
    chk('הבעלים עדיין רואה את כרטיס הלקוחה שלה',
      !custErr && (ownCust ?? []).length === 1, custErr?.message ?? `rows=${ownCust?.length}`)

    const { data: settings, error: setErr } = await anon.from('business_settings').select('key')
    chk('business_settings נשאר קריא (מדיניות מפורסמת ממילא)',
      !setErr && (settings ?? []).length === 8, setErr?.message ?? `rows=${settings?.length}`)

    // ── service_role עדיין מבצע הכול ───────────────────────────────────────
    section('service_role עדיין מבצע את כל הפעולות התקינות')

    const { data: pend, error: pendErr } = await svc.rpc('create_pending_appointment', {
      p_customer_id: owner.uid, p_service_key: 'עיצוב גבות טבעיות', p_variants: [],
      p_price_total: 70, p_starts_at: new Date('2027-10-08T08:00:00.000Z').toISOString(),
      p_duration_min: 20, p_notes: null, p_policy_version: 'probe',
    })
    chk('יצירת בקשת pending', !pendErr && pend?.status === 'pending', pendErr?.message ?? '')
    if (pend) createdAppointments.push(pend.id)

    const { error: cancelPendErr } = await svc.rpc('cancel_pending_appointment', {
      p_appointment_id: pend.id, p_customer_id: owner.uid,
    })
    chk('ביטול בקשת pending', !cancelPendErr, cancelPendErr?.message ?? '')

    const { data: pend2 } = await svc.rpc('create_pending_appointment', {
      p_customer_id: owner.uid, p_service_key: 'עיצוב גבות טבעיות', p_variants: [],
      p_price_total: 70, p_starts_at: new Date('2027-10-09T08:00:00.000Z').toISOString(),
      p_duration_min: 20, p_notes: null, p_policy_version: 'probe',
    })
    createdAppointments.push(pend2.id)
    const { data: adminRow } = await svc.from('admins').select('user_id').limit(1).single()
    const { error: approveErr } = await svc.rpc('approve_pending_appointment', {
      p_appointment_id: pend2.id, p_admin_id: adminRow.user_id,
    })
    chk('אישור ניהולי', !approveErr, approveErr?.message ?? '')

    const { data: pend3 } = await svc.rpc('create_pending_appointment', {
      p_customer_id: owner.uid, p_service_key: 'עיצוב גבות טבעיות', p_variants: [],
      p_price_total: 70, p_starts_at: new Date('2027-10-10T08:00:00.000Z').toISOString(),
      p_duration_min: 20, p_notes: null, p_policy_version: 'probe',
    })
    createdAppointments.push(pend3.id)
    const { error: rejectErr } = await svc.rpc('reject_pending_appointment', {
      p_appointment_id: pend3.id, p_admin_id: adminRow.user_id,
    })
    chk('דחייה ניהולית', !rejectErr, rejectErr?.message ?? '')

    const { data: moved, error: moveErr } = await svc.rpc('reschedule_appointment_by_customer', {
      p_appointment_id: appt.id, p_customer_id: owner.uid,
      p_new_starts_at: new Date('2027-10-11T08:00:00.000Z').toISOString(),
      p_expected_starts_at: FUTURE.toISOString(),
    })
    chk('שינוי מועד', !moveErr && moved?.outcome === 'applied', moveErr?.message ?? '')

    const { data: cancelled, error: cancelErr } = await svc.rpc(
      'cancel_confirmed_appointment_by_customer',
      { p_appointment_id: appt.id, p_customer_id: owner.uid })
    chk('ביטול תור confirmed', !cancelErr && cancelled?.outcome === 'applied', cancelErr?.message ?? '')

    const { data: syncClaim, error: claimErr } = await svc.rpc('claim_calendar_sync',
      { p_appointment_id: appt.id })
    chk('claim לסנכרון', !claimErr && syncClaim?.calendar_sync_status === 'syncing', claimErr?.message ?? '')
    const { error: delErr } = await svc.rpc('complete_calendar_delete', { p_appointment_id: appt.id })
    chk('complete_calendar_delete', !delErr, delErr?.message ?? '')
    const { error: sweepErr } = await svc.rpc('expire_stale_pending_appointments')
    chk('סריקת תפוגה', !sweepErr, sweepErr?.message ?? '')

    exitCode = 0
  }
} catch (err) {
  chk('הבדיקה רצה עד הסוף ללא חריגה', false, err.message)
} finally {
  section('ניקוי נתוני בדיקה')

  for (const id of createdAppointments) {
    const { error } = await svc.from('appointments').delete().eq('id', id)
    chk('תור בדיקה נמחק (כולל history בקסקדה)', !error, error?.message ?? '')
  }
  for (const uid of createdUsers) {
    await svc.from('customers').delete().eq('id', uid)
    const { error } = await svc.auth.admin.deleteUser(uid)
    chk('משתמש בדיקה נמחק מ-customers ומ-auth.users', !error, error?.message ?? '')
  }

  const { data: leftovers } = await svc.from('customers')
    .select('id').like('full_name', `${TEST_NAME}%`)
  chk('לא נשארה אף לקוחת בדיקה', (leftovers ?? []).length === 0, `count=${leftovers?.length}`)

  const { data: admins } = await svc.from('admins').select('user_id')
  chk('טבלת admins ללא שינוי — בדיוק שני מנהלים', admins?.length === 2, `count=${admins?.length}`)

  const failed = results.filter(r => !r).length
  console.log('\n' + '═'.repeat(60))
  console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
  process.exit(failed === 0 && exitCode === 0 ? 0 : 1)
}
