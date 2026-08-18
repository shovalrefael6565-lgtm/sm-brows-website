'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronRight, ChevronLeft, Check, Calendar, Clock, User, Phone,
  MessageSquare, Sparkles, ArrowRight, ArrowDown, Pencil, Moon, Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { cn, WHATSAPP_BASE, WHATSAPP_URL } from '@/lib/utils'
import { POLICY_PATH } from '@/lib/bookingPolicy'
import {
  PRIVACY_PATH, PRIVACY_NOTICE_VERSION, BOOKING_PRIVACY_NOTICE,
  NOTES_SENSITIVE_INFO_NOTICE, PRIVACY_ACK_ERROR, PRIVACY_ACK_LABEL,
  splitPrivacyLink, splitNoticeLinks,
} from '@/lib/privacyNotice'
import { isSpecialDay } from '@/lib/specialAvailability'
import {
  getIsraelToday, selectVisibleSlots, filterLiftingStarts,
} from '@/lib/slotSelection'
import { businessDayOffset as businessDayOffsetOf } from '@/lib/bookingWindow'
import { isValidIsraeliMobile, formatPhoneForDisplay } from '@/lib/phone'
import { buildBookingRequestMessage } from '@/lib/whatsappTemplates'
import {
  NATURAL_SERVICE as NATURAL, LIFTING_SERVICE as LIFTING,
  LIFTING_PRICE, LIFTING_DURATION_MIN as LIFTING_MINUTES, NATURAL_VARIANTS,
} from '@/lib/services'

interface ServiceOption {
  name: string
  online: boolean
  desc: string
}

const SERVICES: ServiceOption[] = [
  { name: NATURAL,          online: true,  desc: 'עיצוב מדויק המדגיש את יופי הפנים הטבעי' },
  { name: 'מיקרובליידינג',  online: false, desc: 'קעקוע קוסמטי לגבות מושלמות עד שנה' },
  { name: LIFTING,          online: true,  desc: 'הרמה ועיצוב הגבות — 40 דקות' },
  { name: 'קורס מקצועי',    online: false, desc: 'הכשרה מקצועית לאמניות גבות' },
]

const MONTHS = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
]
const DAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']

function pad(n: number) {
  return n.toString().padStart(2, '0')
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

/**
 * ימי עסקים מהיום (ישראל) עד התאריך הנבחר, פוסח על שישי+שבת.
 * עטיפה דקה סביב המימוש המשותף ב-lib/bookingWindow.ts, שממנו ניזון גם
 * אלגוריתם ההצגה (lib/slotSelection.ts) וגם האימות בשרת.
 */
function businessDayOffset(year: number, month: number, day: number): number {
  return businessDayOffsetOf(year, month, day)
}

interface FormData {
  name: string
  phone: string
  service: string
  variants: string[]
  date: string
  /** תאריך ISO (YYYY-MM-DD) הנלווה ל-date — נשלח לשרת, date היא רק לתצוגה */
  isoDate: string
  time: string
  notes: string
  policyAccepted: boolean
  privacyNoticeAcknowledged: boolean
}

type FieldErrors = Partial<Record<keyof FormData, string>>

const EMPTY_FORM: FormData = {
  name: '', phone: '', service: '', variants: [], date: '', isoDate: '', time: '', notes: '',
  policyAccepted: false, privacyNoticeAcknowledged: false,
}

/**
 * מצב שמירת הבקשה — רלוונטי רק לטיפולים עם יומן.
 *
 * ⚠️ משלב 15B אין כאן שלב OTP. המסלול הציבורי אינו דורש התחברות, והבקשה
 * נשמרת לפי הטלפון שהוקלד (ראה app/api/bookings/request). האזור האישי
 * הוא מסלול נפרד ומאומת, ואינו עובר דרך הקומפוננטה הזו.
 */
type BookingPhase = 'form' | 'saving'

/**
 * כשל שמירה שהלקוחה צריכה לראות.
 *
 * ⚠️ `fallback` אינו קישוט: הוא מה שמונע silent failure. כשהבקשה **לא**
 * נשמרה, הלקוחה חייבת גם לדעת את זה וגם לקבל דרך להגיע לשובל בכל זאת —
 * אחרת אנחנו מאבדים אותה בשקט.
 */
interface SaveFailure {
  message: string
  fallback: boolean
}

interface SessionInfo {
  loggedIn: boolean
  phone?: string
  fullName?: string
}

/**
 * מצב שבת לצד-הלקוח. נשען על מקור האמת היחיד (lib/shabbat.ts) דרך /api/shabbat.
 * נבדק שוב כל דקה כדי שהמערכת תחזור לפעילות אוטומטית 30 דק' אחרי צאת השבת,
 * בלי רענון ידני. fail-open: בכל שגיאה מתייחסים כלא-שבת (לא נועלים בטעות ביום חול).
 */
function useShabbat(): boolean {
  const [shabbat, setShabbat] = useState(false)
  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const res = await fetch('/api/shabbat', { cache: 'no-store' })
        const data = await res.json()
        if (alive) setShabbat(Boolean(data.shabbat))
      } catch {
        if (alive) setShabbat(false)
      }
    }
    check()
    const id = setInterval(check, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return shabbat
}

