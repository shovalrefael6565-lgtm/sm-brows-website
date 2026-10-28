'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send, X, TriangleAlert } from 'lucide-react'
import { useDialogA11y } from '@/lib/useDialogA11y'

interface BlockingRun {
  id: string
  status: string
  started_at: string
  mark_failed_count: number
  delivery_unknown_count: number
}

interface Preview {
  productSlug: string
  productName: string
  body: string
  productUrl: string
  recipientCount: number
  canSend: boolean
  blockedReason?: string
  providerName: string
  blockingRun?: BlockingRun
}

interface Summary {
  successful: number
  failed: number
  skippedAlreadyNotified: number
  markFailed: number
  deliveryUnknown: number
  remaining: number
  blocked?: string
  runBlocked?: string
  runStatus?: string
}

const BLOCKED_LABELS: Record<string, string> = {
  notifications_disabled: 'שליחת הודעות ההשקה כבויה (PRODUCT_INTEREST_NOTIFICATIONS_ENABLED).',
  provider_disabled: 'ספק ה-SMS אינו פעיל בסביבה הזו (PRODUCT_LAUNCH_SMS_PROVIDER).',
  no_recipients: 'אין כרגע נרשמות שממתינות לעדכון.',
  message_too_long: 'נוסח ההודעה ארוך מהמותר.',
  already_running: 'כבר מתבצעת שליחת השקה למוצר הזה.',
  needs_review: 'ריצה קודמת הסתיימה במצב שדורש בדיקה.',
}

/** גיל הריצה — כדי שיהיה אפשר לזהות ריצה תקועה בלי לשחרר אותה אוטומטית. */
function runAge(startedAt: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000))
  if (mins < 60) return `${mins} דקות`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `${hours} שעות` : `${Math.round(hours / 24)} ימים`
}

/**
 * שליחת הודעת ההשקה — עם אישור מפורש.
 *
 * ═══ ⚠️ הזרימה, ולמה היא בשני שלבים ═══
 *
 * לחיצה על הכפתור **אינה שולחת כלום**: היא מבקשת תצוגה מקדימה מהשרת
 * ופותחת דיאלוג שמציג את שם המוצר, מספר הנמענות, והנוסח **המדויק**
 * שיישלח. רק לחיצה שנייה, על כפתור שאומר במפורש לכמה נרשמות הוא שולח,
 * מתחילה שליחה.
 *
 * 🔒 הנוסח בדיאלוג מגיע מהשרת ואינו מורכב כאן. הקומפוננטה הזו אינה
 * יודעת לבנות הודעה, ולא יכולה לשלוח טקסט משלה — ה-API מקבל מזהה מוצר
 * בלבד (ראה app/api/admin/product-interest/launch/route.ts).
 */
