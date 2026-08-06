import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

/**
 * גישת ה-DB לתזכורות. כל הפונקציות כאן עוברות דרך ה-RPCs של 0011, שכולם
 * service_role בלבד — ההחלטות עצמן יושבות ב-SQL, קרוב לנתונים ובתוך
 * טרנזקציה, ולא כאן. מה שכאן הוא תרגום שגיאות בלבד.
 */

export type ReminderKind = 'day_before' | 'two_hours_before' | 'manual'

export type ReminderStatus =
  | 'scheduled' | 'retrying' | 'processing'
  | 'sent' | 'simulated'
  | 'failed' | 'delivery_unknown'
  | 'cancelled' | 'superseded' | 'skipped'

export type ReminderAttemptOutcome =
  | 'accepted' | 'simulated'
  | 'retryable_error' | 'permanent_error' | 'delivery_unknown'
  | 'aborted_precondition' | 'lease_expired'

export interface ReminderRow {
  id: string
  appointment_id: string
  reminder_kind: ReminderKind
  appointment_starts_at: string
  scheduled_for: string
  expires_at: string
  template_version: string
  status: ReminderStatus
  attempt_count: number
  next_attempt_at: string | null
  processing_started_at: string | null
  lease_token: string | null
  lease_expires_at: string | null
  cancel_requested_at: string | null
  provider: string
  provider_message_id: string | null
  last_error_code: string | null
  outcome_reason: string | null
  sent_at: string | null
  cancelled_at: string | null
  created_by_admin_id: string | null
  created_at: string
  updated_at: string
}

export interface ReminderAttemptRow {
  id: number
  reminder_id: string
  attempt_number: number
  provider: string
  worker_id: string | null
  started_at: string
  finished_at: string | null
  outcome: ReminderAttemptOutcome | null
  error_code: string | null
  provider_message_id: string | null
  created_at: string
}

/** ה-lease של worker בודד. קצר מספיק כדי ש-worker מת ישוחרר מהר. */
export const REMINDER_LEASE_SECONDS = 120

/**
 * ⚠️ המכסה נבדקת מול attempt_count, ולכן retry ידני של מנהלת (שאינו מאפס
 * את המונה) אינו יכול להפוך תזכורת בעייתית ללולאה אינסופית — הוא נותן לה
 * ניסיון אחד נוסף בכל פעם, במפורש.
 */
export const REMINDER_MAX_ATTEMPTS = 4

// ─── sweep ──────────────────────────────────────────────────────────────────

/**
 * מסמן חלונות שנסגרו. רץ בתחילת כל dispatch, ו-**בלי קשר לספק או לדגל**:
 * תזכורת שחלונה נסגר לא תישלח לעולם, ואין טעם להשאיר אותה scheduled.
 */
export async function sweepExpiredReminders(): Promise<{ expired: number; cancelled: number }> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('sweep_expired_reminders')
  if (error) {
    console.error('[reminders] sweep failed', error.message)
    return { expired: 0, cancelled: 0 }
  }
  const row = data as { expired?: number; cancelled?: number } | null
  return { expired: row?.expired ?? 0, cancelled: row?.cancelled ?? 0 }
}

// ─── claim ──────────────────────────────────────────────────────────────────

export interface ClaimedReminder {
  reminder: ReminderRow
  appointmentStatus: string
  appointmentStartsAt: string
  appointmentDurationMin: number
}

/**
 * תופס תזכורת אחת שהגיע זמנה, או משחרר-ותופס אחת שה-worker שלה נקטע.
 *
 * ⚠️ **אין לקרוא לפונקציה הזו כשהמערכת כבויה או כשהספק disabled.** התפיסה
 * מגדילה attempt_count, פותחת רשומת ניסיון ומשנה סטטוס — כלומר "משתמשת"
 * בתזכורת. המקום שאוכף את זה הוא lib/reminders/dispatch.ts.
 */
