import Link from 'next/link'
import { normalizePhone } from '@/lib/phone'
import { formatDateTimeIL } from '@/lib/admin/format'
import { products } from '@/lib/data'
import {
  listProductInterest, countProductInterest, shadeBreakdown, latestLaunchRun,
  type ProductInterestStatus,
} from '@/lib/db/productInterestAdmin'
import ProductInterestStatusSelect from '@/components/admin/ProductInterestStatusSelect'
import LaunchNotificationButton from '@/components/admin/LaunchNotificationButton'

export const dynamic = 'force-dynamic'

/**
 * התעניינות במוצרים.
 *
 * ⚠️ **מסך נפרד מרשימת ההמתנה לתורים ומהודעות ללקוחות.** שלוש מערכות
 * שונות: רשימת המתנה היא לשעה ביומן, קמפיינים הם דיוור שיווקי, וכאן —
 * בקשה מפורשת לקבל הודעה אחת כשמוצר מסוים עולה לאתר.
 *
 * 🔒 הטלפונים מרונדרים בשרת בלבד, בתוך (protected) שעובר requireAdminPage.
 * אין endpoint ציבורי שמחזיר את הרשימה — ה-API היחיד של המסך הוא PATCH
 * לשינוי סטטוס ו-POST לשליחה.
 */

