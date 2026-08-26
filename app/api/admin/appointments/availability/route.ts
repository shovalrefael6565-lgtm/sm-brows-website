import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import {
  resolveManualService, manualSlotInstants, manualSlotWarnings, checkManualSlotAvailability,
  resolveAdoptedGoogleSlot, supportsGoogleSourcedSlot, type AdoptedGoogleSlot,
} from '@/lib/adminBooking'
import { ADMIN_ERROR_MESSAGES, formatBlockingAppointment } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
/** מזהה אירוע Google חוקי — [a-v0-9] באורך 5–1024, בדיוק כמו שגוגל מגדירה */
const CALENDAR_EVENT_ID_RE = /^[a-v0-9]{5,1024}$/

/**
 * הסבר קריא לכשל אימוץ. משך חורג מקבל את המספר עצמו — "האירוע נמשך 675
 * דקות" עוזר לזהות שנבחר אירוע יום-שלם, בעוד הודעה גנרית לא אומרת דבר.
 */
function adoptErrorMessage(error: string, durationMin?: number): string {
  if (error === 'adopt_event_duration' && typeof durationMin === 'number') {
    return `${ADMIN_ERROR_MESSAGES.adopt_event_duration} (האירוע שנבחר נמשך ${durationMin} דקות).`
  }
  return ADMIN_ERROR_MESSAGES[error] ?? ADMIN_ERROR_MESSAGES.unknown
}

