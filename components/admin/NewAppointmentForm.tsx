'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle, AlertTriangle, CalendarPlus } from 'lucide-react'
import CustomerPicker, { type PickedCustomer } from '@/components/admin/CustomerPicker'
import {
  NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS,
  ADMIN_ONLY_SERVICES, ADMIN_MIN_DURATION_MIN, ADMIN_MAX_DURATION_MIN,
  adminOnlyService, isAdminOnlyService,
} from '@/lib/services'

/**
 * יצירת תור ידני.
 *
 * ⚠️ הטופס שולח **רק** בחירות: לקוחה, טיפול, תוספות, תאריך ושעה. המשך
 * והמחיר המוצגים כאן מגיעים מהשרת (בדיקת הזמינות) ואינם נשלחים חזרה —
 * השרת מחשב אותם שוב מהקטלוג בעת היצירה.
 *
 * ⚠️ client_request_id נוצר פעם אחת לכל ניסיון ונשלח שוב בכל retry. הוא
 * מתחדש רק אחרי יצירה מוצלחת.
 *
 * חריגה משעות הפעילות או יום סגור מציגה אזהרה שדורשת אישור מודע — היא
 * אינה חוסמת. חפיפה עם תור קיים או עם אירוע ביומן **כן** חוסמת.
 */

interface AdoptableEvent {
  eventId: string
  summary: string
  start: string
  end: string
}

interface Availability {
  durationMin: number
  priceTotal: number | null
  available: boolean
  reason: string | null
  /** פרטי האירוע החוסם ביומן, רק כשהוא ניתן לאימוץ (שלב 12) */
  adoptable: AdoptableEvent | null
  warnings: { outsideBusinessHours: boolean; closedDay: boolean }
}

function eventTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

const REASON_LABELS: Record<string, string> = {
  past:                 'המועד כבר עבר.',
  db_conflict:          'קיים תור אחר במועד הזה.',
  calendar_conflict:    'קיים אירוע ביומן Google במועד הזה.',
  calendar_unavailable: 'לא הצלחנו לבדוק את היומן כרגע.',
}

