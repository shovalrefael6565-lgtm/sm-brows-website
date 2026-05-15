import type { Metadata } from 'next'
import GalleryGrid from '@/components/gallery/GalleryGrid'
import PageHero from '@/components/ui/PageHero'

export const metadata: Metadata = {
  title: 'גלריה | S.M BROWS',
  description:
    'גלריית עבודות של S.M BROWS – תמונות לפני ואחרי מיקרובליידינג, עיצוב גבות טבעי והרמת גבות באשקלון.',
}

export default function GalleryPage() {
  return (
    <>
      <PageHero
        tag="הגלריה שלי"
        title="עבודות שמדברות"
        titleHighlight="בעד עצמן"
        description="כל תמונה כאן מספרת סיפור של שינוי. סינוני לפי סוג הטיפול וגלי את העבודות שלי."
      />
      <section aria-label="גלריית עבודות" className="section-padding bg-brand-cream">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <GalleryGrid />
        </div>
      </section>
    </>
  )
}
