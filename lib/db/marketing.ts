import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/phone'
import { evaluateMarketingBody, renderMarketingSms } from '@/lib/marketing/message'
import {
  deriveOptOutToken, optOutTokenHash, phoneHash, hashesEqual,
  CURRENT_OPT_OUT_TOKEN_VERSION,
} from '@/lib/marketing/tokens'
import { decideRecipient } from '@/lib/marketing/decide'
import {
  buildBookingConsentUpdate, marketingConsentStatus, type MarketingConsentStatus,
} from '@/lib/marketing/consent'

/**
 * דיוור SMS ללקוחות — שכבת הנתונים.
 *
 * ═══ מה מפריד את המסלול הזה מה-SMS התפעולי ═══════════════════════════════
 *
 * הקובץ הזה אינו נוגע ב-appointment_reminders, ב-appointment_notifications
 * ובאף פונקציית תזכורת. הוא כותב לשתי טבלאות שנוצרו ב-0035 בלבד, וקורא
 * מ-customers. הסרה מדיוור חיה כאן ואינה נראית לשום מסלול תפעולי — תזכורת,
 * ביטול, שינוי מועד ו-OTP ממשיכים לצאת ללקוחה שהסירה את עצמה.
 *
 * ⚠️ הספק הוא זה שכבר עובד (019). אין כאן לקוח HTTP חדש.
 */

/** כמה נמענות בכל קריאה. מכוון: שליחה סדרתית, בלי מאות בקשות במקביל. */
export const CAMPAIGN_BATCH_SIZE = 25

export interface MarketingCandidate {
  id: string
  full_name: string
  phone_e164: string
  /** 🔴 חסימה קשה כבר ב-PHASE 1 */
  opted_out: boolean
  /** נשמר להצגה ולהכנה ל-PHASE 2. אינו חוסם. */
  has_consent: boolean
}

/**
 * כל הלקוחות שאפשר להציג לבחירה.
 *
 * ⚠️ אותה הגדרת אוכלוסייה של רשימת ה-CRM: בלי חשבונות המנהלות, בלי ארכיון.
 * 🔓 PHASE 1: `marketing_consent = false` **אינו** מסנן. המנהלת בוחרת ידנית.
 * 🔴 לקוחה שהסירה את עצמה מוחזרת עם opted_out=true כדי שהמסך יראה אותה
 *    ויסמן אותה חסומה — הסתרה הייתה נראית כמו לקוחה שנעלמה.
 */
export async function listMarketingCandidates(): Promise<MarketingCandidate[]> {
  const db = createSupabaseAdminClient()

  const { data: adminRows } = await db.from('admins').select('user_id')
  const adminIds = new Set((adminRows ?? []).map(a => a.user_id as string))

  const { data, error } = await db
    .from('customers')
    .select('id, full_name, phone_e164, auth_user_id, marketing_consent, marketing_opted_out_at, is_blocked')
    .is('archived_at', null)
    .eq('is_blocked', false)
    .order('full_name')

  if (error) {
    console.error('[marketing] candidates load failed', error.message)
    return []
  }

  return (data ?? [])
    .filter(c => !(c.auth_user_id && adminIds.has(c.auth_user_id as string)))
    .map(c => ({
      id: c.id as string,
      full_name: c.full_name as string,
      phone_e164: c.phone_e164 as string,
      opted_out: c.marketing_opted_out_at !== null,
      has_consent: c.marketing_consent === true,
    }))
}

export type CampaignStatus = 'draft' | 'sending' | 'completed' | 'failed'
export type SkipReason =
  | 'no_consent' | 'opted_out' | 'archived' | 'blocked'
  | 'duplicate_phone' | 'invalid_phone' | 'phone_changed'

export interface CampaignRow {
  id: string
  created_at: string
  body: string
  segments: number
  provider: string
  status: CampaignStatus
  recipient_count: number
  sent_count: number
  failed_count: number
  skipped_count: number
}

