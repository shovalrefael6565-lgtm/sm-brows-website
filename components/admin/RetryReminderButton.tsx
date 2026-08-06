'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RotateCw } from 'lucide-react'

/**
 * ניסיון חוזר לתזכורת.
 *
 * ⚠️ כשהתוצאה הקודמת הייתה delivery_unknown, ההודעה **אולי כבר יצאה**.
 * לכן נדרש אישור מפורש, והוא נשלח לשרת כדגל — הדיאלוג כאן אינו ההגנה.
 * ה-RPC retry_reminder (0011) דוחה כל בקשה בלי הדגל, גם אם היא נשלחה
 * ישירות ל-API בלי לעבור דרך המסך הזה.
 */
export default function RetryReminderButton({
  reminderId,
  requiresDuplicateConfirmation,
}: {
  reminderId: string
  requiresDuplicateConfirmation: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const send = async (confirmDuplicateRisk: boolean) => {
    if (loading) return
    setLoading(true)
    setError(null)
    setConfirming(false)

    try {
      const res = await fetch(`/api/admin/reminders/${reminderId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmDuplicateRisk }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.message ?? 'הניסיון החוזר נכשל.')
      }
      setLoading(false)
      router.refresh()
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setLoading(false)
    }
  }

  const handleClick = () => {
    if (requiresDuplicateConfirmation) {
      setConfirming(true)
      return
    }
    void send(false)
  }

  if (confirming) {
    return (
      <div className="text-xs">
        <p className="text-brand-dark mb-1.5">
          התוצאה הקודמת אינה ודאית — ייתכן שההודעה כבר נשלחה. לשלוח שוב?
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void send(true)}
            className="font-semibold text-red-600 border border-red-200 hover:border-red-400 px-3 py-1 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
          >
            כן, שלחי שוב
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-brand-muted hover:text-brand-dark px-2 py-1 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
          >
            ביטול
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-dark border border-brand-linen-dark hover:border-brand-rose disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCw className="w-3 h-3" aria-hidden="true" />
        )}
        ניסיון חוזר
      </button>
      {error && <p role="alert" className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}
