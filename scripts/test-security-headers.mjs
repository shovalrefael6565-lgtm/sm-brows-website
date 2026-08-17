/**
 * שלב 5 — CSP וכותרות אבטחה (next.config.mjs).
 * שלב 6 — עודכן: GA/Meta מותרים ב-CSP במקורות המדויקים בלבד (הטעינה עצמה
 * מותנית בהסכמה בקוד הלקוח, לא ב-CSP — ראה lib/consentContext.tsx).
 *
 * מכסה:
 *   1. ה-CSP המחושב לפרוד: אין wildcard/https: כללי, אין 'unsafe-eval',
 *      GA/Meta מורשים אך ורק במקורות המדויקים הנדרשים, frame-ancestors 'none',
 *      object-src 'none', base-uri 'self', script-src-attr 'none'.
 *   2. ה-CSP לפיתוח כן כולל 'unsafe-eval' (HMR) ולא כולל upgrade-insecure-requests.
 *   3. כותרות האבטחה הנוספות: HSTS בלי preload, X-Content-Type-Options,
 *      Referrer-Policy, X-Frame-Options, Permissions-Policy מצומצם, וכו'.
 *   4. אין X-Powered-By (poweredByHeader: false).
 *   5. כללי Cache-Control הקיימים (private/no-store ל-API פרטי,
 *      immutable לנכסים סטטיים) לא נשברו.
 *   6. שלב 5 נגע רק ב-next.config.mjs / package.json / הבדיקה עצמה —
 *      לא נגע בשום page/route, כך שפילוח static/dynamic לא השתנה.
 *   7. 9D.2 — /api/internal/:path* מכוסה ב-private, no-store, והנתיבים
 *      הציבוריים לא נסחפו לתוך הכלל.
 *   8. 9D.2 — כיסוי שמות env: כל process.env.X שקוד ה-production קורא
 *      מתועד ב-.env.example (readiness לפריסה — משתנה לא מתועד = משתנה
 *      שישכח בהגדרת Vercel).
 *
 * לא נדרש שרת רץ ולא בסיס נתונים.
 *
 * 🔒 הבדיקה קוראת אך ורק את .env.example. היא **לעולם אינה** נוגעת ב-
 * .env.local או בכל env אמיתי, ואינה מדפיסה ערכי env — רק שמות.
 *
 * הרצה:  npm run test:security-headers
 */

import { readFileSync, readdirSync, statSync } from 'fs'

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(70)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}

const configUrl = new URL('../next.config.mjs', import.meta.url).href

async function loadConfig(nodeEnv) {
  const prevEnv = process.env.NODE_ENV
  process.env.NODE_ENV = nodeEnv
  try {
    // cache-bust: next.config.mjs reads process.env.NODE_ENV once at module
    // top-level, so each variant needs a fresh module instance
    const mod = await import(`${configUrl}?env=${nodeEnv}`)
    return mod.default
  } finally {
    process.env.NODE_ENV = prevEnv
  }
}

function headerBlock(rules, source) {
  return rules.find((r) => r.source === source)
}
function headerMap(rules, source) {
  const block = headerBlock(rules, source)
  const map = {}
  for (const h of block?.headers ?? []) map[h.key] = h.value
  return map
}

// ─── CSP לפרוד ───────────────────────────────────────────────────────────
section('CSP מחושב — NODE_ENV=production')

const prodConfig = await loadConfig('production')
const prodRules = await prodConfig.headers()
const prodHeaders = headerMap(prodRules, '/:path*')
const prodCsp = prodHeaders['Content-Security-Policy'] ?? ''

