import Link from 'next/link'
import { MessageCircle, Search, CalendarPlus, User } from 'lucide-react'
import {
  listAppointmentsAdmin, countAppointmentsForAdmin, type AdminRange, type AdminAppointmentRow,
} from '@/lib/db/appointments'
import { formatPhoneForDisplay, E164_IL_MOBILE } from '@/lib/phone'
import { formatDateTimeIL, treatmentLabel, STATUS_LABELS, BOOKING_SOURCE_LABELS } from '@/lib/admin/format'
import { buildReminderWhatsAppMessage, buildWhatsAppLinkToCustomer } from '@/lib/whatsappTemplates'
import Pagination from '@/components/admin/Pagination'
import CancelAppointmentButton from '@/components/admin/CancelAppointmentButton'
import MarkNoShowButton from '@/components/admin/MarkNoShowButton'
import ApproveRejectButtons from '@/components/admin/ApproveRejectButtons'
import { cn } from '@/lib/utils'

/**
 * מסך התורים (שלב 12).
 *
 * ─── שלושה סינונים עצמאיים ─────────────────────────────────────────────────
 *
 * טווח (היום/מחר/השבוע/עתידיים/עבר), סטטוס, וחיפוש חופשי לפי שם או טלפון.
 * שלושתם מצטברים ונשמרים בכתובת, כך שרענון, "חזרה" ושיתוף קישור מחזירים
 * בדיוק את אותה תצוגה.
 *
 * ⚠️ 'rejected' הוא פילטר **נפרד** מ-'cancelled_by_business' ולא מיזוג
 * שלו: דחיית בקשה שלא אושרה וביטול תור מאושר הן שתי עובדות עסקיות שונות
 * (0019). מיזוגן לפילטר אחד היה מבטל את מטרת ההפרדה.
 *
 * ─── כרטיסים ולא טבלה ──────────────────────────────────────────────────────
 *
 * שובל עובדת מהטלפון. טבלה ברוחב 640px מינימום גררה גלילה אופקית בכל
 * שורה, ופעולות שיוצאות מהמסך אינן פעולות. כרטיס לכל תור נקרא באותה
 * צורה בכל רוחב, וכפתורי הפעולה תמיד בגודל מגע מלא.
 */

const STATUS_FILTERS = [
  { value: undefined, label: 'כל הסטטוסים' },
  { value: 'pending', label: 'ממתין' },
  { value: 'confirmed', label: 'מאושר' },
  { value: 'completed', label: 'הושלם' },
  { value: 'cancelled_by_customer', label: 'בוטל ע"י לקוחה' },
  { value: 'cancelled_by_business', label: 'בוטל ע"י העסק' },
  { value: 'rejected', label: 'נדחתה' },
  { value: 'no_show', label: 'לא הגיעה' },
  { value: 'expired', label: 'פג תוקף' },
] as const

const RANGE_FILTERS: { value: AdminRange | undefined; label: string }[] = [
  { value: 'today', label: 'היום' },
  { value: 'tomorrow', label: 'מחר' },
  { value: 'week', label: 'השבוע' },
  { value: 'upcoming', label: 'עתידיים' },
  { value: 'past', label: 'עבר' },
  { value: undefined, label: 'הכול' },
]

const RANGE_VALUES = RANGE_FILTERS.map(r => r.value)

function buildHref(params: { range?: string; status?: string; q?: string }) {
  const sp = new URLSearchParams()
  if (params.range) sp.set('range', params.range)
  if (params.status) sp.set('status', params.status)
  if (params.q) sp.set('q', params.q)
  const qs = sp.toString()
  return qs ? `/admin/appointments?${qs}` : '/admin/appointments'
}

