import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, MessageCircle, CalendarPlus } from 'lucide-react'
import {
  getCrmCustomer, listCustomerNotes, listCrmActivity, listCrmSources,
  listCustomerAppointments, listAppointmentHistory,
} from '@/lib/db/crm'
import { formatPhoneForDisplay } from '@/lib/phone'
import { buildWhatsAppLinkPlain } from '@/lib/whatsappTemplates'
import {
  CRM_STATUS_LABELS, CRM_ACTION_LABELS, formatDateTimeIL, treatmentLabel,
} from '@/lib/admin/format'
import CrmControls from '@/components/admin/CrmControls'
import CustomerNotes from '@/components/admin/CustomerNotes'
import CustomerAdminControls from '@/components/admin/CustomerAdminControls'
import CustomerTimeline, { type TimelineAppointment } from '@/components/admin/CustomerTimeline'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * פרופיל לקוחה.
 *
 * getCrmCustomer מחזירה null גם כשהמזהה אינו קיים וגם כשהוא חשבון מנהל
 * (שובל/רפאל), ושניהם מתורגמים לאותו 404 — כדי לא להסגיר שחשבון מנהל קיים.
 */
export default async function CustomerProfilePage({
  params,
  searchParams,
}: {
  params: { customerId: string }
  searchParams: Record<string, string | undefined>
}) {
  if (!UUID_RE.test(params.customerId)) notFound()

  const customer = await getCrmCustomer(params.customerId)
  if (!customer) notFound()

  const [notes, activity, sources, appointments] = await Promise.all([
    listCustomerNotes(customer.id),
    listCrmActivity(customer.id),
    listCrmSources(),
    listCustomerAppointments(customer.id),
  ])

  // ההיסטוריה של כל תור. מספר התורים ללקוחה בודדת קטן מטבעו, ולכן
  // Promise.all כאן הוא קבוצה אחת של שאילתות מקבילות — לא N+1 ברשימה.
  const history = await Promise.all(
    appointments.map(a => listAppointmentHistory(a.id)),
  )
  const timeline: TimelineAppointment[] = appointments.map((a, i) => ({
    ...a,
    history: history[i],
  }))

  const sourceLabel = sources.find(s => s.key === customer.source_key)?.label_he ?? customer.source_key
  const status = CRM_STATUS_LABELS[customer.crm_status] ?? CRM_STATUS_LABELS.active

  // שימור הפילטרים בחזרה לרשימה
  const backParams = new URLSearchParams()
  for (const k of ['q', 'filter', 'sort', 'source', 'page'] as const) {
    if (searchParams[k]) backParams.set(k, searchParams[k]!)
  }
  const backHref = backParams.toString()
    ? `/admin/customers?${backParams.toString()}`
    : '/admin/customers'

  const services = summarizeServices(timeline)

  return (
    <div className="space-y-10">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-dark"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
        חזרה לרשימת הלקוחות
      </Link>

      {/* 1. כותרת ופרטי קשר */}
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">
              {customer.full_name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-brand-muted">
              <span dir="ltr">{formatPhoneForDisplay(customer.phone_e164)}</span>
              <span>·</span>
              <span>הצטרפה {formatDateTimeIL(customer.created_at).date}</span>
              <span>·</span>
              <span>{sourceLabel}</span>
              <span>·</span>
              {/* ערך אמיתי מ-customers.auth_user_id (שלב 10) ולא הנחה.
                  לקוחה שנוצרה ידנית ב-CRM קיימת בלי חשבון עד שתתחבר
                  בעצמה עם OTP, ואז החשבון נקשר לשורה הזו. */}
              <span className={customer.has_login_account ? undefined : 'text-brand-gold-text'}>
                {customer.has_login_account ? 'יש חשבון התחברות' : 'ללא חשבון התחברות'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${status.className}`}>
              {status.label}
            </span>
            {/* הלקוחה כבר נבחרת מראש בטופס — אין צורך לחפש אותה שוב */}
            <Link
              href={`/admin/appointments/new?customerId=${customer.id}`}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-dark
                         text-white text-sm font-medium hover:bg-brand-dark/90 transition-colors"
            >
              <CalendarPlus className="w-4 h-4" aria-hidden="true" />
              יצירת תור
            </Link>
            {/* נפתח אך ורק בלחיצה, בלי טקסט מוכן ובלי רישום כאילו נשלחה הודעה */}
            <a
              href={buildWhatsAppLinkPlain(customer.phone_e164)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-emerald-600
                         text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
              WhatsApp
            </a>
          </div>
        </div>

        <CrmControls
          customerId={customer.id}
          crmStatus={customer.crm_status}
          sourceKey={customer.source_key}
          sources={sources}
        />

        {/*
          🔒 15H — עריכה, ארכיון ומחיקה.
          המחיקה נחסמת ב-DB לכל לקוחה שיש לה ולו תור אחד (on delete
          restrict + delete_customer_if_safe), ולכן הכפתור כאן אינו מסתמך
          על מה שמוצג במסך.
        */}
        <CustomerAdminControls
          customerId={customer.id}
          fullName={customer.full_name}
          phone={customer.phone_e164}
          hasLoginAccount={customer.has_login_account}
          archivedAt={customer.archived_at}
        />
      </section>

      {/* 2. התור הבא */}
      <section>
        <h2 className="font-serif text-xl font-bold text-brand-dark mb-3">התור הבא</h2>
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-5">
          {customer.next_confirmed_starts_at ? (
            <>
              <div className="font-medium text-brand-dark">
                {formatDateTimeIL(customer.next_confirmed_starts_at).date},{' '}
                {formatDateTimeIL(customer.next_confirmed_starts_at).time}
              </div>
              <div className="text-sm text-brand-muted mt-0.5">
                {treatmentLabel({
                  service_key: customer.next_confirmed_service_key ?? '',
                  variants: customer.next_confirmed_variants ?? [],
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-brand-muted">אין תור מאושר עתידי.</p>
          )}

          {/* בקשה ממתינה מוצגת בנפרד — pending אינו תור מאושר */}
          {customer.active_pending_count > 0 && (
            <p className="text-sm text-brand-gold-text mt-3 pt-3 border-t border-brand-linen-dark">
              {customer.active_pending_count === 1
                ? 'קיימת בקשה אחת שממתינה לאישור.'
                : `קיימות ${customer.active_pending_count} בקשות שממתינות לאישור.`}
            </p>
          )}
        </div>
      </section>

      {/* 3. כרטיסי נתונים */}
      <section>
        <h2 className="font-serif text-xl font-bold text-brand-dark mb-3">נתונים</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="טיפולים שהושלמו" value={customer.completed_count} />
          <Stat
            label="טיפול אחרון"
            value={customer.last_completed_at ? formatDateTimeIL(customer.last_completed_at).date : '—'}
          />
          <Stat label="ביטולים מצד הלקוחה" value={customer.cancelled_by_customer_count} />
          <Stat label="ביטולים מצד העסק" value={customer.cancelled_by_business_count} />
          <Stat label="אי-הגעה" value={customer.no_show_count} />
          <Stat label="הזזות עצמיות" value={customer.self_reschedule_total} />
          <Stat label="כלל שינויי המועד" value={customer.all_reschedule_events} />
          <Stat
            label="פעילות אחרונה"
            value={formatDateTimeIL(customer.last_activity_at).date}
          />
        </div>
      </section>

      {/* 4. הערות פנימיות */}
      <CustomerNotes customerId={customer.id} notes={notes} />

      {/* 5. היסטוריית תורים */}
      <section>
        <h2 className="font-serif text-xl font-bold text-brand-dark mb-3">היסטוריית תורים</h2>
        <CustomerTimeline appointments={timeline} />
      </section>

      {/* שירותים */}
      {services.length > 0 && (
        <section>
          <h2 className="font-serif text-xl font-bold text-brand-dark mb-3">שירותים</h2>
          <ul className="bg-white border border-brand-linen-dark rounded-2xl divide-y divide-brand-linen-dark">
            {services.map(s => (
              <li key={s.label} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-brand-dark">{s.label}</span>
                <span className="text-xs text-brand-muted">
                  {s.count === 1 ? 'פעם אחת' : `${s.count} פעמים`} · אחרון{' '}
                  {formatDateTimeIL(s.lastAt).date}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6. פעילות CRM */}
      <section>
        <h2 className="font-serif text-xl font-bold text-brand-dark mb-3">פעילות CRM</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-brand-muted">אין עדיין פעילות.</p>
        ) : (
          <ol className="bg-white border border-brand-linen-dark rounded-2xl divide-y divide-brand-linen-dark">
            {activity.map(a => (
              <li key={a.id} className="px-4 py-3 text-sm flex flex-wrap items-baseline gap-x-2">
                <span className="text-brand-dark">{CRM_ACTION_LABELS[a.action] ?? a.action}</span>
                {a.old_value && a.new_value && (
                  <span className="text-xs text-brand-muted">
                    {crmValueLabel(a.action, a.old_value, sources)}
                    {' ← '}
                    {crmValueLabel(a.action, a.new_value, sources)}
                  </span>
                )}
                <span className="text-xs text-brand-muted mr-auto">
                  {formatDateTimeIL(a.created_at).date}, {formatDateTimeIL(a.created_at).time}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/**
 * ערכי ה-old_value/new_value ב-activity נשמרים כמפתחות גולמיים ('active',
 * 'instagram') — זה נכון לאודיט, אבל למנהלת צריך להציג את אותה תווית עברית
 * שהיא רואה בפקדים עצמם, ומאותו מקור אמת.
 */
function crmValueLabel(
  action: string,
  value: string,
  sources: { key: string; label_he: string }[],
): string {
  if (action === 'crm_status_changed') return CRM_STATUS_LABELS[value]?.label ?? value
  if (action === 'source_changed') return sources.find(s => s.key === value)?.label_he ?? value
  return value
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-brand-linen-dark rounded-xl p-4">
      <div className="text-xs text-brand-muted mb-1">{label}</div>
      <div className="text-lg font-medium text-brand-dark">{value}</div>
    </div>
  )
}

/**
 * פילוח השירותים שהלקוחה קיבלה בפועל. השם מגיע מ-treatmentLabel, שנשען על
 * lib/services.ts — מקור האמת הקיים. אין המצאת שם שירות מטקסט חופשי.
 * נספרים תורים שהושלמו בלבד.
 */
function summarizeServices(appointments: TimelineAppointment[]) {
  const map = new Map<string, { label: string; count: number; lastAt: string }>()

  for (const a of appointments) {
    if (a.status !== 'completed') continue
    const label = treatmentLabel({ service_key: a.service_key, variants: a.variants })
    const cur = map.get(label)
    if (!cur) {
      map.set(label, { label, count: 1, lastAt: a.starts_at })
    } else {
      cur.count += 1
      if (a.starts_at > cur.lastAt) cur.lastAt = a.starts_at
    }
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}
