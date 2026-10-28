import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveProductLaunchProvider } from '@/lib/productLaunch/provider'
import { buildLaunchMessage, launchIdempotencyKey, LAUNCH_SMS_MAX_LENGTH } from '@/lib/productLaunch/template'
import { areProductLaunchNotificationsEnabled } from '@/lib/featureFlags'
import { findProductBySlug } from '@/lib/products'

/**
 * שכבת הניהול של ההרשמות לעדכון מוצר (0038 + 0039).
 *
 * ═══ 🔒 מה הקובץ הזה **אינו** עושה ═══
 *
 *   ❌ אינו נוגע ב-`sms_campaigns`, ב-`sms_campaign_recipients` ובאף חלק
 *      ממערכת הדיוור (0035). הודעת ההשקה היא מימוש של בקשה מפורשת, לא
 *      קמפיין, ולכן גם אינה נספרת, אינה מסוננת לפי `marketing_consent`
 *      ואינה מושפעת מ-`marketing_opted_out_at`.
 *   ❌ אינו יוצר לקוחה ואינו נוגע ב-`customers`.
 *   ❌ אינו נוגע בתורים, בתזכורות, בהתראות וביומן.
 *
 * ⚠️ **אין טלפון בלוגים.** גם לא `error.message` של הספק — הוא עלול לשאת
 * את המספר שנדחה. אותה דוקטרינה כמו lib/db/waitlist.ts ו-lib/db/marketing.ts.
 */

/** כמה נמענות בכל מנה. מכוון: שליחה סדרתית, לא מאות בקשות במקביל. */
export const LAUNCH_BATCH_SIZE = 25

export type ProductInterestStatus = 'open' | 'notified' | 'closed'

export interface ProductInterestRow {
  id: string
  product_slug: string
  phone_e164: string
  shade: string | null
  source: string
  status: ProductInterestStatus
  created_at: string
  notified_at: string | null
  closed_at: string | null
}

export interface ProductInterestCounts {
  total: number
  open: number
  notified: number
  closed: number
}

export interface ListFilters {
  /** חיפוש לפי טלפון — נורמליזציה נעשית ב-route לפני הקריאה. */
  phone?: string
  productSlug?: string
  status?: ProductInterestStatus
}

/**
 * הרשימה למסך הניהול.
 *
 * ⚠️ הטלפון נשלף מהשורה עצמה ולא מ-`customers`: ההרשמה אינה יוצרת כרטיס
 * לקוחה, ולרוב השורות אין כרטיס כלל. ראה 0038.
 */
export async function listProductInterest(
  filters: ListFilters = {},
  limit = 200,
): Promise<ProductInterestRow[]> {
  const db = createSupabaseAdminClient()

  let query = db
    .from('product_interest_requests')
    .select('id, product_slug, phone_e164, shade, source, status, created_at, notified_at, closed_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (filters.productSlug) query = query.eq('product_slug', filters.productSlug)
  if (filters.status) query = query.eq('status', filters.status)
  /*
   * ⚠️ התאמה מדויקת ולא `like`: הטלפון כבר מנורמל ל-E.164 בשני הצדדים,
   * וחיפוש חלקי על עמודת PII הוא בדיוק מה שמאפשר דיג לפי קידומת.
   */
  if (filters.phone) query = query.eq('phone_e164', filters.phone)

  const { data, error } = await query
  if (error) {
    console.error('[product-interest-admin] list failed', error.code ?? 'unknown')
    return []
  }
  return (data ?? []) as ProductInterestRow[]
}

/** ספירות לכותרת המסך. */
export async function countProductInterest(
  filters: Pick<ListFilters, 'productSlug'> = {},
): Promise<ProductInterestCounts> {
  const db = createSupabaseAdminClient()

  let query = db.from('product_interest_requests').select('status')
  if (filters.productSlug) query = query.eq('product_slug', filters.productSlug)

  const { data, error } = await query
  if (error) {
    console.error('[product-interest-admin] count failed', error.code ?? 'unknown')
    return { total: 0, open: 0, notified: 0, closed: 0 }
  }

  const counts: ProductInterestCounts = { total: 0, open: 0, notified: 0, closed: 0 }
  for (const row of data ?? []) {
    counts.total += 1
    const s = (row as { status: ProductInterestStatus }).status
    if (s in counts) counts[s] += 1
  }
  return counts
}

/** כמה נרשמות לכל גוון — רק גוונים שקיימים בנתונים בפועל. */
export async function shadeBreakdown(productSlug: string): Promise<Record<string, number>> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('product_interest_requests')
    .select('shade')
    .eq('product_slug', productSlug)
    .not('shade', 'is', null)

  if (error) {
    console.error('[product-interest-admin] shade breakdown failed', error.code ?? 'unknown')
    return {}
  }
  const out: Record<string, number> = {}
  for (const row of data ?? []) {
    const shade = (row as { shade: string | null }).shade
    if (shade) out[shade] = (out[shade] ?? 0) + 1
  }
  return out
}

