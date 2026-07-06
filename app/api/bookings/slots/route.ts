import { NextRequest, NextResponse } from 'next/server'
import { getBusyRanges } from '@/lib/googleCalendar'

// Freshness is controlled by the cache header + in-memory TTL below, not by
// force-dynamic — this lets Vercel's edge and a per-instance cache absorb
// traffic spikes instead of hitting Google Calendar on every request.
export const revalidate = 0

type Busy = { start: string; end: string }[]

const CACHE_TTL_MS = 30_000
// CDN caching: serve a cached response for 30s, then keep serving the stale one
// for up to 60s more while it revalidates in the background.
const CDN_CACHE = 'public, s-maxage=30, stale-while-revalidate=60'

// Per-instance in-memory cache — collapses concurrent bursts on a warm instance
// down to a single Google Calendar call per date per TTL.
const cache = new Map<string, { busy: Busy; expires: number }>()

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

  try {
    const busy = await getBusyRanges(date)
    cache.set(date, { busy, expires: now + CACHE_TTL_MS })

    // Keep the map bounded — drop expired entries once it grows.
    if (cache.size > 200) {
      cache.forEach((v, k) => { if (v.expires <= now) cache.delete(k) })
    }

    return NextResponse.json({ busy }, { headers: { 'Cache-Control': CDN_CACHE } })
  } catch (err) {
    console.error('[slots]', err)
    // On a Google Calendar hiccup, prefer a slightly stale cache over pretending
    // the day is wide open (which could cause a double-booking).
    if (cached) {
      return NextResponse.json({ busy: cached.busy }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ busy: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
