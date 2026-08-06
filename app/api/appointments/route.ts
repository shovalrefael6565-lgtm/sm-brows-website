import { NextRequest, NextResponse } from 'next/server'
import { getCurrentCustomerId } from '@/lib/auth/currentCustomer'
import { getCustomerById } from '@/lib/db/customers'
import { createPendingAppointment } from '@/lib/db/appointments'
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
 * שמירת בקשת תור כ-pending.
 *
 * מקור האמת לזהות הלקוחה הוא אך ורק ה-session (cookie חתום) — אף שדה
 * טלפון מגוף הבקשה לא נקרא כאן. זו האכיפה בפועל של "אין לאפשר שמירת
 * בקשה תחת מספר אחר ללא אימות חדש": מבנית, אין דרך לספק customer_id
 * שלא עברה דרך OTP מוצלח (ראה app/api/auth/otp/verify).
 *
 * שכבות הבדיקה, בסדר:
 *   1. session תקף (401 אם לא) — מונע יצירת בקשה בלי אימות טלפון.
 *   2. תבנית הקלט (400).
 *   3. חלון הזמינות (יום פתוח, שעה ברשת, 90 דק' הכנה) — 400/'date_unavailable'.
 *   4. Google Calendar — בדיקה מוקדמת וזולה, לא חזות הכל (ראה למטה).
 *   5. ה-EXCLUDE constraint ב-DB — ההגנה האמיתית מפני התנגשות, כולל race.
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

  let body: {
    serviceKey?: string
    variants?: unknown
    isoDate?: string
    time?: string
    notes?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
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
      { error: 'too_soon', message: 'יש לבחור שעה שמתחילה לפחות 90 דקות מעכשיו.' },
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
    console.error('[appointments] calendar pre-check failed', err)
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

  const result = await createPendingAppointment({
    customerId: customer.id,
    serviceKey,
    variants,
    priceTotal,
    isoDate,
    time,
    durationMin,
    notes,
    policyVersion: POLICY_VERSION,
  })

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

  return NextResponse.json({ ok: true, appointment: result.appointment }, { status: 201 })
}
