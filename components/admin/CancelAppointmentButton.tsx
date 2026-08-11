'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CalendarX } from 'lucide-react'

interface Props {
  appointmentId: string
  customerName: string
  whenLabel: string
}

/**
 * שלב 15H — ביטול תור מאושר ע"י שובל.
 *
 * ⚠️ **הלקוחה מקבלת SMS** ברגע שהביטול נכתב. זו הסיבה שהאישור כאן מפורט
 * ומזכיר את שם הלקוחה ואת המועד: לחיצה בשורה הלא נכונה בטבלה היא טעות
 * שאי אפשר לבטל — ההודעה כבר יצאה.
 *
 * ⚠️ אין כאן חלון WhatsApp (בשונה מאישור/דחייה): ההודעה על ביטול עסקי
 * נשלחת אוטומטית ב-SMS דרך מנגנון 15F, ופתיחת שיחה ידנית הייתה כפילות
 * שמגיעה ללקוחה פעמיים.
 *
 * הפעולה idempotent במסד: לחיצה חוזרת מחזירה 'already_cancelled' בלי
 * שורת היסטוריה שנייה, ולכן בלי הודעה שנייה.
 */
export default function CancelAppointmentButton({ appointmentId, customerName, whenLabel }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const handleCancel = async () => {
    if (loading) return

    const confirmed = window.confirm(
      `לבטל את התור של ${customerName} ב-${whenLabel}?\n\n` +
        'התור יבוטל, השעה תשתחרר, האירוע יימחק מהיומן, ותישלח ללקוחה הודעת SMS על הביטול.',
    )
    if (!confirmed) return

    setLoading(true)
    setError(null)
    setWarning(null)

    try {
      const res = await fetch(`/api/admin/appointments/${appointmentId}/cancel`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'הביטול נכשל. נסי שוב.')
        setLoading(false)
        router.refresh()
        return
      }

      // ⚠️ התור בוטל בכל מקרה. כשל מחיקה ביומן הוא מצב שדורש טיפול,
      // לא כישלון של הפעולה — ולכן אזהרה ולא שגיאה.
      if (!data.calendarRemoved) setWarning(data.message)

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
        onClick={handleCancel}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 border border-red-200
                   hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed px-3.5 py-1.5 rounded-full
                   cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-brand-gold"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <CalendarX className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        ביטול התור
      </button>
      {error && <p role="alert" className="text-red-500 text-xs mt-1">{error}</p>}
      {warning && <p role="alert" className="text-brand-gold-text text-xs mt-1">{warning}</p>}
    </div>
  )
}
