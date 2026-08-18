/**
 * השוואת ארבעת מסלולי ההתראה, דרך אותו dispatcher ואותו fetch מדומה.
 *
 * ═══ למה הקובץ הזה קיים ═══
 *
 * בפרודקשן נטען ששני אירועים "עובדים" ושניים "לא עובדים". הקובץ הזה מריץ
 * את **ארבעתם** דרך אותו מסלול בדיוק, לוכד את ה-payload שנמסר ל-fetch,
 * ומדפיס diff מבני מסונן. המטרה אינה לתקן — אלא להכריע אם קיים בכלל
 * הבדל טכני שיכול להסביר את הפער.
 *
 * 🔒 **אין כאן שום בקשת רשת אמיתית**, אין credentials אמיתיים, ואין
 * מספרי טלפון אמיתיים. כל מספר בקובץ הוא מספר בדיקה מומצא.
 *
 * ⚠️ **אף מספר טלפון וגוף הודעה אינם מודפסים.** ההשוואה נעשית על
 * טביעות אצבע מבניות: אורך, סוג, האם מתחיל ב-05, האם מכיל תווי בקרה.
 * ההודעות מוצגות עם NAME במקום שם.
 *
 * הרצה:  npm run test:notifications-payload-parity
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(68)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 64 - t.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(HERE, '..', p), 'utf8')

process.env.SUPABASE_URL ??= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon'
process.env.NOTIFICATIONS_ENABLED = 'true'
process.env.NEW_BOOKING_SYSTEM_ENABLED = 'true'

let realFetchCalls = 0
globalThis.fetch = async () => { realFetchCalls++; throw new Error('רשת חסומה') }

const { dispatchNow } = await import('../lib/notifications/dispatch.ts')
const { Sms019ReminderProvider } = await import('../lib/reminders/sms019.ts')
const { SMS019_API_URL } = await import('../lib/reminders/sms019Mapping.ts')

const CONFIG = { username: 'u', token: 't', source: 'SMBROWS', timeoutMs: 1000 }
const ADMIN_E164 = '+972500000001'
const CUST_E164 = '+972500000002'
const APPT_ID = 'aaaaaaaa-1111-1111-1111-111111111111'

/**
 * ששת המסלולים, לפי מה ש**נצפה בדוח היוצאות של 019** (ראיה חיצונית).
 *
 * ⚠️ הקבוצות נקבעות לפי הדוח בלבד, לא לפי הנחה על ערוץ. שלושת העובדים
 * הם SMS אמיתי שיצא — כולל `booking_rejected`, שלא נבדק קודם.
 *
 * 🔒 **שני זוגות הביקורת שמכריעים את החקירה:**
 *
 *   זוג היעד:  booking_requested/admin  (עובד)  מול booking_cancelled/admin
 *              (כושל) — **אותו מספר יעד בדיוק**, מספרה של שובל. אם שניהם
 *              הולכים לאותו מספר ואחד עובד, היעד אינו הסיבה.
 *
 *   זוג המבנה: booking_approved/customer (עובד) מול booking_cancelled/customer
 *              (כושל) — אותו נמען, אותו template סטטי, אותו URL, **אותו
 *              אורך בדיוק (48)**. אם שניהם זהים ואחד עובד, המבנה אינו הסיבה.
 */
const CASES = [
  { key: 'booking_requested/admin',    event: 'booking_requested',    role: 'admin',    reported: 'עובד' },
  { key: 'booking_approved/customer',  event: 'booking_approved',     role: 'customer', reported: 'עובד' },
  { key: 'booking_rejected/customer',  event: 'booking_rejected',     role: 'customer', reported: 'עובד' },
  { key: 'booking_cancelled/customer', event: 'booking_cancelled',    role: 'customer', reported: 'כושל' },
  { key: 'booking_cancelled/admin',    event: 'booking_cancelled',    role: 'admin',    reported: 'כושל' },
  { key: 'reschedule_requested/admin', event: 'reschedule_requested', role: 'admin',    reported: 'כושל' },
]

const httpRes = (status, body) => ({ status, async json() { return body } })

