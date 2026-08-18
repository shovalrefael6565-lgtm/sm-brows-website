/**
 * ההתנהגות של ארבע התבניות החדשות — נמען, ריבוי, וכפילות.
 *
 * ═══ מה נבדק כאן ולמה כאן ═══
 *
 * `test-message-templates` בודק את **הטקסט**. `test-notifications-core`
 * בודק את **מכונת השליחה**. הקובץ הזה בודק את מה שביניהם: מי מקבל מה,
 * כמה פעמים, ומה **לא** נשלח.
 *
 * ⚠️ "מה לא נשלח" הוא החצי החשוב: אישור בקשת שינוי מועד חייב להוציא
 * הודעה **אחת** ללקוחה, ואסור לו להוציא בנוסף את הודעת אישור התור
 * הרגילה. בדיקה שסופרת רק "נשלח" לא הייתה תופסת שתי הודעות.
 *
 * 🔒 אין כאן רשת, אין DB, אין credentials ואין SMS אמיתי. הספק מדומה
 * וסופר, וההבחנה של הטריגר נקראת מקוד ה-SQL עצמו.
 *
 * הרצה:  npm run test:notification-behavior
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

let realFetch = 0
globalThis.fetch = async () => { realFetch++; throw new Error('רשת חסומה') }

const { dispatchNow } = await import('../lib/notifications/dispatch.ts')
const { smsBodyFor, SMS_TEXT } = await import('../lib/messageTemplates.ts')

// ════════════════════════════════════════════════════════════════════════════
section('1. ארבע התבניות — התאמה תו-בתו')

/** 🔒 המקור הקנוני של הדוח. כל סטייה כאן היא שינוי בנוסח שיישלח. */
const REQUIRED = [
  ['ביטול תור — ללקוחה',        'booking_cancelled',    'customer',
    'התור שלך בוטל. לפרטים: https://smbrows.co.il/account'],
  ['ביטול תור — לשובל',          'booking_cancelled',    'admin',
    'לקוחה ביטלה תור. לניהול: https://smbrows.co.il/admin'],
  ['בקשת שינוי מועד — לשובל',    'reschedule_requested', 'admin',
    'לקוחה ביקשה לשנות מועד. לניהול: https://smbrows.co.il/admin'],
  ['אישור שינוי מועד — ללקוחה',  'reschedule_approved',  'customer',
    'שינוי המועד אושר. לפרטים: https://smbrows.co.il/account'],
]

for (const [label, event, role, expected] of REQUIRED) {
  const got = smsBodyFor(event, role)
  chk(`${label} — תו־בתו`, got === expected, got === expected ? '' : `בפועל: ${got}`)
}

// ════════════════════════════════════════════════════════════════════════════
section('2. 🔒 אין תווי בקרה, Bidi נסתר או תקלות טקסט')

/*
 * ⚠️ תווי Bidi הם הסיכון האמיתי בטקסט עברי שמעורב בו URL לטיני: RLM/LRM
 * ו-RLE/LRO אינם נראים בעורך, נספרים במקטע, ויכולים להפוך את הקישור
 * לבלתי לחיץ או להציג טקסט הפוך אצל הנמענת. תו כזה נדבק בקלות בהעתקה
 * מ-Word, מ-WhatsApp או מדפדפן.
 */
const BIDI = {
  'U+200E LRM': '‎', 'U+200F RLM': '‏',
  'U+202A LRE': '‪', 'U+202B RLE': '‫', 'U+202C PDF': '‬',
  'U+202D LRO': '‭', 'U+202E RLO': '‮',
  'U+2066 LRI': '⁦', 'U+2067 RLI': '⁧', 'U+2068 FSI': '⁨',
  'U+2069 PDI': '⁩', 'U+061C ALM': '؜',
}
const INVISIBLE = {
  'U+200B ZWSP': '​', 'U+200C ZWNJ': '‌', 'U+200D ZWJ': '‍',
  'U+FEFF BOM': '﻿', 'U+00A0 NBSP': ' ', 'U+2060 WJ': '⁠',
}
const CTRL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]')

