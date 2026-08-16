'use client'

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useConsent } from '@/lib/consentContext'
import { CONSENT_MAX_AGE_MS, isTrackingExcludedPath, setGaDisabled, updateGaConsent } from '@/lib/consent'

/**
 * אין hardcode למזהה: אם NEXT_PUBLIC_GA_ID לא מוגדר, GA פשוט לא נטען —
 * בלי fallback ובלי קריסה.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID

/** אותם 180 יום כמו תוקף רשומת ההסכמה עצמה (CONSENT_MAX_AGE_MS), בשניות — cookie_update:false כדי שהתוקף יישאר יחסי להסכמה הראשונה ולא יתחדש בכל ביקור. */
const GA_COOKIE_EXPIRES_SECONDS = CONSENT_MAX_AGE_MS / 1000

export default function GoogleAnalytics() {
  const { ready, analytics } = useConsent()
  const pathname = usePathname() ?? '/'
  const excluded = isTrackingExcludedPath(pathname)
  const granted = ready && analytics && !excluded

  // scriptLoaded הוא state (כדי לרנדר את ה-<Script> פעם אחת), loadedRef הוא
  // ref מקביל שבטוח לקרוא בתוך ה-effect בלי להיכנס ל-dependency array שלו —
  // אחרת עדכון ה-state היה מפעיל ריצה נוספת של האפקט ושולח page_view כפול
  // מיד אחרי סקריפט האתחול (שכבר שולח את הצפייה הראשונה בעצמו).
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const loadedRef = useRef(false)
  const prevGrantedRef = useRef(false)

  useEffect(() => {
    if (!GA_ID) return

    if (granted && !loadedRef.current) {
      // הפעלה ראשונה בטעינת העמוד הזו: ה-<Script> למטה יגדיר gtag,
      // ga-disable=false, consent update ו-page_view נקי — הכל בסקריפט
      // האתחול עצמו, סינכרונית.
      loadedRef.current = true
      prevGrantedRef.current = true
      setScriptLoaded(true)
      return
    }

    if (!loadedRef.current) {
      // עדיין לא נטען בכלל (אין הסכמה עדיין, או נתיב מוחרג) — קובעים את דגל
      // ה-disable מיד, בלי ליצור gtag ובלי לשלוח שום consent ping.
      setGaDisabled(GA_ID, true)
      return
    }

    if (granted !== prevGrantedRef.current) {
      // מעבר מפורש: הסכמה בוטלה/אושרה מחדש, או נתיב הפך למוחרג/חזר להיות
      // ציבורי. אין init כפול — רק disable + consent update, ו-page_view
      // חדש רק אם חוזרים לאישור.
      setGaDisabled(GA_ID, !granted)
      updateGaConsent(granted)
      if (granted) window.gtag?.('event', 'page_view', { page_path: pathname })
    } else if (granted) {
      // ניווט client-side בין עמודים ציבוריים כשההסכמה כבר בתוקף.
      window.gtag?.('event', 'page_view', { page_path: pathname })
    }
    prevGrantedRef.current = granted
  }, [granted, pathname])

  if (!scriptLoaded) return null

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;window['ga-disable-${GA_ID}']=false;gtag('consent','update',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});gtag('js',new Date());gtag('config','${GA_ID}',{send_page_view:false,cookie_expires:${GA_COOKIE_EXPIRES_SECONDS},cookie_update:false});gtag('event','page_view',{page_path:document.location.pathname});`}
      </Script>
    </>
  )
}
