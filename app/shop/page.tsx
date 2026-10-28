import PageHero from '@/components/ui/PageHero'
import ProductCard from '@/components/shop/ProductCard'
import { products } from '@/lib/data'
import { cn } from '@/lib/utils'
import { breadcrumbJsonLd } from '@/lib/breadcrumbs'

/**
 * החנות — עמוד האינדקס.
 *
 * ═══ 🔒 מה מוצג כאן, ומה **לא** ═══
 *
 * אך ורק מוצרים שמסומנים `status: 'coming_soon'`.
 *
 * 🔴 שמונת המוצרים האחרים ב-`products` (lib/data.ts) הם **מוצרי דמה**:
 * שמות ומחירים שלא אושרו, ותמונות Unsplash גנריות. הם נוצרו כשהחנות
 * תוכננה ומעולם לא הוצגו — app/shop/page.tsx הציג "החנות בבנייה" בלבד.
 * רינדור שלהם כאן היה מעלה לאוויר מחירים מומצאים של עסק אמיתי, ועוד
 * כפתור "הוסף לסל" שמוביל לעגלה חסרת מסלול תשלום (lib/cart.tsx — state
 * בזיכרון, בלי checkout). לכן הסינון כאן אינו קוסמטי והוא לא "עד שיהיה
 * נוח": מוצר נכנס לעמוד הזה רק אחרי שהתוכן והמחיר שלו אושרו.
 *
 * ⚠️ Server Component. לא נדרש JS לרינדור הגריד; ProductCard עצמו הוא
 * client component ומטפל בחלקים האינטראקטיביים. framer-motion הוסר מכאן
 * יחד עם בלוק ה"בבנייה" שהוא הנפיש.
 *
 * ה-metadata (כולל canonical) יושב ב-app/shop/layout.tsx ולא כאן.
 */
export default function ShopPage() {
  const comingSoon = products.filter((p) => p.status === 'coming_soon')

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd([{ name: 'חנות', path: '/shop' }])),
        }}
      />
      <PageHero
        title="מוצרי גבות"
        titleHighlight="מקצועיים"
        description="כל מה שצריך לשמור על הגבות מושלמות בין הטיפולים."
      />

      <section
        aria-labelledby="shop-heading"
        className="section-padding bg-brand-cream min-h-[50vh]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-md mx-auto mb-12">
            <h2
              id="shop-heading"
              className="font-serif text-3xl font-bold text-brand-dark mb-3"
            >
              החנות בבנייה
            </h2>
            {/*
              ⚠️ הנוסח חייב להישאר מדויק: אין כרגע מה לקנות באתר. מוצר
              שמוצג כאן הוא "בקרוב" ולא "זמין", ואין בעמוד מסלול רכישה.
            */}
            <p className="text-brand-muted text-base leading-relaxed">
              אני עובדת על משהו מיוחד. בינתיים אפשר להציץ במה שבדרך — ואי אפשר
              עוד להזמין.
            </p>
          </div>

          {comingSoon.length > 0 && (
            /*
              ⚠️ מוצר יחיד אינו מרונדר בגריד של ארבע עמודות: הכרטיס היה
              נצמד לקצה הימני ושלושת התאים הריקים לידו נראים כמו תקלה.
              עם יותר ממוצר אחד חוזר הגריד המלא.
            */
            <ul
              role="list"
              className={cn(
                'grid gap-6 mx-auto',
                comingSoon.length === 1
                  ? 'max-w-xs'
                  : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 max-w-5xl',
              )}
            >
              {comingSoon.map((product) => (
                <li key={product.id} className="flex">
                  <div className="w-full">
                    <ProductCard product={product} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
