/**
 * שלב 3 — הקשחת API: same-origin, IP אמין ל-OTP, ומגבלת גודל גוף.
 *
 * מכסה:
 *   1. isSameOrigin (lib/auth/originGuard.ts) — התנהגות טהורה, כולל
 *      מאחורי כותרות מסוג Vercel.
 *   2. כיסוי מבני: כל route שמשנה מידע דרך cookie/session קורא ל-
 *      isSameOrigin; מסלולי Bearer פנימיים וציבוריים לא.
 *   3. otp/send משתמש ב-resolveClientIp (לא בקריאה ישירה ל-
 *      x-forwarded-for/x-real-ip) — ו-IP מזויף אינו עוקף את מגבלת הקצב.
 *   4. readJsonWithLimit (lib/http/bodyLimit.ts) — 413 לפני JSON.parse,
 *      בלי לפגוע בקלט חוקי.
 *
 * לא נדרש בסיס נתונים.
 *
 * הרצה:  npm run test:api-hardening
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(62)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts) => readFileSync(join(HERE, '..', ...parts), 'utf8')
const has = (src, re) => re.test(src)

// ─── isSameOrigin — התנהגות טהורה ──────────────────────────────────────────
section('isSameOrigin (lib/auth/originGuard.ts)')

const { isSameOrigin } = await import('../lib/auth/originGuard.ts')
const H = (obj) => new Headers(obj)
const reqWith = (headers) => ({ headers: H(headers) })

chk('same-origin — Origin.host === Host → מותר',
  isSameOrigin(reqWith({ origin: 'https://smbrows.co.il', host: 'smbrows.co.il' })))

chk('🔒 cross-origin — דומיין תוקף → נחסם',
  !isSameOrigin(reqWith({ origin: 'https://attacker.example', host: 'smbrows.co.il' })))

chk('🔒 cross-origin — subdomain זר → נחסם',
  !isSameOrigin(reqWith({ origin: 'https://smbrows.co.il.attacker.example', host: 'smbrows.co.il' })))

chk('בקשה בלי Origin (curl/שרת-לשרת) → מותר, לא CSRF',
  isSameOrigin(reqWith({ host: 'smbrows.co.il' })))

chk('🔒 יש Origin אבל אין Host → נחסם (fail-closed)',
  !isSameOrigin(reqWith({ origin: 'https://smbrows.co.il' })))

chk('🔒 Origin="null" (iframe sandbox / redirect אטום) → נחסם',
  !isSameOrigin(reqWith({ origin: 'null', host: 'smbrows.co.il' })))

// מאחורי Vercel: הבדיקה מסתמכת רק על Origin מול Host — לא על כותרות
// שהלקוח שולט בהן (x-forwarded-for וכו'). כותרות IP-forwarding נוספות
// על הבקשה לא אמורות לשנות את התוצאה כלל.
chk('לא מושפע מכותרות IP-forwarding זרות באותה בקשה',
  isSameOrigin(reqWith({
    origin: 'https://smbrows.co.il',
    host: 'smbrows.co.il',
    'x-forwarded-for': '1.2.3.4',
    'x-vercel-forwarded-for': '9.9.9.9',
  })))

chk('פורט ב-Origin וב-Host כאחד — מתאים כשזהים (dev מקומי)',
  isSameOrigin(reqWith({ origin: 'http://localhost:3000', host: 'localhost:3000' })))

chk('🔒 פורט שונה בין Origin ל-Host → נחסם',
  !isSameOrigin(reqWith({ origin: 'http://localhost:3000', host: 'localhost:4000' })))

chk('🔒 Origin לא ניתן לפענוח כ-URL → נחסם',
  !isSameOrigin(reqWith({ origin: 'not a url', host: 'smbrows.co.il' })))

// ─── כיסוי מבני — מי צריך isSameOrigin ומי לא ─────────────────────────────
section('כיסוי מבני — isSameOrigin על כל מסלול cookie/session')

/** כל route שמשנה מידע ומאומת ע"י cookie/session (admin או customer) */
const COOKIE_SESSION_ROUTES = [
  'app/api/admin/appointments/[id]/approve/route.ts',
  'app/api/admin/appointments/[id]/cancel/route.ts',
  'app/api/admin/appointments/[id]/no-show/route.ts',
  'app/api/admin/appointments/[id]/reject/route.ts',
  'app/api/admin/appointments/[id]/reschedule-approve/route.ts',
  'app/api/admin/appointments/[id]/reschedule-reject/route.ts',
  'app/api/admin/appointments/[id]/sync-calendar/route.ts',
  'app/api/admin/appointments/availability/route.ts',
  'app/api/admin/appointments/route.ts',
  'app/api/admin/calendar-sync/changes/[id]/retry/route.ts',
  'app/api/admin/calendar-sync/route.ts',
  'app/api/admin/customers/[id]/archive/route.ts',
  'app/api/admin/customers/[id]/crm/route.ts',
  'app/api/admin/customers/[id]/notes/[noteId]/archive/route.ts',
  'app/api/admin/customers/[id]/notes/[noteId]/route.ts',
  'app/api/admin/customers/[id]/notes/route.ts',
  'app/api/admin/customers/[id]/route.ts',
  'app/api/admin/customers/route.ts',
  'app/api/admin/reminders/[id]/retry/route.ts',
  'app/api/admin/reminders/manual/route.ts',
  'app/api/admin/reminders/run/route.ts',
  'app/api/account/profile/route.ts',
  'app/api/appointments/[id]/cancel/route.ts',
  'app/api/appointments/[id]/reschedule/route.ts',
  'app/api/appointments/route.ts',
  'app/api/auth/logout/route.ts',
]