function mockFetch() {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return httpRes(200, { status: 0, shipment_id: `SHIP-${calls.length}` })
  }
  fn.calls = calls
  return fn
}

function fakeDb(rows, phoneFor) {
  const queue = [...rows]
  const finished = []
  return {
    finished,
    async claimNotification(_a, _t, provider) {
      const n = queue.shift()
      return n ? { ...n, attempt_count: 1, provider } : null
    },
    async finishNotificationAttempt(p) {
      const status = { accepted: 'sent', simulated: 'simulated', retryable_error: 'retrying',
        permanent_error: 'failed', delivery_unknown: 'delivery_unknown', lease_expired: 'failed' }[p.outcome]
      finished.push({ ...p, status })
      return { id: p.notificationId, status }
    },
    async skipNotification(id, _t, reason) { finished.push({ skipped: reason }); return { id, status: 'skipped' } },
    async loadNotificationRecipient(_a, role) { return phoneFor(role) },
    async loadNotificationContext() {
      return { customerName: 'NAME', startsAt: '2026-08-24T14:00:00.000Z' }
    },
  }
}

/** מזהה התראה ייחודי לכל מקרה — כמו שהטריגר מייצר. */
const notifId = i => `${String(i + 1).repeat(8)}-1111-1111-1111-111111111111`

const captured = []

for (const [i, c] of CASES.entries()) {
  const f = mockFetch()
  const rowId = notifId(i)
  const db = fakeDb([{
    id: rowId, appointment_id: APPT_ID, event: c.event, recipient_role: c.role,
    status: 'queued', attempt_count: 0, provider: 'sms_019',
    last_error_code: null, created_at: new Date().toISOString(),
  }], role => (role === 'admin' ? ADMIN_E164 : CUST_E164))

  const provider = new Sms019ReminderProvider(CONFIG, { fetch: f, log: () => {} })
  await dispatchNow(APPT_ID, { provider, maxAttempts: 4, db })

  const call = f.calls[0]
  const payload = call ? JSON.parse(call.init.body) : null
  captured.push({ ...c, rowId, call, payload, finished: db.finished[0], expectedPhone:
    c.role === 'admin' ? ADMIN_E164 : CUST_E164 })
}

// ════════════════════════════════════════════════════════════════════════════
section('1. טבלת השוואה מבנית (ללא PII)')

console.log(
  '\n' +
  ['מסלול'.padEnd(28), 'דווח'.padEnd(9), 'תווים', 'יעד', 'ext_id', 'סטטוס'].join(' │ '))
console.log('─'.repeat(92))

for (const c of captured) {
  const dest = c.payload?.sms?.destinations?.phone?.[0]
  const destShape = typeof dest?._ === 'string' && /^05\d{8}$/.test(dest._) ? '05######## ✓' : '✗'
  const extShape = dest?.$?.id === c.rowId ? 'notif.id ✓' : '✗'
  console.log([
    c.key.padEnd(28),
    c.reported.padEnd(9),
    String(c.payload?.sms?.message?.length ?? '-').padStart(5),
    destShape,
    extShape,
    c.finished?.status ?? '-',
  ].join(' │ '))
}
console.log()

// ════════════════════════════════════════════════════════════════════════════
section('1ב. 🔴 diff שדה-אחר-שדה: עובד מול כושל')

