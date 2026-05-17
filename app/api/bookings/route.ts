import { NextRequest, NextResponse } from 'next/server'
import { createBookingEvent } from '@/lib/googleCalendar'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, phone, service, date, time, notes } = body

    if (!name || !phone || !service || !date || !time) {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 })
    }

    await createBookingEvent({ name, phone, service, date, time, notes })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[bookings]', err)
    return NextResponse.json({ error: 'failed to create event' }, { status: 500 })
  }
}
