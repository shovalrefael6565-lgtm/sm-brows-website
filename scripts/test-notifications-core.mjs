/**
 * בדיקות שלב 15F — שכבת השליחה (lib/notifications).
 *
 * המיקוד הוא בארבע ההבטחות שאי אפשר לתקן בדיעבד:
 *
 *   1. 🔒 **כבוי = אפס כתיבות.** לא claim, לא ניסיון, לא שינוי סטטוס.
 *      תשתית שכבויה ובכל זאת "מטפלת" בשורות שורפת אותן בשקט.
 *   2. 🔒 **dispatchNow לעולם אינה זורקת.** הפעולה העסקית כבר עשתה COMMIT.
 *   3. 🔒 **delivery_unknown אינו הופך ל-retry.**
 *   4. 🔒 **מסלול התזכורות לא זז מילימטר** — שני משתני סביבה נפרדים.
 *
 * ⚠️ הקובץ אינו פותח חיבור, אינו ניגש ל-DB ואינו קורא credentials.
 * כל גישות ה-DB והספק מוזרקות ונספרות.
 *
 * הרצה:  npm run test:notifications-core
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(66)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(HERE, '..', p), 'utf8')

process.env.SUPABASE_URL ??= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon'

const { dispatchNow, shouldDispatch } = await import('../lib/notifications/dispatch.ts')
const { AWAITING_APPROVED_TEMPLATE } = await import('../lib/messageTemplates.ts')
const { resolveNotificationProvider } = await import('../lib/notifications/provider.ts')
const { resolveReminderProvider } = await import('../lib/reminders/provider.ts')

/** ספק מדומה. סופר קריאות, ולעולם לא יוצא לרשת. */
function fakeProvider(outcome = { outcome: 'accepted', providerMessageId: 'm1' }, name = 'sms_019') {
  const calls = []
  return {
    name, isLive: name === 'sms_019',
    calls,
    async send(msg) {
      calls.push(msg)
      if (typeof outcome === 'function') return outcome(msg)
      return outcome
    },
  }
}

/**
 * DB מדומה שסופר **כל** קריאה.
 *
 * ⚠️ הספירה היא כל העניין: "כבוי = אפס כתיבות" אינו ניתן לאכיפה ע"י
 * טיפוסים, ואי אפשר להוכיח אותו בלי לספור בפועל.
 */
function fakeDb(rows = [], phone = '+972501112233',
  ctx = { customerName: 'דנה כהן', startsAt: '2026-08-24T14:00:00.000Z' }) {
  const queue = [...rows]
  const log = []
  return {
    log,
    async claimNotification(appointmentId, leaseToken, provider) {
      log.push({ fn: 'claim', appointmentId, provider })
      const next = queue.shift()
      return next ? { ...next, attempt_count: 1, provider } : null
    },
    async finishNotificationAttempt(p) {
      log.push({ fn: 'finish', outcome: p.outcome, errorCode: p.errorCode })
      const status = {
        accepted: 'sent', simulated: 'simulated', retryable_error: 'retrying',
        permanent_error: 'failed', delivery_unknown: 'delivery_unknown',
        lease_expired: 'failed',
      }[p.outcome]
      return { id: p.notificationId, status }
    },
    async skipNotification(id, leaseToken, reason) {
      log.push({ fn: 'skip', reason })
      return { id, status: 'skipped' }
    },
    async loadNotificationRecipient(appointmentId, role) {
      log.push({ fn: 'recipient', role })
      return typeof phone === 'function' ? phone(role) : phone
    },
    async loadNotificationContext(appointmentId) {
      log.push({ fn: 'context', appointmentId })
      return ctx
    },
  }
}

const row = (over = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  appointment_id: 'aaaaaaaa-1111-1111-1111-111111111111',
  event: 'booking_approved',
  recipient_role: 'customer',
  status: 'queued',
  attempt_count: 0,
  provider: 'disabled',
  last_error_code: null,
  created_at: new Date().toISOString(),
  ...over,
})

