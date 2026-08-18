/**
 * בדיקות שלב 12A — ספק 019, בלי רשת אמיתית ובלי credentials אמיתיים.
 *
 * המיקוד: ההחלטות שאין דרך לתקן בדיעבד אם ישתבשו —
 *   1. שאין דרך להפעיל את הספק האמיתי מול כתובת ה-test, ולהפך.
 *   2. שכל תוצאה שאינה מוכיחה דחייה אינה נכנסת ל-retry אוטומטי.
 *   3. שטלפון, גוף הודעה ו-token אינם מגיעים לשום לוג.
 *
 * ⚠️ ה-fetch מוזרק בכל בדיקה. הקובץ הזה לעולם אינו פותח חיבור.
 *
 * הרצה:  npm run test:sms019
 */

import { readFileSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const {
  SMS019_API_URL, SMS019_TEST_API_URL, SMS019_MAX_MESSAGE_CHARS,
  SMS019_MAPPED_STATUS_CODES, SMS019_SOURCE_RE,
  buildSms019Payload, classifySms019Body, classifySms019HttpStatus,
  classifySms019TransportError, maskPhone, toLocalIsraeliPhone,
} = await import('../lib/reminders/sms019Mapping.ts')

const { Sms019ReminderProvider, readSms019Config } = await import('../lib/reminders/sms019.ts')
const { resolveReminderProvider, isDispatchable } = await import('../lib/reminders/provider.ts')

const PHONE = '+972541234567'
const LOCAL = '0541234567'
const BODY = 'תזכורת לתור ביום ראשון בשעה 10:00'
const KEY = '11111111-2222-3333-4444-555555555555'
const MSG = { to: PHONE, body: BODY, idempotencyKey: KEY }

const GOOD_ENV = {
  REMINDER_PROVIDER: 'sms_019',
  SMS019_USERNAME: 'demo_user',
  SMS019_TOKEN: 'tok_SECRET_VALUE_NEVER_LOGGED',
  SMS019_SOURCE: 'SM BROWS',
}

/** בונה ספק עם fetch ולוג מוזרקים. */
const providerWith = (fetchImpl, env = GOOD_ENV) => {
  const cfg = readSms019Config(env)
  if (!cfg.ok) throw new Error('תצורת הבדיקה עצמה פסולה: ' + cfg.problems.join('; '))
  const lines = []
  const p = new Sms019ReminderProvider(cfg.config, { fetch: fetchImpl, log: l => lines.push(l) })
  return { provider: p, lines }
}

/** תשובת HTTP מזויפת. */
const httpRes = (status, body, { badJson = false } = {}) => ({
  status,
  json: async () => {
    if (badJson) throw new SyntaxError('Unexpected token')
    return body
  },
})

const okFetch = (body = { status: 0, shipment_id: 'SHIP-1' }, status = 200) =>
  async () => httpRes(status, body)

const throwingFetch = err => async () => { throw err }

const nodeErr = (code, name = 'Error') => {
  const e = new Error('boom')
  e.name = name
  e.code = code
  return e
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 הפרדה מוחלטת בין production ל-test')
// ════════════════════════════════════════════════════════════════════════════

chk('כתובת ה-runtime היא הקבוע של production',
  SMS019_API_URL === 'https://019sms.co.il/api')
chk('כתובת ה-probe היא הקבוע של test',
  SMS019_TEST_API_URL === 'https://019sms.co.il/api/test')
chk('🔒 שתי הכתובות שונות', SMS019_API_URL !== SMS019_TEST_API_URL)

/**
 * ⚠️ הבדיקות שסורקות מקור עושות זאת **על הקוד בלבד**, אחרי הסרת הערות.
 *
 * הקבצים האלה מתעדים בהערות בדיוק את מה שאסור להם לעשות ("אינו נוגע
 * ב-supabase", "אין SMS019_BASE_URL"). סריקה על הטקסט המלא הייתה נכשלת על
 * התיעוד עצמו — ומה שגרוע יותר, היא הייתה מלמדת למחוק את ההסבר כדי לרצות
 * את הבדיקה. סריקה על הקוד היא מה שנבדק כאן.
 */
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ')

const srcOf = rel => stripComments(readFileSync(new URL(rel, import.meta.url), 'utf8'))

const mappingSrc = srcOf('../lib/reminders/sms019Mapping.ts')
const providerSrc = srcOf('../lib/reminders/sms019.ts')
const probeSrc = srcOf('./probe-019.mjs')
const resolveSrc = srcOf('../lib/reminders/provider.ts')

// הסרת ההערות עצמה חייבת לעבוד, אחרת הבדיקות שמתבססות עליה חסרות ערך.
chk('מסנן ההערות מסיר בלוק', stripComments('/* סוד */ code').trim() === 'code')
chk('מסנן ההערות מסיר שורה', stripComments('code // סוד').trim() === 'code')
chk('מסנן ההערות אינו הורס כתובת https', stripComments("const u = 'https://x/api'").includes('https://x/api'))

chk('🔒 אין SMS019_BASE_URL באף קובץ',
  ![mappingSrc, providerSrc, probeSrc, resolveSrc].some(s => /SMS019_BASE_URL/.test(s)))
chk('🔒 הספק אינו קורא שום כתובת מ-env',
  !/env\.[A-Z0-9_]*URL/.test(providerSrc) && !/process\.env\.[A-Z0-9_]*URL/.test(providerSrc))
chk('🔒 הספק משתמש ב-SMS019_API_URL בלבד',
  providerSrc.includes('SMS019_API_URL') && !providerSrc.includes('SMS019_TEST_API_URL'))
chk('🔒 ה-probe משתמש ב-SMS019_TEST_API_URL בלבד',
  probeSrc.includes('SMS019_TEST_API_URL') && !/[^_]SMS019_API_URL/.test(probeSrc))

// ⚠️ ה-probe הוא dry-run. הצלחה שלו לעולם לא תסומן sent, כי הוא אינו נוגע
// במסד בכלל: אין לו supabase, אין dispatcher, ואין שם אף שם של שדה סטטוס.
for (const forbidden of [
  'supabase', 'dispatch', 'runReminderDispatch', 'finishReminderAttempt',
  'claimDueReminder', 'appointment_reminders', 'provider_message_id', 'sent_at',
]) {
  chk(`🔒 ה-probe אינו נוגע ב-${forbidden}`, !probeSrc.includes(forbidden))
}

// ════════════════════════════════════════════════════════════════════════════
section('תצורה — חוסר או פסול = disabled, לא זריקה')
// ════════════════════════════════════════════════════════════════════════════

chk('אין משתנים כלל → לא תקין', readSms019Config({}).ok === false)
for (const key of ['SMS019_USERNAME', 'SMS019_TOKEN', 'SMS019_SOURCE']) {
  const env = { ...GOOD_ENV }
  delete env[key]
  const r = readSms019Config(env)
  chk(`${key} חסר → לא תקין`, r.ok === false && r.problems.some(p => p.includes(key)))
}
chk('משתנה ריק נחשב חסר',
  readSms019Config({ ...GOOD_ENV, SMS019_TOKEN: '   ' }).ok === false)

chk('source ארוך מ-11 → נדחה',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'ABCDEFGHIJKL' }).ok === false)
chk('source באורך 11 בדיוק → מתקבל',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'ABCDEFGHIJK' }).ok === true)
chk('source עם עברית → נדחה',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'גבות' }).ok === false)
chk("source תקין 'SM BROWS' → מתקבל", readSms019Config(GOOD_ENV).ok === true)
chk('מספר טלפון כשולח מתקבל גם הוא',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: '0722222222' }).ok === true)

