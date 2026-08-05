'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { CRM_STATUS_LABELS } from '@/lib/admin/format'

interface Source {
  key: string
  label_he: string
  is_active: boolean
}

/**
 * סטטוס CRM ומקור הגעה.
 *
 * שני כללים שמשותפים לשתי הפקדים:
 *   • אין optimistic update. הערך בממשק משתנה רק אחרי ש-router.refresh()
 *     טוען מחדש את הנתונים מהשרת — כך שהמנהלת לא רואה "נשמר" על משהו
 *     שה-DB דחה.
 *   • לחיצה כפולה נחסמת ע"י loading, אבל זו נוחות ולא הגנה: האמת היא
 *     שהפעולות אידמפוטנטיות ב-DB.
 *
 * מקור שאינו פעיל מוצג אם הלקוחה כבר משויכת אליו, אבל אי אפשר לבחור בו
 * מחדש — הוא מסומן disabled ברשימה.
 */
export default function CrmControls({
  customerId,
  crmStatus,
  sourceKey,
  sources,
}: {
  customerId: string
  crmStatus: 'active' | 'inactive'
  sourceKey: string
  sources: Source[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'status' | 'source' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<'status' | 'source' | null>(null)

  const patch = async (kind: 'status' | 'source', payload: Record<string, string>) => {
    if (busy) return
    setBusy(kind)
    setError(null)
    setSaved(null)

    try {
      const res = await fetch(`/api/admin/customers/${customerId}/crm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'הפעולה נכשלה. נסי שוב.')
        setBusy(null)
        return
      }

      setSaved(kind)
      router.refresh()
    } catch {
      setError('הפעולה נכשלה. נסי שוב.')
    } finally {
      setBusy(null)
    }
  }

  // מקור שכבר משויך אך אינו פעיל עדיין צריך להופיע, אחרת התצוגה תשקר
  const visibleSources = sources.filter(s => s.is_active || s.key === sourceKey)

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor="crm-status" className="block text-xs text-brand-muted mb-1.5">
          סטטוס
        </label>
        <select
          id="crm-status"
          value={crmStatus}
          disabled={busy !== null}
          onChange={e => patch('status', { crm_status: e.target.value })}
          className="h-10 px-3 rounded-xl border border-brand-linen-dark bg-white text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-gold disabled:opacity-50"
        >
          {Object.entries(CRM_STATUS_LABELS).map(([key, v]) => (
            <option key={key} value={key}>{v.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="crm-source" className="block text-xs text-brand-muted mb-1.5">
          מקור הגעה
        </label>
        <select
          id="crm-source"
          value={sourceKey}
          disabled={busy !== null}
          onChange={e => patch('source', { source_key: e.target.value })}
          className="h-10 px-3 rounded-xl border border-brand-linen-dark bg-white text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-gold disabled:opacity-50"
        >
          {visibleSources.map(s => (
            <option key={s.key} value={s.key} disabled={!s.is_active && s.key !== sourceKey}>
              {s.label_he}{!s.is_active ? ' (לא פעיל)' : ''}
            </option>
          ))}
        </select>
      </div>

      {busy && (
        <span className="inline-flex items-center gap-1.5 text-xs text-brand-muted pb-2.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          שומרת…
        </span>
      )}
      {saved && !busy && (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 pb-2.5">
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          נשמר
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-600 pb-2.5">{error}</span>
      )}
    </div>
  )
}
