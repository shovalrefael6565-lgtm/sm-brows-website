import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { archiveCustomer, unarchiveCustomer } from '@/lib/db/crm'
import { CRM_ERROR_MESSAGES } from '@/lib/admin/format'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function guardParams(req: NextRequest, id: string) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'הלקוחה לא נמצאה.' }, { status: 404 })
  }
  return null
}

function failure(error: string) {
  return NextResponse.json(
    { error, message: CRM_ERROR_MESSAGES[error] ?? CRM_ERROR_MESSAGES.unknown },
    { status: error === 'customer_not_found' ? 404 : 400 },
  )
}

/**
 * שלב 15H — העברת כרטיס לקוחה לארכיון.
 *
 * ⚠️ ארכיון **אינו מוחק דבר**: התורים, ההיסטוריה, ההערות והמדדים נשארים
 * במקומם, והלקוחה עדיין יכולה להתחבר ולקבוע תור. הכרטיס פשוט יוצא
 * מהרשימה היומיומית.
 *
 * ⚠️ חסום כשיש תור פעיל בעתיד: ארכוב לא היה מבטל אותו, והתוצאה הייתה תור
 * חי ביומן ששייך לכרטיס שנעלם מהמסך — כולל תזכורות שממשיכות לצאת.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  const bad = guardParams(req, params.id)
  if (bad) return bad

  const res = await archiveCustomer(params.id, guard.userId)
  if (!res.ok) return failure(res.error)

  if (res.data.outcome === 'blocked_active_appointments') {
    const n = res.data.active_count ?? 0
    return NextResponse.json(
      {
        error: 'active_appointments',
        activeCount: n,
        message: `ללקוחה ${n === 1 ? 'תור פעיל אחד' : `${n} תורים פעילים`} בעתיד. יש להכריע אותם לפני העברה לארכיון.`,
      },
      { status: 409 },
    )
  }

  return NextResponse.json({ ok: true, outcome: res.data.outcome })
}

/** החזרה מהארכיון. idempotent: כרטיס שאינו בארכיון מחזיר 'not_archived'. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  const bad = guardParams(req, params.id)
  if (bad) return bad

  const res = await unarchiveCustomer(params.id, guard.userId)
  if (!res.ok) return failure(res.error)

  return NextResponse.json({ ok: true, outcome: res.data.outcome })
}
