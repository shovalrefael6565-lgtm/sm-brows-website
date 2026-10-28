import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/phone'
import { resolveClientIp } from '@/lib/clientIp'
import { readJsonWithLimit, DEFAULT_MAX_JSON_BYTES } from '@/lib/http/bodyLimit'
import { createProductInterest } from '@/lib/db/productInterest'
import { isProductInterestEnabled } from '@/lib/featureFlags'
import { findProductBySlug, isOpenForInterest, resolveShade, isValidSource } from '@/lib/products'
import { PRIVACY_NOTICE_VERSION } from '@/lib/privacyNotice'

export const dynamic = 'force-dynamic'

/**
 * הרשמה לעדכון על השקת מוצר.
 *
 * ═══ מה זה כן, ומה זה **לא** ═══
 *
 * ✅ שומר שורה ב-`product_interest_requests` (0038) עם הטלפון המנורמל.
 *
 * ❌ **אינו יוצר לקוחה.** ראה ההסבר המלא בראש 0038 ו-lib/db/productInterest.ts.
 * ❌ אינו שולח SMS, אינו קורא ל-dispatchNow ואינו נוגע ב-marketing_consent.
 * ❌ אינו יוצר תור, אינו נוגע בזמינות ואינו מגיע ליומן.
 *
 * ═══ ⚠️ אין נעילת שבת, ובכוונה ═══
 *
 * `/api/bookings/request` ו-`/api/waitlist` חוסמים בשבת כי הם בקשות
 * לשירות בזמן אמת שמגיעות ליומן של שובל. הרשמה לעדכון היא פעולה פסיבית
 * לחלוטין: היא אינה מייצרת שום התראה, שום התחייבות ושום פעולה בצד השני.
 * חסימה שלה הייתה מונעת מלקוחה להשאיר טלפון — בלי שום דבר שהיא מגנה עליו.
 *
 * ═══ 🔒 שכבות ההגנה, בסדר ═══
 *
 *   1. דגל הפעלה (PRODUCT_INTEREST_ENABLED), כבוי כברירת מחדל.
 *   2. IP מהימן (fail-closed).
 *   3. מגבלת גודל גוף הבקשה.
 *   4. ה-slug מאומת מול הקטלוג בשרת, והמוצר חייב להיות coming_soon.
 *   5. טלפון מנורמל (normalizePhone) — הקלט מהדפדפן אינו ראיה.
 *   6. אישור הודעת הפרטיות + הגרסה. ה-RPC אוכף שוב.
 *   7. גוון מאומת מול רשימת הגוונים של אותו מוצר בלבד.
 *   8. מגבלות קצב ב-RPC: IP (מונה נפרד משלו) + טלפון.
 *
 * 🔒 כל מסלול יציאה מחזיר JSON — גם כשל. הדיאלוג נופל fail-closed
 * ומציג וואטסאפ, והוא זקוק לגוף תקין כדי להבדיל בין המצבים.
 */

interface FailureOptions {
  status: number
  error: string
  message: string
  fallback?: boolean
}

function fail({ status, error, message, fallback = false }: FailureOptions) {
  return NextResponse.json(
    { error, message, whatsappFallback: fallback, saved: false },
    { status },
  )
}

