'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, Search, ShoppingCart, Calendar, ChevronDown, ShoppingBag } from 'lucide-react'
import { cn, WHATSAPP_URL, INSTAGRAM_URL, FACEBOOK_URL, TIKTOK_URL } from '@/lib/utils'
import { useCart } from '@/lib/cart'
import { services, products } from '@/lib/data'
import SocialIcons from '@/components/ui/SocialIcons'

const navLinks = [
  { href: '/services', label: 'טיפולים', special: null },
  { href: '/blog', label: 'מאמרים', special: null },
  { href: '/shop', label: 'חנות', special: null },
  { href: '/services#course', label: 'קורסים', special: 'course' },
  { href: '/contact', label: 'יצירת קשר', special: null },
]

const mobileNavLinks = [
  { href: '/services', label: 'טיפולים', special: null },
  { href: '/blog', label: 'מאמרים', special: null },
  { href: '/shop', label: 'חנות', special: null },
  { href: '/services#course', label: 'קורסים', special: 'course' },
  { href: '/contact', label: 'יצירת קשר', special: null },
]

const SECTIONS = [
  { id: 'hero', label: 'ראשי' },
  { id: 'services', label: 'טיפולים' },
  { id: 'before-after', label: 'לפני ואחרי' },
  { id: 'gallery', label: 'גלריה' },
  { id: 'why-us', label: 'למה אני' },
  { id: 'blog', label: 'מאמרים' },
  { id: 'booking', label: 'קביעת תור' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSection, setActiveSection] = useState('hero')
  const [bookingOpen, setBookingOpen] = useState(false)

  const { count: cartCount } = useCart()
  const searchRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const bookingRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const router = useRouter()
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

  useEffect(() => { setMenuOpen(false) }, [pathname])

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  // Close search dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close booking dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bookingRef.current && !bookingRef.current.contains(e.target as Node)) {
        setBookingOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      router.push(`/blog?q=${encodeURIComponent(searchQuery.trim())}`)
      setSearchOpen(false)
      setSearchQuery('')
    }
  }

  const searchResults = useMemo(() => {
    const q = searchQuery.trim()
    if (q.length < 2) return []
    const serviceMatches = services
      .filter((s) => s.name.includes(q) || s.tagline.includes(q) || s.description.includes(q))
      .slice(0, 3)
      .map((s) => ({ type: 'service' as const, id: s.id, name: s.name, sub: s.tagline, href: `/services#${s.id}` }))
    const productMatches = products
      .filter((p) => p.name.includes(q) || p.description.includes(q) || p.category.includes(q))
      .slice(0, 2)
      .map((p) => ({ type: 'product' as const, id: p.id, name: p.name, sub: p.price > 0 ? `₪${p.price}` : 'לפרטים', href: '/shop' }))
    return [...serviceMatches, ...productMatches]
  }, [searchQuery])

  return (
    <>
      <header role="banner" className="fixed top-0 inset-x-0 z-50">

        {/* Main nav */}
        <div className={cn(
          'transition-all duration-300',
          scrolled ? 'bg-white/95 backdrop-blur-md shadow-soft py-3' : 'bg-transparent py-4'
        )}>
          <nav
            aria-label="ניווט ראשי"
            className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4"
          >
            {/* Logo + social circles */}
            <div className="flex items-center gap-2.5 sm:gap-3 flex-shrink-0">
            {/* Logo */}
            <Link
              href="/"
              aria-label="S.M BROWS – דף הבית"
              className="flex items-center gap-2 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded-xl"
            >
              <Image
                src="/logo.png"
                alt="S.M BROWS"
                width={64}
                height={64}
                priority
                className="w-11 h-11 sm:w-16 sm:h-16"
              />
              <div className="flex flex-col items-start gap-0.5">
                <span className="font-serif text-lg sm:text-2xl font-bold tracking-widest text-brand-dark leading-none">
                  S.M BROWS
                </span>
                <span className="font-serif text-[9px] sm:text-[10px] tracking-[0.18em] text-brand-gold font-medium uppercase leading-none">
                  IT&apos;S ALL ABOUT YOUR EYEBROWS
                </span>
              </div>
            </Link>

            {/* Social circles — mobile only, beside the business name */}
            <div className="flex lg:hidden items-center gap-1" aria-label="רשתות חברתיות">
              <a
                href={TIKTOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="S.M BROWS בטיקטוק"
                className="w-5 h-5 rounded-full bg-black text-white flex items-center justify-center shadow-sm active:scale-90 transition-transform duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                <TikTokIcon className="w-2.5 h-2.5" />
              </a>
              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="S.M BROWS בפייסבוק"
                className="w-5 h-5 rounded-full bg-[#1877F2] text-white flex items-center justify-center shadow-sm active:scale-90 transition-transform duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                <FacebookIcon className="w-2.5 h-2.5" />
              </a>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="S.M BROWS באינסטגרם"
                className="w-5 h-5 rounded-full bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white flex items-center justify-center shadow-sm active:scale-90 transition-transform duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                <InstagramIcon className="w-2.5 h-2.5" />
              </a>
            </div>
            </div>

            {/* Desktop nav links */}
            <ul className="hidden lg:flex items-center gap-6 flex-1 justify-center" role="list">
              {navLinks.map(({ href, label, special }) => {
                const isActive = pathname === href || (href.includes('#') && pathname === href.split('#')[0])
                return (
                  <li key={label}>
                    <Link
                      href={href}
                      className={cn(
                        'text-sm font-medium transition-colors duration-200 relative py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded',
                        special === 'sale'
                          ? 'font-serif text-brand-gold font-bold hover:text-brand-gold-dark'
                          : special === 'course'
                          ? 'text-brand-rose font-semibold hover:text-brand-rose/80'
                          : isActive
                          ? 'text-brand-rose'
                          : 'text-brand-dark hover:text-brand-rose'
                      )}
                      aria-current={isActive && !special ? 'page' : undefined}
                    >
                      {label}
                      {special === 'sale' && (
                        <span className="absolute -top-1.5 -end-2 w-1.5 h-1.5 rounded-full bg-brand-gold" aria-hidden="true" />
                      )}
                      {!special && isActive && (
                        <motion.span
                          layoutId="nav-underline"
                          className="absolute bottom-0 inset-x-0 h-0.5 bg-brand-rose rounded-full"
                        />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>

            {/* Right side — search + cart + CTA + mobile toggle */}
            <div className="flex items-center gap-2 flex-shrink-0">

              {/* Search with live results */}
              <div ref={searchContainerRef} className="relative hidden sm:block">
                <AnimatePresence mode="wait">
                  {searchOpen ? (
                    <motion.form
                      key="search-open"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 180, opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      onSubmit={handleSearch}
                      className="flex items-center overflow-hidden"
                    >
                      <div className="flex items-center gap-1.5 bg-brand-cream border border-brand-cream-dark rounded-full px-3 py-1.5 w-full">
                        <Search className="w-3.5 h-3.5 text-brand-muted flex-shrink-0" aria-hidden="true" />
                        <input
                          ref={searchRef}
                          type="search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="חיפוש..."
                          aria-label="חיפוש באתר"
                          className="bg-transparent text-sm text-brand-dark placeholder:text-brand-muted outline-none w-full text-right"
                        />
                        <button
                          type="button"
                          aria-label="סגור חיפוש"
                          onClick={() => { setSearchOpen(false); setSearchQuery('') }}
                          className="text-brand-muted hover:text-brand-dark transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </motion.form>
                  ) : (
                    <motion.button
                      key="search-closed"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      type="button"
                      aria-label="פתיחת חיפוש"
                      onClick={() => setSearchOpen(true)}
                      className="flex p-2 rounded-lg text-brand-dark hover:bg-brand-rose-light transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
                    >
                      <Search className="w-5 h-5" />
                    </motion.button>
                  )}
                </AnimatePresence>

                {/* Live search results dropdown */}
                <AnimatePresence>
                  {searchOpen && searchResults.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute top-full mt-2 right-0 w-72 bg-white rounded-2xl shadow-[0_8px_40px_-8px_rgba(44,24,16,0.18)] border border-brand-cream-dark/60 overflow-hidden z-30"
                      role="listbox"
                      aria-label="תוצאות חיפוש"
                    >
                      {searchResults.map((result, i) => (
                        <Link
                          key={result.id}
                          href={result.href}
                          role="option"
                          aria-selected="false"
                          onClick={() => { setSearchOpen(false); setSearchQuery('') }}
                          className={cn(
                            'flex items-center gap-3 px-4 py-3 hover:bg-brand-cream transition-colors cursor-pointer',
                            i < searchResults.length - 1 && 'border-b border-brand-cream-dark/40'
                          )}
                        >
                          <span
                            className={cn(
                              'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center',
                              result.type === 'service' ? 'bg-brand-rose/10' : 'bg-brand-gold/10'
                            )}
                            aria-hidden="true"
                          >
                            {result.type === 'service' ? (
                              <SparkleIcon className="w-4 h-4 text-brand-rose" />
                            ) : (
                              <ShoppingBag className="w-4 h-4 text-brand-gold" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-brand-dark truncate">{result.name}</p>
                            <p className="text-xs text-brand-muted truncate">{result.sub}</p>
                          </div>
                        </Link>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Cart */}
              <Link
                href="/shop"
                aria-label={`עגלת קניות — ${cartCount} פריטים`}
                className="relative hidden sm:flex p-2 rounded-lg text-brand-dark hover:bg-brand-rose-light transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                <ShoppingCart className="w-5 h-5" />
                {cartCount > 0 && (
                  <span
                    className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] rounded-full bg-brand-rose text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none"
                    aria-hidden="true"
                  >
                    {cartCount}
                  </span>
                )}
              </Link>

              {/* Booking dropdown */}
              <div ref={bookingRef} className="relative hidden md:block">
                <button
                  type="button"
                  onClick={() => setBookingOpen((v) => !v)}
                  aria-haspopup="true"
                  aria-expanded={bookingOpen}
                  aria-label="קביעת תור"
                  className="inline-flex items-center gap-1.5 bg-brand-gold text-brand-dark text-sm font-semibold px-4 py-2.5 rounded-full hover:bg-brand-gold-dark transition-colors duration-200 shadow-gold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 select-none"
                >
                  <WhatsAppIcon className="w-4 h-4" />
                  קבעי תור
                  <motion.span
                    animate={{ rotate: bookingOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </motion.span>
                </button>

                <AnimatePresence>
                  {bookingOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute top-full mt-3 left-0 z-30 bg-white rounded-2xl shadow-[0_8px_40px_-8px_rgba(44,24,16,0.18)] border border-brand-cream-dark/60 overflow-hidden min-w-[210px]"
                      role="menu"
                    >
                      <a
                        href={WHATSAPP_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        onClick={() => setBookingOpen(false)}
                        className="flex items-center gap-3 px-4 py-3.5 hover:bg-brand-cream transition-colors cursor-pointer group border-b border-brand-cream-dark/40"
                      >
                        <span className="w-8 h-8 rounded-xl bg-[#25D366]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#25D366]/20 transition-colors">
                          <WhatsAppIcon className="w-4 h-4 text-[#25D366]" />
                        </span>
                        <div className="text-right">
                          <p className="text-sm font-bold text-brand-dark">תור בוואצאפ</p>
                          <p className="text-xs text-brand-muted">מענה מהיר</p>
                        </div>
                      </a>
                      <Link
                        href="/booking"
                        role="menuitem"
                        onClick={() => setBookingOpen(false)}
                        className="flex items-center gap-3 px-4 py-3.5 hover:bg-brand-cream transition-colors cursor-pointer group"
                      >
                        <span className="w-8 h-8 rounded-xl bg-brand-rose/10 flex items-center justify-center flex-shrink-0 group-hover:bg-brand-rose/20 transition-colors">
                          <Calendar className="w-4 h-4 text-brand-rose" />
                        </span>
                        <div className="text-right">
                          <p className="text-sm font-bold text-brand-dark">תור ביומן</p>
                          <p className="text-xs text-brand-muted">בחרי תאריך ושעה</p>
                        </div>
                      </Link>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Mobile toggle */}
              <button
                type="button"
                aria-label={menuOpen ? 'סגירת תפריט' : 'פתיחת תפריט'}
                aria-expanded={menuOpen}
                aria-controls="mobile-menu"
                onClick={() => setMenuOpen((v) => !v)}
                className="lg:hidden p-2 ms-2 rounded-lg text-brand-dark hover:bg-brand-rose-light transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </nav>

          {/* Section dots — homepage only, desktop only */}
          {isHome && (
            <div className="hidden lg:flex items-center justify-center gap-2 pb-1 pt-0.5">
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
                      isActive ? 'w-5 h-2 bg-brand-rose' : 'w-2 h-2 bg-brand-muted/40 hover:bg-brand-rose/50'
                    )}
                  />
                )
              })}
            </div>
          )}
        </div>
      </header>

      {/* Mobile Menu */}
      <AnimatePresence mode="wait">
        {menuOpen && (
          <>
            <motion.div
              key="menu-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 bg-black/40 z-40 lg:hidden"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              key="menu-panel"
              id="mobile-menu"
              variants={{
                hidden: { x: '100%', transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } },
                visible: { x: 0, transition: { type: 'spring', stiffness: 280, damping: 28 } },
              }}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="fixed top-0 left-0 bottom-0 w-72 bg-white z-50 flex flex-col lg:hidden shadow-soft-lg"
              role="dialog"
              aria-label="תפריט ניווט"
              aria-modal="true"
            >
              <div className="flex items-center justify-between p-5 border-b border-brand-rose-light">
                <Link href="/" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded-xl">
                  <Image src="/logo.png" alt="S.M BROWS" width={48} height={48} />
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="font-serif text-lg font-bold tracking-widest text-brand-dark leading-none">
                      S.M BROWS
                    </span>
                    <span className="font-serif text-[8px] tracking-[0.16em] text-brand-gold font-medium uppercase leading-none">
                      IT&apos;S ALL ABOUT YOUR EYEBROWS
                    </span>
                  </div>
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

              {/* Mobile search */}
              <form onSubmit={handleSearch} className="px-5 pt-4">
                <div className="flex items-center gap-2 bg-brand-cream border border-brand-cream-dark rounded-xl px-3 py-2.5">
                  <Search className="w-4 h-4 text-brand-muted flex-shrink-0" aria-hidden="true" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="חיפוש..."
                    aria-label="חיפוש באתר"
                    className="bg-transparent text-sm text-brand-dark placeholder:text-brand-muted outline-none w-full text-right"
                  />
                </div>
                {/* Mobile search results */}
                {searchResults.length > 0 && (
                  <div className="mt-2 bg-white rounded-xl border border-brand-cream-dark/60 overflow-hidden">
                    {searchResults.map((result, i) => (
                      <Link
                        key={result.id}
                        href={result.href}
                        onClick={() => { setMenuOpen(false); setSearchQuery('') }}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 hover:bg-brand-cream transition-colors cursor-pointer',
                          i < searchResults.length - 1 && 'border-b border-brand-cream-dark/40'
                        )}
                      >
                        <span
                          className={cn(
                            'flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center',
                            result.type === 'service' ? 'bg-brand-rose/10' : 'bg-brand-gold/10'
                          )}
                          aria-hidden="true"
                        >
                          {result.type === 'service' ? (
                            <SparkleIcon className="w-3.5 h-3.5 text-brand-rose" />
                          ) : (
                            <ShoppingBag className="w-3.5 h-3.5 text-brand-gold" />
                          )}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-brand-dark">{result.name}</p>
                          <p className="text-xs text-brand-muted">{result.sub}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </form>

              <nav aria-label="תפריט נייד" className="flex-1 overflow-y-auto px-5 pt-4 pb-4">
                <ul className="space-y-1" role="list">
                  {mobileNavLinks.map(({ href, label, special }) => (
                    <li key={label}>
                      <Link
                        href={href}
                        onClick={() => setMenuOpen(false)}
                        aria-current={pathname === href && !special ? 'page' : undefined}
                        className={cn(
                          'flex items-center px-4 py-3 rounded-xl text-base font-medium transition-colors cursor-pointer',
                          special === 'sale'
                            ? 'font-serif text-brand-gold font-bold hover:bg-brand-gold/10'
                            : special === 'course'
                            ? 'text-brand-rose font-semibold hover:bg-brand-rose-bg'
                            : pathname === href
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

              <div className="p-5 border-t border-brand-rose-light flex flex-col gap-3">
                <Link
                  href="/shop"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-center gap-2 w-full border border-brand-cream-dark text-brand-dark font-medium py-2.5 rounded-xl hover:bg-brand-cream transition-colors cursor-pointer"
                >
                  <ShoppingCart className="w-4 h-4" />
                  עגלת קניות
                  {cartCount > 0 && (
                    <span className="bg-brand-rose text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                      {cartCount}
                    </span>
                  )}
                </Link>
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
                <Link
                  href="/booking"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-center gap-2 w-full border border-brand-rose-light text-brand-dark font-medium py-2.5 rounded-xl hover:bg-brand-rose-bg transition-colors cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-brand-rose" />
                  קביעת תור ביומן
                </Link>

                {/* רשתות חברתיות */}
                <div className="flex items-center justify-center pt-3 mt-1 border-t border-brand-rose-light/70">
                  <SocialIcons label="עקבי אחריי" />
                </div>
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
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  )
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  )
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  )
}
