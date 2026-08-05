import 'server-only'
import { randomUUID } from 'crypto'
import {
  type CalendarChangesClient,
  createCalendarChangesClient,
  calendarFingerprint,
  getSyncCalendarId,
} from '@/lib/googleCalendarSync'
import {
  type SyncCursorStore,
  fetchChanges,
} from '@/lib/calendarSyncPager'
import {
  type ChangeResult,
  type QueueItem,
  type QueueStatus,
  applyGoogleCancellation,
  applyGoogleReschedule,
  claimChange,
  claimSyncRun,
  finishChange,
  finishSyncRun,
  lookupAppointmentsByEventIds,
  markCalendarCorrectionRequired,
  recordChanges,
  recordIssue,
  resetSyncCursor,
} from '@/lib/db/calendarSync'
import {
  type AdminAppointmentRow,
  getAppointmentForInboundSync,
} from '@/lib/db/appointments'
import {
  deterministicEventId,
  deleteAppointmentEvent,
  sanitizeGoogleError,
  updateAppointmentEventTime,
} from '@/lib/googleCalendar'
import { retryCalendarSync } from '@/lib/appointmentApproval'
import { israelDateStr, fmtIsrael } from '@/lib/israelTime'
import { treatmentLabel } from '@/lib/admin/format'

/**
 * שלב 8 — מנוע הסנכרון הנכנס: Google Calendar → Supabase.
 *
 * ═══ הגבול שאסור לחצות ═══
 *
 * Supabase נשאר מקור האמת. Google רשאי להשפיע על שני דברים בלבד:
 *   1. מועד ההתחלה של תור confirmed, כששובל גוררת אותו ביומן.
 *   2. ביטול מצד העסק, כששובל מוחקת אירוע מערכת.
 *
 * הוא *לעולם* אינו משנה לקוחה, טלפון, טיפול, מחיר, מקדמה, variants,
 * duration_min, את reschedule_count של הלקוחה, או סטטוס completed/no_show.
 *
 * ═══ ארבע שכבות מניעת לולאה ═══
 *
 * המערכת כבר כותבת ל-Google (שלבים 6–7). כל כתיבה כזו חוזרת אלינו כשינוי,
 * וארבע שכבות בלתי תלויות עוצרות אותה:
 *
 *   1. ייחודיות גרסה — (google_event_id, event_version) ב-DB. כל etag
 *      מעובד לכל היותר פעם אחת, גם בשתי ריצות ואחרי full sync חוזר.
 *   2. השוואת מצב — googleStart == appointment.starts_at ⇒ echo, אפס
 *      כתיבות. מכסה יצירה, patch של הזזת לקוחה, retry ניהולי ותיקון end.
 *   3. ביטול idempotent — מחיקה על תור שכבר סופי ⇒ אפס כתיבות.
 *   4. סינון בעלות — אירוע ידני לא נכנס לתור בכלל.
 *
 * גם התיקונים שהמנוע הזה עצמו מבצע (revert, תיקון end, מחיקה חוזרת של
 * אירוע משוחזר) חוזרים כשינוי — ונעצרים בשכבה 2 או 3. אין לולאה.
 */

/**
 * תקציב זמן לריצה, מתחת ל-lease של 5 דקות. ריצה שנעצרת כאן שומרת את
 * ה-cursor שלה כפי שהוא, והריצה הבאה ממשיכה מאותו עמוד בדיוק.
 */
const RUN_BUDGET_MS = 3.5 * 60 * 1000

export interface SyncStats {
  eventsRead: number
  manualIgnored: number
  changesPersisted: number
  duplicateVersions: number
  pagesFetched: number
  processed: number
  ignored: number
  failed: number
  echoes: number
  rescheduled: number
  cancelled: number
  durationCorrections: number
  duplicates: number
  reverted: number
  deleted: number
  syncTokenReset: boolean
  pageRestart: boolean
  calendarChanged: boolean
  timedOut: boolean
}