/**
 * בדיקת זמינות מקדימה לטופס התור הידני: משך ומחיר מחושבים, אזהרות חריגה,
 * וזמינות מול Supabase ו-Google.
 *
 * ⚠️ זו בדיקה מקדימה בלבד, לתצוגה. היא **אינה** ההגנה: הבדיקה נעשית שוב
 * בשרת רגע לפני ה-INSERT, ה-EXCLUDE constraint מגן מפני race, והתנגשות
 * יומן נבדקת שוב בתוך ensureCalendarSynced. סלוט שהיה פנוי כאן יכול
 * להיתפס לפני השליחה — ואז היצירה תידחה.
 *
 * ─── 15I: מצב "המועד מ-Google" ─────────────────────────────────────────────
 *
 * כשנשלח adoptCalendarEventId והטיפול ניהולי, השעה והמשך שבגוף הבקשה
 * **אינם נקראים כלל**: המועד נגזר מהאירוע ביומן, והתשובה מחזירה אותו כדי
 * שהטופס יציג את מה שיישמר בפועל — ולא את מה שהוקלד.
 *
 * POST ולא GET: הגוף מכיל בחירת שירות ותוספות, והבדיקה פונה ל-Google
 * (כלומר יש לה עלות חיצונית ואין לאפשר אותה בקישור/prefetch).
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: {
    serviceKey?: unknown; variants?: unknown; isoDate?: unknown; time?: unknown
    durationMin?: unknown; priceTotal?: unknown; adoptCalendarEventId?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  const adoptEventId =
    typeof body.adoptCalendarEventId === 'string' && CALENDAR_EVENT_ID_RE.test(body.adoptCalendarEventId)
      ? body.adoptCalendarEventId
      : null

  // 🔓 15J — האימוץ-לפי-Google פתוח לכל טיפול שנקבע ידנית. הבדיקה על
  // ה-service_key היא בדיקת שפיות, לא שער קטלוג.
  const googleSourced = Boolean(adoptEventId) && supportsGoogleSourcedSlot(body.serviceKey)

  let adopted: AdoptedGoogleSlot | null = null
  if (googleSourced) {
    const res = await resolveAdoptedGoogleSlot(body.serviceKey, adoptEventId!)
    if (!res.ok) {
      /*
       * ⚠️ 200 ולא 409/502. הטופס מציג את גוף התשובה, ותשובת שגיאה
       * שהוא זורק הותירה אותו ריק לגמרי: המנהלת לחצה על האירוע ושום דבר
       * לא קרה על המסך. עכשיו הסיבה מגיעה אליה כטקסט.
       */
      return NextResponse.json({
        durationMin: 0,
        priceTotal: null,
        available: false,
        reason: res.error,
        adoptable: null,
        googleSlot: null,
        calendarOverlap: null,
        blocking: [],
        adoptError: res.error,
        adoptMessage: adoptErrorMessage(res.error, res.durationMin),
        warnings: { outsideBusinessHours: false, closedDay: false },
      })
    }
    adopted = res.data
  }

  const isoDate = typeof body.isoDate === 'string' ? body.isoDate : ''
  const time = typeof body.time === 'string' ? body.time : ''
  // ⚠️ במצב Google אין צורך בשעה בטופס כלל — היא מגיעה מהאירוע.
  if (!ISO_DATE_RE.test(isoDate) || (!adopted && !TIME_RE.test(time))) {
    return NextResponse.json(
      { error: 'invalid_slot', message: ADMIN_ERROR_MESSAGES.invalid_slot }, { status: 400 })
  }

  // ⚠️ durationMin/priceTotal נלקחים בחשבון **רק** בטיפולים הניהוליים.
  // resolveManualService מתעלמת מהם לחלוטין בשני טיפולי הקטלוג.
  const service = resolveManualService(body.serviceKey, body.variants, {
    // במצב Google המשך הוא end − start ולא מה שהוקלד.
    durationMin: adopted ? adopted.durationMin : body.durationMin,
    priceTotal: body.priceTotal,
  })
  if (!service.ok) {
    return NextResponse.json(
      { error: service.error, message: ADMIN_ERROR_MESSAGES[service.error] ?? ADMIN_ERROR_MESSAGES.unknown },
      { status: 400 })
  }

  const { startsAt, endsAt } = adopted
    ? { startsAt: adopted.startsAt, endsAt: adopted.endsAt }
    : manualSlotInstants(isoDate, time, service.data.durationMin)
  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json(
      { error: 'invalid_slot', message: ADMIN_ERROR_MESSAGES.invalid_slot }, { status: 400 })
  }

  const warnings = manualSlotWarnings(startsAt, endsAt)
  const availability = await checkManualSlotAvailability(
    startsAt, endsAt, '00000000-0000-0000-0000-000000000000',
    // האירוע שממנו נגזר המועד אינו התנגשות — הוא התור עצמו.
    adopted ? adopted.eventId : null,
    // 🔓 15J — אימוץ מפורש: חפיפה ביומן היא אזהרה ולא חסימה.
    Boolean(adopted),
  )

  /*
   * 🔓 15J — המשך המוצג הוא **תמיד** של האירוע כשיש אירוע, גם בטיפולי
   * הקטלוג שבהם resolveManualService גוזרת משך קבוע (20 / 40 דקות).
   * בלי זה המסך היה מבטיח 20 דקות בעוד השמירה כותבת 60.
   */
  const durationMin = adopted ? adopted.durationMin : service.data.durationMin

  return NextResponse.json({
    durationMin,
    priceTotal: service.data.priceTotal,
    // ⚠️ אין כאן google_event_id, אין calendar_sync_error ואין payload
    // גולמי מ-Google — רק סיבה מקוטלגת שהממשק יודע לתרגם.
    available: availability.available,
    reason: availability.available ? null : availability.reason,
    /*
     * ⚠️ פרטי האירוע החוסם נחשפים **רק** למנהלת מאומתת ורק כשהוא ניתן
     * לאימוץ. זה המידע המינימלי שדרוש כדי שהיא תזהה אם זה אותו תור:
     * כותרת האירוע והטווח שלו — לא המשתתפים, לא התיאור ולא כל payload
     * אחר מ-Google.
     */
    adoptable: availability.available ? null : (availability.adoptable ?? null),
    /*
     * 🔎 15L — התורים שחוסמים בפועל, מוכנים לתצוגה.
     *
     * ⚠️ המועד מומר כאן לשעון ישראל ולא בדפדפן: זה אותו מקור אמת שכל
     * שאר המסכים באדמין משתמשים בו, וכך אין מסך שמראה שעה אחרת.
     */
    blocking: availability.available
      ? []
      : (availability.blocking ?? []).map(formatBlockingAppointment),
    /*
     * 15I — המועד שיישמר בפועל, כפי שנקרא מהיומן. הטופס מציג אותו
     * לקריאה בלבד.
     *
     * ⚠️ warnings מוחזרות גם כאן, אבל כמידע ולא כתנאי: מועד מחוץ לשעות
     * הפעילות אינו חוסם אימוץ של אירוע קיים — ראה ההערה ב-NewAppointmentForm.
     */
    googleSlot: adopted
      ? {
          eventId: adopted.eventId,
          summary: adopted.summary,
          isoDate: adopted.isoDate,
          startTime: adopted.startTime,
          endTime: adopted.endTime,
          durationMin: adopted.durationMin,
        }
      : null,
    /*
     * 🔓 15J — אירוע יומן אחר שחופף לתור המאומץ. אזהרה בלבד: הוא אינו
     * מונע יצירה ואינו הופך את האירוע שנבחר ללא-בחיר.
     */
    calendarOverlap: availability.available ? (availability.calendarOverlap ?? null) : null,
    adoptError: null,
    adoptMessage: null,
    warnings,
  })
}
