/**
 * 9C.2 — בדיקות ללא DB ובלי רשת לכלי ניקוי הטלפון (Format B) ול-audit
 * הקריאה-בלבד (Format A). כל Google/DB הוא mock; sleep מוזרק כדי שבדיקות
 * retry לא ממתינות בפועל.
 *
 * ⚠️ הקובץ הזה **לא** מריץ את scripts/cleanup-calendar-phone.mjs או
 * scripts/audit-legacy-calendar-descriptions.mjs עצמם — רק את הלוגיקה
 * הטהורה ב-lib/calendarPhoneCleanup.ts ו-lib/legacyCalendarAudit.ts.
 *
 * הרצה:  npm run test:calendar-phone-cleanup
 */

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const {
  classifyDescription,
  isOwnedBySystem,
  runCleanup,
  zeroCounts,
  createSupabaseAppointmentLinkReader,
  createGoogleCalendarEventClient,
  resolveCleanupCliPlan,
  DEPLOYMENT_CONFIRM_VALUE,
  EXECUTE_CONFIRM_VALUE,
} = await import('../lib/calendarPhoneCleanup.ts')

const {
  classifyLegacyEvent,
  runLegacyAudit,
  createGoogleCalendarListClient,
  resolveAuditCliPlan,
} = await import('../lib/legacyCalendarAudit.ts')

// ── בונים תבניות מדויקות מהמחרוזות ההיסטוריות (אותן שמור ב-lib) ──────────
const FOOTER = 'נקבע דרך אתר SM Brows'
const dirtyDescription = (phone, treatment, apptId, eol = '\n') =>
  [`טלפון: ${phone}`, `טיפול: ${treatment}`, `מזהה תור: ${apptId}`, FOOTER].join(eol)
const cleanDescription = (treatment, apptId, eol = '\n') =>
  [`טיפול: ${treatment}`, `מזהה תור: ${apptId}`, FOOTER].join(eol)
const legacyPhoneOnly = phone => `📞 טלפון: ${phone}`
const legacyPhoneAndNotes = (phone, notes) => `📞 טלפון: ${phone}\n📝 הערות: ${notes}`

// ════════════════════════════════════════════════════════════════════════════
section('classifyDescription — dirty → needs_cleanup')
// ════════════════════════════════════════════════════════════════════════════

{
  const dirty = dirtyDescription('+972500000001', 'עיצוב גבות טבעיות', 'aaaa-bbbb', '\n')
  const r = classifyDescription(dirty)
  chk('LF: מסווג needs_cleanup', r.kind === 'needs_cleanup')
  chk('LF: newDescription = בדיוק הצורה הנקייה', r.kind === 'needs_cleanup' && r.newDescription === cleanDescription('עיצוב גבות טבעיות', 'aaaa-bbbb', '\n'))
  chk('LF: newDescription אינו מכיל את שורת הטלפון', r.kind === 'needs_cleanup' && !r.newDescription.includes('טלפון:'))
}

{
  const dirty = dirtyDescription('+972500000002', 'הרמת גבות', 'cccc-dddd', '\r\n')
  const r = classifyDescription(dirty)
  chk('CRLF: מסווג needs_cleanup', r.kind === 'needs_cleanup')
  chk('⚠️ CRLF: שאר השורות משמרות \\r\\n בדיוק — לא מנורמל ל-LF',
    r.kind === 'needs_cleanup' && r.newDescription === cleanDescription('הרמת גבות', 'cccc-dddd', '\r\n'))
  chk('CRLF: אין \\r בודד ללא \\n שהתווסף/הוסר בטעות',
    r.kind === 'needs_cleanup' && !/\r(?!\n)/.test(r.newDescription))
}

// ════════════════════════════════════════════════════════════════════════════
section('classifyDescription — idempotency (הרצה שנייה)')
// ════════════════════════════════════════════════════════════════════════════

{
  const dirtyLf = dirtyDescription('+972500000003', 'קורס מקצועי', 'ffff-1111', '\n')
  const first = classifyDescription(dirtyLf)
  const second = classifyDescription(first.newDescription)
  chk('LF: הרצה שנייה → already_clean (לא unknown_shape)', second.kind === 'already_clean')

  const dirtyCrlf = dirtyDescription('+972500000004', 'מיקרובליידינג', '2222-3333', '\r\n')
  const firstCrlf = classifyDescription(dirtyCrlf)
  const secondCrlf = classifyDescription(firstCrlf.newDescription)
  chk('CRLF: הרצה שנייה → already_clean', secondCrlf.kind === 'already_clean')

  const thirdRun = classifyDescription(cleanDescription('קורס מקצועי', 'ffff-1111', '\n'))
  chk('בדיקה ישירה על צורה נקייה ידנית → already_clean', thirdRun.kind === 'already_clean')
}

// ════════════════════════════════════════════════════════════════════════════
section('classifyDescription — no_description / unknown_shape')
// ════════════════════════════════════════════════════════════════════════════

chk('undefined → no_description', classifyDescription(undefined).kind === 'no_description')
chk('null → no_description', classifyDescription(null).kind === 'no_description')
chk('מחרוזת ריקה → no_description', classifyDescription('').kind === 'no_description')

