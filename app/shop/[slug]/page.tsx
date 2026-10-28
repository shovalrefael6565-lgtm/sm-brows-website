import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { products, type Product } from '@/lib/data'
import { SITE_URL, absoluteUrl } from '@/lib/utils'
import { breadcrumbJsonLd } from '@/lib/breadcrumbs'
import ProductGallery from '@/components/shop/ProductGallery'
import ProductNotifySection from '@/components/shop/ProductNotifySection'

/**
 * עמוד מוצר בודד — /shop/<slug>.
 *
 * ═══ מה העמוד הזה כן ═══
 *
 * Server Component שקורא מ-`products` ב-lib/data.ts, בדיוק כמו
 * app/blog/[slug]/page.tsx קורא מ-`blogPosts`. אותו חוזה: params הוא
 * Promise ונפתח ב-await, generateStaticParams מייצר את העמודים בבנייה,
 * ו-slug שאינו קיים מגיע ל-notFound().
 *
 * ═══ 🔒 מה העמוד הזה **אינו** עושה ═══
 *
 *   ❌ אינו נוגע בעגלה. אין Add to Cart, אין useCart ואין מחיר למוצר
 *      coming_soon — ראה ההערה על Product.status ב-lib/data.ts.
 *   ❌ **אינו מצהיר Product/Offer ב-JSON-LD.** אין למוצר מחיר, מלאי או
 *      זמינות שמוצגים על המסך, וסימון שמצהיר עליהם הוא בדיוק מה שמדיניות
 *      ה-structured data של Google אוסרת. אותו שיקול בדיוק שבגללו
 *      app/layout.tsx אינו מצהיר מחיר למיקרובליידינג. breadcrumb בלבד.
 *   ❌ אינו אוסף כרגע שום פרט. טופס ההרשמה מגיע בשלב הבא (ProductNotifyDialog
 *      + /api/product-interest), ועד אז אין בעמוד מסלול שמוביל ל-DB.
 */

interface Props {
  params: Promise<{ slug: string }>
}

/**
 * רק מוצרים שיש להם slug מקבלים עמוד.
 *
 * ⚠️ שמונת מוצרי הדמה ב-lib/data.ts נוצרו בלי slug ולכן אינם מייצרים כאן
 * אף route — הוספת עמוד המוצר אינה פותחת אותם לאינדוקס.
 */
function findProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug)
}

