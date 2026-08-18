/**
 * hotfix — מסלול ההתראות מקצה לקצה מול 019, עם fetch מדומה בלבד.
 *
 * ═══ למה הקובץ הזה נוסף ═══
 *
 * `test-notifications-core` בודק את ה-dispatcher מול ספק **מדומה**, ו-
 * `test-sms019` בודק את הספק מול fetch מדומה. אף אחד מהם לא חיבר את
 * השניים — ולכן אף בדיקה לא הוכיחה מה **באמת** נשלח לרשת כשלקוחה מבטלת
 * תור או מבקשת שינוי מועד, ואיזה סטטוס נרשם בעקבות התשובה.
 *
 * ⚠️ זה בדיוק התפר שבו התקלה חיה: `booking_cancelled` ו-
 * `reschedule_requested` נרשמו `sent` בזמן שההודעות לא הופיעו בדוח
 * ההודעות היוצאות של 019.
 *
 * 🔒 **אין כאן שום בקשת רשת אמיתית.** `fetch` מוזרק בכל מקרה בדיקה,
 * ובסוף הקובץ נאכף שה-`fetch` הגלובלי לא נגוע בכלל.
 *
 * ⚠️ אין כאן credentials אמיתיים, אין מספרי טלפון אמיתיים, ואף קובץ
 * `.env` אינו נקרא.
 *
 * הרצה:  npm run test:notifications-sms019
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(70)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(HERE, '..', p), 'utf8')

process.env.SUPABASE_URL ??= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon'

const { dispatchNow } = await import('../lib/notifications/dispatch.ts')
const { Sms019ReminderProvider } = await import('../lib/reminders/sms019.ts')
const { SMS019_API_URL } = await import('../lib/reminders/sms019Mapping.ts')

/*
 * 🔒 רשת אמיתית חסומה לחלוטין למשך הקובץ.
 *
 * ⚠️ זה אינו קישוט: כל מסלול שלא הזרקנו לו fetch נופל ל-`globalThis.fetch`,
 * ובדיקה שנוגעת בטעות ב-019 האמיתי הייתה שולחת SMS אמיתי. כאן היא פשוט
 * נופלת, וגם נספרת.
 */
let realFetchCalls = 0
globalThis.fetch = async () => {
  realFetchCalls++
  throw new Error('רשת אמיתית חסומה בבדיקה')
}

/*
 * 🔒 תצורה מומצאת לחלוטין. אינה נקראת מהסביבה ואינה נוגעת בחשבון אמיתי.
 * המספרים למטה הם מספרי בדיקה ואינם של איש.
 */
const CONFIG = { username: 'u', token: 't', source: 'SMBROWS', timeoutMs: 1000 }
const ADMIN_E164 = '+972500000001'
const ADMIN_LOCAL = '0500000001'
const CUST_E164 = '+972500000002'
const CUST_LOCAL = '0500000002'

const NOTIF_ID = '11111111-1111-1111-1111-111111111111'
const APPT_ID = 'aaaaaaaa-1111-1111-1111-111111111111'

/** תשובת HTTP מדומה. */
const httpRes = (status, body, { badJson = false } = {}) => ({
  status,
  async json() {
    if (badJson) throw new SyntaxError('bad json')
    return body
  },
})

/** fetch מדומה שסופר את הקריאות ואינו יוצא לרשת. */
function mockFetch(responder) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return typeof responder === 'function' ? responder(url, init) : responder
  }
  fn.calls = calls
  return fn
}

const ok019 = (shipment = 'SHIP-1') =>
  mockFetch(() => httpRes(200, { status: 0, shipment_id: shipment }))

/** ה-DB המדומה של ה-dispatcher — סופר את הסטטוס שנרשם בפועל. */
function fakeDb(rows, phoneFor) {
  const queue = [...rows]
  const finished = []
  const skipped = []
  return {
    finished,
    skipped,
    async claimNotification(appointmentId, leaseToken, provider) {
      const next = queue.shift()
      return next ? { ...next, attempt_count: 1, provider } : null
    },
    async finishNotificationAttempt(p) {
      // אותו מיפוי בדיוק כמו finish_notification_attempt ב-0025, עבור ספק חי.
      const status = {
        accepted: 'sent', simulated: 'simulated', retryable_error: 'retrying',
        permanent_error: 'failed', delivery_unknown: 'delivery_unknown',
        lease_expired: 'failed',
      }[p.outcome]
      finished.push({ outcome: p.outcome, errorCode: p.errorCode, status,
        providerMessageId: p.providerMessageId })
      return { id: p.notificationId, status }
    },
    async skipNotification(id, leaseToken, reason) {
      skipped.push(reason)
      return { id, status: 'skipped' }
    },
    async loadNotificationRecipient(appointmentId, role) {
      return phoneFor(role)
    },
    async loadNotificationContext() {
      return { customerName: 'דנה כהן', startsAt: '2026-08-24T14:00:00.000Z' }
    },
  }
}

