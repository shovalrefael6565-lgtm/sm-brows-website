import 'server-only'

import { products, type Product, type ProductShade } from '@/lib/data'

/**
 * רשימת ההיתר של המוצרים — בצד השרת.
 *
 * 🔒 **כל ערך שמגיע מהדפדפן ונוגע למוצר עובר כאן.** ה-slug והגוון אינם
 * נשמרים כפי שהתקבלו: הם מאומתים מול הקטלוג ב-lib/data.ts, שהוא מקור
 * האמת היחיד. אותה דוקטרינה בדיוק שבגללה `durationMin` נגזר מ-
 * lib/services.ts ולעולם אינו מתקבל מהקלט (ראה app/api/waitlist/route.ts).
 *
 * ⚠️ `'server-only'` מבטיח שהקובץ לא יגיע לבאנדל הלקוח. lib/data.ts עצמו
 * כן משותף לשני הצדדים — הקטלוג מוצג בדפדפן — אבל **ההחלטה** מה מותר
 * חיה כאן בלבד.
 */

/**
 * מוצר לפי slug, או null.
 *
 * ⚠️ רק מוצרים שיש להם slug. מוצרי הקטלוג הישנים בלי slug אינם קיימים
 * מבחינת ה-API, בדיוק כפי שאין להם עמוד.
 */
export function findProductBySlug(slug: string): Product | null {
  if (!slug) return null
  return products.find(p => p.slug === slug) ?? null
}

/**
 * האם המוצר פתוח להרשמה לעדכון.
 *
 * 🔒 `coming_soon` בלבד. מוצר זמין אינו אמור לקבל הרשמות "לעדכון על
 * ההשקה" — הוא כבר הושק, ובקשה כזו מעידה על קלט שלא נבנה מהעמוד.
 */
export function isOpenForInterest(product: Product): boolean {
  return product.status === 'coming_soon'
}

/**
 * מאמת גוון מול רשימת הגוונים של אותו מוצר ומחזיר את ה-id המדויק.
 *
 * מחזיר:
 *   { ok: true, shade: null }     — לא נבחר גוון (רשות), או שלמוצר אין גוונים
 *   { ok: true, shade: '<id>' }   — גוון חוקי של המוצר הזה
 *   { ok: false }                 — נשלח גוון שאינו ברשימה
 *
 * ⚠️ מוצר ללא גוונים שמקבל בחירת גוון הוא קלט לא תקין ולא "התעלמות
 * שקטה": העמוד לא הציג בורר, ולכן הערך לא הגיע ממנו.
 */
export function resolveShade(
  product: Product,
  requested: unknown,
): { ok: true; shade: string | null } | { ok: false } {
  if (requested === null || requested === undefined || requested === '') {
    return { ok: true, shade: null }
  }
  if (typeof requested !== 'string') return { ok: false }

  const shades: ProductShade[] = product.shades ?? []
  const match = shades.find(s => s.id === requested)
  return match ? { ok: true, shade: match.id } : { ok: false }
}

/** מקורות ההרשמה המותרים. 🔒 רשימה סגורה — `source` אינו טקסט חופשי. */
export const PRODUCT_INTEREST_SOURCES = ['product_page'] as const
export type ProductInterestSource = (typeof PRODUCT_INTEREST_SOURCES)[number]

export function isValidSource(value: unknown): value is ProductInterestSource {
  return typeof value === 'string'
    && (PRODUCT_INTEREST_SOURCES as readonly string[]).includes(value)
}
