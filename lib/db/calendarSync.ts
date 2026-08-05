import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { CalendarChangeRecord, EventOwnership, EventShape, SyncMode } from '@/lib/googleCalendarSync'

/**
 * שלב 8 — שכבת הגישה לטבלאות הסנכרון הנכנס (0008).
 *
 * כל הכתיבות עוברות דרך RPC ולא דרך UPDATE ישיר, מאותה סיבה כמו ב-0004/0005:
 * תנאי ה-lease, אימות ה-transitions וקידום ה-cursor חייבים להישאר קרובים
 * לנתונים ובתוך טרנזקציה — לא string filters שבירים בצד הלקוח.
 */

export type QueueStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'ignored'

export type ChangeResult =
  | 'echo' | 'rescheduled' | 'end_corrected' | 'cancelled_by_google_delete'
  | 'already_cancelled' | 'reverted_to_db' | 'revert_failed' | 'duplicate_event'
  | 'orphaned_event' | 'invalid_appointment_id' | 'ambiguous_ownership'
  | 'restored_event_redeleted' | 'terminal_appointment' | 'not_confirmed'
  | 'unsupported_event_shape'

export type IssueKind =
  | 'conflict_slot_taken' | 'new_start_invalid' | 'revert_failed' | 'duplicate_event'
  | 'orphaned_event' | 'invalid_appointment_id' | 'ambiguous_ownership'
  | 'restored_after_cancel' | 'deleted_terminal_appointment'
  | 'unsupported_recurring_event' | 'unsupported_all_day_event' | 'malformed_event'
  | 'calendar_changed'

export interface SyncRunPlan {
  mode: SyncMode
  baseSyncToken: string | null
  pageToken: string | null
  resumed: boolean
  calendarReset: boolean
}

export interface QueueItem {
  id: number
  google_event_id: string
  event_version: string
  ownership: EventOwnership
  event_shape: EventShape
  appointment_id: string | null
  event_status: 'confirmed' | 'tentative' | 'cancelled'
  event_start: string | null
  event_end: string | null
  event_updated: string | null
  status: QueueStatus
  attempt_count: number
  last_error: string | null
  result: ChangeResult | null
  created_at: string
}

/** lease של ריצת סנכרון. ארוך מספיק לריצה מלאה, קצר מספיק שקריסה לא תחסום. */
export const SYNC_RUN_LEASE_SECONDS = 300
/** lease של פריט בודד בתור. */
export const CHANGE_LEASE_SECONDS = 120
/** מעבר לזה נדרש retry ידני מהניהול. */
export const MAX_CHANGE_ATTEMPTS = 5

/**
 * תופסת lease לריצה ומקבלת את תוכנית הריצה. ההחלטה בין full, incremental
 * ו-resume נעשית בתוך ה-RPC ולא כאן — שתי ריצות שקוראות את המצב ומחליטות
 * בנפרד היו יכולות לבחור תוכניות סותרות על אותו cursor.
 */
export async function claimSyncRun(
  owner: string,
  calendarFingerprint: string,
): Promise<{ ok: true; plan: SyncRunPlan } | { ok: false; error: 'locked' | 'db_error' }> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('claim_calendar_sync_run', {
    p_owner: owner,
    p_lease_seconds: SYNC_RUN_LEASE_SECONDS,
    p_calendar_fingerprint: calendarFingerprint,
  })

  if (error) {
    if (error.message?.includes('SYNC_RUN_LOCKED')) return { ok: false, error: 'locked' }
    console.error('[calendarSync] claim run failed', error.message)
    return { ok: false, error: 'db_error' }
  }

  const raw = data as { mode: SyncMode; base_sync_token: string | null; page_token: string | null; resumed: boolean; calendar_reset: boolean }
  return {
    ok: true,
    plan: {
      mode: raw.mode,
      baseSyncToken: raw.base_sync_token,
      pageToken: raw.page_token,
      resumed: raw.resumed,
      calendarReset: raw.calendar_reset,
    },
  }
}

export interface RecordChangesResult {
  received: number
  inserted: number
  duplicate: number
  completed: boolean
}