const row = over => ({
  id: NOTIF_ID,
  appointment_id: APPT_ID,
  event: 'booking_cancelled',
  recipient_role: 'admin',
  status: 'queued',
  attempt_count: 0,
  provider: 'sms_019',
  last_error_code: null,
  created_at: new Date().toISOString(),
  ...over,
})

process.env.NOTIFICATIONS_ENABLED = 'true'
process.env.NEW_BOOKING_SYSTEM_ENABLED = 'true'

/** מריץ ניקוז אחד מול ספק 019 אמיתי עם fetch מדומה. */
async function run(rows, fetchImpl, phoneFor = () => ADMIN_E164) {
  const db = fakeDb(rows, phoneFor)
  const provider = new Sms019ReminderProvider(CONFIG, { fetch: fetchImpl, log: () => {} })
  const stats = await dispatchNow(APPT_ID, { provider, maxAttempts: 4, db })
  return { db, stats, fetchImpl }
}

const payloadOf = fetchImpl => JSON.parse(fetchImpl.calls[0].init.body)

// ════════════════════════════════════════════════════════════════════════════
section('1. payload של ביטול — פורמט יעד חוקי של 019')

{
  const f = ok019()
  const { db } = await run([row({ event: 'booking_cancelled', recipient_role: 'admin' })], f)
  const p = payloadOf(f)
  const dest = p.sms.destinations.phone[0]

  chk('נשלחה בקשה אחת בדיוק', f.calls.length === 1)
  chk('🔒 הכתובת היא ה-endpoint של הפרודקשן', f.calls[0].url === SMS019_API_URL)
  chk('🔴 היעד בפורמט המקומי של 019 (05xxxxxxxx)', dest._ === ADMIN_LOCAL, dest._)
  chk('🔴 היעד **אינו** E.164 עם +972', !String(dest._).startsWith('+'))
  chk('🔴 external_id = מזהה ההתראה', dest.$.id === NOTIF_ID, dest.$.id)
  chk('source מהתצורה', p.sms.source === CONFIG.source)
  chk('username מהתצורה', p.sms.user.username === CONFIG.username)
  chk('add_unsubscribe כבוי (הודעה תפעולית, לא דיוור)', p.sms.add_unsubscribe === '0')
  chk('Content-Type הוא JSON', f.calls[0].init.headers['Content-Type'] === 'application/json')
  chk('Authorization הוא Bearer', f.calls[0].init.headers.Authorization.startsWith('Bearer '))
  chk('גוף ההודעה ≤70 תווים (מקטע יחיד בעברית)', p.sms.message.length <= 70,
    `len=${p.sms.message.length}`)
  chk('נרשם sent על תשובה תקינה', db.finished[0]?.status === 'sent')
  chk('ומזהה המשלוח נשמר', db.finished[0]?.providerMessageId === 'SHIP-1')
}

// ════════════════════════════════════════════════════════════════════════════
section('2. payload של בקשת שינוי מועד')

{
  const f = ok019('SHIP-2')
  const { db } = await run([row({ event: 'reschedule_requested', recipient_role: 'admin' })], f)
  const p = payloadOf(f)
  const dest = p.sms.destinations.phone[0]

  chk('🔴 היעד בפורמט המקומי של 019', dest._ === ADMIN_LOCAL, dest._)
  chk('🔴 external_id = מזהה ההתראה', dest.$.id === NOTIF_ID)
  chk('🔴 הנוסח הוא הסטטי החדש, ללא שם לקוחה',
    p.sms.message === 'לקוחה ביקשה לשנות מועד. לניהול: https://smbrows.co.il/admin',
    p.sms.message)
  chk('גוף ההודעה ≤70 תווים', p.sms.message.length <= 70, `len=${p.sms.message.length}`)
  chk('נרשם sent על תשובה תקינה', db.finished[0]?.status === 'sent')
}

// ════════════════════════════════════════════════════════════════════════════
section('3. גם היעד של הלקוחה מומר נכון')

{
  const f = ok019('SHIP-3')
  await run([row({ event: 'booking_cancelled', recipient_role: 'customer' })], f,
    () => CUST_E164)
  const dest = payloadOf(f).sms.destinations.phone[0]
  chk('🔴 טלפון הלקוחה בפורמט המקומי', dest._ === CUST_LOCAL, dest._)
  chk('🔒 נוסח הלקוחה סטטי וללא PII',
    payloadOf(f).sms.message === 'התור שלך בוטל. לפרטים: https://smbrows.co.il/account',
    payloadOf(f).sms.message)
}

// ════════════════════════════════════════════════════════════════════════════
section('4. 🔴 חוזה ההצלחה — status:0 **וגם** shipment_id')

