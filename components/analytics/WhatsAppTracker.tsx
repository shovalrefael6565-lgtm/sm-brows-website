'use client'

import { useEffect } from 'react'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

function isWhatsAppLink(href: string) {
  return href.includes('wa.me') || href.includes('api.whatsapp.com')
}

export default function WhatsAppTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a')
      if (anchor?.href && isWhatsAppLink(anchor.href)) {
        window.gtag?.('event', 'whatsapp_click', {
          page: window.location.pathname,
          link: anchor.href,
        })
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return null
}
