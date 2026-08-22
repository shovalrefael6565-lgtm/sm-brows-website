'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useRef, useCallback, useEffect, type CSSProperties } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { services } from '@/lib/data'
import { WHATSAPP_BASE } from '@/lib/utils'

const nd = services.find(s => s.id === 'natural-design')!
const mb = services.find(s => s.id === 'microblading')!
const bl = services.find(s => s.id === 'brow-lifting')!

const MB_CONSULT = `${WHATSAPP_BASE}?text=${encodeURIComponent('היי שובל 🤍 רציתי לקבל פרטים ולייעוץ על מיקרובליידינג')}`

// Index 0 = natural-design — the only treatment with a video
const ND_VIDEO_SRC = '/videos/natural-brow-design-home.mp4'
const ND_POSTER    = nd.homeImages?.[0] ?? nd.images[1] ?? nd.images[0]
const ND_IMG_POS   = nd.homeImagePositions?.[0] ?? nd.imagePositions?.[1] ?? '50% 30%'

interface Treatment {
  id: string
  name: string
  shortDesc: string
  image: string
  imagePos: string
  meta: string
  cta: { label: string; href: string; external?: boolean }
  detailsHref: string
}

const TREATMENTS: Treatment[] = [
  {
    id: 'natural-design',
    name: nd.name,
    shortDesc: nd.homeDescription ?? nd.description,
    image: ND_POSTER,
    imagePos: ND_IMG_POS,
    meta: `${nd.duration} · ${nd.price}`,
    cta: { label: 'קביעת תור', href: '/booking' },
    detailsHref: '/services',
  },
  {
    id: 'microblading',
    name: mb.name,
    shortDesc: mb.homeDescription ?? mb.description,
    image: mb.homeImages?.[0] ?? mb.images[0],
    imagePos: mb.homeImagePositions?.[0] ?? mb.imagePositions?.[0] ?? '50% 35%',
    meta: `${mb.duration} · ייעוץ אישי`,
    cta: { label: 'לשיחת ייעוץ', href: MB_CONSULT, external: true },
    detailsHref: '/services#microblading',
  },
  {
    id: 'brow-lifting',
    name: bl.name,
    shortDesc: bl.homeDescription ?? bl.description,
    image: bl.homeImages?.[1] ?? bl.images[1] ?? bl.images[0],
    imagePos: bl.homeImagePositions?.[1] ?? bl.imagePositions?.[1] ?? '65% 55%',
    meta: `${bl.duration} · ${bl.price}`,
    cta: { label: 'קביעת תור', href: '/booking' },
    detailsHref: '/services',
  },
]

/**
 * Double-buffer crossfade — same technique as ImageSlider.
 * Two image slots swap front/back on each treatment change.
 * Zero intermediate states; stable across rapid switching.
 */
function useImageStage() {
  const [slotA, setSlotA] = useState(0)
  const [slotB, setSlotB] = useState(0)
  const [aIsFront, setAIsFront] = useState(true)
  const navigating = useRef(false)
  const aIsFrontRef = useRef(true)

  const switchImage = useCallback((idx: number) => {
    if (navigating.current) return
    navigating.current = true

    const toBack = aIsFrontRef.current ? 'b' : 'a'
    if (toBack === 'b') setSlotB(idx)
    else setSlotA(idx)

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const front = toBack === 'a'
        setAIsFront(front)
        aIsFrontRef.current = front
        setTimeout(() => { navigating.current = false }, 440)
      })
    )
  }, [])

  return { slotA, slotB, aIsFront, switchImage }
}

