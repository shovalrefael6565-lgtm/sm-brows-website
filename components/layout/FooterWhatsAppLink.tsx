'use client'

import { usePathname } from 'next/navigation'
import { WHATSAPP_URL, COURSE_WHATSAPP_URL } from '@/lib/utils'

/**
 * קישור הוואטסאפ בפוטר. בעמוד /course בלבד הוא פותח שיחה על הקורס (אותה הודעה
 * אחידה של כל כפתורי הקורס), ובשאר האתר — קביעת תור, בדיוק כמו קודם.
 * רכיב לקוח קטן ונפרד כדי שהפוטר עצמו יישאר Server Component.
 * המדידה: WhatsAppTracker הגלובלי, בכפוף להסכמה — אין כאן אירוע.
 */
export default function FooterWhatsAppLink({ className, children }: { className: string; children?: React.ReactNode }) {
  const isCourse = usePathname() === '/course'
  return (
    <a
      href={isCourse ? COURSE_WHATSAPP_URL : WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={isCourse ? 'פרטים על הקורס בוואטסאפ' : 'קביעת תור בוואצאפ'}
      className={className}
    >
      {children}
      {isCourse ? 'פרטים על הקורס בוואטסאפ' : 'קבעי תור בוואצאפ'}
    </a>
  )
}