const enable = () => {
  process.env.NOTIFICATIONS_ENABLED = 'true'
  process.env.NEW_BOOKING_SYSTEM_ENABLED = 'true'
}
const disable = () => {
  delete process.env.NOTIFICATIONS_ENABLED
  delete process.env.NEW_BOOKING_SYSTEM_ENABLED
}

// ════════════════════════════════════════════════════════════════════════════
section('1. 🔒 כבוי = אפס כתיבות')

{
  disable()
  const db = fakeDb([row()])
  const provider = fakeProvider()
  const stats = await dispatchNow('appt-1', { provider, db })
  chk('🔒 דגל כבוי → אפס קריאות ל-DB', db.log.length === 0, `calls=${db.log.length}`)
  chk('🔒 דגל כבוי → אפס קריאות לספק', provider.calls.length === 0)
  chk('enabled=false מדווח בסטטיסטיקה', stats.enabled === false && stats.claimed === 0)
}

{
  process.env.NOTIFICATIONS_ENABLED = 'true'
  delete process.env.NEW_BOOKING_SYSTEM_ENABLED
  const db = fakeDb([row()])
  const stats = await dispatchNow('appt-1', { provider: fakeProvider(), db })
  chk('🔒 NOTIFICATIONS_ENABLED לבדו אינו מספיק — צריך גם את דגל ההזמנות',
    db.log.length === 0 && stats.enabled === false, `calls=${db.log.length}`)
}

{
  enable()
  const db = fakeDb([row()])
  const disabledProvider = { name: 'disabled', isLive: false, async send() { throw new Error('נגעו בי') } }
  const stats = await dispatchNow('appt-1', { provider: disabledProvider, db })
  chk('🔒 ספק disabled → אפס claim (השורה ממתינה, לא נשרפת)',
    db.log.length === 0 && stats.dispatchable === false, `calls=${db.log.length}`)
}

chk('shouldDispatch טהורה ודורשת את שני התנאים',
  shouldDispatch(true, { name: 'sms_019' }) === true
  && shouldDispatch(false, { name: 'sms_019' }) === false
  && shouldDispatch(true, { name: 'disabled' }) === false)

// ════════════════════════════════════════════════════════════════════════════
section('2. מסלול מוצלח, וניקוז שתי שורות')