chk('קיים Content-Security-Policy על /:path*', prodCsp.length > 0)
chk("default-src 'self'", /(^|;)\s*default-src 'self'(;|$)/.test(prodCsp))
chk('🔒 אין wildcard כללי (*) בשום directive', !prodCsp.includes('*'))
chk('🔒 אין https: כללי (סכימה גורפת) כמקור',
  !/(^|[\s'])https:(?=\s|;|$)/.test(prodCsp))
chk("🔒 אין 'unsafe-eval' בפרוד", !prodCsp.includes('unsafe-eval'))
chk('🔒 script-src מתיר את googletagmanager.com (Google Tag) — ולא יותר מזה',
  /script-src[^;]*\bhttps:\/\/www\.googletagmanager\.com\b/.test(prodCsp))
chk('🔒 script-src מתיר את connect.facebook.net (Meta Pixel script) — ולא יותר מזה',
  /script-src[^;]*\bhttps:\/\/connect\.facebook\.net\b/.test(prodCsp))
chk('🔒 connect-src מתיר את google-analytics.com (GA collect) — ולא יותר מזה',
  /connect-src[^;]*\bhttps:\/\/www\.google-analytics\.com\b/.test(prodCsp))
chk('🔒 img-src מתיר את facebook.com (Meta collect/pixel) — ולא יותר מזה',
  /img-src[^;]*\bhttps:\/\/www\.facebook\.com\b/.test(prodCsp))
chk('🔒 אין דומיין Google/Meta נוסף מעבר לארבעה המדויקים הנדרשים',
  (prodCsp.match(/googletagmanager\.com|google-analytics\.com|facebook\.net|facebook\.com|analytics\.google\.com|doubleclick\.net|googlesyndication/g) ?? []).length === 4)
chk('🔒 אין subdomain wildcard (*.google-analytics.com וכו\') בשום מקור',
  !/\*\.[a-z-]+\.(com|net)/.test(prodCsp))
chk("frame-ancestors 'none'", /(^|;)\s*frame-ancestors 'none'(;|$)/.test(prodCsp))
chk("object-src 'none'", /(^|;)\s*object-src 'none'(;|$)/.test(prodCsp))
chk("base-uri 'self'", /(^|;)\s*base-uri 'self'(;|$)/.test(prodCsp))
chk("form-action 'self'", /(^|;)\s*form-action 'self'(;|$)/.test(prodCsp))
chk("script-src-attr 'none'", /(^|;)\s*script-src-attr 'none'(;|$)/.test(prodCsp))
chk("frame-src 'none' (אין iframe אמיתי שנמצא במיפוי)",
  /(^|;)\s*frame-src 'none'(;|$)/.test(prodCsp))
chk('upgrade-insecure-requests בפרוד', /upgrade-insecure-requests/.test(prodCsp))
chk('script-src מוגדר וללא unsafe-eval',
  /script-src 'self' 'unsafe-inline' https:\/\/www\.googletagmanager\.com https:\/\/connect\.facebook\.net(;|$)/.test(prodCsp))

// ─── CSP לפיתוח ──────────────────────────────────────────────────────────
section('CSP מחושב — NODE_ENV=development')

const devConfig = await loadConfig('development')
const devRules = await devConfig.headers()
const devHeaders = headerMap(devRules, '/:path*')
const devCsp = devHeaders['Content-Security-Policy'] ?? ''

chk("dev כולל 'unsafe-eval' ב-script-src (HMR)", devCsp.includes('unsafe-eval'))
chk('dev לא כולל upgrade-insecure-requests', !devCsp.includes('upgrade-insecure-requests'))

// ─── כותרות אבטחה נוספות ─────────────────────────────────────────────────
section('כותרות אבטחה נוספות')

chk('Strict-Transport-Security קיים',
  prodHeaders['Strict-Transport-Security'] === 'max-age=63072000; includeSubDomains')
chk('🔒 HSTS ללא preload',
  !/preload/.test(prodHeaders['Strict-Transport-Security'] ?? ''))
chk('X-Content-Type-Options: nosniff', prodHeaders['X-Content-Type-Options'] === 'nosniff')
chk('Referrer-Policy: strict-origin-when-cross-origin',
  prodHeaders['Referrer-Policy'] === 'strict-origin-when-cross-origin')
chk('X-Frame-Options: DENY', prodHeaders['X-Frame-Options'] === 'DENY')
chk('Permissions-Policy קיים', (prodHeaders['Permissions-Policy'] ?? '').length > 0)
chk('🔒 Permissions-Policy לא מעניק יכולת לאף מקור (אין allowlist לא-ריק)',
  !/=\([^)]+\)/.test(prodHeaders['Permissions-Policy'] ?? ''))
chk('X-Permitted-Cross-Domain-Policies: none',
  prodHeaders['X-Permitted-Cross-Domain-Policies'] === 'none')
chk('X-XSS-Protection: 0', prodHeaders['X-XSS-Protection'] === '0')
chk('X-DNS-Prefetch-Control: on', prodHeaders['X-DNS-Prefetch-Control'] === 'on')
chk('🔒 אין COEP/CORP/COOP (עלולים לשבור WhatsApp/התחברות/אינטגרציות)',
  !('Cross-Origin-Embedder-Policy' in prodHeaders) &&
  !('Cross-Origin-Resource-Policy' in prodHeaders) &&
  !('Cross-Origin-Opener-Policy' in prodHeaders))
chk('poweredByHeader: false (אין X-Powered-By)', prodConfig.poweredByHeader === false)

// ─── Cache-Control קיים לא נשבר ──────────────────────────────────────────
section('כללי Cache-Control קיימים — ללא שינוי')

chk("🔒 /api/auth/:path* — private, no-store",
  headerMap(prodRules, '/api/auth/:path*')['Cache-Control'] === 'private, no-store')
chk("🔒 /api/appointments/:path* — private, no-store",
  headerMap(prodRules, '/api/appointments/:path*')['Cache-Control'] === 'private, no-store')
chk("🔒 /api/admin/:path* — private, no-store",
  headerMap(prodRules, '/api/admin/:path*')['Cache-Control'] === 'private, no-store')
chk('נכסים סטטיים (jpg/png/webp/...) — immutable, 1 שנה',
  headerMap(prodRules, '/:path*\\.(jpg|jpeg|png|webp|avif|svg|ico|woff|woff2)')['Cache-Control'] ===
  'public, max-age=31536000, immutable')

// ─── 9D.2 — נתיבים פנימיים מכוסים ב-no-store ─────────────────────────────
//
// עד 9D.2 רק /api/internal/privacy-retention הגדיר no-store בעצמו (בכל נתיב
// תגובה), ואילו /api/internal/reminders ו-/api/internal/calendar-sync לא היו
// מכוסים כלל — לא ברמת ה-route ולא ב-next.config. הכלל המרכזי סוגר את הפער,
// וגם מכסה תגובות שגיאה (401/404/405/500) שלא עוברות בקוד ה-handler.
section('9D.2 — /api/internal מכוסה ב-no-store')

chk("🔒 /api/internal/:path* — private, no-store",
  headerMap(prodRules, '/api/internal/:path*')['Cache-Control'] === 'private, no-store')

/**
 * התאמת נתיב אמיתי לתבנית `source` בסגנון Next (`/prefix/:path*`).
 * בדיקה על התבנית בלבד לא הייתה מוכיחה שהנתיבים הקונקרטיים באמת נתפסים.
 */
function sourceMatches(source, pathname) {
  if (!source.includes(':path*')) return false
  const prefix = source.slice(0, source.indexOf(':path*'))
  return pathname.startsWith(prefix)
}

/** כל כללי ה-Cache-Control מסוג private, no-store שחלים על נתיב נתון. */
function noStoreRulesFor(pathname) {
  return prodRules.filter(r =>
    sourceMatches(r.source, pathname) &&
    (r.headers ?? []).some(h => h.key === 'Cache-Control' && h.value === 'private, no-store'))
}

for (const route of [
  '/api/internal/reminders',
  '/api/internal/calendar-sync',
  '/api/internal/privacy-retention',
]) {
  chk(`🔒 ${route} מכוסה ע"י כלל no-store`, noStoreRulesFor(route).length > 0)
}

// ─── הנתיבים הציבוריים לא השתנו ──────────────────────────────────────────
//
// 🔒 /api/bookings/slots ו-/api/shabbat ציבוריים בכוונה ואסור שכלל
// no-store כלשהו יתפוס אותם — כולל הכלל החדש של 9D.2.
for (const publicRoute of ['/api/bookings/slots', '/api/shabbat']) {
  chk(`${publicRoute} — ללא כלל no-store (נשאר ציבורי)`, noStoreRulesFor(publicRoute).length === 0)
}
chk('עמודים ציבוריים (/, /booking, /privacy) — ללא כלל no-store',
  noStoreRulesFor('/').length === 0 &&
  noStoreRulesFor('/booking').length === 0 &&
  noStoreRulesFor('/privacy').length === 0)

// ⚠️ הכלל החדש הוא תוספת בלבד: מספר כללי ה-Cache-Control עלה בדיוק באחד,
// וכללי הנכסים הסטטיים/עמודים לא נגעו.
{
  const cacheRules = prodRules.filter(r =>
    (r.headers ?? []).some(h => h.key === 'Cache-Control'))
  chk('סה"כ 5 כללי Cache-Control (static + 4 קבוצות פרטיות)', cacheRules.length === 5)
  const noStoreSources = cacheRules
    .filter(r => r.headers.some(h => h.value === 'private, no-store'))
    .map(r => r.source).sort()
  chk('ארבע קבוצות no-store בדיוק: auth, appointments, admin, internal',
    noStoreSources.join(',') === [
      '/api/admin/:path*', '/api/appointments/:path*',
      '/api/auth/:path*', '/api/internal/:path*',
    ].sort().join(','))
}

// ─── פילוח static/dynamic לא השתנה ───────────────────────────────────────
// בדיקה מבנית ולא git-diff גורף: next.config.mjs עצמו הוא המקור היחיד
// שהשתנה בשלב 5, ו-headers() הוא פונקציה קבועה (ללא cookies()/headers()
// מ-next/headers וללא nonce per-request) — כך שהיא לא יכולה לכפות רינדור
// דינמי על אף page/route. בדיקת git diff גורפת על כל הריפו לא שימשה כאן
// כי סביבת הפיתוח משותפת (worktree/session מקביל) ועלולה לכלול קבצים
// שאינם קשורים לשלב 5 כלל.
section('next.config.mjs לא כופה רינדור דינמי (פילוח static/dynamic נשמר)')

const nextConfigSrc = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8')
chk("🔒 headers() אינו מייבא מ-'next/headers' (cookies/headers per-request)",
  !/from ['"]next\/headers['"]/.test(nextConfigSrc))
chk("🔒 ה-CSP המחושב אינו מכיל 'nonce-' (כנדרש — CSP סטטי בלבד, לא per-request)",
  !prodCsp.includes('nonce-') && !devCsp.includes('nonce-'))
chk("🔒 proxy.ts אינו מזריק nonce (אין crypto.randomUUID/randomBytes ואין x-nonce)",
  !/crypto\.(randomUUID|randomBytes)|x-nonce/i.test(readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8')))
chk('headers() הוא async function פשוט המחזיר מערך קבוע (לא תלוי בבקשה)',
  /async headers\(\)\s*\{\s*return \[/.test(nextConfigSrc))

// ─── 9D.2 — כיסוי שמות env ב-.env.example ────────────────────────────────
//
// משתנה שקוד ה-production קורא אך אינו מתועד ב-.env.example הוא משתנה
// שישכח בהגדרת Vercel ויתגלה רק כשמשהו נשבר בפרודקשן. הבדיקה סורקת את
// קוד ה-production בלבד (scripts/ אינם נפרסים) ומוודאת שכל שם מתועד.
//
// 🔒 קוראת .env.example בלבד — לעולם לא .env.local, ומדפיסה שמות בלבד.
section('9D.2 — כל שם env בקוד ה-production מתועד ב-.env.example')

/** משתנים שהפלטפורמה מספקת ואין להגדיר ידנית ב-Vercel. */
const PLATFORM_PROVIDED_ENV = new Set(['NODE_ENV'])

/** קוד שנפרס בפועל. scripts/ בכוונה בחוץ — כלי פיתוח/תחזוקה, לא build. */
const PRODUCTION_CODE_ROOTS = ['app', 'lib', 'components']
const PRODUCTION_CODE_FILES = ['proxy.ts', 'next.config.mjs']

function collectSourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = `${dir}/${entry}`
    if (statSync(full).isDirectory()) collectSourceFiles(full, acc)
    else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry)) acc.push(full)
  }
  return acc
}

const repoRoot = new URL('..', import.meta.url).pathname
const sourceFiles = [
  ...PRODUCTION_CODE_ROOTS.flatMap(d => collectSourceFiles(`${repoRoot}${d}`)),
  ...PRODUCTION_CODE_FILES.map(f => `${repoRoot}${f}`),
]

const envNamesInCode = new Set()
for (const file of sourceFiles) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) envNamesInCode.add(m[1])
}

// ⚠️ שמות בלבד — הצד הימני של '=' לעולם אינו נקרא, נשמר או מודפס.
const exampleSrc = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
const envNamesDocumented = new Set(
  [...exampleSrc.matchAll(/^([A-Z0-9_]+)=/gm)].map(m => m[1]),
)

chk('נסרקו קובצי production ונמצאו שמות env', sourceFiles.length > 0 && envNamesInCode.size > 0)

const undocumented = [...envNamesInCode]
  .filter(n => !PLATFORM_PROVIDED_ENV.has(n) && !envNamesDocumented.has(n))
  .sort()
chk('🔒 כל שם env בקוד ה-production מתועד ב-.env.example',
  undocumented.length === 0,
  undocumented.length ? `חסרים: ${undocumented.join(', ')}` : '')

// שלושת השמות שנוספו ב-9D.2 — רגרסיה מפורשת שלא יוסרו בטעות.
for (const name of [
  'GOOGLE_SERVICE_ACCOUNT_KEY_BASE64',
  'NOTIFICATIONS_ENABLED',
  'SMS_ALLOW_CONSOLE_IN_PROD',
]) {
  chk(`${name} מתועד ב-.env.example`, envNamesDocumented.has(name))
}

// 🔒 הצורה הגולמית עדיין נתמכת בקוד (fallback ב-lib/googleCalendar.ts),
// ולכן אסור להסיר אותה מהתיעוד רק כי ה-BASE64 מועדף.
chk('GOOGLE_SERVICE_ACCOUNT_KEY (הצורה הגולמית) לא הוסר — עדיין נתמך בקוד',
  envNamesDocumented.has('GOOGLE_SERVICE_ACCOUNT_KEY') &&
  envNamesInCode.has('GOOGLE_SERVICE_ACCOUNT_KEY'))

// 🔒 .env.example הוא תבנית — אסור שיכיל סוד אמיתי.
//
// ⚠️ הבדיקה אינה דורשת ערך ריק: לקובץ יש קונבנציה קיימת של placeholder
// קטום וברור (למשל `eyJhbGciOi...`, `https://xxxxxxxxxxxx.supabase.co`),
// שהוא תיעוד מועיל ולא סוד. מה שנאסר הוא ערך שנראה כמו סוד *אמיתי*:
// ארוך, בלי סימן קיטוע, ובלי סימן placeholder.
const PLACEHOLDER_MARKERS = /\.\.\.|xxxx|<|>|your[-_]|example|change[-_]?me/i

for (const secretName of [
  'SESSION_SECRET', 'OTP_PEPPER', 'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'CALENDAR_SYNC_SECRET',
  'REMINDERS_DISPATCH_SECRET', 'PRIVACY_RETENTION_SECRET',
  'GOOGLE_SERVICE_ACCOUNT_KEY_BASE64', 'GOOGLE_SERVICE_ACCOUNT_KEY',
  'TWILIO_AUTH_TOKEN', 'SMS019_TOKEN',
]) {
  const line = exampleSrc.match(new RegExp(`^${secretName}=(.*)$`, 'm'))
  const value = (line?.[1] ?? '').trim()
  const looksReal = value.length > 40 && !PLACEHOLDER_MARKERS.test(value)
  // ⚠️ מדווח על השם ועל האורך בלבד — לעולם לא על הערך עצמו.
  chk(`${secretName} — אין סוד אמיתי ב-.env.example`, line !== null && !looksReal,
    looksReal ? `ערך באורך ${value.length} ללא סימן placeholder` : '')
}

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter((r) => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
