'use client'

import {
  useState, useEffect, useRef, useCallback, useId,
  type KeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react'
import Image from 'next/image'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useInView, useReducedMotion } from 'framer-motion'

// ── Data ──────────────────────────────────────────────────────────────────────

const REVIEWS = [
  { src: '/wa-review-8.webp',  w: 700, h: 1043 },
  { src: '/wa-review-1.webp',  w: 700, h: 279  },
  { src: '/wa-review-5.webp',  w: 658, h: 710  },
  { src: '/wa-review-9.webp',  w: 700, h: 1043 },
  { src: '/wa-review-2.webp',  w: 700, h: 279  },
  { src: '/wa-review-6.webp',  w: 450, h: 328  },
  { src: '/wa-review-10.webp', w: 700, h: 1022 },
  { src: '/wa-review-3.webp',  w: 700, h: 279  },
  { src: '/wa-review-7.webp',  w: 589, h: 137  },
  { src: '/wa-review-11.webp', w: 700, h: 869  },
  { src: '/wa-review-4.webp',  w: 700, h: 279  },
  { src: '/wa-review-12.webp', w: 700, h: 1023 },
  { src: '/wa-review-15.webp', w: 700, h: 824  },
  { src: '/wa-review-13.webp', w: 700, h: 1023 },
  { src: '/wa-review-14.webp', w: 700, h: 1023 },
] as const

const COUNT = REVIEWS.length
const AUTOPLAY_MS = 5000
const SWIPE_PX = 50

// Stable stage height — computed once from the tallest testimonial's aspect
// ratio. The padding-bottom trick reserves exactly the right vertical space
// for the widest-to-tallest image at any container width, so the stage never
// resizes when the active slide changes.
const MAX_RATIO = Math.max(...REVIEWS.map(({ w, h }) => h / w))

// ── Carousel hook ─────────────────────────────────────────────────────────────

function useCarousel(inView: boolean, reduced: boolean) {
  const [idx, setIdx] = useState(0)
  const interacted = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }, [])

  const go = useCallback((next: number, manual = false) => {
    if (manual) interacted.current = true
    setIdx(((next % COUNT) + COUNT) % COUNT)
  }, [])

  const next = useCallback(() => go(idx + 1, true), [go, idx])
  const prev = useCallback(() => go(idx - 1, true), [go, idx])

  // Autoplay — stops after first manual interaction or when out of view
  useEffect(() => {
    if (reduced || !inView || interacted.current) { clear(); return }
    clear()
    timer.current = setTimeout(() => setIdx(i => (i + 1) % COUNT), AUTOPLAY_MS)
    return clear
  }, [idx, inView, reduced, clear])

  return { idx, next, prev, go }
}

// ── Swipe hook ────────────────────────────────────────────────────────────────

function useSwipe(onNext: () => void, onPrev: () => void) {
  const start = useRef<number | null>(null)

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    start.current = e.clientX
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (start.current === null) return
    const delta = start.current - e.clientX
    if (Math.abs(delta) >= SWIPE_PX) delta > 0 ? onNext() : onPrev()
    start.current = null
  }, [onNext, onPrev])

  return { onPointerDown, onPointerUp }
}

// ── Focus trap hook ───────────────────────────────────────────────────────────

function useFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active || !containerRef.current) return
    const el = containerRef.current
    const focusable = () =>
      Array.from(el.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'
      ))
    const first = () => focusable()[0]
    const last = () => focusable().at(-1)

    const trap = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      if (e.shiftKey) {
        if (document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus() }
      } else {
        if (document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus() }
      }
    }

    el.addEventListener('keydown', trap)
    first()?.focus()
    return () => el.removeEventListener('keydown', trap)
  }, [active, containerRef])
}

// ── Scroll lock ───────────────────────────────────────────────────────────────

function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [active])
}

// ── All-reviews modal ─────────────────────────────────────────────────────────

