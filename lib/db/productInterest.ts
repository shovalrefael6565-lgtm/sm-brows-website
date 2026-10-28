import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/**
 * שכבת ה-DB של ההרשמה לעדכון מוצר (0038).
 *
 * ═══ 🔒 מה הקובץ הזה **אינו** עושה ═══
 *
 *   ❌ **אינו יוצר לקוחה.** אין כאן קריאה ל-`link_or_create_customer_by_phone`
 *      ואסור להוסיף אחת: הטופס אוסף טלפון בלי שם, ו-`customers.full_name`
 *      הוא not null. הטלפון נשמר על השורה ב-`product_interest_requests`.
 *      ראה ההסבר המלא בראש 0038.
 *   ❌ אינו נוגע ב-`marketing_consent` ובאף עמודת דיוור.
 *   ❌ אינו שולח SMS ואינו קורא ל-dispatch כלשהו.
 *   ❌ אינו נוגע ב-`appointments`, ב-`waitlist_requests` וב-`booking_rate_events`.
 *
 * ⚠️ **אין טלפון בלוגים.** אותה דוקטרינה כמו lib/db/waitlist.ts: גם
 * `error.message` של הספק אינו נרשם, כי הוא עלול לשאת את הערך שנדחה.
 */

/** 🔒 תקרה קשיחה מקבילה נאכפת ב-RPC; הערך כאן יכול רק להדק. */
export const PRODUCT_INTEREST_MAX_PER_IP_PER_HOUR = 10

export type ProductInterestError =
  | 'rate_limited'
  | 'phone_limit'
  | 'privacy_not_acknowledged'
  | 'invalid_details'
  | 'db_error'

export interface CreateProductInterestInput {
  productSlug: string
  /** 🔒 מנורמל ע"י normalizePhone בשרת לפני הקריאה. */
  phoneE164: string
  shade: string | null
  source: string
  ip: string
  privacyNoticeVersion: string
  privacyAcknowledged: boolean
}

export interface CreateProductInterestResult {
  id?: string
  /** true = הטלפון כבר רשום למוצר הזה. **אינו שגיאה.** */
  already?: boolean
  error?: ProductInterestError
}

/**
 * יצירת הרשמה.
 *
 * ⚠️ **idempotent**: הרשמה חוזרת של אותו טלפון לאותו מוצר מחזירה את השורה
 * הקיימת עם `already: true`, ולא שגיאה. זו הדרישה — לחיצה שנייה אינה
 * אמורה לנפח את ספירת הביקוש ואינה אמורה להיראות ככישלון.
 */
export async function createProductInterest(
  input: CreateProductInterestInput,
): Promise<CreateProductInterestResult> {
  const db = createSupabaseAdminClient()

  const { data, error } = await db.rpc('create_product_interest', {
    p_product_slug: input.productSlug,
    p_phone_e164: input.phoneE164,
    p_shade: input.shade,
    p_source: input.source,
    p_ip: input.ip,
    p_max_per_ip_per_hour: PRODUCT_INTEREST_MAX_PER_IP_PER_HOUR,
    p_privacy_notice_version: input.privacyNoticeVersion,
    p_privacy_acknowledged: input.privacyAcknowledged,
  })

  if (error) {
    if (error.message?.includes('RATE_LIMITED')) return { error: 'rate_limited' }
    if (error.message?.includes('PHONE_LIMIT')) return { error: 'phone_limit' }
    if (error.message?.includes('PRIVACY_NOT_ACKNOWLEDGED')) {
      return { error: 'privacy_not_acknowledged' }
    }
    if (
      error.message?.includes('BAD_PHONE')
      || error.message?.includes('BAD_PRODUCT')
      || error.message?.includes('BAD_SOURCE')
    ) {
      return { error: 'invalid_details' }
    }
    // ⚠️ קוד בלבד. error.message עלול לשאת את הטלפון שנדחה.
    console.error('[product-interest] create failed', error.code ?? 'unknown')
    return { error: 'db_error' }
  }

  /*
   * ⚠️ ה-RPC מוגדר `returns table`, ולכן supabase-js מחזיר מערך שורות
   * ולא אובייקט בודד — בשונה מ-create_waitlist_request שמחזיר שורה.
   */
  const row = Array.isArray(data) ? data[0] : data
  const typed = row as { id?: string; already?: boolean } | null

  if (!typed?.id) {
    console.error('[product-interest] rpc returned no id')
    return { error: 'db_error' }
  }

  return { id: typed.id, already: typed.already === true }
}
