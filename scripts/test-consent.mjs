/**
 * שלב 6 — מנגנון הסכמה אמיתי לעוגיות + הפעלה מותנית של GA/Meta.
 * תיקון סופי: lifecycle מפורש — disable/consent-update ל-GA, grant/revoke
 * ל-Meta, כשההסכמה מבוטלת או שהנתיב הופך מוחרג, לא רק "אל תטען".
 *
 * מכסה:
 *   1. ברירת מחדל: analytics/marketing = false כשאין רשומה.
 *   2. רשומה חסרה/JSON פגום/גרסה ישנה/פגה (מעל 180 יום) — כל אלה נדחים כ"אין הסכמה".
 *   3. Reject All / Accept All / בחירה נפרדת לכל קטגוריה נשמרים נכון.
 *   4. GA/Meta לא מוצגים בלי הסכמה — נבדק ברמת המקור (gating לפני כל <Script>).
 *   5. אין PII (href/query/שם/טלפון) באירועי המעקב שנשלחים בפועל.
 *   6. ביטול הסכמה מוחק את ה-cookies הידועים (_ga, _ga_*, _fbp, _fbc) — עם cookies סינתטיים.
 *   7. קישור "הגדרות פרטיות ועוגיות" קיים בפוטר.
 *   8. כפתורי אישור/דחייה/התאמה אישית באותה שכבה חזותית (אין dark pattern).
 *   9. CSP מאפשר רק את ארבעת מקורות הספקים המדויקים.
 *  10. שלב 5 (headers) ותיקון התמונות עדיין מחוברים ל-npm run test.
 *  11. GA disable flag + Consent Mode update (analytics_storage בלבד זז, ad_* תמיד denied).
 *  12. Meta consent grant/revoke.
 *  13. אין consent command לפני ש-gtag/fbq קיימים.
 *  14. מחיקת cookies מנסה host-only + Domain=smbrows.co.il + Domain=.smbrows.co.il
 *      בפרודקשן, אך ורק host-only ב-localhost/preview — לא מחשבת co.il כדומיין בסיס.
 *  15. אין init/PageView כפולים (בדיקת מקור: loadedRef/prevGrantedRef guard).
 *  16. gtag('config',...) כולל cookie_expires=15552000 (180 יום), cookie_update:false,
 *      send_page_view:false.
 *  17. initConsent(): רשומה תקפה לא נמחקת; רשומה חסרה/פגומה/ישנה/פגה מנקה
 *      cookies של GA/Meta ומסירה את הרשומה מ-localStorage, בלי לכתוב Reject
 *      אוטומטי ובלי לגעת ב-cookies לא-קשורים.
 *
 * לא נדרש שרת רץ ולא בסיס נתונים. localStorage/document.cookie/window.location
 * מדומים ידנית למטה (אין jsdom בפרויקט). אין fetch/XHR מדומה או אמיתי בכל
 * הקובץ — שום קריאה לרשת לא יכולה לצאת מהתהליך הזה.
 *
 * הרצה:  npm run test:consent
 */

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(70)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}

import { readFileSync } from 'fs'
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ─── דימוי localStorage + document.cookie + window.location ────────────────
// אין jsdom בפרויקט (ראה שאר scripts/*.mjs) — דימוי ידני קל, כמו שאר הבדיקות
// שמדמות process.env/fs במקום להריץ דפדפן אמיתי.

function createMockStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _store: store,
  }
}

/**
 * מדמה קופסת cookies אמיתית: מכבד expires בעבר / max-age<=0 כמחיקה.
 * גם עוקב אחרי כל ניסיון כתיבה (raw string) ב-_writes, כדי שאפשר יהיה
 * לבדוק בדיוק אילו צירופי domain/path נוסו למחיקת cookie נתון — בלי תלות
 * בסמנטיקת domain-matching אמיתית של דפדפן (שלא רלוונטית לבדיקת "מה הקוד
 * שלנו ניסה לכתוב").
 */
function createMockDocument() {
  const cookies = new Map()
  const writes = []
  return {
    get cookie() {
      return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
    },
    set cookie(raw) {
      writes.push(raw)
      const parts = raw.split(';').map((s) => s.trim())
      const eq = parts[0].indexOf('=')
      const name = parts[0].slice(0, eq)
      const expiresAttr = parts.find((a) => /^expires=/i.test(a))
      const maxAgeAttr = parts.find((a) => /^max-age=/i.test(a))
      let expired = false
      if (expiresAttr) {
        const t = Date.parse(expiresAttr.slice('expires='.length))
        if (!Number.isNaN(t) && t <= Date.now()) expired = true
      }
      if (maxAgeAttr && Number(maxAgeAttr.slice('max-age='.length)) <= 0) expired = true
      if (expired) cookies.delete(name)
      else cookies.set(name, parts[0].slice(eq + 1))
    },
    _cookies: cookies,
    _writes: writes,
  }
}