export default async function AdminAppointmentsPage(
  props: {
    searchParams: Promise<{ page?: string; status?: string; range?: string; q?: string }>
  }
) {
  const searchParams = await props.searchParams
  const page = Math.max(1, Number(searchParams.page) || 1)
  const status = STATUS_FILTERS.some(f => f.value === searchParams.status) ? searchParams.status : undefined
  const range = RANGE_VALUES.includes(searchParams.range as AdminRange)
    ? (searchParams.range as AdminRange)
    : undefined
  const q = (searchParams.q ?? '').trim().slice(0, 80)

  // שאילתה אחת לרשימה ואחת למונים, במקביל. המונים אינם תלויים בסינון
  // הנוכחי במכוון — הם עונים על "מה מחכה לי", לא על "מה מוצג עכשיו".
  const [{ rows, total, pageSize }, counters] = await Promise.all([
    listAppointmentsAdmin({ status, page, range, search: q }),
    countAppointmentsForAdmin(),
  ])

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">התורים</h1>
          <p className="text-sm text-brand-muted">
            {total} תורים בתצוגה הנוכחית
          </p>
        </div>
        <Link
          href="/admin/appointments/new"
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-brand-dark text-white
                     text-sm font-medium hover:bg-brand-dark/90 transition-colors"
        >
          <CalendarPlus className="w-4 h-4" aria-hidden="true" />
          תור חדש
        </Link>
      </div>

      <Counters counters={counters} />

      {/* ── חיפוש ── */}
      <form action="/admin/appointments" method="get" className="mb-4">
        {/*
          הטווח והסטטוס נשמרים כשדות נסתרים: חיפוש אינו אמור לאפס את
          התצוגה שבחרה שובל, ובלעדיהם כל חיפוש היה מחזיר אותה ל"הכול".
        */}
        {range && <input type="hidden" name="range" value={range} />}
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative">
          <Search
            className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="חיפוש לפי שם או טלפון"
            aria-label="חיפוש תור לפי שם לקוחה או טלפון"
            className="w-full h-12 pr-10 pl-3 rounded-xl border border-brand-linen-dark bg-white
                       text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
          />
        </div>
      </form>

      {/* ── טווח ── */}
      <div className="flex flex-wrap gap-2 mb-2.5">
        {RANGE_FILTERS.map(f => (
          <FilterChip
            key={f.label}
            href={buildHref({ range: f.value, status, q })}
            active={range === f.value}
            label={f.label}
            strong
          />
        ))}
      </div>

      {/* ── סטטוס ── */}
      <div className="flex flex-wrap gap-2 mb-6">
        {STATUS_FILTERS.map(f => (
          <FilterChip
            key={f.label}
            href={buildHref({ range, status: f.value, q })}
            active={status === f.value}
            label={f.label}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
          {q
            ? `לא נמצאו תורים התואמים ל"${q}" בתצוגה הזו.`
            : 'לא נמצאו תורים בתצוגה הזו.'}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(appt => <AppointmentCard key={appt.id} appt={appt} />)}
        </div>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/appointments"
        searchParams={{ status, range, q: q || undefined }}
      />
    </div>
  )
}

function FilterChip({
  href, active, label, strong = false,
}: { href: string; active: boolean; label: string; strong?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'text-xs font-semibold px-3.5 py-2 rounded-full border transition-colors',
        active
          ? 'bg-brand-dark text-white border-brand-dark'
          : strong
            ? 'bg-white text-brand-dark border-brand-linen-dark hover:border-brand-rose'
            : 'bg-brand-cream/40 text-brand-muted border-brand-cream-dark hover:border-brand-rose',
      )}
    >
      {label}
    </Link>
  )
}

/**
 * מוני "מה דורש טיפול".
 *
 * 🔒 null אינו 0. ספירה שנכשלה מוצגת כ-"—" ולא כאפס, מאותו טעם בדיוק
 * שבגללו listAppointmentsNeedingAdminAction מבדילה בין "אין" ל"לא ידוע":
 * מונה שמראה 0 על כשל שולח את שובל הביתה עם בקשות פתוחות.
 */
