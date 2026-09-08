'use client'

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Loader2, X, Clock, Check, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDialogA11y } from '@/lib/useDialogA11y'
import { selectWaitlistOptions } from '@/lib/waitlist'
import { getIsraelToday, type BusyRange } from '@/lib/slotSelection'
import { isBookableDate, BOOKING_HORIZON_DAYS } from '@/lib/bookingWindow'
import {
  PRIVACY_PATH, PRIVACY_NOTICE_VERSION, PRIVACY_ACK_LABEL, splitPrivacyLink,
} from '@/lib/privacyNotice'

/**
 * רשימת המתנה — הדיאלוג.
 *
 * ═══ 🔒 מה מוצג כאן ═══
 *
 * אך ורק `selectWaitlistOptions`: כל השעות החוקיות והפנויות **פחות** אלה
 * שכבר מוצגות בקביעת התור. אין כאן חישוב שני של זמינות, אין רשת שעות
 * משלנו, ואין קריאה למקור אחר — `busy` מגיע מ-`/api/bookings/slots`,
 * בדיוק אותו endpoint שהטופס הראשי משתמש בו.
 *
 * ⚠️ לכן שעה תפוסה, יום חסום, שבת, חג או שעה שהטיפול לא נכנס בה אינם
 * יכולים להופיע כאן: הם כלל אינם במאגר.
 *
 * ═══ ⚠️ זה לא תור ═══
 *
 * הנוסחים כאן חייבים לשקף את זה בכל מסך. לקוחה שתקרא "נקבע" ותגיע לשעה
 * שבחרה — זו התקלה שהפיצ'ר הזה חייב למנוע.
 */

interface WaitlistDialogProps {
  serviceKey: string
  variants: string[]
  durationMin: number
  fullName: string
  phone: string
  onClose: () => void
  whatsappHref: string
}

interface DayOption {
  year: number
  month: number
  day: number
  iso: string
  label: string
  weekday: string
}

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const SHORT_MONTHS = [
  'ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני',
  'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ',
]

const pad = (n: number) => n.toString().padStart(2, '0')

/**
 * הימים שניתן לבחור — נגזרים מ-`isBookableDate` ומ-`BOOKING_HORIZON_DAYS`
 * בלבד. 🔒 אין כאן טווח משלנו ואין פתיחה של שישי/שבת.
 */
function bookableDays(): DayOption[] {
  const today = getIsraelToday()
  const out: DayOption[] = []
  for (let i = 0; i <= BOOKING_HORIZON_DAYS; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    const [y, m, day] = [d.getFullYear(), d.getMonth(), d.getDate()]
    if (!isBookableDate(y, m, day)) continue
    out.push({
      year: y, month: m, day,
      iso: `${y}-${pad(m + 1)}-${pad(day)}`,
      label: `${day} ${SHORT_MONTHS[m]}`,
      weekday: WEEKDAYS[d.getDay()],
    })
  }
  return out
}

