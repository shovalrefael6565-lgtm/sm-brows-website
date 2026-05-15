'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'

interface Props {
  beforeSrc: string
  afterSrc: string
  alt: string
}

export default function BeforeAfterSlider({ beforeSrc, afterSrc, alt }: Props) {
  const [position, setPosition] = useState(50)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback((clientX: number) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    setPosition((x / rect.width) * 100)
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    updatePosition(e.clientX)
  }, [updatePosition])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true)
    updatePosition(e.touches[0].clientX)
  }, [updatePosition])

  useEffect(() => {
    if (!isDragging) return

    const onMouseMove = (e: MouseEvent) => updatePosition(e.clientX)
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      updatePosition(e.touches[0].clientX)
    }
    const stop = () => setIsDragging(false)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stop)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', stop)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stop)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', stop)
    }
  }, [isDragging, updatePosition])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setPosition((p) => Math.min(95, p + 5))
    if (e.key === 'ArrowLeft') setPosition((p) => Math.max(5, p - 5))
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full select-none overflow-hidden rounded-2xl"
      aria-label={`השוואת לפני ואחרי: ${alt}`}
      role="img"
    >
      {/* After image (bottom layer) */}
      <Image
        src={afterSrc}
        alt={`אחרי: ${alt}`}
        fill
        sizes="(max-width: 768px) 100vw, 50vw"
        className="object-cover"
        draggable={false}
      />

      {/* Before image (clipped) */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${position}%` }}
        aria-hidden="true"
      >
        <Image
          src={beforeSrc}
          alt={`לפני: ${alt}`}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
          draggable={false}
        />
      </div>

      {/* Labels */}
      <span
        className="absolute top-3 start-3 bg-black/50 text-white text-xs font-bold px-2.5 py-1 rounded-full backdrop-blur-sm pointer-events-none"
        aria-hidden="true"
      >
        לפני
      </span>
      <span
        className="absolute top-3 end-3 bg-brand-gold/90 text-brand-dark text-xs font-bold px-2.5 py-1 rounded-full backdrop-blur-sm pointer-events-none"
        aria-hidden="true"
      >
        אחרי
      </span>

      {/* Divider line */}
      <div
        className="absolute inset-y-0 w-0.5 bg-white shadow-md pointer-events-none"
        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
        aria-hidden="true"
      />

      {/* Drag handle */}
      <div
        role="slider"
        aria-label="הזזת מחוון השוואה"
        aria-valuenow={Math.round(position)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onKeyDown={onKeyDown}
        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
        className="absolute top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white rounded-full shadow-soft-lg flex items-center justify-center cursor-ew-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-brand-dark" aria-hidden="true">
          <path d="M9 6L4 12L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 6L20 12L15 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}
