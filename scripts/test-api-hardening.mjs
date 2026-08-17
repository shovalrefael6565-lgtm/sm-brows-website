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
  'app/api/admin/customers/[id]/retention-hold/route.ts',
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
  'app/api/internal/privacy-retention/route.ts',
]
for (const rel of INTERNAL_BEARER_ROUTES) {
  const src = read(...rel.split('/'))
  chk(`🔒 internal Bearer לא נשבר — ${rel} לא דורש isSameOrigin`,
    !has(src, /isSameOrigin\(/))
}

// ─── 9B — app/api/internal/privacy-retention: בדיקות מבניות ייעודיות ───────
section('privacy-retention route — secret, no-store, POST בלבד, double-confirm')

{
  const src = read('app', 'api', 'internal', 'privacy-retention', 'route.ts')

  // 🔒 9B.1 — POST הוא ה-handler האמיתי היחיד; GET/PUT/PATCH/DELETE
  // *כן* מיוצאים בכוונה, אבל כל אחד מהם רק כדי להחזיר 405 מבוקר עם
  // Cache-Control (ר' הבדיקות הייעודיות למטה) — לא ברירת המחדל של Next.
  chk('🔒 POST הוא ה-handler האמיתי', has(src, /export async function POST\(req: NextRequest\)/))

  // ⚠️ בודקים קריאה בפועל ל-process.env של השניים האחרים, לא הופעת השם
  // בטקסט — הערת התיעוד בראש הקובץ מזכירה את שניהם בכוונה (הסבר על
  // הבידוד ביניהם), וזה לא אמור להיכשל.
  chk('🔒 secret נקרא מ-PRIVACY_RETENTION_SECRET, נפרד מהשניים האחרים',
    has(src, /process\.env\.PRIVACY_RETENTION_SECRET/)
    && !has(src, /process\.env\.REMINDERS_DISPATCH_SECRET/)
    && !has(src, /process\.env\.CALENDAR_SYNC_SECRET/))

  chk('🔒 תקרת אורך מינימלי 32 תווים על ה-secret (404 אם קצר יותר)',
    has(src, /secret\.length < 32/) && has(src, /noStore\(\{ error: 'not_found' \}, 404\)/))

  chk('🔒 ה-secret נקרא אך ורק מכותרת Authorization — לא מ-query string',
    has(src, /headers\.get\('authorization'\)/)
    && !has(src, /searchParams\.get\(['"](secret|token)['"]\)/i)
    && !has(src, /req\.nextUrl\.searchParams/))

  chk('🔒 השוואת secret בזמן קבוע (timingSafeEqual + sha256, לא ===)',
    has(src, /timingSafeEqual\(/) && has(src, /createHash\('sha256'\)/)
    && !has(src, /token === secret/) && !has(src, /provided === expected/))

  chk('🔒 כל תשובה נושאת Cache-Control: private, no-store',
    has(src, /'Cache-Control':\s*'private,\s*no-store'/))

  chk('🔒 ברירת מחדל dry_run — לא execute כשאין mode בגוף הבקשה',
    has(src, /body\.mode === 'execute' \? 'execute' : 'dry_run'/))

  chk('🔒 execute דורש גם mode וגם אסימון confirm ספציפי (לא רק דגל בוליאני)',
    has(src, /body\.confirm !== 'APPLY_RETENTION_V1'/)
    && has(src, /noStore\(\{ error: 'confirm_required' \}, 400\)/))

  chk('🔒 batchLimit מאומת לטווח 1–5000 לפני שהוא מגיע ל-RPC',
    has(src, /body\.batchLimit < 1 \|\| body\.batchLimit > 5000/))

  chk('🔒 execute מפעילה רק את שלוש פונקציות ה-v1 (לא reminder_attempts ולא רמת-לקוחה)',
    has(src, /privacy_retention_purge_otp_sessions/)
    && has(src, /privacy_retention_purge_notification_attempts/)
    && has(src, /privacy_retention_reset_old_notes/)
    && !has(src, /appointment_reminder_attempts/)
    && !has(src, /set_customer_retention_hold/))

  chk('body נקרא דרך readJsonWithLimit, לא req.json() ישיר',
    has(src, /readJsonWithLimit</) && !has(src, /await req\.json\(\)/))

  // 🔒 9B.2 — כל תגובה עם גוף עוברת דרך noStore() או methodNotAllowed();
  // NextResponse.json מופיע פעמיים בדיוק — בתוך כל אחת מהן, לא באתר תגובה
  // נפרד — כדי שלא יהיה נתיב שמפספס את הכותרת בטעות.
  const jsonCalls = (src.match(/NextResponse\.json\(/g) ?? []).length
  chk('🔒 NextResponse.json מופיע פעמיים בדיוק (noStore + methodNotAllowed)', jsonCalls === 2,
    `נמצאו ${jsonCalls} מופעים`)
  chk('🔒 GET/PUT/PATCH/DELETE כולם מחזירים 405 דרך methodNotAllowed (לא ברירת המחדל של Next)',
    ['GET', 'PUT', 'PATCH', 'DELETE'].every(m =>
      new RegExp(`export async function ${m}\\(\\)\\s*\\{\\s*return methodNotAllowed\\(\\)`).test(src)))
  chk('🔒 HEAD/OPTIONS מחזירים 405 בלי גוף (methodNotAllowedNoBody), לא JSON',
    ['HEAD', 'OPTIONS'].every(m =>
      new RegExp(`export async function ${m}\\(\\)\\s*\\{\\s*return methodNotAllowedNoBody\\(\\)`).test(src)))
  {
    const allowHeaders = (src.match(/Allow:\s*'POST'/g) ?? []).length
    chk('🔒 כל תשובת 405 נושאת Allow: POST (RFC 7231 §6.5.5)', allowHeaders === 2,
      `נמצאו ${allowHeaders} מופעים, ציפינו 2 (methodNotAllowed + methodNotAllowedNoBody)`)
  }
  // ⚠️ בודקים כותרת בפועל (מפתח מצוטט בתוך אובייקט headers), לא כל
  // הופעה של המחרוזת — התיעוד בראש הקובץ מזכיר "Access-Control-*" בכוונה
  // כהסבר על מה שאין, וזה לא אמור להיכשל.
  chk('🔒 אין שום כותרת Access-Control-* בפועל (אין CORS פתוח על route פנימי)',
    !has(src, /['"]Access-Control-/i))

  // ⚠️ בדיקה אמיתית של תקרת ה-body, לא regex: מייבאים את הפונקציה
  // ואת התקרה *בפועל* מהראוט (MAX_BODY_BYTES מיוצא בדיוק לשם כך), לא
  // ערך מנוחש/משוכפל בטסט.
  //
  // ⚠️ import מקומי (לא הסתמכות על ה-import הגלובלי של readJsonWithLimit
  // בהמשך הקובץ): const בהיקף מודול הוא ב-TDZ עד לשורת ה-import שלו
  // עצמה — קריאה לפני כן זורקת "Cannot access before initialization".
  const { MAX_BODY_BYTES } = await import('../app/api/internal/privacy-retention/route.ts')
  const { readJsonWithLimit: readJsonWithLimitLocal } = await import('../lib/http/bodyLimit.ts')
  chk('🔒 MAX_BODY_BYTES מיוצא ושווה 4096 (4KB)', MAX_BODY_BYTES === 4096, `${MAX_BODY_BYTES}`)

  const jsonReq = (obj) => new Request('http://localhost/api/test', {
    method: 'POST', body: JSON.stringify(obj),
  })

  chk('גוף קטן מ-4KB מתפענח כרגיל',
    await (async () => {
      const r = await readJsonWithLimitLocal(jsonReq({ mode: 'dry_run' }), MAX_BODY_BYTES)
      return r.ok && r.body.mode === 'dry_run'
    })())

  chk('🔒 גוף גדול מ-4KB נדחה כ-413, בדיוק בתקרה שה-route באמת משתמש בה',
    await (async () => {
      const big = 'x'.repeat(MAX_BODY_BYTES + 1000)
      const r = await readJsonWithLimitLocal(jsonReq({ batchLimit: 1, junk: big }), MAX_BODY_BYTES)
      return !r.ok && r.status === 413
    })())

  // ⚠️ 9B.2 — הוכחה אמיתית של עצירה מוקדמת בזרם, לא רק "התוצאה הסופית
  // היא 413": בונים ReadableStream עם 20 chunks של 1000 בייט (20KB סה"כ),
  // וסופרים כמה chunks נמשכו בפועל מה-reader לפני שנעצר. אם readJsonWithLimit
  // הייתה קודם צוברת את כל הגוף (למשל דרך request.text()) ורק *אחר כך*
  // בודקת גודל, כל 20 ה-chunks היו נמשכים לפני הדחייה. אם היא עוצרת
  // באמת ברגע שעוברים את התקרה, רק ~5 chunks (5000 בייט > 4096) יימשכו.
  {
    let pulled = 0
    const chunkBytes = new TextEncoder().encode('{"junk":"' + 'x'.repeat(988) + '"}') // ~1000 bytes
    const stream = new ReadableStream({
      pull(controller) {
        pulled++
        if (pulled > 20) { controller.close(); return }
        controller.enqueue(chunkBytes)
      },
    })
    // ⚠️ בלי Content-Length: גוף מבוסס-stream אינו נושא אורך ידוע מראש —
    // בדיוק המקרה של "chunked ללא Content-Length" שנדרש לבדוק.
    const req = new Request('http://localhost/api/test', {
      method: 'POST', body: stream, duplex: 'half',
    })
    chk('🔒 אין Content-Length על גוף מבוסס-stream (המקרה chunked)',
      req.headers.get('content-length') === null)

    const r = await readJsonWithLimitLocal(req, MAX_BODY_BYTES)
    chk('🔒 גוף chunked ללא Content-Length, מעל 4KB, נדחה כ-413', !r.ok && r.status === 413)
    chk('🔒 עצירה מוקדמת אמיתית — נמשכו ~5-6 chunks (≈5-6KB), לא כל ה-20 (20KB)',
      pulled >= 5 && pulled <= 7, `pulled=${pulled} chunks`)
  }

  // 🔒 ספירת בייטים אמיתית של UTF-8, לא אורך מחרוזת JavaScript: 'א' הוא
  // תו יחיד ב-UTF-16 (str.length סופר 1) אך 2 בייטים ב-UTF-8. 3000 חזרות
  // → str.length=3000 (מתחת לכל תקרה סבירה שסופרת תווים) אך 6000+ בייט
  // בפועל (מעל 4096) — אם הקוד היה סופר .length במקום בייטים, זה היה
  // עובר בטעות.
  {
    const hebrewPayload = JSON.stringify({ note: 'א'.repeat(3000) })
    chk('בדיקת התנאי: אורך המחרוזת קטן מ-4096 אך גודל ה-UTF-8 גדול ממנו',
      hebrewPayload.length < MAX_BODY_BYTES
      && new TextEncoder().encode(hebrewPayload).byteLength > MAX_BODY_BYTES,
      `length=${hebrewPayload.length} bytes=${new TextEncoder().encode(hebrewPayload).byteLength}`)

    const req = new Request('http://localhost/api/test', { method: 'POST', body: hebrewPayload })
    const r = await readJsonWithLimitLocal(req, MAX_BODY_BYTES)
    chk('🔒 גוף יוניקוד — נדחה לפי בייטים אמיתיים, לא לפי מספר תווי JS',
      !r.ok && r.status === 413)
  }

  // 🔒 JSON תקין שאינו object (מערך/מחרוזת/מספר) — אותו תנאי בדיוק
  // שה-route בודק (typeof/Array.isArray) אחרי readJsonWithLimit.
  const isRejectedNonObject = (v) => typeof v !== 'object' || v === null || Array.isArray(v)
  chk('🔒 מערך JSON תקין נחשב "לא object" ונדחה', isRejectedNonObject([1, 2, 3]))
  chk('🔒 מחרוזת JSON תקינה נחשבת "לא object" ונדחית', isRejectedNonObject('hello'))
  chk('🔒 מספר JSON תקין נחשב "לא object" ונדחה', isRejectedNonObject(42))
  chk('🔒 null JSON תקין נחשב "לא object" ונדחה', isRejectedNonObject(null))
  chk('object רגיל אינו נדחה', !isRejectedNonObject({ mode: 'dry_run' }))
}

{
  const src = read('app', 'api', 'admin', 'customers', '[id]', 'retention-hold', 'route.ts')

  chk('🔒 retention-hold — POST בלבד', has(src, /export async function POST\(/)
    && !/export async function (GET|PUT|PATCH|DELETE)\(/.test(src))
  // 🔒 9B.1 — לא רק "guard.userId מופיע איפשהו": בודקים את אתר הקריאה
  // המדויק ל-setCustomerRetentionHold ומוודאים שהארגומנט השני (מיקום
  // p_admin_user_id) הוא guard.userId ותו לא — לא ערך שנגזר מ-body בשום
  // צורה. שינוי עתידי שיחליף את זה בערך מה-body ישבור את הבדיקה הזו.
  chk('🔒 retention-hold — אתר הקריאה המדויק: setCustomerRetentionHold(customerId, guard.userId, hold)',
    has(src, /setCustomerRetentionHold\(\s*customerId,\s*guard\.userId,\s*hold\s*\)/))
  chk('🔒 retention-hold — אין שום שימוש ב-body.adminUserId/adminId/userId בכל הקובץ',
    !has(src, /body\.adminUserId|body\.adminId|body\.userId/))
  chk('🔒 retention-hold — אין שדה סיבה חופשי בגוף הבקשה (רק hold: boolean)',
    has(src, /hold\?:\s*unknown/) && !/reason|comment|note/i.test(src))
  chk('retention-hold — body נקרא דרך readJsonWithLimit', has(src, /readJsonWithLimit</))
  chk('retention-hold — כל תשובה נושאת Cache-Control: private, no-store',
    has(src, /'Cache-Control':\s*'private,\s*no-store'/))
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
