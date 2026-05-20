import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'חנות מוצרי גבות',
  description: 'מוצרי גבות מקצועיים של S.M BROWS — שמירה על הגבות המושלמות בין הטיפולים. החנות בקרוב.',
  alternates: { canonical: '/shop' },
  openGraph: {
    title: 'חנות מוצרי גבות | S.M BROWS',
    description: 'מוצרי גבות מקצועיים — שמירה על הגבות המושלמות בין הטיפולים.',
    type: 'website',
  },
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children
}