/**
 * ⚠️ רווח פנימי מותר — רחב מהתיעוד, ובכוונה.
 *
 * שם השולח המאושר בחשבון הוא 'SM BROWS'. ולידציה שנצמדת למילה של התיעוד
 * ("English letters" בלבד) הייתה דוחה את השם היחיד שאפשר לשלוח ממנו.
 * רווח בקצוות עדיין נדחה: הוא שארית הדבקה, והוא משנה בשקט את מה שהלקוחה רואה.
 */
chk("⚠️ 'SM BROWS' — רווח פנימי — מתקבל",
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'SM BROWS' }).ok === true)
// ⚠️ רווח בקצוות מנורמל ע"י trim ואינו נדחה: ' SM BROWS' פירושו 'SM BROWS'
// וזו הכוונה הברורה. מה שחשוב הוא שהערך שנשלח בפועל **אינו** מכיל אותו.
chk('רווח בהתחלה מנורמל ולא נשלח',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: ' SM BROWS' }).config.source === 'SM BROWS')
chk('רווח בסוף מנורמל ולא נשלח',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'SM BROWS ' }).config.source === 'SM BROWS')
chk('רווח בשני הקצוות סביב שם עם רווח פנימי',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: '  SM BROWS  ' }).config.source === 'SM BROWS')

