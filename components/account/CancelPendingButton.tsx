'use client'

import { useState, useRef } from 'react'
import { useDialogA11y } from '@/lib/useDialogA11y'
import { useRouter } from 'next/navigation'
import { Loader2, AlertTriangle, X } from 'lucide-react'
import { createInFlightGuard } from '@/lib/otpFormGuards'

/**
 * ביטול בקשת pending מתוך האזור האישי. מוצג רק על כרטיס בסטטוס pending
 * (ראה app/account/page.tsx). הביטול עצמו מאומת מול הבעלות ב-DB
 * (cancel_pending_appointment) — הרכיב הזה רק שולח את הבקשה.
 *
 * ═══ 🔴 למה זה לא window.confirm ═══
 *
 * ⚠️ **באג פרודקשן אמיתי: הכפתור נראה, ולא הגיב לכלום.**
 *
 * הגרסה הקודמת פתחה `window.confirm(...)` וחזרה מיד אם הוא לא החזיר true.
 * דפדפן שמדכא דיאלוגים נטיביים מחזיר `false` **סינכרונית, בלי להציג שום
 * דבר** — וזה בדיוק מה שקורה ב-webview המובנה של אינסטגרם/פייסבוק, שדרכו
 * מגיעה רוב התנועה לאתר, וגם בכרום אחרי שהמשתמשת סימנה "מנע מהדף הזה
 * ליצור דיאלוגים נוספים". התוצאה: אפס בקשות רשת, בלי ספינר, בלי שגיאה,
 * בלי שינוי במסך. ללקוחה זה נראה כמו כפתור מת.
 *
 * שוחזר אמפירית ב-production build מקומי: עם `confirm` שמחזיר false —
 * `0` קריאות fetch ו-DOM ללא שינוי; עם `confirm` שמחזיר true — POST אחד
 * תקין. כלומר כל שאר השרשרת הייתה תקינה, והשער הנטיבי היה החסם היחיד.
 *
 * ⚠️ ההחלטה הזו כבר התקבלה במקום אחר במערכת: CancelConfirmedDialog מתעד
 * במפורש "דיאלוג מלא ולא window.confirm ... במיוחד בנייד". ביטול בקשה
 * ממתינה נשאר מאחור משלב 4 — זה מה שמיושר כאן.
 *
 * 🔒 האישור נשאר **מפורש**: הכפתור בכרטיס רק פותח את הדיאלוג, ורק לחיצה
 * על "ביטול הבקשה" בתוכו שולחת POST.
 */
export default function CancelPendingButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 🔒 session פג — "נסי שוב" לא יעזור, צריך להתחבר מחדש */
  const [needsLogin, setNeedsLogin] = useState(false)
  /*
   * 🔒 שער סינכרוני נגד POST כפול.
   *
   * ⚠️ `if (loading) return` לבדו **אינו מספיק**, וגם `disabled={loading}`
   * לא: שניהם נשענים על state שמתעדכן רק ברינדור הבא. שתי נגיעות באותו
   * tick (double-tap מהיר בנייד) רואות שתיהן loading=false ושולחות שתי
   * בקשות. אומת אמפירית — שלוש לחיצות ברצף ייצרו שלושה POST. ref נסגר
   * מיד, באותה קריאה. אותו כלי בדיוק שמגן על אימות ה-OTP.
   */
  const inFlight = useRef(createInFlightGuard())

  const dialogRef = useDialogA11y<HTMLDivElement>({
    open: confirming,
    onClose: loading ? undefined : () => setConfirming(false),
    lockScroll: true,
  })

  const close = () => {
    if (loading) return
    setConfirming(false)
    setError(null)
    setNeedsLogin(false)
  }

  const submit = async () => {
    // 🔒 מניעת POST כפול — סינכרוני, לא תלוי ברינדור מחדש
    if (!inFlight.current.tryStart()) return
    setLoading(true)
    setError(null)
    setNeedsLogin(false)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/cancel`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        /*
         * ⚠️ 401 מקבל נוסח משלו. ה-route מחזיר {error:'unauthorized'} בלי
         * message, וברירת המחדל "הביטול נכשל. נסי שוב." שלחה לקוחה ללחוץ
         * שוב ושוב על משהו שלעולם לא יצליח בלי התחברות מחדש.
         */
        if (res.status === 401) {
          setNeedsLogin(true)
          setError('נותקת מהחשבון. יש להתחבר מחדש כדי לבטל את הבקשה.')
        } else {
          setError(data.message ?? 'הביטול נכשל. נסי שוב.')
        }
        setLoading(false)
        inFlight.current.finish()
        return
      }
      /*
       * ⚠️ השער **אינו** משוחרר בהצלחה: הבקשה בוטלה, הכרטיס עומד להיעלם
       * ב-router.refresh(), ואין שום פעולה חוזרת לגיטימית לשחרר אליה.
       */
      setConfirming(false)
      router.refresh()
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setLoading(false)
      inFlight.current.finish()
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-brand-cream-dark/60">
      {/*
        ⚠️ h-11 ולא קישור-טקסט. הגרסה הקודמת הייתה 69×16 פיקסלים בנייד —
        הרבה מתחת ל-44×44 המומלצים, כך שגם כשהלוגיקה עבדה חלק מהנגיעות
        פשוט החטיאו את הכפתור.
      */}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 h-11 px-4 -mr-4 text-xs font-semibold text-red-600 hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
      >
        ביטול הבקשה
      </button>

      {confirming && (
        /*
          🔒 z-[70] — מעל הודעת העוגיות (z-50) ומעל שכבת ההעדפות (z-[60]/[61]).
          שתיהן מרונדרות אחרי {children} ב-app/layout.tsx, ובשוויון z-index
          היו מכסות את הגיליון התחתון הזה בדיוק כפי שקרה בדיאלוגים האחרים.
        */
        <div
          ref={dialogRef}
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-brand-dark/50 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-pending-title"
          dir="rtl"
        >
          <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl shadow-soft">
            <div className="border-b border-brand-linen-dark px-5 py-4 flex items-center justify-between gap-3">
              <h2 id="cancel-pending-title" className="font-serif text-lg font-bold text-brand-dark">
                ביטול הבקשה
              </h2>
              <button
                type="button"
                onClick={close}
                disabled={loading}
                aria-label="סגירה"
                className="p-1.5 -m-1.5 text-brand-muted hover:text-brand-dark disabled:opacity-50 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="flex gap-2 text-xs text-brand-medium leading-relaxed">
                <AlertTriangle className="w-4 h-4 text-brand-gold-dark flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p>
                  לבטל את הבקשה שממתינה לאישור? הפעולה אינה הפיכה — כדי לחזור
                  יהיה צורך לשלוח בקשה חדשה.
                </p>
              </div>

              {error && (
                <p role="alert" className="text-red-500 text-xs">
                  {error}
                  {needsLogin && (
                    <>
                      {' '}
                      <a href="/login" className="font-semibold underline underline-offset-2">
                        מעבר להתחברות
                      </a>
                    </>
                  )}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={loading}
                  className="flex-1 px-4 py-3 rounded-xl border border-brand-linen-dark text-sm font-semibold text-brand-dark disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                >
                  השארת הבקשה
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={loading}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-red-600 text-white font-semibold text-sm py-3 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                  ביטול הבקשה
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
