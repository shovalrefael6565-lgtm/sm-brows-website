import { NextResponse } from 'next/server'
import { isShabbat, shabbatWindow } from '@/lib/shabbat'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// מצב השבת לצד-הלקוח. נקרא ע"י טופס ההזמנה כדי להציג את כרטיס המידע
// ולנעול את ההזמנות. fail-open: אם מחזיר שגיאה — הלקוח מתייחס כלא-שבת.
export function GET() {
  const shabbat = isShabbat()
  const w = shabbatWindow()
  return NextResponse.json(
    { shabbat, until: shabbat && w ? w.end.toISOString() : null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