// הרגקס עצמו — חגורה שנייה, למקרה שמסלול עתידי לא יעשה trim.
chk('🔒 הרגקס דוחה רווח מוביל', SMS019_SOURCE_RE.test(' SM BROWS') === false)
chk('🔒 הרגקס דוחה רווח נגרר', SMS019_SOURCE_RE.test('SM BROWS ') === false)
chk('🔒 הרגקס מקבל רווח פנימי', SMS019_SOURCE_RE.test('SM BROWS') === true)
chk('רווחים בלבד → נדחה',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: '   ' }).ok === false)
chk('רווח פנימי באורך 11 בדיוק → מתקבל',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'SM BROWS IL' }).ok === true)
chk('רווח פנימי באורך 12 → נדחה',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'SM BROWS ILX' }).ok === false)
chk('תו מיוחד עדיין נדחה',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'SM-BROWS' }).ok === false)
chk('תו יחיד → מתקבל',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'A' }).ok === true)

// ⚠️ הרווח חייב להישרד עד גוף הבקשה — trim על הערך כולו הוא בסדר,
// אבל דריסה של רווח פנימי הייתה משנה את זהות השולח בלי שאיש ישים לב.
chk('🔒 הרווח הפנימי נשמר בתצורה',
  readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'SM BROWS' }).config.source === 'SM BROWS')

// ⚠️ שמות משתנים בלבד — הערכים לא נכנסים לדיווח שנכתב ללוג.
{
  const r = readSms019Config({ ...GOOD_ENV, SMS019_SOURCE: 'BAD SOURCE!!' })
  chk('⚠️ דיווח התצורה אינו מכיל את ערך ה-token',
    r.ok === false && !r.problems.join(' ').includes(GOOD_ENV.SMS019_TOKEN))
  chk('⚠️ דיווח התצורה אינו מכיל את ערך ה-source הפסול',
    r.ok === false && !r.problems.join(' ').includes('BAD SOURCE!!'))
}

chk('timeout ברירת מחדל 10000', readSms019Config(GOOD_ENV).config.timeoutMs === 10_000)
for (const [raw, expect] of [['5000', 5000], ['0', 10_000], ['999999', 10_000], ['abc', 10_000], ['', 10_000]]) {
  chk(`SMS019_TIMEOUT_MS="${raw}" → ${expect}`,
    readSms019Config({ ...GOOD_ENV, SMS019_TIMEOUT_MS: raw }).config.timeoutMs === expect)
}

// ── בחירת הספק ────────────────────────────────────────────────────────────
chk('🔒 sms_019 בלי credentials → disabled',
  resolveReminderProvider({ REMINDER_PROVIDER: 'sms_019' }).name === 'disabled')
chk('🔒 sms_019 עם credentials חלקיים → disabled',
  resolveReminderProvider({ REMINDER_PROVIDER: 'sms_019', SMS019_USERNAME: 'u' }).name === 'disabled')
chk('sms_019 עם תצורה מלאה → sms_019',
  resolveReminderProvider(GOOD_ENV).name === 'sms_019')
chk('sms_019 הוא dispatchable', isDispatchable(resolveReminderProvider(GOOD_ENV)) === true)
chk('🔒 sms_019 הוא isLive — ולכן sent אפשרי רק דרכו',
  resolveReminderProvider(GOOD_ENV).isLive === true)
chk('⚠️ "019" עדיין אינו שם ספק חוקי',
  resolveReminderProvider({ ...GOOD_ENV, REMINDER_PROVIDER: '019' }).name === 'disabled')
chk('ברירת המחדל נשארה disabled גם כשה-credentials קיימים',
  resolveReminderProvider({ ...GOOD_ENV, REMINDER_PROVIDER: undefined }).name === 'disabled')

// ⚠️ אין דגל שמפנה את הספק ל-dry-run.
chk('🔒 אין SMS019_DRY_RUN / SMS019_USE_TEST וכדומה',
  !/DRY_RUN|USE_TEST|TEST_MODE/i.test(providerSrc + resolveSrc))

// ════════════════════════════════════════════════════════════════════════════
section('המרת מספר ובניית הבקשה')
// ════════════════════════════════════════════════════════════════════════════