const allPairs = []
for (const [event, byRole] of Object.entries(SMS_TEXT)) {
  for (const [role, body] of Object.entries(byRole ?? {})) allPairs.push([`${event}/${role}`, body])
}

for (const [label, body] of allPairs) {
  const bidi = Object.entries(BIDI).filter(([, ch]) => body.includes(ch)).map(([n]) => n)
  const inv = Object.entries(INVISIBLE).filter(([, ch]) => body.includes(ch)).map(([n]) => n)
  chk(`${label.padEnd(38)} ללא Bidi/בלתי־נראה/בקרה`,
    bidi.length === 0 && inv.length === 0 && !CTRL.test(body),
    [...bidi, ...inv].join(','))
}

for (const [, , , text] of REQUIRED) {
  chk(`תקינות טקסט: ${text.slice(0, 22)}…`,
    text === text.trim() &&
    !/\s{2,}/.test(text) &&
    text.normalize('NFC') === text &&
    /^https:\/\/[^\s]+$/.test(text.split(' ').at(-1)) &&
    text.length <= 70)
}

// ════════════════════════════════════════════════════════════════════════════
section('3. הנמען הנכון לכל הודעה')

chk('🔒 ביטול — שתי השורות, לקוחה ושובל',
  typeof SMS_TEXT.booking_cancelled?.customer === 'string' &&
  typeof SMS_TEXT.booking_cancelled?.admin === 'string')
chk('🔒 בקשת שינוי מועד — שובל בלבד, אין נוסח ללקוחה',
  typeof SMS_TEXT.reschedule_requested?.admin === 'string' &&
  SMS_TEXT.reschedule_requested?.customer === undefined)
chk('🔒 אישור שינוי מועד — לקוחה בלבד, אין נוסח לשובל',
  typeof SMS_TEXT.reschedule_approved?.customer === 'string' &&
  SMS_TEXT.reschedule_approved?.admin === undefined)
chk('🔒 אישור תור רגיל — לקוחה בלבד',
  typeof SMS_TEXT.booking_approved?.customer === 'string' &&
  SMS_TEXT.booking_approved?.admin === undefined)
chk('🔒 בקשת תור חדשה — שובל בלבד',
  typeof SMS_TEXT.booking_requested?.admin === 'string' &&
  SMS_TEXT.booking_requested?.customer === undefined)

// ════════════════════════════════════════════════════════════════════════════
section('4. 🔴 ההבחנה בטריגר — תור רגיל מול בקשת שינוי מועד')

/*
 * 🔒 ההבחנה **קיימת כבר** ואינה דורשת migration: הטריגר קורא את
 * `reschedule_of_appointment_id` לתוך `v_is_request`, ומסתעף עליו.
 * הבדיקה קוראת את ה-SQL עצמו כדי שהמסקנה הזו לא תישען על זיכרון.
 */
{
  const sql = src('supabase/migrations/0025_appointment_notifications.sql')

  chk('🔴 v_is_request נגזר מ-reschedule_of_appointment_id',
    /select \(a\.reschedule_of_appointment_id is not null\) into v_is_request/.test(sql))

  // ענף האישור: pending → confirmed, if/else על v_is_request.
  const approveBranch = sql.slice(
    sql.indexOf("if new.to_status = 'confirmed' then"),
    sql.indexOf("if new.to_status = 'rejected' then"))
  chk('🔴 אישור בקשת שינוי → reschedule_approved/customer',
    /if v_is_request then[\s\S]*?'reschedule_approved', 'customer'/.test(approveBranch))
  chk('🔴 אישור תור רגיל → booking_approved/customer (ההתנהגות הישנה נשמרת)',
    /else[\s\S]*?'booking_approved', 'customer'/.test(approveBranch))
  chk('🔴 השניים ב-if/else — לעולם לא שתי הודעות ללקוחה',
    (approveBranch.match(/enqueue_appointment_notification/g) ?? []).length === 2 &&
    /if v_is_request then[\s\S]*?else[\s\S]*?end if/.test(approveBranch))

  // ענף הבקשה החדשה.
  const createdBranch = sql.slice(
    sql.indexOf("if new.action = 'created' and new.to_status = 'pending' then"),
    sql.indexOf('-- ══ הכרעה של שובל'))
  chk('🔴 בקשת שינוי מועד → reschedule_requested/admin בלבד',
    /'reschedule_requested', 'admin'/.test(createdBranch) &&
    !/'reschedule_requested', 'customer'/.test(createdBranch))

  // ענף הביטול.
  const cancelBranch = sql.slice(
    sql.indexOf("if new.to_status = 'cancelled_by_customer' then"),
    sql.indexOf("if new.to_status = 'cancelled_by_business' then"))
  chk('🔴 ביטול ע"י הלקוחה → בדיוק שתי שורות: customer + admin',
    (cancelBranch.match(/enqueue_appointment_notification/g) ?? []).length === 2 &&
    /'booking_cancelled', 'customer'/.test(cancelBranch) &&
    /'booking_cancelled', 'admin'/.test(cancelBranch))

  chk('🔒 דחיית תור לא שונתה — booking_rejected/customer עדיין קיים',
    /'booking_rejected', 'customer'/.test(sql))
  chk('🔒 ביטול ע"י העסק — לקוחה בלבד, ללא שינוי',
    /'cancelled_by_business'[\s\S]{0,400}?'booking_cancelled', 'customer'/.test(sql))
}