{
  const extraLine = dirtyDescription('+972500000005', 'הרמת גבות', 'aaaa-1111') + '\nהערה שהוספתי ידנית'
  chk('שורה 5 נוספת (עריכה ידנית) → unknown_shape', classifyDescription(extraLine).kind === 'unknown_shape')
}
{
  const reordered = ['טיפול: הרמת גבות', 'טלפון: +972500000006', 'מזהה תור: x', FOOTER].join('\n')
  chk('סדר שורות שונה → unknown_shape', classifyDescription(reordered).kind === 'unknown_shape')
}
{
  const twoLines = ['טלפון: +972500000007', 'טיפול: הרמת גבות'].join('\n')
  chk('רק 2 שורות (לא 3 ולא 4) → unknown_shape', classifyDescription(twoLines).kind === 'unknown_shape')
}
{
  chk('Format A (📞 שורה אחת) בכלי B → unknown_shape, לא needs_cleanup',
    classifyDescription(legacyPhoneOnly('+972500000008')).kind === 'unknown_shape')
  chk('Format A (📞+📝 שתי שורות) בכלי B → unknown_shape',
    classifyDescription(legacyPhoneAndNotes('+972500000009', 'משהו')).kind === 'unknown_shape')
}

// ════════════════════════════════════════════════════════════════════════════
section('classifyDescription — Unicode ומספרים חופשיים נשמרים, אין regex רחב')
// ════════════════════════════════════════════════════════════════════════════

{
  // מספר "חופשי" בתוך מזהה התור עצמו — לא שורת טלפון, לא אמור להימחק.
  const dirty = dirtyDescription('+972500000010', 'עיצוב גבות טבעיות 🌸', '050-1234567-not-a-phone-line')
  const r = classifyDescription(dirty)
  chk('ערך עם אמוג\'י/Unicode בטיפול נשמר בדיוק', r.kind === 'needs_cleanup' && r.newDescription.includes('עיצוב גבות טבעיות 🌸'))
  chk('מספר חופשי בתוך מזהה תור (לא שורת טלפון) נשמר בדיוק', r.kind === 'needs_cleanup' && r.newDescription.includes('050-1234567-not-a-phone-line'))
}
{
  // "טלפון: " מופיע בתוך שורה 3 (לא במיקום 1) — לא אמור לגרום להסרה.
  const weird = ['טלפון: +972500000011', 'טיפול: הרמת גבות', 'מזהה תור: מכיל טלפון: 050 בטעות', FOOTER].join('\n')
  chk('⚠️ "טלפון:" שמופיע לא בשורה 1 לא הופך צורה תקינה ל-unknown_shape כשהמבנה עדיין תואם',
    classifyDescription(weird).kind === 'needs_cleanup')
  const r2 = classifyDescription(weird)
  chk('...והתוכן עם "טלפון:" בפנים נשמר, לא נמחק', r2.kind === 'needs_cleanup' && r2.newDescription.includes('מכיל טלפון: 050 בטעות'))
}

// ════════════════════════════════════════════════════════════════════════════
section('isOwnedBySystem')
// ════════════════════════════════════════════════════════════════════════════

chk('source+id תואמים → true', isOwnedBySystem({ source: 'sm_brows_website', appointment_id: 'A1' }, 'A1') === true)
chk('source שגוי → false', isOwnedBySystem({ source: 'other', appointment_id: 'A1' }, 'A1') === false)
chk('appointment_id שגוי → false', isOwnedBySystem({ source: 'sm_brows_website', appointment_id: 'A2' }, 'A1') === false)
chk('extendedPrivate ריק/undefined → false', isOwnedBySystem(undefined, 'A1') === false && isOwnedBySystem(null, 'A1') === false)

// ════════════════════════════════════════════════════════════════════════════
section('runCleanup — dry-run לעולם לא PATCH')
// ════════════════════════════════════════════════════════════════════════════

function makeReader(rowsByPage) {
  let calls = 0
  return {
    calls: () => calls,
    async listLinkedAppointments() {
      calls++
      return rowsByPage.shift() ?? []
    },
  }
}

const NO_SLEEP = async () => {}
function countingSleep() {
  const calls = []
  const fn = async ms => { calls.push(ms) }
  fn.calls = calls
  return fn
}

{
  const reader = makeReader([[{ id: 'appt-1', google_event_id: 'evt-1' }], []])
  const calendar = {
    async getEvent() {
      return {
        etag: 'W/"etag-1"',
        description: dirtyDescription('+972500000012', 'הרמת גבות', 'appt-1'),
        ownerSource: 'sm_brows_website',
        ownerAppointmentId: 'appt-1',
      }
    },
    async patchDescription() {
      throw new Error('dry-run must never call patchDescription')
    },
  }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'dry_run' })
  chk('dry-run: completed', outcome.kind === 'completed')
  chk('dry-run: would_patch=1, patched=0', outcome.counts.would_patch === 1 && outcome.counts.patched === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('runCleanup — execute: PATCH רק על needs_cleanup, עם etag')
// ════════════════════════════════════════════════════════════════════════════

{
  const patchCalls = []
  const reader = makeReader([[
    { id: 'appt-clean', google_event_id: 'evt-clean' },
    { id: 'appt-dirty', google_event_id: 'evt-dirty' },
    { id: 'appt-not-ours', google_event_id: 'evt-not-ours' },
  ], []])
  const events = {
    'evt-clean': {
      etag: 'W/"e1"',
      description: cleanDescription('הרמת גבות', 'appt-clean'),
      ownerSource: 'sm_brows_website',
      ownerAppointmentId: 'appt-clean',
    },
    'evt-dirty': {
      etag: 'W/"e2"',
      description: dirtyDescription('+972500000013', 'קורס מקצועי', 'appt-dirty'),
      ownerSource: 'sm_brows_website',
      ownerAppointmentId: 'appt-dirty',
    },
    'evt-not-ours': {
      etag: 'W/"e3"',
      description: 'תיאור ידני של שובל, לא קשור למערכת',
      ownerSource: undefined,
      ownerAppointmentId: undefined,
    },
  }
  const calendar = {
    async getEvent(eventId) { return events[eventId] },
    async patchDescription(eventId, description, etag) { patchCalls.push({ eventId, description, etag }) },
  }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'execute' })
  chk('execute: completed', outcome.kind === 'completed')
  chk('execute: already_clean=1, patched=1, not_ours=1', outcome.counts.already_clean === 1 && outcome.counts.patched === 1 && outcome.counts.not_ours === 1)
  chk('PATCH נקרא פעם אחת בלבד', patchCalls.length === 1)
  chk('PATCH על evt-dirty בלבד', patchCalls[0]?.eventId === 'evt-dirty')
  chk('PATCH מעביר etag שהתקבל מה-GET', patchCalls[0]?.etag === 'W/"e2"')
  chk('PATCH מעביר בדיוק את הצורה הנקייה, לא יותר', patchCalls[0]?.description === cleanDescription('קורס מקצועי', 'appt-dirty'))
}

