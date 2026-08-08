import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/phone'
import { resolveClientIp } from '@/lib/clientIp'
import { computePendingExpiresAt } from '@/lib/pendingExpiry'
import { bookingRateLimitMessage } from '@/lib/bookingRateLimit'
import { linkOrCreateCustomerByPhone } from '@/lib/db/customers'
import { createPublicPendingAppointment } from '@/lib/db/appointments'
import { getBusyRanges } from '@/lib/googleCalendar'
import { isShabbat } from '@/lib/shabbat'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'
import {
  NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS,
  LIFTING_PRICE, LIFTING_DURATION_MIN, NATURAL_DURATION_MIN,
} from '@/lib/services'
import { isBookableDate, isValidTimeSlot, isValidLiftingStart, hasLeadTime } from '@/lib/bookingWindow'
import { POLICY_VERSION } from '@/lib/bookingPolicy'

export const dynamic = 'force-dynamic'

/**
 * שמירת בקשת תור מהמסלול **הציבורי** — ללא התחברות וללא OTP (שלב 15B).
 *
 * ═══ מה זה כן, ומה זה לא ═══
 *
 * ✅ זה ה-endpoint של `/booking`. הוא מזהה את הלקוחה לפי **טלפון מנורמל**
 *    שהוקלד בטופס, יוצר או מקשר אותה, ושומר בקשה `pending`.
 *
 * ❌ זה **אינו** מסלול מאומת. הטלפון כאן הוקלד ולא אומת, ולכן:
 *    • לא נוצר session ולא auth user
 *    • התשובה אינה מחזירה שום נתון על הלקוחה
 *    • התשובה אינה מסגירה אם המספר כבר היה קיים במערכת
 *
 * `POST /api/appointments` נשאר המסלול **המאומת** (session חובה) ומשרת
 * את האזור האישי. אין ערבוב: שני מסלולים, שתי נקודות כניסה.
 *
 * ═══ 🔒 שכבות ההגנה, בסדר ═══
 *
 *   1. kill switch — לפני כל קריאה ל-DB או ל-Google.
 *   2. נעילת שבת.
 *   3. **IP מהימן.** בפרודקשן על Vercel — אין IP ⟶ הבקשה נחסמת
 *      (fail-closed). ראה lib/clientIp.ts.
 *   4. ולידציית קלט: טלפון, שם, תאריך, שעה, טיפול.
 *   5. חלון הזמינות (יום פתוח, שעה ברשת, 40 דק' הכנה).
 *   6. Google Calendar — בדיקה מוקדמת וזולה, לא חוסמת בכשל.
 *   7. **מגבלת קצב לפי IP + EXCLUDE constraint** — שתיהן באותה טרנזקציה
 *      בתוך ה-RPC. אלה ההגנות האמיתיות; כל מה שמעליהן הוא חוויית משתמש.
 *
 * ═══ ⚠️ אין silent failure ═══
 *
 * כל מסלול כישלון מחזיר `whatsappFallback: true` יחד עם הודעה שמבהירה
 * שהבקשה **לא** נשמרה. הלקוחה אף פעם לא רואה "נשלח" על בקשה שאיננה
 * במערכת, ותמיד מקבלת דרך להגיע לשובל.
 */

interface FailureOptions {
  status: number
  error: string
  message: string
  /** האם להציע ללקוחה לפנות בוואטסאפ במקום */
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
      message: 'שמירת בקשות דרך האתר אינה זמינה כרגע.',
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

  /*
   * 🔒 fail-closed. אין IP מהימן ⟶ לא נוצרת בקשה, לא נתפסת שעה.
   *
   * ⚠️ בלי זה, מגבלת הקצב הייתה ניתנת לעקיפה מוחלטת ע"י בקשה בלי הכותרת
   * המהימנה — כלומר ההגנה המרכזית של מסלול לא-מאומת הייתה תפאורה.
   * ההודעה ללקוחה כללית ואינה מסבירה מה חסר.
   */
  const ipResult = resolveClientIp(req.headers)
  if (!ipResult.ok) {
    console.error('[bookings/request] no trusted client ip —', ipResult.reason)
    return fail({
      status: 503,
      error: 'ip_unavailable',
      message: 'לא הצלחנו לשמור את הבקשה כרגע. הבקשה לא נשמרה — אפשר לשלוח לנו אותה בוואטסאפ.',
      fallback: true,
    })
  }

  let body: {
    serviceKey?: string
    variants?: unknown
    isoDate?: string
    time?: string
    notes?: unknown
    fullName?: string
    phone?: string
  }
  try {
    body = await req.json()
  } catch {
    return fail({ status: 400, error: 'bad_request', message: 'בקשה לא תקינה.' })
  }

  // ── זהות הלקוחה ────────────────────────────────────────────────────────
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

