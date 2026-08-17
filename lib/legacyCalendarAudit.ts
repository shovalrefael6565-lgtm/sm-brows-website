import { CALENDAR_EVENT_SOURCE } from './googleCalendar'
import { splitLinesPreservingTerminators, lineContent } from './calendarDescriptionLines'

/**
 * 9C.2 — audit read-only ל-Format A: הנתיב הציבורי הישן (createBookingEvent
 * / POST /api/bookings), חי דרך ה-UI בין 339fa8a (2026-05-17) ל-bc95bd4
 * (2026-08-04 17:33), ונשאר ציבורי ללא caller לגיטימי עד 1bc601d
 * (2026-08-15). לאירועים האלה **אין** extendedProperties ו**אין** שורת
 * DB — אין דרך להוכיח בעלות אוטומטית ברמה מספקת ל-PATCH (ר. 9C.1 סעיף 3
 * וה-runbook). הקובץ הזה סופר candidates בלבד. הוא **לא מכיל ולא מייבא
 * בזמן ריצה** שום קריאת mutate (insert/patch/update/delete) — ר.
 * GoogleCalendarListLike למטה, שחושפת רק list. יש כן `import type` של
 * googleapis (נמחק לגמרי בקומפילציה — אפס טעינה בפועל) לבדיקת התאמה
 * קומפילטיבית מול הגרסה המותקנת.
 *
 * ⚠️ אין כאן שום cutoff תאריכי מבוסס commit. הסריקה (runLegacyAudit) לא
 * שולחת timeMin/timeMax בכלל — כל היומן, עבר ועתיד כאחד.
 */

// ── תבנית Format A ──────────────────────────────────────────────────────
//
// summary:      🌸 <שירות היסטורי ידוע> — <שם>
// description:  📞 טלפון: <ערך>                    (שורה אחת, בלי הערות)
//          או:  📞 טלפון: <ערך>\n📝 הערות: <ערך>   (שתי שורות, עם הערות)
//
// אין extendedProperties בשום אירוע כזה — זה בדיוק מה שהופך זיהוי בעלות
// אוטומטי לבלתי אפשרי (ר. classifyLegacyEvent).

const LEGACY_PHONE_MARKER_RE = /^📞 טלפון: .+$/
const LEGACY_NOTES_MARKER_RE = /^📝 הערות: .+$/

/**
 * שני שמות השירות ההיסטוריים ל-'עיצוב גבות טבעי(ות)' — שונה פעם אחת
 * (commit 21f913f, 2026-06-03) תוך כדי התקופה שבה Format A היה חי
 * דרך ה-UI. שאר שלושת השמות לא השתנו מעולם.
 */
export const LEGACY_KNOWN_SERVICES = [
  'עיצוב גבות טבעי',
  'עיצוב גבות טבעיות',
  'הרמת גבות',
  'קורס מקצועי',
  'מיקרובליידינג',
] as const

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const LEGACY_SUMMARY_RE = new RegExp(
  '^🌸 (' + LEGACY_KNOWN_SERVICES.map(escapeRegExp).join('|') + ') — .+$',
)

function isStrictPhoneOnly(description: string | null | undefined): boolean {
  if (!description) return false
  const lines = splitLinesPreservingTerminators(description)
  return lines.length === 1 && LEGACY_PHONE_MARKER_RE.test(lineContent(lines[0]))
}

function isStrictPhoneAndNotes(description: string | null | undefined): boolean {
  if (!description) return false
  const lines = splitLinesPreservingTerminators(description)
  return (
    lines.length === 2
    && LEGACY_PHONE_MARKER_RE.test(lineContent(lines[0]))
    && LEGACY_NOTES_MARKER_RE.test(lineContent(lines[1]))
  )
}

export type LegacyEventCategory =
  | 'linked_format_b_events'
  | 'strict_candidates'
  | 'strict_candidates_with_notes'
  | 'phone_marker_without_source_but_unknown_shape'
  | 'notes_marker_without_source_but_unknown_shape'
  | 'other_events'

export interface CalendarEventSummary {
  summary: string | null | undefined
  description: string | null | undefined
  extendedPrivateSource: string | undefined
}

/**
 * מסווגת אירוע בודד. סדר הבדיקה הוא סדר עדיפות: source קודם (כבר מכוסה
 * ע"י כלי Format B), אז strict (summary+description תואמים בדיוק לתבנית
 * ההיסטורית — סיכוי גבוה שזה Format A אמיתי), אז מרקר חלקי בלבד (חשוד,
 * לא ודאי), אחרת אין שום סימן.
 *
 * ⚠️ strict אינו הוכחת בעלות — רק סיווג. שום ענף כאן לא גורר PATCH; אין
 * PATCH בקובץ הזה בכלל.
 */
export function classifyLegacyEvent(event: CalendarEventSummary): LegacyEventCategory {
  if (event.extendedPrivateSource === CALENDAR_EVENT_SOURCE) return 'linked_format_b_events'

  const summaryMatches = !!event.summary && LEGACY_SUMMARY_RE.test(event.summary)

  if (summaryMatches && isStrictPhoneOnly(event.description)) return 'strict_candidates'
  if (summaryMatches && isStrictPhoneAndNotes(event.description)) return 'strict_candidates_with_notes'

  const lines = event.description ? splitLinesPreservingTerminators(event.description) : []
  const firstLineHasPhoneMarker = lines.length > 0 && LEGACY_PHONE_MARKER_RE.test(lineContent(lines[0]))
  if (firstLineHasPhoneMarker) return 'phone_marker_without_source_but_unknown_shape'

  const anyLineHasNotesMarker = lines.some(l => LEGACY_NOTES_MARKER_RE.test(lineContent(l)))
  if (anyLineHasNotesMarker) return 'notes_marker_without_source_but_unknown_shape'

  return 'other_events'
}