// ════════════════════════════════════════════════════════════════════════════
section('runCleanup — missing etag, 404/410, 412, 401/403, 429/5xx')
// ════════════════════════════════════════════════════════════════════════════

function httpError(status) {
  const e = new Error(`http ${status}`)
  e.code = status
  return e
}

{
  // etag חסר — skip נפרד, אין PATCH
  const reader = makeReader([[{ id: 'a1', google_event_id: 'e1' }], []])
  let patchCalled = false
  const calendar = {
    async getEvent() {
      return { etag: null, description: dirtyDescription('+972500000014', 'הרמת גבות', 'a1'), ownerSource: 'sm_brows_website', ownerAppointmentId: 'a1' }
    },
    async patchDescription() { patchCalled = true },
  }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'execute' })
  chk('etag חסר → missing_etag=1, אין PATCH', outcome.counts.missing_etag === 1 && !patchCalled)
}

{
  // 404/410 → not_found_or_gone, לא כישלון
  const reader = makeReader([[{ id: 'a1', google_event_id: 'e1' }, { id: 'a2', google_event_id: 'e2' }], []])
  const calendar = {
    async getEvent(eventId) { throw httpError(eventId === 'e1' ? 404 : 410) },
    async patchDescription() {},
  }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'dry_run' })
  chk('404 ו-410 → not_found_or_gone=2, completed (לא aborted)', outcome.counts.not_found_or_gone === 2 && outcome.kind === 'completed')
}

for (const status of [401, 403]) {
  const reader = makeReader([[{ id: 'a1', google_event_id: 'e1' }], []])
  const calendar = { async getEvent() { throw httpError(status) }, async patchDescription() {} }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'dry_run' })
  chk(`GET ${status} → aborted_auth_error מיידי`, outcome.kind === 'aborted_auth_error')
}

{
  // 412 על PATCH → etag_conflict, אין retry (patch נקרא פעם אחת בלבד)
  const reader = makeReader([[{ id: 'a1', google_event_id: 'e1' }], []])
  let patchAttempts = 0
  const calendar = {
    async getEvent() {
      return { etag: 'W/"x"', description: dirtyDescription('+972500000015', 'הרמת גבות', 'a1'), ownerSource: 'sm_brows_website', ownerAppointmentId: 'a1' }
    },
    async patchDescription() { patchAttempts++; throw httpError(412) },
  }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'execute' })
  chk('412 → etag_conflict=1', outcome.counts.etag_conflict === 1)
  chk('412 → אין retry (ניסיון PATCH יחיד)', patchAttempts === 1)
}

{
  // 401/403 על PATCH → aborted
  const reader = makeReader([[{ id: 'a1', google_event_id: 'e1' }], []])
  const calendar = {
    async getEvent() {
      return { etag: 'W/"x"', description: dirtyDescription('+972500000016', 'הרמת גבות', 'a1'), ownerSource: 'sm_brows_website', ownerAppointmentId: 'a1' }
    },
    async patchDescription() { throw httpError(403) },
  }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'execute' })
  chk('PATCH 403 → aborted_auth_error', outcome.kind === 'aborted_auth_error')
}

// ════════════════════════════════════════════════════════════════════════════
section('runCleanup — 429/5xx: retry עם backoff מוזרק, בלי המתנה אמיתית')
// ════════════════════════════════════════════════════════════════════════════

{
  const reader = makeReader([[{ id: 'a1', google_event_id: 'e1' }], []])
  const sleep = countingSleep()
  let getAttempts = 0
  const calendar = {
    async getEvent() { getAttempts++; throw httpError(503) },
    async patchDescription() {},
  }
  const startedAt = Date.now()
  const outcome = await runCleanup({ reader, calendar, sleep, batchSize: 10, mode: 'dry_run', maxRetries: 3 })
  const elapsedMs = Date.now() - startedAt
  chk('503 עקבי → transient_failure=1 אחרי מיצוי retries', outcome.counts.transient_failure === 1)
  chk('ניסיונות GET = maxRetries+1', getAttempts === 4)
  chk('sleep הוזרק ונקרא (backoff), לא setTimeout אמיתי', sleep.calls.length === 3)
  chk('⚠️ אין המתנה אמיתית — חלף פחות מ-200ms על 3 "backoffs"', elapsedMs < 200, `elapsed=${elapsedMs}ms`)
}