function emptyStats(): SyncStats {
  return {
    eventsRead: 0, manualIgnored: 0, changesPersisted: 0, duplicateVersions: 0,
    pagesFetched: 0, processed: 0, ignored: 0, failed: 0, echoes: 0,
    rescheduled: 0, cancelled: 0, durationCorrections: 0, duplicates: 0,
    reverted: 0, deleted: 0, syncTokenReset: false, pageRestart: false,
    calendarChanged: false, timedOut: false,
  }
}

export interface SyncDeps {
  client: CalendarChangesClient
  now: () => number
}

function defaultDeps(): SyncDeps {
  return { client: createCalendarChangesClient(), now: () => Date.now() }
}

export type SyncRunResult =
  | { ok: true; stats: SyncStats }
  | { ok: false; status: number; error: string; message: string }

/**
 * ריצת סנכרון מלאה: תפיסת lease → הבאת שינויים ושמירתם בעמידות → עיבוד
 * התור. שני השלבים מופרדים לחלוטין בכוונה — ראה record_calendar_changes
 * ב-0008 להסבר מדוע עיבוד ישיר היה מאבד שינויים.
 */
export async function runCalendarSync(deps: SyncDeps = defaultDeps()): Promise<SyncRunResult> {
  const owner = randomUUID()
  const stats = emptyStats()

  let calendarId: string
  let fingerprint: string
  try {
    calendarId = getSyncCalendarId()
    fingerprint = calendarFingerprint(calendarId)
  } catch (err) {
    return {
      ok: false, status: 500, error: 'calendar_not_configured',
      message: 'היומן אינו מוגדר בשרת. יש לבדוק את הגדרות המערכת.',
    }
  }

  const claim = await claimSyncRun(owner, fingerprint)
  if (!claim.ok) {
    if (claim.error === 'locked') {
      return {
        ok: false, status: 409, error: 'sync_in_progress',
        message: 'סנכרון כבר מתבצע ברגע זה. נסי שוב בעוד רגע.',
      }
    }
    return {
      ok: false, status: 500, error: 'server_error',
      message: 'לא ניתן להתחיל סנכרון כרגע. נסי שוב.',
    }
  }

  const deadline = deps.now() + RUN_BUDGET_MS

  if (claim.plan.calendarReset) {
    stats.calendarChanged = true
    await recordIssue({
      queueId: null,
      kind: 'calendar_changed',
      status: 'open',
      detail: 'היומן המחובר השתנה. הטוקן הישן בוטל ומתבצע סנכרון מלא מחדש.',
    })
  }

  try {
    await fetchChanges({
      calendarId,
      plan: claim.plan,
      client: deps.client,
      store: dbCursorStore(owner),
      stats,
      deadline,
      now: deps.now,
    })
    await processQueue({ owner, stats, deadline, deps })
    await finishSyncRun({ owner, status: 'success', error: null, stats: toStatsJson(stats) })
    return { ok: true, stats }
  } catch (err) {
    const message = sanitizeGoogleError(err)
    // ⚠️ ה-cursor אינו מאופס כאן. ריצה שנכשלה על תקלה חולפת חייבת להשאיר
    // את page_token ו-base_sync_token כפי שהם, כדי שהריצה הבאה תמשיך
    // מאותה נקודה. איפוס הוא פעולה מפורשת בלבד.
    await finishSyncRun({ owner, status: 'failed', error: message, stats: toStatsJson(stats) })
    return {
      ok: false, status: 502, error: 'sync_failed',
      message: 'הסנכרון נכשל. המצב נשמר וניתן לנסות שוב.',
    }
  }
}

function toStatsJson(stats: SyncStats): Record<string, number | boolean> {
  return { ...stats }
}

// ============================================================================
// שלב א' — הבאת שינויים ושמירתם
//
// הלולאה עצמה נמצאת ב-lib/calendarSyncPager.ts, בלי תלות ב-DB, כדי שניתן
// יהיה לבדוק אותה — ובפרט את אובייקט הבקשה שנשלח ל-Google — ישירות.
// כאן רק החיווט שלה אל ה-RPCs האמיתיים.
// ============================================================================

