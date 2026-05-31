'use client'

import { useEffect, useRef } from 'react'

/**
 * Lightweight IntersectionObserver hook — adds 'in-view' class when element
 * enters the viewport. Pair with .reveal-group / .reveal-item CSS classes
 * for GPU-composited scroll animations (no JS per frame).
 */
export function useReveal(margin = '-60px') {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Already visible (e.g. above fold on large screens)
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('in-view')
          obs.disconnect()
        }
      },
      { rootMargin: `0px 0px ${margin} 0px` },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [margin])

  return ref
}
