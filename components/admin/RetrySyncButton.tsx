'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { useWhatsAppWindow } from './useWhatsAppWindow'

/**
 * "נסה לסנכרן שוב" — לתור confirmed שסנכרון היומן שלו נכשל או תקוע
 * (calendar_sync_status pending/failed/syncing). נקרא אחרי ש-Google
 * Calendar נכשל בזמן האישור המקורי; הפעולה עצמה idempotent לגמרי
 * (lib/appointmentApproval.ts:ensureCalendarSynced) — אין סיכון לאירוע כפול.
 */
export default function RetrySyncButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const whatsapp = useWhatsAppWindow()

  const handleRetry = async () => {
    if (loading) return
    whatsapp.openBlank()
    setLoading(true)
    setError(null)
    setFallbackUrl(null)

    try {
      const res = await fetch(`/api/admin/appointments/${appointmentId}/sync-calendar`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        whatsapp.close()
        setError(data.message ?? 'הסנכרון נכשל. נסי שוב.')
        setLoading(false)
        router.refresh()
        return
      }

      // סנכרון של *מחיקת* אירוע (אחרי ביטול עצמי של הלקוחה) מסתיים בהצלחה
      // בלי הודעת וואטסאפ — אין למי ומה להודיע, הלקוחה היא שביטלה.
      if (data.whatsappUrl) {
        if (!whatsapp.navigate(data.whatsappUrl)) setFallbackUrl(data.whatsappUrl)
      } else {
        whatsapp.close()
      }
      setLoading(false)
      router.refresh()
    } catch {
      whatsapp.close()
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setLoading(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleRetry}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-dark border border-brand-linen-dark hover:border-brand-rose disabled:opacity-60 disabled:cursor-not-allowed px-3.5 py-1.5 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        נסה לסנכרן שוב
      </button>
      {error && <p role="alert" className="text-red-500 text-xs mt-1">{error}</p>}
      {fallbackUrl && (
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-1 text-xs font-semibold text-[#25D366] hover:underline"
        >
          פתיחת הודעת האישור ב-WhatsApp
        </a>
      )}
    </div>
  )
}