function dbCursorStore(owner: string): SyncCursorStore {
  return {
    async recordChanges({ changes, nextPageToken, nextSyncToken }) {
      const res = await recordChanges({ owner, changes, nextPageToken, nextSyncToken })
      if (!res.ok) return { ok: false, error: res.error }
      return { ok: true, inserted: res.result.inserted, duplicate: res.result.duplicate }
    },
    async resetCursor(fullReset, reason) {
      const res = await resetSyncCursor(owner, fullReset, reason)
      return { ok: res.ok }
    },
    lookupAppointmentsByEventIds,
  }
}

// ============================================================================
// שלב ב' — עיבוד התור
// ============================================================================

interface ChangeOutcome {
  status: Extract<QueueStatus, 'processed' | 'ignored' | 'failed'>
  result: ChangeResult | null
  error?: string
}

async function processQueue(args: {
  owner: string
  stats: SyncStats
  deadline: number
  deps: SyncDeps
}): Promise<void> {
  const { owner, stats, deadline, deps } = args

  while (deps.now() < deadline) {
    const item = await claimChange(owner)
    if (!item) return

    let outcome: ChangeOutcome
    try {
      outcome = await handleChange(item)
    } catch (err) {
      // ⚠️ כשל באירוע אחד לעולם לא עוצר את השאר.
      outcome = { status: 'failed', result: null, error: sanitizeGoogleError(err) }
    }

    tally(stats, outcome)
    await finishChange({
      queueId: item.id,
      owner,
      status: outcome.status,
      result: outcome.result,
      error: outcome.error ?? null,
    })
  }
  stats.timedOut = true
}

function tally(stats: SyncStats, outcome: ChangeOutcome): void {
  if (outcome.status === 'processed') stats.processed++
  else if (outcome.status === 'ignored') stats.ignored++
  else stats.failed++

  switch (outcome.result) {
    case 'echo':                       stats.echoes++; break
    case 'rescheduled':                stats.rescheduled++; break
    case 'end_corrected':              stats.durationCorrections++; break
    case 'cancelled_by_google_delete': stats.cancelled++; stats.deleted++; break
    case 'already_cancelled':          stats.deleted++; break
    case 'duplicate_event':            stats.duplicates++; break
    case 'reverted_to_db':             stats.reverted++; break
    default: break
  }
}

/**
 * הכלל: **תקלה נפתחת רק על אירוע שעדיין קיים ביומן.**
 *
 * אירוע מחוק הוא "סגור מעצמו" — אין שום פעולה אפשרית ואין שום דבר
 * שמישהי צריכה להחליט עליו.
 *
 * ⚠️ ההבחנה הזו אינה קוסמטית. מחיקת אירוע ב-Google אינה מסירה אותו: היא
 * משאירה אותו לנצח כ-status='cancelled', ו-showDeleted:true (שהוא חובה עם
 * syncToken) מחזיר אותו בכל full sync. ה-full sync הראשון על היומן האמיתי
 * מצא 62 אירועי מערכת — *כולם* מחוקים, וכולם של תורים שכבר אינם קיימים,
 * שאריות של בדיקות שלבים 6–7.
 *
 * לפתוח על כל אחד מהם תקלה במערכת הניהול היה מציף את שובל ב-62 התראות על
 * מצב שכבר תקין לחלוטין — אין אירוע, אין תור, מצב היעד הושג — ובכך לקבור
 * את התקלה האחת שכן דורשת טיפול.
 *
 * מה שעדיין נשמר: השינוי *כן* נרשם ב-calendar_change_queue עם ה-result
 * המדויק שלו. שרשרת הביקורת שלמה; רק ההתראה נחסכת. אירוע *חי* יתום או
 * עמום ממשיך לפתוח תקלה כרגיל — שם באמת יושב ביומן אירוע שמתחזה לתור.
 */
function settled(item: QueueItem): boolean {
  return item.event_status === 'cancelled'
}

/**
 * הטיפול בשינוי בודד. סדר הבדיקות אינו שרירותי — כל שער מוקדם מגן על
 * השערים שאחריו מפני החלטה על בסיס חלקי.
 */