function Counters({
  counters,
}: {
  counters: { pending: number | null; rescheduleRequests: number | null; syncIssues: number | null; today: number | null }
}) {
  const tiles = [
    { label: 'ממתינות לאישור', value: counters.pending, href: '/admin' },
    { label: 'בקשות שינוי מועד', value: counters.rescheduleRequests, href: '/admin' },
    { label: 'סנכרון יומן פתוח', value: counters.syncIssues, href: '/admin' },
    { label: 'תורים היום', value: counters.today, href: '/admin/appointments?range=today' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
      {tiles.map(t => (
        <Link
          key={t.label}
          href={t.href}
          className={cn(
            'bg-white border rounded-2xl p-3.5 transition-colors hover:border-brand-rose',
            t.value ? 'border-brand-gold/50' : 'border-brand-linen-dark',
          )}
        >
          <div className="text-xl font-bold text-brand-dark">{t.value ?? '—'}</div>
          <div className="text-[11px] text-brand-muted leading-tight mt-0.5">{t.label}</div>
        </Link>
      ))}
    </div>
  )
}

function AppointmentCard({ appt }: { appt: AdminAppointmentRow }) {
  const { date, time } = formatDateTimeIL(appt.starts_at)
  const s = STATUS_LABELS[appt.status] ?? { label: appt.status, className: '' }
  const source = appt.booking_source ? BOOKING_SOURCE_LABELS[appt.booking_source] : null
  const isRescheduleRow = Boolean(appt.reschedule_of_appointment_id)

  /*
   * 🔒 הביטול הניהולי מוצג רק לתור **מאושר שטרם התחיל**.
   *
   * ⚠️ שורת בקשת שינוי מועד אינה תור בפני עצמו, וביטולה מכאן היה מבלבל:
   * היא נסגרת ממילא אוטומטית כשהתור המקורי מבוטל, ולדחייתה יש כפתור משלה.
   *
   * ⚠️ זו הסתרה בלבד. ה-RPC (0027) אוכף את שני התנאים בעצמו ואינו סומך
   * על מה שהוצג במסך.
   */
  // Server Component (dynamic = 'force-dynamic' inherited from the (protected)
  // layout): renders exactly once per request, never re-rendered/memoized
  // client-side, so the React Compiler's re-render-idempotency concern for
  // Date.now() does not apply here.
  const canCancel =
    appt.status === 'confirmed' &&
    !isRescheduleRow &&
    // eslint-disable-next-line react-hooks/purity
    new Date(appt.starts_at).getTime() > Date.now()

  /**
   * 🔒 אישור/דחייה — בדיוק אותו רכיב של מסך הבית, ולכן אותה לוגיקת שרת.
   *
   * ⚠️ שורת בקשת שינוי מועד מוחרגת במפורש: אישורה דרך המסלול הרגיל היה
   * מאשר את המועד החדש בלי לשחרר את הישן ובלי למחוק את האירוע שלו (15E).
   * להכרעה בבקשות האלה יש כפתורים משלהן במסך הבית.
   */
  const canApprove = appt.status === 'pending' && !isRescheduleRow

  /** תזכורת ידנית בוואטסאפ — רק לתור מאושר עתידי עם נייד ישראלי תקין */
  const canSendReminder = canCancel && E164_IL_MOBILE.test(appt.customer_phone_e164)

  /**
   * 🔒 (0029) סימון אי-הגעה מוצג לתור **שכבר הסתיים**: completed, או
   * confirmed שה-ends_at שלו עבר. הסתרה בלבד — ה-RPC אוכף את הזכאות בעצמו.
   */
  const canMarkNoShow =
    !isRescheduleRow &&
    (appt.status === 'completed' ||
      // eslint-disable-next-line react-hooks/purity
      (appt.status === 'confirmed' && new Date(appt.ends_at).getTime() <= Date.now()))

  return (
    <div className="bg-white border border-brand-linen-dark rounded-2xl p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/customers/${appt.customer_id}`}
            className="font-bold text-brand-dark text-sm hover:text-brand-rose transition-colors
                       inline-flex items-center gap-1.5"
          >
            <User className="w-3.5 h-3.5 text-brand-muted" aria-hidden="true" />
            {appt.customer_full_name || 'ללא שם'}
          </Link>
          <div className="text-xs text-brand-muted" dir="ltr">
            {formatPhoneForDisplay(appt.customer_phone_e164)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${s.className}`}>
            {s.label}
          </span>
          {isRescheduleRow && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border
                             bg-brand-gold/15 text-brand-gold-text border-brand-gold/40">
              בקשת שינוי מועד
            </span>
          )}
          {source && !isRescheduleRow && (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${source.className}`}>
              {source.label}
            </span>
          )}
        </div>
      </div>

      <p className="text-sm text-brand-dark font-medium mt-2">
        {treatmentLabel(appt)} · {appt.duration_min} דק׳
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted mt-1">
        <span className="text-brand-dark font-medium">{date} · {time}</span>
        <span>{appt.price_total != null ? `₪${appt.price_total}` : 'ללא מחיר'}</span>
      </div>

      {canApprove ? (
        <ApproveRejectButtons appointmentId={appt.id} />
      ) : (
        <div className="flex flex-wrap items-center gap-2 mt-3 empty:mt-0">
          {canCancel && (
            <CancelAppointmentButton
              appointmentId={appt.id}
              customerName={appt.customer_full_name || 'הלקוחה'}
              whenLabel={`${date} בשעה ${time}`}
            />
          )}
          {canMarkNoShow && (
            <MarkNoShowButton
              appointmentId={appt.id}
              customerName={appt.customer_full_name || 'הלקוחה'}
              whenLabel={`${date} בשעה ${time}`}
            />
          )}
          {canSendReminder && (
            <a
              href={buildWhatsAppLinkToCustomer(
                appt.customer_phone_e164,
                buildReminderWhatsAppMessage({
                  treatment: treatmentLabel(appt), date, time,
                }),
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-whatsapp-dark
                         border border-brand-whatsapp-dark/30 hover:bg-brand-whatsapp-dark/10 px-3.5 py-2
                         rounded-full cursor-pointer transition-colors focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-brand-gold"
            >
              <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
              שליחת WhatsApp
            </a>
          )}
        </div>
      )}
    </div>
  )
}