{
  // הצלחה אחרי כמה כשלונות חולפים — לא כל retry מסתיים בכישלון
  const reader = makeReader([[{ id: 'a1', google_event_id: 'e1' }], []])
  const sleep = countingSleep()
  let attempts = 0
  const calendar = {
    async getEvent() {
      attempts++
      if (attempts < 3) throw httpError(429)
      return { etag: 'W/"x"', description: cleanDescription('הרמת גבות', 'a1'), ownerSource: 'sm_brows_website', ownerAppointmentId: 'a1' }
    },
    async patchDescription() {},
  }
  const outcome = await runCleanup({ reader, calendar, sleep, batchSize: 10, mode: 'dry_run' })
  chk('429 פעמיים ואז הצלחה → already_clean=1, לא transient_failure', outcome.counts.already_clean === 1 && outcome.counts.transient_failure === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('runCleanup — pagination: cursor פנימי בלבד, לא מודפס')
// ════════════════════════════════════════════════════════════════════════════

{
  const rowsByPage = [
    [{ id: 'zzzz-1111-secret-id-a', google_event_id: 'evt-a' }],
    [{ id: 'zzzz-2222-secret-id-b', google_event_id: 'evt-b' }],
    [],
  ]
  const seenAfterIds = []
  const reader = {
    async listLinkedAppointments(afterId) {
      seenAfterIds.push(afterId)
      return rowsByPage.shift() ?? []
    },
  }
  const calendar = {
    async getEvent() { return { etag: 'W/"x"', description: null, ownerSource: undefined, ownerAppointmentId: undefined } },
    async patchDescription() {},
  }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 1, mode: 'dry_run' })
  chk('שני עמודים נסרקו (2 שורות scanned)', outcome.counts.scanned === 2)
  chk('cursor התקדם בין עמודים (afterId שני != null)', seenAfterIds[0] === null && seenAfterIds[1] === 'zzzz-1111-secret-id-a')
  const dump = JSON.stringify(outcome)
  chk('⚠️ שום UUID/event-id מהשורות לא מופיע בפלט (RunCounts)', !dump.includes('zzzz-1111-secret-id-a') && !dump.includes('zzzz-2222-secret-id-b') && !dump.includes('evt-a') && !dump.includes('evt-b'))
}

{
  const allowed = new Set(Object.keys(zeroCounts()))
  chk('RunCounts מכיל אך ורק שדות ספירה מוכרים (allow-list)',
    [...allowed].every(k => /^[a-z_]+$/.test(k)) && allowed.size === 11)
}

// ════════════════════════════════════════════════════════════════════════════
section('מתאמים — DB select-only')
// ════════════════════════════════════════════════════════════════════════════

{
  const FORBIDDEN = ['insert', 'update', 'delete', 'upsert', 'rpc']
  function guardedTable(rows) {
    const state = { limitCalled: false }
    const builder = {
      select() { return builder },
      not() { return builder },
      order() { return builder },
      gt() { return builder },
      async limit() { state.limitCalled = true; return { data: rows, error: null } },
    }
    return new Proxy(builder, {
      get(target, prop) {
        if (FORBIDDEN.includes(prop)) {
          throw new Error(`select-only violation: ${String(prop)} touched`)
        }
        return target[prop]
      },
    })
  }
  const rows = [{ id: 'a1', google_event_id: 'e1' }]
  let fromTable = null
  const db = {
    from(table) {
      fromTable = table
      return guardedTable(rows)
    },
  }
  const reader = createSupabaseAppointmentLinkReader(db)
  const result = await reader.listLinkedAppointments(null, 100)
  chk('select-only client: אין throw, insert/update/delete/upsert/rpc לא נגעו', result.length === 1)
  chk('שולף מטבלת appointments', fromTable === 'appointments')

  // ⚠️ הוכחה חיובית: ניגיעה ישירה ב-insert/update/delete/upsert/rpc *כן* זורקת
  const proxied = guardedTable(rows)
  let threw = false
  try { void proxied.insert }
  catch { threw = true }
  chk('⚠️ ה-guard עצמו תקין: גישה ל-insert על אותו builder זורקת', threw)
}

{
  // שגיאת DB לא חושפת raw message — רק code
  const db = {
    from() {
      return {
        select() { return this },
        not() { return this },
        order() { return this },
        gt() { return this },
        async limit() { return { data: null, error: { code: 'PGRST000' } } },
      }
    },
  }
  const reader = createSupabaseAppointmentLinkReader(db)
  let caught = null
  try { await reader.listLinkedAppointments(null, 100) }
  catch (e) { caught = e }
  chk('שגיאת DB נזרקת עם code בלבד', caught?.code === 'PGRST000')
}

// ════════════════════════════════════════════════════════════════════════════
section('מתאמים — PATCH מכיל description בלבד + If-Match')
// ════════════════════════════════════════════════════════════════════════════

{
  let capturedParams = null
  let capturedOptions = null
  const calendarLike = {
    events: {
      async get() {
        return {
          data: {
            etag: 'W/"real-etag"',
            description: 'x',
            summary: 'should not leak',
            start: { dateTime: '2026-01-01T10:00:00Z' },
            end: { dateTime: '2026-01-01T10:20:00Z' },
            extendedProperties: { private: { source: 'sm_brows_website', appointment_id: 'A1' } },
          },
        }
      },
      async patch(params, options) {
        capturedParams = params
        capturedOptions = options
        return {}
      },
    },
  }
  const client = createGoogleCalendarEventClient(calendarLike, 'cal-1')
  const snapshot = await client.getEvent('evt-1')
  chk('getEvent: snapshot חושף רק etag/description/ownerSource/ownerAppointmentId',
    Object.keys(snapshot).sort().join(',') === 'description,etag,ownerAppointmentId,ownerSource')
  chk('getEvent: summary/start/end לא דלפו ל-snapshot', !('summary' in snapshot) && !('start' in snapshot))

  await client.patchDescription('evt-1', 'הטקסט הנקי', 'W/"real-etag"')
  chk('PATCH: calendarId+eventId נכונים', capturedParams.calendarId === 'cal-1' && capturedParams.eventId === 'evt-1')
  chk('PATCH: requestBody מכיל אך ורק description', Object.keys(capturedParams.requestBody).join(',') === 'description' && capturedParams.requestBody.description === 'הטקסט הנקי')
  chk('⚠️ PATCH: אין summary/start/end/location/attendees/reminders/status/extendedProperties ב-params', Object.keys(capturedParams).sort().join(',') === 'calendarId,eventId,requestBody')
  chk('PATCH: If-Match מועבר עם ה-etag שהתקבל מה-GET', capturedOptions.headers['If-Match'] === 'W/"real-etag"')
}

