import { NextResponse } from 'next/server'

// נתיב legacy שאינו בשימוש — אין אליו הפניה בקוד (הטופס הציבורי משתמש ב-/api/bookings/request).
// נשאר כ-410 כדי לא לשבור קריאות ישנות שעדיין עשויות להגיע אליו.
function gone() {
  return NextResponse.json(
    { error: 'gone' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST() {
  return gone()
}

export async function GET() {
  return gone()
}
