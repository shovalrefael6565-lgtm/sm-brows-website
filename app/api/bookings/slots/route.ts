import { NextRequest, NextResponse } from 'next/server'
import { getTakenSlots } from '@/lib/googleCalendar'

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 })
  }

  try {
    const taken = await getTakenSlots(date)
    return NextResponse.json({ taken })
  } catch (err) {
    console.error('[slots]', err)
    return NextResponse.json({ taken: [] })
  }
}