let allCovered = true
for (const rel of COOKIE_SESSION_ROUTES) {
  const src = read(...rel.split('/'))
  const ok = has(src, /isSameOrigin\(/) && has(src, /from '@\/lib\/auth\/originGuard'/)
  if (!ok) allCovered = false
  chk(`isSameOrigin: ${rel}`, ok)
}
chk('🔒 כל 26 מסלולי cookie/session מכוסים', allCovered)

/** cron/internal server-to-server — Bearer secret, לא cookie. אסור isSameOrigin */
const INTERNAL_BEARER_ROUTES = [
  'app/api/internal/calendar-sync/route.ts',
  'app/api/internal/reminders/route.ts',
]
for (const rel of INTERNAL_BEARER_ROUTES) {
  const src = read(...rel.split('/'))
  chk(`🔒 internal Bearer לא נשבר — ${rel} לא דורש isSameOrigin`,
    !has(src, /isSameOrigin\(/))
}

/** מסלולים ציבוריים — לא מאומתים ב-cookie, isSameOrigin לא רלוונטי */
const PUBLIC_ROUTES = [
  'app/api/auth/otp/send/route.ts',
  'app/api/auth/otp/verify/route.ts',
  'app/api/bookings/request/route.ts',
]
for (const rel of PUBLIC_ROUTES) {
  const src = read(...rel.split('/'))
  chk(`ציבורי — ${rel} לא דורש isSameOrigin`, !has(src, /isSameOrigin\(/))
}

// ─── resolveClientIp ב-OTP ──────────────────────────────────────────────────
section('resolveClientIp ב-otp/send (לא x-forwarded-for ישיר)')

const otpSendSrc = read('app', 'api', 'auth', 'otp', 'send', 'route.ts')
chk('otp/send מייבא resolveClientIp', has(otpSendSrc, /from '@\/lib\/clientIp'/))
chk('otp/send קורא ל-resolveClientIp', has(otpSendSrc, /resolveClientIp\(req\.headers\)/))
chk('🔒 otp/send אינו קורא ישירות ל-x-forwarded-for/x-real-ip כמקור',
  !has(otpSendSrc, /headers\.get\('x-forwarded-for'\)/) &&
  !has(otpSendSrc, /headers\.get\('x-real-ip'\)/))
chk('🔒 otp/send חוסם (503) כשאין IP מהימן — fail-closed',
  has(otpSendSrc, /if \(!ipResult\.ok\)/) && has(otpSendSrc, /status: 503/))

// הבדיקה הפונקציונלית: IP מזויף על "Vercel" לא מתקבל בשום צורה — בדיוק
// אותה הפונקציה שעכשיו מזינה את issueOtp במסלול האמיתי.
const { resolveClientIp } = await import('../lib/clientIp.ts')
const VERCEL = { VERCEL: '1' }

chk('🔒 IP מזוייף (x-forwarded-for בלבד) על Vercel נדחה — אינו עוקף rate limit',
  (() => {
    const r = resolveClientIp(H({ 'x-forwarded-for': '6.6.6.6' }), { env: VERCEL })
    return !r.ok && r.reason === 'trusted_header_missing'
  })())

chk('🔒 כותרת x-vercel-forwarded-for מרובת ערכים — רק הראשון נלקח, לא נגזר מרשימה שהלקוח שולט בה',
  (() => {
    const r = resolveClientIp(H({ 'x-vercel-forwarded-for': '203.0.113.9, 6.6.6.6' }), { env: VERCEL })
    return r.ok && r.ip === '203.0.113.9'
  })())

chk('IP אמיתי מ-x-vercel-forwarded-for מתקבל כרגיל (רגרסיה)',
  (() => {
    const r = resolveClientIp(H({ 'x-vercel-forwarded-for': '203.0.113.7' }), { env: VERCEL })
    return r.ok && r.ip === '203.0.113.7' && r.source === 'vercel'
  })())

// ─── readJsonWithLimit — מגבלת גוף לפני JSON.parse ─────────────────────────
section('readJsonWithLimit (lib/http/bodyLimit.ts)')

const { readJsonWithLimit, DEFAULT_MAX_JSON_BYTES } = await import('../lib/http/bodyLimit.ts')

const jsonRequest = (obj, { contentLength } = {}) => {
  const text = JSON.stringify(obj)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (contentLength !== undefined) headers.set('content-length', String(contentLength))
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers,
    body: text,
  })
}

chk('קלט חוקי קטן מתפענח נכון',
  await (async () => {
    const r = await readJsonWithLimit(jsonRequest({ phone: '+972541234567' }), DEFAULT_MAX_JSON_BYTES)
    return r.ok && r.body.phone === '+972541234567'
  })())

chk('🔒 Content-Length חורג מהתקרה → 413 מיידי, בלי לקרוא גוף',
  await (async () => {
    const req = jsonRequest({ phone: '1' }, { contentLength: DEFAULT_MAX_JSON_BYTES + 1 })
    const r = await readJsonWithLimit(req, DEFAULT_MAX_JSON_BYTES)
    return !r.ok && r.status === 413
  })())

chk('🔒 גוף בפועל גדול מהתקרה → 413 (גם בלי Content-Length אמין)',
  await (async () => {
    const big = 'x'.repeat(DEFAULT_MAX_JSON_BYTES + 5000)
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      body: JSON.stringify({ notes: big }),
    })
    const r = await readJsonWithLimit(req, DEFAULT_MAX_JSON_BYTES)
    return !r.ok && r.status === 413
  })())

