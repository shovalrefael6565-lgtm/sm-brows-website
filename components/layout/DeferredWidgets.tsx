'use client'

import dynamic from 'next/dynamic'

// Non-critical UI — loaded after hydration, not part of initial JS bundle.
// `next/dynamic({ ssr: false })` is only allowed in Client Components (Next.js 15+),
// so this wrapper exists purely to host these calls outside the Server Component layout.
const WhatsAppButton = dynamic(() => import('@/components/ui/WhatsAppButton'), { ssr: false })
const AccessibilityWidget = dynamic(() => import('@/components/ui/AccessibilityWidget'), { ssr: false })
const FloatingSocialButtons = dynamic(() => import('@/components/ui/FloatingSocialButtons'), { ssr: false })
const ScrollToTop = dynamic(() => import('@/components/ui/ScrollToTop'), { ssr: false })
const NavigationProgress = dynamic(() => import('@/components/ui/NavigationProgress'), { ssr: false })
const CookieNotice = dynamic(() => import('@/components/ui/CookieNotice'), { ssr: false })

export default function DeferredWidgets({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <NavigationProgress />
      <FloatingSocialButtons />
      <WhatsAppButton />
      <ScrollToTop />
      <AccessibilityWidget />
      {children}
      <CookieNotice />
    </>
  )
}