/**
 * שינוי סטטוס ידני.
 *
 * 🔴 `'notified'` אינו ערך קביל — ה-RPC דוחה אותו. ראה 0039.
 */
export async function setProductInterestStatus(
  id: string,
  status: 'open' | 'closed',
): Promise<{ ok: boolean; error?: string }> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('set_product_interest_status', {
    p_request_id: id,
    p_status: status,
  })
  if (error) {
    if (error.message?.includes('NOTIFIED_IS_NOT_MANUAL')) {
      console.error('[product-interest-admin] attempt to set notified manually')
      return { ok: false, error: 'notified_is_not_manual' }
    }
    if (error.message?.includes('NOT_FOUND_OR_LOCKED')) return { ok: false, error: 'not_found' }
    console.error('[product-interest-admin] status update failed', error.code ?? 'unknown')
    return { ok: false, error: 'failed' }
  }
  return { ok: true }
}

// ─── הודעת ההשקה ─────────────────────────────────────────────────────────────

export interface LaunchPreview {
  productSlug: string
  productName: string
  /** 🔒 נבנה בשרת. ראה lib/productLaunch/template.ts. */
  body: string
  productUrl: string
  /** כמה שורות במצב open יקבלו הודעה. */
  recipientCount: number
  /** האם בפועל אפשר לשלוח עכשיו. */
  canSend: boolean
  blockedReason?:
    | 'notifications_disabled' | 'provider_disabled' | 'no_recipients' | 'message_too_long'
    /** יש ריצה פעילה כרגע למוצר הזה. */
    | 'already_running'
    /** ריצה קודמת הסתיימה במצב עמום וממתינה לבדיקה אנושית. */
    | 'needs_review'
  providerName: string
  /** הריצה החוסמת, אם יש — להצגת גיל וסטטוס במסך. */
  blockingRun?: Pick<LaunchRun, 'id' | 'status' | 'started_at' | 'mark_failed_count' | 'delivery_unknown_count'>
}

/**
 * מה בדיוק יקרה אם ילחצו "שלחי" — בלי לשלוח כלום.
 *
 * 🔒 מחזיר את **הנוסח המדויק** שיישלח, ואת מספר הנמענות בפועל. המסך אינו
 * מרכיב נוסח משלו ואינו סופר לבד.
 */
