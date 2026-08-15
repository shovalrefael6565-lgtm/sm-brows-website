import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import PageHero from '@/components/ui/PageHero'
import LogoutButton from '@/components/account/LogoutButton'
import CancelPendingButton from '@/components/account/CancelPendingButton'
import AppointmentActions from '@/components/account/AppointmentActions'
import AccountBookingForm from '@/components/account/AccountBookingForm'
import CompleteProfileForm from '@/components/account/CompleteProfileForm'
import AddToCalendarButtons from '@/components/account/AddToCalendarButtons'
import { getCurrentCustomer } from '@/lib/auth/currentCustomer'
import { needsNameCompletion } from '@/lib/customerProfile'
import { listAppointmentsForCustomer, type CustomerAppointmentRow } from '@/lib/db/appointments'
import { loadAppointmentPolicy } from '@/lib/db/businessSettings'
import { capabilitiesFor } from '@/lib/appointmentSelfService'
import { type AppointmentPolicy } from '@/lib/appointmentPolicy'
import { formatPhoneForDisplay } from '@/lib/phone'
import { NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS } from '@/lib/services'
import { Calendar, Clock, RefreshCw, CalendarClock } from 'lucide-react'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'

export const metadata: Metadata = {
  title: 'האזור האישי שלי',
  robots: { index: false, follow: false },
}

// 🔒 שלב 2 (מידע פרטי) — מוצהר במפורש, בלי תלות בזיהוי אוטומטי של cookies().
export const dynamic = 'force-dynamic'

/**
 * תוויות הסטטוסים בעברית — תואמות ל-appointment_status ב-DB
 * (supabase/migrations/0001_customer_accounts.sql, + 'expired' ב-0002,
 * + 'rejected' ב-0016 שנכנס לשימוש ב-0019).
 */