async function handleChange(item: QueueItem): Promise<ChangeOutcome> {
  // ── שער 1: צורת האירוע ────────────────────────────────────────────────
  // אירועי האתר תמיד חד-פעמיים עם dateTime. אירוע מערכת שהפך ידנית לחוזר
  // או ליום שלם אינו מומר אוטומטית ל-appointment ואינו משתנה ב-Google —
  // אין דרך בטוחה לנחש מה הכוונה הייתה.
  if (item.event_shape !== 'timed_single') {
    const kind =
      item.event_shape === 'all_day' ? 'unsupported_all_day_event' as const
      : item.event_shape === 'malformed' ? 'malformed_event' as const
      : 'unsupported_recurring_event' as const
    if (!settled(item)) {
      await recordIssue({
        queueId: item.id, kind, status: 'open',
        googleEventId: item.google_event_id, appointmentId: item.appointment_id,
        detail: `אירוע מערכת בצורה שאינה נתמכת (${item.event_shape}). לא בוצע שינוי במערכת ולא ביומן.`,
      })
    }
    return { status: 'ignored', result: 'unsupported_event_shape' }
  }

  // ── שער 2: בעלות ──────────────────────────────────────────────────────
  // בעלות עמומה אינה מסלול תיקון. אין patch, אין delete, אין revert.
  if (item.ownership === 'ambiguous') {
    if (!settled(item)) {
      await recordIssue({
        queueId: item.id, kind: 'ambiguous_ownership', status: 'open',
        googleEventId: item.google_event_id,
        detail: 'סימני בעלות סותרים או פגומים על אירוע היומן. נדרש טיפול ידני.',
      })
    }
    return { status: 'ignored', result: 'ambiguous_ownership' }
  }

  if (!item.appointment_id) {
    if (!settled(item)) {
      await recordIssue({
        queueId: item.id, kind: 'invalid_appointment_id', status: 'open',
        googleEventId: item.google_event_id,
        detail: 'מזהה התור באירוע היומן אינו תקין.',
      })
    }
    return { status: 'ignored', result: 'invalid_appointment_id' }
  }

  // ── שער 3: טעינת התור ─────────────────────────────────────────────────
  const lookup = await getAppointmentForInboundSync(item.appointment_id)
  if (!lookup.ok) {
    if (lookup.reason === 'db_error') {
      // תקלת DB אינה "אירוע יתום". נשאר ל-retry.
      return { status: 'failed', result: null, error: 'טעינת התור מהמערכת נכשלה' }
    }
    if (!settled(item)) {
      await recordIssue({
        queueId: item.id, kind: 'orphaned_event', status: 'open',
        googleEventId: item.google_event_id, appointmentId: item.appointment_id,
        detail: 'אירוע היומן מצביע על תור שאינו קיים במערכת. לא נוצר תור ולא נוצרה לקוחה.',
      })
    }
    return { status: 'ignored', result: 'orphaned_event' }
  }
  const appt = lookup.appointment

  // ── שער 4: קנוניות ────────────────────────────────────────────────────
  // רק האירוע הקנוני של התור זכאי לתיקון אוטומטי. אירוע שני שמצהיר על
  // אותו תור הוא כפילות — לא נבחר בו, לא מוזז ולא נמחק.
  const canonical = appt.google_event_id ?? deterministicEventId(appt.id)
  if (item.google_event_id !== canonical) {
    if (!settled(item)) {
      await recordIssue({
        queueId: item.id, kind: 'duplicate_event', status: 'open',
        googleEventId: item.google_event_id, appointmentId: appt.id,
        dbStartsAt: appt.starts_at,
        googleStartsAt: item.event_start,
        detail: 'שני אירועים ביומן מצהירים על אותו תור. לא בוצעה שום פעולה אוטומטית.',
      })
    }
    return { status: 'ignored', result: 'duplicate_event' }
  }

  // ── שער 5: מחיקה ──────────────────────────────────────────────────────
  if (item.event_status === 'cancelled') {
    return handleDeletion(item, appt)
  }

  // ── שער 6: אירוע חי ───────────────────────────────────────────────────
  if (!item.event_start || !item.event_end) {
    await recordIssue({
      queueId: item.id, kind: 'malformed_event', status: 'open',
      googleEventId: item.google_event_id, appointmentId: appt.id,
      detail: 'אירוע מערכת ללא שעת התחלה או סיום. לא בוצע שינוי.',
    })
    return { status: 'ignored', result: 'unsupported_event_shape' }
  }

  return handleLiveEvent(item, appt, new Date(item.event_start), new Date(item.event_end))
}

