import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import {
  resolveManualService, manualSlotInstants, manualSlotWarnings, checkManualSlotAvailability,
} from '@/lib/adminBooking'
import { ADMIN_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

/**
 * בדיקת זמינות מקדימה לטופס התור הידני: משך ומחיר מחושבים, אזהרות חריגה,
 * וזמינות מול Supabase ו-Google.
 *
 * ⚠️ זו בדיקה מקדימה בלבד, לתצוגה. היא **אינה** ההגנה: הבדיקה נעשית שוב
 * בשרת רגע לפני ה-INSERT, ה-EXCLUDE constraint מגן מפני race, והתנגשות
 * יומן נבדקת שוב בתוך ensureCalendarSynced. סלוט שהיה פנוי כאן יכול
 * להיתפס לפני השליחה — ואז היצירה תידחה.
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
    durationMin?: unknown; priceTotal?: unknown
  }
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

  // ⚠️ durationMin/priceTotal נלקחים בחשבון **רק** בטיפולים הניהוליים.
  // resolveManualService מתעלמת מהם לחלוטין בשני טיפולי הקטלוג.
  const service = resolveManualService(body.serviceKey, body.variants, {
    durationMin: body.durationMin,
    priceTotal: body.priceTotal,
  })
  if (!service.ok) {
    return NextResponse.json(
      { error: service.error, message: ADMIN_ERROR_MESSAGES[service.error] ?? ADMIN_ERROR_MESSAGES.unknown },
      { status: 400 })
  }

  const { startsAt, endsAt } = manualSlotInstants(isoDate, time, service.data.durationMin)
  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json(
      { error: 'invalid_slot', message: ADMIN_ERROR_MESSAGES.invalid_slot }, { status: 400 })
  }

  const warnings = manualSlotWarnings(startsAt, endsAt)
  const availability = await checkManualSlotAvailability(
    startsAt, endsAt, '00000000-0000-0000-0000-000000000000',
  )

  return NextResponse.json({
    durationMin: service.data.durationMin,
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
    warnings,
  })
}