export interface LegacyAuditCounts {
  events_scanned: number
  pages_fetched: number
  linked_format_b_events: number
  strict_candidates: number
  strict_candidates_with_notes: number
  phone_marker_without_source_but_unknown_shape: number
  notes_marker_without_source_but_unknown_shape: number
  other_events: number
}

export function zeroLegacyAuditCounts(): LegacyAuditCounts {
  return {
    events_scanned: 0,
    pages_fetched: 0,
    linked_format_b_events: 0,
    strict_candidates: 0,
    strict_candidates_with_notes: 0,
    phone_marker_without_source_but_unknown_shape: 0,
    notes_marker_without_source_but_unknown_shape: 0,
    other_events: 0,
  }
}

export interface CalendarListPage {
  events: CalendarEventSummary[]
  nextPageToken: string | null
}

export interface CalendarListClient {
  listEvents(pageToken: string | null): Promise<CalendarListPage>
}

/** תקרת עמודים הגנתית בלבד (מניעת לולאת-אין-סוף בבאג) — לא cutoff תוכני. */
export const AUDIT_MAX_PAGES_SAFETY = 100_000

export async function runLegacyAudit(client: CalendarListClient): Promise<LegacyAuditCounts> {
  const counts = zeroLegacyAuditCounts()
  let pageToken: string | null = null

  for (;;) {
    const page = await client.listEvents(pageToken)
    counts.pages_fetched++
    for (const event of page.events) {
      counts.events_scanned++
      counts[classifyLegacyEvent(event)]++
    }
    if (!page.nextPageToken) break
    if (counts.pages_fetched >= AUDIT_MAX_PAGES_SAFETY) break
    pageToken = page.nextPageToken
  }

  return counts
}

// ════════════════════════════════════════════════════════════════════════════
// מתאם אמיתי — טיפוס מבני בלבד, בלי לייבא googleapis. חושף list בלבד:
// אין get/insert/patch/update/delete בממשק, ולכן שום קוד שמייבא את הקובץ
// הזה לא יכול לגעת ביומן — לא רק לא נוגע, לא יכול בעקרון.
// ════════════════════════════════════════════════════════════════════════════

export interface GoogleCalendarListLike {
  events: {
    list(params: {
      calendarId: string
      showDeleted: boolean
      singleEvents: boolean
      maxResults: number
      pageToken?: string
    }): Promise<{
      data: {
        items?: {
          summary?: string | null
          description?: string | null
          extendedProperties?: { private?: Record<string, string> | null } | null
        }[]
        nextPageToken?: string | null
      }
    }>
  }
}

// ── בדיקת התאמה קומפילטיבית בלבד — לא mock גמיש ──────────────────────────
// import type נמחק לגמרי ע"י tsc/tsx — googleapis לא נטענת בפועל. ר. ההערה
// המקבילה ב-lib/calendarPhoneCleanup.ts לפירוט המלא.
import type { calendar_v3 as GoogleCalendarV3Types } from 'googleapis'
function _assertRealCalendarMatchesGoogleCalendarListLike(real: GoogleCalendarV3Types.Calendar): void {
  if (false as boolean) {
    createGoogleCalendarListClient(real, 'type-check-only')
  }
}
void _assertRealCalendarMatchesGoogleCalendarListLike

export function createGoogleCalendarListClient(
  calendar: GoogleCalendarListLike,
  calendarId: string,
): CalendarListClient {
  return {
    async listEvents(pageToken) {
      const res = await calendar.events.list({
        calendarId,
        showDeleted: false,
        // false בכוונה, בדיוק כמו ערוץ הסנכרון הנכנס (googleCalendarSync.ts):
        // בלי timeMin/timeMax, singleEvents:true היה מרחיב כל אירוע חוזר
        // לכל המופעים שלו — סריקה עצומה. Format A מעולם לא היה חוזר.
        singleEvents: false,
        maxResults: 250,
        ...(pageToken ? { pageToken } : {}),
      })
      const events: CalendarEventSummary[] = (res.data.items ?? []).map(item => ({
        summary: item.summary,
        description: item.description,
        extendedPrivateSource: item.extendedProperties?.private?.source,
      }))
      return { events, nextPageToken: res.data.nextPageToken ?? null }
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CLI — פענוח ארגומנטים טהור. אין --execute בכלי הזה: אם מישהו מעביר
// אותו, זו שגיאה מפורשת ולא התעלמות שקטה.
// ════════════════════════════════════════════════════════════════════════════

export type AuditCliPlan =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'run' }

export function resolveAuditCliPlan(argv: string[]): AuditCliPlan {
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { kind: 'help' }
    if (arg === '--execute') {
      return {
        kind: 'error',
        message: 'כלי זה read-only בלבד — אין מצב execute. שימוש: audit-legacy-calendar-descriptions.mjs [--help]',
      }
    }
    return { kind: 'error', message: `ארגומנט לא מוכר: ${arg}` }
  }
  return { kind: 'run' }
}