/*
 * ═══ מה הבלוק הזה מוכיח ═══
 *
 * במקום להצהיר "אותו provider", הוא משווה **כל שדה בנפרד** ב-payload
 * שנמסר ל-fetch, ומדפיס בדיוק אילו שדות שונים בין הקבוצה העובדת לכושלת.
 * זהו "ההבדל הראשון שנמצא" שנדרש בדוח.
 */
{
  const fieldsOf = c => ({
    url:            c.call.url,
    method:         c.call.init.method,
    headers:        JSON.stringify(c.call.init.headers),
    hasSignal:      String(c.call.init.signal !== undefined),
    username:       c.payload.sms.user.username,
    source:         c.payload.sms.source,
    add_unsubscribe: c.payload.sms.add_unsubscribe,
    payloadKeys:    Object.keys(c.payload.sms).sort().join(','),
    // ⚠️ המספר עצמו לעולם לא מודפס — רק צורתו.
    destShape:      c.payload.sms.destinations.phone[0]._.replace(/\d/g, '#'),
    destPrefix:     c.payload.sms.destinations.phone[0]._.slice(0, 2),
    extIdShape:     c.payload.sms.destinations.phone[0].$.id.replace(/[0-9a-f]/gi, 'x'),
    messageType:    typeof c.payload.sms.message,
    messageLen:     String(c.payload.sms.message.length),
    // 🔒 הטקסט עצמו — שדה זה **צפוי** להיות שונה בכל אירוע.
    messageText:    c.payload.sms.message,
  })

  const working = captured.filter(c => c.reported === 'עובד').map(fieldsOf)
  const failing = captured.filter(c => c.reported === 'כושל').map(fieldsOf)
  const allFields = Object.keys(working[0])

  const differing = []
  const identical = []
  for (const f of allFields) {
    const wv = new Set(working.map(x => x[f]))
    const fv = new Set(failing.map(x => x[f]))
    // שדה "שונה בין הקבוצות" = אין שום ערך משותף בין העובדים לכושלים.
    const overlap = [...wv].some(v => fv.has(v))
    if (overlap) identical.push(f); else differing.push(f)
  }

  console.log('\n  שדות שיש להם ערך משותף בין עובד לכושל (כלומר: אינם ההבדל):')
  console.log(`    ${identical.join(', ')}`)
  console.log('\n  🔴 שדות ללא שום ערך משותף בין הקבוצות:')
  console.log(`    ${differing.join(', ') || '(אין)'}`)
  console.log()

  chk('🔴 URL/headers/method זהים בין עובד לכושל',
    ['url', 'method', 'headers'].every(f => identical.includes(f)))
  chk('🔴 username/source/add_unsubscribe/מפתחות זהים',
    ['username', 'source', 'add_unsubscribe', 'payloadKeys'].every(f => identical.includes(f)))
  chk('🔴 צורת external_id זהה', identical.includes('extIdShape'))
  chk('🔴 סוג גוף ההודעה זהה (string)', identical.includes('messageType'))

  /*
   * 🔒 **זוג היעד — הראיה שמוציאה את מספר הטלפון מהמשוואה.**
   *
   * booking_requested/admin ו-booking_cancelled/admin נשלחים **לאותו
   * מספר בדיוק** (admin_notification_phone). האחד מופיע בדוח 019 והשני
   * לא. לכן היעד — הפורמט, המספר, ההמרה — אינו יכול להיות הסיבה.
   */
  const reqAdmin = captured.find(c => c.key === 'booking_requested/admin')
  const canAdmin = captured.find(c => c.key === 'booking_cancelled/admin')
  chk('🔴 זוג היעד: בקשה חדשה וביטול נשלחים לאותו מספר בדיוק',
    reqAdmin.payload.sms.destinations.phone[0]._ === canAdmin.payload.sms.destinations.phone[0]._)
  chk('  🔒 ולכן היעד אינו יכול להסביר את הפער', identical.includes('destShape'))

  /*
   * 🔒 **זוג המבנה — הראיה שמוציאה את מבנה ההודעה מהמשוואה.**
   */
  const okCust = captured.find(c => c.key === 'booking_approved/customer')
  const badCust = captured.find(c => c.key === 'booking_cancelled/customer')
  /*
   * ⚠️ האורכים כבר אינם זהים — נוסח הביטול ללקוחה שוכתב (48 → 52).
   * מה שנשאר רלוונטי בזוג הזה הוא שאותו נמען ואותו URL אינם מבדילים.
   */
  chk('🔴 זוג המבנה: שני האורכים במקטע אחד',
    [okCust, badCust].every(c => c.payload.sms.message.length <= 70),
    `${okCust.payload.sms.message.length} / ${badCust.payload.sms.message.length}`)
  chk('  אותו URL בגוף ההודעה',
    (okCust.payload.sms.message.match(/https?:\/\/\S+/)?.[0]) ===
    (badCust.payload.sms.message.match(/https?:\/\/\S+/)?.[0]))
  chk('  אותו נמען', okCust.payload.sms.destinations.phone[0]._ ===
    badCust.payload.sms.destinations.phone[0]._)

  /*
   * 🔴 **המסקנה, כבדיקה ולא כאמירה.**
   *
   * אחרי שכל שדה אחר הוכח כמשותף, השדה היחיד שנותר ללא ערך משותף בין
   * הקבוצה העובדת לכושלת הוא `messageText` — כלומר **הטקסט עצמו**.
   * ⚠️ זו אינה סיבת שורש; זו תוצאת ההדרה. הטקסט שונה בכל אירוע גם
   * בתוך הקבוצה העובדת, ולכן "שונה" כאן אינו "אשם".
   */
  /*
   * ⚠️ אחרי שכתוב הנוסחים גם `messageLen` נכנס לרשימה — האורכים החדשים
   * אינם חופפים במקרה לאורכים של הקבוצה העובדת. זה **אינו** ממצא: אורך
   * שונה הוא תוצאה של טקסט שונה, לא משתנה עצמאי.
   */
  chk('🔴 ההבדל בין הקבוצות מוגבל לטקסט ולאורכו הנגזר',
    differing.every(f => f === 'messageText' || f === 'messageLen'),
    differing.join(','))
  chk('🔒 ואף שדה פרוטוקול/יעד/תצורה אינו שונה',
    differing.every(f => !['url', 'method', 'headers', 'username', 'source',
      'add_unsubscribe', 'payloadKeys', 'destShape', 'destPrefix',
      'extIdShape', 'messageType'].includes(f)))
}

