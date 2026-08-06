'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle, UserPlus, CalendarPlus } from 'lucide-react'
import type { CrmSource } from '@/lib/db/crm'

/**
 * יצירת לקוחה ידנית.
 *
 * ⚠️ client_request_id נוצר **פעם אחת** לכל ניסיון ונשלח שוב בכל retry —
 * זה מה שהופך את היצירה ל-idempotent. `disabled` על הכפתור מונע לחיצה
 * כפולה בממשק, אבל הוא לא מגן על תגובה שאבדה אחרי שה-DB כבר כתב.
 *
 * המפתח מתחדש רק אחרי הצלחה, כדי שיצירה *נוספת* לא תיחשב retry.
 */

type Result =
  | { kind: 'created';  customerId: string; name: string }
  | { kind: 'existing'; customerId: string }

export default function NewCustomerForm({ sources }: { sources: CrmSource[] }) {
  const router = useRouter()

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [sourceKey, setSourceKey] = useState('unknown')
  const [crmStatus, setCrmStatus] = useState<'active' | 'inactive'>('active')

  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  // רק מקורות פעילים ניתנים לבחירה. מקור שכובה בעבר עדיין מוצג על לקוחות
  // קיימות, אבל אין סיבה לשייך אליו לקוחה חדשה.
  const activeSources = useMemo(() => sources.filter(s => s.is_active), [sources])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName, phone, sourceKey, crmStatus, client_request_id: requestId,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.message ?? 'הפעולה נכשלה. נסי שוב.')
        return
      }

      setResult(
        data.result === 'customer_created'
          ? { kind: 'created', customerId: data.customerId, name: fullName.trim() }
          : { kind: 'existing', customerId: data.customerId },
      )
      // מפתח חדש לפעולה הבאה — יצירה נוספת אינה retry של הקודמת
      setRequestId(crypto.randomUUID())
      router.refresh()
    } catch {
      setError('החיבור נכשל. נסי שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="bg-white border border-brand-linen-dark rounded-2xl p-5 space-y-4">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-brand-dark">
            {result.kind === 'created'
              ? `הלקוחה ${result.name} נוצרה. אין לה חשבון התחברות — היא תוכל להתחבר בעצמה בעתיד, והחשבון יקושר לכרטיס הזה.`
              : 'המספר הזה כבר שייך ללקוחה קיימת. לא נוצרה לקוחה נוספת.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/customers/${result.customerId}`}
            className="inline-flex items-center justify-center h-11 px-4 rounded-xl border
                       border-brand-linen-dark text-sm font-medium text-brand-dark
                       hover:bg-brand-cream/50 transition-colors"
          >
            מעבר לפרופיל
          </Link>
          <Link
            href={`/admin/appointments/new?customerId=${result.customerId}`}
            className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-xl
                       bg-brand-dark text-white text-sm font-medium hover:bg-brand-dark/90 transition-colors"
          >
            <CalendarPlus className="w-4 h-4" aria-hidden="true" />
            יצירת תור
          </Link>
          <button
            type="button"
            onClick={() => { setResult(null); setFullName(''); setPhone(''); setSourceKey('unknown'); setCrmStatus('active') }}
            className="inline-flex items-center justify-center h-11 px-4 rounded-xl border
                       border-brand-linen-dark text-sm font-medium text-brand-muted
                       hover:bg-brand-cream/50 transition-colors"
          >
            לקוחה נוספת
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="bg-white border border-brand-linen-dark rounded-2xl p-5 space-y-4">
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-brand-dark mb-1.5">
          שם מלא
        </label>
        <input
          id="fullName"
          type="text"
          required
          minLength={2}
          maxLength={80}
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                     text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-brand-dark mb-1.5">
          טלפון
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          required
          dir="ltr"
          placeholder="050-000-0000"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                     text-brand-dark text-left focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
        />
        <p className="text-xs text-brand-muted mt-1">
          לא נשלחת הודעה ולא נפתח חשבון — המספר משמש לזיהוי בלבד.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="sourceKey" className="block text-sm font-medium text-brand-dark mb-1.5">
            מקור הגעה
          </label>
          <select
            id="sourceKey"
            value={sourceKey}
            onChange={e => setSourceKey(e.target.value)}
            className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                       text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
          >
            {activeSources.map(s => (
              <option key={s.key} value={s.key}>{s.label_he}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="crmStatus" className="block text-sm font-medium text-brand-dark mb-1.5">
            סטטוס
          </label>
          <select
            id="crmStatus"
            value={crmStatus}
            onChange={e => setCrmStatus(e.target.value === 'inactive' ? 'inactive' : 'active')}
            className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                       text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
          >
            <option value="active">פעילה</option>
            <option value="inactive">לא פעילה</option>
          </select>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl bg-brand-dark
                   text-white text-sm font-medium hover:bg-brand-dark/90 transition-colors
                   disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto"
      >
        {busy
          ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />יוצרת…</>
          : <><UserPlus className="w-4 h-4" aria-hidden="true" />יצירת לקוחה</>}
      </button>
    </form>
  )
}