// ════════════════════════════════════════════════════════════════════════════
section('resolveCleanupCliPlan — שערי אישור, לפני env/רשת')
// ════════════════════════════════════════════════════════════════════════════

chk('--help → help, גם עם ארגומנטים אחרים אחריו', resolveCleanupCliPlan(['--help', '--execute']).kind === 'help')
chk('בלי שום דגל → error (חסר deployment-confirm)', resolveCleanupCliPlan([]).kind === 'error')
chk('deployment-confirm שגוי → error', resolveCleanupCliPlan(['--deployment-confirm=WRONG']).kind === 'error')
chk('deployment-confirm תקין, בלי execute → run dry_run', (() => {
  const p = resolveCleanupCliPlan([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`])
  return p.kind === 'run' && p.mode === 'dry_run' && p.batchSize === 100
})())
chk('--execute בלי --confirm (גם עם deployment-confirm תקין) → error, לא run',
  resolveCleanupCliPlan([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`, '--execute']).kind === 'error')
chk('--execute עם confirm שגוי → error',
  resolveCleanupCliPlan([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`, '--execute', '--confirm=NOPE']).kind === 'error')
chk('שני האישורים תקינים → run execute', (() => {
  const p = resolveCleanupCliPlan([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`, '--execute', `--confirm=${EXECUTE_CONFIRM_VALUE}`])
  return p.kind === 'run' && p.mode === 'execute'
})())