export default function LaunchNotificationButton({
  productSlug, productLabel,
}: { productSlug: string; productLabel: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useDialogA11y<HTMLDivElement>({
    open,
    onClose: sending ? undefined : () => setOpen(false),
    lockScroll: true,
  })

  const call = async (action: 'preview' | 'send') => {
    const res = await fetch('/api/admin/product-interest/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        action === 'send'
          // 🔴 אישור מפורש, גם מעבר לדיאלוג עצמו.
          ? { action, productSlug, confirm: true }
          : { action, productSlug },
      ),
    })
    return { res, data: await res.json().catch(() => null) }
  }

  const openPreview = async () => {
    setLoading(true)
    setError(null)
    setSummary(null)
    try {
      const { res, data } = await call('preview')
      if (!res.ok || !data?.preview) {
        setError(data?.message ?? 'לא הצלחנו להכין תצוגה מקדימה.')
        setOpen(true)
        return
      }
      setPreview(data.preview)
      setOpen(true)
    } catch {
      setError('לא הצלחנו להכין תצוגה מקדימה.')
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  const send = async () => {
    if (!preview?.canSend || sending) return
    setSending(true)
    setError(null)
    try {
      const { res, data } = await call('send')
      /*
       * 🔴 409 = הריצה לא נפתחה כלל, ולכן **לא נשלחה אף הודעה**. זו אינה
       * שגיאת שרת והנוסח חייב לשקף את זה — "השליחה נכשלה" היה מזמין
       * ניסיון חוזר בדיוק במצב שבו אסור לנסות שוב.
       */
      if (res.status === 409) {
        setError(data?.message ?? 'לא ניתן לשלוח כרגע. לא נשלחה אף הודעה.')
        router.refresh()
        return
      }
      if (!res.ok || !data?.summary) {
        setError(data?.message ?? 'השליחה נכשלה.')
        return
      }
      setSummary(data.summary)
      router.refresh()
    } catch {
      setError('השליחה נכשלה.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-dark px-4 h-10 text-xs font-semibold text-white hover:bg-brand-dark/90 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark focus-visible:ring-offset-2"
      >
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          : <Send className="w-4 h-4" aria-hidden="true" />}
        שליחת הודעת השקה
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-brand-dark/50 backdrop-blur-sm">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="launch-title"
            className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-xl max-h-[92vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur px-5 pt-4 pb-3 border-b border-brand-linen-dark flex items-start justify-between gap-3">
              <h2 id="launch-title" className="font-serif text-lg font-bold text-brand-dark">
                שליחת הודעת השקה
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                aria-label="סגירה"
                className="p-1.5 -m-1.5 rounded-lg text-brand-muted hover:bg-brand-cream disabled:opacity-40 cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {error && (
                <p className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700" role="alert">
                  {error}
                </p>
              )}

              {summary ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-brand-dark">סיכום השליחה</p>
                  <ul className="space-y-1.5 text-sm text-brand-dark">
                    <li>נשלחו בהצלחה: <strong>{summary.successful}</strong></li>
                    <li>נכשלו (נשארו ממתינות): <strong>{summary.failed}</strong></li>
                    <li>דולגו — כבר עודכנו: <strong>{summary.skippedAlreadyNotified}</strong></li>
                    {summary.deliveryUnknown > 0 && (
                      <li className="text-amber-800">
                        מצב לא ודאי: <strong>{summary.deliveryUnknown}</strong> — ההודעה אולי יצאה.
                      </li>
                    )}
                    {summary.markFailed > 0 && (
                      <li className="text-rose-700">
                        נשלחו אך הסימון נכשל: <strong>{summary.markFailed}</strong>
                      </li>
                    )}
                    <li>נותרו ממתינות: <strong>{summary.remaining}</strong></li>
                  </ul>

                  {/* 🔴 ריצה עמומה — אזהרה במקום הזמנה לנסות שוב. */}
                  {summary.runStatus === 'needs_review' ? (
                    <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-300 p-3 text-xs leading-relaxed text-rose-900">
                      <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <p className="font-bold mb-1">הריצה דורשת בדיקה</p>
                        <p>
                          חלק מההודעות הגיעו למצב לא ודאי — ייתכן שיצאו בלי
                          שנרשם. <strong>שליחה נוספת למוצר הזה חסומה</strong>, כדי
                          שלקוחה לא תקבל הודעה כפולה. יש לבדוק מול דוח השליחות
                          של 019 לפני כל ניסיון נוסף.
                        </p>
                      </div>
                    </div>
                  ) : summary.remaining > 0 ? (
                    <p className="text-xs text-brand-muted">
                      השליחה מתבצעת במנות. אפשר להריץ שוב כדי להמשיך — מי שכבר
                      קיבלה הודעה לא תקבל שוב.
                    </p>
                  ) : null}
                </div>
              ) : preview ? (
                <>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-brand-muted">מוצר</dt>
                      <dd className="font-semibold text-brand-dark">{preview.productName}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-brand-muted">נרשמות שיקבלו הודעה</dt>
                      <dd className="font-semibold text-brand-dark">{preview.recipientCount}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-brand-muted">ספק</dt>
                      <dd className="font-semibold text-brand-dark">{preview.providerName}</dd>
                    </div>
                  </dl>

                  <div>
                    <p className="text-xs font-semibold text-brand-dark mb-1.5">נוסח ההודעה המדויק</p>
                    {/* 🔒 מגיע מהשרת. אינו ניתן לעריכה כאן, ואין שדה טקסט. */}
                    <p className="rounded-xl bg-brand-cream border border-brand-linen-dark p-3 text-sm leading-relaxed text-brand-dark whitespace-pre-wrap">
                      {preview.body}
                    </p>
                  </div>

                  {preview.canSend ? (
                    <p className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs leading-relaxed text-amber-900">
                      <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <span>
                        זו שליחה אמיתית. ההודעה תצא ל-{preview.recipientCount} נרשמות
                        דרך {preview.providerName}, ולא ניתן לבטל אותה אחרי השליחה.
                      </span>
                    </p>
                  ) : preview.blockingRun ? (
                    /* 🔴 ריצה חוסמת — מוצגת בבולט, עם גיל הריצה.
                       ⚠️ אין כאן כפתור "שחרר": אי אפשר לדעת אם SMS כבר
                       יצא לפני שהתהליך מת, ושחרור עיוור הוא בדיוק הדרך
                       לשלוח פעמיים. */
                    <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-300 p-3 text-xs leading-relaxed text-rose-900">
                      <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <p className="font-bold mb-1">
                          {preview.blockingRun.status === 'running'
                            ? 'מתבצעת כרגע שליחה'
                            : 'ריצה קודמת דורשת בדיקה'}
                        </p>
                        <p>
                          התחילה לפני {runAge(preview.blockingRun.started_at)}.
                          {preview.blockingRun.status === 'running'
                            ? ' אם היא תקועה — ייתכן שהתהליך נקטע באמצע. אין לשחרר אותה בלי לבדוק מול דוח השליחות של 019, כי ייתכן שהודעות כבר יצאו.'
                            : ` לא ודאיות: ${preview.blockingRun.delivery_unknown_count}, סימון שנכשל: ${preview.blockingRun.mark_failed_count}. יש לבדוק מול דוח השליחות של 019 לפני כל ניסיון נוסף.`}
                        </p>
                        <p className="mt-1.5 font-semibold">שליחה חסומה.</p>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-xl bg-brand-cream border border-brand-linen-dark p-3 text-xs leading-relaxed text-brand-muted">
                      {BLOCKED_LABELS[preview.blockedReason ?? ''] ?? 'השליחה חסומה כרגע.'}
                      {' '}אפשר לראות את הנוסח ואת מספר הנרשמות, אבל לא לשלוח.
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={send}
                    disabled={!preview.canSend || sending}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-dark h-12 text-sm font-semibold text-white hover:bg-brand-dark/90 disabled:bg-brand-cream-dark disabled:text-brand-muted disabled:cursor-not-allowed cursor-pointer"
                  >
                    {sending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                    {sending ? 'שולחת...' : `שלחי ל-${preview.recipientCount} נרשמות`}
                  </button>
                </>
              ) : (
                <p className="text-sm text-brand-muted">טוענת תצוגה מקדימה…</p>
              )}
            </div>
          </div>
        </div>
      )}

      <span className="sr-only">{productLabel}</span>
    </>
  )
}