/** כרטיס מידע אסתטי שמוצג במקום מערכת ההזמנות בזמן שבת */
function ShabbatClosedCard() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="text-center py-12 px-4"
      role="status"
    >
      <div className="relative inline-flex items-center justify-center w-20 h-20 mb-6">
        <span className="absolute inset-0 rounded-full bg-brand-gold/15" aria-hidden="true" />
        <span className="relative inline-flex items-center justify-center w-20 h-20 rounded-full bg-brand-gold/20 border border-brand-gold/40">
          <Moon className="w-9 h-9 text-brand-gold-dark" aria-hidden="true" />
        </span>
      </div>
      <h2 className="font-serif text-3xl font-bold text-brand-dark mb-3">
        המערכת אינה פעילה בשבת
      </h2>
      <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-md mx-auto">
        נשמח לעמוד לרשותך במוצאי שבת 🤍
      </p>
      <div className="flex items-center justify-center gap-3 mt-7">
        <span className="w-10 h-px bg-brand-gold/40" aria-hidden="true" />
        <span className="text-brand-gold font-serif text-xl select-none" aria-hidden="true">✦</span>
        <span className="w-10 h-px bg-brand-gold/40" aria-hidden="true" />
      </div>
    </motion.div>
  )
}

interface BookingFormProps {
  /**
   * מגיע מ-lib/featureFlags.ts דרך app/booking/page.tsx (server component) —
   * הקומפוננטה הזו לעולם לא קוראת process.env בעצמה. כשכבוי, גם טיפולי
   * יומן (הרמת גבות / עיצוב טבעי) חוזרים לזרימת הוואטסאפ הישנה בלבד,
   * בדיוק כמו לפני שלבים 1–3.
   */
  newBookingSystemEnabled: boolean
}

