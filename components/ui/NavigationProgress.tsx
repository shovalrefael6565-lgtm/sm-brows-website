'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Shows a gold loading bar at the top of the page during navigation.
 * Starts immediately on any internal link click — gives instant visual
 * feedback while Next.js fetches the new page.
 */
export default function NavigationProgress() {
  const pathname = usePathname()
  const [loading, setLoading] = useState(false)
  const prevPath = useRef(pathname)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for clicks on internal links → start loading immediately
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      // Skip: external links, hashes, tel/mailto
      if (!href || href.startsWith('http') || href.startsWith('#') ||
          href.startsWith('tel') || href.startsWith('mailto')) return
      // Skip: same page
      const targetPath = href.split('?')[0].split('#')[0]
      if (targetPath === pathname) return
      setLoading(true)
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [pathname])

  // Stop bar when pathname changes (navigation complete)
  useEffect(() => {
    if (pathname === prevPath.current) return
    prevPath.current = pathname
    setLoading(false)
    // Safety timeout — stop bar after 3s even if navigation stalls
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setLoading(false), 3000)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [pathname])

  if (!loading) return null

  return (
    <div
      role="progressbar"
      aria-label="טוען עמוד"
      className="fixed top-0 left-0 right-0 z-[9999] h-[3px] overflow-hidden bg-brand-gold/20"
    >
      <div className="h-full w-full animate-nav-progress bg-gradient-to-l from-brand-gold via-brand-rose to-brand-gold bg-[length:200%_100%]" />
    </div>
  )
}
