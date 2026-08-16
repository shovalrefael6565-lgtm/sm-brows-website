/**
 * שלב 6 — ליבת מנגנון ההסכמה: קריאה/כתיבה של רשומת ההסכמה ב-localStorage,
 * וניקוי cookies של Google/Meta עם ביטול הסכמה.
 *
 * פונקציות טהורות בכוונה (לא React) כדי שיהיה אפשר לבדוק אותן ישירות
 * ב-scripts/test-consent.mjs בלי לרנדר קומפוננטות.
 */

export const CONSENT_STORAGE_KEY = 'sm-brows-consent'
export const CONSENT_VERSION = 1
export const CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000 // 180 יום

export interface ConsentRecord {
  version: number
  analytics: boolean
  marketing: boolean
  decidedAt: number
}

export type ConsentChoice = Pick<ConsentRecord, 'analytics' | 'marketing'>

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    fbq?: (...args: unknown[]) => void
  }
}

/** JSON פגום, גרסה ישנה או רשומה שפגה (מעל 180 יום) = אין הסכמה. */
export function isValidConsentRecord(value: unknown): value is ConsentRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  if (r.version !== CONSENT_VERSION) return false
  if (typeof r.analytics !== 'boolean' || typeof r.marketing !== 'boolean') return false
  if (typeof r.decidedAt !== 'number' || !Number.isFinite(r.decidedAt)) return false
  const age = Date.now() - r.decidedAt
  return age >= 0 && age < CONSENT_MAX_AGE_MS
}

export function readConsent(): ConsentRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isValidConsentRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeConsent(choice: ConsentChoice): ConsentRecord {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    analytics: choice.analytics,
    marketing: choice.marketing,
    decidedAt: Date.now(),
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record))
    } catch {
      // localStorage חסום (מצב פרטי קיצוני וכו') — ההסכמה פשוט לא נשמרת,
      // והבאנר יופיע שוב בפעם הבאה. לא קורס.
    }
  }
  return record
}

// ─── ניקוי cookies ידועים ────────────────────────────────────────────────

const GA_COOKIE_PATTERNS = [/^_ga$/, /^_ga_/]
const META_COOKIE_PATTERNS = [/^_fbp$/, /^_fbc$/]

function cookieNamesMatching(cookieString: string, patterns: RegExp[]): string[] {
  if (!cookieString) return []
  return cookieString
    .split(';')
    .map((pair) => pair.split('=')[0]?.trim())
    .filter((name): name is string => Boolean(name) && patterns.some((p) => p.test(name)))
}

/**
 * הדומיין היחיד שהאתר רץ עליו בפרודקשן — קבוע בכוונה, באותו סגנון כמו
 * SITE_URL ב-lib/utils.ts. לא מחשבים דומיין בסיס דינמית מ-hostname: hostname
 * כמו smbrows.co.il הוא 3 labels (smbrows.co.il), ואלגוריתם "הסר label
 * ראשון" היה מחשב co.il כדומיין בסיס — זה שגוי (co.il הוא public suffix,
 * לא הדומיין של האתר) ועלול לנסות למחוק/להשפיע על cookies שלא שייכים לנו.
 */
const PRODUCTION_APEX_DOMAIN = 'smbrows.co.il'

/**
 * מוחק cookie בשם נתון. תמיד מנסה host-only (בלי domain attribute — זה מה
 * שצריך ב-localhost/preview). בפרודקשן (smbrows.co.il או תת-דומיין שלו)
 * מוסיף גם Domain=smbrows.co.il ו-Domain=.smbrows.co.il, כי gtag/fbq עלולים
 * לקבוע cookies על הדומיין העליון. Path=/ בכל ניסיון.
 */