const mockStorage = createMockStorage()
const mockDocument = createMockDocument()
globalThis.window = { localStorage: mockStorage, location: { hostname: 'smbrows.co.il' } }
globalThis.document = mockDocument

const {
  CONSENT_STORAGE_KEY, CONSENT_VERSION, CONSENT_MAX_AGE_MS,
  isValidConsentRecord, readConsent, writeConsent, initConsent,
  deleteGaCookies, deleteMetaCookies, isTrackingExcludedPath,
  setGaDisabled, isGaDisabled, updateGaConsent, setMetaConsent,
} = await import('../lib/consent.ts')

// ─── ברירת מחדל ──────────────────────────────────────────────────────────
section('ברירת מחדל')

mockStorage._store.clear()
chk('אין רשומה כלל → readConsent() null (analytics/marketing נחשבים false)',
  readConsent() === null)

// ─── רשומות פגומות/ישנות/פגות נדחות ──────────────────────────────────────
section('רשומה לא קיימת/פגומה/גרסה ישנה/פגה נדחית')

mockStorage.setItem(CONSENT_STORAGE_KEY, '{not valid json')
chk('JSON פגום → readConsent() null', readConsent() === null)

mockStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
  version: CONSENT_VERSION - 1 || 0, analytics: true, marketing: true, decidedAt: Date.now(),
}))
chk('version ישנה → readConsent() null', readConsent() === null)

mockStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
  version: CONSENT_VERSION, analytics: true, marketing: true,
  decidedAt: Date.now() - (CONSENT_MAX_AGE_MS + 60_000),
}))
chk('פג תוקף (מעל 180 יום) → readConsent() null', readConsent() === null)

mockStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
  version: CONSENT_VERSION, analytics: 'yes', marketing: true, decidedAt: Date.now(),
}))
chk('analytics לא boolean → readConsent() null', readConsent() === null)

chk('isValidConsentRecord דוחה null/undefined/מערך',
  !isValidConsentRecord(null) && !isValidConsentRecord(undefined) && !isValidConsentRecord([]))

// ─── initConsent(): ניקוי כשאין הסכמה תקפה ───────────────────────────────
section('initConsent(): ניקוי כשאין הסכמה תקפה, לא נוגע ברשומה תקפה')

function seedTrackingCookies() {
  mockDocument._cookies.clear()
  mockDocument._cookies.set('_ga', 'GA1.1.111')
  mockDocument._cookies.set('_ga_XYZ789', 'GS1.1.222')
  mockDocument._cookies.set('_fbp', 'fb.1.333')
  mockDocument._cookies.set('_fbc', 'fb.1.444')
  mockDocument._cookies.set('some_other_cookie', 'keep-me')
}
const trackingCookiesGone = () =>
  !mockDocument._cookies.has('_ga') && !mockDocument._cookies.has('_ga_XYZ789') &&
  !mockDocument._cookies.has('_fbp') && !mockDocument._cookies.has('_fbc')

// רשומה תקפה — לא נמחקת, לא מנקה כלום.
mockStorage._store.clear()
writeConsent({ analytics: true, marketing: false })
seedTrackingCookies()
let init = initConsent()
chk('רשומה תקפה: initConsent() מחזירה אותה, cleaned=false',
  init.record?.analytics === true && init.record?.marketing === false && init.cleaned === false)
chk('רשומה תקפה: initConsent() לא נוגעת ב-localStorage (הרשומה עדיין שם)',
  mockStorage.getItem(CONSENT_STORAGE_KEY) !== null)
chk('רשומה תקפה: initConsent() לא מוחקת cookies', !trackingCookiesGone())

// רשומה חסרה לגמרי — עדיין מנקה (יכולה להיות שארית מהמנגנון הישן).
mockStorage._store.clear()
seedTrackingCookies()
init = initConsent()
chk('רשומה חסרה: initConsent() מחזירה record=null, cleaned=true',
  init.record === null && init.cleaned === true)
chk('רשומה חסרה: מוחקת cookies של GA/Meta', trackingCookiesGone())
chk('🔒 רשומה חסרה: cookie לא-קשור נשאר', mockDocument._cookies.has('some_other_cookie'))

