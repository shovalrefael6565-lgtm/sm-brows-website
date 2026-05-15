'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronLeft, Check, Calendar, Clock, User, Phone, MessageSquare, Sparkles } from 'lucide-react'
import { cn, WHATSAPP_URL } from '@/lib/utils'

const SERVICES = [
  'מיקרובליידינג',
  'עיצוב גבות טבעי',
  'הרמת גבות',
  'קורס מקצועי',
]

const TIME_SLOTS = [
  '09:00', '10:00', '11:00', '12:00', '13:00',
  '14:00', '15:00', '16:00', '17:00', '18:00',
]

const MONTHS = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
]
const DAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']

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

interface FormData {
  name: string
  phone: string
  service: string
  date: string
  time: string
  notes: string
}

export default function BookingForm() {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<Partial<FormData>>({})

  const [form, setForm] = useState<FormData>({
    name: '', phone: '', service: '', date: '', time: '', notes: '',
  })

  const cells = buildCalendar(viewYear, viewMonth)

  const isPast = (day: number) => {
    const d = new Date(viewYear, viewMonth, day)
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    return d < t
  }

  const isSaturday = (day: number) =>
    new Date(viewYear, viewMonth, day).getDay() === 6

  const isDisabled = (day: number) => isPast(day) || isSaturday(day)

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

  const selectDay = (day: number) => {
    if (isDisabled(day)) return
    setSelectedDay(day)
    setForm(f => ({ ...f, date: fmtDate(viewYear, viewMonth, day), time: '' }))
  }

  const validate = () => {
    const e: Partial<FormData> = {}
    if (!form.name.trim()) e.name = 'שדה חובה'
    if (!form.phone.trim()) e.phone = 'שדה חובה'
    if (!form.service) e.service = 'יש לבחור טיפול'
    if (!form.date) e.date = 'יש לבחור תאריך'
    if (!form.time) e.time = 'יש לבחור שעה'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const buildWhatsAppMessage = () => {
    const lines = [
      'שלום! קיבלתי בקשה לתור 🌸',
      '',
      `👤 שם: ${form.name}`,
      `📞 טלפון: ${form.phone}`,
      `💆 טיפול: ${form.service}`,
      `📅 תאריך: ${form.date}`,
      `⏰ שעה: ${form.time}`,
      form.notes.trim() ? `📝 הערות: ${form.notes}` : '',
    ].filter(l => l !== undefined)
    return encodeURIComponent(lines.join('\n'))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setSubmitted(true)
    const url = `${WHATSAPP_URL}?text=${buildWhatsAppMessage()}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const set = (k: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm(f => ({ ...f, [k]: e.target.value }))
    setErrors(err => ({ ...err, [k]: undefined }))
  }

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="text-center py-16 px-4"
      >
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-brand-rose/10 mb-6">
          <Check className="w-10 h-10 text-brand-rose" />
        </div>
        <h2 className="font-serif text-3xl font-bold text-brand-dark mb-3">
          תודה! הבקשה התקבלה 🌸
        </h2>
        <p className="text-brand-medium text-lg leading-relaxed mb-2 max-w-md mx-auto">
          פתחתי לך חלון וואצאפ עם כל הפרטים — שלחי את ההודעה ואחזור אלייך בהקדם לאישור התור.
        </p>
        <p className="text-brand-muted text-sm mb-8">
          {form.name} | {form.service} | {form.date} בשעה {form.time}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href={`${WHATSAPP_URL}?text=${buildWhatsAppMessage()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold px-8 py-4 rounded-full shadow-lg hover:shadow-xl transition-shadow cursor-pointer"
          >
            <WhatsAppIcon className="w-5 h-5" />
            שלחי את ההודעה בוואצאפ
          </a>
          <button
            type="button"
            onClick={() => { setSubmitted(false); setForm({ name: '', phone: '', service: '', date: '', time: '', notes: '' }); setSelectedDay(null) }}
            className="inline-flex items-center justify-center gap-2 border-2 border-brand-rose-light text-brand-dark font-medium px-8 py-4 rounded-full hover:bg-brand-rose-bg transition-colors cursor-pointer"
          >
            קביעת תור נוסף
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">

        {/* ── Right column: personal info ── */}
        <div className="space-y-5">

          {/* Name */}
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
              onChange={set('name')}
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

          {/* Phone */}
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
              onChange={set('phone')}
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

          {/* Service */}
          <div>
            <label htmlFor="booking-service" className="block text-sm font-semibold text-brand-dark mb-1.5">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                טיפול מבוקש
                <span className="text-brand-rose" aria-hidden="true">*</span>
              </span>
            </label>
            <select
              id="booking-service"
              value={form.service}
              onChange={set('service')}
              aria-required="true"
              aria-invalid={!!errors.service}
              aria-describedby={errors.service ? 'err-service' : undefined}
              className={cn(
                'w-full px-4 py-3 rounded-2xl border bg-white text-brand-dark text-sm transition-colors outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold appearance-none cursor-pointer',
                !form.service && 'text-brand-muted',
                errors.service ? 'border-red-400' : 'border-brand-cream-dark hover:border-brand-gold/50'
              )}
            >
              <option value="" disabled>בחרי טיפול...</option>
              {SERVICES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {errors.service && <p id="err-service" className="text-red-500 text-xs mt-1">{errors.service}</p>}
          </div>

          {/* Notes */}
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
              onChange={set('notes')}
              placeholder="רגישויות, בקשות מיוחדות, שאלות..."
              rows={4}
              className="w-full px-4 py-3 rounded-2xl border border-brand-cream-dark bg-white text-brand-dark placeholder:text-brand-muted text-sm transition-colors outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold hover:border-brand-gold/50 resize-none"
            />
          </div>

          {/* Submit — desktop */}
          <div className="hidden lg:block">
            <SubmitButton form={form} />
          </div>
        </div>

        {/* ── Left column: calendar + time ── */}
        <div className="space-y-6">

          {/* Calendar */}
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
              {/* Month nav */}
              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={nextMonth}
                  aria-label="חודש הבא"
                  className="p-1.5 rounded-lg hover:bg-brand-rose-bg transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5 text-brand-dark" />
                </button>
                <span className="font-semibold text-brand-dark text-sm">
                  {MONTHS[viewMonth]} {viewYear}
                </span>
                <button
                  type="button"
                  onClick={prevMonth}
                  aria-label="חודש קודם"
                  className="p-1.5 rounded-lg hover:bg-brand-rose-bg transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5 text-brand-dark" />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map(d => (
                  <div key={d} className={cn(
                    'text-center text-xs font-semibold py-1',
                    d === 'ש׳' ? 'text-brand-muted/40' : 'text-brand-muted'
                  )}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
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
                        'relative aspect-square flex items-center justify-center text-sm rounded-xl transition-all duration-150 cursor-pointer',
                        disabled
                          ? 'text-brand-muted/30 cursor-not-allowed'
                          : selected
                          ? 'bg-brand-rose text-white font-bold shadow-rose'
                          : isToday
                          ? 'bg-brand-gold/15 text-brand-dark font-semibold hover:bg-brand-rose hover:text-white'
                          : 'text-brand-dark hover:bg-brand-rose/10 hover:text-brand-rose'
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

          {/* Time slots */}
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
                </div>
                {errors.time && <p className="text-red-500 text-xs mb-2">{errors.time}</p>}

                <div
                  className="grid grid-cols-5 gap-2"
                  role="group"
                  aria-label="בחירת שעת הפגישה"
                >
                  {TIME_SLOTS.map(slot => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => {
                        setForm(f => ({ ...f, time: slot }))
                        setErrors(e => ({ ...e, time: undefined }))
                      }}
                      aria-pressed={form.time === slot}
                      aria-label={`שעה ${slot}`}
                      className={cn(
                        'py-2.5 rounded-xl text-sm font-semibold border transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                        form.time === slot
                          ? 'bg-brand-rose text-white border-brand-rose shadow-rose'
                          : 'bg-white text-brand-dark border-brand-cream-dark hover:border-brand-rose hover:text-brand-rose hover:bg-brand-rose-bg'
                      )}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Submit — mobile */}
      <div className="lg:hidden mt-8">
        <SubmitButton form={form} />
      </div>
    </form>
  )
}

function SubmitButton({ form }: { form: FormData }) {
  const complete = form.name && form.phone && form.service && form.date && form.time
  return (
    <button
      type="submit"
      aria-label="שליחת בקשה לתור"
      className={cn(
        'w-full flex items-center justify-center gap-3 font-bold text-base px-8 py-4 rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
        complete
          ? 'bg-brand-gold text-brand-dark shadow-gold hover:bg-brand-gold-dark hover:-translate-y-0.5 cursor-pointer'
          : 'bg-brand-cream-dark text-brand-muted cursor-not-allowed'
      )}
    >
      <WhatsAppIcon className="w-5 h-5" />
      שליחת בקשה לתור
    </button>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
