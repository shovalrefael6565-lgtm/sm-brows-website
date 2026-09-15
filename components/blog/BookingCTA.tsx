import Link from 'next/link'
import { Calendar, ArrowLeft } from 'lucide-react'
import { WHATSAPP_URL } from '@/lib/utils'
import type { BlogClosing } from '@/lib/data'

interface Props {
  closing: BlogClosing
}

/**
 * הסיום האישי של המאמר + קריאה לפעולה.
 *
 * ⚠️ הכפתור הראשי הוא קביעת התור באתר, והוואצאפ נשאר כאפשרות שנייה:
 * המאמר נגמר בהחלטה ("איזה גוון מתאים לי"), והמסלול שסוגר אותה הוא היומן.
 * הסרגל הצדדי כבר נושא את הוואצאפ כפעולה ראשית, ולכן אין כאן כפילות.
 *
 * הטקסט מגיע מ-post.closing ב-lib/data.ts — פוסט שלא מגדיר closing
 * פשוט לא מרנדר את הבלוק הזה.
 */
export default function BookingCTA({ closing }: Props) {
  return (
    <section
      aria-labelledby="post-closing-heading"
      className="bg-brand-rose-bg rounded-3xl p-6 sm:p-8 border border-brand-rose-light mt-12"
    >
      <h2
        id="post-closing-heading"
        className="font-serif text-xl sm:text-2xl font-bold text-brand-dark mb-3"
      >
        {closing.title}
      </h2>
      {closing.paragraphs.map((p) => (
        <p key={p} className="text-brand-medium text-sm sm:text-base leading-relaxed mb-4">
          {p}
        </p>
      ))}
      <div className="flex flex-wrap gap-2 mt-6">
        <Link
          href={closing.href}
          className="inline-flex items-center gap-2 bg-brand-dark text-white font-semibold px-6 py-3 rounded-xl hover:bg-brand-dark/90 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark"
        >
          <Calendar className="w-4 h-4" aria-hidden="true" />
          {closing.label}
        </Link>
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-brand-dark font-medium px-5 py-3 rounded-xl border border-brand-rose-light hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose"
        >
          <ArrowLeft className="w-4 h-4 text-brand-rose" aria-hidden="true" />
          יש לי שאלה לפני
        </a>
      </div>
    </section>
  )
}
