'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Calendar, Clock, ArrowLeft, X } from 'lucide-react'
import { WHATSAPP_BASE } from '@/lib/utils'
import { buildLateChangeMessage, buildWhatsAppLinkToBusiness } from '@/lib/whatsappTemplates'
import { isBookableDate } from '@/lib/bookingWindow'
import { selectDisplaySlots, getIsraelToday, type BusyRange } from '@/lib/slotSelection'

/**
 * 🔒 שלב 15E — בחירת מועד חדש כ**בקשה**.
 *
 * ⚠️ הדיאלוג הזה לא מזיז את התור. הוא פותח בקשה שממתינה לשובל, והתור
 * הקיים נשאר שמור וחוסם את שעתו עד ההכרעה. כל הנוסחים כאן חייבים לשקף
 * את זה — לקוחה שתקרא "המועד עודכן" ותגיע לשעה החדשה בלי אישור זו
 * התקלה שהשלב הזה נועד למנוע.
 *
 * ⚠️ הזמינות המוצגת כאן מגיעה מ-lib/slotSelection.ts — בדיוק אותו
 * אלגוריתם שמפעיל את עמוד קביעת התור. אין כאן עותק שני של הכללים.
 *
 * 🔒 **התור של הלקוחה עצמה נחשב תפוס, ואינו מסונן החוצה.** עד 15E הוא
 * סונן מרשימת התפוסה, כי הזזה מיידית שחררה את השעה הישנה באותו רגע.
 * במודל הבקשה זה הפוך: התור המקורי **נשאר מוחזק**, ולכן שעה שחופפת לו
 * לא ניתנת לשמירה — ה-EXCLUDE constraint ידחה אותה. הצגתה כפנויה הייתה
 * מבטיחה ללקוחה מועד שאי אפשר לקבל.
 */

const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

/** כמה ימים קדימה לסרוק. חלון השבוע הרגיל קצר בהרבה; הטווח הרחב נועד
 *  לכלול גם ימי זמינות מיוחדת רחוקים (lib/specialAvailability.ts). */
const SCAN_DAYS = 90

interface DayOption {
  year: number
  month: number
  day: number
  isoDate: string
  label: string
  dayName: string
}

function pad(n: number) {
  return n.toString().padStart(2, '0')
}

function buildDayOptions(now: Date): DayOption[] {
  const today = getIsraelToday(now)
  const out: DayOption[] = []
  for (let i = 0; i < SCAN_DAYS; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    const year = d.getFullYear(), month = d.getMonth(), day = d.getDate()
    if (!isBookableDate(year, month, day, now)) continue
    out.push({
      year, month, day,
      isoDate: `${year}-${pad(month + 1)}-${pad(day)}`,
      label: `${day} ${MONTHS[month]}`,
      dayName: DAY_NAMES[d.getDay()],
    })
  }
  return out
}

export interface RescheduleDialogProps {
  appointmentId: string
  currentLabel: string
  treatment: string
  durationMin: number
  onClose: () => void
  onDone: (message: string) => void
}