export default function WaitlistDialog({
  serviceKey, variants, durationMin, fullName, phone, onClose, whatsappHref,
}: WaitlistDialogProps) {
  const days = useMemo(() => bookableDays(), [])
  const [selected, setSelected] = useState<DayOption | null>(null)
  const [busy, setBusy] = useState<BusyRange[]>([])
  const [loading, setLoading] = useState(false)
  /** 🔒 מקור הזמינות לא ענה — **לא** "היום פנוי". אותה דוקטרינה כמו בטופס. */
  const [unavailable, setUnavailable] = useState(false)
  const [time, setTime] = useState('')
  const [ack, setAck] = useState(false)
  const [ackError, setAckError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWhatsApp, setShowWhatsApp] = useState(false)
  const [done, setDone] = useState<'joined' | 'already' | null>(null)

  const dialogRef = useDialogA11y<HTMLDivElement>({
    open: true,
    onClose: saving ? undefined : onClose,
    lockScroll: true,
  })

  const loadBusy = useCallback(async (iso: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/bookings/slots?date=${iso}`)
      if (!res.ok) {
        setBusy([])
        setUnavailable(true)
        return
      }
      const data = await res.json()
      setBusy(data.busy ?? [])
      setUnavailable(false)
    } catch {
      setBusy([])
      setUnavailable(true)
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * 🔒 ההגדרה המלאה, במקום אחד: חוקי ופנוי MINUS מוצג. אין כאן סינון
   * נוסף ואין "עוד קצת" — מה שהפונקציה מחזירה הוא מה שמוצג.
   */
  const options = selected && !unavailable
    ? selectWaitlistOptions({
        year: selected.year, month: selected.month, day: selected.day,
        busyRanges: busy, durationMin,
      })
    : []

  /**
   * ⚠️ הטעינה נעשית כאן, באירוע הלחיצה — ולא ב-effect שרודף אחרי
   * `selected`. אחרת כל בחירת תאריך הייתה מפעילה מפל רינדורים
   * (setState סינכרוני בתוך effect), וזו בדיוק התבנית שה-lint חוסם.
   */
  const pickDay = (d: DayOption) => {
    setSelected(d)
    setTime('')
    setBusy([])
    setError(null)
    loadBusy(d.iso)
  }

  const submit = async () => {
    if (saving || !selected || !time) return
    if (!ack) { setAckError(true); return }
    setSaving(true)
    setError(null)
    setShowWhatsApp(false)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceKey,
          variants,
          isoDate: selected.iso,
          time,
          fullName,
          phone,
          privacyNoticeAcknowledged: true,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.saved) {
        setDone(data.alreadyOnList ? 'already' : 'joined')
        return
      }
      setError(data.message ?? 'לא הצלחנו לשמור את הבקשה.')
      setShowWhatsApp(Boolean(data.whatsappFallback))
      // ⚠️ השעה נתפסה בינתיים — מרעננים את הזמינות כדי שהרשימה שמוצגת
      // תשקף את המצב החדש, ולא תציע שוב את אותה שעה.
      if (data.error === 'slot_unavailable') {
        setTime('')
        loadBusy(selected.iso)
      }
    } catch {
      setError('לא הצלחנו לשמור את הבקשה כרגע.')
      setShowWhatsApp(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-brand-dark/50 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="waitlist-title"
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-xl
                   max-h-[92vh] sm:max-h-[85vh] overflow-y-auto"
      >
        {/* ידית גרירה ויזואלית — מסמנת גיליון תחתון במובייל */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-brand-cream-dark" />
        </div>

        <div className="sticky top-0 bg-white/95 backdrop-blur px-5 pt-3 pb-3 border-b border-brand-cream-dark flex items-start justify-between gap-3 z-10">
          <div>
            <h2 id="waitlist-title" className="font-serif text-lg font-bold text-brand-dark flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4 text-brand-rose" aria-hidden="true" />
              רשימת המתנה
            </h2>
            <p className="text-xs text-brand-muted mt-0.5">{serviceKey} · {durationMin} דק׳</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="סגירה"
            className="p-1.5 -m-1.5 rounded-lg text-brand-muted hover:bg-brand-cream transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-10 text-center">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-rose-bg mb-4">
              <Check className="w-7 h-7 text-brand-rose-text" aria-hidden="true" />
            </span>
            <h3 className="font-serif text-xl font-bold text-brand-dark mb-2">
              {done === 'already' ? 'את כבר ברשימה 🤍' : 'נרשמת לרשימת ההמתנה 🤍'}
            </h3>
            {/* ⚠️ הנוסח חייב לחזור על כך שזה אינו תור, גם במסך ההצלחה. */}
            <p className="text-sm text-brand-medium leading-relaxed max-w-xs mx-auto">
              זו אינה קביעת תור. אם נוכל לפתוח עבורך את השעה שבחרת —
              ניצור איתך קשר.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 h-12 px-8 rounded-xl bg-brand-dark text-white text-sm font-semibold"
            >
              סגירה
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-5">
            <p className="text-xs text-brand-medium bg-brand-cream rounded-xl p-3 leading-relaxed">
              הצטרפות לרשימת ההמתנה אינה אישור תור. אם יתאפשר לנו לפתוח עבורך
              את השעה שבחרת, ניצור איתך קשר.
            </p>

            {/* הפרטים שכבר הוזנו — לקריאה בלבד, בלי להקליד שוב */}
            <div className="flex items-center justify-between gap-3 text-xs bg-white border border-brand-cream-dark rounded-xl px-3 py-2.5">
              <span className="text-brand-muted">הפרטים שלך</span>
              <span className="text-brand-dark font-semibold truncate">
                {fullName} · <span dir="ltr">{phone}</span>
              </span>
            </div>

            {/* ── תאריך ── */}
            <div>
              <p className="text-sm font-semibold text-brand-dark mb-2">בחירת תאריך</p>
              <div
                className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x"
                role="group"
                aria-label="בחירת תאריך לרשימת ההמתנה"
              >
                {days.map(d => {
                  const isSel = selected?.iso === d.iso
                  return (
                    <button
                      key={d.iso}
                      type="button"
                      onClick={() => pickDay(d)}
                      aria-pressed={isSel}
                      aria-label={`${d.weekday} ${d.label}`}
                      className={cn(
                        'flex-shrink-0 snap-start w-[68px] py-2.5 rounded-2xl border text-center transition-all duration-150',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                        isSel
                          ? 'bg-brand-rose text-white border-brand-rose shadow-rose'
                          : 'bg-white text-brand-dark border-brand-cream-dark hover:border-brand-rose',
                      )}
                    >
                      <span className={cn('block text-[11px]', isSel ? 'text-white/80' : 'text-brand-muted')}>
                        {d.weekday}
                      </span>
                      <span className="block text-sm font-bold mt-0.5">{d.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── שעות ── */}
            {selected && (
              <div>
                <p className="text-sm font-semibold text-brand-dark mb-2 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                  שעות נוספות ל{selected.weekday}, {selected.label}
                </p>

                {loading ? (
                  <p className="text-xs text-brand-muted animate-pulse py-3">טוענת זמינות...</p>
                ) : options.length === 0 ? (
                  <div className="bg-brand-cream border border-brand-cream-dark rounded-2xl p-4 text-center">
                    {/* ⚠️ שני מצבים שונים, ואסור לנסח אותם אותו דבר — בדיוק
                        כמו בטופס הראשי: "אין שעות" היא תשובה, "לא נטען" אינה. */}
                    <p className="text-sm text-brand-medium">
                      {unavailable
                        ? 'לא הצלחנו לטעון את הזמינות כרגע'
                        : 'אין כרגע שעות נוספות לרשימת ההמתנה בתאריך הזה'}
                    </p>
                    <p className="text-xs text-brand-muted mt-1">
                      {unavailable ? 'נסי לרענן בעוד רגע' : 'אפשר לבחור תאריך אחר'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label="בחירת שעה לרשימת ההמתנה">
                    {options.map(slot => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => { setTime(slot); setError(null) }}
                        aria-pressed={time === slot}
                        className={cn(
                          'py-3 rounded-xl text-sm font-semibold border transition-all duration-150',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                          time === slot
                            ? 'bg-brand-rose text-white border-brand-rose shadow-rose'
                            : 'bg-white text-brand-dark border-brand-cream-dark hover:border-brand-rose',
                        )}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 🔒 הודעת הפרטיות — אותה דרישה בדיוק כמו בהזמנה. אין מסלול עוקף. */}
            {time && (
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={e => { setAck(e.target.checked); setAckError(false) }}
                  aria-required="true"
                  aria-invalid={ackError}
                  className="sr-only peer"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex items-center justify-center w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 transition-colors',
                    'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-gold peer-focus-visible:ring-offset-2',
                    ack ? 'border-brand-rose bg-brand-rose' : 'border-brand-cream-dark bg-white',
                  )}
                >
                  {ack && <Check className="w-3 h-3 text-white" />}
                </span>
                <span className="text-xs text-brand-dark leading-relaxed">
                  {(() => {
                    const { before, linkText, after } = splitPrivacyLink(PRIVACY_ACK_LABEL)
                    return (
                      <>
                        {before}
                        <Link
                          href={PRIVACY_PATH}
                          target="_blank"
                          onClick={ev => ev.stopPropagation()}
                          className="font-semibold text-brand-rose-text underline"
                        >
                          {linkText}
                        </Link>
                        {after}
                      </>
                    )
                  })()}
                </span>
              </label>
            )}
            {ackError && (
              <p className="text-brand-rose-text text-xs -mt-3" role="alert">
                יש לאשר את מדיניות הפרטיות כדי להצטרף לרשימת ההמתנה
              </p>
            )}

            {error && (
              <div className="bg-brand-rose-bg border border-brand-rose/30 rounded-xl p-3" role="alert">
                <p className="text-sm text-brand-rose-text">{error}</p>
                {showWhatsApp && (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-xs font-semibold text-brand-rose-text underline"
                  >
                    לפנייה בוואטסאפ
                  </a>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!time || saving}
              className={cn(
                'w-full h-12 rounded-xl text-sm font-semibold transition-colors',
                'flex items-center justify-center gap-2',
                !time || saving
                  ? 'bg-brand-cream-dark text-brand-muted cursor-not-allowed'
                  : 'bg-brand-dark text-white hover:bg-brand-dark/90',
              )}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {saving ? 'שומרת...' : 'הצטרפי לרשימת ההמתנה'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
