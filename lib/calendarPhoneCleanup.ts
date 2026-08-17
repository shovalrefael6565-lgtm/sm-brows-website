import { CALENDAR_EVENT_SOURCE, googleErrorStatus } from './googleCalendar'
import { splitLinesPreservingTerminators, lineContent } from './calendarDescriptionLines'

/**
 * 9C.2 — ניקוי טלפון מ-description של אירועי Google Calendar היסטוריים
 * שנוצרו ע"י createAppointmentEvent (Format B: extendedProperties.private
 * + google_event_id שמור ב-DB). ראה HANDOFF/9C.1 לניתוח המלא, כולל למה
 * Format A (הנתיב הציבורי הישן, ללא DB link) אינו מכוסה כאן — ר.
 * lib/legacyCalendarAudit.ts.
 *
 * הקובץ הזה מכיל אך ורק לוגיקה טהורה וטיפוסי I/O מוזרקים — בדיוק כמו
 * lib/calendarSyncPager.ts. שום SDK אמיתי לא מיובא **בזמן ריצה** (אין
 * `import { google } from 'googleapis'`, אין `@supabase/supabase-js`) —
 * הכול בדיק לגמרי בלי DB ובלי רשת. יש כן `import type` (מטיפוסי googleapis
 * בלבד, נמחק לגמרי בקומפילציה/tsx — אפס טעינה בפועל) כדי ש-GoogleCalendarLike
 * יאומת ע"י tsc מול הצורה האמיתית של calendar_v3.Calendar — ר. למטה. ה-CLI
 * האמיתי (scripts/cleanup-calendar-phone.mjs) בונה מופעים אמיתיים של
 * AppointmentLinkReader/CalendarEventClient ומזריק אותם ל-runCleanup.
 *
 * ⚠️ אין כאן שום cutoff תאריכי, לא לפי created_at ולא לפי זמן commit.
 * classifyDescription הוא היחיד שקובע אם יש מה לנקות. סדר ההרצה הנכון
 * (deploy → verify → dry-run → אישור → execute) מתועד ב-
 * docs/calendar-phone-cleanup-runbook.md — הכלי עצמו לא אוכף אותו, זו
 * אחריות המפעילה; ה-flags למטה (DEPLOYMENT_CONFIRM/EXECUTE_CONFIRM) הם
 * רק תזכורת קשה-לטעות, לא אימות בפועל של מצב הפריסה.
 */

// ════════════════════════════════════════════════════════════════════════════
// Sanitizer — שתי תבניות חיוביות מוכרות, לא היסק שלילי
// ════════════════════════════════════════════════════════════════════════════
//
// מלוכלך (4 שורות, טלפון תמיד ראשון — זו הצורה ש-createAppointmentEvent
// כתבה בין 50ac783 ל-103b14e):
//   טלפון: <ערך>
//   טיפול: <ערך>
//   מזהה תור: <ערך>
//   נקבע דרך אתר SM Brows
//
// נקי (3 שורות — בדיוק מה ש-createAppointmentEvent כותבת היום, אחרי
// הסרת שורת הטלפון):
//   טיפול: <ערך>
//   מזהה תור: <ערך>
//   נקבע דרך אתר SM Brows

const DIRTY_LINE1_RE = /^טלפון: .+$/
const CLEAN_LINE1_RE = /^טיפול: .+$/
const CLEAN_LINE2_RE = /^מזהה תור: .+$/
const FOOTER_LINE = 'נקבע דרך אתר SM Brows'

export type ClassifyResult =
  | { kind: 'no_description' }
  | { kind: 'already_clean' }
  | { kind: 'unknown_shape' }
  | { kind: 'needs_cleanup'; newDescription: string }

/**
 * מסווגת description בודד לאחת מארבע תוצאות. הרצה שנייה על ה-newDescription
 * שהוחזר מ-needs_cleanup חייבת להחזיר already_clean — וזה נכון במבנה, לא
 * רק בבדיקה: שלוש השורות שנשארות (lines[1..3] מהמקור) הן *בדיוק* אותן
 * שלוש שורות שגם ענף already_clean בודק (CLEAN_LINE1_RE/CLEAN_LINE2_RE/
 * FOOTER_LINE), כי זה בדיוק תנאי הכניסה לענף needs_cleanup מלכתחילה.
 */
