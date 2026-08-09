'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Calendar, Clock, Check, Plus, X, MessageSquare, Sparkles } from 'lucide-react'
import { cn, WHATSAPP_BASE } from '@/lib/utils'
import { isBookableDate } from '@/lib/bookingWindow'
import { selectDisplaySlots, getIsraelToday, type BusyRange } from '@/lib/slotSelection'
import { POLICY_PATH } from '@/lib/bookingPolicy'
import {
  NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS,
  LIFTING_PRICE, LIFTING_DURATION_MIN, NATURAL_DURATION_MIN,
} from '@/lib/services'

/**
 * קביעת תור מתוך האזור האישי (שלב 15D).
 *
 * ═══ מה זה כן, ומה זה לא ═══
 *
 * ✅ זה המסלול **המאומת**: `POST /api/appointments`, session חובה, הזהות
 *    נקבעת בשרת מול customers.auth_user_id. אין כאן שדה טלפון ואין שדה
 *    שם — אין דרך לקבוע תור עבור לקוחה אחרת.
 *
 * ❌ זה **אינו** עותק של BookingForm. הטופס הציבורי (1411 שורות, כולל
 *    לוח שנה מלא, זרימת WhatsApp והתנהגות שנבדקה בפרודקשן) לא נגעתי בו
 *    ואין להחליף אותו בזה.
 *
 * ═══ מה משותף, ואיפה הוא חי ═══
 *
 * 🔒 **אין כאן שום כלל זמינות משלי.** כל מה שנשען עליו מיובא:
 *   • `selectDisplaySlots` (lib/slotSelection.ts) — אלגוריתם ההצגה, אותו
 *     קובץ שמפעיל את BookingForm ואת RescheduleDialog מאז שלב 7
 *   • `isBookableDate` (lib/bookingWindow.ts) — אילו ימים בכלל פתוחים
 *   • `NATURAL_VARIANTS` / `LIFTING_*` (lib/services.ts) — מחיר ומשך
 *   • `/api/bookings/slots` — אותו מקור תפוסה (Google + Supabase)
 *
 * המבנה הועתק מ-RescheduleDialog, שכבר עושה בדיוק את זה: רצועת תאריכים,
 * רשת שעות, מסך אישור. זה החלק היחיד שדומה, והוא דומה בכוונה.
 *
 * ⚠️ המחיר והמשך המוצגים כאן הם **תצוגה בלבד**. השרת מחשב אותם מחדש
 * מתוך lib/services.ts ולא סומך על שום דבר שמגיע מהדפדפן.
 */

const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

/** כמה ימים קדימה לסרוק — זהה ל-RescheduleDialog, כולל ימי זמינות מיוחדת רחוקים */
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

type ServiceKey = typeof NATURAL_SERVICE | typeof LIFTING_SERVICE

