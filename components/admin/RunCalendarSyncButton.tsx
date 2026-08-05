'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'

/**
 * "סנכרון Google Calendar עכשיו".
 *
 * מניעת לחיצה כפולה כאן היא נוחות בלבד — ההגנה האמיתית מפני שתי ריצות
 * מקבילות היא ה-lease ב-DB (claim_calendar_sync_run ב-0008). שתי לשוניות
 * פתוחות יקבלו 409 ולא ריצה כפולה.
 */
export default function RunCalendarSyncButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  const handleRun = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    setSummary(null)

    try {
      const res = await fetch('/api/admin/calendar-sync', { method: 'POST' })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'הסנכרון נכשל. נסי שוב.')
        setLoading(false)
        router.refresh()
        return
      }

      const s = data.stats ?? {}
      setSummary(
        `נקראו ${s.eventsRead ?? 0} אירועים · טופלו ${s.processed ?? 0} · ` +
        `הוזזו ${s.rescheduled ?? 0} · בוטלו ${s.cancelled ?? 0} · ` +
        `נכשלו ${s.failed ?? 0}`,
      )
      setLoading(false)
      router.refresh()
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleRun}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-dark border border-brand-linen-dark hover:border-brand-rose disabled:opacity-60 disabled:cursor-not-allowed px-3.5 py-1.5 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        {loading ? 'מסנכרן…' : 'סנכרון Google Calendar עכשיו'}
      </button>
      {error && <p role="alert" className="text-red-500 text-xs mt-1.5">{error}</p>}
      {summary && <p className="text-brand-muted text-xs mt-1.5">{summary}</p>}
    </div>
  )
}
