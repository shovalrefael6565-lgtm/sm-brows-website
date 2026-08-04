import { NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/** POST ולא GET — כדי שקישור או תמונה באתר אחר לא יוכלו לנתק את הלקוחה */
export async function POST() {
  await destroySession()
  return NextResponse.json({ ok: true })
}