function ReviewsModal({ open, onClose, triggerRef }: {
  open: boolean
  onClose: () => void
  triggerRef: React.RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const headingId = useId()

  useFocusTrap(open, panelRef)
  useScrollLock(open)

  // Restore focus to trigger on close — only after the modal has been opened
  // at least once. Without this guard the effect runs on mount (open=false)
  // and immediately focuses the carousel button, scrolling the viewport to
  // the Testimonials section before the user has done anything.
  const hasBeenOpen = useRef(false)
  useEffect(() => {
    if (open) { hasBeenOpen.current = true; return }
    if (hasBeenOpen.current) triggerRef.current?.focus()
  }, [open, triggerRef])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (typeof window === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className="fixed inset-0 z-[900] flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-brand-dark/60 backdrop-blur-[2px]"
            aria-hidden="true"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            className="relative z-10 bg-brand-cream w-full max-w-2xl max-h-[92svh] rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-brand-rose-light flex-shrink-0">
              <h2
                id={headingId}
                className="font-serif text-xl font-bold text-brand-dark"
              >
                כל הביקורות{' '}
                <span className="text-brand-rose-text font-medium text-base">({COUNT})</span>
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="סגירת חלון הביקורות"
                className="w-9 h-9 rounded-full flex items-center justify-center text-brand-muted hover:text-brand-dark hover:bg-brand-cream-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-1 cursor-pointer"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Scrollable reviews */}
            <div className="overflow-y-auto overscroll-contain flex-1 px-4 py-5">
              <ul
                className="columns-1 sm:columns-2 gap-4"
                role="list"
                aria-label="כל ביקורות הלקוחות"
              >
                {REVIEWS.map(({ src, w, h }, i) => (
                  <li key={src} className="break-inside-avoid mb-4 list-none">
                    <div className="rounded-xl overflow-hidden shadow-[0_2px_12px_-4px_rgba(44,24,16,0.12)]">
                      <Image
                        src={src}
                        alt={`ביקורת לקוחה ${i + 1} מתוך ${COUNT}`}
                        width={w}
                        height={h}
                        loading="lazy"
                        style={{ width: '100%', height: 'auto', display: 'block' }}
                        sizes="(max-width: 640px) calc(100vw - 3rem), 280px"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

// ── Chevron SVGs ──────────────────────────────────────────────────────────────

function ChevronRight() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function ChevronLeft() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────

export default function TestimonialsSection() {
  const sectionRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const reduced = useReducedMotion() ?? false
  const inView = useInView(sectionRef, { margin: '-100px' })

  const { idx, next, prev, go } = useCarousel(inView, reduced)
  const swipe = useSwipe(next, prev)

  const [modalOpen, setModalOpen] = useState(false)
  const headingId = useId()

  const { src } = REVIEWS[idx]

  // Adjacent indices for preloading
  const nextIdx = (idx + 1) % COUNT
  const prevIdx = (idx - 1 + COUNT) % COUNT

  const FADE_MS = reduced ? 0 : 220

  return (
    <section
      ref={sectionRef}
      id="testimonials"
      aria-labelledby={headingId}
      className="section-padding bg-brand-rose-bg relative overflow-hidden"
    >
      {/* Ambient blurs */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 -start-24 w-96 h-96 rounded-full bg-brand-rose/8 blur-3xl" />
        <div className="absolute -bottom-32 -end-24 w-96 h-96 rounded-full bg-brand-gold/8 blur-3xl" />
      </div>

      <div className="relative max-w-xl mx-auto px-4 sm:px-6">

        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-10"
        >
          <h2
            id={headingId}
            className="font-serif text-4xl sm:text-5xl font-medium text-brand-dark mb-5"
          >
            לקוחות <span className="text-brand-rose-text">ממליצות</span>
          </h2>
          <div className="w-16 h-px bg-gold-gradient mx-auto" aria-hidden="true" />
        </motion.div>

        {/* Carousel */}
        <div
          aria-roledescription="carousel"
          aria-label="ביקורות לקוחות"
          className="select-none"
        >
          {/* Card — clickable trigger for modal */}
          <button
            ref={triggerRef}
            type="button"
            aria-label={`ביקורת ${idx + 1} מתוך ${COUNT} — לחצי לצפייה בכל הביקורות`}
            aria-haspopup="dialog"
            onClick={() => setModalOpen(true)}
            className="w-full text-start cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 rounded-2xl"
            {...swipe}
          >
            <div
              className="relative overflow-hidden rounded-2xl shadow-[0_4px_24px_-6px_rgba(44,24,16,0.14)] hover:shadow-[0_8px_36px_-8px_rgba(44,24,16,0.20)] transition-shadow duration-300 bg-brand-cream"
              style={{
                backgroundImage: "url('/tools-bg.webp')",
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {/* Stable stage — height locked to the tallest review's aspect ratio.
                  Slides are absolute inset-0 so only opacity changes; the stage
                  dimensions never shift and cause no CLS. */}
              <div
                className="relative w-full"
                style={{ paddingBottom: `${(MAX_RATIO * 100).toFixed(4)}%` }}
              >
                {/* Soft white veil — keeps tools-bg subtle in letterbox areas
                    so screenshots always read as the primary subject. Rendered
                    once, outside AnimatePresence, so it never flickers. */}
                <div className="absolute inset-0 bg-white/55" aria-hidden="true" />

                {/* Fade crossfade */}
                <AnimatePresence mode="sync" initial={false}>
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: FADE_MS / 1000 }}
                    className="absolute inset-0"
                  >
                    <Image
                      src={src}
                      alt={`ביקורת לקוחה ${idx + 1} מתוך ${COUNT}`}
                      fill
                      className="object-contain"
                      priority={idx === 0}
                      sizes="(max-width: 640px) calc(100vw - 2rem), 544px"
                      draggable={false}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* "Tap to see all" hint — visible once, on first render */}
            <p className="text-center text-xs text-brand-muted mt-2.5" aria-hidden="true">
              לחצי לצפייה בכל {COUNT} הביקורות
            </p>
          </button>

          {/* Controls row: prev · counter · next */}
          <div className="flex items-center justify-between mt-5 px-1" dir="ltr">
            {/* Prev (← left = goes back in logical order) */}
            <button
              type="button"
              onClick={prev}
              aria-label="ביקורת קודמת"
              className="w-10 h-10 rounded-full border border-brand-rose-light bg-white/80 text-brand-dark flex items-center justify-center hover:bg-brand-cream-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-1 cursor-pointer"
            >
              <ChevronLeft />
            </button>

            {/* Counter */}
            <button
              type="button"
              aria-label={`ביקורת ${idx + 1} מתוך ${COUNT} — לחצי לצפייה בכל הביקורות`}
              onClick={() => setModalOpen(true)}
              className="font-sans text-sm tabular-nums text-brand-muted hover:text-brand-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-1 rounded cursor-pointer px-2 py-1"
              dir="ltr"
            >
              <span className="text-brand-dark font-medium">{idx + 1}</span>
              <span className="mx-1 text-brand-rose-light">/</span>
              <span>{COUNT}</span>
            </button>

            {/* Next (→ right = advances) */}
            <button
              type="button"
              onClick={next}
              aria-label="ביקורת הבאה"
              className="w-10 h-10 rounded-full border border-brand-rose-light bg-white/80 text-brand-dark flex items-center justify-center hover:bg-brand-cream-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-1 cursor-pointer"
            >
              <ChevronRight />
            </button>
          </div>
        </div>

        {/* Hidden preload — adjacent images */}
        <div className="sr-only" aria-hidden="true">
          <Image src={REVIEWS[nextIdx].src} alt="" width={1} height={1} loading="eager" priority />
          <Image src={REVIEWS[prevIdx].src} alt="" width={1} height={1} loading="eager" />
        </div>
      </div>

      {/* All-reviews modal */}
      <ReviewsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        triggerRef={triggerRef as React.RefObject<HTMLElement | null>}
      />
    </section>
  )
}
