'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, X, AlertTriangle } from 'lucide-react'

interface Props {
  /** מזהה **שורת הבקשה**, לא התור המקורי */
  requestId: string
}

/**
 * 🔒 שלב 15E — אישור/דחייה של בקשת שינוי מועד.
 *
 * ⚠️ רכיב נפרד מ-ApproveRejectButtons, ולא prop נוסף עליו. שתי סיבות:
 *
 *   1. הנתיבים שונים (reschedule-approve / reschedule-reject), ובלבול
 *      ביניהם היה מאשר את המועד החדש בלי לשחרר את הישן.
 *   2. **אין כאן WhatsApp.** ApproveRejectButtons פותח חלון WhatsApp
 *      סינכרוני לפני ה-await ומנווט אליו עם נוסח האישור. נוסח ההודעה
 *      לשינוי מועד טרם אושר (15F), ושימוש בנוסח אישור התור הרגיל היה
 *      שולח ללקוחה הודעה שגויה — היא מדברת על תור חדש, לא על שינוי.
 *      לכן הרכיב הזה לא נוגע ב-WhatsApp בכלל.
 */
export default function RescheduleRequestButtons({ requestId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * 🔒 מצב שלישי, בדיוק כמו ב-15C: "אושר, אבל היומן לא סונכרן במלואו".
   * ההחלפה ב-DB כבר עשתה COMMIT — התור החדש קיים והשעה הישנה השתחררה.
   */
  const [syncWarning, setSyncWarning] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const run = async (action: 'approve' | 'reject') => {
    if (loading) return
    if (action === 'reject' &&
        !window.confirm('לדחות את בקשת שינוי המועד? התור המקורי יישאר ללא שינוי.')) return
    if (action === 'approve' &&
        !window.confirm('לאשר את המועד החדש? התור הקיים ישוחרר והאירוע שלו יימחק מהיומן.')) return

    setLoading(action)
    setError(null)
    setSyncWarning(null)
    setDone(null)

    try {
      const path = action === 'approve' ? 'reschedule-approve' : 'reschedule-reject'
      const res = await fetch(`/api/admin/appointments/${requestId}/${path}`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'הפעולה נכשלה. נסי שוב.')
        setLoading(null)
        router.refresh()
        return
      }

      if (action === 'approve' && (data.newEventSynced === false || data.oldEventRemoved === false)) {
        setSyncWarning(data.message ?? 'הסנכרון ליומן לא הושלם.')
      } else {
        setDone(data.message ?? 'הפעולה בוצעה.')
      }
      setLoading(null)
      router.refresh()
    } catch {
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
          אישור המועד החדש
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
          דחיית הבקשה
        </button>
      </div>

      <p className="text-[11px] text-brand-muted mt-2 leading-relaxed">
        נוסח ההודעה ללקוחה על שינוי מועד עדיין לא הוגדר במערכת — יש לעדכן אותה ידנית.
      </p>

      {error && <p role="alert" className="text-red-500 text-xs mt-2">{error}</p>}
      {done && <p role="status" className="text-emerald-700 text-xs mt-2">{done}</p>}
      {syncWarning && (
        <div
          role="status"
          className="mt-2 flex items-start gap-2 bg-brand-gold/10 border border-brand-gold/40 rounded-xl p-2.5"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-brand-gold-text flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs">
            <p className="font-bold text-brand-gold-text">
              המועד החדש נשמר והשעה הישנה השתחררה — אבל היומן לא סונכרן במלואו.
            </p>
            <p className="text-brand-muted mt-0.5">{syncWarning}</p>
            <p className="text-brand-muted mt-0.5">
              התור יופיע למטה תחת ״דורש טיפול: סנכרון יומן״ עם כפתור לניסיון חוזר.
              אין לאשר שוב.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
