import 'server-only'

/**
 * מקור אמת יחיד לכתובת ה-IP של הלקוחה.
 *
 * ═══ למה זה קובץ נפרד ולמה זה קריטי ═══
 *
 * משלב 15B, המסלול הציבורי (`/booking`) אינו דורש OTP. המשמעות: מגבלת
 * הקצב לפי IP היא אחת משתי ההגנות היחידות מפני תפיסת סלוטים המונית
 * (השנייה היא `max_active_pending_per_customer`). הגנה כזו טובה בדיוק
 * כמו מקור ה-IP שמזין אותה.
 *
 * ═══ 🔒 מקור מהימן אחד בלבד ═══
 *
 * **`x-vercel-forwarded-for` הוא המקור בפרודקשן.** הכותרת נכתבת ע"י ה-edge
 * של Vercel ואינה ניתנת לשליטה מהלקוח.
 *
 * ⚠️ **`x-forwarded-for` אינו נקרא כאן כמקור סמכותי בפרודקשן.** הכותרת
 * הזו היא שרשרת proxy-ים, והסתמכות על איבר כלשהו בה כמקור אמת היא דפוס
 * שביר. היא משמשת **אך ורק** כ-fallback מקומי, כשברור שאיננו על Vercel.
 *
 * ⚠️ `NextRequest.ip` **אינו** בשימוש: הוא אינו מתועד כנתמך בכל runtime
 * של Next 14 בפרויקט הזה, והסתמכות עליו בלי הוכחה הייתה מכניסה תלות
 * שקטה שעלולה להחזיר undefined בפרודקשן ולהפעיל fail-closed על כולן.
 *
 * ═══ מדיניות הכישלון ═══
 *
 *   • **פרודקשן על Vercel** — אין IP מהימן ⟶ `ok: false`. הקורא חייב
 *     לחסום את יצירת ההזמנה (fail-closed). ראה app/api/bookings/request.
 *   • **מקומי / בדיקות** — נפילה מבוקרת, כדי שאפשר יהיה לפתח ולבדוק
 *     בלי Vercel. המסלול הזה **אינו זמין** כשמשתנה הסביבה VERCEL קיים.
 */

export type ClientIpFailureReason =
  /** אנחנו על Vercel אך הכותרת המהימנה חסרה או ריקה */
  | 'trusted_header_missing'
  /** התקבל ערך, אך הוא אינו כתובת IP תקינה */
  | 'invalid_address'

export type ClientIpResult =
  | { ok: true; ip: string; source: 'vercel' | 'local_fallback' }
  | { ok: false; reason: ClientIpFailureReason }

/** הכותרת היחידה שנחשבת מהימנה בפרודקשן */
const TRUSTED_HEADER = 'x-vercel-forwarded-for'

/** כותרות fallback — נקראות אך ורק כשאיננו על Vercel */
const LOCAL_FALLBACK_HEADERS = ['x-forwarded-for', 'x-real-ip'] as const

/** כתובת שמיוחסת לבקשה מקומית שאין בה שום כותרת IP */
const LOOPBACK = '127.0.0.1'

/**
 * האם אנו רצים על Vercel. `VERCEL` מוגדר אוטומטית בכל פריסה — preview
 * ו-production כאחד — ואינו מוגדר בהרצה מקומית או בבדיקות.
 */
export function isVercelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === '1' || env.VERCEL === 'true'
}

/** IPv4 — ארבעה אוקטטים 0–255, בלי אפסים מובילים מיותרים */
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/**
 * IPv6 — כולל כיווץ `::` וכתובות ממופות-IPv4 (`::ffff:1.2.3.4`).
 *
 * ⚠️ הוולידציה כאן אינה קוסמטית: הערך נכתב לעמודת `inet` ב-Postgres, וערך
 * לא תקין היה מפיל את ה-RPC כולו — כלומר הופך קלט זדוני לשגיאת שרת.
 */
