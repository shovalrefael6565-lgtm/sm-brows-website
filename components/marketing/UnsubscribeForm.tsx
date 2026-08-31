'use client'

import { useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

/**
 * אישור ההסרה — לחיצה אחת, בלי התחברות ובלי קוד.
 *
 * ⚠️ ההסרה אינה מתבצעת בטעינת העמוד אלא בלחיצה מפורשת. סורק קישורים
 * בוואטסאפ או ב-SMS פותח כל URL שמגיע, וביצוע ההסרה ב-GET היה מסיר
 * לקוחות שמעולם לא ביקשו זאת.
 *
 * ⚠️ אין בעמוד שם, טלפון או מזהה — גם לא אחרי ההצלחה.
 */
export default function UnsubscribeForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (busy || done) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      // ⚠️ 'already_opted_out' הוא הצלחה: המצב שהלקוחה ביקשה כבר מתקיים.
      if (res.ok && (data.result === 'opted_out' || data.result === 'already_opted_out')) {
        setDone(true)
      } else {
        setError('הקישור אינו תקין או שפג. אפשר ליצור קשר ונסיר אותך מהדיוור.')
      }
    } catch {
      setError('החיבור נכשל. אפשר לנסות שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="text-sm text-brand-dark">
          <p className="font-medium mb-1">הוסרת מרשימת הדיוור.</p>
          <p className="text-brand-muted">
            לא יישלחו אלייך עוד הודעות פרסומיות. הודעות על תור שקבעת — תזכורת, שינוי מועד
            או ביטול — ימשיכו להישלח כרגיל.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-dark">
        לאישור ההסרה מהודעות פרסומיות, לחצי על הכפתור.
      </p>
      <p className="text-xs text-brand-muted">
        ⚠️ ההסרה חלה על הודעות פרסומיות בלבד. הודעות על תור שקבעת ימשיכו להישלח.
      </p>

      {error && (
        <div role="alert" className="flex items-start gap-2 bg-rose-50 border border-rose-200
                                     rounded-xl p-3 text-sm text-rose-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl bg-brand-dark
                   text-white text-sm font-medium hover:bg-brand-dark/90 transition-colors
                   disabled:opacity-60 disabled:cursor-not-allowed w-full"
      >
        {busy
          ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />מסירה…</>
          : 'אישור ההסרה'}
      </button>
    </div>
  )
}
