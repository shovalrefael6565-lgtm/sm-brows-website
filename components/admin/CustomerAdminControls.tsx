'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react'

interface Props {
  customerId: string
  fullName: string
  phone: string
  /** לקוחה עם חשבון התחברות — הטלפון שלה נעול לעריכה. ראה 0028. */
  hasLoginAccount: boolean
  archivedAt: string | null
}

type Busy = 'save' | 'archive' | 'delete' | null

/**
 * שלב 15H — ניהול כרטיס הלקוחה: עריכת פרטים, ארכיון ומחיקה.
 *
 * ═══ 🔒 שלוש הפעולות אינן שוות במסוכנותן, והמסך אומר את זה ═══
 *
 *   עריכה  — הפיכה לחלוטין.
 *   ארכיון — הפיכה בלחיצה אחת, ואינה מוחקת דבר.
 *   מחיקה  — **בלתי הפיכה**, ולכן דורשת הקלדת שם הלקוחה ולא רק אישור.
 *
 * ⚠️ שדה הטלפון נעול ללקוחה שיש לה חשבון התחברות. זו אינה החלטה של המסך
 * הזה — ה-RPC דוחה את השינוי בכל מקרה (0028) — אבל שדה נעול עם הסבר עדיף
 * על שדה שנראה עריך ומחזיר שגיאה אחרי הקלדה.
 */
