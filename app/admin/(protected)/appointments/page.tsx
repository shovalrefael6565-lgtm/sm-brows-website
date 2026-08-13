import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import { listAppointmentsAdmin } from '@/lib/db/appointments'
import { formatPhoneForDisplay, E164_IL_MOBILE } from '@/lib/phone'
import { formatDateTimeIL, treatmentLabel, STATUS_LABELS } from '@/lib/admin/format'
import { buildReminderWhatsAppMessage, buildWhatsAppLinkToCustomer } from '@/lib/whatsappTemplates'
import Pagination from '@/components/admin/Pagination'
import CancelAppointmentButton from '@/components/admin/CancelAppointmentButton'
import MarkNoShowButton from '@/components/admin/MarkNoShowButton'
import { cn } from '@/lib/utils'

/**
 * ⚠️ 'rejected' הוא פילטר **נפרד** מ-'cancelled_by_business' ולא מיזוג
 * שלו: דחיית בקשה שלא אושרה וביטול תור מאושר הן שתי עובדות עסקיות שונות
 * (0019). מיזוגן לפילטר אחד היה מבטל את מטרת ההפרדה.
 */
const STATUS_FILTERS = [
  { value: undefined, label: 'הכול' },
  { value: 'pending', label: 'ממתין' },
  { value: 'confirmed', label: 'מאושר' },
  { value: 'completed', label: 'הושלם' },
  { value: 'cancelled_by_customer', label: 'בוטל ע"י לקוחה' },
  { value: 'cancelled_by_business', label: 'בוטל ע"י העסק' },
  { value: 'rejected', label: 'נדחתה' },
  { value: 'no_show', label: 'לא הגיעה' },
  { value: 'expired', label: 'פג תוקף' },
] as const

/** כל התורים במערכת, לצפייה בלבד, עם סינון סטטוס ודפדוף */
export default async function AdminAppointmentsPage({
  searchParams,
}: {
  searchParams: { page?: string; status?: string }
}) {
  const page = Math.max(1, Number(searchParams.page) || 1)
  const status = STATUS_FILTERS.some(f => f.value === searchParams.status) ? searchParams.status : undefined

  const { rows, total, pageSize } = await listAppointmentsAdmin({ status, page })

  return (
    <div>
      <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">כל התורים</h1>
      <p className="text-sm text-brand-muted mb-6">{total} תורים</p>

      <div className="flex flex-wrap gap-2 mb-6">
        {STATUS_FILTERS.map(f => (
          <Link
            key={f.label}
            href={f.value ? `/admin/appointments?status=${f.value}` : '/admin/appointments'}
            className={cn(
              'text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors',
              status === f.value
                ? 'bg-brand-dark text-white border-brand-dark'
                : 'bg-white text-brand-dark border-brand-linen-dark hover:border-brand-rose',
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-brand-linen-dark rounded-2xl p-6 text-sm text-brand-muted">
          לא נמצאו תורים.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-right text-xs text-brand-muted border-b border-brand-linen-dark">
                <th className="px-4 sm:px-2 py-2 font-medium">לקוחה</th>
                <th className="px-2 py-2 font-medium">טיפול</th>
                <th className="px-2 py-2 font-medium">תאריך ושעה</th>
                <th className="px-2 py-2 font-medium">סטטוס</th>
                <th className="px-2 py-2 font-medium">מחיר</th>
                <th className="px-2 py-2 font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(appt => {
                const { date, time } = formatDateTimeIL(appt.starts_at)
                const s = STATUS_LABELS[appt.status] ?? { label: appt.status, className: '' }
                /*
                 * 🔒 15H — הביטול הניהולי מוצג רק לתור **מאושר שטרם התחיל**.
                 *
                 * ⚠️ שורת בקשת שינוי מועד (reschedule_of_appointment_id) אינה
                 * תור בפני עצמו, וביטולה מכאן היה מבלבל: היא נסגרת ממילא
                 * אוטומטית כשהתור המקורי מבוטל, ולדחייתה יש כפתור משלה.
                 *
                 * ⚠️ זו הסתרה בלבד. ה-RPC (0027) אוכף את שני התנאים בעצמו
                 * ואינו סומך על מה שהוצג במסך.
                 */
                const canCancel =
                  appt.status === 'confirmed' &&
                  !appt.reschedule_of_appointment_id &&
                  new Date(appt.starts_at).getTime() > Date.now()

                /**
                 * 🔒 כפתור "שליחת WhatsApp" — תזכורת ידנית, לא אוטומטית.
                 *
                 * ⚠️ אותם שני תנאים בדיוק כמו canCancel (confirmed, לא
                 * שורת בקשת שינוי מועד, עתידי) ובנוסף בדיקת טלפון: מספר
                 * שאינו נייד ישראלי תקין אינו יכול לפתוח שיחת WhatsApp
                 * בכלל. אין כאן שום כתיבה ל-DB — הקישור רק פותח חלון
                 * WhatsApp עם טקסט מוכן; שובל לוחצת "שליחה" בעצמה.
                 */
                const canSendReminder =
                  canCancel && E164_IL_MOBILE.test(appt.customer_phone_e164)

                /**
                 * 🔒 שלב 16 (0029) — סימון אי-הגעה מוצג לתור **שכבר הסתיים**:
                 * completed (הסימון האוטומטי כבר קרה), או confirmed שה-
                 * ends_at שלו עבר (ה-sweep עדיין לא הגיע לשורה — אין לחסום
                 * את שובל בגלל תזמון).
                 *
                 * ⚠️ זו הסתרה בלבד. ה-RPC (0029) אוכף את הזכאות בעצמו ואינו
                 * סומך על מה שהוצג במסך — בדיוק כמו canCancel.
                 */
                const canMarkNoShow =
                  !appt.reschedule_of_appointment_id &&
                  (appt.status === 'completed' ||
                    (appt.status === 'confirmed' && new Date(appt.ends_at).getTime() <= Date.now()))
                return (
                  <tr key={appt.id} className="border-b border-brand-linen-dark/60">
                    <td className="px-4 sm:px-2 py-3">
                      <div className="font-medium text-brand-dark">{appt.customer_full_name || 'ללא שם'}</div>
                      <div className="text-xs text-brand-muted" dir="ltr">
                        {formatPhoneForDisplay(appt.customer_phone_e164)}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-brand-dark">{treatmentLabel(appt)}</td>
                    <td className="px-2 py-3 text-brand-muted whitespace-nowrap">{date} · {time}</td>
                    <td className="px-2 py-3">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${s.className}`}>
                        {s.label}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-brand-dark font-medium">
                      {appt.price_total != null ? `₪${appt.price_total}` : '—'}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap items-center gap-2">
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
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#25D366]
                                       border border-[#25D366]/30 hover:bg-[#25D366]/10 px-3.5 py-1.5
                                       rounded-full cursor-pointer transition-colors focus-visible:outline-none
                                       focus-visible:ring-2 focus-visible:ring-brand-gold"
                          >
                            <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                            שליחת WhatsApp
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/appointments"
        searchParams={{ status }}
      />
    </div>
  )
}
