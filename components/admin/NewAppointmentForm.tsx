'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle, AlertTriangle, CalendarPlus, Lock } from 'lucide-react'
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
 *
 * ═══ 15I/15J — "המועד מגיע מהיומן", לכל טיפול ידני ═══════════════════════
 *
 * שובל קובעת תור בטלפון ורושמת אותו ביומן לפני שהוא מגיע לאתר. במקרה
 * הזה אין מה להקליד: בוחרים תאריך, רואים את אירועי היום שאפשר לקשר,
 * ובוחרים את האירוע. מהרגע הזה **התאריך, ההתחלה, הסיום והמשך מוצגים
 * לקריאה בלבד** ונלקחים מ-Google.
 *
 * 🔓 15J — הרשימה מוצגת לכל טיפול, ולא רק למיקרובליידינג ולייעוץ. אירוע
 * שאינו מקושר לתור אחר ניתן לבחירה תמיד: לא סוג הטיפול, לא הכותרת, לא
 * השעה, לא המשך ולא שעות הפעילות מונעים את זה. כותרת האירוע היא רמז
 * לזיהוי בשביל שובל — לא תנאי.
 *
 * ⚠️ אין כאן "גם וגם": ברגע שנבחר אירוע, שדות השעה והמשך אינם ניתנים
 * לעריכה — לא מוסתרים אלא נעולים, כדי ששובל תראה בדיוק מה יישמר.
 *
 * ⚠️ אירוע מחוץ לשעות הפעילות **אינו** דורש אישור חריגה ואינו חוסם: הוא
 * כבר קיים ביומן, והשאלה "האם המועד חריג" כבר הוכרעה שם.
 */

interface AdoptableEvent {
  eventId: string
  summary: string
  start: string
  end: string
}

/** אירוע מרשימת הגילוי — כמו AdoptableEvent, עם המשך שכבר חושב בשרת */
interface DiscoveredEvent extends AdoptableEvent {
  durationMin: number
}

/**
 * 🔎 15L — תור קיים שחוסם את המועד, עם מה שדרוש כדי לפעול לפיו.
 *
 * ⚠️ המועד מגיע מהשרת כמחרוזות שעון ישראל ולא כ-ISO: המרה בדפדפן הייתה
 * מציגה שעה לפי אזור הזמן של המכשיר, ומסך שמראה שעה אחרת משאר האדמין
 * הוא בדיוק מה ששלח לחפש תור שלא קיים.
 */
interface BlockingAppointment {
  id: string
  customerId: string | null
  customerName: string
  treatment: string
  isoDate: string
  startTime: string
  endTime: string
  status: string
}

/** המועד כפי שנקרא מהיומן — זה מה שיישמר, ולא מה שהוקלד */
interface GoogleSlot {
  eventId: string
  summary: string
  isoDate: string
  startTime: string
  endTime: string
  durationMin: number
}