export default function NewAppointmentForm({ initialCustomer }: { initialCustomer: PickedCustomer | null }) {
  const router = useRouter()

  const [customer, setCustomer] = useState<PickedCustomer | null>(initialCustomer)
  const [serviceKey, setServiceKey] = useState<string>(NATURAL_SERVICE)
  const [variants, setVariants] = useState<string[]>([])
  const [isoDate, setIsoDate] = useState('')
  const [time, setTime] = useState('')
  const [ack, setAck] = useState(false)

  // ── טיפול ניהולי: משך ידני, מחיר אופציונלי (שלב 12) ──
  const adminService = adminOnlyService(serviceKey)
  const [durationMin, setDurationMin] = useState('')
  const [priceTotal, setPriceTotal] = useState('')

  /**
   * 🔒 "זה אותו תור" — אישור מפורש של שובל שהאירוע החוסם ביומן הוא בעצם
   * התור הזה. מאופס בכל שינוי של הצירוף (ראה ה-effect למטה), כדי שאישור
   * שניתן על אירוע אחד לא יזלוג למועד אחר לגמרי.
   */
  const [adoptEventId, setAdoptEventId] = useState<string | null>(null)

  const [availability, setAvailability] = useState<Availability | null>(null)
  const [checking, setChecking] = useState(false)

  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ appointmentId: string; calendarSynced: boolean; message: string } | null>(null)

  const seq = useRef(0)

  const slotReady = Boolean(isoDate && time)
  const durationNum = Number(durationMin)
  const durationValid =
    Number.isInteger(durationNum) &&
    durationNum >= ADMIN_MIN_DURATION_MIN &&
    durationNum <= ADMIN_MAX_DURATION_MIN
  const serviceReady = adminService
    ? durationValid
    : serviceKey === LIFTING_SERVICE || variants.length > 0

  // בדיקת זמינות בכל שינוי של הצירוף. תגובה ישנה שמגיעה באיחור לא דורסת חדשה.
  // לא ניתן להעביר להתאמה בזמן ה-render בלי לפצל את ה-fetch לזרימה נפרדת,
  // מה שהיה מסכן את סנכרון תוצאות הבקשות. disable נקודתי, לא שינוי התנהגות.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailability(null)
    setAck(false)
    setAdoptEventId(null)
    if (!slotReady || !serviceReady) return

    const mine = ++seq.current
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/appointments/availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceKey, variants, isoDate, time,
            durationMin: durationMin === '' ? undefined : Number(durationMin),
            priceTotal: priceTotal === '' ? undefined : Number(priceTotal),
          }),
        })
        const data = await res.json()
        if (mine === seq.current) setAvailability(res.ok ? data : null)
      } catch {
        if (mine === seq.current) setAvailability(null)
      } finally {
        if (mine === seq.current) setChecking(false)
      }
    }, 300)

    return () => clearTimeout(t)
  }, [serviceKey, variants, isoDate, time, durationMin, priceTotal, slotReady, serviceReady])

  const needsAck = Boolean(
    availability?.warnings.outsideBusinessHours || availability?.warnings.closedDay,
  )
  /*
   * ⚠️ מועד עם התנגשות יומן ניתן לשליחה **רק** אחרי שסומן "זה אותו תור",
   * ורק עבור אותו אירוע בדיוק. השרת בודק את שני התנאים שוב בעצמו.
   */
  const adoptedNow = Boolean(
    adoptEventId && availability?.adoptable && availability.adoptable.eventId === adoptEventId,
  )
  const slotOk = availability?.available === true || adoptedNow

  const canSubmit =
    Boolean(customer) && serviceReady && slotReady && slotOk && (!needsAck || ack) && !busy

  function toggleVariant(id: string) {
    setVariants(v => (v.includes(id) ? v.filter(x => x !== id) : [...v, id]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !customer) return
    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer.id, serviceKey, variants, isoDate, time,
          durationMin: durationMin === '' ? undefined : Number(durationMin),
          priceTotal: priceTotal === '' ? undefined : Number(priceTotal),
          adoptCalendarEventId: adoptedNow ? adoptEventId : undefined,
          client_request_id: requestId,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.message ?? 'הפעולה נכשלה. נסי שוב.')
        return
      }

      setDone({
        appointmentId: data.appointmentId,
        calendarSynced: data.calendarSynced,
        message: data.message,
      })
      setRequestId(crypto.randomUUID())
      router.refresh()
    } catch {
      setError('החיבור נכשל. נסי שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="bg-white border border-brand-linen-dark rounded-2xl p-5 space-y-4">
        <div className="flex items-start gap-2.5">
          {done.calendarSynced
            ? <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            : <AlertTriangle className="w-5 h-5 text-brand-gold-text mt-0.5 shrink-0" aria-hidden="true" />}
          <div className="text-sm text-brand-dark">
            <p>{done.message}</p>
            {!done.calendarSynced && (
              // ⚠️ התור קיים ותקף — רק האירוע ביומן חסר. אין ליצור תור נוסף.
              <p className="text-brand-muted mt-1">
                התור נשמר במערכת. אפשר לנסות לסנכרן שוב מרשימת התורים — אין צורך ליצור תור נוסף.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/appointments"
            className="inline-flex items-center justify-center h-11 px-4 rounded-xl bg-brand-dark
                       text-white text-sm font-medium hover:bg-brand-dark/90 transition-colors"
          >
            לרשימת התורים
          </Link>
          {customer && (
            <Link
              href={`/admin/customers/${customer.id}`}
              className="inline-flex items-center justify-center h-11 px-4 rounded-xl border
                         border-brand-linen-dark text-sm font-medium text-brand-dark
                         hover:bg-brand-cream/50 transition-colors"
            >
              לפרופיל הלקוחה
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setDone(null); setIsoDate(''); setTime(''); setVariants([])
              setAvailability(null); setAdoptEventId(null)
            }}
            className="inline-flex items-center justify-center h-11 px-4 rounded-xl border
                       border-brand-linen-dark text-sm font-medium text-brand-muted
                       hover:bg-brand-cream/50 transition-colors"
          >
            תור נוסף
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* ── לקוחה ── */}
      <section className="bg-white border border-brand-linen-dark rounded-2xl p-5">
        <h2 className="text-sm font-medium text-brand-dark mb-2.5">לקוחה</h2>
        <CustomerPicker value={customer} onChange={setCustomer} />
      </section>

      {/* ── טיפול ── */}
      <section className="bg-white border border-brand-linen-dark rounded-2xl p-5 space-y-4">
        <div>
          <label htmlFor="service" className="block text-sm font-medium text-brand-dark mb-1.5">
            טיפול
          </label>
          <select
            id="service"
            value={serviceKey}
            onChange={e => {
              const next = e.target.value
              setServiceKey(next)
              setVariants([])
              // ברירת מחדל למילוי השדה בלבד — שובל משנה אותה בכל תור.
              setDurationMin(String(adminOnlyService(next)?.defaultDurationMin ?? ''))
              setPriceTotal('')
            }}
            className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                       text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
          >
            <option value={NATURAL_SERVICE}>{NATURAL_SERVICE}</option>
            <option value={LIFTING_SERVICE}>{LIFTING_SERVICE}</option>
            {/*
              ⚠️ טיפולים ניהוליים בלבד — אינם בקטלוג הציבורי ואי אפשר
              לקבוע אותם מטופס הלקוחה או מהאזור האישי.
            */}
            <optgroup label="ניהולי בלבד">
              {ADMIN_ONLY_SERVICES.map(svc => (
                <option key={svc.key} value={svc.key}>{svc.label}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {adminService && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="durationMin" className="block text-sm font-medium text-brand-dark mb-1.5">
                משך הטיפול (דקות)
              </label>
              <input
                id="durationMin"
                type="number"
                inputMode="numeric"
                min={ADMIN_MIN_DURATION_MIN}
                max={ADMIN_MAX_DURATION_MIN}
                step={5}
                required
                value={durationMin}
                onChange={e => setDurationMin(e.target.value)}
                className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                           text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
              />
              <p className="text-xs text-brand-muted mt-1">
                בטיפול הזה המשך נקבע ידנית ({ADMIN_MIN_DURATION_MIN}–{ADMIN_MAX_DURATION_MIN} דקות).
              </p>
            </div>
            <div>
              <label htmlFor="priceTotal" className="block text-sm font-medium text-brand-dark mb-1.5">
                מחיר (אופציונלי)
              </label>
              <input
                id="priceTotal"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={priceTotal}
                onChange={e => setPriceTotal(e.target.value)}
                className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                           text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
              />
              <p className="text-xs text-brand-muted mt-1">
                אפשר להשאיר ריק — התור יישמר בלי מחיר.
              </p>
            </div>
          </div>
        )}

        {!isAdminOnlyService(serviceKey) && serviceKey === NATURAL_SERVICE && (
          <fieldset>
            <legend className="block text-sm font-medium text-brand-dark mb-1.5">תוספות</legend>
            <div className="space-y-2">
              {NATURAL_VARIANTS.map(v => (
                <label
                  key={v.id}
                  className="flex items-center gap-2.5 p-3 rounded-xl border border-brand-linen-dark
                             cursor-pointer hover:bg-brand-cream/30 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={variants.includes(v.id)}
                    onChange={() => toggleVariant(v.id)}
                    className="w-4 h-4 accent-brand-rose shrink-0"
                  />
                  <span className="text-sm text-brand-dark flex-1">{v.label}</span>
                  <span className="text-sm text-brand-muted">₪{v.price}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </section>

      {/* ── מועד ── */}
      <section className="bg-white border border-brand-linen-dark rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="isoDate" className="block text-sm font-medium text-brand-dark mb-1.5">
              תאריך
            </label>
            <input
              id="isoDate"
              type="date"
              required
              value={isoDate}
              onChange={e => setIsoDate(e.target.value)}
              className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                         text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
            />
          </div>
          <div>
            <label htmlFor="time" className="block text-sm font-medium text-brand-dark mb-1.5">
              שעה
            </label>
            <input
              id="time"
              type="time"
              required
              step={300}
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full h-12 px-3 rounded-xl border border-brand-linen-dark bg-white
                         text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
            />
          </div>
        </div>
        <p className="text-xs text-brand-muted">
          כמנהלת אפשר לקבוע גם מחוץ לשעות הפעילות ובימים סגורים. המועד מפורש לפי שעון ישראל.
        </p>

        {checking && (
          <p className="flex items-center gap-2 text-sm text-brand-muted">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            בודקת זמינות…
          </p>
        )}

        {availability && !checking && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span className="text-brand-dark">משך: {availability.durationMin} דקות</span>
              <span className="text-brand-dark">
                {availability.priceTotal != null ? `מחיר: ₪${availability.priceTotal}` : 'ללא מחיר'}
              </span>
            </div>

            {/*
              🔒 שלב 12 — "זה אותו תור".
              מוצג רק כשהחסימה היא אירוע יומן שאינו שייך לתור אחר במערכת.
              אין כאן שום עקיפה של חפיפה אמיתית: תור אחר במערכת באותה שעה
              ממשיך לחסום, וגם אירוע ששייך כבר לתור אחר.
            */}
            {!availability.available && availability.adoptable && (
              <div className="bg-brand-cream/60 border border-brand-cream-dark rounded-xl p-3.5">
                <p className="text-sm text-brand-dark mb-1">
                  קיים ביומן אירוע במועד הזה:
                </p>
                <p className="text-sm font-medium text-brand-dark mb-2">
                  {availability.adoptable.summary || 'אירוע ללא כותרת'} ·{' '}
                  {eventTimeLabel(availability.adoptable.start)}–{eventTimeLabel(availability.adoptable.end)}
                </p>
                <label className="flex items-start gap-2.5 text-sm text-brand-dark cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adoptEventId === availability.adoptable.eventId}
                    onChange={e =>
                      setAdoptEventId(e.target.checked ? availability.adoptable!.eventId : null)}
                    className="w-4 h-4 accent-brand-rose shrink-0 mt-0.5"
                  />
                  <span>
                    זה אותו תור — לקשר אליו את התור החדש.
                    <span className="block text-xs text-brand-muted mt-0.5">
                      התור יישמר במערכת, ב-CRM ובתזכורות. לא ייווצר אירוע נוסף ביומן,
                      והאירוע הקיים לא יוזז ולא ישונה.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {!availability.available && !availability.adoptable && (
              <div
                role="alert"
                className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl
                           p-3 text-sm text-rose-800"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{REASON_LABELS[availability.reason ?? ''] ?? 'המועד אינו זמין.'}</span>
              </div>
            )}

            {availability.available && needsAck && (
              <div className="bg-brand-cream/60 border border-brand-cream-dark rounded-xl p-3.5">
                <div className="flex items-start gap-2 text-sm text-brand-dark mb-2.5">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-brand-gold-text" aria-hidden="true" />
                  <span>
                    {availability.warnings.closedDay && availability.warnings.outsideBusinessHours
                      ? 'המועד ביום סגור וגם מחוץ לשעות הפעילות המוצגות ללקוחות.'
                      : availability.warnings.closedDay
                        ? 'המועד ביום שאינו פתוח ללקוחות.'
                        : 'המועד מחוץ לשעות הפעילות המוצגות ללקוחות.'}
                  </span>
                </div>
                <label className="flex items-center gap-2.5 text-sm text-brand-dark cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={e => setAck(e.target.checked)}
                    className="w-4 h-4 accent-brand-rose shrink-0"
                  />
                  אני מאשרת את המועד החריג
                </label>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── סיכום ושליחה ── */}
      <section className="bg-white border border-brand-linen-dark rounded-2xl p-5 space-y-4">
        {customer && availability && slotOk && (
          <dl className="text-sm space-y-1">
            <div className="flex gap-2">
              <dt className="text-brand-muted w-20 shrink-0">לקוחה</dt>
              <dd className="text-brand-dark">{customer.full_name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-brand-muted w-20 shrink-0">טיפול</dt>
              <dd className="text-brand-dark">
                {serviceKey}{variants.length > 0 && ` · ${variants.join(' · ')}`}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-brand-muted w-20 shrink-0">מועד</dt>
              <dd className="text-brand-dark">{isoDate} · {time}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-brand-muted w-20 shrink-0">סה״כ</dt>
              <dd className="text-brand-dark">
                {availability.priceTotal != null ? `₪${availability.priceTotal} · ` : ''}
                {availability.durationMin} דקות
              </dd>
            </div>
          </dl>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl bg-brand-dark
                     text-white text-sm font-medium hover:bg-brand-dark/90 transition-colors
                     disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto"
        >
          {busy
            ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />יוצרת…</>
            : <><CalendarPlus className="w-4 h-4" aria-hidden="true" />יצירת תור</>}
        </button>
        <p className="text-xs text-brand-muted">
          התור נוצר מאושר. לא נשלחת הודעה ללקוחה.
          {adoptedNow && ' האירוע הקיים ביומן יקושר לתור הזה, בלי ליצור אירוע נוסף.'}
        </p>
      </section>
    </form>
  )
}