export type CreateCampaignError =
  | 'invalid_body' | 'no_recipients' | 'missing_secret' | 'db_error'

export interface CreateCampaignResult {
  campaign: CampaignRow
  /** true = אותה בקשה בדיוק כבר נוצרה. לא נוצר קמפיין שני. */
  replayed: boolean
  /** נמענות שנשמטו עוד לפני הכתיבה — אותו מספר הופיע פעמיים בבחירה */
  duplicatesDropped: number
}

/**
 * יצירת קמפיין + רשימת הנמענות, בפעולה אחת ואידמפוטנטית.
 *
 * ─── סדר הפעולות, ולמה ─────────────────────────────────────────────────────
 *
 * ה-INSERT של הקמפיין הוא **הראשון**, והוא נושא את client_request_id עם
 * unique. לחיצה שנייה על "שליחה" — או retry של הדפדפן — נופלת על ה-unique,
 * ואז מוחזר הקמפיין הקיים במקום להיווצר שני. `disabled` על הכפתור אינו
 * הגנה: תשובה יכולה ללכת לאיבוד אחרי שה-DB כבר כתב.
 *
 * ⚠️ הנמענות נכתבות עם `on conflict do nothing` על (campaign_id, phone_hash).
 * גם אם הקריאה תרוץ פעמיים על אותו קמפיין, לא תיווצר שורה כפולה ולא יישלח
 * מסר שני לאותו מספר.
 */
export async function createCampaign(input: {
  adminId: string
  body: string
  clientRequestId: string
  customerIds: string[]
}): Promise<{ ok: true; data: CreateCampaignResult } | { ok: false; error: CreateCampaignError }> {
  const db = createSupabaseAdminClient()

  // 🔒 האימות על ה-**הודעה הסופית**, לא על הגוף. אותה פונקציה שהמסך מריץ.
  const stats = evaluateMarketingBody(input.body)
  if (stats.error) return { ok: false, error: 'invalid_body' }
  if (input.customerIds.length === 0) return { ok: false, error: 'no_recipients' }

  const inserted = await db
    .from('sms_campaigns')
    .insert({
      created_by: input.adminId,
      client_request_id: input.clientRequestId,
      body: input.body.trim(),
      segments: stats.segments,
      provider: 'sms_019',
      status: 'draft',
    })
    .select('id, created_at, body, segments, provider, status, recipient_count, sent_count, failed_count, skipped_count')
    .maybeSingle()

  let campaign = inserted.data as CampaignRow | null
  let replayed = false

  if (inserted.error) {
    // 23505 = unique_violation על client_request_id → זו אותה בקשה בדיוק.
    if (!inserted.error.message.includes('sms_campaigns_request_unique') &&
        inserted.error.code !== '23505') {
      console.error('[marketing] campaign insert failed', inserted.error.message)
      return { ok: false, error: 'db_error' }
    }
    const existing = await db
      .from('sms_campaigns')
      .select('id, created_at, body, segments, provider, status, recipient_count, sent_count, failed_count, skipped_count')
      .eq('client_request_id', input.clientRequestId)
      .maybeSingle()
    if (!existing.data) return { ok: false, error: 'db_error' }
    campaign = existing.data as CampaignRow
    replayed = true
  }

  if (!campaign) return { ok: false, error: 'db_error' }
  // retry על קמפיין שכבר נבנה: הרשימה קיימת, אין מה לבנות שוב.
  if (replayed) return { ok: true, data: { campaign, replayed, duplicatesDropped: 0 } }

  // ── בניית רשימת הנמענות ────────────────────────────────────────────────
  const candidates = await listMarketingCandidates()
  const byId = new Map(candidates.map(c => [c.id, c]))
  // dedup לפי מזהה עוד לפני הכל — בחירה כפולה של אותה לקוחה אינה שתי נמענות
  const wanted = [...new Set(input.customerIds)]

  const rows: {
    campaign_id: string; customer_id: string; phone_hash: string
    status: 'pending' | 'skipped'; skip_reason: SkipReason | null
  }[] = []
  const seenHashes = new Set<string>()
  let duplicatesDropped = 0

  for (const id of wanted) {
    const c = byId.get(id)
    // לא ברשימת המועמדות = בארכיון / חסומה / חשבון מנהלת. אין שורה ואין שליחה.
    if (!c) continue

    const e164 = normalizePhone(c.phone_e164)
    if (!e164) {
      rows.push({ campaign_id: campaign.id, customer_id: id, phone_hash: invalidHashFor(id),
                  status: 'skipped', skip_reason: 'invalid_phone' })
      continue
    }

    const h = phoneHash(e164)
    if (!h.ok) return { ok: false, error: 'missing_secret' }

    if (seenHashes.has(h.hash)) {
      /*
       * ⚠️ אותו מספר כבר ברשימה. שורה שנייה אינה אפשרית בכלל — ה-unique
       * על (campaign_id, phone_hash) יחסום אותה — והשורה הראשונה כבר
       * מייצגת את המספר הזה. נספר כדילוג ולא נכתב.
       */
      duplicatesDropped++
      continue
    }
    seenHashes.add(h.hash)

    // 🔴 החסימה הקשה היחידה של PHASE 1.
    if (c.opted_out) {
      rows.push({ campaign_id: campaign.id, customer_id: id, phone_hash: h.hash,
                  status: 'skipped', skip_reason: 'opted_out' })
      continue
    }

    rows.push({ campaign_id: campaign.id, customer_id: id, phone_hash: h.hash,
                status: 'pending', skip_reason: null })
  }

  if (rows.length > 0) {
    const { error } = await db.from('sms_campaign_recipients').upsert(rows, {
      onConflict: 'campaign_id,phone_hash', ignoreDuplicates: true,
    })
    if (error) {
      console.error('[marketing] recipients insert failed', error.message)
      return { ok: false, error: 'db_error' }
    }
  }

  const skipped = rows.filter(r => r.status === 'skipped').length + duplicatesDropped
  const updated = await db
    .from('sms_campaigns')
    .update({ recipient_count: rows.length + duplicatesDropped, skipped_count: skipped })
    .eq('id', campaign.id)
    .select('id, created_at, body, segments, provider, status, recipient_count, sent_count, failed_count, skipped_count')
    .maybeSingle()

  return {
    ok: true,
    data: {
      campaign: (updated.data as CampaignRow) ?? campaign,
      replayed: false,
      duplicatesDropped,
    },
  }
}

