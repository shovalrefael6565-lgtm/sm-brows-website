'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronRight, ChevronLeft, Check, Calendar, Clock, User, Phone,
  MessageSquare, Sparkles, ArrowRight, Pencil,
} from 'lucide-react'
import { cn, WHATSAPP_BASE, WHATSAPP_URL } from '@/lib/utils'

const NATURAL = 'עיצוב גבות טבעיות'

interface ServiceOption {
  name: string
  online: boolean
  desc: string
}

const SERVICES: ServiceOption[] = [
  { name: NATURAL,          online: true,  desc: 'עיצוב מדויק המדגיש את יופי הפנים הטבעי' },
  { name: 'מיקרובליידינג',  online: false, desc: 'קעקוע קוסמטי לגבות מושלמות עד שנה' },
  { name: 'הרמת גבות',      online: false, desc: 'הרמה ועיצוב הגבות ללא ניתוח' },
  { name: 'קורס מקצועי',    online: false, desc: 'הכשרה מקצועית לאמניות גבות' },
]

interface Variant {
  id: string
  label: string
  desc: string
  price: number
}

const NATURAL_VARIANTS: Variant[] = [
  { id: 'עיצוב גבות טבעי',        label: 'עיצוב גבות טבעי',        desc: 'עיצוב מדויק והגדרת הגבה',                                          price: 70 },
  { id: 'עיצוב גבות + צביעה',     label: 'עיצוב גבות + צביעה',     desc: 'כולל צביעת גבות — האפקט נמשך כ-7 עד 10 ימים',                     price: 85 },
]

const MONTHS = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
]
const DAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']

function pad(n: number) {
  return n.toString().padStart(2, '0')
}

/** Natural brow design — 20-minute slots: 09:00–11:00 and 15:00–19:00 */
function buildTimeSlots(): string[] {
  const slots: string[] = []
  // בוקר 09:00–11:00 (המשבצת האחרונה מתחילה ב-10:40 ומסתיימת ב-11:00)
  for (let m = 9 * 60; m <= 10 * 60 + 40; m += 20)
    slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  // אחה"צ/ערב 15:00–19:00 (המשבצת האחרונה מתחילה ב-18:40 ומסתיימת ב-19:00)
  for (let m = 15 * 60; m <= 18 * 60 + 40; m += 20)
    slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  return slots
}

function buildCalendar(year: number, month: number) {
  const firstDow = new Date(year, month, 1).getDay()
  const total = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= total; d++) cells.push(d)
  return cells
}

function fmtDate(year: number, month: number, day: number) {
  return `${day} ${MONTHS[month]} ${year}`
}

/** מחזיר את "היום" לפי שעון ישראל — נכון גם בחצות ובשינויי שעון */
function getIsraelToday(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date())
  const y = parseInt(parts.find(p => p.type === 'year')!.value)
  const m = parseInt(parts.find(p => p.type === 'month')!.value) - 1
  const d = parseInt(parts.find(p => p.type === 'day')!.value)
  return new Date(y, m, d, 0, 0, 0, 0)
}

/** הופך תאריך לזרע מספרי (כל יום מקבל זרע יציב משלו) */
function dateSeed(year: number, month: number, day: number): number {
  return ((year * 31 + (month + 1)) * 31 + day) >>> 0
}

/** מחזיר מספר ימי עסקים מהיום (ישראל) עד התאריך הנבחר (פוסחים על שישי+שבת) */
function businessDayOffset(year: number, month: number, day: number): number {
  const today = getIsraelToday()
  const target = new Date(year, month, day)
  target.setHours(0, 0, 0, 0)
  if (target.getTime() <= today.getTime()) return 0
  let count = 0
  const d = new Date(today)
  while (d.getTime() < target.getTime()) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 5 && dow !== 6) count++
  }
  return count
}

/** כמה משבצות להציג ביום הזה (3 היום, 5 מחר, 6-7 בהמשך השבוע, מעבר ל-6 ימי עסקים — אין) */
function slotsForOffset(offset: number, seed: number): number {
  if (offset === 0) return 3
  if (offset === 1) return 5
  if (offset <= 6) return 6 + (seed % 2) // 6 או 7, יציב לתאריך
  return 0 // מעבר ל-6 ימי עסקים — לא זמין
}

/** ערבוב פסאודו-אקראי מבוסס זרע — אותו תאריך תמיד חוזר עם אותה תוצאה */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr]
  let s = seed || 1
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