export async function previewLaunch(productSlug: string): Promise<LaunchPreview | null> {
  const product = findProductBySlug(productSlug)
  if (!product || !product.slug) return null

  const message = buildLaunchMessage(product)
  if (!message) return null

  const db = createSupabaseAdminClient()
  const { count, error } = await db
    .from('product_interest_requests')
    .select('id', { count: 'exact', head: true })
    .eq('product_slug', product.slug)
    .eq('status', 'open')

  if (error) {
    console.error('[product-interest-admin] preview count failed', error.code ?? 'unknown')
    return null
  }

  const recipientCount = count ?? 0
  const provider = resolveProductLaunchProvider()
  const flagOn = areProductLaunchNotificationsEnabled()

  /*
   * 🔒 שני ברזים **בלתי תלויים**: הדגל פותח את ההחלטה לשלוח, והספק הוא מי
   * ששולח. חסר אחד מהם — אין שליחה, והמסך אומר מה חסר.
   */
  /*
   * 🔴 הריצה החוסמת נבדקת **ראשונה**, לפני הדגלים: אם יש ריצה פעילה או
   * עמומה, זו העובדה החשובה שהמסך צריך להציג — לא "הדגל כבוי".
   *
   * ⚠️ זו בדיקת תצוגה בלבד. ההגנה האמיתית מפני שתי ריצות היא
   * `begin_product_launch_run` האטומי: בין הקריאה הזו לבין השליחה
   * יכולה להיפתח ריצה אחרת, ורק האינדקס הייחודי עוצר אותה.
   */
  const blocking = await blockingLaunchRun(product.slug)

  let blockedReason: LaunchPreview['blockedReason']
  if (blocking?.status === 'running') blockedReason = 'already_running'
  else if (blocking?.status === 'needs_review') blockedReason = 'needs_review'
  else if (!flagOn) blockedReason = 'notifications_disabled'
  else if (!provider.isLive) blockedReason = 'provider_disabled'
  else if (recipientCount === 0) blockedReason = 'no_recipients'
  else if (message.body.length > LAUNCH_SMS_MAX_LENGTH) blockedReason = 'message_too_long'

  return {
    productSlug: product.slug,
    productName: product.name,
    body: message.body,
    productUrl: message.productUrl,
    recipientCount,
    canSend: blockedReason === undefined,
    blockedReason,
    providerName: provider.name,
    blockingRun: blocking
      ? {
          id: blocking.id,
          status: blocking.status,
          started_at: blocking.started_at,
          mark_failed_count: blocking.mark_failed_count,
          delivery_unknown_count: blocking.delivery_unknown_count,
        }
      : undefined,
  }
}

export type LaunchRunStatus = 'running' | 'completed' | 'needs_review' | 'cancelled'

export interface LaunchRun {
  id: string
  product_slug: string
  status: LaunchRunStatus
  started_at: string
  finished_at: string | null
  successful_count: number
  failed_count: number
  skipped_count: number
  mark_failed_count: number
  delivery_unknown_count: number
}

/**
 * מצב הריצות של מוצר, להצגה במסך ולחסימת שליחה.
 *
 * ⚠️ `running` שנתקעה (תהליך שמת באמצע) **אינה משתחררת מעצמה**, ובכוונה:
 * אי אפשר לדעת אם SMS כבר יצא לפני הקריסה. המסך מציג את גילה ומבקש
 * בדיקה; הוא אינו מציע כפתור "שחרר".
 */
export async function latestLaunchRun(productSlug: string): Promise<LaunchRun | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('product_launch_runs')
    .select('id, product_slug, status, started_at, finished_at, successful_count, failed_count, skipped_count, mark_failed_count, delivery_unknown_count')
    .eq('product_slug', productSlug)
    .order('started_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('[product-interest-admin] run lookup failed', error.code ?? 'unknown')
    return null
  }
  return ((data ?? [])[0] as LaunchRun | undefined) ?? null
}

/** ריצה שחוסמת שליחה חדשה: פעילה, או עמומה שממתינה לבדיקה. */
export async function blockingLaunchRun(productSlug: string): Promise<LaunchRun | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('product_launch_runs')
    .select('id, product_slug, status, started_at, finished_at, successful_count, failed_count, skipped_count, mark_failed_count, delivery_unknown_count')
    .eq('product_slug', productSlug)
    .in('status', ['running', 'needs_review'])
    .order('started_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('[product-interest-admin] blocking run lookup failed', error.code ?? 'unknown')
    // ⚠️ fail-closed: אם איננו יודעים אם יש חסימה, מתנהגים כאילו יש.
    return {
      id: '', product_slug: productSlug, status: 'needs_review',
      started_at: new Date().toISOString(), finished_at: null,
      successful_count: 0, failed_count: 0, skipped_count: 0,
      mark_failed_count: 0, delivery_unknown_count: 0,
    }
  }
  return ((data ?? [])[0] as LaunchRun | undefined) ?? null
}