/**
 * ⚠️ מספר לא תקין אין לו חותם טלפון אמיתי, אבל phone_hash הוא NOT NULL
 * ו-unique בתוך הקמפיין. חותם דטרמיניסטי מהמזהה שומר על שני הכללים,
 * ואינו יכול להתנגש עם חותם של מספר אמיתי (קידומת שונה לחלוטין).
 */
function invalidHashFor(customerId: string): string {
  const h = optOutTokenHash(`invalid-phone:${customerId}`)
  return h
}

export interface SendBatchResult {
  processed: number
  sent: number
  failed: number
  skipped: number
  remaining: number
  status: CampaignStatus
}

/**
 * עיבוד אצווה אחת של קמפיין.
 *
 * ═══ איך retry אינו הופך לשליחה כפולה ═══════════════════════════════════
 *
 * לפני כל שליחה השורה **נתפסת**: UPDATE מותנה שמסמן attempted_at רק אם
 * `status='pending' and attempted_at is null`. רק מי שה-UPDATE החזיר לו
 * שורה שולח בפועל. שתי קריאות מקבילות לא יכולות לתפוס את אותה שורה.
 *
 * ⚠️ קריסה **אחרי** התפיסה ולפני סימון התוצאה משאירה שורה pending עם
 * attempted_at. הריצה הבאה **אינה שולחת לה שוב** — היא מסמנת אותה failed
 * עם 'interrupted'. הכיוון הזה מכוון: הודעה שאולי יצאה לא תצא פעמיים,
 * והמנהלת רואה בדיוק כמה כאלה היו.
 */
