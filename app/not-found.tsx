import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'עמוד לא נמצא | S.M BROWS',
}

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-hero-gradient px-4">
      <div className="text-center max-w-md">
        <p className="font-serif text-8xl font-bold text-brand-rose/30 mb-4" aria-hidden="true">
          404
        </p>
        <h1 className="font-serif text-3xl font-medium text-brand-dark mb-4">
          העמוד לא נמצא
        </h1>
        <p className="text-brand-medium mb-8 leading-relaxed">
          נראה שהדף שחיפשת לא קיים. אולי הוא הועבר, נמחק, או שהכתובת שגויה.
        </p>
        <Link
          href="/"
          aria-label="חזרה לדף הבית"
          className="inline-flex items-center gap-2 bg-brand-dark text-white font-bold px-6 py-3 rounded hover:bg-brand-dark/90 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark"
        >
          חזרה לדף הבית
        </Link>
      </div>
    </div>
  )
}