{
  const f = ok019('SHIP-OK')
  const { db, stats } = await run([row()], f)
  chk('200 + status:0 + shipment_id → accepted/sent',
    db.finished[0]?.outcome === 'accepted' && db.finished[0]?.status === 'sent')
  chk('ונספר כ-sent בסטטיסטיקה', stats.sent === 1)
}

{
  /*
   * 🔴 **המקרה שגרם לתקלה.** לפני התיקון זה נרשם `sent`.
   */
  const f = mockFetch(() => httpRes(200, { status: 0 }))
  const { db, stats } = await run([row()], f)
  chk('🔴 200 + status:0 **בלי** shipment_id → אינו accepted',
    db.finished[0]?.outcome !== 'accepted', db.finished[0]?.outcome)
  chk('🔴 ואינו נרשם sent', db.finished[0]?.status !== 'sent', db.finished[0]?.status)
  chk('  מסווג כ-delivery_unknown', db.finished[0]?.status === 'delivery_unknown')
  chk('  עם קוד ייעודי שניתן לאיתור',
    db.finished[0]?.errorCode === 'sms019_accepted_without_shipment_id',
    db.finished[0]?.errorCode)
  chk('  ו-sent בסטטיסטיקה נשאר אפס', stats.sent === 0)
  chk('🔒 ואינו הופך ל-retry (אין SMS שני על חשבון הלקוחה)', stats.retrying === 0)
}

{
  const f = mockFetch(() => httpRes(200, { status: 4 }))
  const { db } = await run([row()], f)
  chk('🔴 200 + status לא-אפס → אינו accepted', db.finished[0]?.outcome !== 'accepted')
  chk('  יתרה חסרה (4) → failed עם קוד מדויק',
    db.finished[0]?.status === 'failed' &&
    db.finished[0]?.errorCode === 'sms019_insufficient_credit_4', db.finished[0]?.errorCode)
}

{
  const f = mockFetch(() => httpRes(200, { status: 515 }))
  const { db } = await run([row()], f)
  chk('🔴 source לא מאומת (515) → failed, לא sent',
    db.finished[0]?.status === 'failed' &&
    db.finished[0]?.errorCode === 'sms019_unverified_source_515')
}

for (const [name, body, opts] of [
  ['גוף ריק', {}, {}],
  ['גוף null', null, {}],
  ['JSON פגום', null, { badJson: true }],
  ['status לא מספרי', { status: 'ok' }, {}],
]) {
  const f = mockFetch(() => httpRes(200, body, opts))
  const { db } = await run([row()], f)
  chk(`🔴 200 עם ${name} → אינו accepted ואינו sent`,
    db.finished[0]?.outcome !== 'accepted' && db.finished[0]?.status !== 'sent',
    db.finished[0]?.status)
}

// ════════════════════════════════════════════════════════════════════════════
section('5. מדיניות ה-HTTP הקיימת לא השתנתה')

{
  const f = mockFetch(() => httpRes(429, {}))
  const { db, stats } = await run([row()], f)
  chk('429 → retryable (הוכח שנדחה לפני שליחה)',
    db.finished[0]?.outcome === 'retryable_error' && stats.retrying === 1,
    db.finished[0]?.errorCode)
}

for (const status of [500, 502, 503]) {
  const f = mockFetch(() => httpRes(status, {}))
  const { db } = await run([row()], f)
  chk(`${status} → delivery_unknown, לא sent`,
    db.finished[0]?.outcome === 'delivery_unknown' && db.finished[0]?.status !== 'sent')
}

for (const status of [400, 401, 403, 404]) {
  const f = mockFetch(() => httpRes(status, {}))
  const { db } = await run([row()], f)
  chk(`${status} → permanent/failed`,
    db.finished[0]?.outcome === 'permanent_error' && db.finished[0]?.status === 'failed')
}

// ════════════════════════════════════════════════════════════════════════════
section('6. 🔒 דחיית הספק לעולם אינה משאירה sent')

{
  let anySent = false
  const cases = [
    ['status:0 בלי shipment', () => httpRes(200, { status: 0 })],
    ['status 4', () => httpRes(200, { status: 4 })],
    ['status 998', () => httpRes(200, { status: 998 })],
    ['גוף פגום', () => httpRes(200, null, { badJson: true })],
    ['HTTP 429', () => httpRes(429, {})],
    ['HTTP 500', () => httpRes(500, {})],
    ['HTTP 403', () => httpRes(403, {})],
    ['fetch זרק', () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }) }],
  ]
  for (const [name, responder] of cases) {
    const { db } = await run([row()], mockFetch(responder))
    const st = db.finished[0]?.status
    if (st === 'sent') anySent = true
    chk(`  ${name} → ${st ?? '(ללא)'}`, st !== 'sent', st)
  }
  chk('🔴 אף אחד ממצבי הדחייה אינו נרשם sent', !anySent)
}

