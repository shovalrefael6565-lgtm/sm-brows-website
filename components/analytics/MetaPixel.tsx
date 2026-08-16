'use client'

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useConsent } from '@/lib/consentContext'
import { isTrackingExcludedPath, setMetaConsent } from '@/lib/consent'

/**
 * אין hardcode למזהה: אם NEXT_PUBLIC_META_PIXEL_ID לא מוגדר, Meta Pixel פשוט
 * לא נטען — בלי fallback ובלי קריסה. (לא היה קודם env var ייעודי ל-Pixel —
 * המזהה היה שרוף בקוד. זה שם המשתנה החדש שמחליף אותו, לפי אותה מוסכמה
 * שכבר קיימת ל-NEXT_PUBLIC_GA_ID.)
 */
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

export default function MetaPixel() {
  const { ready, marketing } = useConsent()
  const pathname = usePathname() ?? '/'
  const excluded = isTrackingExcludedPath(pathname)
  const granted = ready && marketing && !excluded

  // אותו דפוס scriptLoaded (state, לרינדור) + loadedRef (ref, לוגיקת האפקט)
  // כמו ב-GoogleAnalytics.tsx — ראה שם את ההסבר המלא למה זה מונע init כפול.
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const loadedRef = useRef(false)
  const prevGrantedRef = useRef(false)

  useEffect(() => {
    if (!META_PIXEL_ID) return

    if (granted && !loadedRef.current) {
      loadedRef.current = true
      prevGrantedRef.current = true
      setScriptLoaded(true)
      return
    }

    if (!loadedRef.current) return // fbq עדיין לא קיים — אין consent command לפני שהוא נטען

    if (granted !== prevGrantedRef.current) {
      // מעבר מפורש: אישור/ביטול, או ציבורי/נתיב מוחרג. אין init כפול.
      setMetaConsent(granted ? 'grant' : 'revoke')
      if (granted) window.fbq?.('track', 'PageView')
    } else if (granted) {
      window.fbq?.('track', 'PageView')
    }
    prevGrantedRef.current = granted
  }, [granted, pathname])

  if (!scriptLoaded) return null

  return (
    <>
      <Script id="meta-pixel-init" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('consent', 'grant');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  )
}
