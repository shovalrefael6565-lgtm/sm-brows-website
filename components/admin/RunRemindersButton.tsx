'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send } from 'lucide-react'

/**
 * "הרצת תזכורות עכשיו".
 *
 * מניעת לחיצה כפולה כאן היא נוחות בלבד — ההגנה האמיתית מפני שתי ריצות
 * מקבילות היא ה-lease ב-DB (claim_due_reminder ב-0011): שתי לשוניות פתוחות
 * לא יוכלו לתפוס את אותה תזכורת, ולכן לא תישלח הודעה כפולה.
 *
 * ⚠️ הסיכום מציג במפורש כשהמערכת כבויה או כשאין ספק. בשלב 11 זה המצב תמיד,
 * ואסור שהכפתור ייתן רושם שמשהו נשלח.
 */
export default function RunRemindersButton() {
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
      const res = await fetch('/api/admin/reminders/run', { method: 'POST' })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'ההרצה נכשלה. נסי שוב.')
        setLoading(false)
        router.refresh()
        return
      }

      const s = data.stats ?? {}
      const swept = `נסגרו ${s.sweptExpired ?? 0} חלונות שפגו`

      if (!s.enabled) {
        setSummary(`מערכת התזכורות כבויה — לא נשלחה אף הודעה ולא שונתה אף תזכורת. ${swept}.`)
      } else if (!s.dispatchable) {
        setSummary(`אין ספק שליחה מוגדר — לא נשלחה אף הודעה ולא שונתה אף תזכורת. ${swept}.`)
      } else {
        setSummary(
          `נתפסו ${s.claimed ?? 0} · נשלחו ${s.sent ?? 0} · סימולציה ${s.simulated ?? 0} · ` +
          `לניסיון חוזר ${s.retrying ?? 0} · נכשלו ${s.failed ?? 0} · ` +
          `לא ודאיות ${s.deliveryUnknown ?? 0} · ${swept}`,
        )
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
        onClick={handleRun}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-dark border border-brand-linen-dark hover:border-brand-rose disabled:opacity-60 disabled:cursor-not-allowed px-3.5 py-1.5 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        {loading ? 'מריצה…' : 'הרצת תזכורות עכשיו'}
      </button>
      {error && <p role="alert" className="text-red-500 text-xs mt-1.5">{error}</p>}
      {summary && <p className="text-brand-muted text-xs mt-1.5">{summary}</p>}
    </div>
  )
}
