import { CalendarPlus, Apple } from 'lucide-react'
import { buildGoogleCalendarUrl } from '@/lib/calendarInvite'

interface Props {
  appointmentId: string
  treatment: string
  startsAt: string
  durationMin: number
}

/**
 * שלב 15H — "הוספה ליומן", על כרטיס של תור **מאושר בלבד**.
 *
 * ⚠️ קומפוננטת שרת בכוונה, בלי `'use client'` ובלי מצב: שני הכפתורים הם
 * קישורים רגילים. קישור Google נבנה כאן מנתוני ה-DB, וקובץ ה-.ics נבנה
 * בשרת ב-route ייעודי — כך שאין שום מסלול שבו תוכן האירוע מגיע מה-DOM.
 *
 * ⚠️ שני המסלולים מציגים את אותו אירוע בדיוק (אותה כותרת, אותו תיאור,
 * אותה כתובת), כי שניהם נבנים מאותן פונקציות ב-lib/calendarInvite.ts.
 */
export default function AddToCalendarButtons({
  appointmentId,
  treatment,
  startsAt,
  durationMin,
}: Props) {
  const googleUrl = buildGoogleCalendarUrl({ appointmentId, treatment, startsAt, durationMin })

  return (
    <div className="mt-3 pt-3 border-t border-brand-cream-dark/60">
      <p className="text-xs font-semibold text-brand-dark mb-2">שמירת התור ביומן</p>
      <div className="flex flex-wrap gap-2">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-brand-dark text-white
                     text-xs font-semibold hover:bg-brand-dark/90 transition-colors
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          <CalendarPlus className="w-4 h-4" aria-hidden="true" />
          יומן Google
        </a>

        {/*
          ⚠️ `download` ולא ניווט: באייפון פתיחת הקובץ מציעה מיד הוספה
          ליומן, ובדסקטופ הוא נשמר ונפתח בלקוח היומן המוגדר.
        */}
        <a
          href={`/api/appointments/${appointmentId}/calendar.ics`}
          download
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-brand-linen-dark
                     bg-white text-brand-dark text-xs font-semibold hover:bg-brand-cream transition-colors
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          <Apple className="w-4 h-4" aria-hidden="true" />
          אייפון / Apple
        </a>
      </div>
    </div>
  )
}