export interface LaunchSendSummary {
  successful: number
  failed: number
  skippedAlreadyNotified: number
  /** נשלחה בהצלחה אבל הסימון ב-DB נכשל — דורש בדיקה ידנית. */
  markFailed: number
  /** הבקשה יצאה ואיננו יודעים מה עלה בגורלה. */
  deliveryUnknown: number
  /** נותרו open ולא נוסו בכלל (המנה נגמרה). אפשר להריץ שוב. */
  remaining: number
  blocked?: LaunchPreview['blockedReason']
  /** הריצה לא נפתחה כי כבר יש אחת פעילה או עמומה. */
  runBlocked?: 'already_running' | 'needs_review'
  runId?: string
  runStatus?: LaunchRunStatus
}

/**
 * שליחת הודעת ההשקה למנה אחת של נרשמות.
 *
 * ═══ 🔴 סדר הפעולות הוא ההגנה, ולא הפעולות עצמן ═══
 *
 * הגרסה הקודמת שלפה נמענות ואז שלחה, והסתמכה על המעבר האטומי
 * `open → notified` כדי למנוע כפילות. **זה הגן על הסימון ולא על השליחה:**
 * שתי בקשות מקבילות היו קוראות את אותה שורה כ-open, שתיהן שולחות SMS,
 * ורק אז מתחרות על הסימון — כלומר הלקוחה כבר קיבלה שתי הודעות.
 *
 * כאן הנעילה נתפסת **לפני** ששולפים ולו שורה אחת:
 *
 *   1. `begin_product_launch_run` — אטומי, partial unique index (0039).
 *      נכשל ⇒ **יוצאים מיד, בלי לקרוא נמענות ובלי לגעת בספק.**
 *   2. רק עכשיו נשלפות השורות `status='open'`.
 *   3. שליחה סדרתית.
 *   4. `mark_product_interest_notified` — עדיין אטומי, כהגנה בעומק.
 *   5. `finish_product_launch_run` — מחשב completed מול needs_review.
 *
 * ⚠️ מפתח ה-idempotency ל-019 נשאר, אבל הוא **שכבה רביעית ולא ההגנה**:
 * 019 אינו מתחייב על ייחודיות (ראה lib/reminders/types.ts).
 *
 * ═══ מה קורה לשורה בכל תוצאה ═══
 *
 *   accepted          → notified. הריצה יכולה להסתיים completed.
 *   delivery_unknown  → notified (לא נשלח שוב), והריצה → needs_review.
 *   mark נכשל         → השורה נשארת open אף שההודעה יצאה. needs_review.
 *   retryable/permanent → נשארת open, ניתנת לריצה עתידית. completed מותר.
 */
