'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Loader2 } from 'lucide-react'

/**
 * 🔒 שלב 14 — הכפתור הזה כבר אינו מתעלם מתשובת השרת.
 *
 * ⚠️ עד שלב 14 ההתנתקות הייתה מחיקת cookie מקומית, ולכן "הצלחה" הייתה
 * מובטחת מראש. עכשיו היא כוללת ביטול בצד השרת, וביטול יכול להיכשל.
 * ניווט משם החוצה כאילו כלום היה מראה למשתמשת מסך של אורחת בזמן שה-session
 * שלה עדיין חי בשרת — כלומר בדיוק ההטעיה ששלב 14 בא לתקן.
 *
 * לכן בכשל: נשארים בעמוד, מציגים מה קרה, ומאפשרים לנסות שוב.
 */
export default function LogoutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const logout = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })

      if (!res.ok) {
        // ⚠️ ה-cookie אכן נמחק מהדפדפן הזה, אבל ה-session בשרת אולי עדיין
        // חי. אין לנווט הלאה כאילו ההתנתקות הושלמה.
        const body = await res.json().catch(() => null)
        setError(
          typeof body?.message === 'string'
            ? body.message
            : 'ההתנתקות לא הושלמה בשרת. נסי שוב בעוד רגע.',
        )
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError('אין חיבור לשרת. נסי שוב בעוד רגע.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={logout}
        disabled={loading}
        className="inline-flex items-center gap-2 text-sm text-brand-muted hover:text-brand-dark transition-colors cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded px-2 py-1"
      >
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          : <LogOut className="w-4 h-4" aria-hidden="true" />}
        <span>התנתקות</span>
      </button>
      {error && <p role="alert" className="text-red-500 text-xs mt-1.5">{error}</p>}
    </div>
  )
}