export async function claimDueReminder(
  leaseToken: string,
  provider: string,
  maxAttempts: number = REMINDER_MAX_ATTEMPTS,
): Promise<ClaimedReminder | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('claim_due_reminder', {
    p_lease_token: leaseToken,
    p_lease_seconds: REMINDER_LEASE_SECONDS,
    p_max_attempts: maxAttempts,
    p_provider: provider,
  })
  if (error) {
    console.error('[reminders] claim failed', error.message)
    return null
  }
  const row = data as {
    claimed: boolean
    reminder?: ReminderRow
    appointment_status?: string
    appointment_starts_at?: string
    appointment_duration_min?: number
  } | null
  if (!row?.claimed || !row.reminder) return null
  return {
    reminder: row.reminder,
    appointmentStatus: row.appointment_status ?? '',
    appointmentStartsAt: row.appointment_starts_at ?? '',
    appointmentDurationMin: row.appointment_duration_min ?? 0,
  }
}

// ─── אימות מחדש לפני השליחה ────────────────────────────────────────────────

export type PrecheckReason =
  | 'reminder_not_found' | 'lease_lost' | 'cancel_requested'
  | 'expired_before_send' | 'appointment_missing'
  | 'appointment_not_confirmed' | 'starts_at_changed' | 'appointment_started'

export async function reminderPrecheck(
  reminderId: string,
  leaseToken: string,
): Promise<{ ok: true } | { ok: false; reason: PrecheckReason }> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('reminder_precheck', {
    p_reminder_id: reminderId,
    p_lease_token: leaseToken,
  })
  if (error) {
    console.error('[reminders] precheck failed', error.message)
    // כשל טכני אינו רשות לשלוח.
    return { ok: false, reason: 'lease_lost' }
  }
  const row = data as { ok: boolean; reason?: PrecheckReason } | null
  if (row?.ok) return { ok: true }
  return { ok: false, reason: row?.reason ?? 'lease_lost' }
}

// ─── סגירת ניסיון ───────────────────────────────────────────────────────────

export async function finishReminderAttempt(params: {
  reminderId: string
  leaseToken: string
  outcome: 'accepted' | 'retryable_error' | 'permanent_error' | 'delivery_unknown'
  errorCode: string | null
  providerMessageId: string | null
  provider: string
  appointmentChanged: boolean
  maxAttempts?: number
}): Promise<ReminderRow | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('finish_reminder_attempt', {
    p_reminder_id: params.reminderId,
    p_lease_token: params.leaseToken,
    p_outcome: params.outcome,
    p_error_code: params.errorCode,
    p_provider_message_id: params.providerMessageId,
    p_provider: params.provider,
    p_max_attempts: params.maxAttempts ?? REMINDER_MAX_ATTEMPTS,
    p_appointment_changed: params.appointmentChanged,
  })
  if (error) {
    console.error('[reminders] finish attempt failed', error.message)
    return null
  }
  return data as ReminderRow
}

export async function abortReminderAttempt(
  reminderId: string,
  leaseToken: string,
  reason: PrecheckReason,
): Promise<ReminderRow | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('abort_reminder_attempt', {
    p_reminder_id: reminderId,
    p_lease_token: leaseToken,
    p_reason: reason,
  })
  if (error) {
    console.error('[reminders] abort attempt failed', error.message)
    return null
  }
  return data as ReminderRow
}

// ─── פעולות מנהלה ───────────────────────────────────────────────────────────

export type ManualReminderError =
  | 'not_admin' | 'missing_request_id' | 'bad_fingerprint'
  | 'idempotency_key_reused' | 'appointment_not_found'
  | 'not_confirmed' | 'appointment_in_past' | 'db_error'

export async function createManualReminder(params: {
  appointmentId: string
  adminId: string
  clientRequestId: string
  payloadFingerprint: string
  templateVersion: string
}): Promise<
  | { ok: true; reminderId: string; replayed: boolean }
  | { ok: false; error: ManualReminderError }
> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('create_manual_reminder', {
    p_appointment_id: params.appointmentId,
    p_admin_id: params.adminId,
    p_client_request_id: params.clientRequestId,
    p_payload_fingerprint: params.payloadFingerprint,
    p_template_version: params.templateVersion,
  })
  if (error) {
    const m = error.message ?? ''
    if (m.includes('NOT_ADMIN')) return { ok: false, error: 'not_admin' }
    if (m.includes('MISSING_REQUEST_ID')) return { ok: false, error: 'missing_request_id' }
    if (m.includes('BAD_FINGERPRINT') || m.includes('BAD_TEMPLATE_VERSION')) {
      return { ok: false, error: 'bad_fingerprint' }
    }
    if (m.includes('IDEMPOTENCY_KEY_REUSED')) return { ok: false, error: 'idempotency_key_reused' }
    if (m.includes('APPOINTMENT_NOT_FOUND')) return { ok: false, error: 'appointment_not_found' }
    if (m.includes('NOT_CONFIRMED')) return { ok: false, error: 'not_confirmed' }
    if (m.includes('APPOINTMENT_IN_PAST')) return { ok: false, error: 'appointment_in_past' }
    console.error('[reminders] create manual failed', m)
    return { ok: false, error: 'db_error' }
  }
  const row = data as { reminder_id: string; replayed: boolean }
  return { ok: true, reminderId: row.reminder_id, replayed: row.replayed }
}

export type RetryReminderError =
  | 'not_admin' | 'reminder_not_found' | 'duplicate_risk_not_confirmed'
  | 'lease_active' | 'appointment_not_confirmed' | 'snapshot_stale'
  | 'window_closed' | 'db_error'

export async function retryReminder(params: {
  reminderId: string
  adminId: string
  confirmDuplicateRisk: boolean
}): Promise<
  | { ok: true; result: 'requeued' | 'not_retryable'; status: ReminderStatus }
  | { ok: false; error: RetryReminderError }
> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('retry_reminder', {
    p_reminder_id: params.reminderId,
    p_admin_id: params.adminId,
    p_confirm_duplicate_risk: params.confirmDuplicateRisk,
  })
  if (error) {
    const m = error.message ?? ''
    if (m.includes('NOT_ADMIN')) return { ok: false, error: 'not_admin' }
    if (m.includes('REMINDER_NOT_FOUND')) return { ok: false, error: 'reminder_not_found' }
    if (m.includes('DUPLICATE_RISK_NOT_CONFIRMED')) {
      return { ok: false, error: 'duplicate_risk_not_confirmed' }
    }
    if (m.includes('LEASE_ACTIVE')) return { ok: false, error: 'lease_active' }
    if (m.includes('APPOINTMENT_NOT_CONFIRMED')) {
      return { ok: false, error: 'appointment_not_confirmed' }
    }
    if (m.includes('SNAPSHOT_STALE')) return { ok: false, error: 'snapshot_stale' }
    if (m.includes('WINDOW_CLOSED')) return { ok: false, error: 'window_closed' }
    console.error('[reminders] retry failed', m)
    return { ok: false, error: 'db_error' }
  }
  const row = data as { result: 'requeued' | 'not_retryable'; status: ReminderStatus }
  return { ok: true, result: row.result, status: row.status }
}

// ─── קריאה למסכי הניהול ─────────────────────────────────────────────────────

export interface ReminderWithContext extends ReminderRow {
  customer_full_name: string
  appointment_status: string
  service_key: string
  variants: string[]
}

/**
 * ⚠️ טלפון אינו נשלף כאן. מסך הניהול מציג שם ומועד; המספר נטען אך ורק
 * ברגע השליחה בפועל (ראה loadReminderRecipient).
 *
 * ⚠️ שתי שאילתות ולא embed מקונן. PostgREST תומך בקינון
 * (`appointments!inner(... customers!inner(...))`), אבל הדפוס המוכח בפרויקט
 * הזה הוא embed בעומק אחד בלבד (ראה ADMIN_APPOINTMENT_COLUMNS). embed
 * שנכשל אינו זורק — הוא מחזיר שגיאה שמתורגמת לרשימה ריקה, כלומר מסך שאומר
 * "אין תזכורות" בזמן שיש. עמוד הוא 20 שורות, והשאילתה השנייה זולה.
 */