export async function sendCampaignBatch(
  campaignId: string,
  deps?: { send?: (to: string, body: string, externalId: string) => Promise<{ ok: boolean; id?: string; code?: string }> },
): Promise<{ ok: true; data: SendBatchResult } | { ok: false; error: string }> {
  const db = createSupabaseAdminClient()

  const campaign = await db.from('sms_campaigns')
    .select('id, body, status').eq('id', campaignId).maybeSingle()
  if (!campaign.data) return { ok: false, error: 'not_found' }
  if (campaign.data.status === 'completed') {
    return { ok: true, data: { processed: 0, sent: 0, failed: 0, skipped: 0, remaining: 0, status: 'completed' } }
  }
  await db.from('sms_campaigns')
    .update({ status: 'sending', started_at: new Date().toISOString() })
    .eq('id', campaignId).is('started_at', null)

  const send = deps?.send ?? (await defaultSender())

  // ── שורות שנתפסו בריצה שקרסה: לא שולחים שוב ──────────────────────────
  const interrupted = await db.from('sms_campaign_recipients')
    .update({ status: 'failed', error_code: 'interrupted' })
    .eq('campaign_id', campaignId).eq('status', 'pending').not('attempted_at', 'is', null)
    .select('id')
  const interruptedCount = (interrupted.data ?? []).length

  const pending = await db.from('sms_campaign_recipients')
    .select('id, customer_id, phone_hash')
    .eq('campaign_id', campaignId).eq('status', 'pending').is('attempted_at', null)
    .order('created_at').limit(CAMPAIGN_BATCH_SIZE)

  let sent = 0, failed = interruptedCount, skipped = 0, processed = 0

  for (const r of (pending.data ?? [])) {
    // 🔒 תפיסה. רק מי שקיבל שורה בחזרה שולח.
    const claim = await db.from('sms_campaign_recipients')
      .update({ attempted_at: new Date().toISOString() })
      .eq('id', r.id).eq('status', 'pending').is('attempted_at', null)
      .select('id')
    if ((claim.data ?? []).length === 0) continue
    processed++

    const outcome = await sendToRecipient(db, campaign.data.body as string, r as RecipientRow, send)
    if (outcome === 'sent') sent++
    else if (outcome === 'skipped') skipped++
    else failed++
  }

  const remainingRes = await db.from('sms_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId).eq('status', 'pending')
  const remaining = remainingRes.count ?? 0

  const status: CampaignStatus = remaining === 0 ? 'completed' : 'sending'
  await recountCampaign(db, campaignId, status)

  return { ok: true, data: { processed, sent, failed, skipped, remaining, status } }
}

interface RecipientRow { id: string; customer_id: string | null; phone_hash: string }

type SendFn = (to: string, body: string, externalId: string) => Promise<{ ok: boolean; id?: string; code?: string }>

/**
 * שליחה לנמענת אחת, אחרי שהשורה כבר נתפסה.
 *
 * ⚠️ שלוש בדיקות **חוזרות** רגע לפני היציאה, ולא הסתמכות על מה שנבדק
 * בבניית הרשימה: המספר, ההסרה, והחותם. בין היצירה לשליחה הכול יכול
 * להשתנות, וקמפיין שאושר על רשימה מסוימת לא יזלוג ממנה.
 */
async function sendToRecipient(
  db: ReturnType<typeof createSupabaseAdminClient>,
  body: string,
  r: RecipientRow,
  send: SendFn,
): Promise<'sent' | 'failed' | 'skipped'> {
  const skip = async (reason: SkipReason) => {
    await db.from('sms_campaign_recipients')
      .update({ status: 'skipped', skip_reason: reason }).eq('id', r.id)
    return 'skipped' as const
  }
  const fail = async (code: string) => {
    await db.from('sms_campaign_recipients')
      .update({ status: 'failed', error_code: code }).eq('id', r.id)
    return 'failed' as const
  }

  if (!r.customer_id) return skip('invalid_phone')

  const c = await db.from('customers')
    .select('id, phone_e164, marketing_opted_out_at, archived_at, is_blocked, marketing_opt_out_token_version')
    .eq('id', r.customer_id).maybeSingle()
  if (!c.data) return skip('invalid_phone')

  /*
   * 🔒 כל הבדיקות **חוזרות** רגע לפני היציאה, דרך פונקציה טהורה אחת.
   * ראה lib/marketing/decide.ts — שם הן נבדקות על כל צירוף אפשרי.
   */
  const e164 = normalizePhone(c.data.phone_e164 as string)
  let current: string | null = null
  if (e164) {
    const h = phoneHash(e164)
    if (!h.ok) return fail('missing_secret')
    // ⚠️ השוואה בזמן קבוע, ואז הערך עצמו לפונקציית ההחלטה.
    current = hashesEqual(h.hash, r.phone_hash) ? r.phone_hash : h.hash
  }

  const decision = decideRecipient({
    optedOutAt: (c.data.marketing_opted_out_at as string | null) ?? null,
    archivedAt: (c.data.archived_at as string | null) ?? null,
    isBlocked: c.data.is_blocked === true,
    normalizedPhone: e164,
    currentPhoneHash: current,
    storedPhoneHash: r.phone_hash,
  })
  if (!decision.send) return skip(decision.skipReason)

  // ── ה-token: גרסה קיימת נשמרת, חדשה נכתבת פעם אחת ──────────────────────
  const version = (c.data.marketing_opt_out_token_version as number | null) ?? CURRENT_OPT_OUT_TOKEN_VERSION
  const t = deriveOptOutToken(r.customer_id, version)
  if (!t.ok) return fail('missing_secret')

  if (c.data.marketing_opt_out_token_version === null) {
    /*
     * ⚠️ נכתב פעם אחת ולעולם לא נדרס. זה מה שמשאיר קישורי הסרה ישנים
     * בתוקף גם אחרי שהסוד יסובב ל-V2: לקוחה עם גרסה 1 תמשיך לקבל
     * token של גרסה 1.
     */
    await db.from('customers').update({
      marketing_opt_out_token_hash: optOutTokenHash(t.token),
      marketing_opt_out_token_version: version,
    }).eq('id', r.customer_id).is('marketing_opt_out_token_version', null)
  }

  // decision.send === true ⟹ e164 אינו null (ראה decideRecipient)
  const finalBody = renderMarketingSms(body, t.token)
  const res = await send(e164!, finalBody, r.id)

  if (!res.ok) return fail(res.code ?? 'send_failed')

  await db.from('sms_campaign_recipients')
    .update({ status: 'sent', provider_message_id: res.id ?? null }).eq('id', r.id)
  return 'sent'
}

/** מונים מחושבים מחדש מהשורות — אידמפוטנטי, ולא תלוי בסדר העדכונים */
async function recountCampaign(
  db: ReturnType<typeof createSupabaseAdminClient>,
  campaignId: string,
  status: CampaignStatus,
) {
  const counts: Record<string, number> = { sent: 0, failed: 0, skipped: 0, pending: 0 }
  const { data } = await db.from('sms_campaign_recipients')
    .select('status').eq('campaign_id', campaignId)
  for (const r of data ?? []) counts[r.status as string] = (counts[r.status as string] ?? 0) + 1

  await db.from('sms_campaigns').update({
    sent_count: counts.sent, failed_count: counts.failed, skipped_count: counts.skipped,
    status,
    ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
  }).eq('id', campaignId)
}

/**
 * הספק — 019, דרך אותו מימוש שהתזכורות וההתראות משתמשות בו.
 *
 * ⚠️ אין כאן לקוח HTTP חדש ואין מיפוי שגיאות שני. הדגל
 * MARKETING_SMS_PROVIDER נפרד מ-REMINDER_PROVIDER ומ-NOTIFICATION_PROVIDER,
 * וברירת המחדל שלו disabled — ראה lib/marketing/provider.ts.
 *
 * ⚠️ externalId הוא מזהה **שורת הנמענת**, ולכן יציב בכל retry של אותה
 * נמענת ולעולם אינו הטלפון או תוכן ההודעה.
 */
async function defaultSender(): Promise<SendFn> {
  const { resolveMarketingProvider } = await import('@/lib/marketing/provider')
  const provider = resolveMarketingProvider()
  return async (to, body, externalId) => {
    const res = await provider.send({ to, body, idempotencyKey: externalId })
    if (res.outcome === 'accepted') return { ok: true, id: res.providerMessageId }
    /*
     * ⚠️ delivery_unknown נספר ככישלון **במכוון**, ובכיוון הזה בלבד:
     * ההודעה אולי יצאה, ולכן אסור לשלוח שוב. סימונה failed משאיר אותה
     * מחוץ לכל ריצה עתידית ומציג למנהלת מספר אמיתי של "לא ידוע".
     */
    return { ok: false, code: res.outcome === 'delivery_unknown' ? 'delivery_unknown' : (res.errorCode ?? 'send_failed') }
  }
}

export async function listCampaigns(limit = 20): Promise<CampaignRow[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.from('sms_campaigns')
    .select('id, created_at, body, segments, provider, status, recipient_count, sent_count, failed_count, skipped_count')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) {
    console.error('[marketing] campaign list failed', error.message)
    return []
  }
  return (data ?? []) as CampaignRow[]
}