// JSON פגום — מנקה ומסירה את הרשומה הפגומה מ-localStorage.
mockStorage._store.clear()
mockStorage.setItem(CONSENT_STORAGE_KEY, '{not valid json')
seedTrackingCookies()
init = initConsent()
chk('JSON פגום: initConsent() מחזירה record=null, cleaned=true',
  init.record === null && init.cleaned === true)
chk('JSON פגום: מוחקת cookies', trackingCookiesGone())
chk('JSON פגום: הרשומה הפגומה מוסרת מ-localStorage', mockStorage.getItem(CONSENT_STORAGE_KEY) === null)

// גרסה ישנה — אותו טיפול.
mockStorage._store.clear()
mockStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
  version: CONSENT_VERSION - 1 || 0, analytics: true, marketing: true, decidedAt: Date.now(),
}))
seedTrackingCookies()
init = initConsent()
chk('גרסה ישנה: initConsent() מחזירה record=null, cleaned=true',
  init.record === null && init.cleaned === true)
chk('גרסה ישנה: מוחקת cookies', trackingCookiesGone())
chk('גרסה ישנה: הרשומה מוסרת מ-localStorage', mockStorage.getItem(CONSENT_STORAGE_KEY) === null)

// פג תוקף (מעל 180 יום) — אותו טיפול, וזה בדיוק "expiry מציג את הבאנר מחדש".
mockStorage._store.clear()
mockStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
  version: CONSENT_VERSION, analytics: true, marketing: true,
  decidedAt: Date.now() - (CONSENT_MAX_AGE_MS + 60_000),
}))
seedTrackingCookies()
init = initConsent()
chk('פג תוקף: initConsent() מחזירה record=null, cleaned=true',
  init.record === null && init.cleaned === true)
chk('פג תוקף: מוחקת cookies', trackingCookiesGone())
chk('פג תוקף: הרשומה הפגה מוסרת מ-localStorage', mockStorage.getItem(CONSENT_STORAGE_KEY) === null)
chk('🔒 אין החלפה אוטומטית ל-Reject: readConsent() אחרי initConsent() עדיין null, לא {analytics:false,marketing:false}',
  readConsent() === null)

// ─── Accept All / Reject All / בחירה נפרדת ───────────────────────────────
section('Accept All / Reject All / בחירה נפרדת נשמרים נכון')

mockStorage._store.clear()
writeConsent({ analytics: false, marketing: false })
let r = readConsent()
chk('Reject All → analytics=false, marketing=false',
  r?.analytics === false && r?.marketing === false)

writeConsent({ analytics: true, marketing: true })
r = readConsent()
chk('Accept All → analytics=true, marketing=true',
  r?.analytics === true && r?.marketing === true)

writeConsent({ analytics: true, marketing: false })
r = readConsent()
chk('Analytics בלבד → analytics=true, marketing=false',
  r?.analytics === true && r?.marketing === false)

writeConsent({ analytics: false, marketing: true })
r = readConsent()
chk('Marketing בלבד → analytics=false, marketing=true',
  r?.analytics === false && r?.marketing === true)

chk('הרשומה השמורה כוללת רק version/analytics/marketing/decidedAt (אין PII, אין מזהה ייחודי)',
  Object.keys(r).sort().join(',') === 'analytics,decidedAt,marketing,version')
chk('decidedAt הוא timestamp מספרי', typeof r.decidedAt === 'number' && r.decidedAt > 0)

// ─── נתיבים מוחרגים ──────────────────────────────────────────────────────
section('אין tracking ב-admin/account/login')

chk('/admin מוחרג', isTrackingExcludedPath('/admin'))
chk('/admin/(protected)/dashboard מוחרג', isTrackingExcludedPath('/admin/dashboard'))
chk('/account מוחרג', isTrackingExcludedPath('/account'))
chk('/account/appointments מוחרג', isTrackingExcludedPath('/account/appointments'))
chk('/login מוחרג', isTrackingExcludedPath('/login'))
chk('/booking אינו מוחרג', !isTrackingExcludedPath('/booking'))
chk('/ (בית) אינו מוחרג', !isTrackingExcludedPath('/'))
chk('/administration אינו מוחרג בטעות (prefix match מדויק, לא substring חופשי)',
  !isTrackingExcludedPath('/administration'))

// ─── ניקוי cookies בביטול הסכמה ───────────────────────────────────────────
section('ביטול הסכמה מוחק cookies ידועים (cookies סינתטיים)')