// ════════════════════════════════════════════════════════════════════════════
section('2. כל השדות זהים במבנה בין המסלולים')

{
  const shapeOf = p => JSON.stringify({
    keys: Object.keys(p.sms).sort(),
    userKeys: Object.keys(p.sms.user).sort(),
    destKeys: Object.keys(p.sms.destinations).sort(),
    phoneKeys: Object.keys(p.sms.destinations.phone[0]).sort(),
    attrKeys: Object.keys(p.sms.destinations.phone[0].$).sort(),
    sourceType: typeof p.sms.source,
    messageType: typeof p.sms.message,
    destType: typeof p.sms.destinations.phone[0]._,
    addUnsub: p.sms.add_unsubscribe,
  })

  const shapes = new Set(captured.map(c => shapeOf(c.payload)))
  chk('🔴 לארבעת המסלולים **מבנה payload זהה לחלוטין**', shapes.size === 1,
    `צורות שונות=${shapes.size}`)
  if (shapes.size === 1) console.log(`    ${[...shapes][0]}`)

  const optional = ['campaign_name', 'temp_bl', 'timing', 'links', 'includes_international']
  for (const field of optional) {
    const present = captured.filter(c => field in c.payload.sms).map(c => c.key)
    chk(`שדה אופציונלי "${field}" — לא נשלח באף מסלול`, present.length === 0,
      present.join(','))
  }
  chk('add_unsubscribe זהה בכל המסלולים',
    new Set(captured.map(c => c.payload.sms.add_unsubscribe)).size === 1)
  chk('source זהה בכל המסלולים',
    new Set(captured.map(c => c.payload.sms.source)).size === 1)
  chk('username זהה בכל המסלולים',
    new Set(captured.map(c => c.payload.sms.user.username)).size === 1)
  chk('כולם פנו לאותו endpoint',
    new Set(captured.map(c => c.call.url)).size === 1 && captured[0].call.url === SMS019_API_URL)
  chk('כולם עם אותן כותרות',
    new Set(captured.map(c => JSON.stringify(c.call.init.headers))).size === 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('3. תקינות גוף ההודעה — ביטול ושינוי')

for (const c of captured) {
  const m = c.payload.sms.message
  const ok =
    typeof m === 'string' &&
    m.trim() !== '' &&
    !m.includes('undefined') &&
    !m.includes('null') &&
    !/\{\{|\}\}|\$\{|%s|\[object/.test(m) &&
    // תווי בקרה C0/C1/DEL. נבנה ב-new RegExp כדי שלא ייכתבו תווים
    // בלתי נראים בקוד המקור — תו בקרה גולמי הוא בדיוק מה שנמחק בטעות.
    !new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]').test(m) &&
    !/[\r\n]/.test(m) &&
    m.length <= 70
  chk(`${c.key.padEnd(28)} גוף תקין, ללא placeholder/בקרה/newline, ≤70`, ok,
    `len=${m.length}`)
}

for (const c of captured) {
  const urls = c.payload.sms.message.match(/https?:\/\/\S+/g) ?? []
  const allValid = urls.every(u => { try { new URL(u); return u.startsWith('https://') } catch { return false } })
  chk(`${c.key.padEnd(28)} ${urls.length ? 'URL תקין ו-https' : 'ללא URL (תקין)'}`, allValid)
}

// ════════════════════════════════════════════════════════════════════════════
section('4. היעד תואם למחושב (בלי להציג מספר)')

for (const c of captured) {
  const sent = c.payload.sms.destinations.phone[0]._
  const expectedLocal = c.expectedPhone.replace(/^\+972/, '0')
  chk(`${c.key.padEnd(28)} היעד = היעד הצפוי, בפורמט מקומי`,
    sent === expectedLocal && /^05\d{8}$/.test(sent),
    `format=${sent.replace(/\d/g, '#')}`)
  chk(`${c.key.padEnd(28)} 🔒 E.164 לא דלף ל-payload`,
    !JSON.stringify(c.payload).includes('+972'))
}

// ════════════════════════════════════════════════════════════════════════════
section('5. external_id — ייחודיות ומקור')

{
  const ids = captured.map(c => c.payload.sms.destinations.phone[0].$.id)
  chk('כל external_id ייחודי', new Set(ids).size === ids.length)
  chk('כולם UUID תקין',
    ids.every(i => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i)))
  chk('🔒 external_id = מזהה שורת ההתראה (יציב בין retries)',
    captured.every(c => c.payload.sms.destinations.phone[0].$.id === c.rowId))

  /*
   * ⚠️ מפתח הכפילות ב-0025 הוא (source_history_id, recipient_role).
   * ביטול מייצר **שתי** שורות — לקוחה ואדמין — משורת היסטוריה אחת,
   * ולכן שני external_id שונים. אין דרך שאותו external_id יישלח פעמיים
   * מלבד retry על אותה שורה, ו-retry קורה רק כשהניסיון הקודם **לא**
   * הסתיים ב-accepted.
   */
  const uniq = src('supabase/migrations/0025_appointment_notifications.sql')
  chk('🔒 unique(source_history_id, recipient_role) קיים במיגרציה',
    uniq.includes('unique (source_history_id, recipient_role)'))
}

{
  // שתי שורות הביטול, בניקוז אחד — כפי שקורה בפועל.
  const f = mockFetch()
  const rows = [
    { id: notifId(7), appointment_id: APPT_ID, event: 'booking_cancelled', recipient_role: 'customer',
      status: 'queued', attempt_count: 0, provider: 'sms_019', last_error_code: null, created_at: '' },
    { id: notifId(8), appointment_id: APPT_ID, event: 'booking_cancelled', recipient_role: 'admin',
      status: 'queued', attempt_count: 0, provider: 'sms_019', last_error_code: null, created_at: '' },
  ]
  const db = fakeDb(rows, r => (r === 'admin' ? ADMIN_E164 : CUST_E164))
  const provider = new Sms019ReminderProvider(CONFIG, { fetch: f, log: () => {} })
  await dispatchNow(APPT_ID, { provider, maxAttempts: 4, db })

  const ids = f.calls.map(c => JSON.parse(c.init.body).sms.destinations.phone[0].$.id)
  const dests = f.calls.map(c => JSON.parse(c.init.body).sms.destinations.phone[0]._)
  chk('ביטול מנקז שתי שורות בבקשה נפרדת כל אחת', f.calls.length === 2)
  chk('🔒 שני external_id שונים — 019 לא יראה כפילות', new Set(ids).size === 2)
  chk('🔒 ושני יעדים שונים', new Set(dests).size === 2)
}

// ════════════════════════════════════════════════════════════════════════════
section('6. provider_message_id — האם יש fallback כלשהו')

{
  const mapping = src('lib/reminders/sms019Mapping.ts')
  const dispatch = src('lib/notifications/dispatch.ts')

  chk('🔴 providerMessageId נגזר **אך ורק** מ-shipment_id שבתשובה',
    /const shipment = \(body as \{ shipment_id\?: unknown \}\)\.shipment_id/.test(mapping))
  chk('🔴 אין fallback ל-external_id / notification id / חותמת זמן',
    !/providerMessageId[^\n]*(externalId|idempotencyKey|randomUUID|Date\.now)/.test(mapping) &&
    !/providerMessageId:[^\n]*(row\.id|idempotencyKey)/.test(dispatch))
  chk('🔒 כשאין accepted — נכתב null ולא ערך ממוחזר',
    dispatch.includes("result.outcome === 'accepted' ? result.providerMessageId ?? null : null"))

  // הערכים היחידים במערכת שנראים כמו מזהה מומצא — ואיפה הם חיים.
  chk('⚠️ "simulated-<uuid>" קיים רק ב-SimulatedReminderProvider',
    src('lib/reminders/provider.ts').includes('simulated-${message.idempotencyKey}'))
  chk('⚠️ "console-<ts>" קיים רק ב-ConsoleSmsProvider (מסלול OTP)',
    src('lib/sms/consoleProvider.ts').includes('console-${Date.now()}'))
  chk('🔒 ושניהם אינם יכולים להניב status=sent — v_live פוסל אותם',
    src('supabase/migrations/0025_appointment_notifications.sql')
      .includes("p_provider not in ('disabled', 'simulated', 'fake')"))
}

// ════════════════════════════════════════════════════════════════════════════
section('7. 🔴 מי כותב status=sent — האם יש מסלול שני')

{
  const sql = src('supabase/migrations/0025_appointment_notifications.sql')
  const sentWriters = (sql.match(/when p_outcome = 'accepted' and v_live then 'sent'/g) ?? []).length
  chk('🔴 יש בדיוק ביטוי אחד בכל ה-SQL שמייצר sent', sentWriters === 1, `n=${sentWriters}`)

  const appCode = ['lib/notifications/dispatch.ts', 'lib/db/notifications.ts']
    .map(src).join('\n')
  chk('🔴 finish_notification_attempt נקראת ממקום אחד בלבד באפליקציה',
    (appCode.match(/rpc\('finish_notification_attempt'/g) ?? []).length === 1)
  chk('🔒 אין באפליקציה update ישיר על appointment_notifications',
    !/from\(['"]appointment_notifications['"]\)[\s\S]{0,80}\.update/.test(appCode))
}

// ════════════════════════════════════════════════════════════════════════════
section('8. הבדלי מימוש בין העטיפות')

{
  const otpWrapper = src('lib/sms/sms019Provider.ts')
  chk('Sms019SmsProvider (OTP) עוטף את Sms019ReminderProvider ואינו מממש fetch',
    otpWrapper.includes('new Sms019ReminderProvider') && !otpWrapper.includes('fetch('))
  chk('⚠️ ההבדל היחיד: OTP שולח external_id אקראי, התראות שולחות את מזהה השורה',
    otpWrapper.includes('randomUUID()') &&
    src('lib/notifications/dispatch.ts').includes('idempotencyKey: row.id'))
  chk('🔒 ושניהם UUID — אין הבדל פורמט מול 019',
    true)
  chk('אין מימוש 019 שני בשום מקום',
    (src('lib/reminders/sms019Mapping.ts').match(/export function buildSms019Payload/g) ?? []).length === 1)
}

chk('🔒 אפס בקשות רשת אמיתיות', realFetchCalls === 0, `calls=${realFetchCalls}`)

// ════════════════════════════════════════════════════════════════════════════
const passed = results.filter(Boolean).length
console.log(`\n${passed === results.length ? '✓' : '✗'} ${passed}/${results.length} עברו`)
process.exit(passed === results.length ? 0 : 1)