export type OptOutResult = 'opted_out' | 'already_opted_out' | 'not_found'

/**
 * ההסרה עצמה — אידמפוטנטית לחלוטין.
 *
 * ⚠️ לחיצה שנייה על אותו קישור אינה שגיאה ואינה משנה את זמן ההסרה. היא
 * מחזירה 'already_opted_out', והעמוד מציג את אותה הודעת הצלחה: מבחינת
 * הלקוחה המצב זהה, והיא מוסרת.
 *
 * ⚠️ נוגעת **רק** ב-marketing_opted_out_at. תזכורות, ביטולים ו-OTP אינם
 * קוראים את השדה הזה ואינם מושפעים.
 */
export async function applyOptOut(token: string): Promise<OptOutResult> {
  const db = createSupabaseAdminClient()
  const hash = optOutTokenHash(token)

  const found = await db.from('customers')
    .select('id, marketing_opted_out_at')
    .eq('marketing_opt_out_token_hash', hash).maybeSingle()

  if (!found.data) return 'not_found'
  if (found.data.marketing_opted_out_at !== null) return 'already_opted_out'

  const now = new Date().toISOString()
  await db.from('customers')
    .update({ marketing_opted_out_at: now })
    .eq('id', found.data.id).is('marketing_opted_out_at', null)

  /*
   * ⚠️ **אין כאן שורת customer_crm_activity, ובכוונה.**
   *
   * `actor_admin_id` שם הוא NOT NULL (0009), והטבלה היא יומן של פעולות
   * **מנהלת** — "מי עשה מה". להסרה שהלקוחה ביצעה בעצמה אין actor, וכתיבת
   * מזהה מנהלת שרירותית הייתה משקרת ביומן. ניסיון לכתוב בלי actor נכשל
   * ב-23502 והיה מפיל את ההסרה הראשונה שלקוחה כלשהי מבצעת.
   *
   * הרישום הסמכותי הוא `customers.marketing_opted_out_at` עצמו: הוא נושא
   * את העובדה ואת המועד, והוא מה שחוסם דיוור עתידי. ערך הפעולה
   * 'marketing_opted_out' שנוסף ב-0035 שמור למקרה שבו **מנהלת** מתעדת
   * הסרה שהתבקשה בטלפון — שם יש actor אמיתי.
   */
  return 'opted_out'
}

