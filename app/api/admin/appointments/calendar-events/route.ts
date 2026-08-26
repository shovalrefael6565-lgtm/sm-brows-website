import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { listAdoptableEventsForDate } from '@/lib/adminBooking'
import { ADMIN_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 15I — אירועי היומן של יום מסוים שניתן לקשר אליהם תור ידני.
 *
 * ─── מה מוחזר, ומה לא ──────────────────────────────────────────────────────
 *
 * מוחזרים רק אירועים ש**ניתן לאמץ**: אירועים ששובל יצרה ביומן בעצמה,
 * שאינם נושאים חתימת מערכת ושאינם מקושרים כבר לתור אחר. אירוע מקושר אינו
 * מוחזר כלל — לא כאפשרות אפורה ולא בשום צורה אחרת.
 *
 * ⚠️ לכל אירוע: מזהה, כותרת וטווח שעות בלבד. לא משתתפים, לא תיאור, לא
 * מיקום, ולא שום payload גולמי מ-Google.
 *
 * 🔓 15J — פתוח לכל טיפול שנקבע ידנית. הרשימה אינה תלויה בטיפול כלל:
 * "האם האירוע הזה פנוי לקישור" היא שאלה על היומן ועל appointments, ולא
 * על הקטלוג. עד 15J נדחתה כאן כל בקשה שלא הגיעה ממיקרובליידינג/ייעוץ,
 * וזו הייתה החסימה שהפכה אירוע גלוי ללא-ניתן-לבחירה.
 *
 * POST ולא GET: יש לזה עלות חיצונית מול Google, ואין לאפשר אותו
 * דרך קישור או prefetch.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: { isoDate?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  const isoDate = typeof body.isoDate === 'string' ? body.isoDate : ''
  if (!ISO_DATE_RE.test(isoDate)) {
    return NextResponse.json(
      { error: 'invalid_slot', message: ADMIN_ERROR_MESSAGES.invalid_slot }, { status: 400 })
  }

  const res = await listAdoptableEventsForDate(isoDate)
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, message: ADMIN_ERROR_MESSAGES[res.error] ?? ADMIN_ERROR_MESSAGES.unknown },
      { status: 502 })
  }

  return NextResponse.json({ events: res.events })
}
