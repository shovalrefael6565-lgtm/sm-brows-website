'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Phone, KeyRound, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react'
import { cn, WHATSAPP_URL } from '@/lib/utils'
import { isValidIsraeliMobile } from '@/lib/phone'

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
  const [cooldown, setCooldown] = useState(0)

  const codeRef = useRef<HTMLInputElement>(null)

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
    if (!isValidIsraeliMobile(phone)) {
      setError('יש להזין מספר נייד ישראלי תקין')
      return
    }
    setLoading(true)
    setError(null)
    try {
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
      setStep('code')
      setCooldown(60)
      if (resend) setCode('')
    } catch {
      setError('אין חיבור לאינטרנט. בדקי את החיבור ונסי שוב.')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('יש להזין קוד בן 6 ספרות')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, purpose: 'login' }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.message ?? 'הקוד שגוי')
        return
      }

      router.push('/account')
      router.refresh()
    } catch {
      setError('אין חיבור לאינטרנט. בדקי את החיבור ונסי שוב.')
    } finally {
      setLoading(false)
    }
  }

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
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
                className={cn(
                  'w-full h-14 pr-12 pl-4 rounded-2xl border bg-white text-brand-dark text-lg text-center',
                  'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
                  'transition-colors placeholder:text-brand-muted/50',
                  error ? 'border-red-400' : 'border-brand-linen-dark',
                )}
              />
            </div>

            <p className="text-xs text-brand-muted mt-3 leading-relaxed">
              נשלח לך קוד אימות חד־פעמי ב־SMS. אין צורך בסיסמה.
            </p>

            <SubmitButton loading={loading} label="שליחת קוד" />
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
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
                className={cn(
                  'w-full h-14 pr-12 pl-4 rounded-2xl border bg-white text-brand-dark',
                  'text-2xl text-center tracking-[0.5em] font-semibold',
                  'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
                  'transition-colors placeholder:text-brand-muted/30 placeholder:tracking-[0.5em]',
                  error ? 'border-red-400' : 'border-brand-linen-dark',
                )}
              />
            </div>

            <SubmitButton loading={loading} label="כניסה" />

            <div className="flex items-center justify-between mt-4 text-sm">
              <button
                type="button"
                onClick={() => { setStep('phone'); setCode(''); setError(null) }}
                className="text-brand-muted hover:text-brand-dark transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
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

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
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
          <span>רגע…</span>
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
