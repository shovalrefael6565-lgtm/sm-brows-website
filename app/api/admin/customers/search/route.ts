import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { searchBookingCustomers } from '@/lib/db/manualCustomers'

export const dynamic = 'force-dynamic'

/**
 * חיפוש לקוחה לצורך שיוך תור ידני (בורר הלקוחה ב-/admin/appointments/new).
 *
 * ⚠️ מחזיר ארבעה שדות בלבד: מזהה, שם, טלפון והאם קיים חשבון התחברות.
 * לא מדדי CRM, לא הערות, לא auth_user_id ולא סטטוס. בורר לקוחה אינו
 * צריך את הפרופיל המלא, וכל שדה מיותר הוא חשיפה מיותרת.
 *
 * שובל ורפאל מוחרגות ב-DB (list_crm_customers), ולכן אי אפשר לבחור חשבון
 * ניהולי כלקוחה דרך המסך הזה.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
  const items = await searchBookingCustomers(q)

  return NextResponse.json({ items })
}
