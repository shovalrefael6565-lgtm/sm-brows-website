import { NextResponse } from 'next/server'
import { getCurrentCustomerId } from '@/lib/auth/currentCustomer'
import { getCustomerById } from '@/lib/db/customers'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'

export const dynamic = 'force-dynamic'

/**
 * מצב ההתחברות הנוכחי, לצריכת קליינט (BookingForm בודקת אם צריך OTP).
 *
 * לא מקבל שום קלט מהבקשה — כל מה שהוא מחזיר נגזר מה-session החתום, כך
 * שאין דרך לבקש מידע על לקוחה אחרת דרך ה-endpoint הזה.
 */
export async function GET() {
  /*
   * 🔒 שלב 13 — הדגל חוסם לפני כל קריאה ל-Supabase.
   *
   * ⚠️ ה-endpoint הזה אינו ברשימת הארבעה שנדרשו במפורש, והוספתי אותו
   * מסיבה קונקרטית: `BookingForm` קורא לו **בכל טעינה של `/booking`**,
   * בלי קשר לדגל. בלי השער הזה, העמוד הפומבי ביותר במערכת החדשה היה ממשיך
   * לפנות ל-Supabase בכל ביקור — כלומר "אפס קריאות Supabase כשהדגל כבוי"
   * היה נכון ל-`slots` בלבד, ותקלה ב-Supabase עדיין הייתה נוגעת ב-`/booking`.
   *
   * הלקוח עצמו כבר אינו קורא לכאן כשהדגל כבוי (ראה `BookingForm`), אבל
   * זו אופטימיזציה — השער כאן הוא הגבול.
   */
  if (!isNewBookingSystemEnabled()) {
    return NextResponse.json({ error: 'feature_disabled' }, { status: 403 })
  }

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
