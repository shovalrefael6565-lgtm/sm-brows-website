/**
 * בדיקת שלב 4 מול פרויקט Supabase האמיתי (לא PGlite) — אחרי הרצת
 * 0002_pending_expiration_enum_values.sql ו-0003_pending_expiration.sql.
 *
 * יוצרת שתי לקוחות בדיקה מזוהות בבירור (טלפון בטווח +972500000091/92,
 * שם "TEST — מחיקה אוטומטית") ומוחקת את כולן + כל מה שהן יצרו בסיום —
 * גם אם בדיקה כלשהי נכשלת (ה-cleanup רץ תמיד, ב-finally).
 *
 * הרצה:  npm run test:live:pending-expiration
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

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
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const results = []
const chk = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`)
}

const PHONE_A = '+972500000091'
const PHONE_B = '+972500000092'
const NAME = 'TEST — מחיקה אוטומטית (stage 4 live check)'

const createTestCustomer = async (phone) => {
  const { data: authUser, error: authErr } = await db.auth.admin.createUser({
    phone: phone.replace('+', ''),
    phone_confirm: true,
  })
  if (authErr || !authUser?.user) throw new Error(`auth create failed: ${authErr?.message}`)
  const { data: customer, error: custErr } = await db
    .from('customers')
    .insert({ id: authUser.user.id, phone_e164: phone, full_name: NAME })
    .select('id')
    .single()
  if (custErr) throw new Error(`customer create failed: ${custErr.message}`)
  return customer.id
}

const createPending = (customerId, startsAt, notes = null) =>
  db.rpc('create_pending_appointment', {
    p_customer_id: customerId,
    p_service_key: 'natural',
    p_variants: [],
    p_price_total: 70,
    p_starts_at: startsAt,
    p_duration_min: 20,
    p_notes: notes,
    p_policy_version: 'live-test',
  })

let customerAId = null
let customerBId = null
const createdAppointmentIds = new Set()

try {
  console.log('── הכנה: יצירת שתי לקוחות בדיקה ' + '─'.repeat(30))
  customerAId = await createTestCustomer(PHONE_A)
  customerBId = await createTestCustomer(PHONE_B)
  chk('שתי לקוחות בדיקה נוצרו', !!customerAId && !!customerBId)

  console.log('\n── 1. יצירת pending ' + '─'.repeat(40))
  const SLOT_1 = '2027-03-01T10:00:00Z'
  const r1 = await createPending(customerAId, SLOT_1)
  chk('בקשה ראשונה נוצרה כ-pending', !r1.error && r1.data?.status === 'pending', r1.error?.message ?? '')
  if (r1.data?.id) createdAppointmentIds.add(r1.data.id)

  console.log('\n── חסימת חפיפה ' + '─'.repeat(40))
  const overlap = await createPending(customerBId, SLOT_1)
  chk('בקשה חופפת מלקוחה אחרת נחסמת (23P01)', overlap.error?.code === '23P01', overlap.error?.message ?? '')

  console.log('\n── כתיבת appointment_history ' + '─'.repeat(30))
  const { data: hist1 } = await db
    .from('appointment_history')
    .select('action, from_status, to_status, actor')
    .eq('appointment_id', r1.data.id)
  chk('נרשמה היסטוריית created',
    hist1?.length === 1 && hist1[0].action === 'created' && hist1[0].actor === 'customer',
    JSON.stringify(hist1))

  console.log('\n── מגבלת 2 pending פעילים ' + '─'.repeat(30))
  const SLOT_2 = '2027-03-02T10:00:00Z'
  const r2 = await createPending(customerAId, SLOT_2)
  chk('בקשה שנייה לאותה לקוחה מתקבלת', !r2.error && r2.data?.status === 'pending', r2.error?.message ?? '')
  if (r2.data?.id) createdAppointmentIds.add(r2.data.id)

  const SLOT_3 = '2027-03-03T10:00:00Z'
  const r3 = await createPending(customerAId, SLOT_3)
  chk('בקשה שלישית לאותה לקוחה נחסמת (מגבלת 2)',
    r3.error?.message?.includes('PENDING_LIMIT_REACHED'), r3.error?.message ?? '')

  console.log('\n── ביטול pending ע"י בעלת הבקשה ' + '─'.repeat(25))
  const cancelByOther = await db.rpc('cancel_pending_appointment', {
    p_appointment_id: r1.data.id,
    p_customer_id: customerBId,
  })
  chk('לקוחה אחרת לא יכולה לבטל את הבקשה', cancelByOther.error?.message?.includes('NOT_FOUND'), cancelByOther.error?.message ?? '')

  const cancelByOwner = await db.rpc('cancel_pending_appointment', {
    p_appointment_id: r1.data.id,
    p_customer_id: customerAId,
  })
  chk('בעלת הבקשה מבטלת בהצלחה', !cancelByOwner.error && cancelByOwner.data?.status === 'cancelled_by_customer', cancelByOwner.error?.message ?? '')

  const { data: histCancel } = await db
    .from('appointment_history')
    .select('action, to_status')
    .eq('appointment_id', r1.data.id)
    .order('created_at', { ascending: false })
    .limit(1)
  chk('נרשמה היסטוריית cancelled', histCancel?.[0]?.action === 'cancelled' && histCancel?.[0]?.to_status === 'cancelled_by_customer')

  console.log('\n── שחרור סלוט אחרי ביטול ' + '─'.repeat(30))
  const freedByCancel = await createPending(customerBId, SLOT_1)
  chk('הסלוט שבוטל פנוי ללקוחה אחרת', !freedByCancel.error && freedByCancel.data?.status === 'pending', freedByCancel.error?.message ?? '')
  if (freedByCancel.data?.id) createdAppointmentIds.add(freedByCancel.data.id)

  console.log('\n── תפוגת pending ושחרור סלוט ' + '─'.repeat(25))
  // מקדימות ידנית את pending_expires_at של r2 לעבר — מדמה חלוף 12 שעות
  const { error: backdateErr } = await db
    .from('appointments')
    .update({ pending_expires_at: new Date(Date.now() - 3600_000).toISOString() })
    .eq('id', r2.data.id)
  chk('הקדמת pending_expires_at לעבר (הכנה לבדיקה)', !backdateErr, backdateErr?.message ?? '')

  const { error: sweepErr } = await db.rpc('expire_stale_pending_appointments')
  chk('expire_stale_pending_appointments רצה בלי שגיאה', !sweepErr, sweepErr?.message ?? '')

  const { data: afterExpire } = await db
    .from('appointments')
    .select('status')
    .eq('id', r2.data.id)
    .single()
  chk('הבקשה שפג תוקפה מסומנת expired', afterExpire?.status === 'expired', afterExpire?.status)

  const { data: histExpire } = await db
    .from('appointment_history')
    .select('action, from_status, to_status, actor')
    .eq('appointment_id', r2.data.id)
    .order('created_at', { ascending: false })
    .limit(1)
  chk('נרשמה היסטוריית expired (action=expired, from=pending, to=expired, actor=system)',
    histExpire?.[0]?.action === 'expired' && histExpire?.[0]?.from_status === 'pending'
    && histExpire?.[0]?.to_status === 'expired' && histExpire?.[0]?.actor === 'system',
    JSON.stringify(histExpire))

  const freedByExpiry = await createPending(customerBId, SLOT_2)
  chk('הסלוט של הבקשה שפגה פנוי ליצירת בקשה חדשה', !freedByExpiry.error && freedByExpiry.data?.status === 'pending', freedByExpiry.error?.message ?? '')
  if (freedByExpiry.data?.id) createdAppointmentIds.add(freedByExpiry.data.id)
} catch (e) {
  chk('הבדיקה רצה עד הסוף בלי חריגה לא צפויה', false, e.message)
} finally {
  console.log('\n── ניקוי נתוני בדיקה ' + '─'.repeat(35))

  // כל תור שנוצר לאורך הבדיקה — כולל כאלה שנוצרו ע"י customerB — משויך
  // ל-customerAId/customerBId, אז מספיק למחוק לפי customer_id (לא לפי
  // רשימת IDs שנאספה ידנית, כדי לא לפספס שורה אם הבדיקה נשברה באמצע).
  const { error: delAppts, count: apptsDeleted } = await db
    .from('appointments')
    .delete({ count: 'exact' })
    .in('customer_id', [customerAId, customerBId].filter(Boolean))
  chk('כל תורי הבדיקה נמחקו (מוחק גם appointment_history בקסקדה)', !delAppts, `נמחקו ${apptsDeleted ?? 0}${delAppts ? ' — ' + delAppts.message : ''}`)

  const { error: delCust } = await db
    .from('customers')
    .delete()
    .in('id', [customerAId, customerBId].filter(Boolean))
  chk('שתי לקוחות הבדיקה נמחקו', !delCust, delCust?.message ?? '')

  for (const id of [customerAId, customerBId].filter(Boolean)) {
    const { error } = await db.auth.admin.deleteUser(id)
    if (error) console.log(`✗ מחיקת auth user ${id} נכשלה: ${error.message}`)
  }

  // אימות: אין שום שריד
  const { data: leftoverAppts } = await db
    .from('appointments')
    .select('id')
    .in('customer_id', [customerAId, customerBId].filter(Boolean))
  const { data: leftoverCust } = await db
    .from('customers')
    .select('id')
    .in('id', [customerAId, customerBId].filter(Boolean))
  chk('אימות: אין שום שריד תורים/לקוחות של הבדיקה',
    (leftoverAppts?.length ?? 0) === 0 && (leftoverCust?.length ?? 0) === 0,
    `תורים=${leftoverAppts?.length ?? 0} לקוחות=${leftoverCust?.length ?? 0}`)
}

const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
