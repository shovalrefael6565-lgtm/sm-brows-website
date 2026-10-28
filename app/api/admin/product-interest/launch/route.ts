import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/adminGuard'
import { isSameOrigin } from '@/lib/auth/originGuard'
import { previewLaunch, sendLaunchBatch } from '@/lib/db/productInterestAdmin'
import { findProductBySlug } from '@/lib/products'

export const dynamic = 'force-dynamic'

/**
 * תצוגה מקדימה ושליחה של הודעת ההשקה.
 *
 * ═══ 🔒 מה הלקוח **אינו** יכול לקבוע ═══
 *
 * הגוף היחיד שמתקבל הוא `{ productSlug }` — מזהה מוצר מתוך הקטלוג.
 * הכל נגזר בשרת:
 *
 *   • **גוף ההודעה** — lib/productLaunch/template.ts. אין פרמטר `body`.
 *   • **הקישור** — נבנה מ-SITE_URL ומה-slug. אין פרמטר `url`.
 *   • **רשימת הנמענות** — שאילתה על `status='open'` של אותו מוצר.
 *     אין פרמטר `recipients`, `phones` או `to`.
 *
 * ⚠️ לקוח שיכול להכתיב גוף הודעה או רשימת נמענות הוא לקוח שיכול לשלוח
 * כל דבר, לכל מספר, בשם העסק. זו הסיבה שה-API הזה מקבל מזהה בלבד.
 *
 * ═══ ⚠️ הפרדה בין preview לשליחה ═══
 *
 * `action: 'preview'` אינו שולח כלום ואינו משנה כלום. `action: 'send'`
 * דורש `confirm: true` במפורש בגוף הבקשה — כדי ששום לחיצה בודדת, ושום
 * בקשה שנשלחה בטעות, לא תתחיל שליחה אמיתית.
 */

interface Body {
  action?: unknown
  productSlug?: unknown
  confirm?: unknown
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response

  // 🔒 גם preview הוא POST ועובר origin guard: הוא חושף ספירות וניסוח.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'בקשה לא תקינה.' }, { status: 400 })
  }

  const slug = typeof body.productSlug === 'string' ? body.productSlug : ''
  // 🔒 מאומת מול הקטלוג בשרת, בדיוק כמו במסלול הציבורי.
  const product = findProductBySlug(slug)
  if (!product?.slug) {
    return NextResponse.json(
      { error: 'product_unavailable', message: 'המוצר אינו קיים.' },
      { status: 404 },
    )
  }

  if (body.action === 'preview') {
    const preview = await previewLaunch(product.slug)
    if (!preview) {
      return NextResponse.json(
        { error: 'preview_failed', message: 'לא הצלחנו להכין תצוגה מקדימה.' },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true, preview })
  }

  if (body.action === 'send') {
    /*
     * 🔴 אישור מפורש בגוף הבקשה. זו אינה כפילות של דיאלוג האישור בממשק:
     * הדיאלוג מגן מפני לחיצה מוטעית, והשדה הזה מגן מפני בקשה שנשלחה
     * מחוץ לממשק.
     */
    if (body.confirm !== true) {
      return NextResponse.json(
        { error: 'confirmation_required', message: 'שליחה דורשת אישור מפורש.' },
        { status: 400 },
      )
    }

    // 🔒 מזהה המנהלת מגיע מה-guard המאומת, לא מגוף הבקשה.
    const summary = await sendLaunchBatch(product.slug, guard.userId)

    /*
     * 🔴 409 — ריצה כבר פעילה, או ריצה קודמת שממתינה לבדיקה. **אף הודעה
     * לא נשלחה**: `sendLaunchBatch` יוצא לפני שהוא קורא נמענות ולפני
     * שהוא נוגע בספק.
     */
    if (summary.runBlocked) {
      const message = summary.runBlocked === 'already_running'
        ? 'כבר מתבצעת שליחת השקה למוצר הזה.'
        : 'ריצה קודמת הסתיימה במצב שדורש בדיקה. לא ניתן לשלוח שוב עד שתיבדק.'
      return NextResponse.json(
        { error: summary.runBlocked, message, summary },
        { status: 409 },
      )
    }

    /*
     * ⚠️ `blocked` אינו שגיאת שרת — זה מצב תקין שהמסך צריך להציג (הדגל
     * כבוי, אין ספק, אין נמענות). 200 עם סיכום.
     */
    return NextResponse.json({ ok: true, summary })
  }

  return NextResponse.json({ error: 'bad_action', message: 'פעולה לא תקינה.' }, { status: 400 })
}
