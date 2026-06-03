import Link from 'next/link'
import { Calendar } from 'lucide-react'
import { WHATSAPP_URL } from '@/lib/utils'

export default function BookingCTA() {
  return (
    <div className="bg-brand-rose-bg rounded-3xl p-6 border border-brand-rose-light mt-10">
      <p className="font-serif text-xl font-bold text-brand-dark mb-2">
        מוכנה לשדרג את הגבות?
      </p>
      <p className="text-brand-medium text-sm mb-4">
        צרי קשר עכשיו לקביעת תור ב-S.M BROWS
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="קביעת תור בוואצאפ"
          className="inline-flex items-center gap-2 bg-brand-linen text-brand-dark font-semibold px-6 py-3 rounded-xl hover:bg-brand-linen-dark transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
        >
          קבעי תור בוואצאפ ←
        </a>
        <Link
          href="/booking"
          aria-label="קביעת תור ביומן"
          className="inline-flex items-center gap-2 text-brand-dark font-medium px-5 py-3 rounded-xl border border-brand-rose-light hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
        >
          <Calendar className="w-4 h-4 text-brand-rose" />
          קביעת תור ביומן
        </Link>
      </div>
    </div>
  )
}