export default function AccountBookingForm() {
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [service, setService] = useState<ServiceKey | null>(null)
  const [variants, setVariants] = useState<string[]>([])
  const [days] = useState<DayOption[]>(() => buildDayOptions(new Date()))
  const [selected, setSelected] = useState<DayOption | null>(null)
  const [busy, setBusy] = useState<BusyRange[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  /**
   * 🔒 השרת לא הצליח לקבוע זמינות — **לא** "היום פנוי". אותה אינווריאנטה
   * כמו ב-BookingForm וב-RescheduleDialog: `data.busy ?? []` על תשובת
   * כישלון היה פותח את כל השעות, כולל שעות תפוסות.
   */
  const [slotsUnavailable, setSlotsUnavailable] = useState(false)
  const [time, setTime] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWhatsApp, setShowWhatsApp] = useState(false)

  const durationMin = service === LIFTING_SERVICE ? LIFTING_DURATION_MIN : NATURAL_DURATION_MIN

  const priceTotal = service === LIFTING_SERVICE
    ? LIFTING_PRICE
    : NATURAL_VARIANTS.filter(v => variants.includes(v.id)).reduce((sum, v) => sum + v.price, 0)

  const fetchBusy = useCallback(async (isoDate: string) => {
    setLoadingSlots(true)
    try {
      const res = await fetch(`/api/bookings/slots?date=${isoDate}`)
      // 🔒 כישלון של מקור זמינות → אין שעות להצגה.
      if (!res.ok) {
        setBusy([])
        setSlotsUnavailable(true)
        return
      }
      const data = await res.json()
      setBusy(data.busy ?? [])
      setSlotsUnavailable(false)
    } catch {
      setBusy([])
      setSlotsUnavailable(true)
    } finally {
      setLoadingSlots(false)
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    setTime(null)
    setBusy([])
    fetchBusy(selected.isoDate)
  }, [selected, fetchBusy])

  // שינוי טיפול משנה את המשך, ולכן גם את רשימת שעות ההתחלה האפשריות
  useEffect(() => { setTime(null) }, [service])

  const slots = selected && !slotsUnavailable
    ? selectDisplaySlots({
        year: selected.year, month: selected.month, day: selected.day,
        busyRanges: busy, durationMin,
      })
    : []

  const toggleVariant = (id: string) => {
    setError(null)
    setVariants(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id])
  }

  const reset = () => {
    setService(null); setVariants([]); setSelected(null); setBusy([])
    setTime(null); setNotes(''); setPolicyAccepted(false)
    setError(null); setShowWhatsApp(false); setSlotsUnavailable(false)
  }

  const canSubmit =
    service !== null &&
    (service === LIFTING_SERVICE || variants.length > 0) &&
    selected !== null &&
    time !== null &&
    policyAccepted

  const submit = async () => {
    if (saving || !canSubmit || !selected || !time || !service) return
    setSaving(true)
    setError(null)
    setShowWhatsApp(false)
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceKey: service,
          variants: service === NATURAL_SERVICE ? variants : [],
          isoDate: selected.isoDate,
          time,
          notes: notes.trim() || undefined,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.message ?? 'לא הצלחנו לשמור את הבקשה. נסי שוב.')
        // ⚠️ כישלון שאין ללקוחה מה לעשות איתו מקבל דרך יציאה לשובל, בדיוק
        // כמו במסלול הציבורי. השעה **לא** נשמרה, וההודעה למעלה אומרת זאת.
        setShowWhatsApp(['server_error', 'blocked', 'feature_disabled', 'shabbat'].includes(data.error))
        // המועד נתפס בינתיים — לרענן את הזמינות כדי שהבחירה תהיה עדכנית
        if (data.error === 'slot_taken') {
          setTime(null)
          fetchBusy(selected.isoDate)
        }
        setSaving(false)
        return
      }

      // ⚠️ אין כאן הודעת הצלחה מקומית: הבקשה החדשה חייבת להופיע ברשימת
      // "התורים הקרובים שלך", שנטענת בשרת. refresh הוא מה שמביא אותה.
      reset()
      setOpen(false)
      setSaving(false)
      router.refresh()
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 bg-brand-dark text-white font-semibold text-sm py-3.5 rounded-2xl shadow-soft hover:bg-brand-dark/90 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
        קביעת תור חדש
      </button>
    )
  }

  return (
    <div className="bg-white border border-brand-linen-dark rounded-2xl shadow-soft overflow-hidden">
      <div className="border-b border-brand-linen-dark px-5 py-4 flex items-center justify-between gap-3">
        <h2 className="font-serif text-lg font-bold text-brand-dark flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-rose" aria-hidden="true" />
          קביעת תור חדש
        </h2>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false) }}
          disabled={saving}
          aria-label="סגירה"
          className="p-1.5 -m-1.5 text-brand-muted hover:text-brand-dark disabled:opacity-50 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* ── הטיפול ── */}
        <div>
          <h3 className="text-sm font-bold text-brand-dark mb-2">בחירת טיפול</h3>
          <div className="grid grid-cols-2 gap-2">
            {([NATURAL_SERVICE, LIFTING_SERVICE] as ServiceKey[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => { setService(s); setVariants([]); setError(null) }}
                className={cn(
                  'px-3 py-3 rounded-xl border text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                  service === s
                    ? 'bg-brand-dark text-white border-brand-dark'
                    : 'bg-white text-brand-dark border-brand-linen-dark hover:border-brand-rose',
                )}
              >
                {s}
                <span className="block text-[11px] font-normal opacity-80 mt-0.5">
                  {s === LIFTING_SERVICE ? `${LIFTING_DURATION_MIN} דק׳ · ₪${LIFTING_PRICE}` : `${NATURAL_DURATION_MIN} דק׳`}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── הווריאנטים, לעיצוב טבעי בלבד ── */}
        {service === NATURAL_SERVICE && (
          <div>
            <h3 className="text-sm font-bold text-brand-dark mb-2">
              מה כולל הטיפול?
              <span className="text-brand-muted text-xs font-normal me-1.5">(ניתן לבחור יותר מאחד)</span>
            </h3>
            <div className="space-y-2">
              {NATURAL_VARIANTS.map(v => {
                const checked = variants.includes(v.id)
                return (
                  <label
                    key={v.id}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                      checked ? 'border-brand-rose bg-brand-rose-bg' : 'border-brand-linen-dark bg-white hover:border-brand-rose/40',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleVariant(v.id)}
                      className="sr-only peer"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex items-center justify-center w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-gold peer-focus-visible:ring-offset-2',
                        checked ? 'border-brand-rose bg-brand-rose' : 'border-brand-cream-dark bg-white',
                      )}
                    >
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-brand-dark">{v.label}</span>
                        <span className="text-sm font-bold text-brand-dark flex-shrink-0">₪{v.price}</span>
                      </span>
                      <span className="block text-xs text-brand-muted mt-0.5">{v.desc}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {/* ── התאריך ── */}
        {service && (service === LIFTING_SERVICE || variants.length > 0) && (
          <div>
            <h3 className="text-sm font-bold text-brand-dark mb-2 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-brand-rose" aria-hidden="true" />
              בחירת תאריך
            </h3>
            {days.length === 0 ? (
              <p className="text-xs text-brand-muted">אין כרגע תאריכים פנויים. אפשר לפנות לשובל בוואטסאפ.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                {days.map(d => (
                  <button
                    key={d.isoDate}
                    type="button"
                    onClick={() => setSelected(d)}
                    className={cn(
                      'flex-shrink-0 min-w-[76px] px-3 py-2 rounded-xl border text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                      selected?.isoDate === d.isoDate
                        ? 'bg-brand-dark text-white border-brand-dark'
                        : 'bg-white text-brand-dark border-brand-linen-dark hover:border-brand-rose',
                    )}
                  >
                    <span className="block text-[11px] opacity-80">{d.dayName}</span>
                    <span className="block text-sm font-semibold">{d.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── השעה ── */}
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
                    onClick={() => { setTime(s); setError(null) }}
                    className={cn(
                      'py-2 rounded-xl border text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                      time === s
                        ? 'bg-brand-dark text-white border-brand-dark'
                        : 'bg-white text-brand-dark border-brand-linen-dark hover:border-brand-rose',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── הערות ומדיניות ── */}
        {time && (
          <>
            <div>
              <label htmlFor="account-booking-notes" className="block text-sm font-bold text-brand-dark mb-1.5">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                  הערות נוספות
                  <span className="text-brand-muted text-xs font-normal">(אופציונלי)</span>
                </span>
              </label>
              <textarea
                id="account-booking-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="רגישויות, בקשות מיוחדות, שאלות..."
                rows={3}
                maxLength={1000}
                className="w-full px-4 py-3 rounded-xl border border-brand-linen-dark bg-white text-brand-dark placeholder:text-brand-muted text-sm outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold resize-none"
              />
            </div>

            <label
              className={cn(
                'flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors',
                policyAccepted ? 'border-brand-rose bg-brand-rose-bg' : 'border-brand-linen-dark bg-white hover:border-brand-rose/40',
              )}
            >
              <input
                type="checkbox"
                checked={policyAccepted}
                onChange={e => { setPolicyAccepted(e.target.checked); setError(null) }}
                aria-required="true"
                className="sr-only peer"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'flex items-center justify-center w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-gold peer-focus-visible:ring-offset-2',
                  policyAccepted ? 'border-brand-rose bg-brand-rose' : 'border-brand-cream-dark bg-white',
                )}
              >
                {policyAccepted && <Check className="w-3 h-3 text-white" />}
              </span>
              <span className="text-sm text-brand-dark leading-relaxed">
                קראתי ואני מאשרת את{' '}
                <Link
                  href={POLICY_PATH}
                  target="_blank"
                  onClick={e => e.stopPropagation()}
                  className="font-semibold text-brand-rose underline hover:text-brand-rose/80"
                >
                  מדיניות קביעת התורים, השינויים והביטולים
                </Link>{' '}
                של S.M BROWS
              </span>
            </label>

            <div className="bg-brand-cream/60 border border-brand-cream-dark rounded-xl p-3 text-xs text-brand-medium leading-relaxed space-y-1">
              <p>
                <span className="font-semibold text-brand-dark">{service}</span>
                {service === NATURAL_SERVICE && variants.length > 0 && ` · ${variants.length} טיפולים`}
                {' · '}{durationMin} דק׳{priceTotal > 0 && ` · ₪${priceTotal}`}
              </p>
              <p>{selected?.dayName}, {selected?.label} בשעה {time}</p>
              {/* ⚠️ הבקשה אינה תור. הניסוח כאן זהה בכוונה לזה של המסלול הציבורי. */}
              <p className="text-brand-muted">
                הבקשה תישלח לאישור שובל. השעה שמורה עבורך עד לאישור.
              </p>
            </div>
          </>
        )}

        {error && <p role="alert" className="text-red-500 text-xs">{error}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || saving}
          className="w-full inline-flex items-center justify-center gap-2 bg-brand-dark text-white font-semibold text-sm py-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          שליחת הבקשה
        </button>

        {showWhatsApp && (
          <a
            href={WHATSAPP_BASE}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs font-semibold text-[#25D366] hover:underline"
          >
            פנייה לשובל בוואטסאפ
          </a>
        )}
      </div>
    </div>
  )
}
