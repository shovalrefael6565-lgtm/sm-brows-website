'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2 } from 'lucide-react'

interface Props {
  appointmentId: string
  customerName: string
  whenLabel: string
}

/**
 * שלב 12 (0034) — סימון תור כהושלם.
 *
 * ⚠️ **אין כאן שום SMS/WhatsApp** — בדיוק כמו MarkNoShowButton ובשונה
 * מ-CancelAppointmentButton. הפעולה נוגעת רק בסטטוס התור ובהיסטוריה.
 *
 * ⚠️ הכפתור מוצג רק לתור מאושר שכבר הסתיים. גם כשהוא מוצג, ה-RPC אוכף
 * את הזכאות בעצמו — התצוגה אינה ההגנה.
 */
export default function MarkCompletedButton({ appointmentId, customerName, whenLabel }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleComplete = async () => {
    if (loading) return

    const confirmed = window.confirm(
      `לסמן שהתור של ${customerName} ב-${whenLabel} התקיים והושלם?`,
    )
    if (!confirmed) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/appointments/${appointmentId}/complete`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'הפעולה נכשלה. נסי שוב.')
        setLoading(false)
        return
      }

      router.refresh()
      setLoading(false)
    } catch {
      setError('החיבור נכשל. נסי שוב.')
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleComplete}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700
                   border border-emerald-200 hover:bg-emerald-50 px-3.5 py-2 rounded-full
                   cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
      >
        {loading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
        סמני כהושלם
      </button>
      {error && <p role="alert" className="text-xs text-red-600 w-full">{error}</p>}
    </>
  )
}
