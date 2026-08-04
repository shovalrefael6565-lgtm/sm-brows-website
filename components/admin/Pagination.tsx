import Link from 'next/link'
import { ChevronRight, ChevronLeft } from 'lucide-react'

interface Props {
  page: number
  pageSize: number
  total: number
  /** נתיב העמוד הנוכחי, למשל '/admin/appointments' */
  basePath: string
  /** שאר פרמטרי הסינון שצריך לשמר בין עמודים (בלי page) */
  searchParams?: Record<string, string | undefined>
}

function buildHref(basePath: string, page: number, searchParams?: Record<string, string | undefined>) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (v) params.set(k, v)
  }
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

/** דפדוף בסיסי — קודם/הבא בלבד, כדי לא לטעון את כל הרשומות בבת אחת */
export default function Pagination({ page, pageSize, total, basePath, searchParams }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null

  const hasPrev = page > 1
  const hasNext = page < totalPages

  return (
    <nav aria-label="דפדוף" className="flex items-center justify-between mt-6 text-sm">
      {hasPrev ? (
        <Link
          href={buildHref(basePath, page - 1, searchParams)}
          className="inline-flex items-center gap-1 text-brand-dark hover:text-brand-rose transition-colors"
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
          קודם
        </Link>
      ) : <span />}

      <span className="text-brand-muted">עמוד {page} מתוך {totalPages}</span>

      {hasNext ? (
        <Link
          href={buildHref(basePath, page + 1, searchParams)}
          className="inline-flex items-center gap-1 text-brand-dark hover:text-brand-rose transition-colors"
        >
          הבא
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </Link>
      ) : <span />}
    </nav>
  )
}