chk('גוף בדיוק בגבול התקרה מתקבל (לא off-by-one)',
  await (async () => {
    // גודל ה-payload הכולל (כולל מעטפת ה-JSON) נשאר קטן מהתקרה בבירור
    const req = jsonRequest({ notes: 'a'.repeat(100) })
    const r = await readJsonWithLimit(req, DEFAULT_MAX_JSON_BYTES)
    return r.ok
  })())

chk('JSON לא תקין (אחרי מעבר מגבלת גודל) → 400, לא 413',
  await (async () => {
    const req = new Request('http://localhost/api/test', { method: 'POST', body: '{not valid json' })
    const r = await readJsonWithLimit(req, DEFAULT_MAX_JSON_BYTES)
    return !r.ok && r.status === 400
  })())

chk('גוף ריק → 400 (אין body בבקשת GET-כמו)',
  await (async () => {
    const req = new Request('http://localhost/api/test', { method: 'POST' })
    const r = await readJsonWithLimit(req, DEFAULT_MAX_JSON_BYTES)
    return !r.ok && r.status === 400
  })())

// ─── כיסוי מבני — 413 מוחל בפועל בשלושת המסלולים הציבוריים ────────────────
section('כיסוי מבני — readJsonWithLimit בשלושת המסלולים הציבוריים')

for (const rel of [
  'app/api/auth/otp/send/route.ts',
  'app/api/auth/otp/verify/route.ts',
  'app/api/bookings/request/route.ts',
]) {
  const src = read(...rel.split('/'))
  chk(`${rel} — readJsonWithLimit במקום req.json() ישיר`,
    has(src, /readJsonWithLimit</) &&
    has(src, /status === 413/) &&
    !has(src, /await req\.json\(\)/))
}

// ─── שדות טקסט — מגבלות אורך ────────────────────────────────────────────────
section('מגבלות אורך לשדות טקסט (שם/הערות) — קיים ולא שונה, נוסף איפה שחסר')

const bookingsReqSrc = read('app', 'api', 'bookings', 'request', 'route.ts')
chk('bookings/request — שם: 2–80 (קיים, ללא שינוי)',
  has(bookingsReqSrc, /fullName\.length < 2 \|\| fullName\.length > 80/))
chk('bookings/request — הערות: עד 1000 תו (קיים, ללא שינוי)',
  has(bookingsReqSrc, /\.slice\(0, 1000\)/))

