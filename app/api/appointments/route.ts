import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { dispatchNow } from '@/lib/notifications/dispatch'
import { getCurrentCustomerId } from '@/lib/auth/currentCustomer'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { getCustomerById } from '@/lib/db/customers'
import { recordBookingMarketingConsent } from '@/lib/db/marketing'
import { createPersonalAreaBookingRequest } from '@/lib/db/appointments'
import { computePendingExpiresAt } from '@/lib/pendingExpiry'
import { getBusyRanges, logGoogleCalendarError } from '@/lib/googleCalendar'
import { isShabbat } from '@/lib/shabbat'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'
import {
  NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS,
  LIFTING_PRICE, LIFTING_DURATION_MIN, NATURAL_DURATION_MIN,
} from '@/lib/services'
import { isBookableDate, isValidTimeSlot, isValidLiftingStart, hasLeadTime, MIN_LEAD_MINUTES } from '@/lib/bookingWindow'
import { POLICY_VERSION } from '@/lib/bookingPolicy'
import { PRIVACY_NOTICE_VERSION } from '@/lib/privacyNotice'

export const dynamic = 'force-dynamic'

/**
 * שמירת בקשת תור כ-pending — המסלול **המאומת**, של האזור האישי.
 *
 * מקור האמת לזהות הלקוחה הוא אך ורק ה-session (cookie חתום) — אף שדה
 * טלפון מגוף הבקשה לא נקרא כאן. זו האכיפה בפועל של "אין לאפשר שמירת
 * בקשה תחת מספר אחר ללא אימות חדש": מבנית, אין דרך לספק customer_id
 * שלא עברה דרך OTP מוצלח (ראה app/api/auth/otp/verify).
 *
 * `POST /api/bookings/request` הוא המסלול **הציבורי** (בלי session, זהות
 * לפי טלפון שהוקלד). אין ערבוב: שני מסלולים, שתי נקודות כניסה.
 *
 * שכבות הבדיקה, בסדר:
 *   1. session תקף (401 אם לא) — מונע יצירת בקשה בלי אימות טלפון.
 *   2. תבנית הקלט (400).
 *   3. חלון הזמינות (יום פתוח, שעה ברשת, חלון ההכנה) — 400/'date_unavailable'.
 *   4. Google Calendar — בדיקה מוקדמת וזולה, לא חזות הכל (ראה למטה).
 *   5. ה-EXCLUDE constraint ב-DB — ההגנה האמיתית מפני התנגשות, כולל race.
 *
 * ═══ 🔒 שלב 15D — מה השתנה כאן ═══
 *
 * ⚠️ הוולידציה, חלון הזמינות ובדיקת היומן נשארו **מילה במילה**. מה שהוחלף
 * הוא שכבת הכתיבה בלבד: במקום `create_pending_appointment` (0003) נקראת
 * `create_personal_area_booking_request` (0020).
 *
 * ⚠️ ה-RPC הישן עדיין קיים במסד בזמן הפריסה, ומוסר רק ב-0021 — אחרי
 * שה-deployment הזה באוויר ו-QA-D עבר. זו פריסה דו-שלבית מכוונת: כל עוד
 * שתי הפונקציות חיות, גם deployment ישן וגם חדש עובדים, ואין חלון שבירה.
 *
 * ⚠️ הסיבה אינה סגנון. ה-RPC הישן חישב `pending_expires_at = now() + 12h`
 * מתוך business_settings, בעוד המסלול הציבורי כבר עבר בשלב 15B לכלל
 * שאושר — 3 שעות, עם גלגול ל-11:00 ביום העבודה הבא. שני מסלולים של אותו
 * עסק החזיקו סלוט למשך זמן שונה לחלוטין, וזה היה הופך גלוי ברגע שהאזור
 * האישי יקבל מסך קביעת תור. מאז 15D שניהם קוראים לאותה
 * `computePendingExpiresAt`, וה-booking_source מבדיל ביניהם ב-Admin.
 */
