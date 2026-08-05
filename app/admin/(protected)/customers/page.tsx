import Link from 'next/link'
import { Info, CalendarDays, StickyNote } from 'lucide-react'
import {
  listCrmCustomers, listCrmSources, CRM_FILTERS, CRM_SORTS,
  type CrmFilter, type CrmSort, type CrmCustomerRow,
} from '@/lib/db/crm'
import { formatPhoneForDisplay } from '@/lib/phone'
import { CRM_STATUS_LABELS, formatDateTimeIL, treatmentLabel } from '@/lib/admin/format'
import CustomerFilters from '@/components/admin/CustomerFilters'
import Pagination from '@/components/admin/Pagination'

export const dynamic = 'force-dynamic'

/**
 * רשימת ה-CRM.
 *
 * החיפוש, הסינון, המיון והדפדוף מתבצעים כולם ב-DB (list_crm_customers) —
 * אין טעינה של כל הלקוחות לדפדפן ואין N+1: שאילתה אחת מחזירה גם את העמוד
 * וגם את ה-total מאותו CTE מסונן.
 *
 * שובל ורפאל מוחרגות ב-DB דרך טבלת admins: הן קיימות ב-customers רק כדי
 * להתחבר, והן אינן לקוחות. ההחרגה אינה לפי טלפון או UUID קשיח.
 */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: { page?: string; q?: string; filter?: string; sort?: string; source?: string }
}) {
  // כל ערך לא תקין נופל לברירת מחדל בטוחה — ה-DB חותך שוב בכל מקרה
  const page = Math.max(1, Number(searchParams.page) || 1)
  const q = (searchParams.q ?? '').trim().slice(0, 100)
  const filter: CrmFilter =
    CRM_FILTERS.includes(searchParams.filter as CrmFilter) ? (searchParams.filter as CrmFilter) : 'all'
  const sort: CrmSort =
    CRM_SORTS.includes(searchParams.sort as CrmSort) ? (searchParams.sort as CrmSort) : 'last_activity'
  const sourceKey = /^[a-z_]{2,32}$/.test(searchParams.source ?? '') ? searchParams.source! : ''

  const [{ items, total, pageSize }, sources] = await Promise.all([
    listCrmCustomers({ search: q, filter, sort, sourceKey: sourceKey || null, page }),
    listCrmSources(),
  ])

  const sourceLabels = new Map(sources.map(s => [s.key, s.label_he]))
  const carried = { q, filter: filter === 'all' ? '' : filter,
                    sort: sort === 'last_activity' ? '' : sort, source: sourceKey }

  return (
    <div>
      <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">לקוחות</h1>
      <p className="text-sm text-brand-muted mb-4">{total} לקוחות</p>

      {/* חלק 1 של האפיון — הודעה למנהלים בלבד */}
      <div className="flex items-start gap-2.5 bg-brand-cream/60 border border-brand-cream-dark
                      rounded-xl p-3.5 mb-6 text-sm text-brand-muted">
        <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          ה-CRM מציג כרגע לקוחות שנוצרו במערכת החדשה. תורים שנוהלו ידנית בלבד
          ב-Google Calendar אינם מופיעים עדיין.
        </p>
      </div>

      <CustomerFilters
        q={q} filter={filter} sort={sort} sourceKey={sourceKey} sources={sources}
      />

      {items.length === 0 ? (
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
          {q || filter !== 'all' || sourceKey
            ? 'לא נמצאו לקוחות שמתאימות לחיפוש.'
            : 'אין עדיין לקוחות במערכת.'}
        </div>
      ) : (
        <>
          {/* מובייל: כרטיסים */}
          <ul className="space-y-2 md:hidden">
            {items.map(c => (
              <li key={c.id}>
                <CustomerCard row={c} sourceLabel={sourceLabels.get(c.source_key) ?? c.source_key} />
              </li>
            ))}
          </ul>

          {/* דסקטופ: טבלה, בתוך מיכל שגולל בעצמו */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-brand-linen-dark bg-white">
            <table className="w-full text-sm text-right">
              <thead className="bg-brand-cream/50 text-xs text-brand-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">לקוחה</th>
                  <th scope="col" className="px-4 py-3 font-medium">סטטוס</th>
                  <th scope="col" className="px-4 py-3 font-medium">מקור</th>
                  <th scope="col" className="px-4 py-3 font-medium">התור הבא</th>
                  <th scope="col" className="px-4 py-3 font-medium">טיפול אחרון</th>
                  <th scope="col" className="px-4 py-3 font-medium">טיפולים</th>
                  <th scope="col" className="px-4 py-3 font-medium">ביטולים</th>
                  <th scope="col" className="px-4 py-3 font-medium">אי-הגעה</th>
                  <th scope="col" className="px-4 py-3 font-medium">הצטרפות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-linen-dark">
                {items.map(c => (
                  <CustomerTableRow
                    key={c.id} row={c}
                    sourceLabel={sourceLabels.get(c.source_key) ?? c.source_key}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Pagination
        page={page} pageSize={pageSize} total={total}
        basePath="/admin/customers" searchParams={carried}
      />
    </div>
  )
}

function nextLabel(row: CrmCustomerRow): string | null {
  if (!row.next_confirmed_starts_at) return null
  const { date, time } = formatDateTimeIL(row.next_confirmed_starts_at)
  return `${date}, ${time}`
}

function nextTreatment(row: CrmCustomerRow): string | null {
  if (!row.next_confirmed_service_key) return null
  return treatmentLabel({
    service_key: row.next_confirmed_service_key,
    variants: row.next_confirmed_variants ?? [],
  })
}

function CustomerTableRow({ row, sourceLabel }: { row: CrmCustomerRow; sourceLabel: string }) {
  const status = CRM_STATUS_LABELS[row.crm_status] ?? CRM_STATUS_LABELS.active
  const next = nextLabel(row)
  const cancellations = row.cancelled_by_customer_count + row.cancelled_by_business_count

  return (
    <tr className="hover:bg-brand-cream/30 transition-colors">
      <td className="px-4 py-3">
        <Link href={`/admin/customers/${row.id}`} className="font-medium text-brand-dark hover:text-brand-rose">
          {row.full_name}
        </Link>
        <div className="text-xs text-brand-muted flex items-center gap-1.5" dir="ltr">
          {formatPhoneForDisplay(row.phone_e164)}
          {row.open_notes_count > 0 && (
            <StickyNote className="w-3 h-3 text-brand-gold" aria-label="קיימת הערה פנימית" />
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${status.className}`}>
          {status.label}
        </span>
      </td>
      <td className="px-4 py-3 text-brand-muted text-xs">{sourceLabel}</td>
      <td className="px-4 py-3 text-xs">
        {next ? (
          <>
            <div className="text-brand-dark">{next}</div>
            <div className="text-brand-muted">{nextTreatment(row)}</div>
          </>
        ) : row.active_pending_count > 0 ? (
          <span className="text-brand-gold-text">בקשה ממתינה</span>
        ) : (
          <span className="text-brand-muted">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-brand-muted">
        {row.last_completed_at ? formatDateTimeIL(row.last_completed_at).date : '—'}
      </td>
      <td className="px-4 py-3 text-brand-dark">{row.completed_count}</td>
      <td className="px-4 py-3 text-brand-muted">{cancellations}</td>
      <td className="px-4 py-3 text-brand-muted">{row.no_show_count}</td>
      <td className="px-4 py-3 text-xs text-brand-muted">
        {formatDateTimeIL(row.created_at).date}
      </td>
    </tr>
  )
}

function CustomerCard({ row, sourceLabel }: { row: CrmCustomerRow; sourceLabel: string }) {
  const status = CRM_STATUS_LABELS[row.crm_status] ?? CRM_STATUS_LABELS.active
  const next = nextLabel(row)

  return (
    <Link
      href={`/admin/customers/${row.id}`}
      className="block bg-white border border-brand-linen-dark rounded-xl p-4 shadow-soft"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="font-medium text-brand-dark flex items-center gap-1.5">
            <span className="truncate">{row.full_name}</span>
            {row.open_notes_count > 0 && (
              <StickyNote className="w-3.5 h-3.5 text-brand-gold shrink-0" aria-label="קיימת הערה פנימית" />
            )}
          </div>
          <div className="text-xs text-brand-muted" dir="ltr">
            {formatPhoneForDisplay(row.phone_e164)}
          </div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 ${status.className}`}>
          {status.label}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-xs mb-2">
        <CalendarDays className="w-3.5 h-3.5 text-brand-muted" aria-hidden="true" />
        {next ? (
          <span className="text-brand-dark">{next} · {nextTreatment(row)}</span>
        ) : row.active_pending_count > 0 ? (
          <span className="text-brand-gold-text">בקשה ממתינה לאישור</span>
        ) : (
          <span className="text-brand-muted">אין תור עתידי</span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-muted">
        <span>{row.completed_count} טיפולים</span>
        <span>{row.cancelled_by_customer_count + row.cancelled_by_business_count} ביטולים</span>
        <span>{row.no_show_count} אי-הגעה</span>
        <span>{sourceLabel}</span>
      </div>
    </Link>
  )
}
