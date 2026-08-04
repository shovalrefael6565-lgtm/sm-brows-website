import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getCustomerById } from '@/lib/db/customers'

export const dynamic = 'force-dynamic'

/**
 * מצב ההתחברות הנוכחי, לצריכת קליינט (BookingForm בודקת אם צריך OTP).
 *
 * לא מקבל שום קלט מהבקשה — כל מה שהוא מחזיר נגזר מה-session החתום, כך
 * שאין דרך לבקש מידע על לקוחה אחרת דרך ה-endpoint הזה.
 */
export async function GET() {
  const session = await getSession()
  if (!session?.customerId) return NextResponse.json({ loggedIn: false })

  const customer = await getCustomerById(session.customerId)
  if (!customer || customer.is_blocked) return NextResponse.json({ loggedIn: false })

  return NextResponse.json({
    loggedIn: true,
    phone: customer.phone_e164,
    fullName: customer.full_name,
  })
}
