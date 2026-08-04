import { searchCustomers } from '@/lib/db/customers'
import { formatPhoneForDisplay } from '@/lib/phone'
import Pagination from '@/components/admin/Pagination'

/** רשימת לקוחות עם חיפוש חופשי (שם או טלפון) ודפדוף */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: { page?: string; q?: string }
}) {
  const page = Math.max(1, Number(searchParams.page) || 1)
  const q = (searchParams.q ?? '').trim()

  const { rows, total, pageSize } = await searchCustomers(q, page)

  return (
    <div>
      <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">לקוחות</h1>
      <p className="text-sm text-brand-muted mb-6">{total} לקוחות</p>

      <form method="get" className="mb-6">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="חיפוש לפי שם או טלפון"
          className="w-full max-w-sm h-11 px-4 rounded-xl border border-brand-linen-dark bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent"
        />
      </form>

      {rows.length === 0 ? (
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
          לא נמצאו לקוחות.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(c => (
            <div
              key={c.id}
              className="bg-white border border-brand-linen-dark rounded-xl p-4 flex items-center justify-between gap-4 shadow-soft"
            >
              <div>
                <div className="font-medium text-brand-dark">{c.full_name}</div>
                <div className="text-xs text-brand-muted" dir="ltr">{formatPhoneForDisplay(c.phone_e164)}</div>
              </div>
              {c.is_blocked && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-red-50 text-red-600 border-red-200">
                  חסומה
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/customers"
        searchParams={{ q }}
      />
    </div>
  )
}