export function classifyDescription(description: string | null | undefined): ClassifyResult {
  if (description === null || description === undefined || description === '') {
    return { kind: 'no_description' }
  }

  const lines = splitLinesPreservingTerminators(description)

  if (lines.length === 3) {
    const l0 = lineContent(lines[0])
    const l1 = lineContent(lines[1])
    const l2 = lineContent(lines[2])
    if (CLEAN_LINE1_RE.test(l0) && CLEAN_LINE2_RE.test(l1) && l2 === FOOTER_LINE) {
      return { kind: 'already_clean' }
    }
    return { kind: 'unknown_shape' }
  }

  if (lines.length === 4) {
    const l0 = lineContent(lines[0])
    const l1 = lineContent(lines[1])
    const l2 = lineContent(lines[2])
    const l3 = lineContent(lines[3])
    if (DIRTY_LINE1_RE.test(l0) && CLEAN_LINE1_RE.test(l1) && CLEAN_LINE2_RE.test(l2) && l3 === FOOTER_LINE) {
      // הסרת שורה 1 בלבד + ה-terminator שלה, ע"י slice על המחרוזת
      // המקורית — לא split+join מחדש, כדי לשמר CRLF/LF של שאר השורות
      // בלי שום נרמול.
      const newDescription = description.slice(lines[0].length)
      return { kind: 'needs_cleanup', newDescription }
    }
    return { kind: 'unknown_shape' }
  }

  return { kind: 'unknown_shape' }
}

/** בעלות Format B: source קבוע וגם appointment_id תואם לשורה שנשלפה מה-DB. */
export function isOwnedBySystem(
  extendedPrivate: { source?: string; appointment_id?: string } | null | undefined,
  appointmentId: string,
): boolean {
  return extendedPrivate?.source === CALENDAR_EVENT_SOURCE
    && extendedPrivate?.appointment_id === appointmentId
}

// ════════════════════════════════════════════════════════════════════════════
// I/O מוזרק — טיפוסים בלבד. שום SDK אמיתי לא מיובא בקובץ הזה.
// ════════════════════════════════════════════════════════════════════════════

export interface AppointmentEventRow {
  id: string
  google_event_id: string
}

export interface AppointmentLinkReader {
  /**
   * SELECT-only. afterId=null → עמוד ראשון, keyset לפי id עולה. אין תנאי
   * created_at/status — כל שורה עם google_event_id לא-null.
   */
  listLinkedAppointments(afterId: string | null, limit: number): Promise<AppointmentEventRow[]>
}

export interface CalendarEventSnapshot {
  etag: string | null
  description: string | null | undefined
  ownerSource: string | undefined
  ownerAppointmentId: string | undefined
}

export interface CalendarEventClient {
  /** זורקת על שגיאת HTTP — googleErrorStatus מסווג אותה. */
  getEvent(eventId: string): Promise<CalendarEventSnapshot>
  /** PATCH — description בלבד. הממשק עצמו לא מאפשר להעביר שום שדה אחר. */
  patchDescription(eventId: string, description: string, etag: string): Promise<void>
}

// ════════════════════════════════════════════════════════════════════════════
// מתאמים אמיתיים — טיפוס מבני בלבד (structural typing), בלי לייבא googleapis
// או @supabase/supabase-js. ה-CLI (scripts/cleanup-calendar-phone.mjs) בונה
// לקוח אמיתי ומעביר אותו לכאן; בדיקות מעבירות לקוח מזויף מאותה צורה בדיוק.
// ════════════════════════════════════════════════════════════════════════════

export interface SelectOnlySupabaseTable {
  select(columns: string): SelectOnlySupabaseTable
  not(column: string, op: string, value: unknown): SelectOnlySupabaseTable
  gt(column: string, value: string): SelectOnlySupabaseTable
  order(column: string, opts: { ascending: boolean }): SelectOnlySupabaseTable
  limit(n: number): PromiseLike<{ data: AppointmentEventRow[] | null; error: { code?: string } | null }>
}

export interface SelectOnlyDb {
  from(table: string): SelectOnlySupabaseTable
}

export class LinkReaderDbError extends Error {
  constructor(public code: string) {
    super('appointment link query failed')
    this.name = 'LinkReaderDbError'
  }
}

