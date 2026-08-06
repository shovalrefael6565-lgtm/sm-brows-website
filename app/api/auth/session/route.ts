import { NextResponse } from 'next/server'
import { getCurrentCustomerId } from '@/lib/auth/currentCustomer'
import { getCustomerById } from '@/lib/db/customers'

export const dynamic = 'force-dynamic'

/**
 * מצב ההתחברות הנוכחי, לצריכת קליינט (BookingForm בודקת אם צריך OTP).
 *
 * לא מקבל שום קלט מהבקשה — כל מה שהוא מחזיר נגזר מה-session החתום, כך
 * שאין דרך לבקש מידע על לקוחה אחרת דרך ה-endpoint הזה.
 */
export async function GET() {
  // מנהלת מקבלת loggedIn:false בכוונה — ל-session שלה אין בעלות על
  // לקוחה, גם אם קיימת לה שורת customers כדי להתחבר.
  const customerId = await getCurrentCustomerId()
  if (!customerId) return NextResponse.json({ loggedIn: false })

  const customer = await getCustomerById(customerId)
  if (!customer || customer.is_blocked) return NextResponse.json({ loggedIn: false })

  return NextResponse.json({
    loggedIn: true,
    phone: customer.phone_e164,
    fullName: customer.full_name,
  })
}