export default function BookingForm({ newBookingSystemEnabled }: BookingFormProps) {
  const shabbat = useShabbat()
  const today  = getIsraelToday()
  const ctaRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(1)
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [busyRanges, setBusyRanges] = useState<{ start: string; end: string }[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  /**
   * 🔒 השרת לא הצליח לקבוע זמינות (503) — **לא** "היום פנוי".
   *
   * ⚠️ בלי הדגל הזה, `data.busy ?? []` היה מתרגם כל תשובת כישלון לרשימת
   * תפוסה ריקה, כלומר לוח שבו כל השעות לחיצות. השרת כבר לא שולח `busy`
   * בתשובת כישלון, וכאן נסגרת אותה דלת גם בצד הלקוח.
   */
  const [slotsUnavailable, setSlotsUnavailable] = useState(false)

  // ── שמירת הבקשה (רק לטיפולים עם יומן — natural/lifting) ──
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [phase, setPhase] = useState<BookingPhase>('form')
  const [saveError, setSaveError] = useState<SaveFailure | null>(null)
  // חלון וואטסאפ שנפתח ריק בתוך אירוע הלחיצה הסינכרוני (ראה handleSubmit) —
  // כדי שחוסמי פופאפים לא יחסמו את הניווט המאוחר יותר, אחרי אימות/שמירה
  // אסינכרוניים. window.open בתוך async לאחר await כמעט תמיד נחסם.
  const pendingWhatsAppWin = useRef<Window | null>(null)

  // ה-refs משקפים תמיד את ה-state העדכני, כך שהניווט בין השלבים מאמת מולו גם
  // תחת עומס / רינדור איטי — מונע את השגיאה "בחרי טיפול" אחרי שכבר נבחר טיפול.
  // מסונכרנים בכל רינדור (כאן), וגם באופן סינכרוני ברגע הבחירה (selectService).
  const formRef = useRef(form)
  const stepRef = useRef(step)
  // הסנכרון בזמן ה-render עצמו הוא מכוון (ראה הערה למעלה) — מעביר ל-effect
  // היה מחזיר בדיוק את מרוץ ה-stale closure שהתבנית הזו נועדה למנוע.
  // eslint-disable-next-line react-hooks/refs
  formRef.current = form
  // eslint-disable-next-line react-hooks/refs
  stepRef.current = step

  // אזור בחירת סוג הטיפול — כדי לגלול אליו אם ניסו להמשיך בלי לבחור
  const variantRef = useRef<HTMLDivElement>(null)

  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }

  const isNatural = form.service === NATURAL
  const isLifting = form.service === LIFTING
  const isCalendar = isNatural || isLifting
  // כשהדגל כבוי, גם טיפולי יומן נשארים בזרימת הוואטסאפ הישנה — אין OTP
  // ואין שמירה ב-Supabase, בדיוק כמו לפני שלבים 1–3.
  const newFlowActive = newBookingSystemEnabled && isCalendar
  const cells = buildCalendar(viewYear, viewMonth)

  /**
   * הזמינות המוצגת. האלגוריתם עצמו חי ב-lib/slotSelection.ts — מקור אמת
   * משותף לעמוד קביעת התור ולמסך שינוי המועד באזור האישי, כדי ששניהם
   * יציגו בדיוק את אותה זמינות מצומצמת ומבוקרת.
   */
  const visibleSlots = selectedDay === null || slotsUnavailable
    ? []
    : selectVisibleSlots({
        year: viewYear,
        month: viewMonth,
        day: selectedDay,
        busyRanges,
      })

  const minToHHMM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
  const liftingStarts = filterLiftingStarts(visibleSlots)
  const displaySlots = isLifting ? liftingStarts : visibleSlots

  // שלבים: טיפול עם יומן (טבעי/הרמת גבות) → 3 שלבים | שאר → 2 שלבים
  const stepLabels = isCalendar
    ? ['בחירת טיפול', 'בחירת מועד', 'פרטים ואישור']
    : ['בחירת טיפול', 'פרטים ואישור']
  const totalSteps = stepLabels.length

  const selectedVariants = NATURAL_VARIANTS.filter(v => form.variants.includes(v.id))
  const totalPrice = selectedVariants.reduce((sum, v) => sum + v.price, 0)

  // סיכום אחוד לטבעי / הרמת גבות
  const summaryTreatment = isNatural
    ? selectedVariants.map(v => v.label).join(' + ')
    : isLifting ? LIFTING : form.service
  const summaryPrice = isNatural ? totalPrice : isLifting ? LIFTING_PRICE : 0
  const liftingRange = form.time ? `${form.time}–${minToHHMM(toMin(form.time) + LIFTING_MINUTES)}` : ''

  const fetchTakenSlots = useCallback(async (isoDate: string) => {
    setLoadingSlots(true)
    try {
      const res = await fetch(`/api/bookings/slots?date=${isoDate}`)
      // 🔒 כישלון של מקור זמינות → אין שעות לבחירה. לא רשימה ריקה של תפוסה.
      if (!res.ok) {
        setBusyRanges([])
        setSlotsUnavailable(true)
        return
      }
      const data = await res.json()
      setBusyRanges(data.busy ?? [])
      setSlotsUnavailable(false)
    } catch {
      // ⚠️ גם תקלת רשת בצד הלקוח היא "אין תשובה", לא "היום פנוי".
      setBusyRanges([])
      setSlotsUnavailable(true)
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
      if (
        businessDayOffset(viewYear, viewMonth, d) <= 6 ||
        isSpecialDay(viewYear, viewMonth, d)
      ) {
        hasAvailable = true
        break
      }
    }
    // מפל שינויי state תלוי-זה-בזה (יום→חודש→שנה, אפשרי קסקדה בין חודשים
    // רצופים ריקים) על תצוגת היומן החיה בטופס ההזמנות — מעבר לתבנית
    // "התאמה בזמן ה-render" מסכן שינוי התנהגות בניווט החודשים בלי בדיקה
    // אינטראקטיבית מלאה. disable נקודתי, לא שינוי התנהגות.
    if (!hasAvailable) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // בדיקת session חד-פעמית — כדי שלקוחה מחוברת לא תתבקש OTP שוב בקביעת תור
  //
  // ⚠️ כשהמערכת החדשה כבויה אין OTP ואין אזור אישי, ולכן אין למי לשמור על
  // הכניסה — הבקשה הייתה מיותרת, והיא הייתה הפנייה היחידה שנשארה מ-/booking
  // ל-Supabase במצב כבוי. השרת חוסם אותה ממילא (403), וזה מונע גם את הנסיעה.
  // הענף ה"כבוי" כאן נגזר טהור מ-newBookingSystemEnabled (primitive יציב),
  // אך הענף השני מבצע fetch אמיתי ל-session — לא ניתן לפצל בלי לשנות את
  // זרימת ה-effect המשולבת. disable נקודתי, לא שינוי התנהגות.
  useEffect(() => {
    if (!newBookingSystemEnabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession({ loggedIn: false })
      return
    }
    let alive = true
    fetch('/api/auth/session')
      .then(res => res.json())
      .then(data => { if (alive) setSession(data) })
      .catch(() => { if (alive) setSession({ loggedIn: false }) })
    return () => { alive = false }
  }, [newBookingSystemEnabled])

  // מילוי מוקדם של שם/טלפון מה-session — רק אם השדה עדיין ריק, כדי לא
  // לדרוס הקלדה שכבר התחילה
  // תלוי ב-session שמגיע מה-effect הקודם (fetch אסינכרוני) — לא state נגזר
  // טהור בזמן ה-render. disable נקודתי, לא שינוי התנהגות.
  useEffect(() => {
    if (!session?.loggedIn) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(f => ({
      ...f,
      phone: f.phone || (session.phone ? formatPhoneForDisplay(session.phone) : f.phone),
      name: f.name || session.fullName || f.name,
    }))
  }, [session])

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
  /**
   * מעבר ל-6 ימי עסקים מהיום — לא ניתן להזמין דרך האתר,
   * למעט תאריכים שנפתחו במפורש בזמינות המיוחדת (lib/specialAvailability.ts)
   */
  const isBeyondWindow = (day: number) =>
    businessDayOffset(viewYear, viewMonth, day) > 6 &&
    !isSpecialDay(viewYear, viewMonth, day)
  const isDisabled = (day: number) =>
    isPast(day) || isClosedDay(day) || isBeyondWindow(day)

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
    setSelectedDay(null)
    setForm(f => ({ ...f, date: '', isoDate: '', time: '' }))
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
    setSelectedDay(null)
    setForm(f => ({ ...f, date: '', isoDate: '', time: '' }))
  }

  const toIsoDate = (year: number, month: number, day: number) =>
    `${year}-${pad(month + 1)}-${pad(day)}`

  const selectDay = (day: number) => {
    if (isDisabled(day)) return
    const iso = toIsoDate(viewYear, viewMonth, day)
    setSelectedDay(day)
    setBusyRanges([])
    setForm(f => ({ ...f, date: fmtDate(viewYear, viewMonth, day), isoDate: iso, time: '' }))
    setErrors(e => ({ ...e, date: undefined }))
    fetchTakenSlots(iso)
  }

  const selectService = (name: string) => {
    const next: FormData = {
      ...formRef.current,
      service: name,
      variants: name === NATURAL ? formRef.current.variants : [],
      date: '', time: '',
    }
    formRef.current = next   // סינכרוני — זמין מיד גם אם הרינדור מתעכב
    setForm(next)
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

  // ── ניווט בין שלבים ── (מאמת מול ה-refs העדכניים, לא מול closure ישן)
  const validateStep = (s: number): boolean => {
    const f = formRef.current
    const isNat = f.service === NATURAL
    const isCal = isNat || f.service === LIFTING
    const e: FieldErrors = {}
    if (s === 1 && !f.service) e.service = 'יש לבחור טיפול'
    if (s === 2 && isCal) {
      if (isNat && f.variants.length === 0) e.variants = 'יש לבחור סוג טיפול אחד לפחות'
      if (!f.date) e.date = 'יש לבחור תאריך'
      if (!f.time) e.time = 'יש לבחור שעה'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const goNext = () => {
    const s = stepRef.current
    if (!validateStep(s)) {
      // אם נחסמו כי לא נבחר סוג טיפול — לגלול אל הבחירה כדי שהקריאה תהיה מול העיניים
      const f = formRef.current
      if (s === 2 && f.service === NATURAL && f.variants.length === 0) {
        setTimeout(() => variantRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
      }
      return
    }
    const f = formRef.current
    const total = (f.service === NATURAL || f.service === LIFTING) ? 3 : 2
    setStep(cur => Math.min(cur + 1, total))
  }
  const goBack = () => {
    setErrors({})
    setStep(s => Math.max(s - 1, 1))
  }

  const validateFinal = () => {
    const f = formRef.current
    const isCal = f.service === NATURAL || f.service === LIFTING
    const e: FieldErrors = {}
    if (!f.name.trim()) e.name = 'שדה חובה'
    if (!f.phone.trim()) e.phone = 'שדה חובה'
    // ולידציית פורמט טלפון מלאה רק לטיפולים עם יומן — הם היחידים שעוברים
    // דרך OTP ו-DB, וצריכים מספר E.164 תקין. שאר הטיפולים (וואטסאפ בלבד)
    // נשארים בהתנהגות הקיימת — כל שדה לא ריק מתקבל.
    else if (isCal && !isValidIsraeliMobile(f.phone)) e.phone = 'יש להזין מספר נייד ישראלי תקין'
    if (!f.policyAccepted) e.policyAccepted = 'יש לאשר את מדיניות התורים והביטולים כדי להמשיך'
    if (!f.privacyNoticeAcknowledged) e.privacyNoticeAcknowledged = PRIVACY_ACK_ERROR
    setErrors(e)
    return Object.keys(e).length === 0
  }

  /**
   * ⚠️ הנוסח עצמו חי ב-lib/whatsappTemplates.ts ולא כאן — כדי שהאזור האישי
   * (15D) ישלח בדיוק את אותה הודעה, בלי עותק שני שיתבדר.
   *
   * ⚠️ אין כאן שורת אישור מדיניות: האישור הוא תנאי חוסם ב-validateFinal,
   * ולכן הוא תמיד נכון ואינו מוסיף מידע. `policy_version` ממשיך להישמר
   * על שורת התור ב-DB.
   *
   * 🔒 שלב 8 — ההערות החופשיות (form.notes) אינן נשלחות להודעת הוואטסאפ.
   * הצמצום חל על כל הודעת WhatsApp שהקוד בונה, לא רק על אלה ששובל שולחת —
   * ראה lib/whatsappTemplates.ts.
   */
  const buildWhatsAppMessage = () =>
    encodeURIComponent(
      buildBookingRequestMessage({
        customerName: form.name,
        phone: form.phone,
        treatment: isCalendar ? summaryTreatment : form.service,
        priceTotal: isCalendar ? summaryPrice : 0,
        priceIsSum: isNatural,
        dateLabel: form.date || undefined,
        timeLabel: form.time ? (isLifting ? liftingRange : form.time) : undefined,
      }),
    )

  /**
   * פותחת חלון וואטסאפ ריק *עכשיו*, בתוך אירוע הלחיצה הסינכרוני (לפני כל
   * await) — כדי שחוסמי פופאפים לא יחסמו אותו. הניווט בפועל ל-URL קורה
   * מאוחר יותר, אחרי שהשמירה/האימות האסינכרוניים הצליחו, דרך הפניית
   * ה-window שכבר פתוח. window.open שנקרא אחרי await כמעט תמיד נחסם,
   * ולכן אי אפשר פשוט לדחות את הפתיחה עצמה לרגע שבו יש כתובת.
   */
  const openBlankWhatsAppWindow = () => {
    const win = window.open('', '_blank')
    if (win) win.opener = null
    pendingWhatsAppWin.current = win
  }

  /** מנווטת את החלון שנפתח מראש ל-URL הסופי, עם נפילה חזרה לניווט מלא */
  const navigatePendingWhatsApp = (url: string) => {
    const win = pendingWhatsAppWin.current
    pendingWhatsAppWin.current = null
    try {
      if (win && !win.closed) {
        win.location.href = url
        return
      }
    } catch {
      // ignore — נופלים לפתיחה/ניווט רגילים למטה
    }
    const fresh = window.open(url, '_blank')
    if (fresh) fresh.opener = null
    // ניווט דפדפן מלא סטנדרטי בתוך event handler (לא render) — לא state/ref
    // של React. הכלל מזהה זאת כמוטציה על משתנה חיצוני (window) בטעות.
    // eslint-disable-next-line react-hooks/immutability
    else window.location.href = url
  }

  const closePendingWhatsApp = () => {
    try { pendingWhatsAppWin.current?.close() } catch { /* noop */ }
    pendingWhatsAppWin.current = null
  }

  /**
   * שולחת את בקשת התור ל-DB. מחזירה תוצאה מובנית — לעולם לא זורקת.
   *
   * ⚠️ המסלול הציבורי: `/api/bookings/request`, בלי session ובלי OTP.
   * השם והטלפון נשלחים בגוף הבקשה ומשמשים לאיתור/יצירת הלקוחה בשרת.
   * `/api/appointments` נשאר המסלול המאומת של האזור האישי.
   */
  const saveAppointment = async (): Promise<{ ok: true } | ({ ok: false } & SaveFailure)> => {
    const f = formRef.current
    try {
      const res = await fetch('/api/bookings/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceKey: f.service,
          variants: f.service === NATURAL ? f.variants : [],
          isoDate: f.isoDate,
          time: f.time,
          notes: f.notes,
          fullName: f.name,
          phone: f.phone,
          privacyNoticeAcknowledged: f.privacyNoticeAcknowledged,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return {
          ok: false,
          message: data.message ?? 'לא הצלחנו לשמור את הבקשה.',
          fallback: Boolean(data.whatsappFallback),
        }
      }
      return { ok: true }
    } catch {
      // ⚠️ תקלת רשת היא כישלון שמירה לכל דבר, ולכן מציעה את אותו מסלול
      // חלופי — הלקוחה לא נשארת בלי דרך להגיע לשובל.
      return { ok: false, message: 'אין חיבור לאינטרנט. הבקשה לא נשמרה.', fallback: true }
    }
  }

  /**
   * שמירה ב-DB, ורק אחרי הצלחה — ניווט חלון הוואטסאפ שכבר פתוח.
   *
   * 🔒 אם השמירה נכשלת, החלון הריק נסגר ולא נפתחת שום הודעת וואטסאפ:
   * הלקוחה **לעולם** לא רואה "נשלח" על בקשה שאינה במערכת. במקום זה היא
   * מקבלת הודעה מפורשת, ובמקרים המתאימים גם כפתור וואטסאפ שמבהיר
   * שהבקשה לא נשמרה.
   */
  const finalizeBooking = async () => {
    setPhase('saving')
    setSaveError(null)
    const result = await saveAppointment()

    if (!result.ok) {
      setSaveError({ message: result.message, fallback: result.fallback })
      setPhase('form')
      closePendingWhatsApp()
      // יתכן שהשעה נתפסה הרגע (409) — מרעננים את הזמינות כדי שהסלוט
      // התפוס ייעלם מהרשימה ולא תנסה שוב על אותה שעה
      if (formRef.current.isoDate) fetchTakenSlots(formRef.current.isoDate)
      return
    }

    window.gtag?.('event', 'booking_request', {
      treatment: summaryTreatment,
      selected_date: formRef.current.date,
      selected_time: formRef.current.time,
    })

    setSubmitted(true)
    navigatePendingWhatsApp(`${WHATSAPP_BASE}?text=${buildWhatsAppMessage()}`)
  }

  /**
   * זרימת הוואטסאפ המקורית — ללא DB, ללא OTP, בלי שום שינוי מהקיים.
   * משמשת גם כשהדגל כבוי (ואז זו הזרימה היחידה) וגם כאפשרות המשנית
   * "בלי להתחבר" כשהדגל פעיל לטיפולי יומן.
   */
  const openLegacyWhatsApp = () => {
    window.gtag?.('event', 'booking_request', {
      treatment: form.service, selected_date: form.date, selected_time: form.time,
    })
    setSubmitted(true)
    const url = `${WHATSAPP_BASE}?text=${buildWhatsAppMessage()}`
    const win = window.open(url, '_blank')
    if (win) win.opener = null
    // ניווט דפדפן מלא סטנדרטי בתוך event handler (לא render) — לא state/ref
    // של React. הכלל מזהה זאת כמוטציה על משתנה חיצוני (window) בטעות.
    // eslint-disable-next-line react-hooks/immutability
    else window.location.href = url
  }

  /**
   * ⚠️ זרימה אחת בלבד. אין הסתעפות לפי מצב התחברות ואין מסלול "בלי
   * להתחבר" — כל בקשה שנשלחת מהטופס הציבורי נשמרת ב-DB לפני שנפתחת
   * הודעת וואטסאפ. זו האכיפה בפועל של סעיף 2 בחזון: כל בקשה מתועדת.
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (shabbat) return // נעילת שבת — הגנה נוספת מעבר להחלפת הטופס בכרטיס
    if (!validateFinal()) return

    if (!newFlowActive) {
      openLegacyWhatsApp()
      return
    }

    openBlankWhatsAppWindow() // עדיין בתוך הלחיצה הסינכרונית
    void finalizeBooking()
  }

  const resetAll = () => {
    setSubmitted(false)
    setForm(EMPTY_FORM)
    setSelectedDay(null)
    setStep(1)
    setErrors({})
    setPhase('form')
    setSaveError(null)
  }

  const setField = (k: keyof FormData) => (
    ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm(f => ({ ...f, [k]: ev.target.value }))
    setErrors(err => ({ ...err, [k]: undefined }))
  }

  // ── נעילת שבת — מחליפה את כל מערכת ההזמנות בכרטיס המידע ──
  if (shabbat) {
    return <ShabbatClosedCard />
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
        {isCalendar ? (
          <p className="text-brand-medium text-base leading-relaxed mb-2 max-w-md mx-auto">
            הבקשה נשמרה במערכת בסטטוס{' '}
            <span className="font-semibold text-brand-dark">ממתינה לאישור</span>.
            פתחתי לך חלון וואצאפ עם כל הפרטים — שלחי את ההודעה ושובל תאשר את התור בהקדם.
          </p>
        ) : (
          <p className="text-brand-medium text-base leading-relaxed mb-2 max-w-md mx-auto">
            פתחתי לך חלון וואצאפ עם כל הפרטים — שלחי את ההודעה ואחזור אלייך בהקדם לאישור התור.
          </p>
        )}
        <p className="text-brand-muted text-xs leading-relaxed mb-4 max-w-md mx-auto">
          אישור הקביעה כולל הסכמה{' '}
          <Link href={POLICY_PATH} className="underline hover:text-brand-rose-text transition-colors">
            למדיניות השינויים והביטולים
          </Link>{' '}
          של S.M BROWS.
        </p>
        <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-brand-muted text-sm mb-8 bg-brand-cream rounded-2xl px-4 py-2">
          <span className="font-semibold text-brand-dark">{form.name}</span>
          <span aria-hidden="true">·</span>
          <span>{summaryTreatment}</span>
          {isCalendar && (
            <>
              <span aria-hidden="true">·</span>
              <span>{form.date} בשעה {isLifting ? liftingRange : form.time}</span>
            </>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href={`${WHATSAPP_BASE}?text=${buildWhatsAppMessage()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-brand-whatsapp-dark text-white font-bold px-8 py-4 rounded-full shadow-lg hover:shadow-xl transition-shadow cursor-pointer"
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
        {isCalendar && (
          <div className="mt-6">
            <Link
              href="/account"
              className="inline-flex items-center gap-1.5 text-brand-rose-text font-semibold text-sm underline hover:text-brand-rose-text/80 transition-colors cursor-pointer"
            >
              צפייה באזור האישי
            </Link>
          </div>
        )}
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
        {/* שלבים מתחלפים ללא AnimatePresence mode="wait" — הוא היה גורם לתקיעה
            לסירוגין (השלב הבא לא נטען). כל שלב מותנה ומוצג לבדו, החלפה מיידית. */}

          {/* ═══ שלב 1 — בחירת טיפול ═══ */}
          {step === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
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
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-gold-text">
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

          {/* ═══ שלב 2 (טבעי / הרמת גבות) — בחירת מועד ═══ */}
          {step === 2 && isCalendar && (
            <motion.div
              key="step-2-calendar"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-7"
            >
              {/* הרמת גבות — באנר מחיר ומשך (ללא וריאציות) */}
              {isLifting && (
                <div className="flex items-center justify-between gap-2 bg-brand-rose-bg border border-brand-rose-light rounded-2xl p-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-brand-rose" aria-hidden="true" />
                    <span className="text-sm font-semibold text-brand-dark">הרמת גבות · 40 דקות</span>
                  </div>
                  <span className="font-serif text-lg font-bold text-brand-rose-text whitespace-nowrap">₪{LIFTING_PRICE}</span>
                </div>
              )}

              {/* בחירת סוג טיפול + מחיר — בחירה מרובה (טבעי בלבד) */}
              {isNatural && (
              <div ref={variantRef} className="scroll-mt-24">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-brand-rose" aria-hidden="true" />
                  <span className="text-base sm:text-lg font-bold text-brand-dark">
                    בחרי סוג טיפול
                    <span className="text-brand-rose ms-1" aria-hidden="true">*</span>
                  </span>
                </div>

                {/* קריאה בולטת — כל עוד לא נבחר סוג טיפול. הופכת לאדומה אם ניסו להמשיך */}
                {form.variants.length === 0 && (
                  <div
                    role="status"
                    className={cn(
                      'flex items-center gap-2.5 rounded-2xl px-4 py-3 mb-3 border-2',
                      errors.variants
                        ? 'bg-red-50 border-red-300 animate-pulse'
                        : 'bg-brand-gold/15 border-brand-gold/50'
                    )}
                  >
                    <ArrowDown
                      className={cn('w-5 h-5 flex-shrink-0', errors.variants ? 'text-red-500' : 'text-brand-gold-dark')}
                      aria-hidden="true"
                    />
                    <p className={cn('text-sm sm:text-base font-bold', errors.variants ? 'text-red-600' : 'text-brand-gold-text')}>
                      {errors.variants
                        ? 'רגע 🙂 יש לבחור סוג טיפול אחד לפחות כדי להמשיך'
                        : 'כדי להמשיך — בחרי לפחות סוג טיפול אחד מהאפשרויות שלמטה'}
                    </p>
                  </div>
                )}

                <p className="text-brand-muted text-xs mb-3">אפשר לבחור יותר מסוג טיפול אחד לאותו תור</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {NATURAL_VARIANTS.map(v => {
                    const selected = form.variants.includes(v.id)
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setForm(f => ({
                            ...f,
                            variants: f.variants.includes(v.id)
                              ? f.variants.filter(id => id !== v.id)
                              : [...f.variants, v.id],
                          }))
                          setErrors(e => ({ ...e, variants: undefined }))
                        }}
                        aria-pressed={selected}
                        className={cn(
                          'relative text-right p-4 rounded-2xl border-2 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                          selected
                            ? 'border-brand-rose bg-brand-rose-bg shadow-rose'
                            : 'border-brand-cream-dark bg-white hover:border-brand-rose/40'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'flex items-center justify-center w-5 h-5 rounded-md border-2 flex-shrink-0 transition-colors',
                                selected ? 'border-brand-rose bg-brand-rose' : 'border-brand-cream-dark'
                              )}
                              aria-hidden="true"
                            >
                              {selected && <Check className="w-3 h-3 text-white" />}
                            </span>
                            <h3 className="font-bold text-brand-dark text-sm">{v.label}</h3>
                          </div>
                          <span className="font-serif text-lg font-bold text-brand-rose-text whitespace-nowrap">
                            ₪{v.price}
                          </span>
                        </div>
                        <p className="text-brand-muted text-xs">{v.desc}</p>
                      </button>
                    )
                  })}
                </div>
                {form.variants.length > 0 && (
                  <p className="text-left text-sm font-semibold text-brand-dark mt-3">
                    סה&quot;כ: <span className="text-brand-rose-text">₪{totalPrice}</span>
                  </p>
                )}
              </div>
              )}

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
                              : 'text-brand-dark hover:bg-brand-rose/10 hover:text-brand-rose-text cursor-pointer'
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
                    <p className="text-center text-xs text-brand-rose-text font-semibold mt-3 pt-3 border-t border-brand-cream-dark">
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
                      {!loadingSlots && displaySlots.length > 0 && (
                        <span className="text-xs text-brand-muted">
                          {isLifting ? '(כל תור 40 דק׳)' : '(זמינות פנויה)'}
                        </span>
                      )}
                    </div>
                    {errors.time && <p className="text-red-500 text-xs mb-2">{errors.time}</p>}

                    {loadingSlots ? (
                      <p className="text-xs text-brand-muted mb-2 animate-pulse">טוענת זמינות...</p>
                    ) : displaySlots.length === 0 ? (
                      <div className="bg-brand-cream border border-brand-cream-dark rounded-2xl p-5 text-center">
                        {/* ⚠️ שני מצבים שונים לגמרי, ואסור להציג אותם באותו נוסח:
                            "אין זמינות" היא תשובה, "לא הצלחנו לטעון" היא היעדר
                            תשובה. לקוחה שרואה "אין זמינות" מחפשת תאריך אחר;
                            לקוחה שיודעת שיש תקלה פונה בוואטסאפ. */}
                        <p className="text-sm text-brand-medium mb-1">
                          {slotsUnavailable
                            ? 'לא הצלחנו לטעון את הזמינות כרגע'
                            : isLifting ? 'אין זוג סלוטים רצוף פנוי בתאריך זה' : 'אין זמינות פנויה בתאריך זה'}
                        </p>
                        <p className="text-xs text-brand-muted">
                          {slotsUnavailable
                            ? 'נסי לרענן בעוד רגע, או צרי קשר ישירות בוואצאפ'
                            : 'בחרי תאריך אחר או צרי קשר ישירות בוואצאפ'}
                        </p>
                      </div>
                    ) : (
                      <div
                        className="grid grid-cols-3 sm:grid-cols-5 gap-2"
                        role="group"
                        aria-label="בחירת שעת הפגישה"
                      >
                        {displaySlots.map(slot => {
                          const isSelected = form.time === slot
                          const endLabel = isLifting ? minToHHMM(toMin(slot) + LIFTING_MINUTES) : ''
                          return (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => {
                                setForm(f => ({ ...f, time: slot }))
                                setErrors(e => ({ ...e, time: undefined }))
                              }}
                              aria-pressed={isSelected}
                              aria-label={isLifting ? `שעה ${slot} עד ${endLabel}` : `שעה ${slot}`}
                              className={cn(
                                'py-2.5 rounded-xl text-sm font-semibold border transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                                isSelected
                                  ? 'bg-brand-rose text-white border-brand-rose shadow-rose'
                                  : 'bg-white text-brand-dark border-brand-cream-dark hover:border-brand-rose hover:text-brand-rose-text hover:bg-brand-rose-bg'
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
                    className="inline-flex items-center gap-1 text-xs text-brand-rose-text font-semibold hover:underline cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" aria-hidden="true" />
                    שינוי
                  </button>
                </div>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-brand-muted">טיפול</dt>
                    <dd className="font-semibold text-brand-dark">
                      {isCalendar ? summaryTreatment : form.service}
                    </dd>
                  </div>
                  {isLifting && (
                    <div className="flex justify-between">
                      <dt className="text-brand-muted">משך</dt>
                      <dd className="font-semibold text-brand-dark">40 דקות</dd>
                    </div>
                  )}
                  {isCalendar && summaryPrice > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-brand-muted">מחיר</dt>
                      <dd className="font-semibold text-brand-dark">₪{summaryPrice}</dd>
                    </div>
                  )}
                  {isCalendar && (
                    <div className="flex justify-between">
                      <dt className="text-brand-muted">מועד</dt>
                      <dd className="font-semibold text-brand-dark">{form.date} · {isLifting ? liftingRange : form.time}</dd>
                    </div>
                  )}
                </dl>
                {!isCalendar && (
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
                    בקשות לתיאום התור
                    <span className="text-brand-muted text-xs font-normal">(אופציונלי)</span>
                  </span>
                </label>
                <textarea
                  id="booking-notes"
                  value={form.notes}
                  onChange={setField('notes')}
                  placeholder="לדוגמה: בקשה בנוגע לשעת ההגעה או לתיאום התור"
                  rows={3}
                  aria-describedby="booking-notes-sensitive"
                  className="w-full px-4 py-3 rounded-2xl border border-brand-cream-dark bg-white text-brand-dark placeholder:text-brand-muted text-sm transition-colors outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold hover:border-brand-gold/50 resize-none"
                />
                <p id="booking-notes-sensitive" className="text-brand-muted text-xs mt-1.5 leading-relaxed">
                  {NOTES_SENSITIVE_INFO_NOTICE}
                </p>
              </div>

              {/* יידוע פרטיות קצר — לפני כפתור השליחה */}
              <p className="text-brand-muted text-xs leading-relaxed">
                {splitNoticeLinks(BOOKING_PRIVACY_NOTICE).map((seg, i) =>
                  seg.href ? (
                    <Link
                      key={i}
                      href={seg.href}
                      target="_blank"
                      className="font-semibold text-brand-rose-text underline hover:text-brand-rose-text/80"
                    >
                      {seg.text}
                    </Link>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  ),
                )}
              </p>

              {/* אישור מדיניות פרטיות — חובה לפני שליחת הבקשה */}
              <div>
                <label
                  htmlFor="booking-privacy"
                  className={cn(
                    'flex items-start gap-3 p-4 rounded-2xl border-2 cursor-pointer transition-colors',
                    errors.privacyNoticeAcknowledged
                      ? 'border-red-300 bg-red-50'
                      : form.privacyNoticeAcknowledged
                      ? 'border-brand-rose bg-brand-rose-bg'
                      : 'border-brand-cream-dark bg-white hover:border-brand-rose/40',
                  )}
                >
                  <input
                    id="booking-privacy"
                    type="checkbox"
                    checked={form.privacyNoticeAcknowledged}
                    onChange={(ev) => {
                      const checked = ev.target.checked
                      setForm((f) => ({ ...f, privacyNoticeAcknowledged: checked }))
                      setErrors((e) => ({ ...e, privacyNoticeAcknowledged: undefined }))
                    }}
                    aria-required="true"
                    aria-invalid={!!errors.privacyNoticeAcknowledged}
                    aria-describedby={errors.privacyNoticeAcknowledged ? 'err-privacy' : undefined}
                    className="sr-only peer"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex items-center justify-center w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-gold peer-focus-visible:ring-offset-2',
                      form.privacyNoticeAcknowledged
                        ? 'border-brand-rose bg-brand-rose'
                        : 'border-brand-cream-dark bg-white',
                    )}
                  >
                    {form.privacyNoticeAcknowledged && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="text-sm text-brand-dark leading-relaxed">
                    {(() => {
                      const { before, linkText, after } = splitPrivacyLink(PRIVACY_ACK_LABEL)
                      return (
                        <>
                          {before}
                          <Link
                            href={PRIVACY_PATH}
                            target="_blank"
                            onClick={(ev) => ev.stopPropagation()}
                            className="font-semibold text-brand-rose-text underline hover:text-brand-rose-text/80"
                          >
                            {linkText}
                          </Link>
                          {after}
                        </>
                      )
                    })()}
                    <span className="text-brand-rose ms-0.5" aria-hidden="true">*</span>
                  </span>
                </label>
                {errors.privacyNoticeAcknowledged && (
                  <p id="err-privacy" className="text-red-500 text-xs mt-2">{errors.privacyNoticeAcknowledged}</p>
                )}
              </div>

              {/* אישור מדיניות התורים — חובה לפני שליחת הבקשה */}
              <div>
                <label
                  htmlFor="booking-policy"
                  className={cn(
                    'flex items-start gap-3 p-4 rounded-2xl border-2 cursor-pointer transition-colors',
                    errors.policyAccepted
                      ? 'border-red-300 bg-red-50'
                      : form.policyAccepted
                      ? 'border-brand-rose bg-brand-rose-bg'
                      : 'border-brand-cream-dark bg-white hover:border-brand-rose/40',
                  )}
                >
                  <input
                    id="booking-policy"
                    type="checkbox"
                    checked={form.policyAccepted}
                    onChange={(ev) => {
                      const checked = ev.target.checked
                      setForm((f) => ({ ...f, policyAccepted: checked }))
                      setErrors((e) => ({ ...e, policyAccepted: undefined }))
                    }}
                    aria-required="true"
                    aria-invalid={!!errors.policyAccepted}
                    aria-describedby={errors.policyAccepted ? 'err-policy' : undefined}
                    className="sr-only peer"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex items-center justify-center w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-gold peer-focus-visible:ring-offset-2',
                      form.policyAccepted
                        ? 'border-brand-rose bg-brand-rose'
                        : 'border-brand-cream-dark bg-white',
                    )}
                  >
                    {form.policyAccepted && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="text-sm text-brand-dark leading-relaxed">
                    קראתי ואני מאשרת את{' '}
                    <Link
                      href={POLICY_PATH}
                      target="_blank"
                      onClick={(ev) => ev.stopPropagation()}
                      className="font-semibold text-brand-rose-text underline hover:text-brand-rose-text/80"
                    >
                      מדיניות קביעת התורים, השינויים והביטולים
                    </Link>{' '}
                    של S.M BROWS
                    <span className="text-brand-rose ms-0.5" aria-hidden="true">*</span>
                  </span>
                </label>
                {errors.policyAccepted && (
                  <p id="err-policy" className="text-red-500 text-xs mt-2">{errors.policyAccepted}</p>
                )}
              </div>
            </motion.div>
          )}

        {/* ── ניווט ── */}
        <div ref={ctaRef} className="mt-9 pt-6 border-t border-brand-cream-dark">
          {/*
            🔒 כשל שמירה — הודעה מפורשת, ולא מסך הצלחה.
            כשהשרת מסמן fallback, מוצע גם מסלול וואטסאפ ידני, עם הבהרה
            חד-משמעית שהבקשה לא נשמרה ושאין שעה שמורה.
          */}
          {saveError && (
            <div role="alert" className="mb-4 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-center">
              <p className="text-red-600 text-sm font-semibold">{saveError.message}</p>
              {saveError.fallback && (
                <>
                  <p className="text-red-500/90 text-xs mt-1.5 leading-relaxed">
                    הבקשה לא נשמרה במערכת והשעה אינה שמורה. אפשר לשלוח לנו את הפרטים
                    בוואטסאפ ונחזור אלייך.
                  </p>
                  <a
                    href={`${WHATSAPP_BASE}?text=${buildWhatsAppMessage()}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 mt-3 bg-brand-whatsapp-dark text-white font-bold text-sm px-6 py-2.5 rounded-full shadow hover:shadow-md transition-shadow cursor-pointer"
                  >
                    <WhatsAppIcon className="w-4 h-4" />
                    שליחת הפרטים בוואצאפ
                  </a>
                </>
              )}
            </div>
          )}

          {/* ── ניווט הטופס ── */}
          <div className="flex items-center gap-3">
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
                  disabled={phase === 'saving'}
                  className="flex-1 inline-flex items-center justify-center gap-2.5 bg-brand-gold text-brand-dark font-bold text-base px-8 py-3.5 rounded-full shadow-gold hover:bg-brand-gold-dark hover:-translate-y-0.5 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2"
                >
                  {phase === 'saving' ? (
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <WhatsAppIcon className="w-5 h-5" />
                  )}
                  {phase === 'saving' ? 'שומרת את הבקשה…' : 'שליחת בקשה לתור'}
                </button>
              )}
            </div>
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
