'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserX } from 'lucide-react'

interface Props {
  appointmentId: string
  customerName: string
  whenLabel: string
}

/**
 * שלב 16 (0029) — סימון אי-הגעה ע"י שובל.
 *
 * ⚠️ **אין כאן שום SMS/WhatsApp** — בשונה מ-CancelAppointmentButton, ואין
 * לכן צורך באישור מפורט על הודעה שתישלח. הפעולה נוגעת רק בסטטוס התור
 * ובהיסטוריה, ולכן האישור קצר יותר.
 */
export default function MarkNoShowButton({ appointmentId, customerName, whenLabel }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleMarkNoShow = async () => {
    if (loading) return

    const confirmed = window.confirm(
      `לסמן שהתור של ${customerName} ב-${whenLabel} היה אי-הגעה?`,
    )
    if (!confirmed) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/appointments/${appointmentId}/no-show`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'הפעולה נכשלה. נסי שוב.')
        setLoading(false)
        return
      }

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
        onClick={handleMarkNoShow}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 border border-red-200
                   hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed px-3.5 py-1.5 rounded-full
                   cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-brand-gold"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <UserX className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        סימון אי-הגעה
      </button>
      {error && <p role="alert" className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}
