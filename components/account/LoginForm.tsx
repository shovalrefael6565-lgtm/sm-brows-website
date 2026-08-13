'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Phone, KeyRound, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react'
import { cn, WHATSAPP_URL } from '@/lib/utils'
import { isValidIsraeliMobile } from '@/lib/phone'
import { createInFlightGuard, createOtpAutoSubmitGate } from '@/lib/otpFormGuards'

/**
 * התחברות בשני שלבים: מספר טלפון → קוד אימות.
 *
 * מותאם קודם כול למובייל: שדות גדולים, inputMode מספרי כדי שתיפתח מקלדת
 * ספרות, ו-autoComplete="one-time-code" כדי שהמערכת תציע את הקוד מה-SMS.
 */

type Step = 'phone' | 'code'

export default function LoginForm() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [maskedPhone, setMaskedPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * הודעה נייטרלית שאינה שגיאה — כרגע רק המקרה שבו השליחה יצאה ולא ידוע
   * מה עלה בגורלה. ⚠️ מוצגת בנפרד מ-error ובסגנון אחר: הקוד **כן** תקף,
   * והצגתו כשגיאה אדומה הייתה מרתיעה מלהזין קוד שכבר הגיע.
   */
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  const codeRef = useRef<HTMLInputElement>(null)

  // 🔒 שער "בקשה אחת בכל רגע", משותף לשליחה ולאימות — ראה lib/otpFormGuards.ts
  // לנימוק המלא של למה זה משתנה רגיל ולא state.
  const inFlightRef = useRef(createInFlightGuard())
  // 🔒 מפעיל אימות אוטומטי לכל היותר פעם אחת לכל קוד בן 6 ספרות מובחן —
  // ראה lib/otpFormGuards.ts. ה-instance נשמר לאורך חיי הקומפוננטה כדי
  // שהזיכרון "כבר ניסינו את הקוד הזה" ישרוד רינדורים.
  const autoSubmitRef = useRef(createOtpAutoSubmitGate())

  // ספירה לאחור לכפתור "שליחה חוזרת"
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  const sendCode = async (resend = false) => {
    // 🔒 סינכרוני ולפני כל דבר אחר — חוסם גם לחיצה כפולה וגם Enter כפול,
    // בלי תלות ב-re-render של הכפתור המנוטרל (ראה lib/otpFormGuards.ts).
    if (!inFlightRef.current.tryStart()) return
    try {
      if (!isValidIsraeliMobile(phone)) {
        setError('יש להזין מספר נייד ישראלי תקין')
        return
      }
      setLoading(true)
      setError(null)
      setNotice(null)

      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'login' }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.message ?? 'לא הצלחנו לשלוח את הקוד')
        if (data.retryAfterSec) setCooldown(Math.min(data.retryAfterSec, 300))
        return
      }

      setMaskedPhone(data.maskedPhone)
      // ⚠️ 200 עם notice = השליחה יצאה ותוצאתה אינה ידועה. המסך ממשיך
      // להזנת הקוד בדיוק כמו בהצלחה, כי הקוד תקף.
      setNotice(typeof data.notice === 'string' ? data.notice : null)
      setStep('code')
      setCooldown(60)
      // קוד חדש בדרך — כל זיכרון של קוד קודם שכבר נוסה כבר לא רלוונטי.
      autoSubmitRef.current.reset()
      if (resend) setCode('')
    } catch {
      setError('אין חיבור לאינטרנט. בדקי את החיבור ונסי שוב.')
    } finally {
      setLoading(false)
      inFlightRef.current.finish()
    }
  }

  const verifyCode = async () => {
    // 🔒 אותו שער בדיוק כמו ב-sendCode — כולל הגנה על אימות שהופעל
    // אוטומטית (6 ספרות) בו-זמנית עם לחיצה ידנית על "כניסה".
    if (!inFlightRef.current.tryStart()) return
    try {
      if (!/^\d{6}$/.test(code)) {
        setError('יש להזין קוד בן 6 ספרות')
        return
      }
      setLoading(true)
      setError(null)
      setNotice(null)

      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, purpose: 'login' }),
      })
      const data = await res.json()

      if (!res.ok) {
        // ⚠️ הקוד **נשאר** בשדה במכוון: הלקוחה יכולה לתקן ספרה ולנסות שוב
        // בלי להקליד הכול מחדש. עריכה כלשהי מאפסת את שער האימות האוטומטי
        // (ראה lib/otpFormGuards.ts), כך שקוד מתוקן מפעיל אימות אוטומטי שוב.
        setError(data.message ?? 'הקוד שגוי')
        return
      }

      /*
       * 🔒 replace ולא push — /login לא נשאר בהיסטוריה אחרי כניסה מוצלחת,
       * כך שכפתור "אחורה" לא מחזיר למסך קוד שכבר נוצל.
       *
       * 🔒 refresh() נשאר, בכוונה. הסיבה אינה עוגיית ה-session עצמה —
       * ה-cookie כבר נמצא אצל הדפדפן (Set-Cookie מתשובת /api/auth/otp/
       * verify), ולכן גם push לבד היה שולח אותו בבקשת ה-RSC הבאה. הסיכון
       * הוא ב-Router Cache: components/booking/BookingForm.tsx מציגה
       * קישור אמיתי ל-/account ("צפייה באזור האישי") אחרי הזמנה — כולל
       * ללקוחה **שלא** מחוברת, שם הוא מוביל ל-redirect('/login') בצד
       * השרת. אם אותה לקוחה ביקרה שם ואז התחברה תוך כדי חלון ה-cache
       * (עד 30 שניות ל-route דינמי), replace/push לבדם עלולים לשרת מחדש
       * את תוצאת ה-redirect הישנה במקום לטעון /account מחדש עם ה-session
       * הנוכחי. refresh() מבטל את ה-cache הזה במפורש ומכריח fetch טרי.
       */
      router.replace(data.redirectTo ?? '/account')
      router.refresh()
    } catch {
      setError('אין חיבור לאינטרנט. בדקי את החיבור ונסי שוב.')
    } finally {
      setLoading(false)
      inFlightRef.current.finish()
    }
  }

  // 🔒 אימות אוטומטי כשהקוד מגיע ל-6 ספרות — הקלדה, הדבקה, ו-AutoFill של
  // iOS (autocomplete="one-time-code") כולם רק משנים את ה-state של הקוד,
  // ולכן כולם עוברים כאן באותה דרך בדיוק. shouldFire דואגת ל"פעם אחת
  // בלבד" לכל קוד מובחן; inFlightRef ב-verifyCode דואג לכך שאימות אוטומטי
  // ואימות ידני לא ירוצו במקביל.
  useEffect(() => {
    if (step !== 'code') return
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verifyCode
    // נוצרת מחדש בכל רינדור; הוספתה כתלות הייתה מפעילה את ה-effect הזה
    // בכל רינדור במקום רק כששינוי הקוד עצמו קורה. autoSubmitRef כבר מונע
    // הפעלה כפולה, ו-inFlightRef ב-verifyCode מונע בקשה כפולה בפועל.
    if (autoSubmitRef.current.shouldFire(code)) {
      void verifyCode()
    }
  }, [code, step])

  return (
    <div className="w-full max-w-md mx-auto">
      {/*
        מעבר בין השלבים בלי AnimatePresence: המעבר מתבצע ע"י key על ה-form,
        כך שהשלב הישן מוסר מיד והחדש נכנס. AnimatePresence עם mode="wait"
        השאיר כאן מסך ריק כשאנימציית היציאה לא הודיעה על סיומה, וזה מחיר
        גבוה מדי עבור אפקט דקורטיבי במסך התחברות.
      */}
        {step === 'phone' ? (
          <motion.form
            key="phone"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={e => { e.preventDefault(); sendCode() }}
            noValidate
          >
            <label htmlFor="login-phone" className="block text-sm font-semibold text-brand-dark mb-2">
              מספר הטלפון שלך
            </label>
            <div className="relative">
              <Phone
                className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-muted"
                aria-hidden="true"
              />
              <input
                id="login-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder="054-123-4567"
                value={phone}
                onChange={e => { setPhone(e.target.value); setError(null) }}
                disabled={loading}
                aria-invalid={!!error}
                aria-busy={loading}
                aria-describedby={error ? 'login-error' : undefined}
                className={cn(
                  'w-full h-14 pr-12 pl-4 rounded-2xl border bg-white text-brand-dark text-lg text-center',
                  'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
                  'transition-colors placeholder:text-brand-muted/50',
                  'disabled:opacity-60 disabled:cursor-not-allowed',
                  error ? 'border-red-400' : 'border-brand-linen-dark',
                )}
              />
            </div>

            <p className="text-xs text-brand-muted mt-3 leading-relaxed">
              נשלח לך קוד אימות חד־פעמי ב־SMS. אין צורך בסיסמה.
            </p>

            <SubmitButton loading={loading} label="שליחת קוד" loadingLabel="שולחים קוד…" />
          </motion.form>
        ) : (
          <motion.form
            key="code"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={e => { e.preventDefault(); verifyCode() }}
            noValidate
          >
            <div className="flex items-center gap-2 text-sm text-brand-muted mb-5">
              <CheckCircle2 className="w-4 h-4 text-brand-gold flex-shrink-0" aria-hidden="true" />
              <span>שלחנו קוד למספר <span dir="ltr" className="font-semibold">{maskedPhone}</span></span>
            </div>

            <label htmlFor="login-code" className="block text-sm font-semibold text-brand-dark mb-2">
              קוד האימות
            </label>
            <div className="relative">
              <KeyRound
                className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-muted"
                aria-hidden="true"
              />
              <input
                ref={codeRef}
                id="login-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                dir="ltr"
                placeholder="000000"
                value={code}
                onChange={e => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  setError(null)
                }}
                disabled={loading}
                aria-invalid={!!error}
                aria-busy={loading}
                aria-describedby={error ? 'login-error' : undefined}
                className={cn(
                  'w-full h-14 pr-12 pl-4 rounded-2xl border bg-white text-brand-dark',
                  'text-2xl text-center tracking-[0.5em] font-semibold',
                  'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
                  'transition-colors placeholder:text-brand-muted/30 placeholder:tracking-[0.5em]',
                  'disabled:opacity-60 disabled:cursor-not-allowed',
                  error ? 'border-red-400' : 'border-brand-linen-dark',
                )}
              />
            </div>

            {/*
              🔒 האימות מופעל אוטומטית ברגע שהקוד מגיע ל-6 ספרות (ראה
              ה-effect למעלה) — הכפתור נשאר כנתיב חוזר ידני, ומציג
              "מאמתים…" גם כשההפעלה הייתה אוטומטית, כי loading משותף.
            */}
            <SubmitButton loading={loading} label="כניסה" loadingLabel="מאמתים…" />

            <div className="flex items-center justify-between mt-4 text-sm">
              <button
                type="button"
                disabled={loading}
                onClick={() => { setStep('phone'); setCode(''); setError(null); setNotice(null) }}
                className="text-brand-muted hover:text-brand-dark transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
              >
                שינוי מספר
              </button>
              <button
                type="button"
                disabled={cooldown > 0 || loading}
                onClick={() => sendCode(true)}
                className="text-brand-gold-text font-semibold hover:underline disabled:text-brand-muted disabled:no-underline disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
              >
                {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown}` : 'שליחה חוזרת'}
              </button>
            </div>
          </motion.form>
        )}

      {/*
        ⚠️ נייטרלי ולא אדום, ו-role="status" ולא "alert": זו אינה שגיאה.
        הקוד תקף וייתכן מאוד שההודעה הגיעה — ההודעה רק מסבירה מה לעשות אם לא.
      */}
      {notice && !error && (
        <motion.p
          id="login-notice"
          role="status"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 text-sm text-brand-dark bg-brand-linen border border-brand-linen-dark rounded-xl px-4 py-3"
        >
          {notice}
        </motion.p>
      )}

      {error && (
        <motion.p
          id="login-error"
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
        >
          {error}
        </motion.p>
      )}

      <p className="text-center text-xs text-brand-muted mt-8 leading-relaxed">
        נתקלת בבעיה?{' '}
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-gold-text font-semibold hover:underline cursor-pointer"
        >
          כתבי לנו בוואטסאפ
        </a>
      </p>
    </div>
  )
}

function SubmitButton({
  loading,
  label,
  loadingLabel,
}: {
  loading: boolean
  label: string
  /** מוצג במקום label + מציג spinner בזמן הבקשה — טקסט ספציפי לפעולה (שליחה/אימות) */
  loadingLabel: string
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      aria-busy={loading}
      className={cn(
        'w-full h-14 mt-6 rounded-2xl bg-brand-dark text-white font-semibold text-base',
        'flex items-center justify-center gap-2 transition-all duration-200',
        'hover:bg-brand-medium active:scale-[0.98] cursor-pointer',
        'disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
      )}
    >
      {loading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>{loadingLabel}</span>
        </>
      ) : (
        <>
          <span>{label}</span>
          <ArrowRight className="w-5 h-5 rotate-180" aria-hidden="true" />
        </>
      )}
    </button>
  )
}
