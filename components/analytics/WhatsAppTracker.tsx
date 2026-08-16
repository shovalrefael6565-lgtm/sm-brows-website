'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useConsent } from '@/lib/consentContext'
import { isTrackingExcludedPath } from '@/lib/consent'

function isWhatsAppLink(href: string) {
  return href.includes('wa.me') || href.includes('api.whatsapp.com')
}

/**
 * מאזין גלובלי ללחיצות על קישורי וואטסאפ, פעם אחת, לפי הקטגוריה המתאימה
 * (analytics → GA, marketing → Meta). לא ב-/admin, /account או /login.
 *
 * 🔒 שולח page_path בלבד — לעולם לא anchor.href. קישורי הוואטסאפ בטופס
 * ההזמנה ובאזור האישי (BookingForm, AppointmentActions, RescheduleDialog,
 * CancelConfirmedDialog) נושאים ?text= עם שם הלקוחה/טיפול/הערות בתוך
 * ה-URL עצמו — שליחת ה-href היתה דולפת את זה ל-Google/Meta.
 */
export default function WhatsAppTracker() {
  const { ready, analytics, marketing } = useConsent()
  const pathname = usePathname() ?? '/'
  const excluded = isTrackingExcludedPath(pathname)

  useEffect(() => {
    if (excluded) return
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a')
      if (!anchor?.href || !isWhatsAppLink(anchor.href)) return
      if (ready && analytics) window.gtag?.('event', 'whatsapp_click', { page_path: pathname })
      if (ready && marketing) window.fbq?.('track', 'Contact')
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [ready, analytics, marketing, excluded, pathname])

  return null
}