/**
 * ⚠️ הפונקציה שכל עמידות שלב 8 נשענת עליה. שמירת השינויים וקידום ה-cursor
 * הם טרנזקציה אחת ב-DB. אסור בשום מצב לפצל אותם לשתי קריאות מכאן — קריסה
 * בין השתיים הייתה מקדמת את הטוקן על שינויים שלא נשמרו, ו-Google לא יחזיר
 * אותם שוב לעולם.
 *
 * בדיוק אחד מ-nextPageToken/nextSyncToken חייב להיות מלא: Google מחזיר את
 * טוקן הסנכרון רק בעמוד האחרון.
 */
export async function recordChanges(params: {
  owner: string
  changes: CalendarChangeRecord[]
  nextPageToken: string | null
  nextSyncToken: string | null
}): Promise<{ ok: true; result: RecordChangesResult } | { ok: false; error: string }> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('record_calendar_changes', {
    p_owner: params.owner,
    p_changes: params.changes,
    p_next_page_token: params.nextPageToken,
    p_next_sync_token: params.nextSyncToken,
  })

  if (error) {
    console.error('[calendarSync] record changes failed', error.message)
    return { ok: false, error: error.message ?? 'record failed' }
  }
  return { ok: true, result: data as unknown as RecordChangesResult }
}

/**
 * fullReset=true  → הטוקן עצמו פסול (410). שלושת שדות ה-cursor מתאפסים.
 * fullReset=false → רק ה-pageToken פסול. אותה סדרת incremental מתחילה
 *                   מחדש מהעמוד הראשון עם ה-base_sync_token הקיים.
 */
export async function resetSyncCursor(
  owner: string,
  fullReset: boolean,
  reason: string,
): Promise<{ ok: true; plan: Pick<SyncRunPlan, 'mode' | 'baseSyncToken' | 'pageToken'> } | { ok: false }> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('reset_calendar_sync_cursor', {
    p_owner: owner,
    p_full_reset: fullReset,
    p_reason: reason.slice(0, 300),
  })
  if (error) {
    console.error('[calendarSync] cursor reset failed', error.message)
    return { ok: false }
  }
  const raw = data as { mode: SyncMode; base_sync_token: string | null; page_token: string | null }
  return { ok: true, plan: { mode: raw.mode, baseSyncToken: raw.base_sync_token, pageToken: raw.page_token } }
}

/**
 * משחררת את ה-lease ורושמת את תוצאת הריצה.
 *
 * ⚠️ ה-cursor אינו נגע כאן. ריצה שנכשלה על 429/5xx חייבת להשאיר את
 * page_token ו-base_sync_token כפי שהם, כדי שהריצה הבאה תמשיך מאותה נקודה.
 */
export async function finishSyncRun(params: {
  owner: string
  status: 'success' | 'failed'
  error: string | null
  stats: Record<string, number | boolean | string | null>
}): Promise<boolean> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('finish_calendar_sync_run', {
    p_owner: params.owner,
    p_status: params.status,
    p_error: params.error?.slice(0, 300) ?? null,
    p_stats: params.stats,
  })
  if (error) {
    console.error('[calendarSync] finish run failed', error.message)
    return false
  }
  return true
}

/** תופסת פריט אחד לעיבוד. null = אין מה לעבד (לא שגיאה). */
export async function claimChange(owner: string): Promise<QueueItem | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('claim_calendar_change', {
    p_owner: owner,
    p_max_attempts: MAX_CHANGE_ATTEMPTS,
    p_lease_seconds: CHANGE_LEASE_SECONDS,
  })
  if (error) {
    if (error.message?.includes('NOTHING_TO_CLAIM')) return null
    console.error('[calendarSync] claim change failed', error.message)
    return null
  }
  return data as unknown as QueueItem
}

export async function finishChange(params: {
  queueId: number
  owner: string
  status: Extract<QueueStatus, 'processed' | 'ignored' | 'failed'>
  result: ChangeResult | null
  error: string | null
}): Promise<boolean> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('finish_calendar_change', {
    p_queue_id: params.queueId,
    p_owner: params.owner,
    p_status: params.status,
    p_result: params.result,
    p_error: params.error?.slice(0, 300) ?? null,
  })
  if (error) {
    console.error('[calendarSync] finish change failed', error.message)
    return false
  }
  return true
}