const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending:                { label: 'ממתינה לאישור',      className: 'bg-brand-gold/15 text-brand-gold-text border-brand-gold/40' },
  confirmed:              { label: 'מאושר',               className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  completed:              { label: 'הושלם',                className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  cancelled_by_customer:  { label: 'בוטל על ידך',          className: 'bg-red-50 text-red-600 border-red-200' },
  cancelled_by_business:  { label: 'בוטל על ידי העסק',     className: 'bg-red-50 text-red-600 border-red-200' },
  rejected:               { label: 'הבקשה נדחתה',          className: 'bg-red-50 text-red-600 border-red-200' },
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
  /**
   * 🔒 15E — בקשת שינוי מועד פתוחה שמצביעה על התור הזה, אם קיימת.
   * נוכחותה משנה גם את הכפתורים וגם את מה שהלקוחה קוראת.
   */
  openRequest?: CustomerAppointmentRow
}

function AppointmentCard({ appt, policy, openRequest }: CardProps) {
  const { date, time } = formatDateTimeIL(appt.starts_at)
  const status = STATUS_LABELS[appt.status] ?? { label: appt.status, className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' }

  // כפתורי ניהול עצמי — רק לתור מאושר שטרם התחיל, ורק כשהמדיניות נטענה.
  // pending ממשיך לקבל את כפתור ביטול הבקשה הקיים משלב 4.
  const isFuture = new Date(appt.starts_at).getTime() > Date.now()
  const canSelfManage = appt.status === 'confirmed' && isFuture && policy !== null
  const capabilities = canSelfManage && policy
    ? capabilitiesFor(appt, policy, new Date(), Boolean(openRequest))
    : null

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

      {/*
        🔒 15E — בקשת שינוי מועד פתוchה. הניסוח כאן הוא העיקר: הלקוחה
        חייבת להבין ששני הדברים נכונים בו-זמנית — התור הזה **עדיין שלה**,
        והבקשה עדיין לא אושרה.
      */}
      {openRequest && (
        <div className="mt-3 bg-brand-gold/10 border border-brand-gold/40 rounded-xl p-3">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-gold-text">
            <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
            נשלחה בקשת שינוי מועד
          </p>
          <p className="mt-1 text-[11px] text-brand-medium leading-relaxed">
            המועד המבוקש: {formatDateTimeIL(openRequest.starts_at).date} בשעה{' '}
            {formatDateTimeIL(openRequest.starts_at).time}.
            <br />
            <strong className="font-bold text-brand-dark">התור הנוכחי שלך נשאר שמור</strong> עד
            ששובל תאשר. אם הבקשה לא תאושר, התור יישאר כפי שהוא.
          </p>
        </div>
      )}

      {/*
        🔒 15H — "הוספה ליומן" מוצג אך ורק ל-confirmed.
        pending עדיין אינו תור, ו-cancelled/rejected אינם תור יותר — קובץ
        יומן עבורם היה שותל במכשיר הלקוחה אירוע שלא יתקיים. ה-route של
        ה-.ics אוכף את אותו תנאי בעצמו ואינו סומך על הבדיקה הזו.
      */}
      {appt.status === 'confirmed' && (
        <AddToCalendarButtons
          appointmentId={appt.id}
          treatment={treatmentLabel(appt)}
          startsAt={appt.starts_at}
          durationMin={appt.duration_min}
        />
      )}

      {appt.status === 'pending' && <CancelPendingButton appointmentId={appt.id} />}

      {capabilities && policy && (
        <AppointmentActions
          appointmentId={appt.id}
          whenLabel={`${date} בשעה ${time}`}
          treatment={treatmentLabel(appt)}
          durationMin={appt.duration_min}
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
  /*
   * 🔒 שלב 13 — הדגל חוסם לפני כל קריאה למסד.
   *
   * ⚠️ 404 ולא redirect ל-/login: הדגל כבוי הופך גם את `/login` ל-404,
   * ו-redirect לשם היה מייצר שרשרת שמסתיימת באותו 404 אחרי נסיעה מיותרת.
   * מבחינת הלקוחה האזור האישי פשוט אינו קיים — וזה בדיוק המצב.
   *
   * ⚠️ session שנוצר לפני שהדגל כובה נשאר חתום ותקף, אבל מגיע לכאן ל-404.
   * ה-cookie אינו נמחק — `POST /api/auth/logout` נשאר פתוח בכוונה, כדי
   * שיהיה מסלול יציאה נקי גם כשהמערכת כבויה.
   */
  if (!isNewBookingSystemEnabled()) notFound()

  // הלקוחה מוכחת מחדש מול customers.auth_user_id בכל טעינה — לא נגזרת
  // מה-auth user id ולא נלקחת מפרמטר ב-URL (lib/auth/currentCustomer.ts).
  // שאילתה אחת מחזירה את השורה המלאה — אין צורך בבדיקת מזהה נפרדת ואז
  // getCustomerById על אותה שורה.
  const customer = await getCurrentCustomer()
  if (!customer) redirect('/login')

  /*
   * 🔒 15H — שער השלמת השם.
   *
   * לקוחה שנכנסה דרך `/login` בלי שהזינה שם מעולם נשמרה עם ה-placeholder
   * `'לקוחה'` (0010:414), וכל מה שהמערכת שולחת עליה — SMS, כותרת האירוע
   * ביומן, כרטיס ה-CRM — נושא את המילה הזו. כאן מבקשים שם אמיתי, פעם אחת.
   *
   * ⚠️ השער חוסם את שאר העמוד **בכוונה**: טופס שאפשר לגלול מעליו לא היה
   * מתמלא לעולם, וזו ההזדמנות היחידה שבה הלקוחה נמצאת מול המסך ומחוברת.
   *
   * ⚠️ התורים **אינם** נטענים כשהשער פתוח — אין סיבה לשאילתות שאיש לא
   * יראה את תוצאתן.
   *
   * ⚠️ needsNameCompletion מזהה **רשימה סגורה** של ערכים שהמערכת עצמה
   * כתבה. שם של מילה אחת שהלקוחה הקלידה בעצמה אינו placeholder ואינו
   * מוביל לכאן — ראה ההסבר המלא ב-lib/customerProfile.ts.
   */
  if (needsNameCompletion(customer.full_name)) {
    return (
      <>
        <PageHero tag="אזור אישי" title="ברוכה הבאה" />
        <section className="py-14 sm:py-20 px-4 sm:px-6">
          <div className="w-full max-w-md mx-auto space-y-8">
            <CompleteProfileForm />
            <div className="text-center">
              <LogoutButton />
            </div>
          </div>
        </section>
      </>
    )
  }

  const [appointments, policyResult] = await Promise.all([
    listAppointmentsForCustomer(customer.id),
    loadAppointmentPolicy(),
  ])

  // כשל בטעינת המדיניות → אין כפתורי פעולה בכלל. עדיף להסתיר מאשר להציג
  // כפתור שנשען על מדיניות שלא באמת נקראה (ראה lib/db/businessSettings.ts).
  const policy = policyResult.ok ? policyResult.policy : null

  /*
   * 🔒 15E — שורת בקשת שינוי מועד היא שורת appointments לכל דבר, אבל
   * **אינה תור בפני עצמו**. אסור להציג אותה ככרטיס נפרד: הלקוחה הייתה
   * רואה שני תורים ולא מבינה איזה מהם תקף. במקום זה היא מוצמדת לתור
   * המקורי כהודעה, וה-map כאן הוא מה שמחבר ביניהם.
   *
   * ⚠️ רק בקשה **פתוחה** (pending) נחשבת. בקשה שנדחתה או פגה אינה משנה
   * דבר בתור המקורי, ומקומה בהיסטוריה בלבד.
   */
  const openRequestByOriginal = new Map<string, CustomerAppointmentRow>()
  for (const a of appointments) {
    if (a.reschedule_of_appointment_id && a.status === 'pending') {
      openRequestByOriginal.set(a.reschedule_of_appointment_id, a)
    }
  }

  /*
   * ⚠️ התנאי הוא `status === 'pending'` ולא רק "יש reschedule_of":
   * בקשה **שאושרה** הופכת ל-confirmed אבל **שומרת** את
   * reschedule_of_appointment_id לתמיד. סינון לפי הקישור בלבד היה מעלים
   * מהאזור האישי בדיוק את התור הפעיל של הלקוחה — כלומר "לאבד" אותו
   * מבחינתה — וזה ההפך הגמור ממה ש-15E בא להבטיח.
   */
  const upcoming = appointments.filter(
    a => ACTIVE_STATUSES.has(a.status) &&
      !(a.reschedule_of_appointment_id && a.status === 'pending'),
  )
  // בהיסטוריה מוצגות גם שורות בקשה שהוכרעו (rejected/expired) — תיעוד
  // אמיתי של מה שקרה, ולכן אין סיבה להסתיר אותן.
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
                אין לך כרגע תורים ממתינים או מאושרים.
              </div>
            ) : (
              <div className="space-y-3">
                {upcoming.map(a => (
                  <AppointmentCard
                    key={a.id}
                    appt={a}
                    policy={policy}
                    openRequest={openRequestByOriginal.get(a.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/*
            🔒 שלב 15D — קביעת תור מתוך האזור האישי.
            הזהות נקבעת בשרת מ-getCurrentCustomerId; הטופס אינו שולח טלפון
            ואינו יכול לקבוע תור עבור לקוחה אחרת. הזמינות מגיעה מאותו
            /api/bookings/slots ומאותו lib/slotSelection.ts כמו /booking.
          */}
          <AccountBookingForm />

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