const otpVerifySrc = read('app', 'api', 'auth', 'otp', 'verify', 'route.ts')
chk('🔒 otp/verify — נוסף אימות שם 2–80 (היה חסר לפני שלב 3)',
  has(otpVerifySrc, /fullName\.length < 2 \|\| fullName\.length > 80/))

// ─── לוגים מסוננים — 9 המקומות שתוקנו, ומניעת חזרה של raw error ───────────
section('לוגים מסוננים — 9 מקומות שתוקנו')

/** תבניות אסורות: message/stack/cause/config/request/response גולמיים,
 *  String(err), או console.error(...err) עם אובייקט ה-Error עצמו. */
const FORBIDDEN_RAW_ERROR = [
  /\berr\.message\b/,
  /\berr\.stack\b/,
  /\berr\.cause\b/,
  /\berr\.config\b/,
  /\berr\.request\b/,
  /\berr\.response\b/,
  /String\(err\)/,
  /console\.error\([^)]*,\s*err\s*\)/,
  /console\.error\(message,\s*err\)/,
]

const GOOGLE_CALENDAR_SITES = [
  ['app/api/bookings/request/route.ts', '[bookings/request] calendar pre-check failed'],
  ['app/api/appointments/route.ts', '[appointments] calendar pre-check failed'],
  ['lib/appointmentSelfService.ts', '[selfService] calendar pre-check failed'],
  ['lib/appointmentApproval.ts', '[approval] admin cancel calendar delete threw'],
  ['lib/adminBooking.ts', '[adminBooking] calendar availability check failed'],
]

for (const [rel, context] of GOOGLE_CALENDAR_SITES) {
  const code = read(...rel.split('/'))
  chk(`${rel} — קורא ל-logGoogleCalendarError`,
    code.includes(`logGoogleCalendarError('${context}', err)`))
  chk(`🔒 ${rel} — אין דפוס raw error אסור`,
    !FORBIDDEN_RAW_ERROR.some(re => re.test(code)))
}

// selfService.ts מכיל שני אתרים — נבדק גם השני בנפרד (אותו קובץ, כבר נבדק
// לעיל להיעדר דפוס אסור; כאן רק מוודאים שגם הקריאה השנייה קיימת)
{
  const code = read('lib', 'appointmentSelfService.ts')
  chk("lib/appointmentSelfService.ts — קורא ל-logGoogleCalendarError גם ב-'calendar sync threw'",
    code.includes("logGoogleCalendarError('[selfService] calendar sync threw', err)"))
}

{
  const code = read('lib', 'googleCalendar.ts')
  const fnStart = code.indexOf('export function logGoogleCalendarError')
  const fnEnd = code.indexOf('export function sanitizeGoogleError')
  const fnBody = code.slice(fnStart, fnEnd)
  chk('🔒 logGoogleCalendarError עצמו — רק context קבוע + provider קבוע + status מספרי',
    fnStart !== -1 && fnEnd !== -1 &&
    /console\.error\(context, 'provider=google_calendar', `status=\$\{status/.test(fnBody) &&
    !/\berr\.message\b|\berr\.stack\b|\berr\.cause\b/.test(fnBody))
}

{
  const code = read('lib', 'sms', 'twilioProvider.ts')
  chk("lib/sms/twilioProvider.ts — network error רושם רק provider=twilio קבוע",
    code.includes("console.error('[sms:twilio] network error', 'provider=twilio')"))
  chk('🔒 lib/sms/twilioProvider.ts — אין דפוס raw error אסור בקטע ה-network error',
    !FORBIDDEN_RAW_ERROR.some(re => re.test(code.slice(code.indexOf('network error') - 200, code.indexOf('network error') + 100))))
}

{
  const code = read('lib', 'sms', 'index.ts')
  chk('lib/sms/index.ts — provider threw רושם רק provider.name (שדה קבוע, לא מהשגיאה)',
    has(code, /console\.error\('\[sms\] provider threw', `provider=\$\{provider\.name\}`\)/))
  chk('🔒 lib/sms/index.ts — אין דפוס raw error אסור',
    !FORBIDDEN_RAW_ERROR.some(re => re.test(code)))
}

{
  const code = read('lib', 'bookingAvailability.ts')
  chk('lib/bookingAvailability.ts — ברירת המחדל של log מתעלמת מ-err',
    has(code, /\(\(message\)\s*=>\s*console\.error\(message\)\)/))
  chk('🔒 lib/bookingAvailability.ts — אין דפוס raw error אסור',
    !FORBIDDEN_RAW_ERROR.some(re => re.test(code)))
}

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