export async function retryChange(
  queueId: number,
): Promise<{ ok: true } | { ok: false; error: 'not_retryable' | 'db_error' }> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('retry_calendar_change', { p_queue_id: queueId })
  if (error) {
    if (error.message?.includes('NOT_RETRYABLE')) return { ok: false, error: 'not_retryable' }
    console.error('[calendarSync] retry change failed', error.message)
    return { ok: false, error: 'db_error' }
  }
  return { ok: true }
}

/**
 * idempotent: אותו (queue_id, kind) מעדכן שורה קיימת במקום לייצר כפילות,
 * ו-resolved_at נכתב פעם אחת בלבד. גרסת אירוע חדשה מקבלת queue item חדש
 * ולכן *כן* יכולה לפתוח issue חדשה — כי זו באמת תקלה חדשה.
 */
export async function recordIssue(params: {
  queueId: number | null
  kind: IssueKind
  status: 'open' | 'resolved'
  googleEventId?: string | null
  appointmentId?: string | null
  dbStartsAt?: string | null
  googleStartsAt?: string | null
  detail: string
}): Promise<void> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('record_calendar_sync_issue', {
    p_queue_id: params.queueId,
    p_kind: params.kind,
    p_status: params.status,
    p_google_event_id: params.googleEventId ?? null,
    p_appointment_id: params.appointmentId ?? null,
    p_db_starts_at: params.dbStartsAt ?? null,
    p_google_starts_at: params.googleStartsAt ?? null,
    p_detail: params.detail.slice(0, 300),
  })
  if (error) console.error('[calendarSync] record issue failed', error.message)
}

// ─── פעולות על התור עצמו ────────────────────────────────────────────────────

export type InboundRescheduleOutcome = 'applied' | 'echo'
export type InboundRescheduleError =
  | 'not_found' | 'not_confirmed' | 'new_in_past' | 'sync_in_progress' | 'slot_taken' | 'db_error'

export async function applyGoogleReschedule(params: {
  appointmentId: string
  googleEventId: string
  newStartsAt: Date
  /** האם ה-end ביומן כבר תואם ל-duration_min. false → התור יישאר pending לתיקון. */
  calendarMatches: boolean
  queueId: number
}): Promise<
  | { ok: true; outcome: InboundRescheduleOutcome; fromStartsAt: string | null }
  | { ok: false; error: InboundRescheduleError }
> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('apply_google_reschedule', {
    p_appointment_id: params.appointmentId,
    p_google_event_id: params.googleEventId,
    p_new_starts_at: params.newStartsAt.toISOString(),
    p_calendar_matches: params.calendarMatches,
    p_queue_id: params.queueId,
  })

  if (error) {
    // 23P01 = exclusion_violation — הסלוט תפוס ע"י תור אחר ב-Supabase.
    // ה-EXCLUDE constraint הוא ההגנה האמיתית; לא בדיקה מוקדמת.
    if (error.code === '23P01') return { ok: false, error: 'slot_taken' }
    const m = error.message ?? ''
    if (m.includes('NOT_FOUND')) return { ok: false, error: 'not_found' }
    if (m.includes('NOT_CONFIRMED')) return { ok: false, error: 'not_confirmed' }
    if (m.includes('NEW_IN_PAST')) return { ok: false, error: 'new_in_past' }
    if (m.includes('SYNC_IN_PROGRESS')) return { ok: false, error: 'sync_in_progress' }
    console.error('[calendarSync] apply reschedule failed', error.message)
    return { ok: false, error: 'db_error' }
  }

  const raw = data as { outcome: InboundRescheduleOutcome; from_starts_at?: string }
  return { ok: true, outcome: raw.outcome, fromStartsAt: raw.from_starts_at ?? null }
}

export type InboundCancelOutcome =
  | 'applied' | 'already_cancelled' | 'terminal' | 'not_confirmed'