/**
 * רישום הסכמת דיוור שניתנה בטופס ההזמנה.
 *
 * ═══ מה הפונקציה הזו עושה, ומה היא לעולם לא ═══════════════════════════════
 *
 * ✅ נקראת **רק** כשהלקוחה סימנה בעצמה את התיבה האופציונלית. לא סומנה ⟹
 *    ה-route כלל אינו קורא לכאן, ושום עמודת consent אינה נכתבת — הסכמה
 *    קיימת (או היעדרה) נשארת בדיוק כפי שהייתה.
 * ✅ סימון אחרי הסרה מדיוור הוא re-consent מפורש: `marketing_opted_out_at`
 *    מתנקה. ראה lib/marketing/consent.ts.
 *
 * ❌ אינה נוגעת בתזכורות, בהודעות שירות וב-OTP, ואינה שולחת דבר.
 * ❌ אינה כותבת customer_crm_activity. `actor_admin_id` שם הוא NOT NULL
 *    והטבלה היא יומן פעולות **מנהלת** — להסכמה שהלקוחה נתנה בעצמה אין
 *    actor, בדיוק כמו בהסרה העצמית ב-applyOptOut. הרישום הסמכותי הוא
 *    שלוש העמודות על customers עצמן (מתי, מאיזה מקור, ובלי actor).
 *
 * ⚠️ best-effort: כישלון נרשם ללוג ואינו מפיל את בקשת התור. התור נוצר
 * כבר, ובקשת התור אינה תלויה בהסכמת דיוור לשום דבר.
 */
