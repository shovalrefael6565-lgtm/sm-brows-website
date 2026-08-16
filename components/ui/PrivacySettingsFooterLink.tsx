'use client'

import { useRef } from 'react'
import { useConsent } from '@/lib/consentContext'

/** קישור קבוע בפוטר לשינוי/ביטול הסכמת עוגיות בכל עת. */
export default function PrivacySettingsFooterLink() {
  const { openPreferences } = useConsent()
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => openPreferences(btnRef.current)}
      className="text-white/55 hover:text-brand-gold transition-colors text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded text-start"
    >
      הגדרות פרטיות ועוגיות
    </button>
  )
}