/**
 * מחיקה ידנית של אירוע מערכת = ביטול מצד העסק.
 * כל ההחלטה נמצאת ב-apply_google_cancellation (0008), בטרנזקציה אחת עם
 * ה-SELECT ... FOR UPDATE. כאן רק תרגום התוצאה.
 */
async function handleDeletion(item: QueueItem, appt: AdminAppointmentRow): Promise<ChangeOutcome> {
  const res = await applyGoogleCancellation({
    appointmentId: appt.id,
    googleEventId: item.google_event_id,
    queueId: item.id,
  })

  if (!res.ok) {
    if (res.error === 'not_found') {
      // האירוע מחוק והתור נעלם בין הטעינה לעדכון — שני הצדדים ריקים, אין
      // מה לטפל. נרשם בתור, בלי להתריע. ראה settled().
      return { status: 'ignored', result: 'orphaned_event' }
    }
    return { status: 'failed', result: null, error: 'ביטול התור במערכת נכשל' }
  }

  switch (res.outcome) {
    case 'applied':
      // הסלוט משתחרר מיד; ה-EXCLUDE constraint חל רק על pending/confirmed.
      // אין outbound delete — האירוע כבר נמחק בפועל. אין WhatsApp אוטומטי.
      return { status: 'processed', result: 'cancelled_by_google_delete' }

    case 'already_cancelled':
      // echo של המחיקה שהמערכת עצמה ביצעה, או מחיקה חוזרת. אין history שני.
      return { status: 'processed', result: 'already_cancelled' }

    case 'terminal':
      // מחיקת אירוע היסטורי אינה מוחקת היסטוריה עסקית.
      await recordIssue({
        queueId: item.id, kind: 'deleted_terminal_appointment', status: 'open',
        googleEventId: item.google_event_id, appointmentId: appt.id,
        dbStartsAt: appt.starts_at,
        detail: `אירוע של תור בסטטוס ${appt.status} נמחק מהיומן. הסטטוס נשמר כפי שהוא.`,
      })
      return { status: 'ignored', result: 'terminal_appointment' }

    case 'not_confirmed':
      // בקשה שלא אושרה מעולם לא קיבלה אירוע ביומן.
      return { status: 'ignored', result: 'not_confirmed' }
  }
}