export async function listReminders(opts: {
  status?: ReminderStatus[]
  limit?: number
  offset?: number
}): Promise<{ rows: ReminderWithContext[]; total: number }> {
  const db = createSupabaseAdminClient()
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0

  let query = db
    .from('appointment_reminders')
    .select('*', { count: 'exact' })
    .order('scheduled_for', { ascending: false })
    .range(offset, offset + limit - 1)

  if (opts.status?.length) query = query.in('status', opts.status)

  const { data, error, count } = await query
  if (error) {
    console.error('[reminders] list failed', error.message)
    return { rows: [], total: 0 }
  }

  const reminders = (data ?? []) as ReminderRow[]
  if (reminders.length === 0) return { rows: [], total: count ?? 0 }

  const { data: appts, error: apptErr } = await db
    .from('appointments')
    .select('id, status, service_key, variants, customers(full_name)')
    .in('id', Array.from(new Set(reminders.map(r => r.appointment_id))))

  if (apptErr) {
    console.error('[reminders] list context failed', apptErr.message)
  }

  const byId = new Map<string, { status: string; service_key: string; variants: string[]; full_name: string }>()
  for (const a of (appts ?? []) as unknown as {
    id: string
    status: string
    service_key: string
    variants: string[]
    customers: { full_name: string } | null
  }[]) {
    byId.set(a.id, {
      status: a.status,
      service_key: a.service_key,
      variants: a.variants ?? [],
      full_name: a.customers?.full_name ?? '—',
    })
  }

  const rows = reminders.map(r => {
    const ctx = byId.get(r.appointment_id)
    return {
      ...r,
      customer_full_name: ctx?.full_name ?? '—',
      appointment_status: ctx?.status ?? '',
      service_key: ctx?.service_key ?? '',
      variants: ctx?.variants ?? [],
    }
  })

  return { rows, total: count ?? 0 }
}

export async function listRemindersForAppointment(
  appointmentId: string,
): Promise<ReminderRow[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('appointment_reminders')
    .select('*')
    .eq('appointment_id', appointmentId)
    .order('scheduled_for', { ascending: true })
  if (error) {
    console.error('[reminders] list for appointment failed', error.message)
    return []
  }
  return (data ?? []) as ReminderRow[]
}

export async function listReminderAttempts(reminderId: string): Promise<ReminderAttemptRow[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('appointment_reminder_attempts')
    .select('*')
    .eq('reminder_id', reminderId)
    .order('attempt_number', { ascending: true })
  if (error) {
    console.error('[reminders] list attempts failed', error.message)
    return []
  }
  return (data ?? []) as ReminderAttemptRow[]
}

export interface ReminderRecipient {
  phoneE164: string
  serviceKey: string
  variants: string[]
}

/**
 * פרטי הנמענת — **נטענים רק ברגע השליחה**.
 *
 * ⚠️ זו הסיבה שהטלפון אינו נשמר בשורת התזכורת ואינו מוחזר מה-claim: הוא
 * נקרא לזיכרון, נכנס לגוף ההודעה, והכול נזרק. לא נכתב לשום טבלה של
 * תזכורות ולא ללוג.
 */
export async function loadReminderRecipient(
  appointmentId: string,
): Promise<ReminderRecipient | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('appointments')
    // embed בעומק אחד — אותו דפוס בדיוק כמו ADMIN_APPOINTMENT_COLUMNS
    .select('service_key, variants, customers(phone_e164)')
    .eq('id', appointmentId)
    .single()
  if (error || !data) {
    if (error) console.error('[reminders] load recipient failed', error.message)
    return null
  }
  const row = data as unknown as {
    service_key: string
    variants: string[]
    customers: { phone_e164: string } | null
  }
  // ⚠️ בלי טלפון אין למי לשלוח, ו-null עדיף על שליחה ליעד ריק.
  if (!row.customers?.phone_e164) {
    console.error('[reminders] recipient has no phone')
    return null
  }
  return {
    phoneE164: row.customers.phone_e164,
    serviceKey: row.service_key,
    variants: row.variants ?? [],
  }
}

export interface ReminderCounts {
  scheduled: number
  retrying: number
  processing: number
  sent: number
  simulated: number
  failed: number
  delivery_unknown: number
  cancelled: number
  superseded: number
  skipped: number
}

export async function getReminderCounts(): Promise<ReminderCounts> {
  const empty: ReminderCounts = {
    scheduled: 0, retrying: 0, processing: 0, sent: 0, simulated: 0,
    failed: 0, delivery_unknown: 0, cancelled: 0, superseded: 0, skipped: 0,
  }
  const db = createSupabaseAdminClient()
  const { data, error } = await db.from('appointment_reminders').select('status')
  if (error) {
    console.error('[reminders] counts failed', error.message)
    return empty
  }
  for (const r of (data ?? []) as { status: ReminderStatus }[]) {
    if (r.status in empty) empty[r.status] += 1
  }
  return empty
}
