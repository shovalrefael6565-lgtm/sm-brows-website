'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { cn, WHATSAPP_URL } from '@/lib/utils'

const navLinks = [
  { href: '/services', label: 'שירותים' },
  { href: '/gallery', label: 'גלריה' },
  { href: '/blog', label: 'מאמרים' },
  { href: '/shop', label: 'חנות' },
]

const SECTIONS = [
  { id: 'hero', label: 'ראשי' },
  { id: 'services', label: 'שירותים' },
  { id: 'before-after', label: 'לפני ואחרי' },
  { id: 'gallery', label: 'גלריה' },
  { id: 'why-us', label: 'למה אנחנו' },
  { id: 'blog', label: 'מאמרים' },
  { id: 'booking', label: 'קביעת תור' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeSection, setActiveSection] = useState('hero')
  const pathname = usePathname()
  const isHome = pathname === '/'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!isHome) return
    const observers: IntersectionObserver[] = []
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (!el) return
      const observer = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id) },
        { threshold: 0.3, rootMargin: '-10% 0px -40% 0px' }
      )
      observer.observe(el)
      observers.push(observer)
    })
    return () => observers.forEach((o) => o.disconnect())
  }, [isHome])

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  return (
    <>
      <header
        role="banner"
        className={cn(
          'fixed top-0 inset-x-0 z-50 transition-all duration-300',
          scrolled
            ? 'bg-white/95 backdrop-blur-md shadow-soft py-3'
            : 'bg-transparent py-5'
        )}
      >
        <nav
          aria-label="ניווט ראשי"
          className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between"
        >
          {/* Logo */}
          <Link
            href="/"
            aria-label="S.M BROWS – דף הבית"
            className="flex flex-col items-start gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
          >
            <span className="font-serif text-xl sm:text-2xl font-bold tracking-widest text-brand-dark leading-none">
              S.M BROWS
            </span>
            <span className="text-[9px] sm:text-[10px] tracking-[0.18em] text-brand-gold font-medium uppercase leading-none">
              IT&apos;S ALL ABOUT YOUR EYEBROWS
            </span>
          </Link>

          {/* Desktop nav */}
          <ul className="hidden md:flex items-center gap-8" role="list">
            {navLinks.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    'text-sm font-medium transition-colors duration-200 relative py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded',
                    pathname === href
                      ? 'text-brand-rose'
                      : 'text-brand-dark hover:text-brand-rose'
                  )}
                  aria-current={pathname === href ? 'page' : undefined}
                >
                  {label}
                  {pathname === href && (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute bottom-0 inset-x-0 h-0.5 bg-brand-rose rounded-full"
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {/* CTA + Mobile toggle */}
          <div className="flex items-center gap-3">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="קביעת תור בוואצאפ"
              className="hidden sm:inline-flex items-center gap-2 bg-brand-gold text-brand-dark text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-brand-gold-dark transition-colors duration-200 shadow-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 cursor-pointer"
            >
              <WhatsAppIcon className="w-4 h-4" />
              קבעי תור
            </a>

            <button
              type="button"
              aria-label={menuOpen ? 'סגירת תפריט' : 'פתיחת תפריט'}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((v) => !v)}
              className="md:hidden p-2 rounded-lg text-brand-dark hover:bg-brand-rose-light transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
            >
              {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </nav>

        {/* Section dots — homepage only */}
        {isHome && (
          <div className="flex items-center justify-center gap-2 pb-1.5 pt-0.5">
            {SECTIONS.map(({ id, label }) => {
              const isActive = activeSection === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  aria-label={`עבור אל: ${label}`}
                  aria-current={isActive ? 'true' : undefined}
                  title={label}
                  className={cn(
                    'rounded-full transition-all duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                    isActive
                      ? 'w-5 h-2 bg-brand-rose'
                      : 'w-2 h-2 bg-brand-muted/40 hover:bg-brand-rose/50'
                  )}
                />
              )
            })}
          </div>
        )}
      </header>

      {/* Mobile Menu */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/40 z-40 md:hidden"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              id="mobile-menu"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed top-0 left-0 bottom-0 w-72 bg-white z-50 flex flex-col md:hidden shadow-soft-lg"
              role="dialog"
              aria-label="תפריט ניווט"
              aria-modal="true"
            >
              <div className="flex items-center justify-between p-5 border-b border-brand-rose-light">
                <Link href="/" className="flex flex-col gap-0.5" onClick={() => setMenuOpen(false)}>
                  <span className="font-serif text-xl font-bold tracking-widest text-brand-dark">
                    S.M BROWS
                  </span>
                  <span className="text-[9px] tracking-[0.15em] text-brand-gold font-medium uppercase">
                    IT&apos;S ALL ABOUT YOUR EYEBROWS
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="סגירת תפריט"
                  className="p-2 rounded-lg hover:bg-brand-rose-light transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5 text-brand-dark" />
                </button>
              </div>

              <nav aria-label="תפריט נייד" className="flex-1 overflow-y-auto px-5 pt-6 pb-4">
                <ul className="space-y-1" role="list">
                  {navLinks.map(({ href, label }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => setMenuOpen(false)}
                        aria-current={pathname === href ? 'page' : undefined}
                        className={cn(
                          'flex items-center px-4 py-3 rounded-xl text-base font-medium transition-colors cursor-pointer',
                          pathname === href
                            ? 'bg-brand-rose-bg text-brand-rose font-semibold'
                            : 'text-brand-dark hover:bg-brand-rose-bg hover:text-brand-rose'
                        )}
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>

              <div className="p-5 border-t border-brand-rose-light">
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="קביעת תור בוואצאפ"
                  className="flex items-center justify-center gap-2 w-full bg-brand-gold text-brand-dark font-semibold py-3 rounded-xl hover:bg-brand-gold-dark transition-colors cursor-pointer"
                  onClick={() => setMenuOpen(false)}
                >
                  <WhatsAppIcon className="w-5 h-5" />
                  קבעי תור בוואצאפ
                </a>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
