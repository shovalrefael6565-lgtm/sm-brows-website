import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import PageHero from '@/components/ui/PageHero'
import LogoutButton from '@/components/account/LogoutButton'
import CancelPendingButton from '@/components/account/CancelPendingButton'
import AppointmentActions from '@/components/account/AppointmentActions'
import { getSession } from '@/lib/auth/session'
import { getCustomerById } from '@/lib/db/customers'
import { listAppointmentsForCustomer, type CustomerAppointmentRow } from '@/lib/db/appointments'
import { loadAppointmentPolicy } from '@/lib/db/businessSettings'
import { capabilitiesFor } from '@/lib/appointmentSelfService'
import { type AppointmentPolicy } from '@/lib/appointmentPolicy'
import { formatPhoneForDisplay } from '@/lib/phone'
import { NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS } from '@/lib/services'
import { fmtIsrael, israelDateStr } from '@/lib/israelTime'
import { Calendar, Clock, RefreshCw } from 'lucide-react'

export const metadata: Metadata = {
  title: 'האזור האישי שלי',
  robots: { index: false, follow: false },
}

/**
 * תוויות הסטטוסים בעברית — תואמות ל-appointment_status ב-DB
 * (supabase/migrations/0001_customer_accounts.sql).
 */
const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending:                { label: 'ממתינה לאישור',      className: 'bg-brand-gold/15 text-brand-gold-text border-brand-gold/40' },
  confirmed:              { label: 'מאושר',               className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  completed:              { label: 'הושלם',                className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  cancelled_by_customer:  { label: 'בוטל על ידך',          className: 'bg-red-50 text-red-600 border-red-200' },
  cancelled_by_business:  { label: 'בוטל על ידי העסק',     className: 'bg-red-50 text-red-600 border-red-200' },
  rescheduled:            { label: 'הוזז',                 className: 'bg-blue-50 text-blue-700 border-blue-200' },
  no_show:                { label: 'לא הגעת',              className: 'bg-red-50 text-red-600 border-red-200' },
  expired:                { label: 'תוקף הבקשה פג',        className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
}

/** תורים שנחשבים "קרובים" — לא הגיעו עדיין לסטטוס סופי */
const ACTIVE_STATUSES = new Set(['pending', 'confirmed'])

function treatmentLabel(appt: CustomerAppointmentRow): string {
  if (appt.service_key === NATURAL_SERVICE) {
    const labels = NATURAL_VARIANTS.filter(v => appt.variants.includes(v.id)).map(v => v.label)
    return labels.length > 0 ? labels.join(' + ') : NATURAL_SERVICE
  }
  if (appt.service_key === LIFTING_SERVICE) return LIFTING_SERVICE
  return appt.service_key
}

function formatDateTimeIL(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return { date, time }
}

interface CardProps {
  appt: CustomerAppointmentRow
  /** null כשלא ניתן היה לטעון מדיניות — אז לא מוצגים כפתורי פעולה כלל */
  policy: AppointmentPolicy | null
}

function AppointmentCard({ appt, policy }: CardProps) {
  const { date, time } = formatDateTimeIL(appt.starts_at)
  const status = STATUS_LABELS[appt.status] ?? { label: appt.status, className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' }

  // כפתורי ניהול עצמי — רק לתור מאושר שטרם התחיל, ורק כשהמדיניות נטענה.
  // pending ממשיך לקבל את כפתור ביטול הבקשה הקיים משלב 4.
  const isFuture = new Date(appt.starts_at).getTime() > Date.now()
  const canSelfManage = appt.status === 'confirmed' && isFuture && policy !== null
  const capabilities = canSelfManage && policy ? capabilitiesFor(appt, policy) : null

  // אירוע יומן שעדיין לא סונכרן — הלקוחה צריכה לדעת שהמערכת מודעת לזה
  const syncPending =
    appt.status === 'confirmed' &&
    ['pending', 'failed', 'syncing'].includes(appt.calendar_sync_status)

  return (
    <div className="bg-white border border-brand-linen-dark rounded-2xl p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-bold text-brand-dark text-sm">{treatmentLabel(appt)}</h3>
        <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${status.className}`}>
          {status.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted">
        <span className="inline-flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-brand-rose" aria-hidden="true" />
          {date}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-brand-rose" aria-hidden="true" />
          {time} · {appt.duration_min} דק׳
        </span>
        {appt.price_total != null && (
          <span className="font-semibold text-brand-dark">₪{appt.price_total}</span>
        )}
      </div>

      {syncPending && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-brand-gold-text">
          <RefreshCw className="w-3 h-3" aria-hidden="true" />
          הסנכרון ליומן נמצא בטיפול. התור שמור במערכת.
        </p>
      )}

      {appt.status === 'pending' && <CancelPendingButton appointmentId={appt.id} />}

      {capabilities && policy && (
        <AppointmentActions
          appointmentId={appt.id}
          currentStartsAt={appt.starts_at}
          whenLabel={`${date} בשעה ${time}`}
          treatment={treatmentLabel(appt)}
          durationMin={appt.duration_min}
          ownBusy={{
            isoDate: israelDateStr(new Date(appt.starts_at)),
            start: fmtIsrael(new Date(appt.starts_at)),
            end: fmtIsrael(new Date(appt.ends_at)),
          }}
          reschedule={{ allowed: capabilities.reschedule.allowed, message: capabilities.reschedule.message }}
          cancel={{ allowed: capabilities.cancel.allowed, message: capabilities.cancel.message }}
          cancelPolicyNote={`לפי המדיניות ניתן לבטל עד ${policy.cancelCutoffHours} שעות לפני מועד התור.`}
          rescheduleCount={capabilities.rescheduleCount}
          maxReschedules={capabilities.maxReschedules}
        />
      )}
    </div>
  )
}

/**
 * האזור האישי — התורים והפרטים של הלקוחה המחוברת.
 *
 * משלב 7 אפשר גם לשנות מועד ולבטל תור מאושר. מה שמוצג מחושב כאן, בשרת,
 * מול המדיניות ב-business_settings ולפי שעון ישראל — אבל זו הצגה בלבד:
 * כל פעולה נבדקת שוב במלואה ב-API וב-RPC (ראה lib/appointmentSelfService.ts).
 */
export default async function AccountPage() {
  const session = await getSession()
  if (!session?.customerId) redirect('/login')

  // הנתונים נשלפים לפי המזהה מה-session בלבד — לעולם לא מפרמטר ב-URL
  const customer = await getCustomerById(session.customerId)
  if (!customer) redirect('/login')

  const [appointments, policyResult] = await Promise.all([
    listAppointmentsForCustomer(customer.id),
    loadAppointmentPolicy(),
  ])

  // כשל בטעינת המדיניות → אין כפתורי פעולה בכלל. עדיף להסתיר מאשר להציג
  // כפתור שנשען על מדיניות שלא באמת נקראה (ראה lib/db/businessSettings.ts).
  const policy = policyResult.ok ? policyResult.policy : null

  const upcoming = appointments.filter(a => ACTIVE_STATUSES.has(a.status))
  const history = appointments.filter(a => !ACTIVE_STATUSES.has(a.status))

  return (
    <>
      <PageHero tag="אזור אישי" title="שלום," titleHighlight={customer.full_name} />
      <section className="py-14 sm:py-20 px-4 sm:px-6">
        <div className="w-full max-w-md mx-auto space-y-8">
          <div>
            <h2 className="font-serif text-xl font-bold text-brand-dark mb-4">התורים הקרובים שלך</h2>
            {upcoming.length === 0 ? (
              <div className="bg-brand-rose-bg border border-brand-rose-light rounded-2xl p-5 text-sm text-brand-medium leading-relaxed">
                אין לך כרגע תורים ממתינים או מאושרים. ניתן לקבוע תור חדש דרך עמוד קביעת התור.
              </div>
            ) : (
              <div className="space-y-3">
                {upcoming.map(a => <AppointmentCard key={a.id} appt={a} policy={policy} />)}
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div>
              <h2 className="font-serif text-xl font-bold text-brand-dark mb-4">היסטוריית תורים</h2>
              <div className="space-y-3">
                {history.map(a => <AppointmentCard key={a.id} appt={a} policy={policy} />)}
              </div>
            </div>
          )}

          <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 shadow-soft">
            <h2 className="font-serif text-xl font-bold text-brand-dark mb-4">הפרטים שלך</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-brand-muted">שם</dt>
                <dd className="text-brand-dark font-medium">{customer.full_name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-brand-muted">טלפון</dt>
                <dd className="text-brand-dark font-medium" dir="ltr">
                  {formatPhoneForDisplay(customer.phone_e164)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="text-center">
            <LogoutButton />
          </div>
        </div>
      </section>
    </>
  )
}
