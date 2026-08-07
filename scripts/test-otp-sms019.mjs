/**
 * בדיקות שלב 12B — חיבור קודי ה-OTP ל-019, בלי רשת אמיתית ובלי credentials.
 *
 * המיקוד: ההחלטות שאין דרך לתקן בדיעבד אם ישתבשו —
 *   1. שקוד ה-OTP לעולם אינו מגיע ללוג כשספק אמיתי פעיל.
 *   2. שאין נפילה לקונסול — בשום סביבה, בשום תצורה שבורה.
 *   3. שתוצאה עמומה אינה מוצגת ככישלון ואינה מפעילה retry.
 *   4. ששלב 12A לא זז מילימטר.
 *
 * ⚠️ ה-fetch מוזרק בכל בדיקה. הקובץ הזה לעולם אינו פותח חיבור.
 *
 * הרצה:  npm run test:otp-sms019
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(HERE, '..', p), 'utf8')

/** מסיר הערות — כדי שתיעוד שמצטט קוד ישן לא ייחשב לקוד */
const stripComments = code => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/**
 * מסיר טקסט קבוע ומשאיר **מזהים בלבד**.
 *
 * ⚠️ בלי זה סריקת הלוגים חסרת ערך: `console.error('[otp] ...')` היה נספר
 * כהדפסת OTP, ובדיקה שנופלת על תגית לוג היא בדיוק בדיקה שמישהו יכבה.
 * מה שמעניין הוא האם *משתנה* שמחזיק קוד, token, טלפון או גוף הודעה מועבר
 * ל-console — ולכן מחרוזות קבועות מוסרות, ומתוך template literals נשמרות
 * רק ההשמות `${...}`.
 */