chk('E.164 ישראלי → פורמט 019', toLocalIsraeliPhone(PHONE) === LOCAL)
chk('רווחים מסביב נגזמים', toLocalIsraeliPhone(`  ${PHONE} `) === LOCAL)
for (const bad of ['+14155552671', '0541234567', '+972541234', '+9723123456', '', null, undefined, '+97254123456789']) {
  chk(`יעד לא נתמך נדחה: ${JSON.stringify(bad)}`, toLocalIsraeliPhone(bad) === null)
}

{
  const payload = buildSms019Payload({
    username: 'demo_user', source: 'SM BROWS', localPhone: LOCAL,
    message: BODY, externalId: KEY,
  })
  const sms = payload.sms
  chk('מבנה הבקשה תואם לתיעוד (sms.user.username)', sms.user.username === 'demo_user')
  chk('🔒 source נשלח כפי שהוא — כולל הרווח הפנימי', sms.source === 'SM BROWS')
  chk('⚠️ המבנה $ / _ נשמר (JSON שנגזר מ-XML)',
    sms.destinations.phone[0]._ === LOCAL && sms.destinations.phone[0].$.id === KEY)
  chk('⚠️ external_id הוא reminder.id', sms.destinations.phone[0].$.id === KEY)
  chk('add_unsubscribe=0 — הודעה תפעולית ולא דיוור', sms.add_unsubscribe === '0')
  chk('⚠️ timing אינו נשלח — התזמון שלנו', sms.timing === undefined)
  chk('⚠️ ה-token אינו חלק מגוף הבקשה',
    !JSON.stringify(payload).includes(GOOD_ENV.SMS019_TOKEN))
}

chk('maskPhone אינו חושף את המספר',
  !maskPhone(LOCAL).includes('054') && maskPhone(LOCAL).endsWith('567'))

// ════════════════════════════════════════════════════════════════════════════
section('🔒 מיפוי כשלי תעבורה — retryable רק לפני יציאת הבקשה')
// ════════════════════════════════════════════════════════════════════════════

// ── הרשימה הסגורה: מוכח שלא יצאה ──
for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']) {
  const r = classifySms019TransportError(nodeErr(code))
  chk(`${code} → retryable_error`, r.outcome === 'retryable_error', r.errorCode)
}
for (const code of ['ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER', 'CERT_HAS_EXPIRED']) {
  const r = classifySms019TransportError(nodeErr(code))
  chk(`כשל TLS ${code} → retryable_error`, r.outcome === 'retryable_error', r.errorCode)
}

// ── כל השאר: ייתכן שיצאה ──
for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'ENETUNREACH', '']) {
  const r = classifySms019TransportError(nodeErr(code))
  chk(`⚠️ ${code || '(ללא קוד)'} → delivery_unknown`, r.outcome === 'delivery_unknown', r.errorCode)
}
chk('⚠️ AbortError → delivery_unknown',
  classifySms019TransportError(nodeErr('ABORT_ERR', 'AbortError')).outcome === 'delivery_unknown')
chk('⚠️ AbortError ללא code → delivery_unknown',
  classifySms019TransportError(nodeErr(undefined, 'AbortError')).outcome === 'delivery_unknown')
chk('⚠️ headers timeout של undici → delivery_unknown',
  classifySms019TransportError(nodeErr('UND_ERR_HEADERS_TIMEOUT')).outcome === 'delivery_unknown')

// ⚠️ undici עוטף את השגיאה האמיתית ב-cause. בלי זה, ניתוק DNS היה נראה
// כמו שגיאה חסרת קוד — כלומר delivery_unknown במקום retryable.
{
  const wrapped = new TypeError('fetch failed')
  wrapped.cause = nodeErr('ENOTFOUND')
  chk('cause מקונן נקרא נכון (fetch failed → ENOTFOUND)',
    classifySms019TransportError(wrapped).outcome === 'retryable_error')
}
{
  const wrapped = new TypeError('fetch failed')
  wrapped.cause = nodeErr('ECONNRESET')
  chk('⚠️ fetch failed → ECONNRESET נשאר delivery_unknown',
    classifySms019TransportError(wrapped).outcome === 'delivery_unknown')
}
{
  // הגנה מפני שרשרת cause מעגלית
  const a = new Error('a'); const b = new Error('b')
  a.cause = b; b.cause = a
  chk('שרשרת cause מעגלית אינה תוקעת',
    classifySms019TransportError(a).outcome === 'delivery_unknown')
}
chk('ערך שאינו Error כלל → delivery_unknown',
  classifySms019TransportError('משהו').outcome === 'delivery_unknown')

// ════════════════════════════════════════════════════════════════════════════
section('🔒 מיפוי HTTP')
// ════════════════════════════════════════════════════════════════════════════

