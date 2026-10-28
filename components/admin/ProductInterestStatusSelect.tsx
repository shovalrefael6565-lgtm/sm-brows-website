'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/**
 * שינוי סטטוס ידני של הרשמה לעדכון מוצר.
 *
 * 🔴 **'notified' אינו ברשימה, וזו לא השמטה.** הסטטוס הזה מצהיר שהודעה
 * יצאה ללקוחה בפועל, ולכן הוא נקבע אך ורק ע"י מנגנון השליחה (0039).
 * אפשרות ידנית הייתה מוציאה לקוחה מרשימת הנמענות בלי שקיבלה כלום — כשל
 * שאי אפשר לגלות בדיעבד. גם ה-API וגם ה-RPC דוחים אותו בנפרד.
 */
const OPTIONS = [
  { value: 'open',   label: 'ממתינה לעדכון' },
  { value: 'closed', label: 'נסגרה' },
]

export default function ProductInterestStatusSelect({
  id, status,
}: { id: string; status: string }) {
  const router = useRouter()
  const [value, setValue] = useState(status)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  /*
   * ⚠️ שורה שכבר נשלחה אליה הודעה אינה ניתנת להחזרה ל"ממתינה" מהמסך:
   * החזרתה הייתה מכניסה אותה לרשימת הנמענות של ריצה עתידית, כלומר הודעה
   * שנייה. היא מוצגת כתווית בלבד.
   */
  if (status === 'notified') {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
        עודכנה
      </span>
    )
  }

  const change = async (next: string) => {
    const previous = value
    setValue(next)
    setSaving(true)
    setFailed(false)
    try {
      const res = await fetch('/api/admin/product-interest', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: next }),
      })
      if (!res.ok) {
        setValue(previous)
        setFailed(true)
        return
      }
      router.refresh()
    } catch {
      setValue(previous)
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={value}
        disabled={saving}
        onChange={e => change(e.target.value)}
        aria-label="סטטוס ההרשמה"
        className="h-9 rounded-lg border border-brand-linen-dark bg-white px-2 text-xs
                   text-brand-dark disabled:opacity-50"
      >
        {OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-muted" aria-hidden="true" />}
      {failed && <span className="text-[11px] text-rose-700" role="alert">נכשל</span>}
    </span>
  )
}