export default function RescheduleDialog({
  appointmentId, currentLabel, treatment, durationMin,
  onClose, onDone,
}: RescheduleDialogProps) {
  const [days] = useState<DayOption[]>(() => buildDayOptions(new Date()))
  const [selected, setSelected] = useState<DayOption | null>(null)
  const [busy, setBusy] = useState<BusyRange[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  /**
   * 🔒 השרת לא הצליח לקבוע זמינות — **לא** "היום פנוי". אותה אינווריאנטה
   * כמו ב-BookingForm: `data.busy ?? []` על תשובת כישלון היה פותח את כל
   * השעות להזזה, כולל שעות תפוסות.
   */
  const [slotsUnavailable, setSlotsUnavailable] = useState(false)
  const [time, setTime] = useState<string | null>(null)
  const [step, setStep] = useState<'pick' | 'confirm'>('pick')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWhatsApp, setShowWhatsApp] = useState(false)

  const fetchBusy = useCallback(async (isoDate: string) => {
    setLoadingSlots(true)
    try {
      const res = await fetch(`/api/bookings/slots?date=${isoDate}`)
      // 🔒 כישלון של מקור זמינות → אין שעות להזזה.
      if (!res.ok) {
        setBusy([])
        setSlotsUnavailable(true)
        return
      }
      const data = await res.json()
      // 🔒 15E — **בלי סינון של התור עצמו.** התור הקיים נשאר מוחזק עד
      // לאישור, ולכן השעה שלו תפוסה גם עבור הבקשה הזו. סינונה החוצה היה
      // מציג ללקוחה מועד שה-EXCLUDE constraint ידחה (SELF_OVERLAP).
      setBusy((data.busy ?? []) as BusyRange[])
      setSlotsUnavailable(false)
    } catch {
      setBusy([])
      setSlotsUnavailable(true)
    } finally {
      setLoadingSlots(false)
    }
  }, [])

  // בחירת יום משנה גם איפוס state וגם מפעילה fetch אמיתי לזמינות מהשרת —
  // לא ניתן להעביר להתאמה בזמן ה-render בלי לפצל את ה-fetch לזרימה נפרדת,
  // מה שהיה מסכן את סנכרון תוצאות הבקשות (stale responses) בליבת ההזמנות.
  // disable נקודתי, לא שינוי התנהגות.
  useEffect(() => {
    if (!selected) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTime(null)
    setBusy([])
    fetchBusy(selected.isoDate)
  }, [selected, fetchBusy])

  // סגירה ב-Escape — התנהגות דיאלוג צפויה, גם במקלדת חיצונית בנייד
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const slots = selected && !slotsUnavailable
    ? selectDisplaySlots({
        year: selected.year, month: selected.month, day: selected.day,
        busyRanges: busy, durationMin,
      })
    : []

  const submit = async () => {
    if (saving || !selected || !time) return
    setSaving(true)
    setError(null)
    setShowWhatsApp(false)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isoDate: selected.isoDate,
          time,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? 'שליחת בקשת שינוי המועד נכשלה. נסי שוב.')
        setShowWhatsApp(Boolean(data.offerWhatsApp))
        setSaving(false)
        // המועד אולי נתפס בינתיים — לרענן את הסלוטים כדי שהבחירה תהיה עדכנית
        if (data.error === 'slot_taken' || data.error === 'self_overlap') {
          setTime(null)
          setStep('pick')
          fetchBusy(selected.isoDate)
        }
        return
      }
      onDone(data.message ?? 'בקשת שינוי המועד נשלחה לשובל.')
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setSaving(false)
    }
  }

  const newLabel = selected && time ? `${selected.dayName}, ${selected.label} בשעה ${time}` : ''

  return (
    /*
      🔒 z-[70] ולא z-50.

      ⚠️ באג פרודקשן אמיתי: הודעת העוגיות (components/ui/CookieNotice.tsx)
      היא `fixed bottom-0 inset-x-0 z-50`, והיא מרונדרת ב-DeferredWidgets
      **אחרי** {children} ב-app/layout.tsx. באותו z-index מנצח מי שמאוחר
      יותר ב-DOM — ולכן הבאנר צויר מעל הדיאלוג הזה. במובייל הדיאלוג הוא
      גיליון תחתון (items-end), כלומר בדיוק היכן שהבאנר יושב: הלקוחה לחצה,
      הדיאלוג **כן** נפתח, אבל היא לא ראתה אותו ולא הצליחה ללחוץ על כפתוריו.
      אומת ב-hit-test: elementFromPoint במרכז כפתור האישור החזיר את כפתור
      "אישור הכול" של הבאנר.

      ⚠️ אותה תקלה בדיוק כבר טופלה במגירת הניווט (components/layout/Navbar.tsx,
      שם z-[60]) — הדיאלוגים של האזור האישי פשוט לא עודכנו יחד איתה.

      הסדר: דיאלוג אזור אישי 70 > העדפות עוגיות 60/61 > מגירת ניווט 60 >
      הודעת עוגיות / header 50 > ווידג'טים צפים 40.
    */
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-brand-dark/50 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-title"
      dir="rtl"
    >
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-soft max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-brand-linen-dark px-5 py-4 flex items-center justify-between gap-3">
          <h2 id="reschedule-title" className="font-serif text-lg font-bold text-brand-dark">
            בקשת שינוי מועד
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="סגירה"
            className="p-1.5 -m-1.5 text-brand-muted hover:text-brand-dark disabled:opacity-50 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div className="bg-brand-cream/60 border border-brand-cream-dark rounded-xl p-3 text-xs text-brand-medium leading-relaxed">
            <p className="font-semibold text-brand-dark mb-0.5">{treatment}</p>
            <p>המועד הנוכחי: {currentLabel}</p>
          </div>

          {step === 'pick' ? (
            <>
              <div>
                <h3 className="text-sm font-bold text-brand-dark mb-2 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                  בחירת תאריך
                </h3>
                {days.length === 0 ? (
                  <p className="text-xs text-brand-muted">אין כרגע תאריכים פנויים לשינוי.</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                    {days.map(d => (
                      <button
                        key={d.isoDate}
                        type="button"
                        onClick={() => setSelected(d)}
                        className={`flex-shrink-0 min-w-[76px] px-3 py-2 rounded-xl border text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold ${
                          selected?.isoDate === d.isoDate
                            ? 'bg-brand-dark text-white border-brand-dark'
                            : 'bg-white text-brand-dark border-brand-linen-dark hover:border-brand-rose'
                        }`}
                      >
                        <span className="block text-[11px] opacity-80">{d.dayName}</span>
                        <span className="block text-sm font-semibold">{d.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selected && (
                <div>
                  <h3 className="text-sm font-bold text-brand-dark mb-2 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                    בחירת שעה
                  </h3>
                  {loadingSlots ? (
                    <div className="flex items-center gap-2 text-xs text-brand-muted py-3">
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      טוענת זמינות…
                    </div>
                  ) : slots.length === 0 ? (
                    <p className="text-xs text-brand-muted py-2">
                      {/* ⚠️ "אין שעות" ו"לא הצלחנו לטעון" הן שתי תשובות שונות. */}
                      {slotsUnavailable
                        ? 'לא הצלחנו לטעון את הזמינות כרגע. נסי לרענן בעוד רגע.'
                        : 'אין שעות פנויות בתאריך הזה. אפשר לבחור תאריך אחר.'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {slots.map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setTime(s)}
                          className={`py-2 rounded-xl border text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold ${
                            time === s
                              ? 'bg-brand-dark text-white border-brand-dark'
                              : 'bg-white text-brand-dark border-brand-linen-dark hover:border-brand-rose'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <p role="alert" className="text-red-500 text-xs">{error}</p>
              )}

              <button
                type="button"
                disabled={!selected || !time}
                onClick={() => { setError(null); setStep('confirm') }}
                className="w-full bg-brand-dark text-white font-semibold text-sm py-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                המשך לאישור
              </button>
            </>
          ) : (
            <>
              <div className="space-y-3">
                {/*
                  ⚠️ בלי קו חוצה על המועד הנוכחי. הוא **לא** מבוטל — הוא
                  נשאר שמור עד ששובל מאשרת, וקו חוצה היה משדר את ההפך.
                */}
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-brand-muted">המועד הנוכחי</span>
                  <span className="text-brand-dark">{currentLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-brand-muted">המועד המבוקש</span>
                  <span className="font-bold text-brand-dark">{newLabel}</span>
                </div>
                <p className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 leading-relaxed">
                  <strong className="font-bold">התור הקיים שלך נשאר שמור.</strong>{' '}
                  זו בקשה בלבד — המועד הנוכחי לא מתבטל, והשעה נשמרת עבורך עד ששובל
                  תאשר את המועד החדש. אם הבקשה לא תאושר, התור שלך יישאר כפי שהוא.
                </p>
                <p className="bg-brand-rose-bg border border-brand-rose-light rounded-xl p-3 text-xs text-brand-medium leading-relaxed">
                  הטיפול והמחיר אינם משתנים — רק התאריך והשעה. לשינוי סוג הטיפול יש לפנות לשובל.
                </p>
              </div>

              {error && <p role="alert" className="text-red-500 text-xs">{error}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setStep('pick'); setError(null) }}
                  disabled={saving}
                  className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-brand-linen-dark text-sm font-semibold text-brand-dark disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  חזרה
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-brand-dark text-white font-semibold text-sm py-3 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                  שליחת הבקשה
                </button>
              </div>
            </>
          )}

          {/*
            🔒 15F — הקישור נושא טקסט מוכן. הדיאלוג הזה הוא בקשת שינוי מועד.
            ⚠️ `currentLabel` הוא המועד **הקיים**, וזה הנכון: הלקוחה מזהה
            מולו את התור, ולא מול המועד שביקשה ושלא אושר.
          */}
          {showWhatsApp && (
            <a
              href={buildWhatsAppLinkToBusiness(WHATSAPP_BASE, buildLateChangeMessage({
                action: 'reschedule', treatment, whenLabel: currentLabel,
              }))}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs font-semibold text-[#25D366] hover:underline"
            >
              פנייה לשובל בוואטסאפ
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
