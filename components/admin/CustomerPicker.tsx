'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Loader2, UserRound, UserRoundX, X, UserPlus, AlertCircle } from 'lucide-react'
import { formatPhoneForDisplay } from '@/lib/phone'

/**
 * בורר הלקוחה בטופס התור הידני.
 *
 * החיפוש עובר ל-/api/admin/customers/search, שמחזיר ארבעה שדות בלבד
 * (מזהה, שם, טלפון, האם יש חשבון) — לא מדדי CRM ולא הערות.
 *
 * חשבונות מנהל מוחרגים ב-DB, ולכן אי אפשר לבחור אותם כאן.
 *
 * ─── יצירה מהירה במקום (שלב 12) ─────────────────────────────────────────────
 *
 * לקוחה חדשה בטלפון אינה מצדיקה יציאה מהטופס וחזרה אליו. השם והטלפון
 * נשלחים ל-POST /api/admin/customers — **אותו** מסלול של מסך "לקוחה חדשה",
 * ולכן אותה התנהגות בדיוק:
 *
 *   • הטלפון מנורמל בשרת (lib/phone.ts), ולקוחה קיימת מזוהה לפיו.
 *   • טלפון שכבר קיים מחזיר את הלקוחה הקיימת ('existing_customer') —
 *     **לא נוצרת כפילות**, והשם/המקור שלה אינם נדרסים.
 *   • לקוחה חדשה נכנסת ל-CRM מיד, בלי חשבון התחברות, בלי OTP ובלי SMS.
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

  // ── יצירה מהירה ──
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [existingNotice, setExistingNotice] = useState(false)
  // ⚠️ נוצר פעם אחת לכל ניסיון ונשלח שוב בכל retry — disabled על הכפתור
  // אינו הגנה, כי תגובה יכולה ללכת לאיבוד אחרי שה-DB כבר כתב.
  const [createRequestId, setCreateRequestId] = useState(() => crypto.randomUUID())

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (createBusy) return
    setCreateBusy(true)
    setCreateError(null)

    try {
      const res = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: newName, phone: newPhone, client_request_id: createRequestId,
        }),
      })
      const data = await res.json()

      if (!res.ok || !data.customerId) {
        setCreateError(data.message ?? 'יצירת הלקוחה נכשלה. נסי שוב.')
        return
      }

      // ⚠️ הלקוחה נטענת מהשרת ולא נבנית מהקלט: לקוחה קיימת חוזרת עם
      // **השם השמור שלה**, ולא עם מה שהוקלד עכשיו.
      const loaded = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(newPhone)}`)
      const found = loaded.ok
        ? ((await loaded.json()).items ?? []).find((c: PickedCustomer) => c.id === data.customerId)
        : null

      onChange(found ?? {
        id: data.customerId, full_name: newName.trim(),
        phone_e164: newPhone.trim(), has_login_account: false,
      })
      setExistingNotice(data.created === false)
      setCreating(false)
      setNewName('')
      setNewPhone('')
      setCreateRequestId(crypto.randomUUID())
    } catch {
      setCreateError('החיבור נכשל. נסי שוב.')
    } finally {
      setCreateBusy(false)
    }
  }
  // מזהה הבקשה האחרונה: תגובה של חיפוש ישן שמגיעה באיחור לא תדרוס תוצאה חדשה
  const seq = useRef(0)

  // חיפוש עם debounce וסנכרון תגובות (seq.current) — לא ניתן להעביר להתאמה
  // בזמן ה-render בלי לפצל את ה-fetch לזרימה נפרדת, מה שהיה מסכן את סנכרון
  // תוצאות הבקשות. disable נקודתי, לא שינוי התנהגות.
  useEffect(() => {
    if (value) return
    const q = query.trim()
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <>
      {existingNotice && (
        <p className="text-xs text-brand-gold-text mb-2">
          המספר כבר קיים במערכת — נבחרה הלקוחה הקיימת, ולא נוצרה כפילות.
        </p>
      )}
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
          onClick={() => { onChange(null); setQuery(''); setItems([]); setExistingNotice(false) }}
          aria-label="בחירת לקוחה אחרת"
          className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl
                     text-brand-muted hover:bg-white transition-colors"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      </>
    )
  }

  if (creating) {
    return (
      <div className="space-y-3">
        <div>
          <label htmlFor="newCustomerName" className="block text-sm font-medium text-brand-dark mb-1.5">
            שם מלא
          </label>
          <input
            id="newCustomerName"
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoComplete="off"
            className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                       text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
          />
        </div>
        <div>
          <label htmlFor="newCustomerPhone" className="block text-sm font-medium text-brand-dark mb-1.5">
            טלפון
          </label>
          <input
            id="newCustomerPhone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={newPhone}
            onChange={e => setNewPhone(e.target.value)}
            autoComplete="off"
            className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                       text-brand-dark text-right focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
          />
        </div>

        <p className="text-xs text-brand-muted">
          לקוחה שכבר קיימת עם אותו מספר תיבחר כפי שהיא — לא נוצרת כפילות.
          לא נשלחת הודעה ולא נפתח חשבון התחברות.
        </p>

        {createError && (
          <div role="alert" className="flex items-start gap-2 bg-rose-50 border border-rose-200
                                       rounded-xl p-3 text-sm text-rose-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{createError}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {/*
            ⚠️ type="button" ולא submit: הרכיב הזה יושב בתוך טופס יצירת
            התור, ו-submit כאן היה שולח את טופס התור עצמו.
          */}
          <button
            type="button"
            onClick={createCustomer}
            disabled={createBusy || newName.trim().length < 2 || newPhone.trim().length < 9}
            className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-brand-dark
                       text-white text-sm font-medium hover:bg-brand-dark/90 transition-colors
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {createBusy
              ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />שומרת…</>
              : <><UserPlus className="w-4 h-4" aria-hidden="true" />שמירה ובחירה</>}
          </button>
          <button
            type="button"
            onClick={() => { setCreating(false); setCreateError(null) }}
            className="inline-flex items-center justify-center h-11 px-4 rounded-xl border
                       border-brand-linen-dark text-sm font-medium text-brand-muted
                       hover:bg-brand-cream/50 transition-colors"
          >
            ביטול
          </button>
        </div>
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
        <p className="mt-2 text-sm text-brand-muted">לא נמצאה לקוחה בחיפוש הזה.</p>
      )}

      <button
        type="button"
        onClick={() => {
          // מה שכבר הוקלד בחיפוש הוא כמעט תמיד השם או המספר — לא מאבדים אותו.
          const typed = query.trim()
          if (/[0-9]/.test(typed)) setNewPhone(typed)
          else if (typed) setNewName(typed)
          setCreating(true)
        }}
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-dark
                   border border-brand-linen-dark rounded-xl h-11 px-4 hover:bg-brand-cream/50
                   transition-colors"
      >
        <UserPlus className="w-4 h-4" aria-hidden="true" />
        לקוחה חדשה
      </button>
    </div>
  )
}