export async function applyGoogleCancellation(params: {
  appointmentId: string
  googleEventId: string
  queueId: number
}): Promise<
  | { ok: true; outcome: InboundCancelOutcome; fromStartsAt: string | null }
  | { ok: false; error: 'not_found' | 'db_error' }
> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db.rpc('apply_google_cancellation', {
    p_appointment_id: params.appointmentId,
    p_google_event_id: params.googleEventId,
    p_queue_id: params.queueId,
  })

  if (error) {
    if (error.message?.includes('NOT_FOUND')) return { ok: false, error: 'not_found' }
    console.error('[calendarSync] apply cancellation failed', error.message)
    return { ok: false, error: 'db_error' }
  }

  const raw = data as { outcome: InboundCancelOutcome; from_starts_at?: string }
  return { ok: true, outcome: raw.outcome, fromStartsAt: raw.from_starts_at ?? null }
}

export type CorrectionMarkError =
  | 'not_found' | 'not_confirmed' | 'not_canonical' | 'sync_in_progress' | 'db_error'

/**
 * מחזירה תור מ-'synced' ל-'pending' כדי שתיקון ה-end באמת יתבצע.
 * ראה mark_calendar_correction_required ב-0008 להסבר מלא.
 */
export async function markCalendarCorrectionRequired(
  appointmentId: string,
  googleEventId: string,
): Promise<{ ok: true } | { ok: false; error: CorrectionMarkError }> {
  const db = createSupabaseAdminClient()
  const { error } = await db.rpc('mark_calendar_correction_required', {
    p_appointment_id: appointmentId,
    p_google_event_id: googleEventId,
  })
  if (error) {
    const m = error.message ?? ''
    if (m.includes('NOT_FOUND')) return { ok: false, error: 'not_found' }
    if (m.includes('NOT_CONFIRMED')) return { ok: false, error: 'not_confirmed' }
    if (m.includes('NOT_CANONICAL')) return { ok: false, error: 'not_canonical' }
    if (m.includes('SYNC_IN_PROGRESS')) return { ok: false, error: 'sync_in_progress' }
    console.error('[calendarSync] mark correction failed', error.message)
    return { ok: false, error: 'db_error' }
  }
  return { ok: true }
}

// ─── קריאות לתצוגת ניהול ────────────────────────────────────────────────────

/**
 * מיפוי google_event_id → רשימת appointment ids שמצביעים עליו. רשימה ולא
 * ערך יחיד בכוונה: שני תורים שמצביעים על אותו אירוע הם בעלות עמומה שאסור
 * להכריע בה באקראי.
 */
export async function lookupAppointmentsByEventIds(
  eventIds: string[],
): Promise<{ ok: true; map: Map<string, string[]> } | { ok: false }> {
  if (eventIds.length === 0) return { ok: true, map: new Map() }
  const db = createSupabaseAdminClient()
  try {
    const { data, error } = await db
      .from('appointments')
      .select('id, google_event_id')
      .in('google_event_id', eventIds)

    if (error) {
      console.error('[calendarSync] event id lookup failed', error.message)
      return { ok: false }
    }
    const map = new Map<string, string[]>()
    for (const row of (data ?? []) as { id: string; google_event_id: string | null }[]) {
      if (!row.google_event_id) continue
      const list = map.get(row.google_event_id) ?? []
      list.push(row.id)
      map.set(row.google_event_id, list)
    }
    return { ok: true, map }
  } catch (err) {
    console.error('[calendarSync] event id lookup threw', err instanceof Error ? err.message : String(err))
    return { ok: false }
  }
}

export interface CalendarSyncStateRow {
  sync_mode: SyncMode | null
  last_full_sync_at: string | null
  last_incremental_sync_at: string | null
  last_run_at: string | null
  last_run_status: 'running' | 'success' | 'failed' | null
  last_run_error: string | null
  last_run_stats: Record<string, unknown> | null
  token_reset_count: number
  calendar_changed_count: number
  lease_started_at: string | null
  /** נגזר, לא ערך גולמי — ה-fingerprint עצמו לעולם לא עוזב את ה-DB. */
  has_sync_token: boolean
  paused_mid_pagination: boolean
}