async function handleLiveEvent(
  item: QueueItem,
  appt: AdminAppointmentRow,
  googleStart: Date,
  googleEnd: Date,
): Promise<ChangeOutcome> {
  const dbStart = new Date(appt.starts_at)
  const expectedEnd = new Date(googleStart.getTime() + appt.duration_min * 60 * 1000)
  const endMatches = googleEnd.getTime() === expectedEnd.getTime()
  const startMatches = googleStart.getTime() === dbStart.getTime()

  // ── אירוע ששוחזר אחרי ביטול ───────────────────────────────────────────
  // DB הוא מקור האמת: שחזור מהאשפה אינו מחייה תור. הפעולה הנכונה היא
  // להחזיר את היומן להסכים עם ה-DB — כלומר למחוק שוב.
  if (['cancelled_by_customer', 'cancelled_by_business', 'expired'].includes(appt.status)) {
    await recordIssue({
      queueId: item.id, kind: 'restored_after_cancel', status: 'open',
      googleEventId: item.google_event_id, appointmentId: appt.id,
      dbStartsAt: appt.starts_at, googleStartsAt: item.event_start,
      detail: `אירוע של תור מבוטל (${appt.status}) חזר להופיע ביומן. התור נשאר מבוטל.`,
    })
    try {
      const del = await deleteAppointmentEvent(appt.id, appt.google_event_id)
      if (!del.ok) {
        return { status: 'failed', result: null, error: 'האירוע ביומן אינו נושא את חתימת המערכת — לא נמחק' }
      }
    } catch (err) {
      return { status: 'failed', result: null, error: sanitizeGoogleError(err) }
    }
    await recordIssue({
      queueId: item.id, kind: 'restored_after_cancel', status: 'resolved',
      googleEventId: item.google_event_id, appointmentId: appt.id,
      dbStartsAt: appt.starts_at, googleStartsAt: item.event_start,
      detail: 'האירוע נמחק שוב מהיומן. התור נשאר מבוטל.',
    })
    return { status: 'processed', result: 'restored_event_redeleted' }
  }

  // ── ה-start זהה ───────────────────────────────────────────────────────
  if (startMatches) {
    if (endMatches) {
      // שינוי כותרת/תיאור/צבע/מיקום/משתתפים, או echo של פעולה שלנו.
      // אפס כתיבות בשני הצדדים. הכותרת *אינה* מוחזרת לערכה המקורי.
      return { status: 'processed', result: 'echo' }
    }
    // שובל האריכה או קיצרה את האירוע. זו אינה הזזה: אין history, ו-
    // duration_min נשאר מקור האמת. רק ה-end ביומן חוזר לזמן הקנוני.
    return correctEndOnly(item, appt)
  }

  // ── ה-start שונה: הזזה ────────────────────────────────────────────────
  const res = await applyGoogleReschedule({
    appointmentId: appt.id,
    googleEventId: item.google_event_id,
    newStartsAt: googleStart,
    calendarMatches: endMatches,
    queueId: item.id,
  })

  if (res.ok) {
    if (res.outcome === 'echo') return { status: 'processed', result: 'echo' }

    // ה-DB עודכן. אם גם ה-end ביומן היה שגוי, התור נשאר pending/upsert
    // וה-upsert הרגיל מתקן אותו לזמן הקנוני.
    if (!endMatches) {
      const fixed = await retryCalendarSync(appt.id)
      if (!fixed.ok) {
        // ה-DB נכון; רק תיקון ה-end ביומן נכשל. נשאר ל-retry.
        return { status: 'failed', result: null, error: fixed.message }
      }
    }
    return { status: 'processed', result: 'rescheduled' }
  }

  switch (res.error) {
    case 'sync_in_progress':
      // פעולת סנכרון פעילה על אותו תור — לא נוגעים בו תחתיה.
      return { status: 'failed', result: null, error: 'פעולת סנכרון אחרת פעילה על התור' }

    case 'db_error':
      return { status: 'failed', result: null, error: 'עדכון התור במערכת נכשל' }

    case 'not_found':
      await recordIssue({
        queueId: item.id, kind: 'orphaned_event', status: 'open',
        googleEventId: item.google_event_id, appointmentId: appt.id,
        detail: 'התור נעלם מהמערכת בין הטעינה לעדכון.',
      })
      return { status: 'ignored', result: 'orphaned_event' }

    case 'slot_taken':
      return revertGoogleToDb(item, appt, 'conflict_slot_taken',
        'המועד שנבחר ביומן כבר תפוס על ידי תור אחר במערכת.')

    case 'new_in_past':
      return revertGoogleToDb(item, appt, 'new_start_invalid',
        'המועד שנבחר ביומן כבר עבר.')

    case 'not_confirmed':
      return revertGoogleToDb(item, appt, 'new_start_invalid',
        `לא ניתן להזיז תור בסטטוס ${appt.status}.`)
  }
}

/**
 * תיקון ה-end בלבד.
 *
 * ⚠️ שני שלבים ולא אחד. ensureCalendarSynced מחזירה הצלחה idempotent
 * מיידית כשהתור כבר 'synced' — כלומר בדיוק במצב הרגיל — ואז ה-end השגוי
 * היה נשאר ביומן. mark_calendar_correction_required מחזירה אותו ל-'pending'
 * באופן אטומי, בלי לגעת ב-starts_at, בסטטוס, ב-reschedule_count או
 * ב-original_starts_at, ובלי לכתוב היסטוריה.
 */