/**
 * ⚠️ הפונקציה הזו קוראת select/not/order/gt/limit בלבד — שום insert,
 * update, delete, upsert או rpc. זו הערובה הקודית ל-"DB הוא read-only
 * מבחינת הקוד"; הבדיקה הייעודית (scripts/test-calendar-phone-cleanup.mjs)
 * מזריקה client מזויף שזורק אם נוגעים במתודת כתיבה כלשהי.
 */
export function createSupabaseAppointmentLinkReader(db: SelectOnlyDb): AppointmentLinkReader {
  return {
    async listLinkedAppointments(afterId, limit) {
      let query = db
        .from('appointments')
        .select('id, google_event_id')
        .not('google_event_id', 'is', null)
        .order('id', { ascending: true })
      if (afterId !== null) query = query.gt('id', afterId)
      const { data, error } = await query.limit(limit)
      if (error) throw new LinkReaderDbError(error.code ?? 'unknown')
      return data ?? []
    },
  }
}

export interface GoogleCalendarLike {
  events: {
    get(params: { calendarId: string; eventId: string }): Promise<{
      data: {
        etag?: string | null
        description?: string | null
        extendedProperties?: { private?: Record<string, string> | null } | null
      }
    }>
    patch(
      params: { calendarId: string; eventId: string; requestBody: { description: string } },
      options: { headers: { 'If-Match': string } },
    ): Promise<unknown>
  }
}

// ── בדיקת התאמה קומפילטיבית בלבד — לא mock גמיש ──────────────────────────
//
// `import type` נמחק לגמרי ע"י tsc/tsx (isolatedModules) — googleapis
// *לא* נטענת בפועל, לא בזמן typecheck ולא בזמן ריצה. אבל tsc עדיין בודק
// בפועל שאובייקט אמיתי מטיפוס calendar_v3.Calendar (הגרסה המותקנת,
// node_modules/googleapis) ניתן להעברה ל-createGoogleCalendarEventClient
// בדיוק כפי ש-scripts/cleanup-calendar-phone.mjs עושה. אם googleapis
// תעודכן ותשנה את חתימת events.get/events.patch, השורה הזו נכשלת ב-
// `npm run typecheck` — לא נשברת בשקט בזמן ריצה מול Google האמיתי.
//
// ⚠️ scripts/*.mjs אינם כלולים ב-tsconfig.json (`include` הוא **/*.ts
// בלבד) — בלי הבדיקה הזו, קריאת ה-PATCH האמיתית ב-CLI מעולם לא הייתה
// מאומתת ע"י tsc בכלל.
import type { calendar_v3 as GoogleCalendarV3Types } from 'googleapis'
function _assertRealCalendarMatchesGoogleCalendarLike(real: GoogleCalendarV3Types.Calendar): void {
  if (false as boolean) {
    createGoogleCalendarEventClient(real, 'type-check-only')
  }
}
void _assertRealCalendarMatchesGoogleCalendarLike

/**
 * ⚠️ patchDescription שולחת requestBody: { description } בלבד — שום
 * summary/start/end/location/attendees/reminders/status/extendedProperties.
 * הטיפוס של GoogleCalendarLike['events']['patch'] בעצמו לא מאפשר שדות
 * נוספים ב-requestBody, ולכן זו אינה רק כוונה אלא הגבלה קומפילטיבית.
 */
