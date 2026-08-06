'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Search, Loader2, UserRound, UserRoundX, X, UserPlus } from 'lucide-react'
import { formatPhoneForDisplay } from '@/lib/phone'

/**
 * בורר הלקוחה בטופס התור הידני.
 *
 * החיפוש עובר ל-/api/admin/customers/search, שמחזיר ארבעה שדות בלבד
 * (מזהה, שם, טלפון, האם יש חשבון) — לא מדדי CRM ולא הערות.
 *
 * חשבונות מנהל מוחרגים ב-DB, ולכן אי אפשר לבחור אותם כאן.
 */

export interface PickedCustomer {
  id: string
  full_name: string
  phone_e164: string
  has_login_account: boolean
}

export default function CustomerPicker({
  value,
  onChange,
}: {
  value: PickedCustomer | null
  onChange: (c: PickedCustomer | null) => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<PickedCustomer[]>([])
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  // מזהה הבקשה האחרונה: תגובה של חיפוש ישן שמגיעה באיחור לא תדרוס תוצאה חדשה
  const seq = useRef(0)

  useEffect(() => {
    if (value) return
    const q = query.trim()
    if (q.length < 2) { setItems([]); return }

    const mine = ++seq.current
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        if (mine === seq.current) setItems(res.ok ? (data.items ?? []) : [])
      } catch {
        if (mine === seq.current) setItems([])
      } finally {
        if (mine === seq.current) setBusy(false)
      }
    }, 250)

    return () => clearTimeout(t)
  }, [query, value])

  if (value) {
    return (
      <div className="flex items-start justify-between gap-3 bg-brand-cream/40 border
                      border-brand-cream-dark rounded-xl p-3.5">
        <div className="min-w-0">
          <div className="font-medium text-brand-dark truncate">{value.full_name}</div>
          <div className="text-xs text-brand-muted" dir="ltr">
            {formatPhoneForDisplay(value.phone_e164)}
          </div>
          <span className={`inline-flex items-center gap-1 text-[11px] mt-0.5 ${
            value.has_login_account ? 'text-brand-muted' : 'text-brand-gold-text'}`}>
            {value.has_login_account
              ? <><UserRound className="w-3 h-3" aria-hidden="true" />יש חשבון</>
              : <><UserRoundX className="w-3 h-3" aria-hidden="true" />ללא חשבון</>}
          </span>
        </div>
        <button
          type="button"
          onClick={() => { onChange(null); setQuery(''); setItems([]) }}
          aria-label="בחירת לקוחה אחרת"
          className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl
                     text-brand-muted hover:bg-white transition-colors"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="relative">
        <Search
          className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={e => { setQuery(e.target.value); setTouched(true) }}
          placeholder="חיפוש לפי שם או טלפון"
          aria-label="חיפוש לקוחה"
          className="w-full h-12 pr-10 pl-3 rounded-xl border border-brand-linen-dark bg-white
                     text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
        />
        {busy && (
          <Loader2
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted animate-spin"
            aria-hidden="true"
          />
        )}
      </div>

      {items.length > 0 && (
        <ul className="mt-2 border border-brand-linen-dark rounded-xl divide-y divide-brand-linen-dark
                       overflow-hidden max-h-72 overflow-y-auto">
          {items.map(c => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onChange(c)}
                className="w-full text-right px-3.5 py-3 hover:bg-brand-cream/40 transition-colors"
              >
                <div className="font-medium text-brand-dark text-sm">{c.full_name}</div>
                <div className="text-xs text-brand-muted flex items-center gap-2">
                  <span dir="ltr">{formatPhoneForDisplay(c.phone_e164)}</span>
                  <span className={c.has_login_account ? '' : 'text-brand-gold-text'}>
                    {c.has_login_account ? 'יש חשבון' : 'ללא חשבון'}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {touched && !busy && query.trim().length >= 2 && items.length === 0 && (
        <div className="mt-2 text-sm text-brand-muted">
          לא נמצאה לקוחה.{' '}
          <Link href="/admin/customers/new" className="text-brand-dark underline
                                                       inline-flex items-center gap-1">
            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            יצירת לקוחה חדשה
          </Link>
        </div>
      )}
    </div>
  )
}