function isValidIpv6(value: string): boolean {
  if (!value.includes(':')) return false
  if (value.split('::').length > 2) return false // לכל היותר כיווץ אחד

  // חלק אחרון בצורת IPv4 (::ffff:192.0.2.1) — ממירים אותו לשני קבוצות hex
  let work = value
  const lastColon = work.lastIndexOf(':')
  const tail = work.slice(lastColon + 1)
  if (tail.includes('.')) {
    if (!IPV4_RE.test(tail)) return false
    work = `${work.slice(0, lastColon)}:0:0`
  }

  const [head, rest] = work.split('::')
  const headGroups = head === '' ? [] : head.split(':')
  const restGroups = rest === undefined || rest === '' ? [] : rest.split(':')
  const groups = [...headGroups, ...restGroups]

  if (groups.some(g => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false

  // עם כיווץ — פחות מ-8 קבוצות; בלי כיווץ — בדיוק 8
  return work.includes('::') ? groups.length < 8 : groups.length === 8
}

export function isValidIpAddress(value: string): boolean {
  return IPV4_RE.test(value) || isValidIpv6(value)
}

/**
 * מנקה ערך גולמי מכותרת: לוקח את האיבר הראשון, מסיר סוגריים מרובעים
 * ופורט. מחזיר null אם לא נשאר ערך.
 *
 * ⚠️ הסרת פורט נעשית רק כשהיא חד-משמעית: `1.2.3.4:5678` (נקודתיים אחת
 * בלבד) או `[::1]:5678` (סוגריים). כתובת IPv6 חשופה מכילה נקודתיים רבות
 * ולעולם אינה נחתכת כאן.
 */
function cleanCandidate(raw: string | null): string | null {
  if (!raw) return null
  let value = raw.split(',')[0].trim()
  if (!value) return null

  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    if (close === -1) return null
    value = value.slice(1, close)
  } else if (value.split(':').length === 2) {
    value = value.split(':')[0]
  }

  value = value.trim()
  return value === '' ? null : value
}

export interface ClientIpOptions {
  env?: NodeJS.ProcessEnv
}

/**
 * מחלצת את כתובת ה-IP של הלקוחה מכותרות הבקשה.
 *
 * מקבלת `Headers` ולא `NextRequest` — כך אפשר לבדוק אותה ישירות, בלי
 * לבנות אובייקט בקשה של Next. אותו שיקול כמו ב-`resolveAvailability`
 * וב-`runReminderDispatch`.
 */
export function resolveClientIp(
  headers: Headers,
  options: ClientIpOptions = {},
): ClientIpResult {
  const env = options.env ?? process.env
  const onVercel = isVercelRuntime(env)

  const trusted = cleanCandidate(headers.get(TRUSTED_HEADER))
  if (trusted) {
    return isValidIpAddress(trusted)
      ? { ok: true, ip: trusted, source: 'vercel' }
      : { ok: false, reason: 'invalid_address' }
  }

  /*
   * 🔒 על Vercel — הכותרת המהימנה היא המקור **היחיד**. אין נפילה
   * ל-x-forwarded-for: היא ניתנת להשפעה מהלקוח בשרשראות proxy, ומגבלת
   * קצב שמסתמכת עליה אינה מגבלה. הקורא חוסם.
   */
  if (onVercel) {
    return { ok: false, reason: 'trusted_header_missing' }
  }

  // ── מקומי / בדיקות בלבד ──────────────────────────────────────────────
  for (const header of LOCAL_FALLBACK_HEADERS) {
    const candidate = cleanCandidate(headers.get(header))
    if (!candidate) continue
    if (!isValidIpAddress(candidate)) return { ok: false, reason: 'invalid_address' }
    return { ok: true, ip: candidate, source: 'local_fallback' }
  }

  return { ok: true, ip: LOOPBACK, source: 'local_fallback' }
}