const STATUS_LABELS: Record<ProductInterestStatus, { label: string; className: string }> = {
  open:     { label: 'ממתינה לעדכון', className: 'bg-brand-gold/15 text-brand-gold-text border-brand-gold/40' },
  notified: { label: 'עודכנה',         className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  closed:   { label: 'נסגרה',          className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
}

const SOURCE_LABELS: Record<string, string> = {
  product_page: 'עמוד המוצר',
}

/** רק מוצרים שיכולים לקבל הרשמות — אותה רשימה שה-API מאמת מולה. */
const interestProducts = products.filter(p => p.slug && p.status === 'coming_soon')

interface Props {
  searchParams: Promise<{ phone?: string; product?: string; status?: string }>
}

export default async function ProductInterestPage(props: Props) {
  const sp = await props.searchParams

  /*
   * 🔒 הקלט מהכתובת מסונן מול רשימות סגורות לפני שהוא מגיע ל-DB:
   * מוצר מול הקטלוג, סטטוס מול שלושת הערכים, וטלפון דרך normalizePhone —
   * כלומר חיפוש חלקי לפי קידומת אינו אפשרי כאן.
   */
  const productFilter = interestProducts.some(p => p.slug === sp.product)
    ? sp.product : undefined
  const statusFilter = (['open', 'notified', 'closed'] as const)
    .find(s => s === sp.status)
  const phoneFilter = sp.phone ? normalizePhone(sp.phone) ?? undefined : undefined
  const phoneInvalid = Boolean(sp.phone?.trim()) && !phoneFilter

  const [rows, counts] = await Promise.all([
    phoneInvalid
      ? Promise.resolve([])
      : listProductInterest({
          phone: phoneFilter, productSlug: productFilter, status: statusFilter,
        }),
    countProductInterest({ productSlug: productFilter }),
  ])

  /*
   * ⚠️ פילוח גוונים מוצג **רק אם יש גוונים בנתונים בפועל**. למוצר הנוכחי
   * אין גוונים, ולכן הבלוק פשוט לא מופיע — ולא מוצג "0" לגוונים מומצאים.
   */
  const shades = productFilter ? await shadeBreakdown(productFilter) : {}
  const shadeEntries = Object.entries(shades).sort((a, b) => b[1] - a[1])

  /*
   * מצב הריצה האחרונה — מוצג גם מחוץ לדיאלוג, כדי שריצה תקועה או עמומה
   * תיראה מיד בכניסה למסך ולא רק אחרי לחיצה על "שליחת הודעת השקה".
   */
  const run = productFilter ? await latestLaunchRun(productFilter) : null
  const runBlocking = run?.status === 'running' || run?.status === 'needs_review'

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">התעניינות במוצרים</h1>
        <p className="text-sm text-brand-muted">
          {counts.total} נרשמות · {counts.open} ממתינות · {counts.notified} עודכנו · {counts.closed} נסגרו
        </p>
      </div>

      <p className="text-xs text-brand-muted bg-brand-cream border border-brand-linen-dark rounded-xl p-3 mb-4 leading-relaxed">
        הרשמות אלה אינן הזמנות ואינן דיוור שיווקי: כל נרשמת ביקשה במפורש
        לקבל <strong>הודעה אחת</strong> כשהמוצר עולה לאתר. הסטטוס
        &quot;עודכנה&quot; נקבע אך ורק אחרי שליחה מוצלחת ואינו ניתן לסימון ידני.
      </p>

      {/* ── סינון ── */}
      <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
        <div>
          <label htmlFor="pi-phone" className="block text-xs font-semibold text-brand-dark mb-1">
            חיפוש לפי טלפון
          </label>
          <input
            id="pi-phone"
            name="phone"
            type="tel"
            dir="ltr"
            defaultValue={sp.phone ?? ''}
            placeholder="05X-XXXXXXX"
            className="h-9 w-44 rounded-lg border border-brand-linen-dark bg-white px-2 text-xs text-brand-dark text-left"
          />
        </div>
        <div>
          <label htmlFor="pi-product" className="block text-xs font-semibold text-brand-dark mb-1">
            מוצר
          </label>
          <select
            id="pi-product"
            name="product"
            defaultValue={productFilter ?? ''}
            className="h-9 rounded-lg border border-brand-linen-dark bg-white px-2 text-xs text-brand-dark"
          >
            <option value="">כל המוצרים</option>
            {interestProducts.map(p => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pi-status" className="block text-xs font-semibold text-brand-dark mb-1">
            סטטוס
          </label>
          <select
            id="pi-status"
            name="status"
            defaultValue={statusFilter ?? ''}
            className="h-9 rounded-lg border border-brand-linen-dark bg-white px-2 text-xs text-brand-dark"
          >
            <option value="">הכל</option>
            <option value="open">ממתינה לעדכון</option>
            <option value="notified">עודכנה</option>
            <option value="closed">נסגרה</option>
          </select>
        </div>
        <button
          type="submit"
          className="h-9 rounded-lg bg-brand-dark px-4 text-xs font-semibold text-white cursor-pointer"
        >
          סינון
        </button>
        {(sp.phone || sp.product || sp.status) && (
          <Link href="/admin/product-interest" className="text-xs text-brand-rose-text underline">
            ניקוי
          </Link>
        )}
      </form>

      {phoneInvalid && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="alert">
          מספר הטלפון שהוזן אינו תקין, ולכן לא בוצע חיפוש.
        </p>
      )}

      {/* ── שליחת הודעת השקה — פר מוצר ── */}
      {productFilter && (
        <div className="mb-5 rounded-2xl border border-brand-linen-dark bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-brand-dark">הודעת השקה</p>
              <p className="text-xs text-brand-muted mt-0.5">
                תישלח ל-{counts.open} נרשמות שממתינות לעדכון במוצר הזה.
              </p>
            </div>
            <LaunchNotificationButton
              productSlug={productFilter}
              productLabel={interestProducts.find(p => p.slug === productFilter)?.name ?? ''}
            />
          </div>

          {/*
            🔴 ריצה חוסמת מוצגת כאזהרה בולטת, מעל הכל. ⚠️ **אין כאן כפתור
            שחרור** — ריצה שנתקעה אינה משתחררת אוטומטית ואינה משתחררת
            בלחיצה, כי אי אפשר לדעת אם SMS כבר יצא לפני שהתהליך נקטע.
          */}
          {runBlocking && run && (
            <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3">
              <p className="text-xs font-bold text-rose-900">
                {run.status === 'running'
                  ? 'מתבצעת כרגע שליחת השקה'
                  : 'ריצת שליחה דורשת בדיקה'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-rose-900">
                התחילה ב-{formatDateTimeIL(run.started_at).date} {formatDateTimeIL(run.started_at).time}.
                {run.status === 'needs_review' && (
                  <>
                    {' '}נשלחו: {run.successful_count} · לא ודאיות: {run.delivery_unknown_count}
                    {' '}· סימון שנכשל: {run.mark_failed_count}.
                  </>
                )}
                {' '}<strong>שליחה נוספת למוצר הזה חסומה</strong> עד בדיקה מול דוח
                השליחות של 019.
              </p>
            </div>
          )}

          {run && !runBlocking && (
            <p className="mt-3 text-xs text-brand-muted">
              ריצה אחרונה: {formatDateTimeIL(run.started_at).date} · נשלחו {run.successful_count}
              {run.failed_count > 0 && ` · נכשלו ${run.failed_count}`}
            </p>
          )}

          {shadeEntries.length > 0 && (
            <div className="mt-4 border-t border-brand-linen-dark pt-3">
              <p className="text-xs font-semibold text-brand-dark mb-2">ביקוש לפי גוון</p>
              <ul className="flex flex-wrap gap-2">
                {shadeEntries.map(([shade, n]) => (
                  <li key={shade} className="rounded-lg bg-brand-cream px-2.5 py-1 text-xs text-brand-dark">
                    {shade}: <strong>{n}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
          {phoneInvalid ? 'אין תוצאות.' : 'אין עדיין הרשמות לעדכון על מוצרים.'}
        </div>
      ) : (
        <>
          {/* מובייל */}
          <ul className="space-y-2 md:hidden">
            {rows.map(r => {
              const when = formatDateTimeIL(r.created_at)
              return (
                <li key={r.id} className="bg-white border border-brand-linen-dark rounded-xl p-4 shadow-soft">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <span className="text-sm font-bold text-brand-dark">
                      {productName(r.product_slug)}
                    </span>
                    <ProductInterestStatusSelect id={r.id} status={r.status} />
                  </div>
                  <a href={`tel:${r.phone_e164}`} dir="ltr"
                     className="inline-block text-xs text-brand-rose-text underline">
                    {r.phone_e164}
                  </a>
                  {r.shade && <p className="text-xs text-brand-muted mt-1">גוון: {r.shade}</p>}
                  {/* ⚠️ closed_at מוצג רק לשורה סגורה — לשאר הוא ריק ממילא,
                      והצגת "—" בכל שורה הייתה רעש. */}
                  <p className="text-[11px] text-brand-muted mt-2">
                    {SOURCE_LABELS[r.source] ?? r.source} · נרשמה {when.date} {when.time}
                    {r.notified_at && ` · עודכנה ${formatDateTimeIL(r.notified_at).date}`}
                    {r.closed_at && ` · נסגרה ${formatDateTimeIL(r.closed_at).date}`}
                  </p>
                </li>
              )
            })}
          </ul>

          {/* דסקטופ */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-brand-linen-dark bg-white">
            <table className="w-full text-sm text-right">
              <thead className="bg-brand-cream/50 text-xs text-brand-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">מוצר</th>
                  <th scope="col" className="px-4 py-3 font-medium">טלפון</th>
                  <th scope="col" className="px-4 py-3 font-medium">גוון</th>
                  <th scope="col" className="px-4 py-3 font-medium">מקור</th>
                  <th scope="col" className="px-4 py-3 font-medium">נרשמה</th>
                  <th scope="col" className="px-4 py-3 font-medium">עודכנה</th>
                  <th scope="col" className="px-4 py-3 font-medium">נסגרה</th>
                  <th scope="col" className="px-4 py-3 font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-linen-dark">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 text-brand-dark">{productName(r.product_slug)}</td>
                    <td className="px-4 py-3">
                      <a href={`tel:${r.phone_e164}`} dir="ltr"
                         className="text-brand-rose-text underline">{r.phone_e164}</a>
                    </td>
                    <td className="px-4 py-3 text-brand-muted">{r.shade ?? '—'}</td>
                    <td className="px-4 py-3 text-brand-muted text-xs">
                      {SOURCE_LABELS[r.source] ?? r.source}
                    </td>
                    <td className="px-4 py-3 text-brand-muted text-xs">
                      {formatDateTimeIL(r.created_at).date}
                    </td>
                    <td className="px-4 py-3 text-brand-muted text-xs">
                      {r.notified_at ? formatDateTimeIL(r.notified_at).date : '—'}
                    </td>
                    {/* נקודת הייחוס ל-retention של שורה סגורה (0040). */}
                    <td className="px-4 py-3 text-brand-muted text-xs">
                      {r.closed_at ? formatDateTimeIL(r.closed_at).date : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {r.status === 'notified' ? (
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_LABELS.notified.className}`}>
                          {STATUS_LABELS.notified.label}
                        </span>
                      ) : (
                        <ProductInterestStatusSelect id={r.id} status={r.status} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function productName(slug: string): string {
  return products.find(p => p.slug === slug)?.name ?? slug
}
