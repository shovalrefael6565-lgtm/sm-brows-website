'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/**
 * ⚠️ open ו-contacted הן שתיהן בקשות **פעילות**: הן תופסות מקום במכסת
 * הלקוחה וחוסמות בקשה כפולה לאותו מועד. רק 'closed' משחרר אותו.
 */
const OPTIONS = [
  { value: 'open',      label: 'ממתינה' },
  { value: 'contacted', label: 'יצרנו קשר' },
  { value: 'closed',    label: 'נסגרה' },
]

/**
 * שינוי סטטוס בקשת המתנה. ⚠️ פעולה אחת ויחידה — אין כאן המרה לתור ואין
 * שום אוטומציה. שובל מסמנת מה כבר טופל.
 */
export default function WaitlistStatusSelect({
  id, status,
}: { id: string; status: string }) {
  const router = useRouter()
  const [value, setValue] = useState(status)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const change = async (next: string) => {
    const previous = value
    setValue(next)
    setSaving(true)
    setFailed(false)
    try {
      const res = await fetch('/api/admin/waitlist', {
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
        aria-label="סטטוס בקשת ההמתנה"
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
