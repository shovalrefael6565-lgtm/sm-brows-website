import {
  type CalendarChangeRecord,
  type CalendarChangesClient,
  type SyncMode,
  buildListChangesParams,
  classifyCursorError,
  classifyEvents,
} from './googleCalendarSync'
import { sanitizeGoogleError } from './googleCalendar'

/**
 * שלב 8 — לולאת ה-pagination של הסנכרון הנכנס.
 *
 * מופרדת מ-lib/calendarInboundSync.ts בכוונה, ובלי 'server-only': כל
 * הכתיבות ל-DB מוזרקות דרך SyncCursorStore, וכך אפשר לבדוק את הלולאה
 * עצמה — ובפרט *את אובייקט הבקשה שנשלח ל-Google* — בלי בסיס נתונים
 * ובלי רשת. הכלל שהקובץ הזה שומר עליו הוא היחיד שאין דרך לתקן בדיעבד:
 * שינוי שהוחמץ כי ה-cursor התקדם מוקדם מדי אבוד לנצח.
 */

export interface RecordChangesArgs {
  changes: CalendarChangeRecord[]
  nextPageToken: string | null
  nextSyncToken: string | null
}

export interface SyncCursorStore {
  /**
   * ⚠️ חייבת לשמור את השינויים *ולקדם את ה-cursor* בטרנזקציה אחת.
   * פיצול לשתי פעולות מחזיר בדיוק את הבאג ששלב 8 קיים כדי למנוע.
   */
  recordChanges(args: RecordChangesArgs): Promise<
    { ok: true; inserted: number; duplicate: number } | { ok: false; error: string }
  >
  resetCursor(fullReset: boolean, reason: string): Promise<{ ok: boolean }>
  /** google_event_id → רשימת appointment ids שמצביעים עליו */
  lookupAppointmentsByEventIds(ids: string[]): Promise<
    { ok: true; map: Map<string, string[]> } | { ok: false }
  >
}

export interface PagerStats {
  eventsRead: number
  manualIgnored: number
  changesPersisted: number
  duplicateVersions: number
  pagesFetched: number
  syncTokenReset: boolean
  pageRestart: boolean
  timedOut: boolean
}

export interface PagerPlan {
  mode: SyncMode
  baseSyncToken: string | null
  pageToken: string | null
}

/** תקרה להתאוששויות cursor בריצה אחת — הגנה מפני לולאת full sync. */
export const MAX_CURSOR_RECOVERIES = 3

export async function fetchChanges(args: {
  calendarId: string
  plan: PagerPlan
  client: CalendarChangesClient
  store: SyncCursorStore
  stats: PagerStats
  deadline: number
  now: () => number
}): Promise<void> {
  const { calendarId, client, store, stats, deadline, now } = args
  let mode = args.plan.mode
  let baseSyncToken = args.plan.baseSyncToken
  let pageToken = args.plan.pageToken
  let recoveries = 0

  for (;;) {
    if (now() > deadline) {
      // ה-cursor של העמוד הקודם כבר נשמר בעמידות. הריצה הבאה תמשיך מכאן
      // בדיוק, ולא תתחיל שוב מהעמוד הראשון.
      stats.timedOut = true
      return
    }

    const params = buildListChangesParams(calendarId, { mode, baseSyncToken, pageToken })
    const sentPageToken = params.pageToken !== undefined

    let page
    try {
      page = await client.listChanges(params)
    } catch (err) {
      const kind = classifyCursorError(err, sentPageToken)

      // ⚠️ transient (429/5xx/רשת) ו-fatal (400 שאינו בעיית cursor) אינם
      // נוגעים ב-cursor בכלל. איפוס כאן היה מאבד את ההתקדמות, או מאלץ
      // סריקה מלאה של כל היומן, בגלל תקלה חולפת.
      if (kind === 'transient' || kind === 'fatal') throw err
      if (++recoveries > MAX_CURSOR_RECOVERIES) throw err

      if (kind === 'page_restart' && mode === 'incremental' && baseSyncToken) {
        // ה-pageToken פסול אבל ה-syncToken של הסדרה עדיין תקף: מתחילים את
        // *אותה סדרה* מהעמוד הראשון. מעבר ל-full sync כאן היה עונש מיותר.
        const reset = await store.resetCursor(false, 'pageToken invalid — restarting the same series')
        if (!reset.ok) throw err
        pageToken = null
        stats.pageRestart = true
        continue
      }

      // 410 / fullSyncRequired, או pageToken פסול בתוך full sync.
      const reset = await store.resetCursor(true, sanitizeGoogleError(err))
      if (!reset.ok) throw err
      mode = 'full'
      baseSyncToken = null
      pageToken = null
      stats.syncTokenReset = true
      continue
    }

    stats.pagesFetched++
    stats.eventsRead += page.events.length

    // ⚠️ כשל ב-lookup הזה *אינו* רשאי לגרום לאירועים להיראות ידניים.
    // אירוע שסווג בטעות כידני נזרק לפני קידום ה-cursor — כלומר אבד.
    const ids = page.events.map(e => e.id).filter((id): id is string => Boolean(id))
    const lookup = await store.lookupAppointmentsByEventIds(ids)
    if (!lookup.ok) {
      throw new Error('appointment ownership lookup failed — cursor left untouched')
    }

    const { records, skippedManual } = classifyEvents(page.events, lookup.map)
    stats.manualIgnored += skippedManual

    const recorded = await store.recordChanges({
      changes: records,
      nextPageToken: page.nextPageToken,
      nextSyncToken: page.nextSyncToken,
    })
    if (!recorded.ok) throw new Error(recorded.error)

    stats.changesPersisted += recorded.inserted
    stats.duplicateVersions += recorded.duplicate

    if (page.nextPageToken) {
      pageToken = page.nextPageToken
      continue
    }
    return
  }
}
