import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { rescheduleByAdmin } from '@/lib/appointmentApproval'
import { manualSlotInstants } from '@/lib/adminBooking'
import { ADMIN_MIN_DURATION_MIN, ADMIN_MAX_DURATION_MIN } from '@/lib/services'
import { ADMIN_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/**
 * שלב 12 (0034) — שינוי מועד לתור מאושר ע"י שובל.
 *
 * ⚠️ התאריך והשעה מפורשים כשעון קיר **ישראלי** דרך manualSlotInstants —
 * אותה נקודת המרה יחידה של התור הידני. new Date('YYYY-MM-DDTHH:mm') היה
 * מתפרש לפי אזור הזמן של שרת Vercel (UTC) ומזיז כל תור בשעתיים-שלוש.
 *
 * ⚠️ המשך אופציונלי: כשלא נשלח, ה-RPC משאיר את המשך הקיים. זה מה שמאפשר
 * "רק להזיז שעה" בלי לגעת בטיפול.
 *
 * כל השאר — זכאות, חפיפה, תזכורות ויומן — בשרת ובמסד. ה-route אוכף
 * הרשאה ומתרגם ל-HTTP, בדיוק כמו .../cancel ו-.../no-show.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const { id } = params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'התור לא נמצא.' }, { status: 404 })
  }

  let body: { isoDate?: unknown; time?: unknown; durationMin?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  const isoDate = typeof body.isoDate === 'string' ? body.isoDate : ''
  const time = typeof body.time === 'string' ? body.time : ''
  if (!ISO_DATE_RE.test(isoDate) || !TIME_RE.test(time)) {
    return NextResponse.json(
      { error: 'invalid_slot', message: ADMIN_ERROR_MESSAGES.invalid_slot }, { status: 400 })
  }

  // ⚠️ אותם גבולות שה-RPC אוכף (5–480). ולידציה כאן היא הודעה ברורה
  // למנהלת, לא ההגנה עצמה.
  let durationMin: number | null = null
  if (body.durationMin !== undefined && body.durationMin !== null && body.durationMin !== '') {
    const parsed = Number(body.durationMin)
    if (
      !Number.isInteger(parsed) ||
      parsed < ADMIN_MIN_DURATION_MIN ||
      parsed > ADMIN_MAX_DURATION_MIN
    ) {
      return NextResponse.json(
        { error: 'invalid_duration', message: ADMIN_ERROR_MESSAGES.invalid_duration },
        { status: 400 })
    }
    durationMin = parsed
  }

  // המשך משמש כאן רק לחישוב ה-Date; ה-RPC מקבל אותו בנפרד ומחשב ends_at
  // בעצמו דרך הטריגר.
  const { startsAt } = manualSlotInstants(isoDate, time, durationMin ?? 0)
  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json(
      { error: 'invalid_slot', message: ADMIN_ERROR_MESSAGES.invalid_slot }, { status: 400 })
  }

  const result = await rescheduleByAdmin({
    appointmentId: id,
    startsAt,
    durationMin,
    adminUserId: guard.userId,   // מה-session בלבד
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message }, { status: result.status })
  }

  // ⚠️ כשל סנכרון יומן הוא 200 ולא שגיאה: התור **זז** במערכת, השעה החדשה
  // תפוסה, והתזכורות כבר מתוזמנות למועד החדש. רק האירוע ביומן לא עודכן.
  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    calendarSynced: result.calendarSynced,
    message: result.message,
  })
}
