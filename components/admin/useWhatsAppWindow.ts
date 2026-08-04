'use client'

import { useRef, useCallback } from 'react'

/**
 * ניהול חלון WhatsApp שנפתח סינכרונית בתוך אירוע לחיצה (לפני כל await),
 * כדי שחוסמי פופאפים לא יחסמו אותו — אותו דפוס בדיוק כמו
 * components/booking/BookingForm.tsx. הניווט בפועל ל-URL קורה מאוחר
 * יותר, אחרי שהפעולה האסינכרונית בשרת הצליחה.
 */
export function useWhatsAppWindow() {
  const winRef = useRef<Window | null>(null)

  const openBlank = useCallback(() => {
    const win = window.open('', '_blank')
    if (win) win.opener = null
    winRef.current = win
  }, [])

  /** מנווטת את החלון שנפתח מראש ל-URL הסופי. מחזירה false אם נחסם. */
  const navigate = useCallback((url: string): boolean => {
    const win = winRef.current
    winRef.current = null
    try {
      if (win && !win.closed) {
        win.location.href = url
        return true
      }
    } catch {
      // ignore — נופלים לפתיחה רגילה למטה
    }
    const fresh = window.open(url, '_blank')
    if (fresh) {
      fresh.opener = null
      return true
    }
    return false
  }, [])

  const close = useCallback(() => {
    try {
      winRef.current?.close()
    } catch {
      // ignore
    }
    winRef.current = null
  }, [])

  return { openBlank, navigate, close }
}
