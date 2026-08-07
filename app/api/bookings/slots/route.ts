import { NextRequest, NextResponse } from 'next/server'
import { getBusyRanges } from '@/lib/googleCalendar'
import { getDbBusyRangesForDate } from '@/lib/db/appointments'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'
import { resolveAvailability, type BusyRange } from '@/lib/bookingAvailability'

// Freshness is controlled by the cache header + in-memory TTL below, not by
// force-dynamic — this lets Vercel's edge and a per-instance cache absorb
// traffic spikes instead of hitting Google Calendar on every request.
export const revalidate = 0

type Busy = BusyRange[]

const CACHE_TTL_MS = 30_000
// CDN caching: serve a cached response for 30s, then keep serving the stale one
// for up to 60s more while it revalidates in the background.
const CDN_CACHE = 'public, s-maxage=30, stale-while-revalidate=60'

// Per-instance in-memory cache — collapses concurrent bursts on a warm instance
// down to a single Google Calendar call per date per TTL.
const cache = new Map<string, { busy: Busy; expires: number }>()

/**
 * הזמינות המוצגת בעמוד קביעת התור.
 *
 * ⚠️ ההחלטה אילו מקורות נדרשים, ומה קורה כשאחד מהם נופל, נמצאת ב-
 * `lib/bookingAvailability.ts` ונבדקת שם (`npm run test:booking-availability`).
 * כאן נשאר רק מטמון וכותרות.
 *
 * 🔒 **רשימת "תפוס" ריקה אינה "היום פנוי".** ראה את הפירוט המלא בקובץ ההוא.
 */
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 })
  }

  const now = Date.now()
  const cached = cache.get(date)
  if (cached && cached.expires > now) {
    return NextResponse.json({ busy: cached.busy }, { headers: { 'Cache-Control': CDN_CACHE } })
  }

  const result = await resolveAvailability(date, {
    calendarBusy: getBusyRanges,
    // 🔒 מועבר כהפניה ואינו נקרא כשהדגל כבוי — ראה resolveAvailability.
    dbBusy: getDbBusyRangesForDate,
    newBookingSystemEnabled: isNewBookingSystemEnabled,
  })

  if (result.ok) {
    cache.set(date, { busy: result.busy, expires: now + CACHE_TTL_MS })

    // Keep the map bounded — drop expired entries once it grows.
    if (cache.size > 200) {
      cache.forEach((v, k) => { if (v.expires <= now) cache.delete(k) })
    }

    return NextResponse.json({ busy: result.busy }, { headers: { 'Cache-Control': CDN_CACHE } })
  }

  if (result.reason === 'legacy_calendar_unavailable') {
    // ⚠️ ההתנהגות הישנה של האתר, ללא שינוי: מטמון ישן עדיף על "היום פתוח
    // לרווחה", ובהיעדרו רשימה ריקה. המסלול הזה פעיל רק כשהמערכת החדשה
    // כבויה — כלומר בדיוק במצב שבו אסור לשנות את חוויית הלקוחות.
    if (cached) {
      return NextResponse.json({ busy: cached.busy }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ busy: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  /*
   * 🔒 המערכת החדשה דלוקה ומקור אמת נדרש אינו זמין → 503 **בלי שדה `busy`**.
   *
   * ⚠️ היעדר השדה הוא חלק מההגנה, לא קיצור דרך: שני הלקוחות כותבים
   * `data.busy ?? []`, ולכן כל תשובה שיש בה `busy: []` — גם עם status 503 —
   * הייתה מתורגמת בדפדפן ל"כל השעות פנויות". התשובה כאן נופלת על בדיקת
   * `res.ok` בצד הלקוח לפני שמגיעים ל-json.
   *
   * ⚠️ אין נפילה למטמון ישן ואין שמירה במטמון. תשובת כישלון שנשמרת הופכת
   * תקלה רגעית לדקה שלמה של זמינות שגויה.
   */
  return NextResponse.json(
    { error: 'availability_unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