export async function sendLaunchBatch(
  productSlug: string,
  startedBy: string,
): Promise<LaunchSendSummary> {
  const empty: LaunchSendSummary = {
    successful: 0, failed: 0, skippedAlreadyNotified: 0,
    markFailed: 0, deliveryUnknown: 0, remaining: 0,
  }

  const preview = await previewLaunch(productSlug)
  if (!preview) return { ...empty, blocked: 'no_recipients' }
  if (!preview.canSend) return { ...empty, blocked: preview.blockedReason }

  const db = createSupabaseAdminClient()

  /*
   * 🔴 שלב 1 — תפיסת הריצה. **לפני כל דבר אחר.**
   * כישלון כאן הוא יציאה מיידית: לא נשלפות נמענות, ו-`provider.send`
   * אינו נקרא ולו פעם אחת.
   */
  const begun = await db.rpc('begin_product_launch_run', {
    p_product_slug: preview.productSlug,
    p_started_by: startedBy,
  })

  if (begun.error) {
    if (begun.error.message?.includes('LAUNCH_ALREADY_RUNNING')) {
      return { ...empty, runBlocked: 'already_running' }
    }
    if (begun.error.message?.includes('LAUNCH_NEEDS_REVIEW')) {
      return { ...empty, runBlocked: 'needs_review' }
    }
    console.error('[product-interest-admin] begin run failed', begun.error.code ?? 'unknown')
    return { ...empty, blocked: 'no_recipients' }
  }

  const run = begun.data as LaunchRun | null
  if (!run?.id) {
    console.error('[product-interest-admin] begin run returned no id')
    return { ...empty, blocked: 'no_recipients' }
  }

  const summary: LaunchSendSummary = { ...empty, runId: run.id }

  try {
    // שלב 2 — רק עכשיו שולפים נמענות.
    const { data, error } = await db
      .from('product_interest_requests')
      .select('id, phone_e164, status')
      .eq('product_slug', preview.productSlug)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(LAUNCH_BATCH_SIZE)

    if (error) {
      console.error('[product-interest-admin] recipients load failed', error.code ?? 'unknown')
    } else {
      const provider = resolveProductLaunchProvider()
      const rows = (data ?? []) as { id: string; phone_e164: string; status: string }[]

      // ⚠️ סדרתי בכוונה. מנה של 25 אינה מצדיקה 25 בקשות במקביל לספק.
      for (const row of rows) {
        if (row.status !== 'open') {
          summary.skippedAlreadyNotified += 1
          continue
        }

        const result = await provider.send({
          to: row.phone_e164,
          body: preview.body,
          idempotencyKey: launchIdempotencyKey(row.id),
        })

        if (result.outcome === 'retryable_error' || result.outcome === 'permanent_error') {
          /*
           * 🔒 כשל ודאי: ההודעה **לא** יצאה. השורה נשארת open ותשתתף
           * בריצה עתידית. ⚠️ errorCode מנורמל בלבד — לא שגיאה גולמית
           * של הספק, שעלולה לשאת את המספר.
           */
          console.error('[product-interest-admin] send failed', result.errorCode)
          summary.failed += 1
          continue
        }

        if (result.outcome === 'delivery_unknown') {
          // 🔴 עמום. נספר בנפרד — הוא זה שיסגור את הריצה כ-needs_review.
          console.error('[product-interest-admin] delivery unknown', result.errorCode)
          summary.deliveryUnknown += 1
        }

        const marked = await db.rpc('mark_product_interest_notified', { p_request_id: row.id })
        if (marked.error) {
          /*
           * 🔴 המקרה הגרוע: ההודעה יצאה והסימון נכשל. **לא** נספר
           * ככישלון — ספירה ככישלון הייתה מזמינה ניסיון חוזר, כלומר
           * הודעה שנייה. הוא סוגר את הריצה כ-needs_review.
           */
          console.error('[product-interest-admin] mark notified failed', marked.error.code ?? 'unknown')
          summary.markFailed += 1
          continue
        }
        if (!marked.data) {
          // השורה כבר לא הייתה open.
          summary.skippedAlreadyNotified += 1
          continue
        }
        summary.successful += 1
      }
    }

    const { count } = await db
      .from('product_interest_requests')
      .select('id', { count: 'exact', head: true })
      .eq('product_slug', preview.productSlug)
      .eq('status', 'open')
    summary.remaining = count ?? 0
  } finally {
    /*
     * 🔒 שלב 5 — הריצה נסגרת **תמיד**, גם אם משהו זרק באמצע. ריצה
     * שנשארת 'running' חוסמת את המוצר עד בדיקה ידנית, וזה נכון כשהתהליך
     * באמת מת — אבל לא כשסתם נזרקה חריגה שאנחנו כן תופסים כאן.
     *
     * ⚠️ ה-RPC הוא זה שמחליט completed מול needs_review מהמונים. הקוד
     * כאן אינו מבקש סטטוס.
     */
    const finished = await db.rpc('finish_product_launch_run', {
      p_run_id: run.id,
      p_successful_count: summary.successful,
      p_failed_count: summary.failed,
      p_skipped_count: summary.skippedAlreadyNotified,
      p_mark_failed_count: summary.markFailed,
      p_delivery_unknown_count: summary.deliveryUnknown,
    })
    if (finished.error) {
      console.error('[product-interest-admin] finish run failed', finished.error.code ?? 'unknown')
    } else {
      summary.runStatus = (finished.data as LaunchRun | null)?.status
    }
  }

  return summary
}