// ════════════════════════════════════════════════════════════════════════════
section('5. ניקוז בפועל — כמה הודעות ולמי')

function harness(rows, phoneFor = r => (r === 'admin' ? '+972500000001' : '+972500000002')) {
  const queue = [...rows]
  const log = []
  const calls = []
  const db = {
    async claimNotification(_a, _t, provider) {
      const n = queue.shift()
      return n ? { ...n, attempt_count: 1, provider } : null
    },
    async finishNotificationAttempt(p) { log.push({ fn: 'finish', outcome: p.outcome }); return { id: p.notificationId, status: 'sent' } },
    async skipNotification(id, _t, reason) { log.push({ fn: 'skip', reason }); return { id, status: 'skipped' } },
    async loadNotificationRecipient(_a, role) { log.push({ fn: 'recipient', role }); return phoneFor(role) },
    async loadNotificationContext() { log.push({ fn: 'context' }); return { customerName: 'NAME', startsAt: '2026-08-24T14:00:00.000Z' } },
  }
  const provider = {
    name: 'sms_019', isLive: true, calls,
    async send(msg) { calls.push(msg); return { outcome: 'accepted', providerMessageId: `S${calls.length}` } },
  }
  return { db, provider, calls, log }
}

const mkRow = (n, event, role) => ({
  id: `${String(n).repeat(8)}-1111-1111-1111-111111111111`,
  appointment_id: 'aaaaaaaa-1111-1111-1111-111111111111',
  event, recipient_role: role, status: 'queued', attempt_count: 0,
  provider: 'sms_019', last_error_code: null, created_at: '',
})

{
  // ביטול תור מאושר: בדיוק שתי התראות, אחת לכל נמען.
  const h = harness([mkRow(1, 'booking_cancelled', 'customer'), mkRow(2, 'booking_cancelled', 'admin')])
  const stats = await dispatchNow('appt-1', { provider: h.provider, maxAttempts: 4, db: h.db })

  chk('🔴 ביטול → בדיוק שתי הודעות', h.calls.length === 2 && stats.sent === 2,
    `calls=${h.calls.length} sent=${stats.sent}`)
  const roles = h.log.filter(l => l.fn === 'recipient').map(l => l.role)
  chk('🔴 נמען אחד customer ואחד admin — פעם אחת כל אחד',
    roles.filter(r => r === 'customer').length === 1 &&
    roles.filter(r => r === 'admin').length === 1, roles.join(','))
  chk('🔴 שני נוסחים שונים, כל אחד המדויק שלו',
    h.calls.some(c => c.body === 'התור שלך בוטל. לפרטים: https://smbrows.co.il/account') &&
    h.calls.some(c => c.body === 'לקוחה ביטלה תור. לניהול: https://smbrows.co.il/admin'))
  chk('🔒 אף אחת מהן לא גררה שליפת נתוני לקוחה',
    !h.log.some(l => l.fn === 'context'))
}