export default function ServicesPreview() {
  const [active, setActive] = useState(0)
  const reduceMotion = useReducedMotion()
  const { slotA, slotB, aIsFront, switchImage } = useImageStage()

  // ── Video playback ───────────────────────────────────────────────
  const videoRef      = useRef<HTMLVideoElement>(null)
  const stageRef      = useRef<HTMLDivElement>(null)
  const activeRef     = useRef(0)          // mirrors `active` for callbacks
  const visibleRef    = useRef(false)      // true when stage is in viewport

  // Single source of truth: play iff active===0 AND section visible
  const syncVideo = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (activeRef.current === 0 && visibleRef.current) {
      v.play().catch(() => {})
    } else {
      v.pause()
    }
  }, [])

  // Keep activeRef in sync and resync on every treatment switch
  useEffect(() => {
    activeRef.current = active
    syncVideo()
  }, [active, syncVideo])

  // Warm-up observer — starts the fetch while the stage is still off-screen.
  //
  // ⚠️ Two observers, not one, and the reason is the whole point: they need
  // different rootMargins. The stage used to make its very first byte request
  // at the moment it became 25% visible, so the download and the decoder
  // spin-up both happened while the viewer was already looking at it — a
  // visible hitch on arrival. This one fires a screenful early and does
  // nothing but `load()`, so by the time the playback observer says "go" the
  // data is already there.
  //
  // 🔒 `preload` stays "none" in the markup and is only raised here. That is
  // what keeps the video off the homepage's initial load entirely: a visitor
  // who never scrolls past the testimonials never requests a single byte of
  // it. Setting preload="auto" on the element instead would fetch it for
  // everyone, on every page load — 4.3MB nobody asked for.
  useEffect(() => {
    const el = stageRef.current
    const v = videoRef.current
    if (!el || !v) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        v.preload = 'auto'
        v.load()
        io.disconnect()   // one-shot: the fetch only needs starting once
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Intersection observer — play/pause as section enters/leaves viewport.
  // threshold 0.25 requires a quarter of the stage to be visible before playback.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting
        syncVideo()
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [syncVideo])
  // ────────────────────────────────────────────────────────────────

  const handleSelect = useCallback((idx: number) => {
    if (idx === active) return
    setActive(idx)
    switchImage(idx)
  }, [active, switchImage])

  const xDuration = reduceMotion ? 0 : 0.42

  const slotStyle = (isFront: boolean): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    opacity: isFront ? 1 : 0,
    transition: `opacity ${xDuration}s ease-in-out`,
    willChange: 'opacity',
    transform: 'translateZ(0)',
  })

  // Compute the video layer's front/back state by following whichever
  // buffer slot currently holds natural-design (index 0).
  const ndSlot   = slotA === 0 ? 'a' : slotB === 0 ? 'b' : null
  const ndIsFront = ndSlot === 'a' ? aIsFront : ndSlot === 'b' ? !aIsFront : false

  return (
    <section
      id="services"
      aria-labelledby="services-heading"
      className="py-16 sm:py-24 bg-white"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">

        {/* ── Section heading ─────────────────────────────────────── */}
        <h2
          id="services-heading"
          className="font-serif text-4xl sm:text-5xl lg:text-6xl font-medium text-brand-dark text-center mb-10 sm:mb-14"
        >
          הטיפולים שלי
        </h2>

        {/* ── Editorial treatment selector ─────────────────────────
            Not tabs/pills. Large typographic navigation.
            Active: full opacity + 1px gold bottom rule.
            Inactive: muted, no rule.
        ─────────────────────────────────────────────────────────── */}
        <div
          role="tablist"
          aria-label="בחירת טיפול"
          className="flex items-end border-b border-brand-cream-dark/50 mb-0"
        >
          {TREATMENTS.map((t, i) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`treatment-tab-${t.id}`}
              aria-selected={active === i}
              aria-controls="treatment-stage"
              onClick={() => handleSelect(i)}
              className={`
                relative flex-1 text-center pb-4 pt-0
                text-sm sm:text-base lg:text-lg font-medium leading-snug
                transition-colors duration-300
                cursor-pointer select-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-inset
                ${active === i
                  ? 'text-brand-dark'
                  : 'text-brand-medium/80 hover:text-brand-medium'}
              `}
            >
              {t.name}
              {/* Active indicator — 1px gold rule flush to the section border */}
              <span
                aria-hidden="true"
                className="absolute bottom-0 inset-x-0 h-[1.5px] transition-opacity duration-300"
                style={{
                  backgroundColor: '#C9A96E',
                  opacity: active === i ? 1 : 0,
                }}
              />
            </button>
          ))}
        </div>

        {/* ── Treatment stage ─────────────────────────────────────
            Not a card. Full container width, flush to selector.
            Portrait on mobile, cinematic landscape on desktop.
        ─────────────────────────────────────────────────────────── */}
        <div
          id="treatment-stage"
          ref={stageRef}
          role="tabpanel"
          aria-labelledby={`treatment-tab-${TREATMENTS[active].id}`}
          className="relative overflow-hidden aspect-[3/4] md:aspect-[16/9] lg:aspect-[21/9]"
        >
          {/* Image slot A — renders image only when this slot is NOT natural-design */}
          <div aria-hidden={!aIsFront} style={slotStyle(aIsFront)}>
            {slotA !== 0 && (
              <Image
                src={TREATMENTS[slotA].image}
                alt={aIsFront ? TREATMENTS[slotA].name : ''}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1280px) 95vw, 1260px"
                className="object-cover"
                style={{ objectPosition: TREATMENTS[slotA].imagePos }}
                loading="lazy"
              />
            )}
          </div>

          {/* Image slot B — renders image only when this slot is NOT natural-design */}
          <div aria-hidden={aIsFront} style={slotStyle(!aIsFront)}>
            {slotB !== 0 && (
              <Image
                src={TREATMENTS[slotB].image}
                alt={!aIsFront ? TREATMENTS[slotB].name : ''}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1280px) 95vw, 1260px"
                className="object-cover"
                style={{ objectPosition: TREATMENTS[slotB].imagePos }}
                loading="lazy"
              />
            )}
          </div>

          {/* Natural-design video — always mounted, opacity follows the double-buffer
              slot that currently holds index 0. Plays only when active AND visible. */}
          <div aria-hidden={!ndIsFront} style={slotStyle(ndIsFront)}>
            <video
              ref={videoRef}
              src={ND_VIDEO_SRC}
              poster={ND_POSTER}
              muted
              loop
              playsInline
              preload="none"
              aria-hidden="true"
              className="w-full h-full object-cover"
              style={{ objectPosition: ND_IMG_POS }}
            />
          </div>

          {/* Bottom gradient — deep enough that all text sits in solid contrast zone */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 pointer-events-none"
            style={{
              height: '68%',
              background:
                'linear-gradient(to top, rgba(12,8,6,0.93) 0%, rgba(12,8,6,0.80) 22%, rgba(12,8,6,0.55) 45%, rgba(12,8,6,0.20) 68%, transparent 100%)',
            }}
          />

          {/* Text overlay — bottom of image */}
          <div className="absolute inset-x-0 bottom-0 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10 z-10">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.30,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                {/* Meta — duration · price */}
                <p className="text-white/65 text-xs tracking-widest uppercase font-medium mb-2.5">
                  {TREATMENTS[active].meta}
                </p>

                {/* Treatment name */}
                <h3 className="font-serif text-[1.75rem] sm:text-4xl lg:text-5xl font-medium text-white leading-tight mb-3">
                  {TREATMENTS[active].name}
                </h3>

                {/* One supporting sentence */}
                <p className="text-white/90 text-sm sm:text-base leading-relaxed mb-6 max-w-xs sm:max-w-sm lg:max-w-md">
                  {TREATMENTS[active].shortDesc}
                </p>

                {/* CTAs — conversion action + full details */}
                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                  {TREATMENTS[active].cta.external ? (
                    <a
                      href={TREATMENTS[active].cta.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${TREATMENTS[active].cta.label} — ${TREATMENTS[active].name}`}
                      className="inline-flex items-center bg-brand-cream text-brand-dark font-bold text-sm px-5 py-2.5 rounded hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60"
                    >
                      {TREATMENTS[active].cta.label}
                    </a>
                  ) : (
                    <Link
                      href={TREATMENTS[active].cta.href}
                      aria-label={`${TREATMENTS[active].cta.label} — ${TREATMENTS[active].name}`}
                      className="inline-flex items-center bg-brand-cream text-brand-dark font-bold text-sm px-5 py-2.5 rounded hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/60"
                    >
                      {TREATMENTS[active].cta.label}
                    </Link>
                  )}

                  <Link
                    href={TREATMENTS[active].detailsHref}
                    aria-label={`לפרטים המלאים על ${TREATMENTS[active].name}`}
                    className="text-white/60 hover:text-white text-sm font-medium transition-colors underline underline-offset-4 decoration-white/25 hover:decoration-white/55 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded"
                  >
                    לכל הפרטים
                  </Link>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

      </div>
    </section>
  )
}