interface FormData {
  name: string
  phone: string
  service: string
  variant: string
  date: string
  time: string
  notes: string
}

const EMPTY_FORM: FormData = {
  name: '', phone: '', service: '', variant: '', date: '', time: '', notes: '',
}

export default function BookingForm() {
  const today  = getIsraelToday()
  const ctaRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(1)
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<Partial<FormData>>({})
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [busyRanges, setBusyRanges] = useState<{ start: string; end: string }[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // משך טיפול לעיצוב גבות טבעי = 20 דקות. בודקים חפיפה מלאה — לא רק התחלה מדויקת
  const SLOT_DURATION = 20
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  const isSlotTaken = (slot: string) => {
    const slotStart = toMin(slot)
    const slotEnd = slotStart + SLOT_DURATION
    return busyRanges.some(({ start, end }) => {
      const eStart = toMin(start)
      const eEnd = toMin(end)
      return eStart < slotEnd && eEnd > slotStart
    })
  }

  const isNatural = form.service === NATURAL
  const timeSlots = buildTimeSlots()
  const cells = buildCalendar(viewYear, viewMonth)

  const EVENING_FROM = 15 * 60 // 15:00 — תחילת משמרת אחה"צ/ערב

  /** בוחר את הזמינות המוצגות: כמות לפי מרחק ביום-עסקים, בעיקר ערב, גיוון יומי. */
  const visibleSlots = (() => {
    if (selectedDay === null) return []
    const seed = dateSeed(viewYear, viewMonth, selectedDay)
    const offset = businessDayOffset(viewYear, viewMonth, selectedDay)
    const maxSlots = slotsForOffset(offset, seed)
    if (maxSlots === 0) return []

    const nowParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date())
    const nowYear  = parseInt(nowParts.find(p => p.type === 'year')!.value)
    const nowMonth = parseInt(nowParts.find(p => p.type === 'month')!.value) - 1
    const nowDay   = parseInt(nowParts.find(p => p.type === 'day')!.value)
    const nowHour  = parseInt(nowParts.find(p => p.type === 'hour')!.value)
    const nowMin   = parseInt(nowParts.find(p => p.type === 'minute')!.value)
    const isViewingToday =
      selectedDay === nowDay &&
      viewMonth === nowMonth &&
      viewYear === nowYear
    // בהיום — להציג רק שעות לפחות שעה מעכשיו (חלון להכנה)
    const minStartMin = isViewingToday ? nowHour * 60 + nowMin + 60 : 0

    const free = timeSlots
      .filter(slot => toMin(slot) >= minStartMin)
      .filter(slot => !isSlotTaken(slot))

    // ערבוב יציב לפי תאריך — ריענון לא משנה, אבל כל יום שונה
    const evening = seededShuffle(free.filter(s => toMin(s) >= EVENING_FROM), seed)
    const morning = seededShuffle(free.filter(s => toMin(s) < EVENING_FROM), seed + 1)

    const targetMorning = maxSlots <= 5 ? 1 : 2
    const targetEvening = maxSlots - targetMorning

    const picked = [
      ...morning.slice(0, targetMorning),
      ...evening.slice(0, targetEvening),
    ]

    // אם בקבוצה אחת אין מספיק — לאכלס מהשנייה
    if (picked.length < maxSlots) {
      const remaining = free.filter(s => !picked.includes(s))
      picked.push(...remaining.slice(0, maxSlots - picked.length))
    }

    return picked.sort((a, b) => toMin(a) - toMin(b))
  })()

  // שלבים: עיצוב טבעי → 3 שלבים | שאר הטיפולים → 2 שלבים
  const stepLabels = isNatural
    ? ['בחירת טיפול', 'בחירת מועד', 'פרטים ואישור']
    : ['בחירת טיפול', 'פרטים ואישור']
  const totalSteps = stepLabels.length

  const selectedVariant = NATURAL_VARIANTS.find(v => v.id === form.variant)

  const fetchTakenSlots = useCallback(async (isoDate: string) => {
    setLoadingSlots(true)
    try {
      const res = await fetch(`/api/bookings/slots?date=${isoDate}`)
      const data = await res.json()
      setBusyRanges(data.busy ?? [])
    } catch {
      setBusyRanges([])
    } finally {
      setLoadingSlots(false)
    }
  }, [])

  // אם בחודש הנוכחי אין ימים זמינים (חלון עבר לחודש הבא) — עבור אוטומטית
  useEffect(() => {
    const t = getIsraelToday()
    const viewingCurrentOrPast =
      viewYear < t.getFullYear() ||
      (viewYear === t.getFullYear() && viewMonth <= t.getMonth())
    if (!viewingCurrentOrPast) return // משתמש גלל ידנית לעתיד — לא לגעת

    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate()
    let hasAvailable = false
    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(viewYear, viewMonth, d)
      if (date < t) continue
      const dow = date.getDay()
      if (dow === 5 || dow === 6) continue
      if (businessDayOffset(viewYear, viewMonth, d) <= 6) {
        hasAvailable = true
        break
      }
    }
    if (!hasAvailable) {
      setSelectedDay(null)
      if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
      else setViewMonth(m => m + 1)
    }
  }, [viewYear, viewMonth])

  // ריענון אוטומטי של הזמינות — פעם בשעה כשיום נבחר
  useEffect(() => {
    if (selectedDay === null) return
    const isoDate = `${viewYear}-${pad(viewMonth + 1)}-${pad(selectedDay)}`
    const id = setInterval(() => fetchTakenSlots(isoDate), 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [selectedDay, viewYear, viewMonth, fetchTakenSlots])

  const isPast = (day: number) => {
    const d = new Date(viewYear, viewMonth, day)
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    return d < t
  }
  /** ימי שישי (5) ושבת (6) — האשה לא עובדת */
  const isClosedDay = (day: number) => {
    const dow = new Date(viewYear, viewMonth, day).getDay()
    return dow === 5 || dow === 6
  }
  /** מעבר ל-6 ימי עסקים מהיום — לא ניתן להזמין דרך האתר */
  const isBeyondWindow = (day: number) =>
    businessDayOffset(viewYear, viewMonth, day) > 6
  const isDisabled = (day: number) =>
    isPast(day) || isClosedDay(day) || isBeyondWindow(day)

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
    setSelectedDay(null)
    setForm(f => ({ ...f, date: '', time: '' }))
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
    setSelectedDay(null)
    setForm(f => ({ ...f, date: '', time: '' }))
  }

  const toIsoDate = (year: number, month: number, day: number) =>
    `${year}-${pad(month + 1)}-${pad(day)}`

  const selectDay = (day: number) => {
    if (isDisabled(day)) return
    setSelectedDay(day)
    setBusyRanges([])
    setForm(f => ({ ...f, date: fmtDate(viewYear, viewMonth, day), time: '' }))
    setErrors(e => ({ ...e, date: undefined }))
    fetchTakenSlots(toIsoDate(viewYear, viewMonth, day))
  }

  const selectService = (name: string) => {
    setForm(f => ({
      ...f,
      service: name,
      variant: name === NATURAL ? f.variant : '',
      date: '', time: '',
    }))
    setSelectedDay(null)
    setErrors({})
    // Scroll the continue button into view after React commits the selection.
    // setTimeout(100) outlasts React 18's batched commit + the AnimatePresence
    // exit animation so getBoundingClientRect() returns the settled position.
    // scrollIntoView block:'nearest' scrolls only when needed and exactly
    // enough to fully reveal the element — imperceptible when already visible.
    setTimeout(() => {
      ctaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 100)
  }

  // ── ניווט בין שלבים ──
  const validateStep = (s: number): boolean => {
    const e: Partial<FormData> = {}
    if (s === 1 && !form.service) e.service = 'יש לבחור טיפול'
    if (s === 2 && isNatural) {
      if (!form.variant) e.variant = 'יש לבחור סוג טיפול'
      if (!form.date) e.date = 'יש לבחור תאריך'
      if (!form.time) e.time = 'יש לבחור שעה'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const goNext = () => {
    if (!validateStep(step)) return
    setStep(s => Math.min(s + 1, totalSteps))
  }
  const goBack = () => {
    setErrors({})
    setStep(s => Math.max(s - 1, 1))
  }

  const validateFinal = () => {
    const e: Partial<FormData> = {}
    if (!form.name.trim()) e.name = 'שדה חובה'
    if (!form.phone.trim()) e.phone = 'שדה חובה'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const buildWhatsAppMessage = () => {
    const service = isNatural && form.variant ? form.variant : form.service
    const lines = [
      'היי שובל 🤍',
      '',
      'בקשת תור חדשה 🌸',
      '',
      `👤 ${form.name}`,
      `📞 ${form.phone}`,
      '',
      `💆 ${service}`,
      ...(form.date ? [`📅 ${form.date}`] : []),
      ...(form.time ? [`⏰ ${form.time}`] : []),
      ...(form.notes.trim() ? ['', `📝 ${form.notes}`] : []),
    ]
    return encodeURIComponent(lines.join('\n'))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateFinal()) return
    setSubmitted(true)
    const url = `${WHATSAPP_BASE}?text=${buildWhatsAppMessage()}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const resetAll = () => {
    setSubmitted(false)
    setForm(EMPTY_FORM)
    setSelectedDay(null)
    setStep(1)
    setErrors({})
  }

  const setField = (k: keyof FormData) => (
    ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm(f => ({ ...f, [k]: ev.target.value }))
    setErrors(err => ({ ...err, [k]: undefined }))
  }

  // ── מסך אישור ──
  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="text-center py-12 px-4"
      >
        <div className="relative inline-flex items-center justify-center w-20 h-20 mb-6">
          <span className="absolute inset-0 rounded-full bg-brand-rose/10 animate-ping" aria-hidden="true" />
          <span className="relative inline-flex items-center justify-center w-20 h-20 rounded-full bg-brand-rose/15">
            <Check className="w-10 h-10 text-brand-rose" />
          </span>
        </div>
        <h2 className="font-serif text-3xl font-bold text-brand-dark mb-3">
          תודה! הבקשה מוכנה 🌸
        </h2>
        <p className="text-brand-medium text-base leading-relaxed mb-2 max-w-md mx-auto">
          פתחתי לך חלון וואצאפ עם כל הפרטים — שלחי את ההודעה ואחזור אלייך בהקדם לאישור התור.
        </p>
        <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-brand-muted text-sm mb-8 bg-brand-cream rounded-2xl px-4 py-2">
          <span className="font-semibold text-brand-dark">{form.name}</span>
          <span aria-hidden="true">·</span>
          <span>{isNatural && form.variant ? form.variant : form.service}</span>
          {isNatural && (
            <>
              <span aria-hidden="true">·</span>
              <span>{form.date} בשעה {form.time}</span>
            </>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href={`${WHATSAPP_BASE}?text=${buildWhatsAppMessage()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold px-8 py-4 rounded-full shadow-lg hover:shadow-xl transition-shadow cursor-pointer"
          >
            <WhatsAppIcon className="w-5 h-5" />
            שלחי את ההודעה בוואצאפ
          </a>
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center justify-center gap-2 border-2 border-brand-rose-light text-brand-dark font-medium px-8 py-4 rounded-full hover:bg-brand-rose-bg transition-colors cursor-pointer"
          >
            קביעת תור נוסף
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <div>
      {/* ── מחוון התקדמות ── */}
      <ol className="flex items-center justify-center gap-2 sm:gap-3 mb-10" aria-label="שלבי קביעת התור">
        {stepLabels.map((label, i) => {
          const n = i + 1
          const done = n < step
          const active = n === step
          return (
            <li key={label} className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-all duration-300 flex-shrink-0',
                    done && 'bg-brand-rose text-white',
                    active && 'bg-brand-gold text-brand-dark ring-4 ring-brand-gold/20',
                    !done && !active && 'bg-brand-cream-dark text-brand-muted'
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  {done ? <Check className="w-4 h-4" /> : n}
                </span>
                <span className={cn(
                  'text-xs sm:text-sm font-semibold transition-colors hidden sm:inline',
                  active ? 'text-brand-dark' : 'text-brand-muted'
                )}>
                  {label}
                </span>
              </div>
              {n < totalSteps && (
                <span
                  className={cn(
                    'w-5 sm:w-10 h-px transition-colors duration-300',
                    done ? 'bg-brand-rose' : 'bg-brand-cream-dark'
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          )
        })}
      </ol>

      <form onSubmit={handleSubmit} noValidate>
        <AnimatePresence mode="wait">

          {/* ═══ שלב 1 — בחירת טיפול ═══ */}
          {step === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2 className="font-serif text-2xl font-bold text-brand-dark text-center mb-1">
                איזה טיפול בא לך?
              </h2>
              <p className="text-brand-muted text-sm text-center mb-7">
                בחרי את הטיפול המבוקש כדי להמשיך
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {SERVICES.map(svc => {
                  const selected = form.service === svc.name
                  return (
                    <button
                      key={svc.name}
                      type="button"
                      onClick={() => selectService(svc.name)}
                      aria-pressed={selected}
                      className={cn(
                        'relative text-right p-5 rounded-2xl border-2 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                        selected
                          ? 'border-brand-rose bg-brand-rose-bg shadow-rose'
                          : 'border-brand-cream-dark bg-white hover:border-brand-rose/40 hover:bg-brand-rose-bg/40'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <h3 className="font-bold text-brand-dark text-base mb-1">
                            {svc.name}
                          </h3>
                          <p className="text-brand-muted text-xs leading-relaxed">
                            {svc.desc}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'flex items-center justify-center w-6 h-6 rounded-full border-2 flex-shrink-0 transition-colors',
                            selected ? 'border-brand-rose bg-brand-rose' : 'border-brand-cream-dark'
                          )}
                          aria-hidden="true"
                        >
                          {selected && <Check className="w-3.5 h-3.5 text-white" />}
                        </span>
                      </div>
                      <div className="mt-3 pt-3 border-t border-brand-cream-dark/70">
                        {svc.online ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-gold-dark">
                            <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                            קביעת תור אונליין
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-muted">
                            <WhatsAppIcon className="w-3.5 h-3.5" />
                            תיאום בוואצאפ
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
              {errors.service && (
                <p className="text-red-500 text-xs mt-3 text-center">{errors.service}</p>
              )}
            </motion.div>
          )}

          {/* ═══ שלב 2 (עיצוב טבעי) — בחירת מועד ═══ */}
          {step === 2 && isNatural && (
            <motion.div
              key="step-2-natural"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-7"
            >
              {/* בחירת סוג טיפול + מחיר */}
              <div>
                <div className="flex items-center gap-1.5 mb-3">
                  <Sparkles className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                  <span className="text-sm font-semibold text-brand-dark">
                    סוג הטיפול
                    <span className="text-brand-rose me-1" aria-hidden="true">*</span>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {NATURAL_VARIANTS.map(v => {
                    const selected = form.variant === v.id
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setForm(f => ({ ...f, variant: v.id }))
                          setErrors(e => ({ ...e, variant: undefined }))
                        }}
                        aria-pressed={selected}
                        className={cn(
                          'text-right p-4 rounded-2xl border-2 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                          selected
                            ? 'border-brand-rose bg-brand-rose-bg shadow-rose'
                            : 'border-brand-cream-dark bg-white hover:border-brand-rose/40'
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <h3 className="font-bold text-brand-dark text-sm">{v.label}</h3>
                          <span className="font-serif text-lg font-bold text-brand-rose whitespace-nowrap">
                            ₪{v.price}
                          </span>
                        </div>
                        <p className="text-brand-muted text-xs">{v.desc}</p>
                      </button>
                    )
                  })}
                </div>
                {errors.variant && (
                  <p className="text-red-500 text-xs mt-2">{errors.variant}</p>
                )}
              </div>

              {/* לוח שנה */}
              <div>
                <div className="flex items-center gap-1.5 mb-3">
                  <Calendar className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                  <span className="text-sm font-semibold text-brand-dark">
                    בחירת תאריך
                    <span className="text-brand-rose me-1" aria-hidden="true">*</span>
                  </span>
                </div>
                {errors.date && <p className="text-red-500 text-xs mb-2">{errors.date}</p>}

                <div className="bg-white rounded-3xl border border-brand-cream-dark p-4 shadow-soft">
                  <div className="flex items-center justify-between mb-4">
                    {/* RTL: first child appears on RIGHT → right = back = prev month */}
                    <button
                      type="button"
                      onClick={prevMonth}
                      aria-label="חודש קודם"
                      className="p-1.5 rounded-lg hover:bg-brand-rose-bg transition-colors cursor-pointer"
                    >
                      <ChevronRight className="w-5 h-5 text-brand-dark" />
                    </button>
                    <span className="font-semibold text-brand-dark text-sm">
                      {MONTHS[viewMonth]} {viewYear}
                    </span>
                    {/* RTL: last child appears on LEFT → left = forward = next month */}
                    <button
                      type="button"
                      onClick={nextMonth}
                      aria-label="חודש הבא"
                      className="p-1.5 rounded-lg hover:bg-brand-rose-bg transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="w-5 h-5 text-brand-dark" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 mb-1">
                    {DAYS.map(d => (
                      <div key={d} className={cn(
                        'text-center text-xs font-semibold py-1',
                        d === 'ש׳' || d === 'ו׳' ? 'text-brand-muted/40' : 'text-brand-muted'
                      )}>
                        {d}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-0.5">
                    {cells.map((day, i) => {
                      if (!day) return <div key={`empty-${i}`} />
                      const disabled = isDisabled(day)
                      const selected = selectedDay === day
                      const isToday =
                        day === today.getDate() &&
                        viewMonth === today.getMonth() &&
                        viewYear === today.getFullYear()
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => selectDay(day)}
                          disabled={disabled}
                          aria-label={`${fmtDate(viewYear, viewMonth, day)}${disabled ? ' — לא זמין' : ''}`}
                          aria-pressed={selected}
                          className={cn(
                            'relative aspect-square flex items-center justify-center text-sm rounded-xl transition-all duration-150',
                            disabled
                              ? 'text-brand-muted/30 cursor-not-allowed'
                              : selected
                              ? 'bg-brand-rose text-white font-bold shadow-rose cursor-pointer'
                              : isToday
                              ? 'bg-brand-gold/15 text-brand-dark font-semibold hover:bg-brand-rose hover:text-white cursor-pointer'
                              : 'text-brand-dark hover:bg-brand-rose/10 hover:text-brand-rose cursor-pointer'
                          )}
                        >
                          {day}
                          {isToday && !selected && (
                            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-gold" aria-hidden="true" />
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {form.date && (
                    <p className="text-center text-xs text-brand-rose font-semibold mt-3 pt-3 border-t border-brand-cream-dark">
                      {form.date}
                    </p>
                  )}
                </div>
              </div>

              {/* שעות */}
              <AnimatePresence>
                {form.date && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="flex items-center gap-1.5 mb-3">
                      <Clock className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                      <span className="text-sm font-semibold text-brand-dark">
                        בחירת שעה
                        <span className="text-brand-rose me-1" aria-hidden="true">*</span>
                      </span>
                      {!loadingSlots && visibleSlots.length > 0 && (
                        <span className="text-xs text-brand-muted">(זמינות פנויה)</span>
                      )}
                    </div>
                    {errors.time && <p className="text-red-500 text-xs mb-2">{errors.time}</p>}

                    {loadingSlots ? (
                      <p className="text-xs text-brand-muted mb-2 animate-pulse">טוענת זמינות...</p>
                    ) : visibleSlots.length === 0 ? (
                      <div className="bg-brand-cream border border-brand-cream-dark rounded-2xl p-5 text-center">
                        <p className="text-sm text-brand-medium mb-1">
                          אין זמינות פנויה בתאריך זה
                        </p>
                        <p className="text-xs text-brand-muted">
                          בחרי תאריך אחר או צרי קשר ישירות בוואצאפ
                        </p>
                      </div>
                    ) : (
                      <div
                        className="grid grid-cols-3 sm:grid-cols-5 gap-2"
                        role="group"
                        aria-label="בחירת שעת הפגישה"
                      >
                        {visibleSlots.map(slot => {
                          const isSelected = form.time === slot
                          return (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => {
                                setForm(f => ({ ...f, time: slot }))
                                setErrors(e => ({ ...e, time: undefined }))
                              }}
                              aria-pressed={isSelected}
                              aria-label={`שעה ${slot}`}
                              className={cn(
                                'py-2.5 rounded-xl text-sm font-semibold border transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                                isSelected
                                  ? 'bg-brand-rose text-white border-brand-rose shadow-rose'
                                  : 'bg-white text-brand-dark border-brand-cream-dark hover:border-brand-rose hover:text-brand-rose hover:bg-brand-rose-bg'
                              )}
                            >
                              {slot}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ═══ שלב אחרון — פרטים ואישור ═══ */}
          {step === totalSteps && step > 1 && (
            <motion.div
              key="step-details"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-5"
            >
              {/* סיכום הבחירה */}
              <div className="bg-brand-cream rounded-2xl border border-brand-cream-dark p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-brand-dark">סיכום הבקשה</h3>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="inline-flex items-center gap-1 text-xs text-brand-rose font-semibold hover:underline cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" aria-hidden="true" />
                    שינוי
                  </button>
                </div>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-brand-muted">טיפול</dt>
                    <dd className="font-semibold text-brand-dark">
                      {isNatural && form.variant ? form.variant : form.service}
                    </dd>
                  </div>
                  {isNatural && selectedVariant && (
                    <div className="flex justify-between">
                      <dt className="text-brand-muted">מחיר</dt>
                      <dd className="font-semibold text-brand-dark">₪{selectedVariant.price}</dd>
                    </div>
                  )}
                  {isNatural && (
                    <div className="flex justify-between">
                      <dt className="text-brand-muted">מועד</dt>
                      <dd className="font-semibold text-brand-dark">{form.date} · {form.time}</dd>
                    </div>
                  )}
                </dl>
                {!isNatural && (
                  <p className="text-xs text-brand-muted mt-2 pt-2 border-t border-brand-cream-dark">
                    טיפול זה דורש ייעוץ אישי — אחזור אלייך לתיאום מדויק.
                  </p>
                )}
              </div>

              {/* שם */}
              <div>
                <label htmlFor="booking-name" className="block text-sm font-semibold text-brand-dark mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <User className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                    שם מלא
                    <span className="text-brand-rose" aria-hidden="true">*</span>
                  </span>
                </label>
                <input
                  id="booking-name"
                  type="text"
                  value={form.name}
                  onChange={setField('name')}
                  placeholder="מה שמך?"
                  autoComplete="name"
                  aria-required="true"
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? 'err-name' : undefined}
                  className={cn(
                    'w-full px-4 py-3 rounded-2xl border bg-white text-brand-dark placeholder:text-brand-muted text-sm transition-colors outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold',
                    errors.name ? 'border-red-400' : 'border-brand-cream-dark hover:border-brand-gold/50'
                  )}
                />
                {errors.name && <p id="err-name" className="text-red-500 text-xs mt-1">{errors.name}</p>}
              </div>

              {/* טלפון */}
              <div>
                <label htmlFor="booking-phone" className="block text-sm font-semibold text-brand-dark mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                    מספר טלפון
                    <span className="text-brand-rose" aria-hidden="true">*</span>
                  </span>
                </label>
                <input
                  id="booking-phone"
                  type="tel"
                  value={form.phone}
                  onChange={setField('phone')}
                  placeholder="05X-XXXXXXX"
                  autoComplete="tel"
                  dir="ltr"
                  aria-required="true"
                  aria-invalid={!!errors.phone}
                  aria-describedby={errors.phone ? 'err-phone' : undefined}
                  className={cn(
                    'w-full px-4 py-3 rounded-2xl border bg-white text-brand-dark placeholder:text-brand-muted text-sm transition-colors outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold text-left',
                    errors.phone ? 'border-red-400' : 'border-brand-cream-dark hover:border-brand-gold/50'
                  )}
                />
                {errors.phone && <p id="err-phone" className="text-red-500 text-xs mt-1">{errors.phone}</p>}
              </div>

              {/* הערות */}
              <div>
                <label htmlFor="booking-notes" className="block text-sm font-semibold text-brand-dark mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                    הערות נוספות
                    <span className="text-brand-muted text-xs font-normal">(אופציונלי)</span>
                  </span>
                </label>
                <textarea
                  id="booking-notes"
                  value={form.notes}
                  onChange={setField('notes')}
                  placeholder="רגישויות, בקשות מיוחדות, שאלות..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-2xl border border-brand-cream-dark bg-white text-brand-dark placeholder:text-brand-muted text-sm transition-colors outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold hover:border-brand-gold/50 resize-none"
                />
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* ── ניווט ── */}
        <div ref={ctaRef} className="flex items-center gap-3 mt-9 pt-6 border-t border-brand-cream-dark">
          {step > 1 && (
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-1.5 px-5 py-3.5 rounded-full border-2 border-brand-cream-dark text-brand-dark font-semibold text-sm hover:bg-brand-cream transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
              חזרה
            </button>
          )}

          {step < totalSteps ? (
            <button
              type="button"
              onClick={goNext}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-brand-gold text-brand-dark font-bold text-base px-8 py-3.5 rounded-full shadow-gold hover:bg-brand-gold-dark hover:-translate-y-0.5 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
            >
              המשך
              <ArrowRight className="w-4 h-4 rotate-180" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="שליחת בקשה לתור"
              className="flex-1 inline-flex items-center justify-center gap-2.5 bg-brand-gold text-brand-dark font-bold text-base px-8 py-3.5 rounded-full shadow-gold hover:bg-brand-gold-dark hover:-translate-y-0.5 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
            >
              <WhatsAppIcon className="w-5 h-5" />
              שליחת בקשה לתור
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