{
  // בקשת שינוי מועד: שובל בלבד.
  const h = harness([mkRow(3, 'reschedule_requested', 'admin')])
  await dispatchNow('appt-1', { provider: h.provider, maxAttempts: 4, db: h.db })
  chk('🔴 בקשת שינוי → הודעה אחת בלבד', h.calls.length === 1)
  chk('🔴 ולשובל בלבד',
    h.log.filter(l => l.fn === 'recipient').every(l => l.role === 'admin'))
  chk('🔴 בנוסח הסטטי המדויק',
    h.calls[0].body === 'לקוחה ביקשה לשנות מועד. לניהול: https://smbrows.co.il/admin',
    h.calls[0].body)
}

{
  // אישור בקשת שינוי: לקוחה בלבד, ו**רק** התבנית החדשה.
  const h = harness([mkRow(4, 'reschedule_approved', 'customer')])
  await dispatchNow('appt-1', { provider: h.provider, maxAttempts: 4, db: h.db })
  chk('🔴 אישור שינוי מועד → הודעה אחת ללקוחה', h.calls.length === 1 &&
    h.log.filter(l => l.fn === 'recipient').every(l => l.role === 'customer'))
  chk('🔴 בתבנית מספר 4',
    h.calls[0].body === 'שינוי המועד אושר. לפרטים: https://smbrows.co.il/account',
    h.calls[0].body)
  chk('🔴 🔒 **ולא** נשלחה בנוסף הודעת אישור התור הרגילה',
    !h.calls.some(c => c.body === smsBodyFor('booking_approved', 'customer')))
}

{
  // אישור תור רגיל: ההתנהגות הישנה, ללא שינוי.
  const h = harness([mkRow(5, 'booking_approved', 'customer')])
  await dispatchNow('appt-1', { provider: h.provider, maxAttempts: 4, db: h.db })
  chk('🔒 אישור תור רגיל → הנוסח הישן, ללא שינוי',
    h.calls.length === 1 &&
    h.calls[0].body === 'תורך אושר. לפרטים: https://smbrows.co.il/account',
    h.calls[0].body)
  chk('🔒 ולא נשלחה במקומו הודעת שינוי המועד',
    !h.calls.some(c => c.body === smsBodyFor('reschedule_approved', 'customer')))
}

{
  // דחייה — לא נגענו.
  const h = harness([mkRow(6, 'booking_rejected', 'customer')])
  await dispatchNow('appt-1', { provider: h.provider, maxAttempts: 4, db: h.db })
  chk('🔒 דחיית תור — הנוסח הישן, ללא שינוי',
    h.calls[0]?.body === 'בקשת התור לא אושרה. לפרטים: https://smbrows.co.il/account')
}

// ════════════════════════════════════════════════════════════════════════════
section('6. 🔒 idempotency — פעולה חוזרת אינה יוצרת SMS כפול')

{
  /*
   * ⚠️ ההגנה האמיתית היא ב-DB: `claim_appointment_notification` תופסת
   * שורה אחת עם lease, ורק שורות queued/retrying נתפסות. הרצה שנייה על
   * אותו תור לא מוצאת מה לתפוס. כאן זה מדומה ע"י תור ריק בסבב השני.
   */
  const h = harness([mkRow(1, 'booking_cancelled', 'customer'), mkRow(2, 'booking_cancelled', 'admin')])
  await dispatchNow('appt-1', { provider: h.provider, maxAttempts: 4, db: h.db })
  const afterFirst = h.calls.length
  const stats2 = await dispatchNow('appt-1', { provider: h.provider, maxAttempts: 4, db: h.db })

  chk('🔴 ניקוז חוזר על אותו תור → אפס הודעות נוספות',
    h.calls.length === afterFirst && stats2.claimed === 0 && stats2.sent === 0,
    `לפני=${afterFirst} אחרי=${h.calls.length}`)
  chk('🔒 idempotencyKey יציב = מזהה השורה (אותו external_id ב-retry)',
    h.calls[0].idempotencyKey === mkRow(1, 'x', 'customer').id &&
    h.calls[1].idempotencyKey === mkRow(2, 'x', 'admin').id,
    h.calls.map(c => c.idempotencyKey.slice(0, 8)).join(','))
  chk('🔒 ושני המפתחות שונים — שתי השורות אינן מתנגשות',
    h.calls[0].idempotencyKey !== h.calls[1].idempotencyKey)
}