export async function POST(req: NextRequest) {
  if (!isProductInterestEnabled()) {
    return fail({
      status: 403,
      error: 'feature_disabled',
      message: 'ההרשמה לעדכון אינה זמינה כרגע.',
      fallback: true,
    })
  }

  const ipResult = resolveClientIp(req.headers)
  if (!ipResult.ok) {
    console.error('[product-interest] no trusted client ip —', ipResult.reason)
    return fail({
      status: 503,
      error: 'ip_unavailable',
      message: 'לא הצלחנו לשמור את ההרשמה כרגע. היא לא נשמרה — אפשר לפנות אלינו בוואטסאפ.',
      fallback: true,
    })
  }

  const parsed = await readJsonWithLimit<{
    productSlug?: string
    phone?: string
    shade?: unknown
    source?: unknown
    privacyNoticeAcknowledged?: unknown
    privacyNoticeVersion?: unknown
  }>(req, DEFAULT_MAX_JSON_BYTES)
  if (!parsed.ok) {
    return parsed.status === 413
      ? fail({ status: 413, error: 'payload_too_large', message: 'הבקשה גדולה מדי.' })
      : fail({ status: 400, error: 'bad_request', message: 'בקשה לא תקינה.' })
  }
  const body = parsed.body

  /*
   * 🔒 המוצר נקבע **בשרת** מול הקטלוג. slug שאינו קיים, או מוצר שאינו
   * coming_soon, מקבלים את אותה תשובה: אין על מה להירשם.
   */
  const product = findProductBySlug(typeof body.productSlug === 'string' ? body.productSlug : '')
  if (!product || !product.slug || !isOpenForInterest(product)) {
    return fail({
      status: 404,
      error: 'product_unavailable',
      message: 'המוצר אינו זמין להרשמה.',
    })
  }

  // 🔒 נרמול, לא ולידציה בלבד: מה שנשמר הוא הפלט של normalizePhone.
  const phone = normalizePhone(body.phone ?? '')
  if (!phone) {
    return fail({
      status: 400,
      error: 'invalid_phone',
      message: 'מספר הטלפון אינו תקין. יש להזין מספר נייד ישראלי.',
    })
  }

  // 🔒 אותה דרישה בדיוק כמו בהזמנה וברשימת ההמתנה. אין מסלול עוקף.
  if (
    body.privacyNoticeAcknowledged !== true
    || body.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION
  ) {
    return fail({
      status: 400,
      error: 'privacy_not_acknowledged',
      message: 'יש לאשר את מדיניות הפרטיות כדי להירשם לעדכון.',
    })
  }

  const shadeResult = resolveShade(product, body.shade)
  if (!shadeResult.ok) {
    return fail({
      status: 400,
      error: 'invalid_shade',
      message: 'הגוון שנבחר אינו זמין למוצר הזה.',
    })
  }

  if (!isValidSource(body.source)) {
    return fail({ status: 400, error: 'invalid_source', message: 'בקשה לא תקינה.' })
  }

  const result = await createProductInterest({
    productSlug: product.slug,
    phoneE164: phone,
    shade: shadeResult.shade,
    source: body.source,
    ip: ipResult.ip,
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    privacyAcknowledged: true,
  })

  if (result.error === 'rate_limited') {
    return fail({
      status: 429,
      error: 'rate_limited',
      message: 'נשלחו יותר מדי בקשות מהמכשיר הזה. אפשר לנסות שוב בעוד שעה, או לפנות אלינו בוואטסאפ.',
      fallback: true,
    })
  }
  if (result.error === 'phone_limit') {
    return fail({
      status: 429,
      error: 'phone_limit',
      message: 'נשלחו יותר מדי בקשות מהמספר הזה בזמן קצר. אפשר לנסות שוב בעוד שעה.',
      fallback: true,
    })
  }
  if (result.error === 'privacy_not_acknowledged') {
    console.error('[product-interest] RPC rejected privacy ack despite route-level check')
    return fail({
      status: 400,
      error: 'privacy_not_acknowledged',
      message: 'יש לאשר את מדיניות הפרטיות כדי להירשם לעדכון.',
    })
  }
  if (result.error === 'invalid_details') {
    return fail({ status: 400, error: 'invalid_details', message: 'הפרטים שהוזנו אינם תקינים.' })
  }
  if (result.error || !result.id) {
    return fail({
      status: 500,
      error: 'server_error',
      message: 'לא הצלחנו לשמור את ההרשמה. היא לא נשמרה — אפשר לפנות אלינו בוואטסאפ.',
      fallback: true,
    })
  }

  /*
   * ⚠️ המינימום ההכרחי: אין מזהה שורה ואין שום סימן שמאפשר להסיק אם
   * הטלפון כבר היה במערכת מעבר למוצר הזה עצמו.
   *
   * ⚠️ `alreadyRegistered` הוא **הצלחה**, לא שגיאה: הלקוחה ברשימה. ה-UI
   * מציג מסך הצלחה בשני המקרים, עם נוסח מעט שונה.
   */
  return NextResponse.json(
    { ok: true, saved: true, alreadyRegistered: result.already === true },
    { status: result.already ? 200 : 201 },
  )
}