async function correctEndOnly(item: QueueItem, appt: AdminAppointmentRow): Promise<ChangeOutcome> {
  const marked = await markCalendarCorrectionRequired(appt.id, item.google_event_id)

  if (!marked.ok) {
    switch (marked.error) {
      case 'sync_in_progress':
        return { status: 'failed', result: null, error: 'פעולת סנכרון אחרת פעילה על התור' }
      case 'db_error':
        return { status: 'failed', result: null, error: 'סימון התיקון במערכת נכשל' }
      case 'not_confirmed':
        // completed/no_show — לא נוגעים באורך של אירוע היסטורי.
        return { status: 'ignored', result: 'not_confirmed' }
      case 'not_canonical':
        await recordIssue({
          queueId: item.id, kind: 'duplicate_event', status: 'open',
          googleEventId: item.google_event_id, appointmentId: appt.id,
          detail: 'האירוע אינו האירוע הקנוני של התור. לא בוצע תיקון.',
        })
        return { status: 'ignored', result: 'duplicate_event' }
      case 'not_found':
        await recordIssue({
          queueId: item.id, kind: 'orphaned_event', status: 'open',
          googleEventId: item.google_event_id, appointmentId: appt.id,
          detail: 'התור נעלם מהמערכת בין הטעינה לעדכון.',
        })
        return { status: 'ignored', result: 'orphaned_event' }
    }
  }

  const fixed = await retryCalendarSync(appt.id)
  if (!fixed.ok) {
    return { status: 'failed', result: null, error: fixed.message }
  }
  return { status: 'processed', result: 'end_corrected' }
}

/**
 * שינוי לא חוקי: ה-DB לא השתנה, ולכן היומן הוא זה שצריך לחזור.
 *
 * ⚠️ מגיעים לכאן *רק* עם בעלות מוכחת ואירוע קנוני (שערים 2 ו-4).
 * updateAppointmentEventTime מאמתת בעלות שוב לפני ה-patch, ולכן אירוע ידני
 * של שובל או אירוע של תור אחר לא ייגע בשום מצב. אף appointment אחר לא
 * משתנה, ואף אירוע לא נמחק כדי לפנות מקום.
 */
async function revertGoogleToDb(
  item: QueueItem,
  appt: AdminAppointmentRow,
  kind: 'conflict_slot_taken' | 'new_start_invalid',
  reason: string,
): Promise<ChangeOutcome> {
  await recordIssue({
    queueId: item.id, kind, status: 'open',
    googleEventId: item.google_event_id, appointmentId: appt.id,
    dbStartsAt: appt.starts_at, googleStartsAt: item.event_start,
    detail: reason,
  })

  const dbStart = new Date(appt.starts_at)
  try {
    const result = await updateAppointmentEventTime({
      appointmentId: appt.id,
      googleEventId: appt.google_event_id,
      customerName: appt.customer_full_name,
      phone: appt.customer_phone_e164,
      treatment: treatmentLabel(appt),
      isoDate: israelDateStr(dbStart),
      startHHMM: fmtIsrael(dbStart),
      durationMin: appt.duration_min,
    })
    if (!result.ok) {
      await recordIssue({
        queueId: item.id, kind: 'revert_failed', status: 'open',
        googleEventId: item.google_event_id, appointmentId: appt.id,
        dbStartsAt: appt.starts_at, googleStartsAt: item.event_start,
        detail: 'האירוע ביומן אינו נושא את חתימת המערכת — לא הוחזר. נדרש טיפול ידני.',
      })
      return { status: 'failed', result: 'revert_failed', error: 'האירוע ביומן אינו של המערכת' }
    }
  } catch (err) {
    await recordIssue({
      queueId: item.id, kind: 'revert_failed', status: 'open',
      googleEventId: item.google_event_id, appointmentId: appt.id,
      dbStartsAt: appt.starts_at, googleStartsAt: item.event_start,
      detail: 'החזרת האירוע ליומן נכשלה. נדרש טיפול ידני.',
    })
    return { status: 'failed', result: 'revert_failed', error: sanitizeGoogleError(err) }
  }

  await recordIssue({
    queueId: item.id, kind, status: 'resolved',
    googleEventId: item.google_event_id, appointmentId: appt.id,
    dbStartsAt: appt.starts_at, googleStartsAt: item.event_start,
    detail: `${reason} האירוע הוחזר למועד שבמערכת.`,
  })
  return { status: 'processed', result: 'reverted_to_db' }
}
