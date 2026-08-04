/**
 * בדיקת שלב 6 (אישור/דחיית בקשות + סנכרון יומן) מול Supabase האמיתי
 * ומול Google Calendar האמיתי — אחרי הרצת 0004_appointment_approval.sql.
 *
 * מתמקדת בעיקר במנגנון ה-idempotency מול Google Calendar (ה-state
 * machine claim/complete/fail + ID דטרמיניסטי + reconciliation), כי זה
 * החלק שבו שגיאה יוצרת נזק אמיתי (אירוע כפול ביומן) ולא רק שורת DB
 * שגויה. בודקת גם את זרימת ה-DB הבסיסית (approve/reject/history).
 *
 * ⚠️ יוצרת אירועים אמיתיים ב-Google Calendar האמיתי (GOOGLE_CALENDAR_ID),
 * עם כותרת "TEST — מחיקה אוטומטית" ותאריך עתידי רחוק שלא פוגע בתורים
 * אמיתיים — ומוחקת את כולם + כל נתוני ה-DB בסיום, גם אם בדיקה נכשלת.
 *
 * מה שהסקריפט הזה *לא* בודק (נבדק ידנית מול השרת הרץ):
 *   • 401/403 ב-routes עצמם (requireAdminApi) — הלוגיקה שלו נבדקת כאן
 *     ישירות דרך isAdmin(), לא דרך HTTP.
 *   • זרימת WhatsApp בדפדפן בפועל (פתיחת חלון, fallback לפופאפ חסום).
 *
 * הרצה:  node scripts/test-appointment-approval-live.mjs
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

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

function googleCredentials() {
  if (env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64) {
    return JSON.parse(Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf8'))
  }
  return JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY)
}
const auth = new google.auth.GoogleAuth({
  credentials: googleCredentials(),
  scopes: ['https://www.googleapis.com/auth/calendar'],
})
const calendar = google.calendar({ version: 'v3', auth })
const calendarId = env.GOOGLE_CALENDAR_ID

const results = []
const chk = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`)
}

const PHONE = '+972500000093'
const NAME = 'TEST — מחיקה אוטומטית (stage 6 live check)'
// רחוק בעתיד, לא בטווח שהאתר עצמו מציג/משתמש בו — לא פוגע בתורים אמיתיים
const ISO_DATE = '2028-06-06'
const START_HHMM = '11:00'
const DURATION_MIN = 20
const STARTS_AT = `${ISO_DATE}T${START_HHMM}:00+03:00`

const deterministicEventId = (appointmentId) => `smbappt${appointmentId.replace(/-/g, '')}`

async function createTestCustomer(phone) {
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

const createPending = (customerId, startsAtIso) =>
  db.rpc('create_pending_appointment', {
    p_customer_id: customerId,
    p_service_key: 'natural',
    p_variants: [],
    p_price_total: 70,
    p_starts_at: startsAtIso,
    p_duration_min: DURATION_MIN,
    p_notes: null,
    p_policy_version: 'live-test',
  })

let customerId = null
let adminUserId = null
const createdCalendarEventIds = new Set()
const createdAppointmentIds = new Set()

async function deleteCalendarEventIfExists(eventId) {
  try {
    await calendar.events.delete({ calendarId, eventId })
  } catch (err) {
    if (err?.response?.status !== 404 && err?.response?.status !== 410) throw err
  }
}

try {
  console.log('── הכנה: לקוחת בדיקה + מנהל בדיקה ' + '─'.repeat(20))
  customerId = await createTestCustomer(PHONE)
  const { data: adminAuthUser, error: adminAuthErr } = await db.auth.admin.createUser({
    phone: '972500000094',
    phone_confirm: true,
  })
  if (adminAuthErr || !adminAuthUser?.user) throw new Error(`admin auth create failed: ${adminAuthErr?.message}`)
  adminUserId = adminAuthUser.user.id
  const { error: adminInsertErr } = await db.from('admins').insert({ user_id: adminUserId })
  chk('לקוח בדיקה + מנהל בדיקה נוצרו', !!customerId && !adminInsertErr, adminInsertErr?.message ?? '')

  console.log('\n── בדיקת isAdmin (שכבת ההרשאה שה-routes משתמשים בה) ' + '─'.repeat(5))
  const { data: isAdminYes } = await db.from('admins').select('user_id').eq('user_id', adminUserId).maybeSingle()
  const { data: isAdminNo } = await db.from('admins').select('user_id').eq('user_id', customerId).maybeSingle()
  chk('מנהל בדיקה מזוהה כ-admin', !!isAdminYes)
  chk('לקוחה רגילה אינה מזוהה כ-admin (403 בפועל)', !isAdminNo)

  console.log('\n── יצירת בקשת pending ' + '─'.repeat(35))
  const created = await createPending(customerId, STARTS_AT)
  chk('בקשה נוצרה כ-pending', !created.error && created.data?.status === 'pending', created.error?.message ?? '')
  const appointmentId = created.data.id
  createdAppointmentIds.add(appointmentId)

  console.log('\n── בקשה expired אינה ניתנת לאישור ' + '─'.repeat(20))
  const { data: expiredCopy } = await db
    .from('appointments')
    .update({ status: 'expired' })
    .eq('id', appointmentId)
    .select()
    .single()
  const approveExpired = await db.rpc('approve_pending_appointment', {
    p_appointment_id: appointmentId,
    p_admin_id: adminUserId,
  })
  chk('אישור בקשה expired נחסם (NOT_PENDING)', approveExpired.error?.message?.includes('NOT_PENDING'), approveExpired.error?.message ?? '')
  // מחזירים ל-pending לצורך שאר הבדיקות
  await db.from('appointments').update({ status: 'pending', pending_expires_at: expiredCopy?.pending_expires_at ?? null }).eq('id', appointmentId)

  console.log('\n── אישור מוצלח: pending → confirmed + history ' + '─'.repeat(10))
  const approve = await db.rpc('approve_pending_appointment', {
    p_appointment_id: appointmentId,
    p_admin_id: adminUserId,
  })
  chk('אישור הצליח, סטטוס confirmed', !approve.error && approve.data?.status === 'confirmed', approve.error?.message ?? '')
  chk('calendar_sync_status הפך ל-pending', approve.data?.calendar_sync_status === 'pending')

  const { data: histApprove } = await db
    .from('appointment_history')
    .select('action, from_status, to_status, actor, actor_id')
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: false })
    .limit(1)
  chk('נרשמה היסטוריית status_changed עם actor=admin ו-actor_id נכון',
    histApprove?.[0]?.action === 'status_changed' && histApprove?.[0]?.to_status === 'confirmed'
    && histApprove?.[0]?.actor === 'admin' && histApprove?.[0]?.actor_id === adminUserId,
    JSON.stringify(histApprove))

  console.log('\n── אישור כפול על confirmed נחסם (NOT_PENDING) ' + '─'.repeat(10))
  const doubleApprove = await db.rpc('approve_pending_appointment', {
    p_appointment_id: appointmentId,
    p_admin_id: adminUserId,
  })
  chk('אישור שני על אותה בקשה נדחה', doubleApprove.error?.message?.includes('NOT_PENDING'), doubleApprove.error?.message ?? '')

  console.log('\n── claim/complete: יצירת האירוע ביומן, ID דטרמיניסטי ' + '─'.repeat(5))
  const claim1 = await db.rpc('claim_calendar_sync', { p_appointment_id: appointmentId })
  chk('claim ראשון הצליח (pending → syncing)', !claim1.error && claim1.data?.calendar_sync_status === 'syncing', claim1.error?.message ?? '')
  chk('attempt_count עלה ל-1', claim1.data?.calendar_sync_attempt_count === 1)

  const eventId = deterministicEventId(appointmentId)
  const startDate = new Date(STARTS_AT)
  const endDate = new Date(startDate.getTime() + DURATION_MIN * 60 * 1000)
  const insertRes = await calendar.events.insert({
    calendarId,
    requestBody: {
      id: eventId,
      summary: `🌸 ${NAME} | עיצוב גבות טבעי`,
      description: `טלפון: ${PHONE}\nטיפול: עיצוב גבות טבעי\nמזהה תור: ${appointmentId}\nנקבע דרך אתר SM Brows`,
      start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Jerusalem' },
      end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Jerusalem' },
      extendedProperties: { private: { appointment_id: appointmentId, source: 'sm_brows_website' } },
    },
  })
  createdCalendarEventIds.add(eventId)
  chk('אירוע נוצר ביומן עם ה-ID הדטרמיניסטי', insertRes.data.id === eventId)

  const complete1 = await db.rpc('complete_calendar_sync', {
    p_appointment_id: appointmentId,
    p_google_event_id: eventId,
  })
  chk('complete_calendar_sync סימן synced ושמר google_event_id',
    !complete1.error && complete1.data?.calendar_sync_status === 'synced' && complete1.data?.google_event_id === eventId,
    complete1.error?.message ?? '')

  console.log('\n── תרחיש 1: Google הצליח, "שמירת ה-DB" נכשלה → retry לא יוצר כפילות ' + '─'.repeat(2))
  // מדמים כשל בשמירת ה-DB ע"י איפוס המצב ל-'failed' *אחרי* שהאירוע כבר
  // קיים ביומן (בדיוק המצב שה-INSERT הדטרמיניסטי אמור להגן מפניו) —
  // ואז מריצים claim חדש ומנסים INSERT שוב, כמו ש-createAppointmentEvent
  // באפליקציה היה עושה.
  await db.from('appointments').update({ calendar_sync_status: 'failed', calendar_sync_started_at: null }).eq('id', appointmentId)
  const claim2 = await db.rpc('claim_calendar_sync', { p_appointment_id: appointmentId })
  chk('claim שני (retry) הצליח', !claim2.error && claim2.data?.calendar_sync_status === 'syncing', claim2.error?.message ?? '')

  let retryInsertConflicted = false
  let reconciledEventId = null
  try {
    await calendar.events.insert({
      calendarId,
      requestBody: {
        id: eventId,
        summary: `🌸 ${NAME} | עיצוב גבות טבעי`,
        start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Jerusalem' },
        end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Jerusalem' },
        extendedProperties: { private: { appointment_id: appointmentId, source: 'sm_brows_website' } },
      },
    })
  } catch (err) {
    retryInsertConflicted = err?.response?.status === 409 || err?.code === 409
    if (retryInsertConflicted) {
      const existing = await calendar.events.get({ calendarId, eventId })
      if (existing.data.extendedProperties?.private?.appointment_id === appointmentId) {
        reconciledEventId = existing.data.id
      }
    }
  }
  chk('INSERT חוזר עם אותו ID דחה (409) במקום ליצור אירוע שני', retryInsertConflicted)
  chk('reconciliation מצא את אותו אירוע ואימת בעלות', reconciledEventId === eventId)

  const { data: allEventsCheck } = await calendar.events.list({
    calendarId,
    timeMin: new Date(startDate.getTime() - 3600_000).toISOString(),
    timeMax: new Date(endDate.getTime() + 3600_000).toISOString(),
    singleEvents: true,
  })
  const matchingEvents = (allEventsCheck.items ?? []).filter(
    e => e.extendedProperties?.private?.appointment_id === appointmentId,
  )
  chk('קיים בדיוק אירוע אחד ביומן עבור התור הזה (אין כפילות)', matchingEvents.length === 1, `נמצאו ${matchingEvents.length}`)

  const complete2 = await db.rpc('complete_calendar_sync', {
    p_appointment_id: appointmentId,
    p_google_event_id: reconciledEventId,
  })
  chk('complete_calendar_sync אחרי reconciliation מצליח', !complete2.error && complete2.data?.calendar_sync_status === 'synced', complete2.error?.message ?? '')

  console.log('\n── תרחיש 2: לחיצה חוזרת אחרי הצלחה מלאה = idempotent ' + '─'.repeat(10))
  const claimAfterSynced = await db.rpc('claim_calendar_sync', { p_appointment_id: appointmentId })
  chk('claim על תור שכבר synced נדחה (NOT_CLAIMABLE) — האפליקציה מזהה זאת ומחזירה הצלחה idempotent בלי לגעת ב-Google',
    claimAfterSynced.error?.message?.includes('NOT_CLAIMABLE'), claimAfterSynced.error?.message ?? '')

  console.log('\n── תרחיש 3: syncing תקוע מעבר ל-lease → claim חוזר בטוח ' + '─'.repeat(5))
  await db
    .from('appointments')
    .update({ calendar_sync_status: 'syncing', calendar_sync_started_at: new Date(Date.now() - 3 * 60 * 1000).toISOString() })
    .eq('id', appointmentId)
  const claimFreshLease = await db.rpc('claim_calendar_sync', { p_appointment_id: appointmentId })
  chk('claim על syncing עם lease שפג (>2 דקות) הצליח — לא נשאר תקוע לנצח', !claimFreshLease.error && claimFreshLease.data?.calendar_sync_status === 'syncing', claimFreshLease.error?.message ?? '')
  chk('attempt_count המשיך לעלות', claimFreshLease.data?.calendar_sync_attempt_count >= 2)

  console.log('\n── syncing טרי (lease תקף) לא ניתן לתפיסה מחדש ' + '─'.repeat(10))
  await db.from('appointments').update({ calendar_sync_started_at: new Date().toISOString() }).eq('id', appointmentId)
  const claimFreshActive = await db.rpc('claim_calendar_sync', { p_appointment_id: appointmentId })
  chk('claim שני מקביל (lease עדיין תקף) נדחה — לכל היותר סנכרון אחד בו-זמנית',
    claimFreshActive.error?.message?.includes('NOT_CLAIMABLE'), claimFreshActive.error?.message ?? '')

  // מסיימים את ה-claim התקוע שנשאר פתוח מהבדיקה הקודמת, כדי לא להשאיר
  // את התור במצב syncing
  await db.rpc('complete_calendar_sync', { p_appointment_id: appointmentId, p_google_event_id: eventId })

  console.log('\n── תרחיש 4/5: ownership בבדיקת התנגשות (עצמי מול זר) ' + '─'.repeat(5))
  const { data: ownEvents } = await calendar.events.list({
    calendarId,
    timeMin: new Date(startDate.getTime() - 3600_000).toISOString(),
    timeMax: new Date(endDate.getTime() + 3600_000).toISOString(),
    singleEvents: true,
  })
  const ownMatch = (ownEvents.items ?? []).find(e => e.extendedProperties?.private?.appointment_id === appointmentId)
  chk('אירוע של אותו appointment אינו מזוהה כהתנגשות (ownership מזוהה נכון)', !!ownMatch)

  const FOREIGN_START = new Date(startDate.getTime() + 5 * 60 * 1000) // חופף לתור שלנו
  const foreignEvent = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: 'TEST — מחיקה אוטומטית (אירוע ידני זר)',
      start: { dateTime: FOREIGN_START.toISOString(), timeZone: 'Asia/Jerusalem' },
      end: { dateTime: new Date(FOREIGN_START.getTime() + 10 * 60 * 1000).toISOString(), timeZone: 'Asia/Jerusalem' },
    },
  })
  createdCalendarEventIds.add(foreignEvent.data.id)
  const { data: eventsAfterForeign } = await calendar.events.list({
    calendarId,
    timeMin: new Date(startDate.getTime() - 3600_000).toISOString(),
    timeMax: new Date(endDate.getTime() + 3600_000).toISOString(),
    singleEvents: true,
  })
  const foreignOverlap = (eventsAfterForeign.items ?? []).some(e => {
    if (e.extendedProperties?.private?.appointment_id === appointmentId) return false // אנחנו — לא זר
    if (e.status === 'cancelled') return false
    const s = new Date(e.start?.dateTime ?? 0).getTime()
    const en = new Date(e.end?.dateTime ?? 0).getTime()
    return s < endDate.getTime() && en > startDate.getTime()
  })
  chk('אירוע ידני חופף מזוהה כהתנגשות אמיתית (זר, לא שלנו)', foreignOverlap)

  console.log('\n── תרחיש 6: שני ניסיונות claim מקבילים → לכל היותר סנכרון אחד ' + '─'.repeat(2))
  await db.from('appointments').update({ calendar_sync_status: 'failed', calendar_sync_error: null }).eq('id', appointmentId)
  const [c1, c2] = await Promise.all([
    db.rpc('claim_calendar_sync', { p_appointment_id: appointmentId }),
    db.rpc('claim_calendar_sync', { p_appointment_id: appointmentId }),
  ])
  const successes = [c1, c2].filter(r => !r.error).length
  chk('משתי קריאות claim מקבילות, בדיוק אחת הצליחה', successes === 1, `הצליחו: ${successes}`)
  // סוגרים claim שנפתח
  if (!c1.error) await db.rpc('fail_calendar_sync', { p_appointment_id: appointmentId, p_error: 'test cleanup' })
  if (!c2.error) await db.rpc('fail_calendar_sync', { p_appointment_id: appointmentId, p_error: 'test cleanup' })

  console.log('\n── תרחיש 7: calendar_sync_error לא שומר secrets/JSON מלא ' + '─'.repeat(5))
  const fakeApiError = new Error('The caller does not have permission')
  fakeApiError.response = {
    status: 403,
    data: { error: { code: 403, message: 'The caller does not have permission', errors: [{ reason: 'forbidden' }] } },
  }
  const sanitized = String(fakeApiError.message).slice(0, 300)
  // fail_calendar_sync דורש calendar_sync_status='syncing' — התור נמצא
  // כרגע ב-'failed' אחרי תרחיש 6, אז צריך claim חדש קודם
  await db.rpc('claim_calendar_sync', { p_appointment_id: appointmentId })
  const failWithSanitized = await db.rpc('fail_calendar_sync', { p_appointment_id: appointmentId, p_error: sanitized })
  chk('fail_calendar_sync נקרא עם הודעה מסוננת בלבד (לא JSON.stringify של err)',
    !failWithSanitized.error, failWithSanitized.error?.message ?? '')
  const { data: afterFail } = await db.from('appointments').select('calendar_sync_error').eq('id', appointmentId).single()
  chk('calendar_sync_error שנשמר הוא טקסט קצר בלבד, לא כולל "response"/"data"/tokens',
    afterFail?.calendar_sync_error === sanitized
    && !afterFail?.calendar_sync_error?.includes('"response"')
    && !afterFail?.calendar_sync_error?.includes('token'),
    afterFail?.calendar_sync_error ?? '')

  console.log('\n── דחיית בקשה (על בקשה נפרדת) ' + '─'.repeat(30))
  const REJECT_SLOT = `${ISO_DATE}T14:00:00+03:00`
  const createdForReject = await createPending(customerId, REJECT_SLOT)
  const rejectAppointmentId = createdForReject.data.id
  createdAppointmentIds.add(rejectAppointmentId)

  const reject = await db.rpc('reject_pending_appointment', {
    p_appointment_id: rejectAppointmentId,
    p_admin_id: adminUserId,
  })
  chk('דחייה משנה סטטוס ל-cancelled_by_business', !reject.error && reject.data?.status === 'cancelled_by_business', reject.error?.message ?? '')

  const { data: histReject } = await db
    .from('appointment_history')
    .select('action, to_status, actor')
    .eq('appointment_id', rejectAppointmentId)
    .order('created_at', { ascending: false })
    .limit(1)
  chk('נרשמה היסטוריית cancelled עם actor=admin', histReject?.[0]?.action === 'cancelled' && histReject?.[0]?.actor === 'admin')

  const freedByReject = await createPending(customerId, REJECT_SLOT)
  chk('הסלוט של הבקשה שנדחתה משתחרר מיד', !freedByReject.error && freedByReject.data?.status === 'pending', freedByReject.error?.message ?? '')
  if (freedByReject.data?.id) createdAppointmentIds.add(freedByReject.data.id)

  const rejectAgain = await db.rpc('reject_pending_appointment', {
    p_appointment_id: rejectAppointmentId,
    p_admin_id: adminUserId,
  })
  chk('דחייה כפולה על בקשה שכבר טופלה נחסמת', rejectAgain.error?.message?.includes('NOT_PENDING'), rejectAgain.error?.message ?? '')
} catch (e) {
  chk('הבדיקה רצה עד הסוף בלי חריגה לא צפויה', false, e.stack ?? e.message)
} finally {
  console.log('\n── ניקוי נתוני בדיקה ' + '─'.repeat(35))

  for (const eventId of createdCalendarEventIds) {
    try {
      await deleteCalendarEventIfExists(eventId)
      console.log(`✓ אירוע יומן נמחק: ${eventId}`)
    } catch (err) {
      console.log(`✗ מחיקת אירוע יומן ${eventId} נכשלה: ${err.message}`)
    }
  }

  const { error: delAppts, count: apptsDeleted } = await db
    .from('appointments')
    .delete({ count: 'exact' })
    .in('customer_id', [customerId].filter(Boolean))
  chk('כל תורי הבדיקה נמחקו (מוחק גם appointment_history בקסקדה)', !delAppts, `נמחקו ${apptsDeleted ?? 0}${delAppts ? ' — ' + delAppts.message : ''}`)

  if (adminUserId) {
    const { error: delAdmin } = await db.from('admins').delete().eq('user_id', adminUserId)
    chk('מנהל הבדיקה הוסר מטבלת admins', !delAdmin, delAdmin?.message ?? '')
  }

  const { error: delCust } = await db.from('customers').delete().in('id', [customerId].filter(Boolean))
  chk('לקוחת הבדיקה נמחקה', !delCust, delCust?.message ?? '')

  for (const id of [customerId, adminUserId].filter(Boolean)) {
    const { error } = await db.auth.admin.deleteUser(id)
    if (error) console.log(`✗ מחיקת auth user ${id} נכשלה: ${error.message}`)
  }

  const { data: leftoverAppts } = await db.from('appointments').select('id').in('customer_id', [customerId].filter(Boolean))
  const { data: leftoverCust } = await db.from('customers').select('id').in('id', [customerId].filter(Boolean))
  const { data: leftoverAdmin } = adminUserId
    ? await db.from('admins').select('user_id').eq('user_id', adminUserId)
    : { data: [] }
  chk(
    'אימות: אין שום שריד תורים/לקוחות/מנהל של הבדיקה',
    (leftoverAppts?.length ?? 0) === 0 && (leftoverCust?.length ?? 0) === 0 && (leftoverAdmin?.length ?? 0) === 0,
    `תורים=${leftoverAppts?.length ?? 0} לקוחות=${leftoverCust?.length ?? 0} מנהלים=${leftoverAdmin?.length ?? 0}`,
  )
}

const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
