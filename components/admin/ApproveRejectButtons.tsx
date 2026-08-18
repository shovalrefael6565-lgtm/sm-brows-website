'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, X, AlertTriangle } from 'lucide-react'
import { useWhatsAppWindow } from './useWhatsAppWindow'

interface Props {
  appointmentId: string
}

/**
 * כפתורי "אישור תור" / "דחיית בקשה" על כרטיס בקשה pending (ראה
 * app/admin/(protected)/page.tsx). הפעולה עצמה — כולל בדיקת התנגשות
 * מול היומן, ה-RPC האטומי, וסנכרון היומן — מתבצעת כולה בשרת
 * (lib/appointmentApproval.ts). הכפתורים כאן רק שולחים בקשה, מונעים
 * לחיצה כפולה, ופותחים WhatsApp רק אחרי שידוע שהתור קיים במערכת.
 */
export default function ApproveRejectButtons({ appointmentId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * 🔒 מצב שלישי, לא שני: "אושר אבל היומן לא סונכרן". התור **קיים**,
   * השעה תפוסה, ואסור להציג אותו כשגיאה אדומה שמשמעה "לא קרה כלום" —
   * זה היה גורם לשובל לאשר שוב או להתייחס לתור כאילו אינו קיים.
   */
  const [syncWarning, setSyncWarning] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const whatsapp = useWhatsAppWindow()

  const run = async (action: 'approve' | 'reject') => {
    if (loading) return
    if (action === 'reject' && !window.confirm('לדחות את הבקשה? הפעולה אינה הפיכה.')) return

    whatsapp.openBlank() // סינכרוני, לפני כל await
    setLoading(action)
    setError(null)
    setSyncWarning(null)
    setFallbackUrl(null)

    try {
      const res = await fetch(`/api/admin/appointments/${appointmentId}/${action}`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        // ⚠️ approved=true פירושו שהתור אושר ב-DB ורק סנכרון היומן נכשל.
        // סגירת חלון ה-WhatsApp כאן הייתה מאבדת את הודעת האישור ללקוחה
        // על תור שקיים בפועל — הבאג שתוקן ב-15C.
        if (data.approved && data.whatsappUrl) {
          if (!whatsapp.navigate(data.whatsappUrl)) setFallbackUrl(data.whatsappUrl)
          setSyncWarning(data.message ?? 'הסנכרון ליומן נכשל.')
          setLoading(null)
          router.refresh()
          return
        }

        whatsapp.close()
        setError(data.message ?? (action === 'approve' ? 'האישור נכשל. נסי שוב.' : 'הדחייה נכשלה. נסי שוב.'))
        setLoading(null)
        router.refresh()
        return
      }

      if (!whatsapp.navigate(data.whatsappUrl)) setFallbackUrl(data.whatsappUrl)
      setLoading(null)
      router.refresh()
    } catch {
      whatsapp.close()
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setLoading(null)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-brand-cream-dark/60">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => run('approve')}
          disabled={loading !== null}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          {loading === 'approve' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          אישור תור
        </button>
        <button
          type="button"
          onClick={() => run('reject')}
          disabled={loading !== null}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          {loading === 'reject' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          דחיית בקשה
        </button>
      </div>
      {error && <p role="alert" className="text-red-500 text-xs mt-2">{error}</p>}
      {syncWarning && (
        <div
          role="status"
          className="mt-2 flex items-start gap-2 bg-brand-gold/10 border border-brand-gold/40 rounded-xl p-2.5"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-brand-gold-text flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs">
            <p className="font-bold text-brand-gold-text">
              התור אושר והשעה שמורה — אבל הסנכרון ליומן נכשל.
            </p>
            <p className="text-brand-muted mt-0.5">{syncWarning}</p>
            <p className="text-brand-muted mt-0.5">
              התור יופיע למטה תחת ״דורש טיפול: סנכרון יומן״ עם כפתור לניסיון חוזר.
              אין לאשר אותו שוב.
            </p>
          </div>
        </div>
      )}
      {fallbackUrl && (
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-xs font-semibold text-brand-whatsapp-dark hover:underline"
        >
          פתיחת הודעת האישור ב-WhatsApp
        </a>
      )}
    </div>
  )
}