/**
 * מצב הסנכרון לתצוגת ניהול.
 *
 * ⚠️ sync_token, base_sync_token, page_token ו-calendar_fingerprint לא
 * נבחרים כאן בכלל. הם סודות תפעוליים שאין להם שום שימוש בתצוגה — רק
 * הנגזרות הבוליאניות שלהם.
 */
export async function getCalendarSyncState(): Promise<CalendarSyncStateRow | null> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('calendar_sync_state')
    .select(
      'sync_mode, last_full_sync_at, last_incremental_sync_at, last_run_at, last_run_status, ' +
      'last_run_error, last_run_stats, token_reset_count, calendar_changed_count, lease_started_at, ' +
      'sync_token, page_token',
    )
    .eq('id', true)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('[calendarSync] state read failed', error.message)
    return null
  }

  const row = data as unknown as Record<string, unknown>
  return {
    sync_mode: (row.sync_mode as SyncMode | null) ?? null,
    last_full_sync_at: (row.last_full_sync_at as string | null) ?? null,
    last_incremental_sync_at: (row.last_incremental_sync_at as string | null) ?? null,
    last_run_at: (row.last_run_at as string | null) ?? null,
    last_run_status: (row.last_run_status as CalendarSyncStateRow['last_run_status']) ?? null,
    last_run_error: (row.last_run_error as string | null) ?? null,
    last_run_stats: (row.last_run_stats as Record<string, unknown> | null) ?? null,
    token_reset_count: (row.token_reset_count as number) ?? 0,
    calendar_changed_count: (row.calendar_changed_count as number) ?? 0,
    lease_started_at: (row.lease_started_at as string | null) ?? null,
    has_sync_token: row.sync_token != null,
    paused_mid_pagination: row.page_token != null,
  }
}

export interface QueueCounts {
  pending: number
  processing: number
  failed: number
}

export async function getQueueCounts(): Promise<QueueCounts> {
  const db = createSupabaseAdminClient()
  const counts: QueueCounts = { pending: 0, processing: 0, failed: 0 }
  for (const status of ['pending', 'processing', 'failed'] as const) {
    const { count, error } = await db
      .from('calendar_change_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', status)
    if (error) {
      console.error('[calendarSync] queue count failed', error.message)
      continue
    }
    counts[status] = count ?? 0
  }
  return counts
}

export interface OpenIssueRow {
  id: number
  kind: IssueKind
  google_event_id: string | null
  appointment_id: string | null
  queue_id: number | null
  db_starts_at: string | null
  google_starts_at: string | null
  detail: string | null
  created_at: string
  queue_status: QueueStatus | null
  queue_result: ChangeResult | null
  queue_attempts: number | null
}

/** התקלות הפתוחות לתצוגת ניהול, עם מצב ה-queue item המקושר. */
export async function listOpenSyncIssues(limit = 25): Promise<OpenIssueRow[]> {
  const db = createSupabaseAdminClient()
  const { data, error } = await db
    .from('calendar_sync_issues')
    .select(
      'id, kind, google_event_id, appointment_id, queue_id, db_starts_at, google_starts_at, ' +
      'detail, created_at, calendar_change_queue(status, result, attempt_count)',
    )
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[calendarSync] issue list failed', error.message)
    return []
  }

  type Joined = Omit<OpenIssueRow, 'queue_status' | 'queue_result' | 'queue_attempts'> & {
    calendar_change_queue: { status: QueueStatus; result: ChangeResult | null; attempt_count: number } | null
  }

  return ((data ?? []) as unknown as Joined[]).map(r => ({
    id: r.id,
    kind: r.kind,
    google_event_id: r.google_event_id,
    appointment_id: r.appointment_id,
    queue_id: r.queue_id,
    db_starts_at: r.db_starts_at,
    google_starts_at: r.google_starts_at,
    detail: r.detail,
    created_at: r.created_at,
    queue_status: r.calendar_change_queue?.status ?? null,
    queue_result: r.calendar_change_queue?.result ?? null,
    queue_attempts: r.calendar_change_queue?.attempt_count ?? null,
  }))
}
