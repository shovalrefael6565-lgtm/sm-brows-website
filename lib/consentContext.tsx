'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  type ConsentChoice,
  type ConsentRecord,
  deleteGaCookies,
  deleteMetaCookies,
  initConsent,
  writeConsent,
} from '@/lib/consent'

interface ConsentContextValue {
  /** true אחרי שה-effect הראשון קרא את localStorage — לפני כן המצב אינו ידוע (SSR-safe). */
  ready: boolean
  hasChoice: boolean
  analytics: boolean
  marketing: boolean
  bannerOpen: boolean
  preferencesOpen: boolean
  openPreferences: (trigger?: HTMLElement | null) => void
  closePreferences: () => void
  acceptAll: () => void
  rejectAll: () => void
  savePreferences: (choice: ConsentChoice) => void
}

const ConsentContext = createContext<ConsentContextValue | null>(null)

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [record, setRecord] = useState<ConsentRecord | null>(null)
  const [bannerOpen, setBannerOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  // עותק סינכרוני של record, כדי ש-apply() תדע את הערך "הקודם" בלי תלות
  // בתזמון re-render של state (נחוץ כדי לדעת אילו cookies למחוק).
  const recordRef = useRef<ConsentRecord | null>(null)

  const updateRecord = useCallback((next: ConsentRecord | null) => {
    recordRef.current = next
    setRecord(next)
  }, [])

  // קריאת localStorage חייבת לקרות אחרי mount — לא ב-SSR. אותו דפוס כמו
  // CookieNotice/AccessibilityWidget הקיימים.
  //
  // initConsent() קורה *לפני* ש-GoogleAnalytics/MetaPixel מקבלים הזדמנות
  // לפעול (הם קוראים את אותו ready/record דרך ה-context): אם אין הסכמה
  // תקפה — חסרה, JSON פגום, גרסה ישנה, או פגה אחרי 180 יום — היא כבר ניקתה
  // cookies של GA/Meta והסירה רשומת localStorage ישנה. record נשאר null
  // במפורש, לא Reject אוטומטי.
  useEffect(() => {
    const { record: existing } = initConsent()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- קריאת localStorage מותרת רק אחרי mount (SSR-safe), אותו דפוס כמו CookieNotice/AccessibilityWidget הקיימים.
    updateRecord(existing)
    setBannerOpen(!existing)
    setReady(true)
  }, [updateRecord])

  const apply = useCallback((choice: ConsentChoice) => {
    const prev = recordRef.current
    const next = writeConsent(choice)
    updateRecord(next)
    setBannerOpen(false)
    setPreferencesOpen(false)
    // ביטול הסכמה לקטגוריה מוחק את ה-cookies הידועים שלה, לא רק מפסיק לטעון script חדש.
    if (prev?.analytics && !choice.analytics) deleteGaCookies()
    if (prev?.marketing && !choice.marketing) deleteMetaCookies()
  }, [updateRecord])

  const acceptAll = useCallback(() => apply({ analytics: true, marketing: true }), [apply])
  const rejectAll = useCallback(() => apply({ analytics: false, marketing: false }), [apply])
  const savePreferences = useCallback((choice: ConsentChoice) => apply(choice), [apply])

  const openPreferences = useCallback((trigger?: HTMLElement | null) => {
    triggerRef.current = trigger ?? (document.activeElement as HTMLElement | null)
    setPreferencesOpen(true)
  }, [])

  const closePreferences = useCallback(() => {
    setPreferencesOpen(false)
    triggerRef.current?.focus?.()
  }, [])

  const value = useMemo<ConsentContextValue>(() => ({
    ready,
    hasChoice: Boolean(record),
    analytics: record?.analytics ?? false,
    marketing: record?.marketing ?? false,
    bannerOpen,
    preferencesOpen,
    openPreferences,
    closePreferences,
    acceptAll,
    rejectAll,
    savePreferences,
  }), [ready, record, bannerOpen, preferencesOpen, openPreferences, closePreferences, acceptAll, rejectAll, savePreferences])

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext)
  if (!ctx) throw new Error('useConsent must be used within ConsentProvider')
  return ctx
}