interface Availability {
  durationMin: number
  priceTotal: number | null
  available: boolean
  reason: string | null
  /** פרטי האירוע החוסם ביומן, רק כשהוא ניתן לאימוץ (שלב 12) */
  adoptable: AdoptableEvent | null
  /** 15I — לא null ⟹ המועד נגזר מהיומן והשדות נעולים */
  googleSlot: GoogleSlot | null
  /** 🔓 15J — אירוע יומן אחר שחופף. אזהרה בלבד, אינו חוסם יצירה. */
  calendarOverlap: AdoptableEvent | null
  /** 🔎 15L — התורים שחוסמים בפועל, כשהסיבה היא db_conflict */
  blocking: BlockingAppointment[]
  /** 🔓 15J — האירוע שנבחר לא ניתן לקישור, עם הסבר קריא. לא כשל שקט. */
  adoptError: string | null
  adoptMessage: string | null
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

/**
 * 🔓 15J — הסבר לאירוע שנבחר ואי אפשר לקשר אותו. שתי הסיבות היחידות
 * שנשארו הן מה שה-DB עצמו אוסר — תור חופף (EXCLUDE constraint) ומועד
 * שעבר (START_IN_PAST ב-RPC) — ולכן ההסבר מפרט מה לעשות, ולא רק ש"לא
 * ניתן". סוג הטיפול, הכותרת, המשך ושעות הפעילות אינם ברשימה הזו כלל.
 */
const ADOPT_BLOCK_LABELS: Record<string, string> = {
  past: 'האירוע שנבחר כבר התחיל. אי אפשר לשמור תור במועד שעבר — אפשר לקשר רק אירוע שעדיין לא התחיל.',
  db_conflict: 'קיים כבר תור אחר במערכת בשעות של האירוע הזה. שני תורים פעילים אינם יכולים לחפוף, ולכן יש לבטל או להזיז את התור האחר קודם.',
}

const BLOCKING_STATUS_LABELS: Record<string, string> = {
  pending: 'ממתין לאישור',
  confirmed: 'מאושר',
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
   * 🔒 האירוע שנבחר לקישור. מגיע משני מקומות ומתנהג זהה בשניהם:
   * רשימת אירועי היום (15I), או הסימון "זה אותו תור" על אירוע חוסם (שלב 12).
   * מאופס בכל שינוי של הטיפול או התאריך, כדי שבחירה שניתנה על אירוע אחד
   * לא תזלוג ליום אחר.
   */
  const [adoptEventId, setAdoptEventId] = useState<string | null>(null)

  // ── 15I: אירועי היומן של היום שנבחר ──
  const [events, setEvents] = useState<DiscoveredEvent[] | null>(null)
  const [eventsBusy, setEventsBusy] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)

