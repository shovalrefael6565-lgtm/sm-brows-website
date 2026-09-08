import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/phone'
import { resolveClientIp } from '@/lib/clientIp'
import { readJsonWithLimit, DEFAULT_MAX_JSON_BYTES } from '@/lib/http/bodyLimit'
import { createWaitlistRequest } from '@/lib/db/waitlist'
import { getBusyRanges } from '@/lib/googleCalendar'
import { getDbBusyRangesForDate } from '@/lib/db/appointments'
import { resolveAvailability } from '@/lib/bookingAvailability'
import { isShabbat } from '@/lib/shabbat'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'
import { isBookableDate } from '@/lib/bookingWindow'
import { isWaitlistSlotStillOpen } from '@/lib/waitlist'
import { PRIVACY_NOTICE_VERSION } from '@/lib/privacyNotice'
import {
  NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS,
  LIFTING_DURATION_MIN, NATURAL_DURATION_MIN,
} from '@/lib/services'

export const dynamic = 'force-dynamic'

/**
 * הצטרפות לרשימת המתנה.
 *
 * ═══ מה זה כן, ומה זה **לא** ═══
 *
 * ✅ שומר בקשה ב-`waitlist_requests` (0037) ומקשר אותה ללקוחה לפי טלפון
 *    מנורמל, דרך `link_or_create_customer_by_phone` — אותה פונקציה בדיוק
 *    שהמסלול הציבורי משתמש בה, ולכן אין כרטיס כפול ואין PII כפול.
 *
 * ❌ **אינו יוצר תור.** אין `appointments`, אין חסימת סלוט, אין אירוע
 *    ביומן, אין תזכורות ואין SMS תפעולי. הזמינות הציבורית אינה משתנה
 *    בעקבות הקריאה הזו — לא בגלל שהקוד נזהר, אלא בגלל שאין כאן מסלול
 *    שמוביל לשם. ראה ההערה ב-lib/db/waitlist.ts.
 *
 * ═══ 🔒 שכבות ההגנה, בסדר — זהות למסלול ההזמנה ═══
 *
 *   1. kill switch.
 *   2. נעילת שבת.
 *   3. IP מהימן (fail-closed).
 *   4. אישור הודעת הפרטיות — **אותה דרישה בדיוק** כמו בהזמנה. אין כאן
 *      מסלול שעוקף אותה; ה-RPC אוכף אותה שוב.
 *   5. ולידציית קלט: טלפון, שם, תאריך, שעה, טיפול.
 *   6. 🔒 **revalidation מלא של הזמינות** — ראה למטה.
 *   7. מגבלות קצב ב-RPC (IP משותף עם ההזמנות + מגבלות ללקוחה).
 *
 * ═══ 🔒 revalidation — הלב של המסלול ═══
 *
 * הזמינות נקראת **טרייה** דרך `resolveAvailability`, עם אותם שני מקורות
 * ואותה דוקטרינת fail-closed של `/api/bookings/slots` — ו**לא** דרך
 * המטמון של ה-route ההוא. מקור שנפל = "אין תשובה", ולכן הבקשה נדחית
 * במקום להישמר על שעה שאיננו יודעים אם היא פנויה.
 *
 * ⚠️ `durationMin` נגזר כאן מ-`lib/services.ts` לפי הטיפול, ולעולם אינו
 * מתקבל מהדפדפן. גם ה-CHECK ב-0037 חוזר על כך.
 */

interface FailureOptions {
  status: number
  error: string
  message: string
  fallback?: boolean
}

function fail({ status, error, message, fallback = false }: FailureOptions) {
  return NextResponse.json(
    { error, message, whatsappFallback: fallback, saved: false },
    { status },
  )
}