for (const bad of ['0', '501', '1.5', 'abc', '-1']) {
  const p = resolveCleanupCliPlan([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`, `--batch-size=${bad}`])
  chk(`batch-size=${bad} מחוץ לטווח 1–500 → error`, p.kind === 'error')
}
chk('batch-size=500 (קצה עליון) תקין', resolveCleanupCliPlan([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`, '--batch-size=500']).kind === 'run')
chk('batch-size=1 (קצה תחתון) תקין', resolveCleanupCliPlan([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`, '--batch-size=1']).kind === 'run')

{
  // הוכחת טוהר: אין שום תלות ב-process.env — אותה תוצאה גם כשמנקים את
  // כל המשתנים הרלוונטיים לפני הקריאה.
  const saved = {
    a: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64,
    b: process.env.GOOGLE_CALENDAR_ID,
    c: process.env.NEXT_PUBLIC_SUPABASE_URL,
    d: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
  delete process.env.GOOGLE_CALENDAR_ID
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  const p1 = resolveCleanupCliPlan(['--help'])
  const p2 = resolveCleanupCliPlan([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`])
  chk('⚠️ --help לא מושפע מהיעדר env', p1.kind === 'help')
  chk('⚠️ פענוח דגלים תקין לא מושפע מהיעדר env — טהור לגמרי', p2.kind === 'run')
  if (saved.a !== undefined) process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 = saved.a
  if (saved.b !== undefined) process.env.GOOGLE_CALENDAR_ID = saved.b
  if (saved.c !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.c
  if (saved.d !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.d
}

// ════════════════════════════════════════════════════════════════════════════
section('Format A — classifyLegacyEvent')
// ════════════════════════════════════════════════════════════════════════════

chk('source תואם → linked_format_b_events, גם עם description מוזר',
  classifyLegacyEvent({ summary: 'משהו', description: 'כל דבר', extendedPrivateSource: 'sm_brows_website' }) === 'linked_format_b_events')

chk('summary+description תואמים בדיוק (טלפון בלבד) → strict_candidates',
  classifyLegacyEvent({
    summary: '🌸 עיצוב גבות טבעיות — ישראלה ישראלי',
    description: legacyPhoneOnly('+972500000020'),
    extendedPrivateSource: undefined,
  }) === 'strict_candidates')

chk('summary+description תואמים בדיוק (שם שירות מהעידן הישן) → strict_candidates',
  classifyLegacyEvent({
    summary: '🌸 עיצוב גבות טבעי — ישראלה',
    description: legacyPhoneOnly('+972500000021'),
    extendedPrivateSource: undefined,
  }) === 'strict_candidates')

chk('summary+description תואמים בדיוק (טלפון+הערות) → strict_candidates_with_notes',
  classifyLegacyEvent({
    summary: '🌸 הרמת גבות — לקוחה',
    description: legacyPhoneAndNotes('+972500000022', 'הערה חופשית כלשהי'),
    extendedPrivateSource: undefined,
  }) === 'strict_candidates_with_notes')

chk('שורה ראשונה עם מרקר טלפון אבל summary לא תואם → phone_marker_without_source_but_unknown_shape',
  classifyLegacyEvent({
    summary: 'אירוע ידני של שובל',
    description: legacyPhoneOnly('+972500000023'),
    extendedPrivateSource: undefined,
  }) === 'phone_marker_without_source_but_unknown_shape')

chk('שורה ראשונה עם מרקר טלפון אבל שירות לא מוכר → phone_marker_without_source_but_unknown_shape',
  classifyLegacyEvent({
    summary: '🌸 טיפול לא קיים — לקוחה',
    description: legacyPhoneOnly('+972500000024'),
    extendedPrivateSource: undefined,
  }) === 'phone_marker_without_source_but_unknown_shape')

chk('מרקר הערות בלי טלפון בשורה 1, summary לא תואם → notes_marker_without_source_but_unknown_shape',
  classifyLegacyEvent({
    summary: 'משהו',
    description: '📝 הערות: משהו חופשי',
    extendedPrivateSource: undefined,
  }) === 'notes_marker_without_source_but_unknown_shape')

chk('אין שום מרקר → other_events',
  classifyLegacyEvent({ summary: 'פגישה עם רואה חשבון', description: 'שיחה על מסים', extendedPrivateSource: undefined }) === 'other_events')

chk('אין description כלל → other_events',
  classifyLegacyEvent({ summary: 'משהו', description: undefined, extendedPrivateSource: undefined }) === 'other_events')

// ════════════════════════════════════════════════════════════════════════════
section('Format A — runLegacyAudit: pagination, counts, אין PII')
// ════════════════════════════════════════════════════════════════════════════

{
  const pages = [
    { events: [
      { summary: '🌸 עיצוב גבות טבעיות — א', description: legacyPhoneOnly('050-0000001'), extendedPrivateSource: undefined },
      { summary: '🌸 הרמת גבות — ב', description: legacyPhoneAndNotes('050-0000002', 'משהו'), extendedPrivateSource: undefined },
      { summary: 'X', description: 'Y', extendedPrivateSource: 'sm_brows_website' },
    ], nextPageToken: 'page2' },
    { events: [
      { summary: 'ידני', description: 'שיחת ייעוץ', extendedPrivateSource: undefined },
    ], nextPageToken: null },
  ]
  let pageTokensSeen = []
  const client = {
    async listEvents(pageToken) {
      pageTokensSeen.push(pageToken)
      return pages.shift()
    },
  }
  const counts = await runLegacyAudit(client)
  chk('events_scanned=4, pages_fetched=2', counts.events_scanned === 4 && counts.pages_fetched === 2)
  chk('strict_candidates=1, strict_candidates_with_notes=1, linked_format_b_events=1, other_events=1',
    counts.strict_candidates === 1 && counts.strict_candidates_with_notes === 1
    && counts.linked_format_b_events === 1 && counts.other_events === 1)
  chk('pagination עובר עמוד → עמוד עם ה-pageToken הנכון', pageTokensSeen[0] === null && pageTokensSeen[1] === 'page2')
  const dump = JSON.stringify(counts)
  chk('⚠️ אין phone/description/summary בפלט ה-counts (רק שמות ספירה ומספרים)',
    !dump.includes('050-0000001') && !dump.includes('משהו') && !dump.includes('עיצוב גבות'))
}

// ════════════════════════════════════════════════════════════════════════════
section('Format A — מתאם: list-only, showDeleted:false, אין timeMin/timeMax')
// ════════════════════════════════════════════════════════════════════════════

{
  let capturedParams = null
  const calendarLike = {
    events: {
      async list(params) {
        capturedParams = params
        return { data: { items: [{ summary: 'א', description: 'ב' }], nextPageToken: null } }
      },
      // ⚠️ בכוונה אין get/patch/insert/update/delete על האובייקט הזה —
      // אם המתאם ינסה לקרוא להם, זה יזרוק (undefined is not a function).
    },
  }
  const client = createGoogleCalendarListClient(calendarLike, 'cal-1')
  const page = await client.listEvents(null)
  chk('list-only client עובד בלי get/patch מוגדרים כלל', page.events.length === 1)
  chk('showDeleted: false נשלח', capturedParams.showDeleted === false)
  chk('⚠️ אין timeMin/timeMax בבקשה — כל היומן, כולל עתיד', !('timeMin' in capturedParams) && !('timeMax' in capturedParams))
  chk('calendarId נכון', capturedParams.calendarId === 'cal-1')
}

{
  // הוכחה חיובית: קריאה ל-get/patch על lib/legacyCalendarAudit.ts בכלל
  // לא אפשרית — אין להם ממשק. בודקים שהאובייקט המזויף שהמתאם מקבל לא
  // חייב לחשוף שום דבר מעבר ל-events.list.
  const onlyList = { events: { async list() { return { data: { items: [], nextPageToken: null } } } } }
  const client = createGoogleCalendarListClient(onlyList, 'cal-1')
  chk('⚠️ המתאם לא ניגש בכלל ל-get/patch/insert/update/delete', typeof (await client.listEvents(null)) === 'object')
}

// ════════════════════════════════════════════════════════════════════════════
section('resolveAuditCliPlan')
// ════════════════════════════════════════════════════════════════════════════

chk('--help → help', resolveAuditCliPlan(['--help']).kind === 'help')
chk('בלי ארגומנטים → run', resolveAuditCliPlan([]).kind === 'run')
chk('⚠️ --execute נדחה במפורש (אין מצב כזה לכלי הזה)', resolveAuditCliPlan(['--execute']).kind === 'error')
chk('ארגומנט לא מוכר → error', resolveAuditCliPlan(['--foo']).kind === 'error')

// ════════════════════════════════════════════════════════════════════════════
section('9C.2.1 — כלים תומכים')
// ════════════════════════════════════════════════════════════════════════════

/** תופס console.log/console.error זמנית. משחזר תמיד, גם בכישלון. */
async function captureConsole(fn) {
  const logLines = []
  const errLines = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...args) => logLines.push(args.join(' '))
  console.error = (...args) => errLines.push(args.join(' '))
  try {
    const returned = await fn()
    return { logLines, errLines, returned }
  } finally {
    console.log = origLog
    console.error = origErr
  }
}

const FAKE_POISON = {
  phone: '+972501234567',
  uuid: '11111111-2222-3333-4444-555555555555',
  eventId: 'smbappt1111222233334444555555555555',
  url: 'https://www.googleapis.com/calendar/v3/calendars/leak-calendar-id-abc%40group.calendar.google.com/events/evt1',
  secret: 'sk_live_FAKESECRETVALUE_should_never_appear',
  stackLike: 'at Object.<anonymous> (/Users/someone/secret-path/file.ts:42:13)',
}

function poisonError(status, extra = {}) {
  const e = new Error(
    `poisoned message: phone=${FAKE_POISON.phone} uuid=${FAKE_POISON.uuid} event=${FAKE_POISON.eventId} `
    + `url=${FAKE_POISON.url} secret=${FAKE_POISON.secret}`,
  )
  e.code = status
  e.stack = `Error: poisoned\n    ${FAKE_POISON.stackLike}`
  e.config = { url: FAKE_POISON.url, headers: { Authorization: `Bearer ${FAKE_POISON.secret}` } }
  e.response = { status, config: { url: FAKE_POISON.url }, data: { error: FAKE_POISON.secret } }
  Object.assign(e, extra)
  return e
}

function assertNoPoison(haystack, label) {
  for (const [name, value] of Object.entries(FAKE_POISON)) {
    chk(`${label}: אין דליפת ${name}`, !haystack.includes(value))
  }
}

// ── import לא מפעיל main() כתופעת לוואי ──────────────────────────────────

{
  const origExit = process.exit
  let exitCalled = false
  process.exit = () => { exitCalled = true }
  const captured = await captureConsole(async () => {
    await import('./cleanup-calendar-phone.mjs')
    await import('./audit-legacy-calendar-descriptions.mjs')
  })
  process.exit = origExit
  chk('⚠️ ייבוא שני קובצי ה-CLI לא קרא ל-process.exit', !exitCalled)
  chk('⚠️ ייבוא שני קובצי ה-CLI לא הדפיס שום דבר ל-stdout/stderr',
    captured.logLines.length === 0 && captured.errLines.length === 0)
}

// ── main() — סדר אתחול, דרך הפונקציה האמיתית שה-CLI מריץ ────────────────

{
  const { main: cleanupMain } = await import('./cleanup-calendar-phone.mjs')
  const { main: auditMain } = await import('./audit-legacy-calendar-descriptions.mjs')

  const NONEXISTENT_ENV = new URL('./__no-such-env-file-9c2-1__.local', import.meta.url)

  {
    const r = await captureConsole(() => cleanupMain(['--help'], NONEXISTENT_ENV))
    chk('cleanup main(): --help → 0, לא נגע ב-env (קובץ לא קיים ולא נכשל עליו)', r.returned === 0)
    chk('cleanup main(): --help לא ניסה לקרוא env בכלל', !r.errLines.some(l => l.includes('.env.local')))
  }
  {
    const r = await captureConsole(() => auditMain(['--help'], NONEXISTENT_ENV))
    chk('audit main(): --help → 0, לא נגע ב-env', r.returned === 0)
  }
  {
    const r = await captureConsole(() => cleanupMain([], NONEXISTENT_ENV))
    chk('cleanup main(): בלי flags → 1 (חסר deployment-confirm), לפני env', r.returned === 1)
    chk('...וההודעה לא מזכירה .env.local (לא הגיע לשם)', !r.errLines.some(l => l.includes('.env.local')))
  }
  {
    const r = await captureConsole(() => cleanupMain(
      [`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`, '--execute'], NONEXISTENT_ENV,
    ))
    chk('cleanup main(): --execute בלי --confirm → 1, לפני env', r.returned === 1)
    chk('...וההודעה לא מזכירה .env.local', !r.errLines.some(l => l.includes('.env.local')))
  }
  {
    const r = await captureConsole(() => auditMain(['--execute'], NONEXISTENT_ENV))
    chk('audit main(): --execute → 1 (נדחה), לפני env', r.returned === 1)
    chk('...וההודעה לא מזכירה .env.local', !r.errLines.some(l => l.includes('.env.local')))
  }
  {
    // עכשיו כן מגיעים ל-env — קובץ שלא קיים בכלל מדווח ככזה, לא קורס.
    const r = await captureConsole(() => cleanupMain([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`], NONEXISTENT_ENV))
    chk('cleanup main(): flags תקינים, .env.local לא קיים → 1, הודעה ברורה', r.returned === 1 && r.errLines.some(l => l.includes('.env.local')))
  }
}

// ── main() — קובץ credentials מזויף/פגום: כשל בטוח, בלי דליפה ────────────

{
  const { mkdtempSync, writeFileSync, rmSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')

  const dir = mkdtempSync(join(tmpdir(), 'sm-brows-9c2-1-'))
  const badEnvPath = join(dir, '.env.local')
  writeFileSync(
    badEnvPath,
    [
      `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=not-valid-base64-json-${FAKE_POISON.secret}-${FAKE_POISON.phone}`,
      'GOOGLE_CALENDAR_ID=fake-calendar-id',
      'NEXT_PUBLIC_SUPABASE_URL=https://fake.supabase.co',
      'SUPABASE_SERVICE_ROLE_KEY=fake-role-key',
    ].join('\n'),
    'utf8',
  )

  try {
    const { main: cleanupMain } = await import('./cleanup-calendar-phone.mjs')
    const r = await captureConsole(() => cleanupMain([`--deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}`], badEnvPath))
    chk('cleanup main(): credentials JSON פגומות → 1, לא קורס', r.returned === 1)
    const allOutput = [...r.logLines, ...r.errLines].join('\n')
    chk('⚠️ הודעת הכשל היא slug קבוע — לא מכילה SyntaxError/Unexpected token', !/SyntaxError|Unexpected token|JSON/.test(allOutput))
    chk('⚠️ הודעת הכשל לא מכילה את תוכן ה-credentials הפגום (secret/phone)',
      !allOutput.includes(FAKE_POISON.secret) && !allOutput.includes(FAKE_POISON.phone))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── runCleanup: שגיאות "מורעלות" (phone/UUID/eventId/URL/secret/stack) לא דולפות ──

{
  const reader = { async listLinkedAppointments(afterId) { return afterId === null ? [{ id: 'a1', google_event_id: 'e1' }] : [] } }
  const calendar = {
    async getEvent() { throw poisonError(500) },
    async patchDescription() {},
  }
  const sleep = countingSleep()
  const outcome = await runCleanup({ reader, calendar, sleep, batchSize: 10, mode: 'dry_run', maxRetries: 1 })
  const dump = JSON.stringify(outcome)
  chk('GET שזורק שגיאה "מורעלת" חוזרת (500) → transient_failure, לא קורס', outcome.counts.transient_failure === 1)
  assertNoPoison(dump, 'runCleanup outcome (GET מורעל, 500)')
}

{
  const reader = { async listLinkedAppointments(afterId) { return afterId === null ? [{ id: 'a1', google_event_id: 'e1' }] : [] } }
  const calendar = {
    async getEvent() {
      return { etag: 'W/"x"', description: cleanDescription('הרמת גבות', 'a1'), ownerSource: 'sm_brows_website', ownerAppointmentId: 'a1' }
    },
    async patchDescription() { throw poisonError(429) },
  }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'dry_run' })
  chk('already_clean: אין PATCH מלכתחילה (poison לא רלוונטי כאן)', outcome.counts.already_clean === 1)
}

{
  // needs_cleanup + PATCH שזורק שגיאה "מורעלת" (429 עד מיצוי) — לא דולף.
  const reader = { async listLinkedAppointments(afterId) { return afterId === null ? [{ id: 'a1', google_event_id: 'e1' }] : [] } }
  const calendar = {
    async getEvent() {
      return { etag: 'W/"x"', description: dirtyDescription('+972500000030', 'הרמת גבות', 'a1'), ownerSource: 'sm_brows_website', ownerAppointmentId: 'a1' }
    },
    async patchDescription() { throw poisonError(429) },
  }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'execute', maxRetries: 1 })
  const dump = JSON.stringify(outcome)
  chk('PATCH שזורק שגיאה מורעלת חוזרת → transient_failure', outcome.counts.transient_failure === 1)
  assertNoPoison(dump, 'runCleanup outcome (PATCH מורעל, 429)')
}

{
  // 401 "מורעל" → aborted — עדיין רק kind+counts, אין תוכן מהשגיאה.
  const reader = { async listLinkedAppointments(afterId) { return afterId === null ? [{ id: 'a1', google_event_id: 'e1' }] : [] } }
  const calendar = { async getEvent() { throw poisonError(401) }, async patchDescription() {} }
  const outcome = await runCleanup({ reader, calendar, sleep: NO_SLEEP, batchSize: 10, mode: 'dry_run' })
  const dump = JSON.stringify(outcome)
  chk('401 מורעל → aborted_auth_error', outcome.kind === 'aborted_auth_error')
  assertNoPoison(dump, 'runCleanup outcome (401 מורעל)')
}

{
  // שגיאת DB "מורעלת" — רק code מסונן נשמר, שאר השדות (message/details/hint) מתעלמים מהם.
  const db = {
    from() {
      return {
        select() { return this },
        not() { return this },
        order() { return this },
        gt() { return this },
        async limit() {
          return {
            data: null,
            error: {
              code: 'XX000',
              message: `contains ${FAKE_POISON.phone} and ${FAKE_POISON.secret} and ${FAKE_POISON.uuid}`,
              details: FAKE_POISON.url,
              hint: FAKE_POISON.stackLike,
            },
          }
        },
      }
    },
  }
  const reader = createSupabaseAppointmentLinkReader(db)
  let caught = null
  try { await reader.listLinkedAppointments(null, 100) }
  catch (e) { caught = e }
  chk('שגיאת DB מורעלת: code בלבד נשמר', caught?.code === 'XX000')
  const errDump = JSON.stringify({ code: caught?.code, message: caught?.message, name: caught?.name })
  assertNoPoison(errDump, 'LinkReaderDbError (DB מורעל)')
}

// ── בדיקה סטטית: אין catch(err) שמשתמש ב-message/stack/String(err) בקוד ה-CLI ──

{
  const { readFileSync } = await import('fs')
  const cleanupSrc = readFileSync(new URL('./cleanup-calendar-phone.mjs', import.meta.url), 'utf8')
  const auditSrc = readFileSync(new URL('./audit-legacy-calendar-descriptions.mjs', import.meta.url), 'utf8')

  // ⚠️ ממוקד בכוונה למשתני שגיאה אופייניים (err/error/e), לא ל-".message"
  // בכללי — plan.message (הודעת CliPlan, מחרוזת קבועה שאנחנו כותבים) הוא
  // legitimate ואסור שהבדיקה תיפול עליו.
  const ERR_VAR = '(?:err|error|e)'
  const FORBIDDEN_PATTERNS = [
    new RegExp(`catch\\s*\\(\\s*\\w+\\s*\\)`), // כל catch קשור לשם — אסור, רק catch { } בלי בינדינג
    new RegExp(`\\b${ERR_VAR}\\.message\\b`),
    new RegExp(`\\b${ERR_VAR}\\.stack\\b`),
    new RegExp(`String\\(\\s*${ERR_VAR}\\b`, 'i'),
    new RegExp(`\\$\\{\\s*${ERR_VAR}\\b`, 'i'),
    new RegExp(`\\b${ERR_VAR}\\.response\\b`),
    new RegExp(`\\b${ERR_VAR}\\.config\\b`),
  ]

  for (const [name, src] of [['cleanup-calendar-phone.mjs', cleanupSrc], ['audit-legacy-calendar-descriptions.mjs', auditSrc]]) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      chk(`${name}: אין תבנית אסורה ${pattern}`, !pattern.test(src))
    }
    chk(`${name}: כל ה-catch הם catch { } לא-קשור`, (src.match(/catch\s*\{/g) ?? []).length >= 1)
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`)
const failed = results.filter(r => !r).length
if (failed === 0) {
  console.log(`✓ כל ${results.length} הבדיקות עברו`)
} else {
  console.log(`✗ ${failed} מתוך ${results.length} הבדיקות נכשלו`)
  process.exit(1)
}
