import { NextRequest, NextResponse } from 'next/server'
import { getBusyRanges } from '@/lib/googleCalendar'

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 })
  }

  try {
    const busy = await getBusyRanges(date)
    return NextResponse.json({ busy })
  } catch (err) {
    console.error('[slots]', err)
    return NextResponse.json({ busy: [] })
  }
}
