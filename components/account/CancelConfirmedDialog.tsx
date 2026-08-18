'use client'

import { useState, useEffect } from 'react'
import { Loader2, AlertTriangle, X } from 'lucide-react'
import { WHATSAPP_BASE } from '@/lib/utils'
import { buildLateChangeMessage, buildWhatsAppLinkToBusiness } from '@/lib/whatsappTemplates'

/**
 * אישור ביטול של תור מאושר.
 *
 * דיאלוג מלא ולא window.confirm: הביטול אינו הפיך אוטומטית, והמסך הזה
 * צריך להראות בבירור *מה* מבוטל (תאריך, שעה, טיפול) ומה המדיניות —
 * במיוחד בנייד, שבו window.confirm מציג שורת טקסט בלי הקשר.
 */

export interface CancelConfirmedDialogProps {
  appointmentId: string
  treatment: string
  whenLabel: string
  /** נוסח מדיניות הביטול, מנוסח בשרת לפי business_settings */
  policyNote: string
  onClose: () => void
  onDone: (message: string) => void
}

export default function CancelConfirmedDialog({
  appointmentId, treatment, whenLabel, policyNote, onClose, onDone,
}: CancelConfirmedDialogProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWhatsApp, setShowWhatsApp] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const submit = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    setShowWhatsApp(false)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? 'הביטול נכשל. נסי שוב.')
        setShowWhatsApp(Boolean(data.offerWhatsApp))
        setSaving(false)
        return
      }
      onDone(data.message ?? 'התור בוטל.')
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setSaving(false)
    }
  }

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
      aria-labelledby="cancel-title"
      dir="rtl"
    >
      <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl shadow-soft">
        <div className="border-b border-brand-linen-dark px-5 py-4 flex items-center justify-between gap-3">
          <h2 id="cancel-title" className="font-serif text-lg font-bold text-brand-dark">
            ביטול תור
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

        <div className="px-5 py-4 space-y-4">
          <div className="bg-brand-cream/60 border border-brand-cream-dark rounded-xl p-3 text-sm">
            <p className="font-semibold text-brand-dark mb-0.5">{treatment}</p>
            <p className="text-brand-medium text-xs">{whenLabel}</p>
          </div>

          <div className="flex gap-2 text-xs text-brand-medium leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-brand-gold-dark flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1.5">
              <p>הביטול אינו הפיך — לאחר האישור לא ניתן להחזיר את התור לבד, ויהיה צורך לקבוע מועד חדש.</p>
              <p>{policyNote}</p>
            </div>
          </div>

          {error && <p role="alert" className="text-red-500 text-xs">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-3 rounded-xl border border-brand-linen-dark text-sm font-semibold text-brand-dark disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
            >
              השארת התור
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-red-600 text-white font-semibold text-sm py-3 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              ביטול התור
            </button>
          </div>

          {/* 🔒 15F — הקישור נושא טקסט מוכן. הדיאלוג הזה הוא ביטול, ולכן action קבוע. */}
          {showWhatsApp && (
            <a
              href={buildWhatsAppLinkToBusiness(WHATSAPP_BASE, buildLateChangeMessage({
                action: 'cancel', treatment, whenLabel,
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
