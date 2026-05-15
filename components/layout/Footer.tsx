import Link from 'next/link'
import { MapPin, Phone } from 'lucide-react'
import { WHATSAPP_URL, PHONE_NUMBER } from '@/lib/utils'

const navLinks = [
  { href: '/services', label: 'שירותים' },
  { href: '/gallery', label: 'גלריה' },
  { href: '/blog', label: 'מאמרים' },
  { href: '/shop', label: 'חנות' },
]

export default function Footer() {
  return (
    <footer className="bg-brand-dark text-white" role="contentinfo" aria-label="פוטר האתר">
      {/* Main footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {/* Brand */}
          <div>
            <Link href="/" className="inline-flex flex-col gap-1 mb-4 group" aria-label="S.M BROWS דף הבית">
              <span className="font-serif text-2xl font-bold tracking-widest text-white group-hover:text-brand-gold transition-colors">
                S.M BROWS
              </span>
              <span className="text-[10px] tracking-[0.18em] text-brand-gold font-medium uppercase">
                IT&apos;S ALL ABOUT YOUR EYEBROWS
              </span>
            </Link>
            <p className="text-white/60 text-sm leading-relaxed max-w-xs mt-4">
              סטודיו מקצועי לעיצוב גבות המתמחה במיקרובליידינג, עיצוב גבות טבעי והרמת גבות. אצלנו
              הגבות שלך בידיים הטובות ביותר.
            </p>
          </div>

          {/* Quick links */}
          <nav aria-label="קישורים מהירים">
            <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-5">
              קישורים מהירים
            </h3>
            <ul className="space-y-3" role="list">
              {navLinks.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-white/60 hover:text-brand-gold transition-colors text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
                  >
                    {label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="קביעת תור בוואצאפ"
                  className="text-brand-gold hover:text-brand-gold-light transition-colors text-sm font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded"
                >
                  קבעי תור ←
                </a>
              </li>
            </ul>
          </nav>

          {/* Contact */}
          <div>
            <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-5">
              צור קשר
            </h3>
            <ul className="space-y-4" role="list">
              <li>
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`שלחי הודעה בוואצאפ – ${PHONE_NUMBER}`}
                  className="flex items-center gap-3 text-white/60 hover:text-brand-gold transition-colors text-sm cursor-pointer"
                >
                  <WhatsAppIcon className="w-4 h-4 text-[#25D366] flex-shrink-0" />
                  <span>{PHONE_NUMBER}</span>
                </a>
              </li>
              <li>
                <a
                  href={`tel:${PHONE_NUMBER.replace(/-/g, '')}`}
                  aria-label={`התקשרי אלינו – ${PHONE_NUMBER}`}
                  className="flex items-center gap-3 text-white/60 hover:text-brand-gold transition-colors text-sm cursor-pointer"
                >
                  <Phone className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  <span>{PHONE_NUMBER}</span>
                </a>
              </li>
              <li className="flex items-center gap-3 text-white/60 text-sm">
                <MapPin className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>אשקלון, ישראל</span>
              </li>
            </ul>

          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-white/40 text-xs text-center sm:text-right">
            © {new Date().getFullYear()} S.M BROWS. כל הזכויות שמורות.
          </p>
          <p className="text-white/30 text-xs">
            עוצב ופותח בישראל
          </p>
        </div>
      </div>
    </footer>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