export async function generateStaticParams() {
  return products
    .filter((p): p is Product & { slug: string } => Boolean(p.slug))
    .map((p) => ({ slug: p.slug }))
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const product = findProduct(params.slug)
  if (!product) return {}

  const comingSoon = product.status === 'coming_soon'
  const title = comingSoon ? `${product.name} — בקרוב` : product.name

  /*
    ⚠️ openGraph כאן **דורס** את זה של app/layout.tsx ואינו ממוזג איתו —
    Next ממזג metadata בין סגמנטים בצורה רדודה בלבד. לכן locale, siteName
    ו-type חוזרים במפורש; בלעדיהם הם נעלמים מהעמוד הזה, וזו בדיוק התקלה
    שתוקנה ב-app/shop/layout.tsx.
  */
  return {
    title,
    description: product.description,
    alternates: { canonical: `/shop/${product.slug}` },
    openGraph: {
      title: `${title} | S.M BROWS`,
      description: product.description,
      url: `${SITE_URL}/shop/${product.slug}`,
      type: 'website',
      locale: 'he_IL',
      siteName: 'S.M BROWS',
      // ⚠️ absoluteUrl ולא שרשור: תמונות המוצר הן URL מוחלט (Unsplash),
      // ושרשור היה מייצר "https://smbrows.co.ilhttps://images.unsplash...".
      // אותה תקלה בדיוק כוסתה ב-app/blog/[slug] וב-test-seo-schema.
      images: [{ url: absoluteUrl(product.image), alt: product.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: product.description,
      images: [absoluteUrl(product.image)],
    },
  }
}

export default async function ProductPage(props: Props) {
  const params = await props.params
  const product = findProduct(params.slug)
  if (!product) notFound()

  const comingSoon = product.status === 'coming_soon'
  const gallery = product.images?.length ? product.images : [product.image]

  return (
    <article lang="he" dir="rtl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([
              { name: 'חנות', path: '/shop' },
              { name: product.name, path: `/shop/${product.slug}` },
            ]),
          ),
        }}
      />

      <section className="bg-brand-cream pt-28 sm:pt-36 pb-16 sm:pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <Link
            href="/shop"
            aria-label="חזרה לחנות"
            className="inline-flex items-center gap-1.5 text-sm text-brand-rose-text hover:text-brand-medium transition-colors mb-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose rounded"
          >
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
            חזרה לחנות
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            <div>
              <ProductGallery
                images={gallery}
                alts={product.imageAlts}
                productName={product.name}
                comingSoon={comingSoon}
              />

              {/*
                🔒 גילוי נאות על תמונות ההדמיה.
                ⚠️ brand-muted ולא opacity או גוון בהיר יותר: הוא 7:1 מול
                לבן ו-AA גם ב-12px, ואילו הנמכת ניגודיות "כדי שיהיה עדין"
                הייתה הופכת את הגילוי לבלתי קריא — כלומר מבטלת אותו.
                ⚠️ יושב מתחת לגלריה ולא בתוכה, כדי שלא ייחתך עם התמונה
                ויישאר נראה בכל מצב של הגלריה.
              */}
              {comingSoon && (
                <p className="mt-4 text-xs leading-relaxed text-brand-muted text-center">
                  התמונות הן הדמיה להמחשה. העיצוב הסופי עשוי להשתנות.
                </p>
              )}
            </div>

            {/* ── פרטי המוצר ── */}
            <div>
              {/* ⚠️ תווית הקטגוריה אופציונלית — ראה Product.category. */}
              {product.category && (
                <span className="text-xs text-brand-gold-text font-semibold uppercase tracking-wider">
                  {product.category}
                </span>
              )}
              <h1 className="font-serif text-4xl sm:text-5xl font-medium text-brand-dark leading-[1.15] mt-2 mb-5">
                {product.name}
              </h1>

              <p className="text-brand-medium text-base sm:text-lg leading-relaxed mb-6">
                {product.description}
              </p>

              {product.longDescription?.map((paragraph) => (
                <p key={paragraph} className="text-brand-medium leading-relaxed mb-4">
                  {paragraph}
                </p>
              ))}

              {/* ── גוונים ──
                  ⚠️ תצוגה בלבד, ובכוונה: כאן המבקרת רואה **אילו** גוונים
                  קיימים. הבחירה עצמה נעשית בתוך טופס ההרשמה, כי גוון בלי
                  הרשמה אינו נשמר בשום מקום ופקד שלא שומר כלום הוא הטעיה.
                  🔒 ה-id-ים כאן הם רשימת ההיתר של השרת — ראה ProductShade
                  ב-lib/data.ts. */}
              {product.shades && product.shades.length > 0 && (
                <div className="mt-8">
                  <p className="text-sm font-semibold text-brand-dark mb-3">גוונים</p>
                  <ul className="flex flex-wrap gap-2" aria-label="הגוונים של המוצר">
                    {product.shades.map((shade) => (
                      <li
                        key={shade.id}
                        className="inline-flex items-center gap-2 bg-white border border-brand-cream-dark rounded-xl px-3 py-2 text-sm text-brand-dark"
                      >
                        {shade.hex && (
                          <span
                            aria-hidden="true"
                            className="w-4 h-4 rounded-full border border-brand-cream-dark"
                            style={{ backgroundColor: shade.hex }}
                          />
                        )}
                        {shade.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ── המסלול היחיד של מוצר coming_soon ──
                  ⚠️ אין כאן "הוסף לסל" ואין מחיר. ראה Product.status
                  ב-lib/data.ts.

                  🔴 ה-endpoint ‎/api/product-interest טרם קיים (הוא נבנה
                  יחד עם המיגרציה 0038). עד אז הטופס נכשל fail-closed
                  ומציג נפילה לוואטסאפ — הוא **אינו** מציג הצלחה כוזבת —
                  אבל אין לפרסם את העמוד לפני שהשמירה עובדת בפועל. */}
              {comingSoon && product.slug && (
                <ProductNotifySection
                  productSlug={product.slug}
                  productName={product.name}
                  shortName={product.shortName ?? product.name}
                  shades={product.shades}
                  source="product_page"
                />
              )}
            </div>
          </div>
        </div>
      </section>
    </article>
  )
}