{
  // יעד פסול נעצר מקומית — מוכח שלא יצאה בקשה.
  const f = ok019()
  const { db } = await run([row()], f, () => '+15551234567')
  chk('🔒 יעד לא ישראלי → permanent, ואפס בקשות רשת',
    db.finished[0]?.outcome === 'permanent_error' && f.calls.length === 0,
    db.finished[0]?.errorCode)
}

// ════════════════════════════════════════════════════════════════════════════
section('7. 🔒 המסלולים שעובדים לא נפגעו')

{
  // OTP — אותו ספק פנימי, אותו serializer, דרך המתאם של lib/sms.
  const f = ok019('SHIP-OTP')
  const { Sms019SmsProvider } = await import('../lib/sms/sms019Provider.ts')
  const otp = new Sms019SmsProvider(CONFIG, { fetch: f, log: () => {} })
  const r = await otp.send({ to: CUST_E164, body: 'קוד: 123456', kind: 'otp' })
  const dest = payloadOf(f).sms.destinations.phone[0]

  chk('OTP עדיין ok על תשובה תקינה', r.ok === true && !r.notDelivered)
  chk('OTP משתמש באותו פורמט יעד מקומי', dest._ === CUST_LOCAL)
  chk('🔒 external_id של OTP אינו מזהה ההתראה ואינו הטלפון',
    dest.$.id !== NOTIF_ID && dest.$.id !== CUST_E164 && dest.$.id !== CUST_LOCAL)
}

{
  // 🔒 השינוי אינו הופך OTP לכשל: delivery_unknown → ok:true, uncertain.
  const f = mockFetch(() => httpRes(200, { status: 0 }))
  const { Sms019SmsProvider } = await import('../lib/sms/sms019Provider.ts')
  const otp = new Sms019SmsProvider(CONFIG, { fetch: f, log: () => {} })
  const r = await otp.send({ to: CUST_E164, body: 'קוד: 123456', kind: 'otp' })
  chk('🔒 OTP: תשובה בלי shipment_id → ok:true + uncertain (הלקוחה אינה נענשת)',
    r.ok === true && r.uncertain === true && !r.notDelivered)
  chk('  ושורת הקוד אינה נמחקת', r.notDelivered !== true)
}

{
  // בקשת תור חדשה ואישור תור — אותו dispatcher, אותו ספק.
  for (const [event, role] of [['booking_requested', 'admin'], ['booking_approved', 'customer']]) {
    const f = ok019(`SHIP-${event}`)
    const { db } = await run([row({ event, recipient_role: role })], f,
      () => (role === 'admin' ? ADMIN_E164 : CUST_E164))
    chk(`${event}/${role} עדיין נשלח ונרשם sent`, db.finished[0]?.status === 'sent',
      db.finished[0]?.status)
    chk(`  ובפורמט יעד מקומי`,
      payloadOf(f).sms.destinations.phone[0]._ === (role === 'admin' ? ADMIN_LOCAL : CUST_LOCAL))
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('8. 🔒 פרטיות ורשת')

{
  const mapping = src('lib/reminders/sms019Mapping.ts')
  // ⚠️ המחרוזת עצמה מופיעה בהערה ("אין SMS019_BASE_URL"), ולכן נבדקת
  // ה*קריאה* מהסביבה ולא אזכור הטקסט.
  chk('🔒 הכתובת קבועה בקוד ואינה נקראת מהסביבה',
    !/env[.[]/.test(mapping) && mapping.includes("'https://019sms.co.il/api'"))
  chk('🔒 הקוד החדש אינו מדפיס את גוף התשובה',
    !/console\.(log|error|warn|info)/.test(mapping))

  const provider = src('lib/reminders/sms019.ts')
  chk('🔒 שורת הלוג של הספק מכילה מזהים בלבד',
    provider.includes('outcome=${result.outcome}') &&
    !provider.includes('${message.to}') &&
    !provider.includes('${message.body}'))

  chk('🔒 קוד השגיאה החדש עומד ב-CHECK של ה-DB',
    /^[a-z0-9_]{1,60}$/.test('sms019_accepted_without_shipment_id'))
  chk('🔒 והוא מתורגם לעברית במסך הניהול',
    src('lib/admin/format.ts').includes('sms019_accepted_without_shipment_id'))
}

chk('🔒 fetch הגלובלי לא נקרא אף פעם — אפס בקשות רשת אמיתיות',
  realFetchCalls === 0, `calls=${realFetchCalls}`)

// ════════════════════════════════════════════════════════════════════════════
const passed = results.filter(Boolean).length
console.log(`\n${passed === results.length ? '✓' : '✗'} ${passed}/${results.length} עברו`)
process.exit(passed === results.length ? 0 : 1)