  // ── הטיפול והמועד ──────────────────────────────────────────────────────
  const { serviceKey, isoDate, time } = body
  if (serviceKey !== NATURAL_SERVICE && serviceKey !== LIFTING_SERVICE) {
    return fail({ status: 400, error: 'invalid_service', message: 'הטיפול שנבחר אינו זמין לקביעה אונליין.' })
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
      message: 'התאריך שנבחר אינו זמין לקביעה. יש לבחור תאריך אחר.',
    })
  }

  let variants: string[] = []
  let priceTotal: number
  let durationMin: number

  if (serviceKey === NATURAL_SERVICE) {
    if (!isValidTimeSlot(year, month, day, time)) {
      return fail({ status: 400, error: 'invalid_time', message: 'השעה שנבחרה אינה זמינה.' })
    }
    const requested = Array.isArray(body.variants)
      ? body.variants.filter((v): v is string => typeof v === 'string')
      : []
    // רק ids ידועים נשמרים — לא בוטח בקלט, וגם מונע כפילויות
    const matched = NATURAL_VARIANTS.filter(v => requested.includes(v.id))
    if (matched.length === 0) {
      return fail({ status: 400, error: 'variants_required', message: 'יש לבחור סוג טיפול אחד לפחות.' })
    }
    variants = matched.map(v => v.id)
    // המחיר תמיד מחושב בשרת מתוך lib/services.ts — לעולם לא נלקח מהלקוח
    priceTotal = matched.reduce((sum, v) => sum + v.price, 0)
    durationMin = NATURAL_DURATION_MIN
  } else {
    if (!isValidLiftingStart(year, month, day, time)) {
      return fail({ status: 400, error: 'invalid_time', message: 'השעה שנבחרה אינה זמינה.' })
    }
    priceTotal = LIFTING_PRICE
    durationMin = LIFTING_DURATION_MIN
  }

  if (!hasLeadTime(year, month, day, time)) {
    return fail({
      status: 400,
      error: 'too_soon',
      message: 'יש לבחור שעה שמתחילה לפחות 40 דקות מעכשיו.',
    })
  }

  /*
   * בדיקה מוקדמת מול היומן — זולה, ותופסת התנגשות עם אירוע ידני של שובל
   * לפני שנוצרת בקשה שאי אפשר יהיה לאשר. אם הבדיקה עצמה נכשלת (תקלת
   * רשת/Google) ממשיכים: ה-EXCLUDE constraint עדיין מגן מפני התנגשות בין
   * תורים שהמערכת יודעת עליהם, ובדיקה חוזרת רצה שוב באישור.
   */
  try {
    const busy = await getBusyRanges(isoDate)
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number)
      return h * 60 + m
    }
    const startMin = toMin(time)
    const endMin = startMin + durationMin
    if (busy.some(({ start, end }) => toMin(start) < endMin && toMin(end) > startMin)) {
      return fail({ status: 409, error: 'slot_taken', message: 'השעה שנבחרה נתפסה. יש לבחור שעה אחרת.' })
    }
  } catch (err) {
    console.error('[bookings/request] calendar pre-check failed', err)
  }

  // ── הלקוחה ─────────────────────────────────────────────────────────────
  const resolved = await linkOrCreateCustomerByPhone(phone, fullName)
  if (!resolved.ok) {
    if (resolved.error === 'bad_phone' || resolved.error === 'bad_name') {
      return fail({ status: 400, error: 'invalid_details', message: 'הפרטים שהוזנו אינם תקינים.' })
    }
    return fail({
      status: 503,
      error: 'server_error',
      message: 'לא הצלחנו לשמור את הבקשה כרגע. הבקשה לא נשמרה — אפשר לשלוח לנו אותה בוואטסאפ.',
      fallback: true,
    })
  }

  const customer = resolved.customer
  if (customer.is_blocked) {
    return fail({
      status: 403,
      error: 'blocked',
      message: 'לא ניתן לקבוע תור דרך האתר. יש ליצור קשר בוואטסאפ.',
      fallback: true,
    })
  }

  const notes =
    typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) || null : null

  const result = await createPublicPendingAppointment({
    customerId: customer.id,
    serviceKey,
    variants,
    priceTotal,
    isoDate,
    time,
    durationMin,
    notes,
    policyVersion: POLICY_VERSION,
    ip: ipResult.ip,
    expiresAt: computePendingExpiresAt(),
  })

  if (result.error === 'rate_limited') {
    return fail({ status: 429, error: 'rate_limited', message: bookingRateLimitMessage(), fallback: true })
  }
  if (result.error === 'slot_taken') {
    return fail({
      status: 409,
      error: 'slot_taken',
      message: 'השעה שנבחרה נתפסה הרגע. יש לבחור שעה אחרת.',
    })
  }
  if (result.error === 'pending_limit_reached') {
    return fail({
      status: 409,
      error: 'pending_limit_reached',
      message: 'יש לך כבר בקשות שממתינות לאישור. ניתן להגיש בקשה נוספת לאחר שאחת מהן תטופל.',
      fallback: true,
    })
  }
  if (result.error || !result.appointment) {
    return fail({
      status: 500,
      error: 'server_error',
      message: 'לא הצלחנו לשמור את הבקשה. הבקשה לא נשמרה — אפשר לשלוח לנו אותה בוואטסאפ.',
      fallback: true,
    })
  }

  /*
   * ⚠️ התשובה מכילה את המינימום ההכרחי. אין כאן customer id, אין שם, אין
   * טלפון, ואין שום סימן לשאלה אם הלקוחה כבר הייתה קיימת במערכת.
   */
  return NextResponse.json({ ok: true, saved: true }, { status: 201 })
}