export function createGoogleCalendarEventClient(
  calendar: GoogleCalendarLike,
  calendarId: string,
): CalendarEventClient {
  return {
    async getEvent(eventId) {
      const res = await calendar.events.get({ calendarId, eventId })
      const priv = res.data.extendedProperties?.private
      return {
        etag: res.data.etag ?? null,
        description: res.data.description ?? null,
        ownerSource: priv?.source,
        ownerAppointmentId: priv?.appointment_id,
      }
    },
    async patchDescription(eventId, description, etag) {
      await calendar.events.patch(
        { calendarId, eventId, requestBody: { description } },
        { headers: { 'If-Match': etag } },
      )
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// לולאת ההרצה
// ════════════════════════════════════════════════════════════════════════════

export interface RunCounts {
  scanned: number
  would_patch: number
  patched: number
  already_clean: number
  unknown_shape: number
  no_description: number
  not_ours: number
  not_found_or_gone: number
  missing_etag: number
  etag_conflict: number
  transient_failure: number
}

export function zeroCounts(): RunCounts {
  return {
    scanned: 0,
    would_patch: 0,
    patched: 0,
    already_clean: 0,
    unknown_shape: 0,
    no_description: 0,
    not_ours: 0,
    not_found_or_gone: 0,
    missing_etag: 0,
    etag_conflict: 0,
    transient_failure: 0,
  }
}

export type RunMode = 'dry_run' | 'execute'

export interface RunDeps {
  reader: AppointmentLinkReader
  calendar: CalendarEventClient
  /** מוזרק כדי שבדיקות לא ימתינו בפועל ל-backoff אמיתי. */
  sleep: (ms: number) => Promise<void>
  batchSize: number
  mode: RunMode
  maxRetries?: number
}

export type RunOutcome =
  | { kind: 'completed'; counts: RunCounts }
  | { kind: 'aborted_auth_error'; counts: RunCounts }

export const DEFAULT_MAX_RETRIES = 4

function backoffMs(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** (attempt - 1))
}

type GetOutcome =
  | { kind: 'ok'; snapshot: CalendarEventSnapshot }
  | { kind: 'not_found' }
  | { kind: 'aborted' }
  | { kind: 'transient_exhausted' }

async function getWithRetry(deps: RunDeps, eventId: string): Promise<GetOutcome> {
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES
  let attempt = 0
  for (;;) {
    try {
      const snapshot = await deps.calendar.getEvent(eventId)
      return { kind: 'ok', snapshot }
    } catch (err) {
      const status = googleErrorStatus(err)
      if (status === 404 || status === 410) return { kind: 'not_found' }
      if (status === 401 || status === 403) return { kind: 'aborted' }
      // 429/5xx/סטטוס לא-ידוע (כולל תקלת רשת ללא קוד) — כולם retry מוגבל.
      attempt++
      if (attempt > maxRetries) return { kind: 'transient_exhausted' }
      await deps.sleep(backoffMs(attempt))
    }
  }
}

type PatchOutcome = 'ok' | 'conflict' | 'aborted' | 'transient_exhausted'

async function patchWithRetry(
  deps: RunDeps,
  eventId: string,
  description: string,
  etag: string,
): Promise<PatchOutcome> {
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES
  let attempt = 0
  for (;;) {
    try {
      await deps.calendar.patchDescription(eventId, description, etag)
      return 'ok'
    } catch (err) {
      const status = googleErrorStatus(err)
      if (status === 412) return 'conflict' // עריכה מקבילה — אין retry
      if (status === 401 || status === 403) return 'aborted'
      attempt++
      if (attempt > maxRetries) return 'transient_exhausted'
      await deps.sleep(backoffMs(attempt))
    }
  }
}

/**
 * הלולאה הראשית. אין cursor persistence: lastId חי רק במשתנה מקומי בתוך
 * קריאת הפונקציה, לעולם לא מודפס ולא נכתב לקובץ. קריסה = הרצה מחדש
 * מהתחלה; בזכות idempotency של ה-sanitizer, שורות שכבר טופלו חוזרות
 * מיידית כ-already_clean בלי PATCH נוסף.
 */
export async function runCleanup(deps: RunDeps): Promise<RunOutcome> {
  const counts = zeroCounts()
  let lastId: string | null = null

  for (;;) {
    const rows = await deps.reader.listLinkedAppointments(lastId, deps.batchSize)
    if (rows.length === 0) break

    for (const row of rows) {
      counts.scanned++

      const got = await getWithRetry(deps, row.google_event_id)
      if (got.kind === 'aborted') return { kind: 'aborted_auth_error', counts }
      if (got.kind === 'not_found') {
        counts.not_found_or_gone++
        continue
      }
      if (got.kind === 'transient_exhausted') {
        counts.transient_failure++
        continue
      }

      const { snapshot } = got
      const owned = isOwnedBySystem(
        { source: snapshot.ownerSource, appointment_id: snapshot.ownerAppointmentId },
        row.id,
      )
      if (!owned) {
        counts.not_ours++
        continue
      }

      const classified = classifyDescription(snapshot.description)
      if (classified.kind === 'no_description') {
        counts.no_description++
        continue
      }
      if (classified.kind === 'already_clean') {
        counts.already_clean++
        continue
      }
      if (classified.kind === 'unknown_shape') {
        counts.unknown_shape++
        continue
      }

      // classified.kind === 'needs_cleanup'
      if (deps.mode === 'dry_run') {
        counts.would_patch++
        continue
      }

      if (!snapshot.etag) {
        counts.missing_etag++
        continue
      }

      const patched = await patchWithRetry(deps, row.google_event_id, classified.newDescription, snapshot.etag)
      if (patched === 'aborted') return { kind: 'aborted_auth_error', counts }
      if (patched === 'conflict') {
        counts.etag_conflict++
        continue
      }
      if (patched === 'transient_exhausted') {
        counts.transient_failure++
        continue
      }
      counts.patched++
    }

    lastId = rows[rows.length - 1].id
  }

  return { kind: 'completed', counts }
}

// ════════════════════════════════════════════════════════════════════════════
// CLI — פענוח וקביעת ארגומנטים בלבד. טהור: שום process.env, שום I/O.
// ════════════════════════════════════════════════════════════════════════════

export const DEPLOYMENT_CONFIRM_VALUE = 'PHONE_FREE_CREATION_DEPLOYED_V1'
export const EXECUTE_CONFIRM_VALUE = 'REMOVE_LINKED_CALENDAR_PHONE_V1'
export const DEFAULT_BATCH_SIZE = 100
export const MIN_BATCH_SIZE = 1
export const MAX_BATCH_SIZE = 500

export type CliPlan =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'run'; mode: RunMode; batchSize: number }

/**
 * ⚠️ טהורה לגמרי — לא קוראת process.env, לא פותחת חיבור. --help נבדק
 * ראשון, לפני כל דבר אחר, וגם הוא לא נוגע בסביבה. שני אישורי ה-confirm
 * (deployment-confirm חובה תמיד, confirm חובה רק עם --execute) נבדקים
 * *לפני* שהקורא (ה-CLI האמיתי) בכלל ניגש ל-env/רשת — ראה
 * scripts/cleanup-calendar-phone.mjs.
 */
export function resolveCleanupCliPlan(argv: string[]): CliPlan {
  let execute = false
  let deploymentConfirm: string | null = null
  let confirm: string | null = null
  let batchSizeRaw: string | null = null

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { kind: 'help' }
    if (arg === '--execute') {
      execute = true
      continue
    }
    const eq = arg.indexOf('=')
    if (eq === -1) return { kind: 'error', message: `ארגומנט לא מוכר: ${arg}` }
    const key = arg.slice(0, eq)
    const value = arg.slice(eq + 1)
    if (key === '--deployment-confirm') {
      deploymentConfirm = value
      continue
    }
    if (key === '--confirm') {
      confirm = value
      continue
    }
    if (key === '--batch-size') {
      batchSizeRaw = value
      continue
    }
    return { kind: 'error', message: `ארגומנט לא מוכר: ${arg}` }
  }

  let batchSize = DEFAULT_BATCH_SIZE
  if (batchSizeRaw !== null) {
    const n = Number(batchSizeRaw)
    if (!Number.isInteger(n) || n < MIN_BATCH_SIZE || n > MAX_BATCH_SIZE) {
      return {
        kind: 'error',
        message: `batch-size חייב להיות מספר שלם בין ${MIN_BATCH_SIZE} ל-${MAX_BATCH_SIZE}`,
      }
    }
    batchSize = n
  }

  if (deploymentConfirm !== DEPLOYMENT_CONFIRM_VALUE) {
    return {
      kind: 'error',
      message:
        'חובה --deployment-confirm=' + DEPLOYMENT_CONFIRM_VALUE + ' — '
        + 'רק אחרי שאומת בפועל שהקוד שכבר לא כותב טלפון ל-description פרוס בפרודקשן.',
    }
  }

  if (!execute) {
    return { kind: 'run', mode: 'dry_run', batchSize }
  }

  if (confirm !== EXECUTE_CONFIRM_VALUE) {
    return {
      kind: 'error',
      message: '--execute דורש גם --confirm=' + EXECUTE_CONFIRM_VALUE,
    }
  }

  return { kind: 'run', mode: 'execute', batchSize }
}