{
  enable()
  const db = fakeDb([
    row({ event: 'booking_cancelled', recipient_role: 'customer' }),
    row({ id: '22222222-2222-2222-2222-222222222222', event: 'booking_cancelled', recipient_role: 'admin' }),
  ])
  const provider = fakeProvider()
  const stats = await dispatchNow('appt-1', { provider, db })
  chk('booking_cancelled מנקז שתי שורות בקריאה אחת',
    stats.claimed === 2 && stats.sent === 2, `claimed=${stats.claimed} sent=${stats.sent}`)
  chk('נשלחו שני נוסחים שונים — ללקוחה ולשובל',
    provider.calls.length === 2 && provider.calls[0].body !== provider.calls[1].body)
  /*
   * 🔴 **שני הצדדים סטטיים עכשיו, ואף אחד מהם אינו נושא PII.**
   *
   * ⚠️ עד כאן צד ה-admin היה דינמי ונשא שם לקוחה ומועד תור. הבדיקה
   * הזו הפוכה בכוונה: היא נכשלת אם מישהו יחזיר PII לאחד משני הנוסחים.
   */
  const adminBody = provider.calls.find(c => c.body.startsWith('לקוחה ביטלה תור'))?.body
  const custBody = provider.calls.find(c => c.body.startsWith('התור שלך בוטל'))?.body
  chk('🔴 הודעת שובל — נוסח סטטי מדויק',
    adminBody === 'לקוחה ביטלה תור. לניהול: https://smbrows.co.il/admin', adminBody)
  chk('🔴 הודעת הלקוחה — נוסח סטטי מדויק',
    custBody === 'התור שלך בוטל. לפרטים: https://smbrows.co.il/account', custBody)
  chk('🔒 אף אחת מהשתיים אינה נושאת שם, תאריך או שעה',
    [adminBody, custBody].every(b => !/דנה|\d{1,2}\/\d{1,2}|\d{1,2}:\d{2}/.test(b)))
  chk('🔒 שתיהן נושאות קישור למקום מוגן',
    [adminBody, custBody].every(b => /^https:\/\//.test(b.split(' ').at(-1))))
  chk('🔒 ואף נתון לקוחה לא נשלף מה-DB עבורן',
    !db.log.some(l => l.fn === 'context'), JSON.stringify(db.log))
  chk('🔒 idempotencyKey = מזהה ההתראה, לא מספר ניסיון או חותמת זמן',
    provider.calls[0].idempotencyKey === '11111111-1111-1111-1111-111111111111'
    && provider.calls[1].idempotencyKey === '22222222-2222-2222-2222-222222222222')
  chk('🔒 גוף ההודעה ≤70 תווים בפועל',
    provider.calls.every(c => c.body.length <= 70),
    provider.calls.map(c => c.body.length).join(','))
}

// ════════════════════════════════════════════════════════════════════════════
section('3. 🔒 skip — שתי סיבות שונות, ולא כישלון')

{
  enable()
  /**
   * 🔴 גרירה ביומן — הנוסח **אושר** ב-15F, ולכן ההתראה נשלחת.
   *
   * ⚠️ עד לאישור היא נסגרה כ-skipped/awaiting_approved_template. הבדיקה
   * כאן הפוכה בכוונה: היא נכשלת אם מישהו יחזיר את האירוע לרשימת
   * הממתינים ויחזור להשתיק אותו.
   */
  const db = fakeDb([row({ event: 'appointment_moved_by_business' })])
  const provider = fakeProvider()
  const stats = await dispatchNow('appt-1', { provider, db })
  chk('🔴 appointment_moved_by_business נשלח (נוסח מאושר)',
    stats.sent === 1 && stats.skipped === 0, `sent=${stats.sent} skipped=${stats.skipped}`)
  chk('הגוף הוא הנוסח המאושר',
    provider.calls[0]?.body === 'מועד התור שלך עודכן. לפרטים: https://smbrows.co.il/account',
    provider.calls[0]?.body)
  chk('🔒 ועדיין ≤70 תווים', (provider.calls[0]?.body.length ?? 999) <= 70,
    String(provider.calls[0]?.body.length))
}

chk('🔒 אין כרגע אף אירוע שממתין לאישור נוסח',
  AWAITING_APPROVED_TEMPLATE.size === 0,
  [...AWAITING_APPROVED_TEMPLATE].join(', '))

{
  enable()
  // זוג שאין לו נוסח = באג בחיווט, קוד ייעודי משלו
  const db = fakeDb([row({ event: 'booking_approved', recipient_role: 'admin' })])
  const provider = fakeProvider()
  await dispatchNow('appt-1', { provider, db })
  chk('🔒 זוג לא חוקי → skip/no_template_for_event (ולא "ממתין לאישור")',
    db.log.some(l => l.fn === 'skip' && l.reason === 'no_template_for_event'),
    JSON.stringify(db.log.filter(l => l.fn === 'skip')))
  chk('🔒 ולא נשלח כלום', provider.calls.length === 0)

  /**
   * 🔒 **הנוסח נבדק לפני הנמען.** אין שום סיבה לשלוף מספר טלפון של לקוחה
   * עבור הודעה שאין לה נוסח — כל שליפה כזו היא PII שנטען בלי צורך.
   */
  chk('🔒 לא נטען מספר טלפון עבור אירוע ללא נוסח',
    !db.log.some(l => l.fn === 'recipient'), JSON.stringify(db.log))
}

{
  enable()
  const db = fakeDb([row({ event: 'booking_requested', recipient_role: 'admin' })], () => null)
  const provider = fakeProvider()
  await dispatchNow('appt-1', { provider, db })
  chk('🔒 יעד אדמין לא מוגדר → skip/admin_phone_unset (גלוי, לא נבלע)',
    db.log.some(l => l.fn === 'skip' && l.reason === 'admin_phone_unset'),
    JSON.stringify(db.log.filter(l => l.fn === 'skip')))
  chk('🔒 ולא נשלח SMS למספר מומצא', provider.calls.length === 0)
}

{
  enable()
  const db = fakeDb([row()], () => null)
  await dispatchNow('appt-1', { provider: fakeProvider(), db })
  chk('לקוחה בלי טלפון → skip/customer_phone_missing',
    db.log.some(l => l.fn === 'skip' && l.reason === 'customer_phone_missing'))
}

// ════════════════════════════════════════════════════════════════════════════
section('3ב. 🔒 הקשר נטען רק לזוגות הדינמיים')

{
  enable()
  const db = fakeDb([row({ event: 'booking_approved', recipient_role: 'customer' })])
  await dispatchNow('appt-1', { provider: fakeProvider(), db })
  /**
   * 🔒 **הכלל של 15F נשמר.** להודעה שנמענה הוא הלקוחה לא נטענים שם או
   * מועד — רק טלפון. אחרת השינוי הזה היה מרחיב PII לכל שמונת הנוסחים.
   */
  chk('🔒 זוג סטטי → אפס טעינת הקשר',
    !db.log.some(l => l.fn === 'context'), JSON.stringify(db.log))
}

{
  enable()
  const db = fakeDb([row({ event: 'reschedule_requested', recipient_role: 'admin' })])
  const provider = fakeProvider()
  await dispatchNow('appt-1', { provider, db })
  /*
   * 🔴 היה "זוג דינמי → ההקשר נטען". עכשיו ההפך: הנוסח סטטי, ולכן
   * **אין** שליפת נתוני לקוחה גם עבור בקשת שינוי מועד.
   */
  chk('🔴 בקשת שינוי מועד — אפס טעינת הקשר',
    !db.log.some(l => l.fn === 'context'), JSON.stringify(db.log))
  chk('🔴 והנוסח הוא הסטטי המדויק, ללא שם',
    provider.calls[0]?.body === 'לקוחה ביקשה לשנות מועד. לניהול: https://smbrows.co.il/admin',
    provider.calls[0]?.body)
}

{
  enable()
  /*
   * 🔴 **הקשר חסר כבר אינו יכול לחסום הודעה.**
   *
   * ⚠️ עד כאן `booking_cancelled/admin` היה דינמי, ו-`loadNotificationContext`
   * שמחזירה null הפילה אותו ל-skip/context_unavailable. עכשיו הנוסח סטטי,
   * ולכן ההודעה נשלחת כרגיל **גם** כשההקשר אינו זמין — אין בה מה למלא.
   *
   * 🔒 זו הקשחה ולא ויתור: נעלמה עוד נקודת כשל שיכלה להשתיק התראה לשובל.
   */
  const db = fakeDb([row({ event: 'booking_cancelled', recipient_role: 'admin' })], '+972501112233', null)
  const provider = fakeProvider()
  const stats = await dispatchNow('appt-1', { provider, db })
  chk('🔴 הקשר לא זמין → ההודעה בכל זאת נשלחת (הנוסח סטטי)',
    provider.calls.length === 1 && stats.sent === 1 && stats.skipped === 0,
    `sent=${stats.sent} skipped=${stats.skipped}`)
  chk('🔒 ו-loadNotificationContext כלל לא נקראה',
    !db.log.some(l => l.fn === 'context'))
}

// ════════════════════════════════════════════════════════════════════════════
section('4. 🔒 תוצאות ספק')

{
  enable()
  const db = fakeDb([row()])
  const provider = fakeProvider(() => { throw new Error('boom') })
  const stats = await dispatchNow('appt-1', { provider, db })
  chk('🔒 ספק שזרק → delivery_unknown, לעולם לא retryable',
    db.log.some(l => l.fn === 'finish' && l.outcome === 'delivery_unknown'
      && l.errorCode === 'provider_threw'),
    JSON.stringify(db.log.filter(l => l.fn === 'finish')))
  chk('נספר כ-deliveryUnknown', stats.deliveryUnknown === 1 && stats.retrying === 0)
}

{
  enable()
  const db = fakeDb([row()])
  const stats = await dispatchNow('appt-1', {
    provider: fakeProvider({ outcome: 'delivery_unknown', errorCode: 'sms019_timeout' }), db })
  chk('🔒 delivery_unknown מהספק אינו הופך ל-retrying',
    stats.deliveryUnknown === 1 && stats.retrying === 0)
}

{
  enable()
  const db = fakeDb([row()])
  const stats = await dispatchNow('appt-1', {
    provider: fakeProvider({ outcome: 'retryable_error', errorCode: 'sms019_http_500' }), db })
  chk('שגיאה זמנית → retrying', stats.retrying === 1)
}

{
  enable()
  const db = fakeDb([row()])
  const stats = await dispatchNow('appt-1', {
    provider: fakeProvider({ outcome: 'permanent_error', errorCode: 'sms019_bad_dest' }), db })
  chk('שגיאה קבועה → failed', stats.failed === 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('5. 🔒 dispatchNow לעולם אינה זורקת')

{
  enable()
  const explodingDb = {
    async claimNotification() { throw new Error('DB למטה') },
    async finishNotificationAttempt() { throw new Error('DB למטה') },
    async skipNotification() { throw new Error('DB למטה') },
    async loadNotificationRecipient() { throw new Error('DB למטה') },
  }
  let threw = false
  let stats
  try {
    stats = await dispatchNow('appt-1', { provider: fakeProvider(), db: explodingDb })
  } catch { threw = true }
  chk('🔒 DB שזורק אינו מפיל את dispatchNow', !threw)
  chk('ומוחזרת סטטיסטיקה תקינה', Boolean(stats) && stats.claimed === 0)
}

{
  enable()
  const db = fakeDb([row()])
  db.loadNotificationRecipient = async () => { throw new Error('פיצוץ באמצע') }
  let threw = false
  try { await dispatchNow('appt-1', { provider: fakeProvider(), db }) } catch { threw = true }
  chk('🔒 כשל באמצע העיבוד אינו מטפס החוצה', !threw)
}

// ════════════════════════════════════════════════════════════════════════════
section('6. 🔒 מסלול התזכורות לא זז')

{
  const env = { NOTIFICATION_PROVIDER: 'sms_019', SMS019_USERNAME: 'u', SMS019_TOKEN: 't', SMS019_SOURCE: 'SMBROWS' }
  chk('NOTIFICATION_PROVIDER=sms_019 מדליק את ספק ההתראות',
    resolveNotificationProvider(env).name === 'sms_019')
  chk('🔒 ואינו מדליק את ספק התזכורות',
    resolveReminderProvider(env).name === 'disabled',
    resolveReminderProvider(env).name)
}

{
  const env = { REMINDER_PROVIDER: 'sms_019', SMS019_USERNAME: 'u', SMS019_TOKEN: 't', SMS019_SOURCE: 'SMBROWS' }
  chk('🔒 REMINDER_PROVIDER אינו מדליק את ספק ההתראות',
    resolveNotificationProvider(env).name === 'disabled',
    resolveNotificationProvider(env).name)
}

chk('🔒 תצורת 019 חלקית → disabled ולא ניסיון שליחה',
  resolveNotificationProvider({ NOTIFICATION_PROVIDER: 'sms_019', SMS019_USERNAME: 'u' }).name === 'disabled')

chk('🔒 simulated אסור בפרודקשן',
  resolveNotificationProvider({ NOTIFICATION_PROVIDER: 'simulated', NODE_ENV: 'production' }).name === 'disabled')

{
  const dispatchSrc = src('lib/notifications/dispatch.ts')
  const providerSrc = src('lib/notifications/provider.ts')
  chk('🔒 שכבת ההתראות אינה נוגעת ב-REMINDERS_ENABLED',
    !/REMINDERS_ENABLED/.test(dispatchSrc) && !/REMINDERS_ENABLED/.test(providerSrc))
  chk('🔒 ואינה קוראת ל-runReminderDispatch',
    !/runReminderDispatch/.test(dispatchSrc) && !/runReminderDispatch/.test(providerSrc))
  chk('🔒 אינה יוצרת התראות — הרישום שייך לטריגר ב-DB בלבד',
    !/enqueue_appointment_notification/.test(dispatchSrc)
    && !/enqueue_appointment_notification/.test(src('lib/db/notifications.ts')))
}

// ════════════════════════════════════════════════════════════════════════════
section('7. 🔒 פרטיות — אין PII בלוגים ואין בטעינת הנמען')

/**
 * ⚠️ הערות מוסרות לפני הסריקה. התיעוד ב-lib/db/notifications.ts מסביר
 * *במפורש* מה ההבדל מ-loadReminderRecipient, ולכן מזכיר את service_key
 * ו-variants בשמם. בדיקה שנופלת על ההסבר של עצמה היא בדיוק הבדיקה
 * שמישהו מוחק במקום לתקן.
 */
const stripComments = code => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

{
  const dbSrc = stripComments(src('lib/db/notifications.ts'))

  /**
   * ⚠️ הבדיקה מתוחמת ל-`loadNotificationRecipient` בלבד, ולא לקובץ כולו.
   *
   * מאז שני נוסחי ה-admin הדינמיים יש בקובץ **מסלול PII מכוון** —
   * `loadNotificationContext`. תיחום הסריקה הוא מה שמשאיר את הבדיקה
   * משמעותית: מסלול הנמען חייב להישאר טלפון-בלבד, גם כשלידו יש מסלול
   * שטוען שם.
   */
  const recipientFn = dbSrc.slice(
    dbSrc.indexOf('export async function loadNotificationRecipient'),
    dbSrc.indexOf('export interface NotificationContext'),
  )
  chk('🔒 טעינת הנמען מחזירה טלפון בלבד',
    recipientFn.length > 0
    && !/service_key|variants|full_name|price_total/.test(recipientFn))

  /**
   * 🔒 מסלול ההקשר טוען **שם ומועד בלבד**. לא טיפול, לא מחיר, לא טלפון
   * של הלקוחה — שום דבר שאינו נכנס בפועל לאחד משני הנוסחים.
   */
  const contextFn = dbSrc.slice(dbSrc.indexOf('export async function loadNotificationContext'))
  chk('🔒 טעינת ההקשר אינה מושכת טיפול, מחיר או טלפון',
    !/service_key|variants|price_total|phone_e164/.test(contextFn))
  chk('🔒 והשם מגיע מ-customers.full_name הקנוני',
    /customers\(full_name\)/.test(contextFn))

  const dispatchSrc = stripComments(src('lib/notifications/dispatch.ts'))
  const logLines = dispatchSrc.split('\n')
    .filter(l => /console\.(error|warn|info|log)/.test(l))
  chk('🔒 אין הדפסת טלפון, גוף הודעה או מזהה בלוגים',
    logLines.every(l => !/phone|body|\brow\.id\b|idempotencyKey/.test(l)),
    logLines.join(' | '))
}

// ─── סיכום ──────────────────────────────────────────────────────────────────
disable()
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✓' : '✗'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