function expireCookie(name: string): void {
  const host = window.location.hostname
  const domainVariants: (string | undefined)[] = [undefined]
  if (host === PRODUCTION_APEX_DOMAIN || host.endsWith(`.${PRODUCTION_APEX_DOMAIN}`)) {
    domainVariants.push(PRODUCTION_APEX_DOMAIN, `.${PRODUCTION_APEX_DOMAIN}`)
  }

  for (const domain of domainVariants) {
    const domainAttr = domain ? `; domain=${domain}` : ''
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domainAttr}`
  }
}

function deleteCookiesMatching(patterns: RegExp[]): void {
  if (typeof document === 'undefined') return
  for (const name of cookieNamesMatching(document.cookie, patterns)) {
    expireCookie(name)
  }
}

export function deleteGaCookies(): void {
  deleteCookiesMatching(GA_COOKIE_PATTERNS)
}

export function deleteMetaCookies(): void {
  deleteCookiesMatching(META_COOKIE_PATTERNS)
}

// ─── אתחול/ניקוי בעת טעינת האתר ────────────────────────────────────────────

export interface InitConsentResult {
  /** null אם אין הסכמה תקפה כרגע — הבאנר צריך להופיע. */
  record: ConsentRecord | null
  /** true אם בוצע ניקוי (cookies + הסרת רשומה מ-localStorage) כי לא הייתה הסכמה תקפה. */
  cleaned: boolean
}

/**
 * קוראים ל-initConsent() פעם אחת, באתחול ConsentProvider, *לפני* שכל
 * tracker מקבל הזדמנות לפעול. אם אין הסכמה תקפה (הרשומה חסרה, JSON פגום,
 * גרסה ישנה, או פגה אחרי 180 יום) — מנקים cookies ידועים של GA/Meta
 * ומסירים רשומת localStorage ישנה/פגומה, כדי לא להשאיר שיירים מ-consent
 * קודם (או מהמנגנון הישן שלפני שלב 6). המצב נשאר null במפורש: אין כתיבה
 * אוטומטית של Reject — המשתמשת צריכה לבחור מחדש, והבאנר יוצג. לא נוצר שום
 * מזהה ולא נשלחת שום בקשת רשת — הפונקציה נוגעת רק ב-localStorage/cookies.
 */
export function initConsent(): InitConsentResult {
  const existing = readConsent()
  if (existing) return { record: existing, cleaned: false }

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(CONSENT_STORAGE_KEY)
    } catch {
      // אותו כשל שקט כמו ב-writeConsent — localStorage חסום, אין מה לעשות.
    }
  }
  deleteGaCookies()
  deleteMetaCookies()
  return { record: null, cleaned: true }
}

// ─── GA lifecycle: disable flag + Consent Mode update ────────────────────
// אין Google Ads באתר, ולכן ad_storage/ad_user_data/ad_personalization
// נשארים denied תמיד — גם כש-Meta Marketing מאושר. רק analytics_storage
// זז לפי ההסכמה.

function gaDisableKey(gaId: string): string {
  return `ga-disable-${gaId}`
}

/** window['ga-disable-<GA_ID>'] — הקצאת property רגילה, לא קוראת ל-gtag ולא דורשת שהוא יהיה קיים. בטוח לקרוא תמיד. */
export function setGaDisabled(gaId: string | undefined, disabled: boolean): void {
  if (typeof window === 'undefined' || !gaId) return
  ;(window as unknown as Record<string, boolean>)[gaDisableKey(gaId)] = disabled
}

export function isGaDisabled(gaId: string | undefined): boolean | undefined {
  if (typeof window === 'undefined' || !gaId) return undefined
  return (window as unknown as Record<string, boolean>)[gaDisableKey(gaId)]
}

/** שולח gtag('consent','update',...) — אך ורק אם gtag כבר קיים. אין יצירת gtag ואין queueing כשהוא חסר. */
export function updateGaConsent(analyticsGranted: boolean): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  window.gtag('consent', 'update', {
    analytics_storage: analyticsGranted ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
}

// ─── Meta lifecycle: consent grant/revoke ─────────────────────────────────

/** שולח fbq('consent', action) — אך ורק אם fbq כבר קיים. */
export function setMetaConsent(action: 'grant' | 'revoke'): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return
  window.fbq('consent', action)
}

// ─── נתיבים ללא tracking ─────────────────────────────────────────────────

const EXCLUDED_PREFIXES = ['/admin', '/account', '/login']

/** /admin, /account ו-/login (כולל תתי-נתיבים) — לעולם לא נטענים שם trackers. */
export function isTrackingExcludedPath(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