  const [availability, setAvailability] = useState<Availability | null>(null)
  /**
   * 🔓 15J — התשובה נכשלה ברמת ה-HTTP (או שהרשת נפלה).
   *
   * ⚠️ עד כאן המצב הזה כתב `setAvailability(null)` וזהו: המנהלת לחצה על
   * האירוע, ושום דבר על המסך לא השתנה — לא סימון, לא שגיאה, וכפתור
   * היצירה נשאר מעומעם. זה בדיוק מה שנראה כמו "אי אפשר ללחוץ על האירוע".
   */
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ appointmentId: string; calendarSynced: boolean; message: string } | null>(null)

  const seq = useRef(0)
  const eventsSeq = useRef(0)

  /**
   * מצב "המועד מהיומן" — 🔓 15J: אירוע שנבחר, בכל טיפול.
   *
   * ⚠️ עד 15J היה כאן `adminService && adoptEventId`. הצירוף הזה גם הסתיר
   * את הרשימה משאר הטיפולים וגם, אילו אירוע היה נבחר בכל זאת, היה משאיר
   * את השעה שהוקלדה בתוקף. שניהם ירדו.
   */
  const googleMode = Boolean(adoptEventId)

  const durationNum = Number(durationMin)
  const durationValid =
    Number.isInteger(durationNum) &&
    durationNum >= ADMIN_MIN_DURATION_MIN &&
    durationNum <= ADMIN_MAX_DURATION_MIN

  // ⚠️ במצב Google אין שעה להקליד ואין משך להקליד — שניהם מגיעים מהאירוע.
  const slotReady = googleMode ? Boolean(isoDate) : Boolean(isoDate && time)
  const serviceReady = adminService
    ? (googleMode || durationValid)
    : serviceKey === LIFTING_SERVICE || variants.length > 0

  /*
   * ── 15I/15J: טעינת אירועי היום שאפשר לקשר ───────────────────────────────
   *
   * 🔓 רץ לכל טיפול. התנאי `!adminService` שהיה כאן הוא שגרם לכך שאירועי
   * היומן לא נטענו כלל לעיצוב גבות ולהרמת גבות.
   *
   * ⚠️ תלוי בתאריך בלבד ולא בטיפול: הרשימה זהה לכל טיפול, ואין סיבה
   * לטעון אותה שוב כששובל מחליפה טיפול — או לאבד בחירה שכבר נעשתה.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdoptEventId(null)
    setEvents(null)
    setEventsError(null)
    setEventsBusy(false)
    if (!isoDate) return

    const mine = ++eventsSeq.current
    setEventsBusy(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/appointments/calendar-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isoDate }),
        })
        const data = await res.json()
        if (mine !== eventsSeq.current) return
        if (res.ok) setEvents(data.events ?? [])
        else { setEvents([]); setEventsError(data.message ?? 'לא הצלחנו לטעון את אירועי היומן.') }
      } catch {
        if (mine === eventsSeq.current) {
          setEvents([])
          setEventsError('לא הצלחנו לטעון את אירועי היומן.')
        }
      } finally {
        if (mine === eventsSeq.current) setEventsBusy(false)
      }
    }, 250)

    return () => clearTimeout(t)
  }, [isoDate])

  // בדיקת זמינות בכל שינוי של הצירוף. תגובה ישנה שמגיעה באיחור לא דורסת חדשה.
  // לא ניתן להעביר להתאמה בזמן ה-render בלי לפצל את ה-fetch לזרימה נפרדת,
  // מה שהיה מסכן את סנכרון תוצאות הבקשות. disable נקודתי, לא שינוי התנהגות.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailability(null)
    setAvailabilityError(null)
    setAck(false)
    if (!slotReady || !serviceReady) return

    const mine = ++seq.current
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/appointments/availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceKey, variants, isoDate,
            // ⚠️ במצב Google השעה והמשך אינם נשלחים כלל. אין ערך בטופס
            // שיכול להשפיע על המועד שיישמר.
            time: googleMode ? undefined : time,
            durationMin: googleMode || durationMin === '' ? undefined : Number(durationMin),
            priceTotal: priceTotal === '' ? undefined : Number(priceTotal),
            adoptCalendarEventId: adoptEventId ?? undefined,
          }),
        })
        const data = await res.json()
        if (mine !== seq.current) return
        if (res.ok) {
          setAvailability(data)
        } else {
          setAvailability(null)
          setAvailabilityError(data?.message ?? 'בדיקת הזמינות נכשלה. נסי שוב.')
        }
      } catch {
        if (mine === seq.current) {
          setAvailability(null)
          setAvailabilityError('החיבור נכשל בבדיקת הזמינות. נסי שוב.')
        }
      } finally {
        if (mine === seq.current) setChecking(false)
      }
    }, 300)

    return () => clearTimeout(t)
  }, [
    serviceKey, variants, isoDate, time, durationMin, priceTotal,
    slotReady, serviceReady, adoptEventId, googleMode,
  ])

  const googleSlot = availability?.googleSlot ?? null

  /*
   * ⚠️ אירוע קיים ביומן אינו דורש אישור חריגה. הוא כבר נקבע שם, והמועד
   * שלו הוא נתון ולא בחירה שנעשית עכשיו בטופס. זו בדיוק החריגה שנדרשה:
   * business-hours אינו חוסם אימוץ.
   */
  const needsAck = Boolean(
    !googleSlot &&
    (availability?.warnings.outsideBusinessHours || availability?.warnings.closedDay),
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
          customerId: customer.id, serviceKey, variants, isoDate,
          // ⚠️ אותו כלל כמו בבדיקת הזמינות: במצב Google לא נשלחת שעה ולא
          // נשלח משך. השרת קורא אותם מהאירוע.
          time: googleMode ? undefined : time,
          durationMin: googleMode || durationMin === '' ? undefined : Number(durationMin),
          priceTotal: priceTotal === '' ? undefined : Number(priceTotal),
          adoptCalendarEventId: (googleMode || adoptedNow) ? adoptEventId : undefined,
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
              setAvailability(null); setAvailabilityError(null)
              setAdoptEventId(null); setEvents(null)
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
              {/*
                ⚠️ במצב Google המשך אינו שדה קלט אלא תצוגה: הוא end − start
                של האירוע, ואי אפשר לשנות אותו כאן.
              */}
              {googleMode ? (
                <div
                  className="flex items-center gap-2 h-12 px-3 rounded-xl border border-brand-cream-dark
                             bg-brand-cream/50 text-brand-dark"
                  aria-live="polite"
                >
                  <Lock className="w-3.5 h-3.5 text-brand-muted shrink-0" aria-hidden="true" />
                  <span>{googleSlot ? `${googleSlot.durationMin} דקות` : '—'}</span>
                  <span className="text-xs text-brand-muted">לפי היומן</span>
                </div>
              ) : (
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
              )}
              <p className="text-xs text-brand-muted mt-1">
                {googleMode
                  ? 'המשך נגזר מהאירוע ביומן ואינו ניתן לעריכה.'
                  : `בטיפול הזה המשך נקבע ידנית (${ADMIN_MIN_DURATION_MIN}–${ADMIN_MAX_DURATION_MIN} דקות).`}
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
            {/*
              ⚠️ במצב Google השעה אינה שדה קלט. מוצג הטווח שנקרא מהיומן —
              בדיוק מה שיישמר.
            */}
            {googleMode ? (
              <div
                className="flex items-center gap-2 h-12 px-3 rounded-xl border border-brand-cream-dark
                           bg-brand-cream/50 text-brand-dark"
                aria-live="polite"
              >
                <Lock className="w-3.5 h-3.5 text-brand-muted shrink-0" aria-hidden="true" />
                <span dir="ltr">
                  {googleSlot ? `${googleSlot.startTime}–${googleSlot.endTime}` : '—'}
                </span>
                <span className="text-xs text-brand-muted">לפי היומן</span>
              </div>
            ) : (
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
            )}
          </div>
        </div>
        <p className="text-xs text-brand-muted">
          {googleMode
            ? 'המועד נלקח מהאירוע ביומן Google — תאריך, שעת התחלה, שעת סיום ומשך. האירוע ביומן לא ישונה ולא ייווצר אירוע נוסף.'
            : 'כמנהלת אפשר לקבוע גם מחוץ לשעות הפעילות ובימים סגורים. המועד מפורש לפי שעון ישראל.'}
        </p>

        {/*
          ── 15I/15J: בחירת אירוע קיים ביומן ────────────────────────────────
          🔓 מוצג לכל טיפול, אחרי שנבחר תאריך. אירוע שכבר מקושר לתור אחר
          אינו מופיע כאן כלל — זו החסימה היחידה. כל אירוע שכן מופיע ניתן
          לבחירה, בלי קשר לכותרת, לשעה, למשך או לשעות הפעילות.
        */}
        {isoDate && (
          <fieldset className="border-t border-brand-linen-dark pt-4">
            <legend className="text-sm font-medium text-brand-dark mb-1.5">
              אירוע קיים ביומן Google
            </legend>

            {eventsBusy && (
              <p className="flex items-center gap-2 text-sm text-brand-muted">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                טוענת את אירועי היום…
              </p>
            )}

            {eventsError && !eventsBusy && (
              <div role="alert" className="flex items-start gap-2 bg-rose-50 border border-rose-200
                                           rounded-xl p-3 text-sm text-rose-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{eventsError} אפשר להמשיך בהזנה ידנית של המועד.</span>
              </div>
            )}

            {events && !eventsBusy && events.length === 0 && !eventsError && (
              <p className="text-sm text-brand-muted">
                אין ביומן אירועים פנויים לקישור בתאריך הזה. אפשר להזין מועד ידנית.
              </p>
            )}

            {events && events.length > 0 && !eventsBusy && (
              <p className="text-xs text-brand-muted mb-2">
                כל אירוע ברשימה ניתן לבחירה. הכותרת עוזרת לזהות את התור, ואינה חייבת
                להתאים לשם הטיפול.
              </p>
            )}

            {events && events.length > 0 && !eventsBusy && (
              <div className="space-y-2">
                {events.map(ev => (
                  <label
                    key={ev.eventId}
                    className="flex items-start gap-2.5 p-3 rounded-xl border border-brand-linen-dark
                               cursor-pointer hover:bg-brand-cream/30 transition-colors"
                  >
                    <input
                      type="radio"
                      name="adoptEvent"
                      checked={adoptEventId === ev.eventId}
                      onChange={() => setAdoptEventId(ev.eventId)}
                      className="w-4 h-4 accent-brand-rose shrink-0 mt-0.5"
                    />
                    <span className="text-sm text-brand-dark">
                      <span className="font-medium">{ev.summary || 'אירוע ללא כותרת'}</span>
                      <span className="block text-xs text-brand-muted mt-0.5" dir="ltr">
                        {eventTimeLabel(ev.start)}–{eventTimeLabel(ev.end)} · {ev.durationMin} min
                      </span>
                    </span>
                  </label>
                ))}

                {/* ⚠️ המסלול הידני נשאר זמין במלואו ולא השתנה. */}
                <label
                  className="flex items-start gap-2.5 p-3 rounded-xl border border-brand-linen-dark
                             cursor-pointer hover:bg-brand-cream/30 transition-colors"
                >
                  <input
                    type="radio"
                    name="adoptEvent"
                    checked={adoptEventId === null}
                    onChange={() => setAdoptEventId(null)}
                    className="w-4 h-4 accent-brand-rose shrink-0 mt-0.5"
                  />
                  <span className="text-sm text-brand-dark">
                    ללא קישור ליומן
                    <span className="block text-xs text-brand-muted mt-0.5">
                      הזנת שעה ידנית, ואירוע חדש ייווצר ביומן.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </fieldset>
        )}

        {checking && (
          <p className="flex items-center gap-2 text-sm text-brand-muted">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            בודקת זמינות…
          </p>
        )}

        {availabilityError && !checking && (
          <div
            role="alert"
            className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl
                       p-3 text-sm text-rose-800"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{availabilityError}</span>
          </div>
        )}

        {availability && !checking && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span className="text-brand-dark">משך: {availability.durationMin} דקות</span>
              <span className="text-brand-dark">
                {availability.priceTotal != null ? `מחיר: ₪${availability.priceTotal}` : 'ללא מחיר'}
              </span>
            </div>

            {googleSlot && (
              <div className="bg-brand-cream/60 border border-brand-cream-dark rounded-xl p-3.5">
                <p className="flex items-center gap-2 text-sm text-brand-dark">
                  <Lock className="w-4 h-4 text-brand-muted shrink-0" aria-hidden="true" />
                  המועד נלקח מהאירוע ביומן ואינו ניתן לעריכה.
                </p>
                <p className="text-sm font-medium text-brand-dark mt-1.5">
                  {googleSlot.summary || 'אירוע ללא כותרת'} · {googleSlot.isoDate} ·{' '}
                  <span dir="ltr">{googleSlot.startTime}–{googleSlot.endTime}</span> ·{' '}
                  {googleSlot.durationMin} דקות
                </p>
                {(availability.warnings.outsideBusinessHours || availability.warnings.closedDay) && (
                  // ⚠️ מידע בלבד. אירוע קיים ביומן נוצר גם מחוץ לשעות הפעילות.
                  <p className="text-xs text-brand-muted mt-1">
                    המועד מחוץ לשעות הפעילות המוצגות ללקוחות — וזה בסדר, הוא נקבע ביומן.
                  </p>
                )}
              </div>
            )}

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
                      {adminService && ' המועד יילקח מהאירוע ביומן.'}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/*
              🔓 15J — אזהרת חפיפה ביומן. **אינה** חוסמת: המנהלת בחרה אירוע
              קיים במפורש, וזו פעולה ידנית סמכותית. מוצגת כדי שתדע.
            */}
            {availability.calendarOverlap && (
              <div className="flex items-start gap-2 bg-brand-cream/60 border border-brand-cream-dark
                              rounded-xl p-3.5 text-sm text-brand-dark">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-brand-gold-text" aria-hidden="true" />
                <span>
                  ביומן קיים גם אירוע נוסף בשעות האלה:{' '}
                  <span className="font-medium">
                    {availability.calendarOverlap.summary || 'אירוע ללא כותרת'}
                  </span>{' '}
                  <span dir="ltr">
                    ({eventTimeLabel(availability.calendarOverlap.start)}–
                    {eventTimeLabel(availability.calendarOverlap.end)})
                  </span>
                  <span className="block text-xs text-brand-muted mt-0.5">
                    אפשר להמשיך — האירוע שנבחר הוא זה שיקושר לתור. האירוע הנוסף לא ישונה.
                  </span>
                </span>
              </div>
            )}

            {!availability.available && !availability.adoptable && (
              <div
                role="alert"
                className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl
                           p-3 text-sm text-rose-800"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {/*
                    🔓 15J — כשאירוע נבחר, ההסבר הוא על **האירוע** ולא על
                    "המועד": adoptMessage מגיע מהשרת (אירוע שנעלם / נתפס /
                    משך חורג), ואחריו הסיבות שה-DB עצמו אוסר.
                  */}
                  {availability.adoptMessage
                    ?? (availability.reason === 'db_conflict' && availability.blocking.length === 0
                          ? 'לא הצלחנו לבדוק מול התורים הקיימים כרגע. נסי שוב בעוד רגע.'
                          : null)
                    ?? (adoptEventId ? ADOPT_BLOCK_LABELS[availability.reason ?? ''] : null)
                    ?? REASON_LABELS[availability.reason ?? '']
                    ?? 'המועד אינו זמין.'}
                </span>
              </div>
            )}

            {/*
              🔎 15L — **איזה** תור חוסם. בלי זה ההודעה נכונה אבל לא ניתנת
              לפעולה: רשימת התורים מציגה 20 תורים לעמוד על פני כל התאריכים,
              ותור בעוד שבועיים יושב כמה עמודים פנימה. הקישור מגיע אליו
              ישירות דרך החיפוש, שכבר יודע לחפש לפי שם.
            */}
            {!availability.available && availability.blocking.length > 0 && (
              <div className="bg-white border border-rose-200 rounded-xl p-3.5">
                <p className="text-sm font-medium text-brand-dark mb-2">
                  {availability.blocking.length === 1
                    ? 'התור שחוסם:'
                    : `${availability.blocking.length} תורים חוסמים:`}
                </p>
                <ul className="space-y-2">
                  {availability.blocking.map(b => (
                    <li key={b.id} className="text-sm">
                      <span className="font-medium text-brand-dark">
                        {b.customerName || 'לקוחה ללא שם'}
                      </span>
                      <span className="text-brand-muted"> · {b.treatment}</span>
                      <span className="block text-xs text-brand-muted mt-0.5">
                        {b.isoDate} ·{' '}
                        <span dir="ltr">{b.startTime}–{b.endTime}</span> ·{' '}
                        {BLOCKING_STATUS_LABELS[b.status] ?? b.status}
                      </span>
                      <span className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                        {/*
                          ⚠️ חיפוש לפי שם ולא קישור לתור עצמו: אין באדמין
                          עמוד לתור בודד, ורשימת התורים היא המקום היחיד
                          שממנו אפשר לבטל או להזיז אותו.
                        */}
                        <Link
                          href={`/admin/appointments?q=${encodeURIComponent(b.customerName)}`}
                          className="text-xs font-medium text-brand-dark underline
                                     underline-offset-2 hover:text-brand-muted"
                        >
                          לתור ברשימת התורים
                        </Link>
                        {b.customerId && (
                          <Link
                            href={`/admin/customers/${b.customerId}`}
                            className="text-xs font-medium text-brand-dark underline
                                       underline-offset-2 hover:text-brand-muted"
                          >
                            לכרטיס הלקוחה
                          </Link>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
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
              {/* ⚠️ הסיכום מציג את מה שיישמר — במצב Google זה המועד מהיומן. */}
              <dd className="text-brand-dark">
                {googleSlot
                  ? `${googleSlot.isoDate} · ${googleSlot.startTime}–${googleSlot.endTime}`
                  : `${isoDate} · ${time}`}
              </dd>
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
          {(googleMode || adoptedNow) && ' האירוע הקיים ביומן יקושר לתור הזה, בלי ליצור אירוע נוסף.'}
          {googleMode && ' לאחר היצירה המועד ניתן לשינוי ביומן Google בלבד.'}
        </p>
      </section>
    </form>
  )
}
