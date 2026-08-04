'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/**
 * ביטול בקשת pending מתוך האזור האישי. מוצג רק על כרטיס בסטטוס pending
 * (ראה app/account/page.tsx). הביטול עצמו מאומת מול הבעלות ב-DB
 * (cancel_pending_appointment) — הכפתור הזה רק שולח את הבקשה.
 */
export default function CancelPendingButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCancel = async () => {
    if (!window.confirm('לבטל את הבקשה הממתינה לאישור? הפעולה אינה הפיכה.')) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? 'הביטול נכשל. נסי שוב.')
        setLoading(false)
        return
      }
      router.refresh()
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setLoading(false)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-brand-cream-dark/60">
      <button
        type="button"
        onClick={handleCancel}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:underline disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        ביטול הבקשה
      </button>
      {error && <p role="alert" className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}
