'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Archive, Pencil, X } from 'lucide-react'

export interface NoteItem {
  id: string
  body: string
  created_at: string
  updated_at: string
}

const MAX = 2000

/**
 * הערות פנימיות של ההנהלה.
 *
 * ─── idempotency ───────────────────────────────────────────────────────────
 * clientRequestId נוצר פעם אחת לכל *ניסיון יצירה* ונשמר ב-ref, כך שהקלדה
 * אינה מייצרת מפתח חדש ו-retry אחרי timeout שולח את אותו מפתח. רק אחרי
 * הצלחה מלאה נוצר מפתח חדש עבור ההערה הבאה. זה מה שמונע הערה כפולה כאשר
 * התגובה הולכת לאיבוד אחרי שה-DB כבר כתב — disabled על הכפתור לא מגן על כך.
 *
 * ─── בטיחות תצוגה ──────────────────────────────────────────────────────────
 * הגוף מוצג כטקסט רגיל בתוך JSX. אין dangerouslySetInnerHTML ואין רינדור
 * Markdown, ולכן <script> או תגית HTML מוצגים כטקסט ואינם מבוצעים.
 * whitespace-pre-wrap שומר על שורות חדשות בלי לפרש שום תחביר.
 */
export default function CustomerNotes({
  customerId,
  notes,
}: {
  customerId: string
  notes: NoteItem[]
}) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  // מפתח ה-idempotency לניסיון היצירה הנוכחי
  const requestId = useRef<string>(crypto.randomUUID())

  const create = async () => {
    const text = draft.trim()
    if (busy || text.length === 0) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/customers/${customerId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, client_request_id: requestId.current }),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'שמירת ההערה נכשלה. נסי שוב.')
        return
      }

      // הצלחה מלאה — מפתח חדש עבור ההערה הבאה
      requestId.current = crypto.randomUUID()
      setDraft('')
      router.refresh()
    } catch {
      // ה-request נכשל ברשת: המפתח *נשאר* כפי שהוא, כך שניסיון חוזר
      // יזוהה כ-retry ולא ייצור הערה שנייה אם הכתיבה בעצם הצליחה.
      setError('שמירת ההערה נכשלה. נסי שוב.')
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async (noteId: string) => {
    const text = editDraft.trim()
    if (busy || text.length === 0) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/customers/${customerId}/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.message ?? 'עדכון ההערה נכשל. נסי שוב.')
        return
      }
      setEditingId(null)
      router.refresh()
    } catch {
      setError('עדכון ההערה נכשל. נסי שוב.')
    } finally {
      setBusy(false)
    }
  }

  const archive = async (noteId: string) => {
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/customers/${customerId}/notes/${noteId}/archive`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.message ?? 'העברה לארכיון נכשלה. נסי שוב.')
        return
      }
      router.refresh()
    } catch {
      setError('העברה לארכיון נכשלה. נסי שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="font-serif text-xl font-bold text-brand-dark mb-1">הערות פנימיות</h2>
      <p className="text-xs text-brand-muted mb-4">
        גלויות להנהלה בלבד. אינן מוצגות ללקוחה ואינן נשלחות בשום הודעה.
      </p>

      <div className="bg-white border border-brand-linen-dark rounded-2xl p-4 mb-4">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, MAX))}
          disabled={busy}
          rows={3}
          placeholder="הערה פנימית…"
          className="w-full px-3 py-2 rounded-xl border border-brand-linen-dark text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-gold disabled:opacity-50"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-brand-muted">{draft.length} / {MAX}</span>
          <button
            type="button"
            onClick={create}
            disabled={busy || draft.trim().length === 0}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-dark text-white
                       text-sm font-medium disabled:opacity-40 transition-opacity"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            הוספת הערה
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-brand-muted">אין עדיין הערות.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map(n => (
            <li key={n.id} className="bg-white border border-brand-linen-dark rounded-xl p-4">
              {editingId === n.id ? (
                <>
                  <textarea
                    value={editDraft}
                    onChange={e => setEditDraft(e.target.value.slice(0, MAX))}
                    disabled={busy}
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl border border-brand-linen-dark text-sm
                               focus:outline-none focus:ring-2 focus:ring-brand-gold disabled:opacity-50"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button" onClick={() => saveEdit(n.id)}
                      disabled={busy || editDraft.trim().length === 0}
                      className="h-9 px-4 rounded-lg bg-brand-dark text-white text-xs font-medium disabled:opacity-40"
                    >
                      שמירה
                    </button>
                    <button
                      type="button" onClick={() => setEditingId(null)} disabled={busy}
                      className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border
                                 border-brand-linen-dark text-xs text-brand-muted"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      ביטול
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* טקסט בלבד — React עושה escape, אין HTML ואין Markdown */}
                  <p className="text-sm text-brand-dark whitespace-pre-wrap break-words">{n.body}</p>
                  <div className="flex items-center justify-between mt-3 gap-3">
                    <span className="text-xs text-brand-muted">
                      {new Intl.DateTimeFormat('he-IL', {
                        timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short',
                        year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
                      }).format(new Date(n.created_at))}
                      {n.updated_at !== n.created_at && ' · נערכה'}
                    </span>
                    <span className="flex items-center gap-1">
                      <button
                        type="button" disabled={busy}
                        onClick={() => { setEditingId(n.id); setEditDraft(n.body) }}
                        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs
                                   text-brand-muted hover:text-brand-dark disabled:opacity-40"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        עריכה
                      </button>
                      <button
                        type="button" onClick={() => archive(n.id)} disabled={busy}
                        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs
                                   text-brand-muted hover:text-brand-dark disabled:opacity-40"
                      >
                        <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                        לארכיון
                      </button>
                    </span>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
