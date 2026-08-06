import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { getBookingCustomer } from '@/lib/db/manualCustomers'
import {
  resolveManualService, manualSlotInstants, createManualAppointment,
} from '@/lib/adminBooking'
import { ADMIN_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/**
 * יצירת תור ידני ע"י מנהלת. התור נוצר confirmed מיד — הוא אינו pending
 * ואינו דורש אישור נוסף.
 *
 * מה מגיע מהדפדפן: מזהה לקוחה, בחירת שירות ותוספות, תאריך ושעה.
 * מה **לא** מגיע מהדפדפן: משך, מחיר, שם הטיפול, גרסת מדיניות, וזהות
 * המנהלת — כולם נטענים או נגזרים בשרת.
 *
 * חריגה משעות הפעילות, מ-7 הימים ומשישי/שבת **מותרת** — זו כל מטרתו של
 * תור ידני. מה שאינו מותר: מועד בעבר, וחפיפה עם תור קיים או עם אירוע
 * ביומן Google.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: {
    customerId?: unknown
    serviceKey?: unknown
    variants?: unknown
    isoDate?: unknown
    time?: unknown
    client_request_id?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  if (typeof body.client_request_id !== 'string' || !UUID_RE.test(body.client_request_id)) {
    return NextResponse.json(
      { error: 'missing_request_id', message: ADMIN_ERROR_MESSAGES.missing_request_id },
      { status: 400 })
  }

  if (typeof body.customerId !== 'string' || !UUID_RE.test(body.customerId)) {
    return NextResponse.json(
      { error: 'customer_not_found', message: ADMIN_ERROR_MESSAGES.customer_not_found },
      { status: 404 })
  }

  const isoDate = typeof body.isoDate === 'string' ? body.isoDate : ''
  const time = typeof body.time === 'string' ? body.time : ''
  if (!ISO_DATE_RE.test(isoDate) || !TIME_RE.test(time)) {
    return NextResponse.json(
      { error: 'invalid_slot', message: ADMIN_ERROR_MESSAGES.invalid_slot }, { status: 400 })
  }

  // ── הלקוחה נטענת מחדש בשרת ──────────────────────────────────────────────
  // getBookingCustomer מחריגה חשבונות מנהל, ולכן מזהה של שובל/רפאל מתורגם
  // לאותו 404 כמו מזהה שאינו קיים.
  const customer = await getBookingCustomer(body.customerId)
  if (!customer) {
    return NextResponse.json(
      { error: 'customer_not_found', message: ADMIN_ERROR_MESSAGES.customer_not_found },
      { status: 404 })
  }

  // ── השירות נטען מחדש בשרת ───────────────────────────────────────────────
  const service = resolveManualService(body.serviceKey, body.variants)
  if (!service.ok) {
    return NextResponse.json(
      { error: service.error, message: ADMIN_ERROR_MESSAGES[service.error] ?? ADMIN_ERROR_MESSAGES.unknown },
      { status: 400 })
  }

  // ⚠️ שעון קיר ישראלי, לא אזור הזמן של השרת או של הדפדפן
  const { startsAt, endsAt } = manualSlotInstants(isoDate, time, service.data.durationMin)
  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json(
      { error: 'invalid_slot', message: ADMIN_ERROR_MESSAGES.invalid_slot }, { status: 400 })
  }

  const res = await createManualAppointment({
    customerId: customer.id,
    serviceKey: service.data.serviceKey,
    variants: service.data.variants,
    durationMin: service.data.durationMin,
    priceTotal: service.data.priceTotal,
    startsAt,
    endsAt,
    adminUserId: guard.userId,   // מה-session בלבד
    clientRequestId: body.client_request_id,
  })

  if (!res.ok) {
    const status =
      res.error === 'not_admin' || res.error === 'customer_is_admin' ? 403 :
      res.error === 'customer_not_found' ? 404 :
      res.error === 'slot_taken' || res.error === 'calendar_conflict' ? 409 :
      res.error === 'idempotency_key_reused' ? 409 :
      res.error === 'calendar_unavailable' ? 502 :
      res.error === 'unknown' || res.error === 'integrity_error' ? 500 : 400
    return NextResponse.json(
      { error: res.error, message: ADMIN_ERROR_MESSAGES[res.error] ?? ADMIN_ERROR_MESSAGES.unknown },
      { status })
  }

  // ⚠️ partial success הוא 200 ולא שגיאה: התור **נוצר** ותקף. רק הסנכרון
  // ליומן נכשל, וניתן לנסות אותו שוב בלי ליצור תור נוסף.
  return NextResponse.json({
    ok: true,
    appointmentId: res.data.appointmentId,
    calendarSynced: res.data.calendarSynced,
    message: res.data.calendarSynced
      ? 'התור נוצר וסונכרן ליומן.'
      : `התור נוצר, אך הסנכרון ליומן נכשל. ${res.data.calendarMessage ?? ''}`.trim(),
  })
}