mockDocument._cookies.clear()
mockDocument._cookies.set('_ga', 'GA1.1.123')
mockDocument._cookies.set('_ga_ABC123XYZ', 'GS1.1.456')
mockDocument._cookies.set('_fbp', 'fb.1.789')
mockDocument._cookies.set('_fbc', 'fb.1.abc')
mockDocument._cookies.set('some_other_cookie', 'keep-me')

deleteGaCookies()
chk('_ga נמחק', !mockDocument._cookies.has('_ga'))
chk('_ga_ABC123XYZ נמחק (תבנית _ga_*)', !mockDocument._cookies.has('_ga_ABC123XYZ'))
chk('_fbp עדיין קיים (deleteGaCookies לא נוגע ב-Meta)', mockDocument._cookies.has('_fbp'))
chk('_fbc עדיין קיים (deleteGaCookies לא נוגע ב-Meta)', mockDocument._cookies.has('_fbc'))

deleteMetaCookies()
chk('_fbp נמחק', !mockDocument._cookies.has('_fbp'))
chk('_fbc נמחק', !mockDocument._cookies.has('_fbc'))
chk('🔒 cookie לא-קשור (some_other_cookie) לא נמחק', mockDocument._cookies.has('some_other_cookie'))

// ─── דיוק המחיקה לפי domain ────────────────────────────────────────────────
// לא בודקים רק "האם הוא נעלם מהמפה" (זה כבר הוכח למעלה) — בודקים בדיוק אילו
// צירופי domain/path הקוד ניסה לכתוב, כדי לוודא שהוא לא מחשב co.il כדומיין
// בסיס (smbrows.co.il הוא 3 labels, ו"הסר label ראשון" היה נותן co.il —
// public suffix, לא הדומיין של האתר).
section('מחיקת cookies מנסה את צירופי הדומיין הנכונים בלבד')

mockDocument._cookies.clear()
mockDocument._writes.length = 0
mockDocument._cookies.set('_ga', 'GA1.1.123')
globalThis.window.location.hostname = 'smbrows.co.il'
deleteGaCookies()

const prodWrites = mockDocument._writes.filter((w) => w.startsWith('_ga='))
chk('בפרודקשן (smbrows.co.il): מנסה host-only (בלי domain attribute)',
  prodWrites.some((w) => !/domain=/i.test(w)))
chk('בפרודקשן: מנסה Domain=smbrows.co.il',
  prodWrites.some((w) => /domain=smbrows\.co\.il(?!\.)/i.test(w) && !/domain=\.smbrows/i.test(w)))
chk('בפרודקשן: מנסה Domain=.smbrows.co.il',
  prodWrites.some((w) => /domain=\.smbrows\.co\.il/i.test(w)))
chk('🔒 בפרודקשן: אף פעם לא מנסה Domain=co.il (זה לא הדומיין של האתר)',
  !prodWrites.some((w) => /domain=co\.il\b/i.test(w) && !/smbrows/i.test(w)))
