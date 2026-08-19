'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CalendarClock, AlertCircle, AlertTriangle } from 'lucide-react'
import { ADMIN_MIN_DURATION_MIN, ADMIN_MAX_DURATION_MIN } from '@/lib/services'

interface Props {
  appointmentId: string
  customerName: string
  /** המועד הנוכחי בשעון ישראל, כפי שחושב בשרת */
  currentIsoDate: string
  currentTime: string
  currentDurationMin: number
}

/**
 * שלב 12 (0034) — שינוי מועד לתור מאושר, ישירות מרשימת התורים.
 *
 * ─── מה זה **לא** ──────────────────────────────────────────────────────────
 *
 * זה אינו "ביטול ויצירה מחדש": התור נשאר אותו תור, עם אותה היסטוריה ואותו
 * אירוע ביומן שרק זז. לכן גם לא נשלחת ללקוחה הודעת ביטול.
 *
 * ⚠️ **אין הודעה אוטומטית ללקוחה גם על ההזזה עצמה.** שובל מתאמת את המועד
 * החדש בטלפון לפני שהיא מזיזה — הודעה אוטומטית על מועד שכבר סוכם בעל פה
 * הייתה מיותרת, והודעה על מועד שלא סוכם הייתה גרועה בהרבה. התזכורות
 * האוטומטיות למועד החדש כן מתעדכנות במסד (טריגר 0011).
 *
 * ⚠️ המשך הטיפול ניתן לשינוי כאן, אבל ריק פירושו "להשאיר כמו שהוא" —
 * לא 0.
 */
export default function RescheduleAppointmentButton({
  appointmentId, customerName, currentIsoDate, currentTime, currentDurationMin,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isoDate, setIsoDate] = useState(currentIsoDate)
  const [time, setTime] = useState(currentTime)
  const [durationMin, setDurationMin] = useState(String(currentDurationMin))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncWarning, setSyncWarning] = useState<string | null>(null)

  const durationNum = Number(durationMin)
  const durationValid =
    Number.isInteger(durationNum) &&
    durationNum >= ADMIN_MIN_DURATION_MIN &&
    durationNum <= ADMIN_MAX_DURATION_MIN

  const unchanged =
    isoDate === currentIsoDate && time === currentTime && durationNum === currentDurationMin

  const submit = async () => {
    if (loading || !isoDate || !time || !durationValid || unchanged) return

    const confirmed = window.confirm(
      `להזיז את התור של ${customerName} ל-${isoDate} בשעה ${time}?`,
    )
    if (!confirmed) return

    setLoading(true)
    setError(null)
    setSyncWarning(null)

    try {
      const res = await fetch(`/api/admin/appointments/${appointmentId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isoDate, time, durationMin: durationNum }),
      })
      const data = await res.json()

      if (!res.ok || !data.ok) {
        setError(data.message ?? 'ההזזה נכשלה. נסי שוב.')
        setLoading(false)
        return
      }

      /*
       * 🔒 מצב שלישי, לא שני — בדיוק כמו ב-ApproveRejectButtons: "הוזז אבל
       * היומן לא סונכרן". התור **זז** במערכת והשעה החדשה תפוסה, ואסור
       * להציג זאת כשגיאה אדומה שמשמעה "לא קרה כלום" — זה היה גורם לשובל
       * להזיז שוב.
       */
      if (!data.calendarSynced) {
        setSyncWarning(data.message)
        setLoading(false)
        router.refresh()
        return
      }

      setOpen(false)
      setLoading(false)
      router.refresh()
    } catch {
      setError('החיבור נכשל. נסי שוב.')
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700
                   border border-blue-200 hover:bg-blue-50 px-3.5 py-2 rounded-full
                   cursor-pointer transition-colors focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-brand-gold"
      >
        <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
        שינוי מועד
      </button>
    )
  }

  return (
    <div className="w-full bg-brand-cream/50 border border-brand-cream-dark rounded-xl p-3.5 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label
            htmlFor={`date-${appointmentId}`}
            className="block text-xs font-medium text-brand-dark mb-1"
          >
            תאריך חדש
          </label>
          <input
            id={`date-${appointmentId}`}
            type="date"
            value={isoDate}
            onChange={e => setIsoDate(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-brand-linen-dark bg-white text-sm
                       text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
          />
        </div>
        <div>
          <label
            htmlFor={`time-${appointmentId}`}
            className="block text-xs font-medium text-brand-dark mb-1"
          >
            שעה חדשה
          </label>
          <input
            id={`time-${appointmentId}`}
            type="time"
            step={300}
            value={time}
            onChange={e => setTime(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-brand-linen-dark bg-white text-sm
                       text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
          />
        </div>
        <div>
          <label
            htmlFor={`dur-${appointmentId}`}
            className="block text-xs font-medium text-brand-dark mb-1"
          >
            משך (דקות)
          </label>
          <input
            id={`dur-${appointmentId}`}
            type="number"
            inputMode="numeric"
            min={ADMIN_MIN_DURATION_MIN}
            max={ADMIN_MAX_DURATION_MIN}
            step={5}
            value={durationMin}
            onChange={e => setDurationMin(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-brand-linen-dark bg-white text-sm
                       text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
          />
        </div>
      </div>

      <p className="text-[11px] text-brand-muted leading-relaxed">
        המועד מפורש לפי שעון ישראל. האירוע הקיים ביומן יזוז — לא ייווצר אירוע נוסף,
        והתזכורות יתוזמנו מחדש למועד החדש. ללקוחה לא נשלחת הודעה אוטומטית.
      </p>

      {error && (
        <div role="alert" className="flex items-start gap-2 bg-rose-50 border border-rose-200
                                     rounded-xl p-2.5 text-xs text-rose-800">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {syncWarning && (
        <div role="alert" className="flex items-start gap-2 bg-brand-gold/10 border border-brand-gold/40
                                     rounded-xl p-2.5 text-xs text-brand-gold-text">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{syncWarning}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={loading || !isoDate || !time || !durationValid || unchanged}
          className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-brand-dark
                     text-white text-sm font-medium hover:bg-brand-dark/90 transition-colors
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />מזיזה…</>
            : <><CalendarClock className="w-4 h-4" aria-hidden="true" />אישור ההזזה</>}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
            setSyncWarning(null)
            setIsoDate(currentIsoDate)
            setTime(currentTime)
            setDurationMin(String(currentDurationMin))
          }}
          className="inline-flex items-center justify-center h-11 px-4 rounded-xl border
                     border-brand-linen-dark text-sm font-medium text-brand-muted
                     hover:bg-white transition-colors"
        >
          ביטול
        </button>
      </div>
    </div>
  )
}