export async function POST(req: NextRequest) {
  if (!isNewBookingSystemEnabled()) {
    return NextResponse.json(
      { error: 'feature_disabled', message: 'קביעת תור דרך האתר אינה זמינה כרגע. יש לשלוח בקשה בוואטסאפ.' },
      { status: 403 },
    )
  }

  if (isShabbat()) {
    return NextResponse.json(
      { error: 'shabbat', message: 'המערכת אינה פעילה בשבת. נשמח לעמוד לרשותך במוצאי שבת.' },
      { status: 403 },
    )
  }

  const customerId = await getCurrentCustomerId()
  if (!customerId) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'יש לאמת את מספר הטלפון לפני שמירת הבקשה.' },
      { status: 401 },
    )
  }

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: {
    serviceKey?: string
    variants?: unknown
    isoDate?: string
    time?: string
    notes?: unknown
    privacyNoticeAcknowledged?: unknown
    privacyNoticeVersion?: unknown
    marketingConsent?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  /*
   * 🔒 שלב 8 — אישור מדיניות פרטיות. חובה גם בטופס ההזמנה של האזור האישי,
   * ונאכף כאן וגם ב-RPC (0031). ראה ההערה המקבילה ב-bookings/request.
   */
  if (body.privacyNoticeAcknowledged !== true || body.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION) {
    return NextResponse.json(
      { error: 'privacy_not_acknowledged', message: 'יש לאשר את מדיניות הפרטיות כדי לשלוח בקשת תור.' },
      { status: 400 },
    )
  }

  const { serviceKey, isoDate, time } = body
  if (serviceKey !== NATURAL_SERVICE && serviceKey !== LIFTING_SERVICE) {
    return NextResponse.json({ error: 'invalid_service' }, { status: 400 })
  }
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
  }
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: 'invalid_time' }, { status: 400 })
  }

  const [y, mo, d] = isoDate.split('-').map(Number)
  const year = y, month = mo - 1, day = d

  if (!isBookableDate(year, month, day)) {
    return NextResponse.json(
      { error: 'date_unavailable', message: 'התאריך שנבחר אינו זמין לקביעה. יש לבחור תאריך אחר.' },
      { status: 400 },
    )
  }

  let variants: string[] = []
  let priceTotal: number
  let durationMin: number

  if (serviceKey === NATURAL_SERVICE) {
    if (!isValidTimeSlot(year, month, day, time)) {
      return NextResponse.json({ error: 'invalid_time' }, { status: 400 })
    }
    const requested = Array.isArray(body.variants)
      ? body.variants.filter((v): v is string => typeof v === 'string')
      : []
    // רק ids ידועים נשמרים — לא בוטח בקלט, וגם מונע כפילויות
    const matched = NATURAL_VARIANTS.filter(v => requested.includes(v.id))
    if (matched.length === 0) {
      return NextResponse.json({ error: 'variants_required' }, { status: 400 })
    }
    variants = matched.map(v => v.id)
    // המחיר תמיד מחושב בשרת מתוך lib/services.ts — לעולם לא נלקח מהלקוח
    priceTotal = matched.reduce((sum, v) => sum + v.price, 0)
    durationMin = NATURAL_DURATION_MIN
  } else {
    if (!isValidLiftingStart(year, month, day, time)) {
      return NextResponse.json({ error: 'invalid_time' }, { status: 400 })
    }
    priceTotal = LIFTING_PRICE
    durationMin = LIFTING_DURATION_MIN
  }

  if (!hasLeadTime(year, month, day, time)) {
    return NextResponse.json(
      { error: 'too_soon', message: `יש לבחור שעה שמתחילה לפחות ${MIN_LEAD_MINUTES} דקות מעכשיו.` },
      { status: 400 },
    )
  }

  // בדיקה מוקדמת מול היומן — לא ההגנה הסופית (זו ה-EXCLUDE constraint
  // למטה), אלא כדי לתפוס מוקדם ובזול התנגשות עם אירוע קיים ביומן של
  // שובל. אם הבדיקה עצמה נכשלת (תקלת רשת/Google) — ממשיכים ולא חוסמים
  // את הלקוחה; ה-DB עדיין מגן מפני התנגשות בין תורים שהמערכת יודעת עליהם.
  try {
    const busy = await getBusyRanges(isoDate)
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number)
      return h * 60 + m
    }
    const startMin = toMin(time)
    const endMin = startMin + durationMin
    const overlaps = busy.some(
      ({ start, end }) => toMin(start) < endMin && toMin(end) > startMin,
    )
    if (overlaps) {
      return NextResponse.json(
        { error: 'slot_taken', message: 'השעה שנבחרה נתפסה. יש לבחור שעה אחרת.' },
        { status: 409 },
      )
    }
  } catch (err) {
    logGoogleCalendarError('[appointments] calendar pre-check failed', err)
  }

  const customer = await getCustomerById(customerId)
  if (!customer) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (customer.is_blocked) {
    return NextResponse.json(
      { error: 'blocked', message: 'לא ניתן לקבוע תור דרך האתר. יש ליצור קשר בוואטסאפ.' },
      { status: 403 },
    )
  }

  const notes =
    typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) || null : null

  const result = await createPersonalAreaBookingRequest({
    customerId: customer.id,
    serviceKey,
    variants,
    priceTotal,
    isoDate,
    time,
    durationMin,
    notes,
    policyVersion: POLICY_VERSION,
    // 🔒 אותה פונקציה בדיוק שהמסלול הציבורי משתמש בה. אין כאן כלל שני.
    expiresAt: computePendingExpiresAt(),
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    privacyAcknowledged: true,
  })

  if (result.error === 'privacy_not_acknowledged') {
    // ⚠️ ה-route כבר בדק זאת למעלה — הגעה לכאן היא אנומליה, לא קלט לקוחה רגיל.
    console.error('[appointments] RPC rejected privacy acknowledgement despite route-level check')
    return NextResponse.json(
      { error: 'privacy_not_acknowledged', message: 'יש לאשר את מדיניות הפרטיות כדי לשלוח בקשת תור.' },
      { status: 400 },
    )
  }

  /*
   * ⚠️ הלקוחה נחסמה בין הבדיקה למעלה לבין הכתיבה. נוסח זהה לבדיקה
   * המוקדמת — מבחינת הלקוחה זו אותה תשובה, וה-RPC הוא זה שהכריע.
   */
  if (result.error === 'blocked') {
    return NextResponse.json(
      { error: 'blocked', message: 'לא ניתן לקבוע תור דרך האתר. יש ליצור קשר בוואטסאפ.' },
      { status: 403 },
    )
  }
  if (result.error === 'slot_taken') {
    return NextResponse.json(
      { error: 'slot_taken', message: 'השעה שנבחרה נתפסה הרגע. יש לבחור שעה אחרת.' },
      { status: 409 },
    )
  }
  if (result.error === 'pending_limit_reached') {
    return NextResponse.json(
      {
        error: 'pending_limit_reached',
        message: 'יש לך כבר בקשות שממתינות לאישור. ניתן להגיש בקשה נוספת לאחר שאחת מהן תטופל.',
      },
      { status: 409 },
    )
  }
  if (result.error || !result.appointment) {
    console.error('[appointments] create failed', result.error)
    return NextResponse.json(
      { error: 'server_error', message: 'לא הצלחנו לשמור את הבקשה. נסי שוב או צרי קשר בוואטסאפ.' },
      { status: 500 },
    )
  }

  /*
   * 📣 הסכמת דיוור — אותה התנהגות בדיוק כמו במסלול הציבורי: נכתבת אחרי
   * שהבקשה נשמרה, ורק אם הלקוחה סימנה בעצמה את התיבה האופציונלית. לא
   * סומנה ⟹ שום עמודת consent אינה נוגעת, וההסכמה הקיימת נשארת כפי שהיא.
   *
   * ⚠️ כאן מזהה הלקוחה כבר בידינו (מסלול מאומת), ולכן אין חיפוש לפי טלפון.
   */
  if (body.marketingConsent === true) {
    try {
      await recordBookingMarketingConsent(customer.id)
    } catch {
      /*
       * ⚠️ בלי אובייקט השגיאה עצמו — הודעת שגיאה של הספק עלולה לשאת
       * מספר טלפון, ולוג אינו מקום לנתוני לקוחות. פרטי הכשל של ה-DB
       * כבר נרשמים בשכבת lib/db/marketing.ts (error.message בלבד).
       */
      console.error('[appointments] marketing consent write threw')
    }
  }

  /*
   * 🔒 15F — אותו אירוע בדיוק כמו במסלול הציבורי, ולכן אותו טריגר ואותה
   * התראה. שני המסלולים כותבים שורת היסטוריה זהה (created/pending/customer),
   * ולכן אין כאן חיווט שני — רק נקודת ניקוז שנייה.
   */
  waitUntil(dispatchNow(result.appointment.id))

  return NextResponse.json({ ok: true, appointment: result.appointment }, { status: 201 })
}