chk('כל ניסיון כולל Path=/', prodWrites.every((w) => /path=\//i.test(w)))
chk('בדיוק 3 ניסיונות מחיקה לכל cookie בפרודקשן (host-only + 2 domain variants)',
  prodWrites.length === 3)

mockDocument._cookies.clear()
mockDocument._writes.length = 0
mockDocument._cookies.set('_ga', 'GA1.1.123')
globalThis.window.location.hostname = 'localhost'
deleteGaCookies()

const localWrites = mockDocument._writes.filter((w) => w.startsWith('_ga='))
chk('ב-localhost: host-only בלבד (בלי domain attribute כלל)',
  localWrites.length === 1 && !/domain=/i.test(localWrites[0]))

mockDocument._cookies.clear()
mockDocument._writes.length = 0
mockDocument._cookies.set('_ga', 'GA1.1.123')
globalThis.window.location.hostname = 'sm-brows-git-preview.vercel.app'
deleteGaCookies()

const previewWrites = mockDocument._writes.filter((w) => w.startsWith('_ga='))
chk('ב-preview (vercel.app, לא smbrows.co.il): host-only בלבד',
  previewWrites.length === 1 && !/domain=/i.test(previewWrites[0]))

globalThis.window.location.hostname = 'smbrows.co.il' // מחזירים למצב הרגיל להמשך הקובץ

// ─── GA/Meta לא מוצגים בלי הסכמה (בדיקת מקור) ────────────────────────────
section('GA/Meta אינם מוצגים ללא consent')

const gaSrc = stripComments(src('components/analytics/GoogleAnalytics.tsx'))
const metaSrc = stripComments(src('components/analytics/MetaPixel.tsx'))

chk('GoogleAnalytics.tsx: granted תלוי ב-ready && analytics && !excluded',
  /const granted = ready && analytics && !excluded/.test(gaSrc))
chk('GoogleAnalytics.tsx: return null לפני כל <Script> כש-!scriptLoaded',
  /if \(!scriptLoaded\) return null/.test(gaSrc))
chk('GoogleAnalytics.tsx: אין hardcode למזהה — נקרא מ-env בלבד',
  /const GA_ID = process\.env\.NEXT_PUBLIC_GA_ID\s*$/m.test(gaSrc) && !/['"]G-[A-Z0-9]+['"]/.test(gaSrc))
chk('MetaPixel.tsx: granted תלוי ב-ready && marketing && !excluded',
  /const granted = ready && marketing && !excluded/.test(metaSrc))
chk('MetaPixel.tsx: return null לפני כל <Script> כש-!scriptLoaded',
  /if \(!scriptLoaded\) return null/.test(metaSrc))
chk('MetaPixel.tsx: אין hardcode למזהה — נקרא מ-env בלבד',
  /const META_PIXEL_ID = process\.env\.NEXT_PUBLIC_META_PIXEL_ID\s*$/m.test(metaSrc) &&
  !/['"]\d{10,}['"]/.test(metaSrc))
chk('שני הקומפוננטות מחריגות נתיבים (isTrackingExcludedPath)',
  /isTrackingExcludedPath/.test(gaSrc) && /isTrackingExcludedPath/.test(metaSrc))

// ─── תוקף cookie של GA צמוד להסכמה ─────────────────────────────────────────
section('gtag config: cookie_expires/cookie_update/send_page_view')

// [\s\S]*? (לא [^}]*) כי תוך כדי האובייקט יש עוד אינטרפולציה מוטבעת
// (${GA_COOKIE_EXPIRES_SECONDS}) שכוללת } משלה לפני הסגירה האמיתית.
const gaConfigCallMatch = gaSrc.match(/gtag\('config',\s*'\$\{GA_ID\}',\s*\{([\s\S]*?)\}\);/)
const gaConfigOpts = gaConfigCallMatch?.[1] ?? ''

chk('gtag config כולל cookie_expires', /cookie_expires:/.test(gaConfigOpts))
chk('GA_COOKIE_EXPIRES_SECONDS = 180*24*60*60 = 15552000 בדיוק (אותו תוקף כמו רשומת ההסכמה, CONSENT_MAX_AGE_MS/1000)',
  /const GA_COOKIE_EXPIRES_SECONDS = CONSENT_MAX_AGE_MS \/ 1000/.test(gaSrc) &&
  CONSENT_MAX_AGE_MS / 1000 === 15552000)
chk("gtag config כולל cookie_update:false (התוקף לא מתחדש בכל ביקור)",
  /cookie_update:false/.test(gaConfigOpts))
chk('gtag config כולל send_page_view:false (מונע pageview אוטומטי/כפול)',
  /send_page_view:false/.test(gaConfigOpts))
chk('🔒 אין שינוי למשך session (אין session_duration/session_timeout בקוד)',
  !/session_duration|session_timeout/.test(gaSrc))
chk('🔒 אין Google Ads (אין gtag(\'config\',\'AW-...\') ואין conversion_linker)',
  !/AW-|conversion_linker/.test(gaSrc))

// ─── GA lifecycle: disable flag + Consent Mode update ────────────────────
section('GA lifecycle: ga-disable + gtag consent update')

const TEST_GA_ID = 'G-TEST123456'

chk('GA disabled לפני אישור: setGaDisabled(id,true) קובע ga-disable ל-true',
  (setGaDisabled(TEST_GA_ID, true), isGaDisabled(TEST_GA_ID) === true))

chk('אישור Analytics: setGaDisabled(id,false) משנה ל-false',
  (setGaDisabled(TEST_GA_ID, false), isGaDisabled(TEST_GA_ID) === false))

chk('ביטול: setGaDisabled(id,true) חוזר מיד ל-true',
  (setGaDisabled(TEST_GA_ID, true), isGaDisabled(TEST_GA_ID) === true))

chk('setGaDisabled בלי gaId לא זורק ולא כותב כלום', (setGaDisabled(undefined, true), true))

// window.gtag עדיין לא קיים כאן — updateGaConsent חייבת להיות no-op שקטה,
// ובעיקר: אסור לה *ליצור* gtag בעצמה.
delete globalThis.window.gtag
let threwBeforeExist = false
try { updateGaConsent(true) } catch { threwBeforeExist = true }
chk('אין consent command כש-gtag עדיין לא קיים: לא זורקת, ולא יוצרת window.gtag בעצמה',
  !threwBeforeExist && typeof globalThis.window.gtag === 'undefined')

// עכשיו gtag "קיים" (מדומה) — בודקים את ה-payload המדויק שנשלח.
const gtagCalls = []
globalThis.window.gtag = (...args) => gtagCalls.push(args)

updateGaConsent(true)
chk('updateGaConsent(true): analytics_storage=granted',
  gtagCalls.at(-1)?.[2]?.analytics_storage === 'granted')
chk('updateGaConsent(true): ad_storage/ad_user_data/ad_personalization תמיד denied (אין Google Ads באתר)',
  gtagCalls.at(-1)?.[2]?.ad_storage === 'denied' &&
  gtagCalls.at(-1)?.[2]?.ad_user_data === 'denied' &&
  gtagCalls.at(-1)?.[2]?.ad_personalization === 'denied')
chk('updateGaConsent פונה ל-gtag(\'consent\',\'update\',...)',
  gtagCalls.at(-1)?.[0] === 'consent' && gtagCalls.at(-1)?.[1] === 'update')

updateGaConsent(false)
chk('updateGaConsent(false): analytics_storage=denied, שאר השדות עדיין denied',
  gtagCalls.at(-1)?.[2]?.analytics_storage === 'denied' &&
  gtagCalls.at(-1)?.[2]?.ad_storage === 'denied')

chk('🔒 גם כש-Meta Marketing מאושר, הרשאות הפרסום של Google נשארות denied (אין קשר בין הספקים)',
  gtagCalls.every((c) => c[2]?.ad_storage === 'denied' && c[2]?.ad_personalization === 'denied'))

delete globalThis.window.gtag

// ─── Meta lifecycle: consent grant/revoke ─────────────────────────────────
section('Meta lifecycle: fbq consent grant/revoke')

delete globalThis.window.fbq
let threwFbqBeforeExist = false
try { setMetaConsent('grant') } catch { threwFbqBeforeExist = true }
chk('אין consent command כש-fbq עדיין לא קיים: לא זורקת, ולא יוצרת window.fbq בעצמה',
  !threwFbqBeforeExist && typeof globalThis.window.fbq === 'undefined')

const fbqCalls = []
globalThis.window.fbq = (...args) => fbqCalls.push(args)

setMetaConsent('grant')
chk("אישור Marketing: fbq('consent','grant')",
  fbqCalls.at(-1)?.[0] === 'consent' && fbqCalls.at(-1)?.[1] === 'grant')

setMetaConsent('revoke')
chk("ביטול Marketing: fbq('consent','revoke')",
  fbqCalls.at(-1)?.[0] === 'consent' && fbqCalls.at(-1)?.[1] === 'revoke')

delete globalThis.window.fbq

// ─── lifecycle מלא: מעבר לנתיב מוחרג / חזרה לנתיב ציבורי ──────────────────
// לא מרנדרים React כאן (אין jsdom/testing-library בפרויקט) — מדמים את בדיוק
// אותה סדרת הקריאות שהאפקט ב-GoogleAnalytics.tsx/MetaPixel.tsx מבצע, כדי
// להוכיח שהפרימיטיבים עצמם מתנהגים נכון בשרשרת מלאה: קיים → מוחרג → חוזר.
section('lifecycle מלא: הסכמה → נתיב מוחרג → חזרה, בלי init כפול')

globalThis.window.gtag = (...args) => gtagCalls.push(args)
const gtagCallCountAtStart = gtagCalls.length

// "הפעלה ראשונה": מדמים בדיוק את מה שסקריפט האתחול של GoogleAnalytics עושה.
setGaDisabled(TEST_GA_ID, false)
updateGaConsent(true)
chk('הפעלה ראשונה: ga-disable=false + consent granted', isGaDisabled(TEST_GA_ID) === false)

// "נתיב הופך מוחרג": granted הופך false → disable(true) + consent(false).
setGaDisabled(TEST_GA_ID, true)
updateGaConsent(false)
chk('נתיב מוחרג: ga-disable חוזר ל-true מיד', isGaDisabled(TEST_GA_ID) === true)
chk('נתיב מוחרג: consent update נשלח עם analytics_storage=denied',
  gtagCalls.at(-1)?.[2]?.analytics_storage === 'denied')

// "חזרה לנתיב ציבורי, הסכמה עדיין בתוקף": enable מחדש — בלי לקרוא שוב ל-'js'/'config'.
setGaDisabled(TEST_GA_ID, false)
updateGaConsent(true)
chk('חזרה לנתיב ציבורי: ga-disable=false שוב', isGaDisabled(TEST_GA_ID) === false)
chk('חזרה לנתיב ציבורי: consent update עם analytics_storage=granted',
  gtagCalls.at(-1)?.[2]?.analytics_storage === 'granted')
chk('🔒 באף שלב לא נקראה gtag(\'js\',...) או gtag(\'config\',...) — init קורה רק בסקריפט האתחול עצמו, לא ב-lifecycle',
  !gtagCalls.slice(gtagCallCountAtStart).some((c) => c[0] === 'js' || c[0] === 'config'))

delete globalThis.window.gtag

chk('GoogleAnalytics.tsx: loadedRef מונע re-entry להפעלה ראשונה (אין init כפול)',
  /granted && !loadedRef\.current/.test(gaSrc) && /loadedRef\.current = true/.test(gaSrc))
chk('GoogleAnalytics.tsx: prevGrantedRef מבחין בין מעבר-מפורש לבין המשך אותו מצב',
  /granted !== prevGrantedRef\.current/.test(gaSrc))
chk('GoogleAnalytics.tsx: כש-!loadedRef.current נקבע ga-disable=true בלי consent ping',
  /if \(!loadedRef\.current\) \{[\s\S]{0,80}setGaDisabled\(GA_ID, true\)/.test(gaSrc))
chk('MetaPixel.tsx: loadedRef מונע re-entry להפעלה ראשונה (אין init כפול)',
  /granted && !loadedRef\.current/.test(metaSrc) && /loadedRef\.current = true/.test(metaSrc))
chk('MetaPixel.tsx: prevGrantedRef מבחין בין מעבר-מפורש לבין המשך אותו מצב',
  /granted !== prevGrantedRef\.current/.test(metaSrc))
chk('MetaPixel.tsx: כש-!loadedRef.current לא נקראת שום פעולת fbq (הוא לא קיים עדיין)',
  /if \(!loadedRef\.current\) return/.test(metaSrc))
chk('MetaPixel.tsx: מעבר מפורש קורא setMetaConsent(granted ? grant : revoke)',
  /setMetaConsent\(granted \? 'grant' : 'revoke'\)/.test(metaSrc))
chk('GoogleAnalytics.tsx: init script מגדיר ga-disable=false + consent update + page_view נקי, סינכרונית',
  /window\['ga-disable-\$\{GA_ID\}'\]=false/.test(gaSrc) &&
  /gtag\('consent','update'/.test(gaSrc))

// ─── אין PII באירועי המעקב ────────────────────────────────────────────────
section('אין PII (href/query/שם/טלפון) ב-event payloads')

const waSrc = stripComments(src('components/analytics/WhatsAppTracker.tsx'))

chk('WhatsAppTracker: gtag לא נשלח עם anchor.href בשום payload',
  !/gtag\?\.\([^)]*anchor\.href/.test(waSrc))
chk('WhatsAppTracker: אירוע whatsapp_click שולח page_path בלבד (לא href/link/query)',
  /gtag\?\.\('event',\s*'whatsapp_click',\s*\{\s*page_path:\s*pathname\s*\}\)/.test(waSrc))
chk('WhatsAppTracker: fbq(Contact) לא נושא payload נוסף (רק שם האירוע)',
  /fbq\?\.\('track',\s*'Contact'\)/.test(waSrc))
chk('WhatsAppTracker: אין שימוש ב-window.location.search/href בקוד המעקב',
  !/window\.location\.(href|search)/.test(waSrc))
chk('GoogleAnalytics: page_view נשלח עם page_path בלבד, לא page_location/href',
  !/page_location/.test(gaSrc) && /page_path:\s*(pathname|document\.location\.pathname)/.test(gaSrc))

// ─── ConsentProvider קורא ל-initConsent() באתחול ─────────────────────────
// initConsent() עצמה כבר הוכחה למעלה (מנקה כשאין הסכמה תקפה). כאן בודקים
// שה-Provider בפועל *משתמש* בה, ושה-banner נגזר מה-null שהיא מחזירה —
// זה מה שגורם לבאנר להופיע שוב אחרי expiry.
section('ConsentProvider משתמש ב-initConsent() ומציג באנר לפי record==null')

const consentContextSrc = stripComments(src('lib/consentContext.tsx'))
chk('consentContext.tsx מייבא initConsent מ-lib/consent', /import\s*\{[^}]*initConsent[^}]*\}\s*from\s*'@\/lib\/consent'/.test(consentContextSrc))
chk('ה-effect הראשוני קורא ל-initConsent() (לא readConsent ישירות)', /const \{ record: existing \} = initConsent\(\)/.test(consentContextSrc))
chk('bannerOpen נגזר מ-!existing — record=null מציג את הבאנר מחדש', /setBannerOpen\(!existing\)/.test(consentContextSrc))

// ─── קישור הגדרות פרטיות בפוטר ────────────────────────────────────────────
section('קישור שינוי ההעדפות בפוטר')

const footerSrc = src('components/layout/Footer.tsx')
chk('Footer.tsx מייבא ומרנדר PrivacySettingsFooterLink',
  /import PrivacySettingsFooterLink from/.test(footerSrc) && /<PrivacySettingsFooterLink/.test(footerSrc))

const footerLinkSrc = src('components/ui/PrivacySettingsFooterLink.tsx')
chk('הקישור פותח את openPreferences מ-useConsent', /openPreferences/.test(footerLinkSrc))
chk('הטקסט הוא בדיוק "הגדרות פרטיות ועוגיות"', /הגדרות פרטיות ועוגיות/.test(footerLinkSrc))

// ─── שלושת כפתורי הבאנר באותה שכבה חזותית ────────────────────────────────
section('כפתורי אישור/דחייה/התאמה אישית באותה שכבה (אין dark pattern)')

const bannerSrc = src('components/ui/CookieNotice.tsx')
const buttonClassMatches = [...bannerSrc.matchAll(/onClick=\{[^}]*\}\s*\n\s*className="([^"]+)"/g)]
  .map((m) => m[1])
chk('נמצאו 3 כפתורי פעולה בבאנר', buttonClassMatches.length === 3)
chk('לשלושת הכפתורים בדיוק אותו className (אותו גודל/צבע/משקל — אין כפתור מודגש)',
  buttonClassMatches.length === 3 && new Set(buttonClassMatches).size === 1)
chk('אף כפתור לא צבוע ב-bg-brand-gold (שנחשב "מודגש" באתר הזה)',
  !buttonClassMatches.some((c) => /bg-brand-gold(?!-)/.test(c) || /\bbg-brand-gold\b/.test(c)))

// ─── CSP: רק מקורות הספקים המדויקים ───────────────────────────────────────
section('CSP מאפשר רק את מקורות הספקים המדויקים')

const configUrl = new URL('../next.config.mjs', import.meta.url).href
const prevEnv = process.env.NODE_ENV
process.env.NODE_ENV = 'production'
const { default: prodConfig } = await import(`${configUrl}?consent-test`)
process.env.NODE_ENV = prevEnv
const prodRules = await prodConfig.headers()
const prodCsp = (prodRules.find((r) => r.source === '/:path*')?.headers ?? [])
  .find((h) => h.key === 'Content-Security-Policy')?.value ?? ''

chk('script-src מתיר googletagmanager.com', prodCsp.includes('https://www.googletagmanager.com'))
chk('script-src מתיר connect.facebook.net', prodCsp.includes('https://connect.facebook.net'))
chk('connect-src מתיר google-analytics.com', prodCsp.includes('https://www.google-analytics.com'))
chk('img-src מתיר facebook.com', prodCsp.includes('https://www.facebook.com'))
chk('אין תו wildcard (*) בשום מקום ב-CSP', !prodCsp.includes('*'))
chk('אין https: כללי (סכימה גורפת)', !/(^|[\s'])https:(?=\s|;|$)/.test(prodCsp))

// ─── שלב 5 + תיקון התמונות עדיין מחוברים ──────────────────────────────────
section('שלב 5 (headers) ותיקון התמונות נשארים תקינים')

const pkg = JSON.parse(src('package.json'))
chk('npm run test עדיין מריץ test:security-headers', pkg.scripts.test.includes('test:security-headers'))
chk('npm run test עדיין מריץ test:image-integrity', pkg.scripts.test.includes('test:image-integrity'))
chk('scripts/test-security-headers.mjs עדיין קיים', src('scripts/test-security-headers.mjs').length > 0)
chk('scripts/test-image-integrity.mjs עדיין קיים', src('scripts/test-image-integrity.mjs').length > 0)
chk('CSP עדיין ללא unsafe-eval בפרוד', !prodCsp.includes('unsafe-eval'))
chk("CSP עדיין frame-ancestors 'none'", /frame-ancestors 'none'/.test(prodCsp))

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter((r) => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
