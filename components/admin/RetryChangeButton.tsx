'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RotateCw } from 'lucide-react'

/**
 * ניסיון חוזר לשינוי בודד שנכשל בסנכרון הנכנס. הפעולה idempotent לחלוטין:
 * גרסת האירוע כבר שמורה בתור, ומפתח הייחודיות מבטיח שהיא לא תעובד פעמיים
 * גם אם הריצה תתבצע במקביל.
 */
export default function RetryChangeButton({ queueId }: { queueId: number }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const handleRetry = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    setNote(null)

    try {
      const res = await fetch(`/api/admin/calendar-sync/changes/${queueId}/retry`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'הניסיון החוזר נכשל.')
        setLoading(false)
        router.refresh()
        return
      }

      if (data.queued) setNote('השינוי הוחזר לתור ויטופל בסנכרון הבא.')
      setLoading(false)
      router.refresh()
    } catch {
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
          <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        נסה שוב
      </button>
      {error && <p role="alert" className="text-red-500 text-xs mt-1">{error}</p>}
      {note && <p className="text-brand-muted text-xs mt-1">{note}</p>}
    </div>
  )
}