export default function CustomerAdminControls({
  customerId, fullName, phone, hasLoginAccount, archivedAt,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [nameValue, setNameValue] = useState(fullName)
  const [phoneValue, setPhoneValue] = useState(phone)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)

  const isArchived = archivedAt !== null

  const call = async (
    kind: Exclude<Busy, null>,
    url: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
    setBusy(kind)
    setError(null)
    try {
      const res = await fetch(url, init)
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError((data.message as string) ?? 'הפעולה נכשלה. נסי שוב.')
        setBusy(null)
        return { ok: false, data }
      }
      return { ok: true, data }
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setBusy(null)
      return { ok: false, data: {} }
    }
  }

  const handleSave = async () => {
    const payload: Record<string, string> = {}
    if (nameValue.trim() && nameValue.trim() !== fullName) payload.fullName = nameValue.trim()
    if (!hasLoginAccount && phoneValue.trim() && phoneValue.trim() !== phone) {
      payload.phone = phoneValue.trim()
    }
    if (Object.keys(payload).length === 0) {
      setEditing(false)
      return
    }

    const res = await call('save', `/api/admin/customers/${customerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return

    setBusy(null)
    setEditing(false)
    router.refresh()
  }

  const handleArchiveToggle = async () => {
    if (!isArchived) {
      const ok = window.confirm(
        `להעביר את הכרטיס של ${fullName} לארכיון?\n\n` +
          'הכרטיס ייצא מרשימת הלקוחות. התורים, ההיסטוריה וההערות נשמרים במלואם, וניתן להחזיר אותו בכל רגע.',
      )
      if (!ok) return
    }

    const res = await call('archive', `/api/admin/customers/${customerId}/archive`, {
      method: isArchived ? 'DELETE' : 'POST',
    })
    if (!res.ok) return

    setBusy(null)
    router.refresh()
  }

  const handleDelete = async () => {
    // ⚠️ הקלדת השם ולא window.confirm: מחיקה אינה הפיכה, ולחיצה על "אישור"
    // מתוך הרגל היא בדיוק הטעות שהמסך הזה אמור למנוע.
    if (confirmName.trim() !== fullName.trim()) {
      setError('יש להקליד את שם הלקוחה במדויק כדי לאשר את המחיקה.')
      return
    }

    const res = await call('delete', `/api/admin/customers/${customerId}`, { method: 'DELETE' })
    if (!res.ok) return

    // הכרטיס אינו קיים יותר — אין לאן לרענן.
    router.push('/admin/customers')
  }

  return (
    <div className="mt-4 bg-white border border-brand-linen-dark rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-brand-dark">ניהול הכרטיס</h3>
        {!editing && (
          <button
            type="button"
            onClick={() => { setEditing(true); setError(null) }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-dark
                       border border-brand-linen-dark hover:border-brand-rose px-3.5 py-1.5 rounded-full
                       cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-brand-gold"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            עריכת פרטים
          </button>
        )}
      </div>

      {isArchived && (
        <p className="mt-3 text-xs text-brand-gold-text bg-brand-gold/10 border border-brand-gold/40 rounded-xl p-3">
          הכרטיס נמצא בארכיון ואינו מופיע ברשימת הלקוחות. כל הנתונים נשמרו.
        </p>
      )}

      {editing && (
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="edit-name" className="block text-xs text-brand-muted mb-1.5">שם מלא</label>
            <input
              id="edit-name"
              type="text"
              maxLength={80}
              value={nameValue}
              onChange={e => setNameValue(e.target.value)}
              disabled={busy !== null}
              className="w-full h-11 px-3 rounded-xl border border-brand-linen-dark bg-white text-brand-dark
                         focus:outline-none focus:ring-2 focus:ring-brand-gold disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor="edit-phone" className="block text-xs text-brand-muted mb-1.5">טלפון</label>
            <input
              id="edit-phone"
              type="tel"
              dir="ltr"
              inputMode="tel"
              value={phoneValue}
              onChange={e => setPhoneValue(e.target.value)}
              disabled={busy !== null || hasLoginAccount}
              className="w-full h-11 px-3 rounded-xl border border-brand-linen-dark bg-white text-brand-dark
                         focus:outline-none focus:ring-2 focus:ring-brand-gold disabled:opacity-60
                         disabled:bg-brand-cream"
            />
            {hasLoginAccount && (
              <p className="text-[11px] text-brand-muted mt-1.5 leading-relaxed">
                ללקוחה יש חשבון התחברות, ולכן המספר נעול: שינוי שלו כאן היה מנתק אותה מהאזור
                האישי שלה. לתיקון מספר יש לפנות אליה בוואטסאפ.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-dark text-white
                         text-xs font-semibold hover:bg-brand-dark/90 disabled:opacity-60
                         cursor-pointer transition-colors"
            >
              {busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              שמירה
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setNameValue(fullName)
                setPhoneValue(phone)
                setError(null)
              }}
              disabled={busy !== null}
              className="h-10 px-4 rounded-xl border border-brand-linen-dark text-brand-dark text-xs
                         font-semibold hover:bg-brand-cream disabled:opacity-60 cursor-pointer transition-colors"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-brand-linen-dark flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleArchiveToggle}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-dark
                     border border-brand-linen-dark hover:border-brand-rose px-3.5 py-1.5 rounded-full
                     disabled:opacity-60 cursor-pointer transition-colors focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          {busy === 'archive' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : isArchived ? (
            <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <Archive className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {isArchived ? 'החזרה מהארכיון' : 'העברה לארכיון'}
        </button>

        {/*
          🔴 לקוחה עם חשבון התחברות אינה ניתנת למחיקה **לעולם**, ולכן אין
          כפתור. הסיבה מוצגת למטה במקום להשאיר כפתור שתמיד יחזיר שגיאה.

          ⚠️ זו הסתרה בלבד: גם ה-RPC (0028) וגם ה-route חוסמים בעצמם, כולל
          במרוץ שבו הלקוחה מתחברת בדיוק בין טעינת המסך ללחיצה.
        */}
        {!deleting && !hasLoginAccount && (
          <button
            type="button"
            onClick={() => { setDeleting(true); setError(null) }}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600
                       border border-red-200 hover:bg-red-50 px-3.5 py-1.5 rounded-full
                       disabled:opacity-60 cursor-pointer transition-colors focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-brand-gold"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            מחיקת הכרטיס
          </button>
        )}
      </div>

      {hasLoginAccount && (
        <p className="mt-3 text-[11px] text-brand-muted leading-relaxed">
          לכרטיס יש חשבון התחברות ולכן אי אפשר למחוק אותו: המחיקה הייתה משאירה חשבון
          מיותם במערכת ההתחברות, והלקוחה הייתה מקבלת כרטיס חדש וריק בכניסה הבאה שלה.
          הפעולה הנכונה היא ארכיון.
        </p>
      )}

      {deleting && (
        <div className="mt-4 border border-red-200 bg-red-50/50 rounded-xl p-4">
          <p className="text-xs text-brand-dark leading-relaxed mb-3">
            מחיקה אינה הפיכה, ואפשרית <strong className="font-bold">רק לכרטיס שאין לו אף תור</strong>.
            ללקוחה עם היסטוריה יש להשתמש בארכיון. לאישור, הקלידי את שם הלקוחה:
            <span className="font-bold"> {fullName}</span>
          </p>
          <input
            type="text"
            value={confirmName}
            onChange={e => setConfirmName(e.target.value)}
            disabled={busy !== null}
            className="w-full h-11 px-3 rounded-xl border border-red-200 bg-white text-brand-dark
                       focus:outline-none focus:ring-2 focus:ring-red-300 disabled:opacity-60"
          />
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-red-600 text-white
                         text-xs font-semibold hover:bg-red-700 disabled:opacity-60 cursor-pointer
                         transition-colors"
            >
              {busy === 'delete' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
              מחיקה סופית
            </button>
            <button
              type="button"
              onClick={() => { setDeleting(false); setConfirmName(''); setError(null) }}
              disabled={busy !== null}
              className="h-10 px-4 rounded-xl border border-brand-linen-dark text-brand-dark text-xs
                         font-semibold hover:bg-brand-cream disabled:opacity-60 cursor-pointer transition-colors"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-red-500 text-xs mt-3">{error}</p>}
    </div>
  )
}