export async function recordBookingMarketingConsent(customerId: string): Promise<void> {
  const db = createSupabaseAdminClient()
  const { error } = await db
    .from('customers')
    .update(buildBookingConsentUpdate(new Date()))
    .eq('id', customerId)

  if (error) {
    // ⚠️ בלי טלפון ובלי שם — לוג אינו מקום לנתוני לקוחות.
    console.error('[marketing] booking consent write failed', error.message)
  }
}

/**
 * אותו רישום, כשמזהה הלקוחה אינו בידינו — המסלול הציבורי מזהה לפי טלפון
 * מנורמל בלבד (אין שם session).
 *
 * ⚠️ הטלפון כבר נורמל ב-route, ומכאן הוא מפתח מדויק: `phone_e164` הוא
 * unique ב-customers, ולכן אין כאן ניחוש של "הלקוחה הנכונה".
 */
export async function recordBookingMarketingConsentByPhone(phoneE164: string): Promise<void> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('customers')
    .select('id')
    .eq('phone_e164', phoneE164)
    .maybeSingle()

  if (error) {
    console.error('[marketing] booking consent lookup failed', error.message)
    return
  }
  if (!data) return
  await recordBookingMarketingConsent(data.id as string)
}

export interface CustomerMarketingStatus {
  status: MarketingConsentStatus
  consentAt: string | null
  consentSource: string | null
  optedOutAt: string | null
}

/**
 * סטטוס הדיוור של לקוחה בודדת, לתצוגה ב-CRM.
 *
 * ⚠️ נקראת בנפרד מ-get_crm_customer ולא דרכה: ה-RPC הזו בונה JSON קבוע
 * ב-DB, והרחבתה הייתה מיגרציה על פונקציה שכל מסך הלקוחה תלוי בה — כדי
 * להציג שלוש עמודות שקריאה ישירה מחזירה באותה מידה.
 */
export async function getCustomerMarketingStatus(
  customerId: string,
): Promise<CustomerMarketingStatus | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('customers')
    .select('marketing_consent, marketing_consent_at, marketing_consent_source, marketing_opted_out_at')
    .eq('id', customerId)
    .maybeSingle()

  if (error) {
    console.error('[marketing] status load failed', error.message)
    return null
  }
  if (!data) return null

  const optedOutAt = (data.marketing_opted_out_at as string | null) ?? null
  return {
    status: marketingConsentStatus({
      consent: data.marketing_consent === true,
      optedOutAt,
    }),
    consentAt: (data.marketing_consent_at as string | null) ?? null,
    consentSource: (data.marketing_consent_source as string | null) ?? null,
    optedOutAt,
  }
}
