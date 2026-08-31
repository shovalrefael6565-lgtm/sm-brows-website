import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { sendCampaignBatch } from '@/lib/db/marketing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * עיבוד אצווה אחת של קמפיין.
 *
 * ⚠️ הקריאה חוזרת על עצמה עד ש-remaining=0, ובכוונה: אצווה אחת בכל בקשה,
 * שליחה סדרתית בתוכה, ובלי מאות בקשות מקבילות ל-019. קריאה חוזרת בטוחה —
 * כל שורה נתפסת פעם אחת בלבד, ונמענת שכבר `sent` לעולם אינה נשלחת שוב.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response
  if (!isSameOrigin(req)) return NextResponse.json({ error: 'bad_origin' }, { status: 403 })

  const { id } = await props.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'קמפיין לא נמצא.' }, { status: 404 })
  }

  const res = await sendCampaignBatch(id)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: 'שליחת האצווה נכשלה.' }, { status: 404 })
  }
  return NextResponse.json(res.data)
}
