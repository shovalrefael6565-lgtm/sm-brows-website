'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, XCircle, CheckCircle2 } from 'lucide-react'
import { WHATSAPP_BASE } from '@/lib/utils'
import { buildLateChangeMessage, buildWhatsAppLinkToBusiness } from '@/lib/whatsappTemplates'
import RescheduleDialog from './RescheduleDialog'
import CancelConfirmedDialog from './CancelConfirmedDialog'

/**
 * הכפתורים של תור מאושר באזור האישי.
 *
 * מה שמוצג כאן נקבע ע"י ה-*שרת* (capabilitiesFor ב-
 * lib/appointmentSelfService.ts), שמחשב את המדיניות מול business_settings
 * ולפי שעון ישראל. הרכיב הזה לא מחליט דבר בעצמו ולא מכיר את המדיניות —
 * הוא רק מצייר את מה שהתקבל, וכל פעולה נבדקת שוב במלואה בשרת.
 *
 * וואטסאפ מוצג רק כשהפעולה *חסומה* — לקוחה שיכולה לנהל את התור לבד לא
 * צריכה לפנות לאף אחד, וזו כל המטרה של השלב הזה.
 */

export interface ActionAvailability {
  allowed: boolean
  /** נוסח ההסבר כשחסום (מגיע מהשרת) */
  message?: string
}

export interface AppointmentActionsProps {
  appointmentId: string
  whenLabel: string
  treatment: string
  durationMin: number
  reschedule: ActionAvailability
  cancel: ActionAvailability
  cancelPolicyNote: string
  rescheduleCount: number
  maxReschedules: number
}

export default function AppointmentActions({
  appointmentId, whenLabel, treatment, durationMin,
  reschedule, cancel, cancelPolicyNote, rescheduleCount, maxReschedules,
}: AppointmentActionsProps) {
  const router = useRouter()
  const [dialog, setDialog] = useState<'reschedule' | 'cancel' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // הסבר לכל פעולה חסומה. במובייל אין hover, ולכן title על כפתור מושבת
  // אינו נגיש — ההסבר חייב להופיע כטקסט. כפילויות מאוחדות (שתי הפעולות
  // חסומות בדרך כלל מאותה סיבה, למשל "מאוחר מדי").
  const blockedMessages = Array.from(new Set(
    [
      !reschedule.allowed ? reschedule.message : null,
      !cancel.allowed ? cancel.message : null,
    ].filter((m): m is string => Boolean(m)),
  ))

  const finish = (message: string) => {
    setDialog(null)
    setNotice(message)
    router.refresh()
  }

  return (
    <div className="mt-3 pt-3 border-t border-brand-cream-dark/60 space-y-2">
      {rescheduleCount > 0 && (
        <p className="text-[11px] text-brand-muted">
          בוצעו {rescheduleCount} מתוך {maxReschedules} שינויי מועד אפשריים
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDialog('reschedule')}
          disabled={!reschedule.allowed}
          title={reschedule.allowed ? undefined : reschedule.message}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-dark border border-brand-linen-dark hover:border-brand-rose disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:border-brand-linen-dark px-3.5 py-1.5 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
          בקשת שינוי מועד
        </button>

        <button
          type="button"
          onClick={() => setDialog('cancel')}
          disabled={!cancel.allowed}
          title={cancel.allowed ? undefined : cancel.message}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:border-red-400 disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:border-red-200 px-3.5 py-1.5 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
          ביטול תור
        </button>
      </div>

      {/* וואטסאפ מוצג רק כשמשהו חסום — לקוחה שיכולה לנהל לבד לא צריכה אותו */}
      {blockedMessages.length > 0 && (
        <div className="text-[11px] text-brand-muted leading-relaxed">
          {blockedMessages.map(m => <p key={m}>{m}</p>)}
          {/*
            * 🔒 15F — הקישור נושא טקסט מוכן.
            *
            * ⚠️ עד כאן הוא הפנה ל-WHATSAPP_BASE חשוף: נפתח חלון ריק, והלקוחה
            * נדרשה לנסח בעצמה ולציין על איזה תור מדובר. שובל קיבלה
            * "היי, אני צריכה לבטל" בלי תאריך ובלי טיפול, ונאלצה לחפש.
            *
            * ⚠️ הפעולה נגזרת ממה שחסום: אם רק הביטול חסום — הכוונה היא
            * ביטול. אם שניהם חסומים (המקרה הנפוץ, "מאוחר מדי") — נבחר
            * ביטול, כי זו הפעולה הדחופה יותר. הלקוחה יכולה לערוך.
            */}
          <a
            href={buildWhatsAppLinkToBusiness(WHATSAPP_BASE, buildLateChangeMessage({
              action: !cancel.allowed ? 'cancel' : 'reschedule',
              treatment,
              whenLabel,
            }))}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-1 font-semibold text-brand-whatsapp-dark hover:underline"
          >
            פנייה לשובל בוואטסאפ
          </a>
        </div>
      )}

      {notice && (
        <p role="status" className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          {notice}
        </p>
      )}

      {dialog === 'reschedule' && (
        <RescheduleDialog
          appointmentId={appointmentId}
          currentLabel={whenLabel}
          treatment={treatment}
          durationMin={durationMin}
          onClose={() => setDialog(null)}
          onDone={finish}
        />
      )}

      {dialog === 'cancel' && (
        <CancelConfirmedDialog
          appointmentId={appointmentId}
          treatment={treatment}
          whenLabel={whenLabel}
          policyNote={cancelPolicyNote}
          onClose={() => setDialog(null)}
          onDone={finish}
        />
      )}
    </div>
  )
}