{
  const sql = src('supabase/migrations/0025_appointment_notifications.sql')
  chk('🔒 מפתח הכפילות ב-DB: unique(source_history_id, recipient_role)',
    sql.includes('unique (source_history_id, recipient_role)'))
  chk('🔒 ה-enqueue אידמפוטנטי — on conflict do nothing',
    /on conflict \(source_history_id, recipient_role\) do nothing/.test(sql))
  chk('🔒 claim תופס שורה אחת עם lease, ורק queued/retrying',
    /c\.status in \('queued', 'retrying'\)/.test(sql) && /limit 1/.test(sql))
}

// ════════════════════════════════════════════════════════════════════════════
section('7. אין עקיפה של התור המתועד')

/*
 * TODO(pending-cancel): ביטול בקשה שעדיין `pending` אינו מייצר היום
 * התראה לשובל, והדרישה העסקית היא שכן — הבקשה נעלמת ממסך הניהול בשקט.
 *
 * ⚠️ **נדחה במכוון** לשלב שאחרי rollout מיגרציות הפרטיות. הסגירה מחייבת
 * migration (ערך enum חדש ב-`notification_event` + ענף חדש בטריגר של
 * 0025), כי `cancel_pending_appointment` כותבת
 * ('cancelled', 'pending', 'cancelled_by_customer') ואף ענף קיים אינו
 * תופס את הצירוף הזה. ⚠️ מספר המיגרציה ייקבע בזמן הכתיבה לפי סדר
 * המיגרציות שיהיה תקף אז.
 *
 * 🔒 **אין כאן בדיקה שמקבעת את הפער.** בדיקה ירוקה שמוכיחה "ההתראה
 * אינה נשלחת" הייתה הופכת באג ידוע להתנהגות מוגנת, ומכשילה בדיוק את
 * מי שיבוא לתקן אותה.
 */

/*
 * 🔒 מה שכן נאכף: **אין שליחת SMS ישירה שעוקפת את הטבלה.**
 *
 * ⚠️ הבדיקה אוסרת `sendSms` / `provider.send` בלבד — ולא `dispatchNow`.
 * ההבחנה מכוונת: כשהפער ייסגר, הענף הזה **אמור** לקרוא ל-
 * `waitUntil(dispatchNow(id))`, וזו הדרך הנכונה. מה שאסור הוא לעקוף את
 * ה-queue ולשלוח ישירות, כי אז אין שורה, אין attempts, אין idempotency
 * ואין עקבה.
 */
{
  const route = src('app/api/appointments/[id]/cancel/route.ts')
  const pendingBranch = route.slice(route.indexOf('// ── בקשה ממתינה'))
  chk('🔒 ענף ה-pending אינו שולח SMS ישירות (dispatchNow מותר)',
    !/sendSms|provider\.send|Sms019/.test(pendingBranch))
  chk('🔒 וגם בשאר ה-route אין שליחה ישירה — הכל דרך dispatchNow',
    !/sendSms|provider\.send/.test(route) && /dispatchNow/.test(route))
}

chk('🔒 אפס בקשות רשת אמיתיות — לא נשלח SMS', realFetch === 0, `calls=${realFetch}`)

// ════════════════════════════════════════════════════════════════════════════
const passed = results.filter(Boolean).length
console.log(`\n${passed === results.length ? '✓' : '✗'} ${passed}/${results.length} עברו`)
process.exit(passed === results.length ? 0 : 1)
