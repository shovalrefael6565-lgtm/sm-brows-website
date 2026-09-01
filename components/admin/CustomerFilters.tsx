'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

/*
 * שתי קבוצות, ובכוונה — הן אינן אותו סוג של בחירה:
 *
 *   **מצב הכרטיס** — פעילות / בארכיון / הכל. שלוש הקבוצות שמהן מורכב
 *   המאגר, ורק כאן נקבע אם לקוחה מאורכבת מוצגת בכלל.
 *
 *   **חיתוכים** — חיתוך של אותה רשימה לפי סטטוס, תורים או ביטולים.
 *
 * ⚠️ שניהם נוסעים באותו פרמטר (`filter`), משום ש-list_crm_customers מקבלת
 * ערך אחד. לכן בחירת מצב כרטיס מחליפה חיתוך, ולהפך — חיתוך מציג תמיד את
 * הפעילות בלבד. זו התנהגות ה-RPC מאז 0028, ולא הוספה כאן.
 *
 * ⚠️ 'active'/'inactive' הם **סטטוס ה-CRM** של הלקוחה ולא מצב הארכיון,
 * ולכן התוויות שלהם אומרות "סטטוס" במפורש — בלעדיו "פעילות" הופיע פעמיים
 * במשמעויות שונות.
 */
const CARD_STATE_OPTIONS = [
  { value: 'all',                    label: 'פעילות' },
  { value: 'archived',               label: 'בארכיון' },
  { value: 'all_including_archived', label: 'הכל' },
]

const CUT_OPTIONS = [
  { value: 'active',     label: 'סטטוס: פעילה' },
  { value: 'inactive',   label: 'סטטוס: לא פעילה' },
  { value: 'has_future', label: 'עם תור עתידי' },
  { value: 'no_future',  label: 'ללא תור עתידי' },
  { value: 'returning',  label: 'חזרו ליותר מטיפול אחד' },
  { value: 'no_show',    label: 'עם אי-הגעה' },
  { value: 'cancelled',  label: 'שביטלו' },
]

const SORT_OPTIONS = [
  { value: 'last_activity',    label: 'פעילות אחרונה' },
  { value: 'created_desc',     label: 'הצטרפות: חדשה לישנה' },
  { value: 'created_asc',      label: 'הצטרפות: ישנה לחדשה' },
  { value: 'next_appointment', label: 'התור הקרוב ביותר' },
  { value: 'name',             label: 'שם' },
]

/**
 * חיפוש, סינון ומיון.
 *
 * החיפוש עם debounce של 350ms כדי לא לירות בקשה על כל הקשה. כל שינוי
 * דוחף query params חדשים — כך שהמצב ניתן לשיתוף ולרענון, וחזרה מפרופיל
 * לרשימה משמרת את הפילטרים. עמוד מתאפס ל-1 בכל שינוי סינון, אחרת המשתמשת
 * הייתה נוחתת בעמוד ריק.
 */
export default function CustomerFilters({
  q, filter, sort, sourceKey, sources,
}: {
  q: string
  filter: string
  sort: string
  sourceKey: string
  sources: { key: string; label_he: string; is_active: boolean }[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState(q)
  const first = useRef(true)

  const push = (changes: Record<string, string>) => {
    const params = new URLSearchParams()
    const next = { q: search, filter, sort, source: sourceKey, ...changes }
    if (next.q)                       params.set('q', next.q)
    if (next.filter && next.filter !== 'all')            params.set('filter', next.filter)
    if (next.sort && next.sort !== 'last_activity')      params.set('sort', next.sort)
    if (next.source)                  params.set('source', next.source)
    const qs = params.toString()
    router.push(qs ? `/admin/customers?${qs}` : '/admin/customers')
  }

  useEffect(() => {
    // לא לדחוף ניווט בטעינה הראשונה, רק על שינוי אמיתי של המשתמשת
    if (first.current) { first.current = false; return }

    const timer = setTimeout(() => {
      push({ q: search })
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  return (
    <div className="flex flex-wrap items-end gap-3 mb-6">
      <div className="flex-1 min-w-[15rem]">
        <label htmlFor="crm-search" className="block text-xs text-brand-muted mb-1.5">
          חיפוש
        </label>
        <div className="relative">
          <Search
            className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted"
            aria-hidden="true"
          />
          <input
            id="crm-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="שם או מספר טלפון"
            className="w-full h-10 pr-9 pl-3 rounded-xl border border-brand-linen-dark bg-white
                       text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold"
          />
        </div>
      </div>

      <div>
        <label htmlFor="crm-filter" className="block text-xs text-brand-muted mb-1.5">סינון</label>
        <select
          id="crm-filter" value={filter}
          onChange={e => push({ filter: e.target.value })}
          className="h-10 px-3 rounded-xl border border-brand-linen-dark bg-white text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-gold"
        >
          <optgroup label="מצב הכרטיס">
            {CARD_STATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
          <optgroup label="חיתוכים">
            {CUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        </select>
      </div>

      <div>
        <label htmlFor="crm-source-filter" className="block text-xs text-brand-muted mb-1.5">
          מקור הגעה
        </label>
        <select
          id="crm-source-filter" value={sourceKey}
          onChange={e => push({ source: e.target.value })}
          className="h-10 px-3 rounded-xl border border-brand-linen-dark bg-white text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-gold"
        >
          <option value="">כל המקורות</option>
          {sources.map(s => (
            <option key={s.key} value={s.key}>{s.label_he}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="crm-sort" className="block text-xs text-brand-muted mb-1.5">מיון</label>
        <select
          id="crm-sort" value={sort}
          onChange={e => push({ sort: e.target.value })}
          className="h-10 px-3 rounded-xl border border-brand-linen-dark bg-white text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-gold"
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  )
}