const identifiersOnly = code => code
  .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, ' ')          // template בלי השמה
  .replace(/`((?:[^`\\]|\\.)*)`/g, (_m, inner) =>          // template עם השמה
    [...inner.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1]).join(' '))
  .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
  .replace(/"(?:[^"\\]|\\.)*"/g, ' ')

const { otpMessage } = await import('../lib/sms/templates.ts')
const { Sms019SmsProvider, createSms019SmsProvider } = await import('../lib/sms/sms019Provider.ts')
const { FailClosedSmsProvider } = await import('../lib/sms/failClosedProvider.ts')
const { ConsoleSmsProvider } = await import('../lib/sms/consoleProvider.ts')
const { resolveSmsProvider } = await import('../lib/sms/index.ts')
const { readSms019Config } = await import('../lib/reminders/sms019.ts')
const { resolveReminderProvider } = await import('../lib/reminders/provider.ts')

// ── קבועי בדיקה ─────────────────────────────────────────────────────────────
const PHONE = '+972541234567'
const LOCAL = '0541234567'
const CODE = '482913'
const TOKEN = 'tok_SECRET_VALUE_NEVER_LOGGED'
const OTP_TTL = 5

const GOOD_ENV = {
  SMS_PROVIDER: 'sms_019',
  SMS019_USERNAME: 'demo_user',
  SMS019_TOKEN: TOKEN,
  SMS019_SOURCE: 'SM BROWS',
}

const MSG = otpMessage(PHONE, CODE, OTP_TTL)

/** תשובת HTTP מזויפת */
const httpRes = (status, body, { badJson = false } = {}) => ({
  status,
  json: async () => {
    if (badJson) throw new SyntaxError('Unexpected token')
    return body
  },
})

/** בונה ספק OTP עם fetch ולוג מוזרקים */
const providerWith = (fetchImpl, env = GOOD_ENV) => {
  const lines = []
  const built = createSms019SmsProvider(env, { fetch: fetchImpl, log: l => lines.push(l) })
  if (!built.ok) throw new Error('תצורת הבדיקה עצמה פסולה: ' + built.problems.join('; '))
  return { provider: built.provider, lines }
}

/** ספק שמחזיר status מסוים ואוסף את הבקשות */
const providerReturning = (status, extra = {}) => {
  const calls = []
  const { provider, lines } = providerWith(async (url, init) => {
    calls.push({ url, init })
    return httpRes(200, { status, ...extra })
  })
  return { provider, lines, calls }
}

const errThrower = err => async () => { throw err }
const codeErr = (code, name) => { const e = new Error('x'); e.code = code; if (name) e.name = name; return e }

// ════════════════════════════════════════════════════════════════════════════
section('תבנית ההודעה')
// ════════════════════════════════════════════════════════════════════════════

{
  const body = MSG.body
  const units = body.length
  const isGsm7 = /^[\x20-\x7E\n\r]*$/.test(body)
  const segments = isGsm7
    ? (units <= 160 ? 1 : Math.ceil(units / 153))
    : (units <= 70 ? 1 : Math.ceil(units / 67))

  console.log(`   ${JSON.stringify(body)}`)
  chk('kind = otp', MSG.kind === 'otp')
  chk('היעד הוא ה-E.164 שהתקבל', MSG.to === PHONE)
  chk('הקוד מופיע בגוף ההודעה', body.includes(CODE))
  chk('משך התוקף מופיע', body.includes(String(OTP_TTL)))
  chk('🔒 מקטע SMS אחד בלבד', segments === 1, `${units} תווים, ${segments} מקטעים`)
  chk('⚠️ אורך ההודעה ≤ 70 תווים', units <= 70, `${units}`)

  // ⚠️ אמוג'י = surrogate pair = שתי יחידות UCS-2 בהודעה שנמדדת בתווים
  chk('⚠️ אין אמוג'.concat('י ואין surrogate pairs'), !/[\uD800-\uDFFF]/.test(body))
  chk('שם השולח בגוף ההודעה תואם ל-source המאושר', body.includes('SM BROWS'))
  chk('אזהרת ההנדסה החברתית נשמרה', body.includes('אין למסור'))
  chk('⚠️ אין קישור בהודעת OTP (פיתוי לפישינג)', !/https?:\/\//.test(body))
}

// ════════════════════════════════════════════════════════════════════════════
section('בחירת הספק — פיתוח')
// ════════════════════════════════════════════════════════════════════════════

{
  const p = resolveSmsProvider({ NODE_ENV: 'development' })
  chk('ללא SMS_PROVIDER בפיתוח → console', p instanceof ConsoleSmsProvider && p.name === 'console')
  chk('console אינו live', p.isLive === false)
}

{
  const p = resolveSmsProvider({ NODE_ENV: 'development', SMS_PROVIDER: 'console' })
  chk('console מפורש בפיתוח → console', p instanceof ConsoleSmsProvider)
}

{
  const p = resolveSmsProvider({ NODE_ENV: 'development', ...GOOD_ENV })
  chk('sms_019 עם credentials תקינים → הספק האמיתי', p instanceof Sms019SmsProvider)
  chk('sms_019 מסומן live', p.isLive === true && p.name === 'sms_019')
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 כשל בטוח — אין נפילה לקונסול')
// ════════════════════════════════════════════════════════════════════════════

const failCases = [
  ['credentials חסרים לגמרי', { SMS_PROVIDER: 'sms_019' }],
  ['token חסר', { SMS_PROVIDER: 'sms_019', SMS019_USERNAME: 'u', SMS019_SOURCE: 'SM BROWS' }],
  ['username חסר', { SMS_PROVIDER: 'sms_019', SMS019_TOKEN: TOKEN, SMS019_SOURCE: 'SM BROWS' }],
  ['source חסר', { SMS_PROVIDER: 'sms_019', SMS019_USERNAME: 'u', SMS019_TOKEN: TOKEN }],
  ['source פסול', { SMS_PROVIDER: 'sms_019', SMS019_USERNAME: 'u', SMS019_TOKEN: TOKEN, SMS019_SOURCE: 'שם בעברית' }],
  ['source ארוך מדי', { SMS_PROVIDER: 'sms_019', SMS019_USERNAME: 'u', SMS019_TOKEN: TOKEN, SMS019_SOURCE: 'ABCDEFGHIJKL' }],
  ['ספק לא מוכר', { SMS_PROVIDER: 'sms019' }],
  ['ספק לא מוכר 2', { SMS_PROVIDER: '019' }],
  ['ספק ריק', { SMS_PROVIDER: '   ' }],
]

for (const [label, env] of failCases) {
  for (const nodeEnv of ['development', 'production']) {
    const errs = []
    const orig = console.error
    console.error = (...a) => errs.push(a.join(' '))
    let p
    try { p = resolveSmsProvider({ NODE_ENV: nodeEnv, ...env }) } finally { console.error = orig }

    chk(`🔒 ${label} (${nodeEnv}) → כשל בטוח, לא console`,
      p instanceof FailClosedSmsProvider && !(p instanceof ConsoleSmsProvider), p.name)

    const joined = errs.join('\n')
    chk(`⚠️ ${label} (${nodeEnv}) — הלוג אינו מכיל את ה-token`, !joined.includes(TOKEN))
  }
}

{
  // 🔒 console בפרודקשן
  const errs = []
  const orig = console.error
  console.error = (...a) => errs.push(a.join(' '))
  let p
  try { p = resolveSmsProvider({ NODE_ENV: 'production', SMS_PROVIDER: 'console' }) }
  finally { console.error = orig }
  chk('🔒 console בפרודקשן → כשל בטוח', p instanceof FailClosedSmsProvider)

  const errs2 = []
  console.error = (...a) => errs2.push(a.join(' '))
  let p2
  try { p2 = resolveSmsProvider({ NODE_ENV: 'production' }) } finally { console.error = orig }
  chk('🔒 ללא SMS_PROVIDER בפרודקשן → כשל בטוח', p2 instanceof FailClosedSmsProvider)
}

{
  // ספק שנכשל בבטחה — מה הוא מחזיר ומה הוא לא מדפיס
  const logs = []
  const orig = { log: console.log, info: console.info, error: console.error, warn: console.warn }
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.join(' '))
  let r
  try { r = await new FailClosedSmsProvider('sms019_not_configured').send(MSG) }
  finally { Object.assign(console, orig) }

  chk('ספק כשל בטוח מחזיר ok:false', r.ok === false)
  chk('ואינו מסומן uncertain', r.uncertain === undefined)
  chk('🔒 ואינו מדפיס דבר', logs.length === 0, logs.join(' | '))
  chk('🔒 ובוודאי לא את הקוד', !logs.join('').includes(CODE))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 ConsoleSmsProvider — OTP בפרודקשן')
// ════════════════════════════════════════════════════════════════════════════

{
  const run = async (nodeEnv, allowFlag, kind) => {
    const prevEnv = process.env.NODE_ENV
    const prevFlag = process.env.SMS_ALLOW_CONSOLE_IN_PROD
    const logs = []
    const orig = { info: console.info, error: console.error }
    process.env.NODE_ENV = nodeEnv
    if (allowFlag === undefined) delete process.env.SMS_ALLOW_CONSOLE_IN_PROD
    else process.env.SMS_ALLOW_CONSOLE_IN_PROD = allowFlag
    console.info = (...a) => logs.push(a.join(' '))
    console.error = (...a) => logs.push(a.join(' '))
    try {
      const r = await new ConsoleSmsProvider().send({ ...MSG, kind })
      return { r, logs }
    } finally {
      Object.assign(console, orig)
      process.env.NODE_ENV = prevEnv
      if (prevFlag === undefined) delete process.env.SMS_ALLOW_CONSOLE_IN_PROD
      else process.env.SMS_ALLOW_CONSOLE_IN_PROD = prevFlag
    }
  }

  {
    const { r, logs } = await run('production', 'true', 'otp')
    chk('🔒 OTP בפרודקשן נדחה גם עם SMS_ALLOW_CONSOLE_IN_PROD=true', r.ok === false)
    chk('🔒 ⚠️ הקוד לא הודפס', !logs.join('').includes(CODE), logs.join(' | '))
    chk('errorCode ייעודי', r.error === 'console_provider_blocked_for_otp')
  }
  {
    const { r, logs } = await run('production', undefined, 'otp')
    chk('🔒 OTP בפרודקשן ללא דגל — נדחה', r.ok === false)
    chk('🔒 הקוד לא הודפס', !logs.join('').includes(CODE))
  }
  {
    const { r } = await run('production', 'true', 'reminder')
    chk('⚠️ הודעה שאינה OTP עם הדגל — עדיין מותרת (התנהגות קיימת)', r.ok === true)
  }
  {
    const { r, logs } = await run('development', undefined, 'otp')
    chk('בפיתוח הקוד כן מודפס — זו מטרת מצב הפיתוח', r.ok === true && logs.join('').includes(CODE))
    chk('⚠️ אך המספר ממוסך גם בפיתוח', !logs.join('').includes(PHONE))
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('הבקשה שנשלחת ל-019')
// ════════════════════════════════════════════════════════════════════════════

{
  const { provider, calls } = providerReturning(0, { shipment_id: 'SHIP-123' })
  const r = await provider.send(MSG)

  chk('status=0 → ok:true', r.ok === true && r.uncertain === undefined)
  chk('shipment_id נשמר כ-providerMessageId', r.providerMessageId === 'SHIP-123')
  chk('בוצעה בקשה אחת בדיוק', calls.length === 1)

  const { url, init } = calls[0]
  chk('🔒 הכתובת היא ה-endpoint של הפרודקשן', url === 'https://019sms.co.il/api', url)
  chk('🔒 ולא כתובת ה-test', !String(url).includes('/api/test'))
  chk('Authorization: Bearer', init.headers.Authorization === `Bearer ${TOKEN}`)

  const payload = JSON.parse(init.body)
  chk('המספר הומר לפורמט המקומי', payload.sms.destinations.phone[0]._ === LOCAL)
  chk('⚠️ E.164 אינו נשלח ל-019', !init.body.includes(PHONE))
  chk('source הוא השם המאושר', payload.sms.source === 'SM BROWS')
  chk('גוף ההודעה נשלח כמות שהוא', payload.sms.message === MSG.body)

  // 🔒 external_id
  const externalId = payload.sms.destinations.phone[0].$.id
  chk('🔒 external_id אינו הקוד', !externalId.includes(CODE))
  chk('🔒 external_id אינו הטלפון', !externalId.includes(LOCAL) && !externalId.includes(PHONE))
  chk('external_id הוא UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(externalId),
    externalId)

  // שתי שליחות → שני מזהים שונים
  const { provider: p2, calls: c2 } = providerReturning(0)
  await p2.send(MSG); await p2.send(MSG)
  const ids = c2.map(c => JSON.parse(c.init.body).sms.destinations.phone[0].$.id)
  chk('כל שליחה מקבלת external_id משלה', ids[0] !== ids[1])
}

// ════════════════════════════════════════════════════════════════════════════
section('מיפוי תגובות הספק')
// ════════════════════════════════════════════════════════════════════════════

const providerCases = [
  ['token שגוי (3)',            3,   'fail'],
  ['token פג (10)',             10,  'fail'],
  ['token לא תואם משתמש (11)',  11,  'fail'],
  ['token לא נמצא (504)',       504, 'fail'],
  ['source לא מאושר (515)',     515, 'fail'],
  ['חוסר יתרה (4)',             4,   'fail'],
  ['חוסר יתרה (12)',            12,  'fail'],
  ['יעד חסום (8)',              8,   'fail'],
  ['מספר לא תקין (9)',          9,   'fail'],
  ['חסימה זמנית (715)',         715, 'fail'],
  ['שעת שליחה (5)',             5,   'fail'],
  ['כשל עיבוד (6)',             6,   'uncertain'],
  ['שגיאה לא ידועה (998)',      998, 'uncertain'],
  ['פנה לתמיכה (999)',          999, 'uncertain'],
  ['קוד לא מוכר (12345)',       12345, 'uncertain'],
]

for (const [label, status, expect] of providerCases) {
  const { provider, lines } = providerReturning(status)
  const r = await provider.send(MSG)

  if (expect === 'fail') {
    chk(`${label} → ok:false`, r.ok === false && !r.uncertain, JSON.stringify(r))
  } else {
    chk(`${label} → ok:true + uncertain`, r.ok === true && r.uncertain === true, JSON.stringify(r))
  }

  const joined = lines.join('\n') + JSON.stringify(r)
  chk(`⚠️ ${label} — אין קוד OTP בלוג ובתוצאה`, !joined.includes(CODE))
  chk(`⚠️ ${label} — אין token`, !joined.includes(TOKEN))
  chk(`⚠️ ${label} — אין מספר מלא`, !joined.includes(PHONE) && !joined.includes(LOCAL))
  chk(`⚠️ ${label} — אין גוף הודעה`, !joined.includes(MSG.body))
}

// ── תעבורה ו-HTTP ───────────────────────────────────────────────────────────

{
  const transport = [
    ['timeout (AbortError)', errThrower(codeErr('ABORT_ERR', 'AbortError')), 'uncertain'],
    ['DNS נכשל (ENOTFOUND)', errThrower(codeErr('ENOTFOUND')), 'fail'],
    ['חיבור נדחה (ECONNREFUSED)', errThrower(codeErr('ECONNREFUSED')), 'fail'],
    ['חיבור נקטע (ECONNRESET)', errThrower(codeErr('ECONNRESET')), 'uncertain'],
  ]
  for (const [label, fetchImpl, expect] of transport) {
    const { provider, lines } = providerWith(fetchImpl)
    const r = await provider.send(MSG)
    chk(`${label} → ${expect}`,
      expect === 'uncertain' ? (r.ok === true && r.uncertain === true) : (r.ok === false),
      JSON.stringify(r))
    chk(`⚠️ ${label} — אין קוד/token/מספר בלוג`,
      !(lines.join('') + JSON.stringify(r)).match(new RegExp(`${CODE}|${TOKEN}|\\${PHONE}|${LOCAL}`)))
  }
}

{
  const httpCases = [
    ['HTTP 429', 429, 'fail'],
    ['HTTP 500', 500, 'uncertain'],
    ['HTTP 502', 502, 'uncertain'],
    ['HTTP 503', 503, 'uncertain'],
    ['HTTP 401', 401, 'fail'],
    ['HTTP 403 (חסימת IP)', 403, 'fail'],
  ]
  for (const [label, status, expect] of httpCases) {
    const { provider } = providerWith(async () => httpRes(status, {}))
    const r = await provider.send(MSG)
    chk(`${label} → ${expect}`,
      expect === 'uncertain' ? (r.ok === true && r.uncertain === true) : (r.ok === false),
      JSON.stringify(r))
  }
}

{
  const { provider } = providerWith(async () => httpRes(200, null, { badJson: true }))
  const r = await provider.send(MSG)
  chk('JSON פגום ב-HTTP 200 → uncertain', r.ok === true && r.uncertain === true, JSON.stringify(r))
}

{
  const { provider } = providerWith(async () => httpRes(200, { no_status_field: true }))
  const r = await provider.send(MSG)
  chk('תשובה בלי status → uncertain', r.ok === true && r.uncertain === true, JSON.stringify(r))
}

// ── ולידציה מקומית: נכשלת לפני שנוצר חיבור ──────────────────────────────────

{
  let called = false
  const { provider } = providerWith(async () => { called = true; return httpRes(200, { status: 0 }) })
  const r = await provider.send({ ...MSG, to: '+14155551234' })
  chk('יעד לא ישראלי → ok:false', r.ok === false)
  chk('🔒 ולא נוצר חיבור כלל', called === false)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 notDelivered — הדגל שמתיר למחוק את שורת ה-OTP')
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ זהו הדגל המסוכן ביותר בשלב הזה: הוא מתיר למחוק שורת OTP. דלוק בטעות
 * על תוצאה עמומה = הלקוחה מחזיקה SMS עם קוד שהמערכת כבר לא מכירה.
 */
{
  // 🔒 6. accepted — השורה נשארת
  const { provider } = providerReturning(0, { shipment_id: 'S1' })
  const r = await provider.send(MSG)
  chk('🔒 6. accepted → notDelivered כבוי', r.ok === true && r.notDelivered === undefined,
    JSON.stringify(r))
}

{
  // 🔒 5. delivery_unknown — השורה נשארת. כל התרחישים.
  const unknownCases = [
    ['timeout', errThrower(codeErr('ABORT_ERR', 'AbortError'))],
    ['ECONNRESET', errThrower(codeErr('ECONNRESET'))],
    ['HTTP 500', async () => httpRes(500, {})],
    ['HTTP 503', async () => httpRes(503, {})],
    ['JSON פגום', async () => httpRes(200, null, { badJson: true })],
    ['בלי שדה status', async () => httpRes(200, { x: 1 })],
    ['status 6', async () => httpRes(200, { status: 6 })],
    ['status 998', async () => httpRes(200, { status: 998 })],
    ['status 999', async () => httpRes(200, { status: 999 })],
    ['קוד לא מוכר', async () => httpRes(200, { status: 4242 })],
  ]
  for (const [label, impl] of unknownCases) {
    const { provider } = providerWith(impl)
    const r = await provider.send(MSG)
    chk(`🔒 5. ${label} → uncertain **בלי** notDelivered`,
      r.ok === true && r.uncertain === true && r.notDelivered === undefined,
      JSON.stringify(r))
  }
}

{
  // כשל ודאי → notDelivered דלוק
  const provenCases = [
    ['permanent — token (3)', async () => httpRes(200, { status: 3 })],
    ['permanent — source (515)', async () => httpRes(200, { status: 515 })],
    ['permanent — יתרה (4)', async () => httpRes(200, { status: 4 })],
    ['permanent — יעד (9)', async () => httpRes(200, { status: 9 })],
    ['permanent — HTTP 401', async () => httpRes(401, {})],
    ['retryable — HTTP 429', async () => httpRes(429, {})],
    ['retryable — status 5', async () => httpRes(200, { status: 5 })],
    ['retryable — ENOTFOUND', errThrower(codeErr('ENOTFOUND'))],
    ['retryable — ECONNREFUSED', errThrower(codeErr('ECONNREFUSED'))],
  ]
  for (const [label, impl] of provenCases) {
    const { provider } = providerWith(impl)
    const r = await provider.send(MSG)
    chk(`🔒 ${label} → notDelivered דלוק`,
      r.ok === false && r.notDelivered === true && r.uncertain === undefined,
      JSON.stringify(r))
  }
}

{
  // 🔒 האינווריאנטה: השניים לעולם לא יחד
  const all = [
    async () => httpRes(200, { status: 0 }),
    async () => httpRes(200, { status: 3 }),
    async () => httpRes(200, { status: 998 }),
    async () => httpRes(429, {}),
    async () => httpRes(500, {}),
    errThrower(codeErr('ENOTFOUND')),
    errThrower(codeErr('ECONNRESET')),
  ]
  let violations = 0
  for (const impl of all) {
    const { provider } = providerWith(impl)
    const r = await provider.send(MSG)
    if (r.uncertain && r.notDelivered) violations++
    if (r.ok && r.notDelivered) violations++
  }
  chk('🔒 uncertain ו-notDelivered לעולם אינם דלוקים יחד', violations === 0)
}

{
  // ולידציה מקומית — הוכח שלא נשלח
  const { provider } = providerWith(async () => httpRes(200, { status: 0 }))
  const r = await provider.send({ ...MSG, to: '+14155551234' })
  chk('🔒 יעד לא נתמך → notDelivered דלוק (נכשל לפני החיבור)',
    r.ok === false && r.notDelivered === true, JSON.stringify(r))
}

{
  // ספק שנכשל בבטחה — שום דבר לא יצא, בוודאות
  const r = await new FailClosedSmsProvider('sms019_not_configured').send(MSG)
  chk('🔒 ספק כשל בטוח → notDelivered דלוק', r.ok === false && r.notDelivered === true)
}

{
  // ⚠️ ספק שזרק — לא מסמנים. חריגה יכולה לקרות גם אחרי שהבקשה יצאה.
  const { sendSms, __resetSmsProviderCache } = await import('../lib/sms/index.ts')
  const route = stripComments(src('lib/sms/index.ts'))
  chk('⚠️ ספק שזרק אינו מסומן notDelivered',
    /catch[\s\S]*?return\s*\{\s*ok:\s*false,\s*error:\s*'provider_error'\s*\}/.test(route),
    'ברירת המחדל היא לא למחוק')
  void sendSms; void __resetSmsProviderCache
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 ה-route מוחק רק על כשל ודאי')
// ════════════════════════════════════════════════════════════════════════════

{
  const route = stripComments(src('app/api/auth/otp/send/route.ts'))

  chk('discardOtp מיובאת', route.includes('discardOtp'))
  chk('🔒 discardOtp נקראת פעם אחת בדיוק', (route.match(/discardOtp\(/g) ?? []).length === 1)
  chk('🔒 והיא מותנית ב-sms.notDelivered',
    /if\s*\(\s*sms\.notDelivered\s*&&/.test(route))
  chk('🔒 הקריאה יושבת בענף הכישלון (!sms.ok) בלבד',
    route.indexOf('if (!sms.ok)') < route.indexOf('discardOtp(') &&
    route.indexOf('discardOtp(') < route.indexOf('sms.uncertain'))
  chk('⚠️ המחיקה מותנית גם בקיום otpId',
    /typeof result\.otpId === 'number'/.test(route))

  /*
   * ⚠️ הבדיקה ממוקדת בשורת הלוג של כישלון הניקוי בלבד.
   *
   * שורת הלוג של כשל השליחה מדפיסה `sms.error` — וזה תקין: זהו slug מהמיפוי
   * שלנו (`sms019_...`), לא טקסט מהספק. הבדיקות שלמעלה כבר מוכיחות שאין בו
   * token, מספר או גוף הודעה בכל 15 תרחישי הספק.
   */
  const discardLog = route.split('\n').find(l => l.includes('discard did not remove'))
  chk('שורת הלוג של כישלון הניקוי אותרה', Boolean(discardLog), discardLog ?? '')
  chk('🔒 כישלון ניקוי מדפיס slug בלבד — בלי מספר, מזהה או פרטי ספק',
    Boolean(discardLog) &&
    /^\s*console\.error\([^,]+,\s*discarded\s*\)\s*$/.test(identifiersOnly(discardLog)
      .replace(/console\.error\(\s*,/, "console.error('x',")),
    identifiersOnly(discardLog ?? ''))
  chk('🔒 התשובה בכשל היא אותה תשובה כללית תמיד',
    (route.match(/error: 'sms_failed'/g) ?? []).length === 1)

  const store = stripComments(src('lib/db/otpStore.ts'))
  chk('⚠️ discardOtp אינה מקבלת את הקוד הגלוי',
    /export async function discardOtp\(\s*otpId: number,\s*phoneE164: string,\s*purpose: OtpPurpose,?\s*\)/.test(store))
  chk('⚠️ otpId מוחזר רק בהנפקה מוצלחת',
    store.includes('otpId: typeof result.otp_id') &&
    !/limit:[\s\S]{0,200}otpId/.test(store))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 אין retry אוטומטי')
// ════════════════════════════════════════════════════════════════════════════

for (const [label, impl] of [
  ['timeout', errThrower(codeErr('ABORT_ERR', 'AbortError'))],
  ['HTTP 500', async () => httpRes(500, {})],
  ['status 998', async () => httpRes(200, { status: 998 })],
  ['status 5 (זמני)', async () => httpRes(200, { status: 5 })],
]) {
  let calls = 0
  const { provider } = providerWith(async (...a) => { calls++; return impl(...a) })
  await provider.send(MSG)
  chk(`🔒 ${label} — בקשה אחת בלבד, אין ניסיון חוזר`, calls === 1, `calls=${calls}`)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 שלב 12A לא זז')
// ════════════════════════════════════════════════════════════════════════════

{
  // ⚠️ שני המשתנים בלתי תלויים לחלוטין
  const r1 = resolveReminderProvider({ ...GOOD_ENV, NODE_ENV: 'development' })
  chk('🔒 SMS_PROVIDER=sms_019 אינו מדליק את התזכורות',
    r1.name === 'disabled', r1.name)

  // ⚠️ credentials של 019 קיימים בסביבה, אך SMS_PROVIDER אינו מוגדר. מסלול
  // ה-OTP חייב **לא** לבחור את 019 רק כי המפתחות שם.
  const r2 = resolveSmsProvider({
    NODE_ENV: 'development',
    REMINDER_PROVIDER: 'sms_019',
    SMS019_USERNAME: 'u', SMS019_TOKEN: TOKEN, SMS019_SOURCE: 'SM BROWS',
  })
  chk('🔒 REMINDER_PROVIDER=sms_019 אינו מדליק את ה-OTP',
    !(r2 instanceof Sms019SmsProvider) && r2.isLive === false, r2.name)

  const r2p = resolveSmsProvider({
    NODE_ENV: 'production',
    REMINDER_PROVIDER: 'sms_019',
    SMS019_USERNAME: 'u', SMS019_TOKEN: TOKEN, SMS019_SOURCE: 'SM BROWS',
  })
  chk('🔒 וגם בפרודקשן — כשל בטוח ולא 019', r2p instanceof FailClosedSmsProvider, r2p.name)

  const r3 = resolveReminderProvider({
    ...GOOD_ENV, REMINDER_PROVIDER: 'sms_019', NODE_ENV: 'development',
  })
  chk('שני המשתנים יחד — שניהם נדלקים', r3.name === 'sms_019')
}

{
  // קבצי 12A לא שונו
  const sms019 = src('lib/reminders/sms019.ts')
  const mapping = src('lib/reminders/sms019Mapping.ts')
  const provider = src('lib/reminders/provider.ts')
  const dispatch = src('lib/reminders/dispatch.ts')

  chk('🔒 lib/reminders/sms019.ts אינו מייבא מ-lib/sms', !sms019.includes('@/lib/sms'))
  chk('🔒 lib/reminders/sms019Mapping.ts אינו מייבא מ-lib/sms', !mapping.includes('@/lib/sms'))
  chk('🔒 lib/reminders/provider.ts אינו מייבא מ-lib/sms', !provider.includes('@/lib/sms'))
  chk('🔒 dispatch.ts אינו מייבא מ-lib/sms ואינו קורא ל-sendSms',
    !dispatch.includes('@/lib/sms') && !dispatch.includes('sendSms'))
  chk('⚠️ התלות היא חד-כיוונית: lib/sms → lib/reminders בלבד',
    src('lib/sms/sms019Provider.ts').includes('@/lib/reminders/sms019'))
}

{
  // ⚠️ המתאם אינו יודע על כתובת ה-test
  const adapter = src('lib/sms/sms019Provider.ts')
  chk('🔒 המתאם אינו מזכיר את SMS019_TEST_API_URL', !adapter.includes('SMS019_TEST_API_URL'))
  chk('🔒 המתאם אינו קורא כתובת מ-env', !/SMS019_BASE_URL|SMS019_API_URL\s*=/.test(adapter))
  chk('🔒 המתאם אינו משכפל את מיפוי קודי השגיאה', !adapter.includes('sms019_auth_invalid_token'))
}

// ════════════════════════════════════════════════════════════════════════════
section('סריקת מקור: אין OTP ואין סוד בלוגים')
// ════════════════════════════════════════════════════════════════════════════

{
  const files = [
    'lib/sms/index.ts',
    'lib/sms/sms019Provider.ts',
    'lib/sms/failClosedProvider.ts',
    'lib/sms/templates.ts',
    'lib/db/otpStore.ts',
    'app/api/auth/otp/send/route.ts',
    'app/api/auth/otp/verify/route.ts',
  ]

  /** כל הארגומנטים שמועברים ל-console בקובץ, כמזהים בלבד */
  const loggedIdentifiers = f => {
    const code = stripComments(src(f))
    return code
      .split('\n')
      .filter(l => /console\.(log|info|warn|error)/.test(l))
      .map(identifiersOnly)
      .join('\n')
  }

  for (const f of files) {
    const logged = loggedIdentifiers(f)

    chk(`${f} — אין הדפסת גוף הודעה`, !/\.body\b/.test(logged), logged.slice(0, 80))
    chk(`${f} — אין הדפסת הקוד`, !/\b(code|otpCode|candidateHash|codeHash)\b/.test(logged),
      logged.slice(0, 80))
    chk(`${f} — אין הדפסת token`, !/token/i.test(logged), logged.slice(0, 80))
    chk(`${f} — אין הדפסת טלפון לא ממוסך`,
      !/\bphone(E164)?\b/.test(logged.replace(/maskPhone\([^)]*\)/g, '')), logged.slice(0, 80))
    chk(`${f} — אין הדפסת message/details/hint של שגיאת DB`,
      !/error\.(message|details|hint)\b/.test(logged), logged.slice(0, 80))
  }

  // ⚠️ בדיקה שלילית: המסננת חייבת לתפוס הדפסה אמיתית. בלי זה אין לדעת אם
  // היא עוברת כי הקוד נקי או כי הרגקסים לא מוצאים כלום לעולם.
  const BAD = `console.error('[otp] failed', code, message.body, this.config.token, phoneE164)`
  const badIds = identifiersOnly(BAD)
  chk('⚠️ המסננת תופסת הדפסת code', /\bcode\b/.test(badIds))
  chk('⚠️ המסננת תופסת הדפסת body', /\.body\b/.test(badIds))
  chk('⚠️ המסננת תופסת הדפסת token', /token/i.test(badIds))
  chk('⚠️ המסננת תופסת הדפסת טלפון', /\bphone(E164)?\b/.test(badIds))
  chk('⚠️ והיא אינה נופלת על תגית לוג קבועה',
    !/\bcode\b/.test(identifiersOnly(`console.error('[otp] code failed')`)))

  // ⚠️ הספק היחיד שכן מדפיס גוף הודעה הוא ConsoleSmsProvider — וזו מטרתו.
  const consoleSrc = stripComments(src('lib/sms/consoleProvider.ts'))
  chk('⚠️ ConsoleSmsProvider הוא הספק היחיד שמדפיס גוף הודעה',
    consoleSrc.includes('message.body') && !src('lib/sms/sms019Provider.ts').includes('.body}'))
  chk('🔒 והוא מסרב ל-OTP לפני שהוא בכלל מסתכל על הדגל',
    consoleSrc.includes("message.kind === 'otp'") &&
    consoleSrc.indexOf("message.kind === 'otp'") < consoleSrc.indexOf('SMS_ALLOW_CONSOLE_IN_PROD'))
}

// ════════════════════════════════════════════════════════════════════════════
section('ה-route: תשובה כללית ואינה מסגירה קיום לקוחה')
// ════════════════════════════════════════════════════════════════════════════

{
  const route = stripComments(src('app/api/auth/otp/send/route.ts'))

  chk('⚠️ אין בדיקת קיום לקוחה לפני שליחה',
    !/resolveCustomer|getCustomer|isAdmin|from\('customers'\)/.test(route))
  chk('התשובה המוצלחת מכילה maskedPhone בלבד', route.includes('maskPhone(phone)'))

  // ⚠️ התשובה ללקוחה זהה בין מספר רשום ללא רשום — אחרת ה-endpoint הוא כלי
  // לברר אילו מספרים הם לקוחות של העסק.
  const okBody = route.split('return NextResponse.json({').pop() ?? ''
  chk('⚠️ המספר המלא אינו מוחזר ללקוחה', !/^\s*phone,/m.test(okBody))

  // הנוסח בכשל אינו מסגיר את הספק ואינו מבחין בין סוגי תקלה
  const failBranch = (route.split("error: 'sms_failed'")[1] ?? '').split('}')[0]
  chk('כשל שליחה → נוסח כללי אחד',
    route.includes('לא הצלחנו לשלוח את ההודעה') && !/515|יתרה|token|019/.test(failBranch),
    failBranch.trim().slice(0, 60))

  chk('🔒 uncertain → 200 עם notice, לא כישלון',
    route.includes('sms.uncertain') && route.includes('notice'))

  // ⚠️ "אין retry" נמדד בקריאה אחת ל-sendSms, לא בחיפוש המילה retry
  // (retryAfterSec הוא שדה תשובה לגיטימי ואינו ניסיון חוזר).
  chk('🔒 sendSms נקראת פעם אחת בדיוק', (route.match(/sendSms\(/g) ?? []).length === 1)
  chk('🔒 אין לולאה ב-route', !/\bfor\s*\(|\bwhile\s*\(|\.map\(.*sendSms/.test(route))

  const verify = stripComments(src('app/api/auth/otp/verify/route.ts'))
  const verifyLogged = verify.split('\n')
    .filter(l => /console\./.test(l)).map(identifiersOnly).join('\n')
  chk('verify: הקוד אינו נרשם ללוג', !/\bcode\b/.test(verifyLogged), verifyLogged.slice(0, 60))
  chk('verify: הטלפון אינו נרשם ללוג', !/\bphone\b/.test(verifyLogged))
}

// ── סיכום ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} נכשלו`)
console.log('⚠️ לא נפתח אף חיבור רשת ולא נעשה שימוש ב-credentials אמיתיים')
process.exit(failed === 0 ? 0 : 1)