export async function POST(req: NextRequest) {
  if (!isNewBookingSystemEnabled()) {
    return fail({
      status: 403,
      error: 'feature_disabled',
      message: 'רשימת ההמתנה אינה זמינה כרגע.',
      fallback: true,
    })
  }

  if (isShabbat()) {
    return fail({
      status: 403,
      error: 'shabbat',
      message: 'המערכת אינה פעילה בשבת. נשמח לעמוד לרשותך במוצאי שבת.',
    })
  }

  const ipResult = resolveClientIp(req.headers)
  if (!ipResult.ok) {
    console.error('[waitlist] no trusted client ip —', ipResult.reason)
    return fail({
      status: 503,
      error: 'ip_unavailable',
      message: 'לא הצלחנו לשמור את הבקשה כרגע. הבקשה לא נשמרה — אפשר לפנות אלינו בוואטסאפ.',
      fallback: true,
    })
  }

  const parsed = await readJsonWithLimit<{
    serviceKey?: string
    variants?: unknown
    isoDate?: string
    time?: string
    fullName?: string
    phone?: string
    privacyNoticeAcknowledged?: unknown
    privacyNoticeVersion?: unknown
  }>(req, DEFAULT_MAX_JSON_BYTES)
  if (!parsed.ok) {
    return parsed.status === 413
      ? fail({ status: 413, error: 'payload_too_large', message: 'הבקשה גדולה מדי.' })
      : fail({ status: 400, error: 'bad_request', message: 'בקשה לא תקינה.' })
  }
  const body = parsed.body

  const phone = normalizePhone(body.phone ?? '')
  if (!phone) {
    return fail({
      status: 400,
      error: 'invalid_phone',
      message: 'מספר הטלפון אינו תקין. יש להזין מספר נייד ישראלי.',
    })
  }

  const fullName = (body.fullName ?? '').trim()
  if (fullName.length < 2 || fullName.length > 80) {
    return fail({ status: 400, error: 'invalid_name', message: 'יש להזין שם מלא.' })
  }

  // 🔒 אותה דרישה בדיוק כמו ב-/api/bookings/request. אין מסלול עוקף.
  if (body.privacyNoticeAcknowledged !== true || body.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION) {
    return fail({
      status: 400,
      error: 'privacy_not_acknowledged',
      message: 'יש לאשר את מדיניות הפרטיות כדי להצטרף לרשימת ההמתנה.',
    })
  }

  const { serviceKey, isoDate, time } = body
  if (serviceKey !== NATURAL_SERVICE && serviceKey !== LIFTING_SERVICE) {
    return fail({ status: 400, error: 'invalid_service', message: 'הטיפול שנבחר אינו זמין לרשימת המתנה.' })
  }
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return fail({ status: 400, error: 'invalid_date', message: 'התאריך שנבחר אינו תקין.' })
  }
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return fail({ status: 400, error: 'invalid_time', message: 'השעה שנבחרה אינה תקינה.' })
  }

  const [y, mo, d] = isoDate.split('-').map(Number)
  const year = y, month = mo - 1, day = d

  if (!isBookableDate(year, month, day)) {
    return fail({
      status: 400,
      error: 'date_unavailable',
      message: 'התאריך שנבחר אינו זמין. יש לבחור תאריך אחר.',
    })
  }

  /*
   * 🔒 המשך נגזר בשרת בלבד. `variants` מסונן מול הרשימה הידועה, בדיוק
   * כמו במסלול ההזמנה — לא בוטח בקלט, וגם מונע כפילויות.
   */
  let variants: string[] = []
  let durationMin: number
  if (serviceKey === NATURAL_SERVICE) {
    const requested = Array.isArray(body.variants)
      ? body.variants.filter((v): v is string => typeof v === 'string')
      : []
    const matched = NATURAL_VARIANTS.filter(v => requested.includes(v.id))
    if (matched.length === 0) {
      return fail({ status: 400, error: 'variants_required', message: 'יש לבחור סוג טיפול אחד לפחות.' })
    }
    variants = matched.map(v => v.id)
    durationMin = NATURAL_DURATION_MIN
  } else {
    durationMin = LIFTING_DURATION_MIN
  }

  /*
   * ═══ 🔒 revalidation — טרי, שני מקורות, fail-closed ═══
   *
   * ⚠️ **לא** דרך `/api/bookings/slots`: שם יש מטמון של 30 שניות, וזה
   * בדיוק החלון שבו שעה נתפסת. כאן קוראים את שני המקורות ישירות.
   */
  const availability = await resolveAvailability(isoDate, {
    calendarBusy: getBusyRanges,
    dbBusy: getDbBusyRangesForDate,
    newBookingSystemEnabled: isNewBookingSystemEnabled,
    log: (message, err) => console.error(message, err),
  })

  if (!availability.ok) {
    /*
     * 🔒 מקור אמת נפל. **לא שומרים.** רשימה ריקה כאן הייתה "היום פנוי",
     * וזו בדיוק הדלת ש-lib/bookingAvailability.ts נכתב כדי לסגור.
     */
    return fail({
      status: 503,
      error: 'availability_unavailable',
      message: 'לא הצלחנו לאמת את הזמינות כרגע. הבקשה לא נשמרה — אפשר לנסות שוב בעוד רגע.',
      fallback: true,
    })
  }

  /*
   * 🔒 השעה חייבת להיות חוקית **ופנויה** ברגע השמירה: רשת שעות העבודה,
   * שישי/שבת, טווח 30 יום, חלון ההכנה, ואי-חפיפה מול היומן ומול
   * תורים/pending — כולם נבדקים בקריאה אחת מול אותו מנגנון שמזין את
   * התצוגה.
   *
   * ⚠️ בכוונה **לא** נבדק כאן שהשעה אינה מוצגת בקביעת התור הרגילה:
   * החיסור תלוי בשעון (חלון ההכנה זז) ובזרע התאריך, ובקשה תקינה הייתה
   * נדחית רק משום שדקה עברה בין הרינדור לשליחה. ראה lib/waitlist.ts.
   */
  const stillOpen = isWaitlistSlotStillOpen({
    year, month, day,
    busyRanges: availability.busy,
    durationMin,
    time,
  })

  if (!stillOpen) {
    return fail({
      status: 409,
      error: 'slot_unavailable',
      message: 'השעה שבחרת כבר אינה פנויה. אפשר לבחור שעה אחרת מהרשימה 🤍',
    })
  }

  const result = await createWaitlistRequest({
    phoneE164: phone,
    fullName,
    serviceKey,
    variants,
    durationMin,
    isoDate,
    time,
    ip: ipResult.ip,
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    privacyAcknowledged: true,
  })

  if (result.error === 'duplicate') {
    // ⚠️ לא כשל מבחינת הלקוחה: היא כבר ברשימה לאותו מועד.
    return NextResponse.json({ ok: true, saved: true, alreadyOnList: true }, { status: 200 })
  }
  if (result.error === 'rate_limited') {
    return fail({
      status: 429,
      error: 'rate_limited',
      message: 'נשלחו יותר מדי בקשות מהמכשיר הזה. אפשר לנסות שוב בעוד שעה, או לפנות אלינו בוואטסאפ.',
      fallback: true,
    })
  }
  if (result.error === 'open_limit_reached') {
    return fail({
      status: 409,
      error: 'open_limit_reached',
      message: 'יש לך כבר חמש בקשות פעילות ברשימת ההמתנה. נחזור אלייך ברגע שתתפנה שעה.',
      fallback: true,
    })
  }
  if (result.error === 'hourly_limit_reached') {
    return fail({
      status: 429,
      error: 'hourly_limit_reached',
      message: 'נשלחו יותר מדי בקשות בזמן קצר. אפשר לנסות שוב בעוד שעה.',
      fallback: true,
    })
  }
  if (result.error === 'privacy_not_acknowledged') {
    console.error('[waitlist] RPC rejected privacy acknowledgement despite route-level check')
    return fail({
      status: 400,
      error: 'privacy_not_acknowledged',
      message: 'יש לאשר את מדיניות הפרטיות כדי להצטרף לרשימת ההמתנה.',
    })
  }
  if (result.error === 'invalid_details') {
    return fail({ status: 400, error: 'invalid_details', message: 'הפרטים שהוזנו אינם תקינים.' })
  }

  /*
   * 🔒 **לקוחה חסומה מקבלת בדיוק את אותה תשובה ככשל שרת** — אותו שיקול
   * כמו ב-/api/bookings/request: נוסח ייעודי היה הופך את ה-endpoint
   * לאורקל שממפה אילו מספרים חסומים.
   */
  if (result.error === 'blocked') {
    console.error('[waitlist] blocked customer attempted to join the waitlist')
  }

  if (result.error || !result.id) {
    return fail({
      status: 500,
      error: 'server_error',
      message: 'לא הצלחנו לשמור את הבקשה. הבקשה לא נשמרה — אפשר לפנות אלינו בוואטסאפ.',
      fallback: true,
    })
  }

  /*
   * ⚠️ המינימום ההכרחי. אין כאן מזהה בקשה, אין customer id, ואין שום סימן
   * לשאלה אם הלקוחה כבר הייתה קיימת במערכת.
   *
   * 🔒 **אין `dispatchNow`.** בקשת המתנה אינה תור, ולכן אינה מפעילה את
   * מסלול ההתראות התפעולי.
   */
  return NextResponse.json({ ok: true, saved: true }, { status: 201 })
}