chk('200 → נדרש לקרוא את הגוף', classifySms019HttpStatus(200) === null)
chk('429 → retryable_error', classifySms019HttpStatus(429).outcome === 'retryable_error')
for (const s of [400, 401, 403, 404, 422]) {
  chk(`${s} → permanent_error`, classifySms019HttpStatus(s).outcome === 'permanent_error')
}
for (const s of [500, 502, 503, 504]) {
  chk(`⚠️ ${s} → delivery_unknown`, classifySms019HttpStatus(s).outcome === 'delivery_unknown')
}
for (const s of [204, 301, 302]) {
  chk(`⚠️ ${s} (לא מתועד) → delivery_unknown`,
    classifySms019HttpStatus(s).outcome === 'delivery_unknown')
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 מיפוי קודי הספק')
// ════════════════════════════════════════════════════════════════════════════

{
  const r = classifySms019Body({ status: 0, message: 'SMS will be sent', shipment_id: 'SHIP-7' })
  chk('status=0 → accepted', r.outcome === 'accepted')
  chk('provider_message_id = shipment_id', r.providerMessageId === 'SHIP-7')
}
chk('status כמחרוזת "0" עם shipment_id → accepted',
  classifySms019Body({ status: '0', shipment_id: 'S' }).outcome === 'accepted')

/*
 * 🔴 hotfix — **הבדיקה הזו התהפכה, וזו הנקודה של התיקון כולו.**
 *
 * ⚠️ קודם נכתב כאן `status=0 בלי shipment_id → עדיין accepted`, כלומר
 * הבדיקה **קיבעה את הבאג**: תשובת 200 שאין בה מזהה משלוח נרשמה כ-accepted,
 * וה-RPC הפכה אותה ל-`sent`. בפרודקשן נצפו בדיוק שלוש שורות כאלה — `sent`
 * בלי provider_message_id, ובלי שום זכר בדוח ההודעות היוצאות של 019.
 *
 * 🔒 החוזה של 019 לקבלת בקשה למשלוח הוא **שני** שדות: status:0 **וגם**
 * shipment_id. אין מזהה — אין ראיה — אין 'sent'.
 */
{
  const r = classifySms019Body({ status: 0 })
  chk('🔴 status=0 בלי shipment_id → delivery_unknown, לא accepted',
    r.outcome === 'delivery_unknown', r.outcome)
  chk('  ומסווג בקוד ייעודי שניתן לאיתור במסך הניהול',
    r.errorCode === 'sms019_accepted_without_shipment_id', r.errorCode)
}
chk('🔴 status=0 עם shipment_id ריק → delivery_unknown',
  classifySms019Body({ status: 0, shipment_id: '   ' }).outcome === 'delivery_unknown')
chk('🔴 status=0 עם shipment_id לא-סקלרי → delivery_unknown',
  classifySms019Body({ status: 0, shipment_id: { a: 1 } }).outcome === 'delivery_unknown')
chk('shipment_id מספרי מומר למחרוזת',
  classifySms019Body({ status: 0, shipment_id: 12345 }).providerMessageId === '12345')
chk('🔒 המסלול שעובד לא נפגע — status:0 + shipment_id עדיין accepted',
  classifySms019Body({ status: 0, shipment_id: 'SHIP-1' }).outcome === 'accepted')

const expectStatus = (code, outcome, slug) => {
  const r = classifySms019Body({ status: code })
  chk(`${code} → ${outcome}`, r.outcome === outcome, r.errorCode)
  if (slug) chk(`  קוד ${code} מזוהה כ-${slug}`, r.errorCode === slug)
}

expectStatus(5, 'retryable_error', 'sms019_send_time_not_permitted_5')
for (const c of [3, 10, 11, 504, 515, 511, 503, 502]) expectStatus(c, 'permanent_error')
expectStatus(4, 'permanent_error', 'sms019_insufficient_credit_4')
expectStatus(12, 'permanent_error', 'sms019_insufficient_credit_12')
for (const c of [8, 9, 715, 714, 1, 2, 7, 510, 980, 981, 986, 988, 989, 992, 997]) {
  expectStatus(c, 'permanent_error')
}
for (const c of [6, 998, 999]) expectStatus(c, 'delivery_unknown')

// ── ברירת המחדל אינה permanent ואינה retryable ──
for (const c of [13, 77, 4242, -5]) {
  const r = classifySms019Body({ status: c })
  chk(`⚠️ קוד לא מוכר ${c} → delivery_unknown`, r.outcome === 'delivery_unknown', r.errorCode)
}
for (const bad of [null, undefined, 'שלום', 42, [], { message: 'ok' }, { status: 'abc' }, { status: null }]) {
  const r = classifySms019Body(bad)
  chk(`⚠️ גוף פגום ${JSON.stringify(bad) ?? 'undefined'} → delivery_unknown`,
    r.outcome === 'delivery_unknown' && r.errorCode === 'sms019_malformed_response')
}

// ── כל errorCode חייב לעבור את ה-CHECK של ה-DB ──
const DB_ERROR_CODE_RE = /^[a-z0-9_]{1,60}$/
{
  const codes = new Set()
  for (const c of [...SMS019_MAPPED_STATUS_CODES, 13, 77]) {
    const r = classifySms019Body({ status: c })
    if (r.outcome !== 'accepted') codes.add(r.errorCode)
  }
  for (const s of [400, 401, 429, 500, 504, 302]) codes.add(classifySms019HttpStatus(s).errorCode)
  for (const e of ['ENOTFOUND', 'ECONNRESET', 'ABORT_ERR']) {
    codes.add(classifySms019TransportError(nodeErr(e)).errorCode)
  }
  codes.add('sms019_malformed_response')
  codes.add('sms019_unsupported_destination')
  codes.add('sms019_message_too_long')
  codes.add('sms019_message_empty')
  const bad = [...codes].filter(c => !DB_ERROR_CODE_RE.test(c))
  chk(`🔒 כל ${codes.size} קודי השגיאה עומדים ב-CHECK של 0011`, bad.length === 0, bad.join(','))
  chk('⚠️ אף קוד שגיאה אינו מכיל טקסט מהספק',
    [...codes].every(c => /^(sms019_|http_|provider_)/.test(c)))
}

// ════════════════════════════════════════════════════════════════════════════
section('הספק מקצה לקצה (fetch מוזרק)')
// ════════════════════════════════════════════════════════════════════════════

{
  let captured = null
  const { provider } = providerWith(async (url, init) => {
    captured = { url, init }
    return httpRes(200, { status: 0, shipment_id: 'SHIP-9' })
  })
  const r = await provider.send(MSG)
  chk('accepted מוחזר עם shipment_id',
    r.outcome === 'accepted' && r.providerMessageId === 'SHIP-9')
  chk('🔒 הבקשה נשלחה לכתובת ה-production', captured.url === SMS019_API_URL)
  chk('🔒 הבקשה **לא** נשלחה לכתובת ה-test', captured.url !== SMS019_TEST_API_URL)
  chk('כותרת Bearer נשלחה',
    captured.init.headers.Authorization === `Bearer ${GOOD_ENV.SMS019_TOKEN}`)
  chk('Content-Type: application/json', captured.init.headers['Content-Type'] === 'application/json')
  chk('method=POST', captured.init.method === 'POST')
  chk('signal הועבר (יש timeout)', captured.init.signal !== undefined)
  const sent = JSON.parse(captured.init.body)
  chk('הטלפון הומר לפורמט 019', sent.sms.destinations.phone[0]._ === LOCAL)
  chk('⚠️ E.164 אינו נשלח לספק', !captured.init.body.includes(PHONE))
}

// ── ולידציה מקומית: נכשלת בלי שום קריאת רשת ──
{
  let called = 0
  // ⚠️ shipment_id נדרש: תשובת הצלחה בלי מזהה משלוח היא delivery_unknown,
  // וכאן נבדקת הוולידציה המקומית ולא חוזה ההצלחה.
  const failIfCalled = async () => { called++; return httpRes(200, { status: 0, shipment_id: 'S' }) }

  const { provider } = providerWith(failIfCalled)
  const intl = await provider.send({ ...MSG, to: '+14155552671' })
  chk('יעד לא ישראלי → permanent_error',
    intl.outcome === 'permanent_error' && intl.errorCode === 'sms019_unsupported_destination')

  const long = await provider.send({ ...MSG, body: 'א'.repeat(SMS019_MAX_MESSAGE_CHARS + 1) })
  chk('הודעה ארוכה מ-1005 → permanent_error',
    long.outcome === 'permanent_error' && long.errorCode === 'sms019_message_too_long')

  const empty = await provider.send({ ...MSG, body: '   ' })
  chk('גוף ריק → permanent_error',
    empty.outcome === 'permanent_error' && empty.errorCode === 'sms019_message_empty')

  chk('🔒 שלוש הדחיות המקומיות לא פתחו אף חיבור', called === 0)

  const atLimit = await provider.send({ ...MSG, body: 'א'.repeat(SMS019_MAX_MESSAGE_CHARS) })
  chk('בדיוק 1005 תווים — עובר', atLimit.outcome === 'accepted' && called === 1)
}

// ── תרחישי הכשל שהמשתמש ביקש במפורש ──
{
  const cases = [
    ['token שגוי', okFetch({ status: 3 }), 'permanent_error'],
    ['token פג תוקף', okFetch({ status: 10 }), 'permanent_error'],
    ['sender לא מאומת', okFetch({ status: 515 }), 'permanent_error'],
    ['מספר לא תקין', okFetch({ status: 9 }), 'permanent_error'],
    ['אין יתרה', okFetch({ status: 4 }), 'permanent_error'],
    ['שעת שליחה אסורה', okFetch({ status: 5 }), 'retryable_error'],
    ['rate limit (HTTP 429)', okFetch({}, 429), 'retryable_error'],
    ['server error (HTTP 500)', okFetch({}, 500), 'delivery_unknown'],
    ['gateway timeout (HTTP 504)', okFetch({}, 504), 'delivery_unknown'],
    ['תשובה לא מובנת', async () => httpRes(200, null, { badJson: true }), 'delivery_unknown'],
    ['גוף בלי status', okFetch({ message: 'hello' }), 'delivery_unknown'],
    ['קוד ספק לא מוכר', okFetch({ status: 4242 }), 'delivery_unknown'],
    ['process failure (6)', okFetch({ status: 6 }), 'delivery_unknown'],
    ['timeout לפני יציאת הבקשה', throwingFetch(nodeErr('ECONNREFUSED')), 'retryable_error'],
    ['timeout אחרי יציאת הבקשה', throwingFetch(nodeErr('ABORT_ERR', 'AbortError')), 'delivery_unknown'],
    ['ניתוק אחרי התחברות', throwingFetch(nodeErr('ECONNRESET')), 'delivery_unknown'],
  ]
  for (const [name, fetchImpl, expected] of cases) {
    const { provider } = providerWith(fetchImpl)
    const r = await provider.send(MSG)
    chk(`${name} → ${expected}`, r.outcome === expected, r.errorCode ?? '')
  }
}

// ── 🔒 אין auto-retry לאף מצב delivery_unknown ─────────────────────────────
//
// ⚠️ זו הבדיקה המרכזית של השלב. ל-019 אין idempotency מוכחת: retry על תוצאה
// עמומה אינו "ניסיון נוסף" אלא SMS שני ללקוחה. finish_reminder_attempt
// מסמנת delivery_unknown כסופי (נבדק ב-test:reminders), וכאן מוכח שכל
// המצבים העמומים אכן מגיעים אליו ולא ל-retryable.
{
  const ambiguous = [
    ['HTTP 500', okFetch({}, 500)],
    ['HTTP 502', okFetch({}, 502)],
    ['HTTP 503', okFetch({}, 503)],
    ['HTTP 504', okFetch({}, 504)],
    ['AbortError', throwingFetch(nodeErr('ABORT_ERR', 'AbortError'))],
    ['ECONNRESET', throwingFetch(nodeErr('ECONNRESET'))],
    ['EPIPE', throwingFetch(nodeErr('EPIPE'))],
    ['socket hang up ללא קוד', throwingFetch(new Error('socket hang up'))],
    ['JSON פגום', async () => httpRes(200, null, { badJson: true })],
    ['status חסר', okFetch({ shipment_id: 'x' })],
    ['status לא מוכר', okFetch({ status: 12345 })],
    ['ספק 6', okFetch({ status: 6 })],
    ['ספק 998', okFetch({ status: 998 })],
    ['ספק 999', okFetch({ status: 999 })],
  ]
  let allUnknown = true
  for (const [name, fetchImpl] of ambiguous) {
    const { provider } = providerWith(fetchImpl)
    const r = await provider.send(MSG)
    const ok = r.outcome === 'delivery_unknown'
    if (!ok) allUnknown = false
    chk(`🔒 ${name} אינו retryable`, ok, r.outcome)
  }
  chk(`🔒 כל ${ambiguous.length} המצבים העמומים → delivery_unknown, אפס auto-retry`, allUnknown)
}

// ── retry עם אותה תזכורת שולח את אותו external_id ──────────────────────────
{
  const ids = []
  const { provider } = providerWith(async (_url, init) => {
    ids.push(JSON.parse(init.body).sms.destinations.phone[0].$.id)
    return httpRes(200, { status: 0, shipment_id: 'S' })
  })
  await provider.send(MSG)
  await provider.send(MSG)
  chk('⚠️ retry עם אותו reminder.id שולח את אותו external_id',
    ids.length === 2 && ids[0] === KEY && ids[1] === KEY)
}

// ── הספק לעולם אינו זורק ───────────────────────────────────────────────────
{
  const nasty = [
    async () => { throw nodeErr('EHOSTUNREACH') },
    async () => { throw 'מחרוזת ולא Error' },
    async () => ({ status: 200, json: async () => { throw new Error('boom') } }),
    async () => ({ status: undefined, json: async () => ({ status: 0 }) }),
  ]
  let threw = false
  for (const f of nasty) {
    const { provider } = providerWith(f)
    try { await provider.send(MSG) } catch { threw = true }
  }
  chk('🔒 הספק אינו זורק גם על תשובות חריגות', threw === false)
}

// ════════════════════════════════════════════════════════════════════════════
section('⚠️ אין דליפה ללוגים')
// ════════════════════════════════════════════════════════════════════════════

{
  const leakCases = [
    ['accepted', okFetch({ status: 0, shipment_id: 'S' })],
    ['permanent', okFetch({ status: 515 })],
    ['retryable', okFetch({ status: 5 })],
    ['delivery_unknown', throwingFetch(nodeErr('ECONNRESET'))],
    ['HTTP 500', okFetch({}, 500)],
  ]
  const all = []
  for (const [, fetchImpl] of leakCases) {
    const { provider, lines } = providerWith(fetchImpl)
    await provider.send(MSG)
    all.push(...lines)
  }
  const logged = all.join('\n')
  chk('⚠️ הלוג אינו מכיל את ה-token', !logged.includes(GOOD_ENV.SMS019_TOKEN))
  chk('⚠️ הלוג אינו מכיל את המספר ב-E.164', !logged.includes(PHONE))
  chk('⚠️ הלוג אינו מכיל את המספר המקומי', !logged.includes(LOCAL))
  chk('⚠️ הלוג אינו מכיל את גוף ההודעה', !logged.includes(BODY))
  chk('⚠️ הלוג אינו מכיל את שם המשתמש', !logged.includes(GOOD_ENV.SMS019_USERNAME))
  chk('הלוג כן מכיל את מפתח התזכורת (מזהה בלבד)', logged.includes(KEY))
  chk('הצלחה אינה מייצרת שורת לוג כלל', all.length === leakCases.length - 1)
}

// ⚠️ אף מסלול בקוד אינו מדפיס את גוף התשובה של הספק.
chk('🔒 הספק אינו מדפיס את גוף התשובה הגולמי',
  !/console\.(log|info|warn|error)\([^)]*\b(body|json|res)\b/.test(providerSrc))

/**
 * 🔒 גוף התשובה של 019 אינו יוצא מהספק — נבדק בהתנהגות ולא ב-regex.
 *
 * ⚠️ זו הבדיקה שמונעת raw response במסד. כל מה שהספק מחזיר נכתב ע"י
 * finishReminderAttempt לשורת התזכורת ולשורת הניסיון; אם מילה מהתשובה
 * הייתה נכנסת לכאן, היא הייתה נשמרת.
 */
{
  const ALLOWED_KEYS = new Set(['outcome', 'providerMessageId', 'errorCode'])
  const SECRET = 'סוד-שאסור-לצאת'
  const bodies = [
    { status: 0, shipment_id: 'SHIP-1', message: SECRET },
    { status: 515, message: SECRET, detail: { inner: SECRET } },
    { status: 4242, message: SECRET },
    { status: 6, message: SECRET },
    { message: SECRET },
  ]
  let extraKeys = []
  let leaked = false
  for (const body of bodies) {
    const { provider } = providerWith(okFetch(body))
    const r = await provider.send(MSG)
    extraKeys.push(...Object.keys(r).filter(k => !ALLOWED_KEYS.has(k)))
    if (JSON.stringify(r).includes(SECRET)) leaked = true
  }
  chk('🔒 התוצאה מכילה רק outcome/providerMessageId/errorCode',
    extraKeys.length === 0, extraKeys.join(','))
  chk('🔒 אף מילה מגוף התשובה של הספק אינה יוצאת מהספק', leaked === false)
}

// ── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
