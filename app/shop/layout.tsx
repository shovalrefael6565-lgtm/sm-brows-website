import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'חנות מוצרי גבות',
  description: 'מוצרי גבות מקצועיים של S.M BROWS — שמירה על הגבות המושלמות בין הטיפולים. החנות בקרוב.',
  alternates: { canonical: '/shop' },
  openGraph: {
    title: 'חנות מוצרי גבות | S.M BROWS',
    description: 'מוצרי גבות מקצועיים — שמירה על הגבות המושלמות בין הטיפולים.',
    url: `${SITE_URL}/shop`,
    type: 'website',
    // ⚠️ ברגע שעמוד מגדיר openGraph משלו הוא מפסיק לרשת את השדות של
    // ה-layout (ראה node_modules/next/dist/docs .../generate-metadata.md).
    // כאן חסרו locale ו-images, ולכן ל-/shop לא הייתה תמונת שיתוף כלל.
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [
      { url: '/hero.webp', width: 1200, height: 630, alt: 'S.M BROWS — חנות מוצרי גבות' },
    ],
  },
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children
}
