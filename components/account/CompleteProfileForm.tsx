'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, UserRound } from 'lucide-react'
import { buildFullName, NAME_ERROR_MESSAGES } from '@/lib/customerProfile'
import { PROFILE_PRIVACY_NOTICE, splitNoticeLinks } from '@/lib/privacyNotice'

/**
 * שלב 15H — שער השלמת השם באזור האישי.
 *
 * מוצג אך ורק ללקוחה שהשם השמור שלה הוא ה-placeholder הידוע (ראה
 * needsNameCompletion). לקוחה עם שם כלשהו — גם שם של מילה אחת — לא רואה
 * את המסך הזה לעולם.
 *
 * ⚠️ הטופס אינו שולח טלפון ואינו שולח מזהה. הזהות נקבעת בשרת מה-session
 * בלבד, ולכן אין כאן שום דרך לעדכן לקוחה אחרת.
 */
export default function CompleteProfileForm() {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return

    // אותה ולידציה בדיוק שהשרת מריץ — כאן רק כדי לחסוך נסיעה.
    const built = buildFullName(firstName, lastName)
    if (!built.ok) {
      setError(NAME_ERROR_MESSAGES[built.error])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.message ?? 'השמירה נכשלה. נסי שוב.')
        setLoading(false)
        return
      }
      // הצלחה (כולל alreadyNamed): העמוד נטען מחדש, השער נעלם.
      router.refresh()
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setLoading(false)
    }
  }

  return (
    <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 shadow-soft">
      <div className="flex items-center gap-2 mb-2">
        <UserRound className="w-5 h-5 text-brand-rose" aria-hidden="true" />
        <h2 className="font-serif text-xl font-bold text-brand-dark">רגע לפני שנתחיל</h2>
      </div>
      <p className="text-sm text-brand-medium leading-relaxed mb-5">
        נשמח להכיר. השם יופיע על התור שלך ביומן ובהודעות שנשלח אליך.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-brand-dark mb-1.5">
              שם פרטי
            </label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              autoComplete="given-name"
              required
              maxLength={40}
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              disabled={loading}
              className="w-full h-12 px-4 rounded-xl border border-brand-linen-dark bg-white text-brand-dark
                         focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent
                         disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-brand-dark mb-1.5">
              שם משפחה
            </label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              autoComplete="family-name"
              required
              maxLength={40}
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              disabled={loading}
              className="w-full h-12 px-4 rounded-xl border border-brand-linen-dark bg-white text-brand-dark
                         focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent
                         disabled:opacity-60"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-red-500 text-sm mt-3">
            {error}
          </p>
        )}

        <p className="text-xs text-brand-muted mt-3 leading-relaxed">
          {splitNoticeLinks(PROFILE_PRIVACY_NOTICE).map((seg, i) =>
            seg.href ? (
              <Link
                key={i}
                href={seg.href}
                target="_blank"
                className="font-semibold text-brand-rose-text underline hover:text-brand-rose-text/80"
              >
                {seg.text}
              </Link>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </p>

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl
                     bg-brand-dark text-white font-medium hover:bg-brand-dark/90 transition-colors
                     disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          שמירה והמשך
        </button>
      </form>
    </div>
  )
}
