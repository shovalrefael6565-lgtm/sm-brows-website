/**
 * בדיקות שלב 8 שאינן דורשות DB או רשת.
 *
 * המיקוד: *אובייקט הבקשה שנשלח ל-Google*. הכלל שנבדק כאן הוא זה שאין דרך
 * לתקן בדיעבד — incremental sync חייב לשאת את אותו syncToken בכל עמוד,
 * כולל עמודי המשך ו-resume, ולא pageToken לבדו. שאילתה שגויה שם מחזירה
 * תוצאות לא מוגדרות, ושינוי שהוחמץ אבוד לנצח.
 *
 * בנוסף: סיווג שגיאות cursor, זיהוי בעלות, גרסת אירוע, וצורות אירוע —
 * כולם לוגיקה טהורה שאפשר ונכון לבדוק בלי תשתית.
 *
 * הרצה:  npm run test:calendar-sync-core
 */

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const {
  buildListChangesParams, classifyCursorError, classifyEvents,
  eventVersion, eventShape, calendarFingerprint,
} = await import('../lib/googleCalendarSync.ts')
const { fetchChanges } = await import('../lib/calendarSyncPager.ts')
const { deterministicEventId, appointmentIdFromDeterministicEventId } =
  await import('../lib/googleCalendar.ts')

const CAL = 'studio@example.com'
const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const SYS_EVENT = deterministicEventId(APPT)

// ════════════════════════════════════════════════════════════════════════════
section('פרמטרים קבועים של ערוץ הסנכרון')
// ════════════════════════════════════════════════════════════════════════════

const full1 = buildListChangesParams(CAL, { mode: 'full', baseSyncToken: null, pageToken: null })
chk('showDeleted=true — בלי זה מחיקות לא מגיעות כלל', full1.showDeleted === true)
chk('singleEvents=false — לא מרחיבים אירועים חוזרים', full1.singleEvents === false)
chk('maxResults קבוע', full1.maxResults === 250)
chk('calendarId נשלח', full1.calendarId === CAL)
chk('⚠️ timeMin/timeMax/orderBy/updatedMin אינם נשלחים — אסורים עם syncToken',
  !('timeMin' in full1) && !('timeMax' in full1) && !('orderBy' in full1) && !('updatedMin' in full1))

// ════════════════════════════════════════════════════════════════════════════
section('full sync: עמוד ראשון מול עמודי המשך')
// ════════════════════════════════════════════════════════════════════════════

chk('full עמוד 1: ללא syncToken', full1.syncToken === undefined)
chk('full עמוד 1: ללא pageToken', full1.pageToken === undefined)

const full2 = buildListChangesParams(CAL, { mode: 'full', baseSyncToken: null, pageToken: 'P2' })
chk('full עמוד 2: pageToken קיים', full2.pageToken === 'P2')
chk('full עמוד 2: עדיין ללא syncToken', full2.syncToken === undefined)
chk('full עמוד 2: שאר הפרמטרים זהים לעמוד 1',
  full2.showDeleted === full1.showDeleted &&
  full2.singleEvents === full1.singleEvents &&
  full2.maxResults === full1.maxResults &&
  full2.calendarId === full1.calendarId)

// ════════════════════════════════════════════════════════════════════════════
section('incremental sync: syncToken בכל עמוד')
// ════════════════════════════════════════════════════════════════════════════

const inc1 = buildListChangesParams(CAL, { mode: 'incremental', baseSyncToken: 'TOK', pageToken: null })
chk('incremental עמוד 1: syncToken קיים', inc1.syncToken === 'TOK')
chk('incremental עמוד 1: ללא pageToken', inc1.pageToken === undefined)

const inc2 = buildListChangesParams(CAL, { mode: 'incremental', baseSyncToken: 'TOK', pageToken: 'P2' })
chk('⚠️ incremental עמוד 2: אותו syncToken בדיוק — לא pageToken לבדו',
  inc2.syncToken === 'TOK')
chk('incremental עמוד 2: pageToken קיים', inc2.pageToken === 'P2')
chk('incremental עמוד 2: שאר הפרמטרים זהים לעמוד 1',
  inc2.showDeleted === inc1.showDeleted &&
  inc2.singleEvents === inc1.singleEvents &&
  inc2.maxResults === inc1.maxResults &&
  inc2.calendarId === inc1.calendarId)

const resumed = buildListChangesParams(CAL, { mode: 'incremental', baseSyncToken: 'TOK', pageToken: 'P7' })
chk('⚠️ resume אחרי קטיעה: אותו base_sync_token + ה-pageToken השמור',
  resumed.syncToken === 'TOK' && resumed.pageToken === 'P7')

let threw = null
try { buildListChangesParams(CAL, { mode: 'incremental', baseSyncToken: null, pageToken: null }) }
catch (e) { threw = e.message }
chk('incremental בלי base_sync_token הוא באג ולא נשלח בשקט', threw !== null)

// ════════════════════════════════════════════════════════════════════════════
section('סיווג שגיאות cursor')
// ════════════════════════════════════════════════════════════════════════════

const gErr = (status, reason) => {
  const e = new Error(`google error ${status}`)
  e.code = status
  if (reason) e.errors = [{ reason }]
  return e
}

chk('410 → איפוס מלא', classifyCursorError(gErr(410), false) === 'full_reset')
chk("reason='fullSyncRequired' → איפוס מלא",
  classifyCursorError(gErr(400, 'fullSyncRequired'), true) === 'full_reset')
chk('400 + invalid *עם* pageToken → הפעלה מחדש של אותה סדרה',
  classifyCursorError(gErr(400, 'invalid'), true) === 'page_restart')
chk('⚠️ 400 + invalid *בלי* pageToken אינו בעיית pageToken',
  classifyCursorError(gErr(400, 'invalid'), false) === 'fatal')
chk('⚠️ 400 כללי ללא reason מזוהה → fatal, בלי לגעת ב-tokens',
  classifyCursorError(gErr(400), true) === 'fatal')
chk('429 → חולף, ה-cursor נשמר', classifyCursorError(gErr(429), true) === 'transient')
chk('403 → חולף', classifyCursorError(gErr(403), true) === 'transient')
chk('500 → חולף', classifyCursorError(gErr(500), true) === 'transient')
chk('503 → חולף', classifyCursorError(gErr(503), true) === 'transient')
chk('תקלת רשת ללא קוד → חולף, לא מאפסים כלום',
  classifyCursorError(new Error('socket hang up'), true) === 'transient')

// ════════════════════════════════════════════════════════════════════════════
section('הלולאה: מה באמת נשלח ל-Google')
// ════════════════════════════════════════════════════════════════════════════

function makeStore(overrides = {}) {
  const recorded = []
  const resets = []
  return {
    recorded, resets,
    async recordChanges(args) {
      recorded.push(args)
      return { ok: true, inserted: args.changes.length, duplicate: 0 }
    },
    async resetCursor(fullReset, reason) {
      resets.push({ fullReset, reason })
      return { ok: true }
    },
    async lookupAppointmentsByEventIds() {
      return { ok: true, map: new Map() }
    },
    ...overrides,
  }
}

const emptyStats = () => ({
  eventsRead: 0, manualIgnored: 0, changesPersisted: 0, duplicateVersions: 0,
  pagesFetched: 0, syncTokenReset: false, pageRestart: false, timedOut: false,
})

/** client מזויף שמתעד כל בקשה ומחזיר עמודים לפי תסריט */
function makeClient(script) {
  const requests = []
  let i = 0
  return {
    requests,
    async listChanges(params) {
      requests.push({ ...params })
      const step = script[i++]
      if (!step) throw new Error('client ran out of script')
      if (step.throw) throw step.throw
      return {
        events: step.events ?? [],
        nextPageToken: step.nextPageToken ?? null,
        nextSyncToken: step.nextSyncToken ?? null,
      }
    },
  }
}

// ── שלושה עמודים של incremental ─────────────────────────────────────────────
{
  const client = makeClient([
    { nextPageToken: 'P2' },
    { nextPageToken: 'P3' },
    { nextSyncToken: 'NEW-TOKEN' },
  ])
  const store = makeStore()
  const stats = emptyStats()
  await fetchChanges({
    calendarId: CAL,
    plan: { mode: 'incremental', baseSyncToken: 'TOK', pageToken: null },
    client, store, stats, deadline: Infinity, now: () => 0,
  })

  chk('שלושת העמודים נקראו', client.requests.length === 3)
  chk('⚠️ כל שלוש הבקשות נשאו את אותו syncToken',
    client.requests.every(r => r.syncToken === 'TOK'))
  chk('עמוד 1 בלי pageToken, עמודים 2-3 איתו',
    client.requests[0].pageToken === undefined &&
    client.requests[1].pageToken === 'P2' &&
    client.requests[2].pageToken === 'P3')
  chk('כל הבקשות זהות בשאר הפרמטרים',
    client.requests.every(r =>
      r.showDeleted === true && r.singleEvents === false &&
      r.maxResults === 250 && r.calendarId === CAL))
  chk('⚠️ הטוקן החדש נשלח לשמירה רק בעמוד האחרון',
    store.recorded[0].nextSyncToken === null &&
    store.recorded[1].nextSyncToken === null &&
    store.recorded[2].nextSyncToken === 'NEW-TOKEN')
  chk('העמודים האמצעיים שולחים nextPageToken לשמירה',
    store.recorded[0].nextPageToken === 'P2' && store.recorded[1].nextPageToken === 'P3')
}

// ── timeout אחרי עמוד ראשון מתוך שלושה ──────────────────────────────────────
{
  const client = makeClient([
    { nextPageToken: 'P2' },
    { nextPageToken: 'P3' },
    { nextSyncToken: 'NEW' },
  ])
  const store = makeStore()
  const stats = emptyStats()
  let ticks = 0
  await fetchChanges({
    calendarId: CAL,
    plan: { mode: 'full', baseSyncToken: null, pageToken: null },
    client, store, stats, deadline: 100,
    // בתוך התקציב לעמוד הראשון, חורג ממנו לפני העמוד השני
    now: () => (ticks++ === 0 ? 0 : 200),
  })
  chk('⚠️ timeout עוצר את הלולאה אחרי עמוד אחד', client.requests.length === 1)
  chk('timeout מדווח בסטטיסטיקה', stats.timedOut === true)
  chk('⚠️ העמוד שכן נקרא נשמר בעמידות עם ה-pageToken שלו',
    store.recorded.length === 1 && store.recorded[0].nextPageToken === 'P2')
  chk('timeout אינו מאפס שום cursor', store.resets.length === 0)
}

// ── הריצה הבאה ממשיכה מעמוד 2 ולא מעמוד 1 ───────────────────────────────────
{
  const client = makeClient([{ nextPageToken: 'P3' }, { nextSyncToken: 'NEW' }])
  const store = makeStore()
  const stats = emptyStats()
  await fetchChanges({
    calendarId: CAL,
    plan: { mode: 'full', baseSyncToken: null, pageToken: 'P2' }, // ה-cursor השמור
    client, store, stats, deadline: Infinity, now: () => 0,
  })
  chk('⚠️ הריצה הבאה מתחילה מהעמוד השמור ולא מעמוד ראשון',
    client.requests[0].pageToken === 'P2')
  chk('היא ממשיכה משם לעמוד הבא', client.requests[1].pageToken === 'P3')
  chk('full sync בהמשך עדיין בלי syncToken',
    client.requests.every(r => r.syncToken === undefined))
}

// ── resume של incremental אחרי timeout ──────────────────────────────────────
{
  const client = makeClient([{ nextSyncToken: 'NEW' }])
  const store = makeStore()
  const stats = emptyStats()
  await fetchChanges({
    calendarId: CAL,
    plan: { mode: 'incremental', baseSyncToken: 'BASE-TOK', pageToken: 'P5' },
    client, store, stats, deadline: Infinity, now: () => 0,
  })
  chk('⚠️ resume של incremental נושא גם base_sync_token וגם pageToken',
    client.requests[0].syncToken === 'BASE-TOK' && client.requests[0].pageToken === 'P5')
}

// ── pageToken פסול ב-incremental: אותה סדרה מהעמוד הראשון ────────────────────
{
  const client = makeClient([
    { throw: gErr(400, 'invalid') },
    { nextSyncToken: 'NEW' },
  ])
  const store = makeStore()
  const stats = emptyStats()
  await fetchChanges({
    calendarId: CAL,
    plan: { mode: 'incremental', baseSyncToken: 'BASE-TOK', pageToken: 'BAD' },
    client, store, stats, deadline: Infinity, now: () => 0,
  })
  chk('⚠️ pageToken פסול ב-incremental אינו קופץ ל-full sync',
    store.resets.length === 1 && store.resets[0].fullReset === false)
  chk('⚠️ הניסיון החוזר הוא אותה סדרה מהעמוד הראשון',
    client.requests[1].syncToken === 'BASE-TOK' && client.requests[1].pageToken === undefined)
  chk('page_restart מדווח בסטטיסטיקה', stats.pageRestart === true && stats.syncTokenReset === false)
}

// ── base_sync_token מחזיר 410 → full sync ───────────────────────────────────
{
  const client = makeClient([
    { throw: gErr(400, 'invalid') },   // pageToken פסול
    { throw: gErr(410) },              // גם הטוקן עצמו פג
    { nextSyncToken: 'FRESH' },
  ])
  const store = makeStore()
  const stats = emptyStats()
  await fetchChanges({
    calendarId: CAL,
    plan: { mode: 'incremental', baseSyncToken: 'BASE-TOK', pageToken: 'BAD' },
    client, store, stats, deadline: Infinity, now: () => 0,
  })
  chk('⚠️ 410 על ה-base token מעביר ל-full sync',
    store.resets.length === 2 && store.resets[1].fullReset === true)
  chk('ה-full sync שאחריו נשלח בלי syncToken ובלי pageToken',
    client.requests[2].syncToken === undefined && client.requests[2].pageToken === undefined)
  chk('איפוס הטוקן מדווח בסטטיסטיקה', stats.syncTokenReset === true)
}

// ── 400 שאינו בעיית cursor: אין איפוס, אין קידום ────────────────────────────
{
  const client = makeClient([{ throw: gErr(400) }])
  const store = makeStore()
  const stats = emptyStats()
  let failed = false
  try {
    await fetchChanges({
      calendarId: CAL,
      plan: { mode: 'incremental', baseSyncToken: 'TOK', pageToken: 'P2' },
      client, store, stats, deadline: Infinity, now: () => 0,
    })
  } catch { failed = true }
  chk('400 לא מזוהה מפיל את הריצה', failed)
  chk('⚠️ 400 לא מזוהה אינו מאפס tokens', store.resets.length === 0)
  chk('⚠️ 400 לא מזוהה אינו מקדם cursor', store.recorded.length === 0)
}

// ── 429 באמצע pagination ────────────────────────────────────────────────────
{
  const client = makeClient([{ nextPageToken: 'P2' }, { throw: gErr(429) }])
  const store = makeStore()
  const stats = emptyStats()
  let failed = false
  try {
    await fetchChanges({
      calendarId: CAL,
      plan: { mode: 'incremental', baseSyncToken: 'TOK', pageToken: null },
      client, store, stats, deadline: Infinity, now: () => 0,
    })
  } catch { failed = true }
  chk('429 מפיל את הריצה', failed)
  chk('⚠️ 429 אינו מאפס cursor — הריצה הבאה תמשיך מ-P2', store.resets.length === 0)
  chk('העמוד שהספיק להיקרא נשמר', store.recorded.length === 1 && store.recorded[0].nextPageToken === 'P2')
}

// ── כשל lookup: לא מסמנים אירועים כידניים ולא מקדמים cursor ─────────────────
{
  const client = makeClient([{ events: [{ id: SYS_EVENT, status: 'confirmed', etag: 'e1' }], nextSyncToken: 'X' }])
  const store = makeStore({ async lookupAppointmentsByEventIds() { return { ok: false } } })
  const stats = emptyStats()
  let failed = false
  try {
    await fetchChanges({
      calendarId: CAL,
      plan: { mode: 'full', baseSyncToken: null, pageToken: null },
      client, store, stats, deadline: Infinity, now: () => 0,
    })
  } catch { failed = true }
  chk('⚠️ כשל בזיהוי בעלות מפיל את הריצה ולא מסווג אירועים כידניים', failed)
  chk('⚠️ כשל בזיהוי בעלות אינו מקדם cursor', store.recorded.length === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('זיהוי בעלות')
// ════════════════════════════════════════════════════════════════════════════

const SRC = 'sm_brows_website'
const ev = (o = {}) => ({
  id: 'manual-event-1', status: 'confirmed', etag: 'etag-x',
  start: { dateTime: '2028-06-06T08:00:00Z' },
  end: { dateTime: '2028-06-06T08:20:00Z' },
  ...o,
})
const classify = (events, map = new Map()) => classifyEvents(events, map)

{
  const { records, skippedManual } = classify([ev({ summary: 'פגישה אישית של שובל' })])
  chk('⚠️ אירוע ידני נזרק ואינו נשמר בכלל', records.length === 0 && skippedManual === 1)
}
{
  const { records } = classify([ev({ summary: 'SM Brows — עיצוב גבות ללקוחה 050-1234567' })])
  chk('⚠️ כותרת, שם וטלפון אינם ראיה לבעלות', records.length === 0)
}
{
  const { records } = classify([ev({
    extendedProperties: { private: { source: SRC, appointment_id: APPT } },
  })])
  chk('extendedProperties תקינים מזוהים',
    records.length === 1 && records[0].ownership === 'extended_properties' &&
    records[0].appointment_id === APPT)
}
{
  const { records } = classify([ev({ id: SYS_EVENT })])
  chk('⚠️ מזהה דטרמיניסטי בלי extendedProperties אינו נחשב ידני',
    records.length === 1 && records[0].ownership === 'deterministic_id' &&
    records[0].appointment_id === APPT)
}
{
  const map = new Map([['stored-ev-1', [APPT]]])
  const { records } = classify([ev({ id: 'stored-ev-1' })], map)
  chk('google_event_id שמור ב-DB מזוהה כבעלות',
    records.length === 1 && records[0].ownership === 'stored_event_id' &&
    records[0].appointment_id === APPT)
}
{
  const { records } = classify([ev({
    extendedProperties: { private: { source: SRC, appointment_id: 'not-a-uuid' } },
  })])
  chk('⚠️ UUID פגום נשמר כ-ambiguous ולא נזרק — אחרת השינוי אבוד',
    records.length === 1 && records[0].ownership === 'ambiguous' &&
    records[0].appointment_id === null)
}
{
  const other = '11111111-2222-4333-8444-555555555555'
  const { records } = classify([ev({
    id: SYS_EVENT,
    extendedProperties: { private: { source: SRC, appointment_id: other } },
  })])
  chk('⚠️ מזהה דטרמיניסטי ו-extendedProperties סותרים → ambiguous',
    records.length === 1 && records[0].ownership === 'ambiguous' &&
    records[0].appointment_id === null)
}
{
  const map = new Map([['dup-ev', [APPT, '99999999-8888-4777-8666-555555555555']]])
  const { records } = classify([ev({ id: 'dup-ev' })], map)
  chk('⚠️ מזהה אירוע שרשום על שני תורים → ambiguous, לא נבחר אחד מהם',
    records.length === 1 && records[0].ownership === 'ambiguous' &&
    records[0].appointment_id === null)
}
{
  const { records } = classify([ev({ id: SYS_EVENT, status: 'cancelled', start: undefined, end: undefined })])
  chk('אירוע מערכת מחוק נכנס לתור עם status=cancelled',
    records.length === 1 && records[0].event_status === 'cancelled' &&
    records[0].event_start === null)
}
{
  const { records } = classify([ev({ id: SYS_EVENT })])
  const r = records[0]
  chk('⚠️ לא נשמרים summary/description/attendees/location',
    !('summary' in r) && !('description' in r) && !('attendees' in r) && !('location' in r))
  chk('נשמר בדיוק המינימום הנדרש',
    Object.keys(r).sort().join(',') ===
    'appointment_id,event_end,event_shape,event_start,event_status,event_updated,event_version,google_event_id,ownership')
}

chk('appointmentIdFromDeterministicEventId הוא היפוך מדויק',
  appointmentIdFromDeterministicEventId(deterministicEventId(APPT)) === APPT)
chk('מזהה שאינו בצורה הדטרמיניסטית מחזיר null',
  appointmentIdFromDeterministicEventId('some-random-google-id') === null)

// ════════════════════════════════════════════════════════════════════════════
section('גרסת אירוע')
// ════════════════════════════════════════════════════════════════════════════

chk('etag הוא הגרסה המועדפת',
  eventVersion({ id: 'a', etag: 'E1', updated: 'U', sequence: 3 }) === 'E1')
chk('בהיעדר etag — updated',
  eventVersion({ id: 'a', updated: '2028-01-01T00:00:00Z', sequence: 3 }) === 'u:2028-01-01T00:00:00Z')
chk('בהיעדר updated — sequence', eventVersion({ id: 'a', sequence: 7 }) === 'q:7')

const fp1 = eventVersion({ id: 'a', status: 'cancelled' })
const fp2 = eventVersion({ id: 'a', status: 'cancelled' })
const fp3 = eventVersion({ id: 'a', status: 'confirmed' })
chk('fallback הוא fingerprint יציב', fp1 === fp2 && fp1.startsWith('f:'))
chk('⚠️ שחזור (status שונה) מקבל גרסה משלו', fp1 !== fp3)

const fpTime1 = eventVersion({ id: 'a', status: 'confirmed', start: { dateTime: '2028-01-01T09:00:00Z' } })
const fpTime2 = eventVersion({ id: 'a', status: 'confirmed', start: { dateTime: '2028-01-01T10:00:00Z' } })
chk('שינוי שעה משנה את ה-fingerprint', fpTime1 !== fpTime2)

const fpTitle1 = eventVersion({ id: 'a', status: 'confirmed', summary: 'לפני' })
const fpTitle2 = eventVersion({ id: 'a', status: 'confirmed', summary: 'אחרי' })
chk('⚠️ ה-fingerprint אינו כולל את הכותרת — הוא מזהה גרסה, לא תמצית',
  fpTitle1 === fpTitle2)

// delete → restore → delete בלי שום version metadata
{
  const del1 = eventVersion({ id: 'z', status: 'cancelled' })
  const restore = eventVersion({ id: 'z', status: 'confirmed', start: { dateTime: '2028-01-01T09:00:00Z' } })
  const del2 = eventVersion({ id: 'z', status: 'cancelled' })
  chk('⚠️ מחיקה→שחזור→מחיקה: השחזור מקבל גרסה נפרדת', del1 !== restore && restore !== del2)
  chk('⚠️ שתי המחיקות מתאחדות (מתועד) — והביטול עצמו idempotent', del1 === del2)
}

// ════════════════════════════════════════════════════════════════════════════
section('צורת אירוע')
// ════════════════════════════════════════════════════════════════════════════

chk('אירוע חד-פעמי עם dateTime', eventShape(ev()) === 'timed_single')
chk('אירוע חוזר (master)', eventShape(ev({ recurrence: ['RRULE:FREQ=WEEKLY'] })) === 'recurring_master')
chk('מופע של אירוע חוזר', eventShape(ev({ recurringEventId: 'parent-1' })) === 'recurring_instance')
chk('אירוע יום שלם',
  eventShape({ id: 'a', status: 'confirmed', start: { date: '2028-06-06' }, end: { date: '2028-06-07' } }) === 'all_day')
chk('אירוע ללא שעות (ולא מחוק) הוא פגום',
  eventShape({ id: 'a', status: 'confirmed' }) === 'malformed')
chk('אירוע מחוק ללא שעות אינו נחשב פגום — זה תקין',
  eventShape({ id: 'a', status: 'cancelled' }) === 'timed_single')

{
  const { records } = classify([ev({ id: SYS_EVENT, recurrence: ['RRULE:FREQ=WEEKLY'] })])
  chk('אירוע מערכת שהפך חוזר נשמר עם הצורה שלו לטיפול בעיבוד',
    records.length === 1 && records[0].event_shape === 'recurring_master')
  chk('⚠️ ה-recurrence payload עצמו אינו נשמר', !('recurrence' in records[0]))
}

// ════════════════════════════════════════════════════════════════════════════
section('טביעת אצבע של היומן')
// ════════════════════════════════════════════════════════════════════════════

chk('אותו יומן → אותה טביעה', calendarFingerprint(CAL) === calendarFingerprint(CAL))
chk('יומן אחר → טביעה אחרת', calendarFingerprint(CAL) !== calendarFingerprint('other@example.com'))
chk('⚠️ הטביעה אינה מכילה את מזהה היומן', !calendarFingerprint(CAL).includes('example.com'))

// ════════════════════════════════════════════════════════════════════════════
section('הגנת same-origin')
// ════════════════════════════════════════════════════════════════════════════

const { isSameOrigin } = await import('../lib/auth/originGuard.ts')
const req = headers => ({ headers: { get: k => headers[k.toLowerCase()] ?? null } })

chk('אותו origin מתקבל',
  isSameOrigin(req({ origin: 'https://sm-brows.co.il', host: 'sm-brows.co.il' })) === true)
chk('⚠️ origin זר נחסם',
  isSameOrigin(req({ origin: 'https://evil.example', host: 'sm-brows.co.il' })) === false)
chk('origin עם פורט אחר נחסם',
  isSameOrigin(req({ origin: 'http://localhost:4000', host: 'localhost:3000' })) === false)
chk('localhost תואם מתקבל',
  isSameOrigin(req({ origin: 'http://localhost:3000', host: 'localhost:3000' })) === true)
chk('origin פגום נחסם',
  isSameOrigin(req({ origin: 'not-a-url', host: 'sm-brows.co.il' })) === false)
chk('בקשה ללא origin אינה נחסמת כאן (ההרשאה נאכפת ע"י ה-session)',
  isSameOrigin(req({ host: 'sm-brows.co.il' })) === true)
chk('origin קיים בלי host נחסם',
  isSameOrigin(req({ origin: 'https://sm-brows.co.il' })) === false)

// ════════════════════════════════════════════════════════════════════════════
section('ה-route הפנימי: secret')
// ════════════════════════════════════════════════════════════════════════════

const { POST: internalPost } = await import('../app/api/internal/calendar-sync/route.ts')
const post = (headers = {}) => internalPost(req(headers))

const GOOD = 'a'.repeat(48)
const savedSecret = process.env.CALENDAR_SYNC_SECRET
const savedFlag = process.env.NEW_BOOKING_SYSTEM_ENABLED
process.env.NEW_BOOKING_SYSTEM_ENABLED = 'true'

delete process.env.CALENDAR_SYNC_SECRET
chk('⚠️ בלי CALENDAR_SYNC_SECRET ה-route פשוט אינו קיים (404)',
  (await post({ 'x-calendar-sync-secret': GOOD })).status === 404)

process.env.CALENDAR_SYNC_SECRET = 'too-short'
chk('⚠️ secret קצר מדי אינו סוד — 404', (await post({ 'x-calendar-sync-secret': 'too-short' })).status === 404)

process.env.CALENDAR_SYNC_SECRET = GOOD
chk('⚠️ בלי header כלל — 401, הסנכרון לא מתחיל', (await post()).status === 401)
chk('⚠️ secret שגוי — 401', (await post({ 'x-calendar-sync-secret': 'b'.repeat(48) })).status === 401)
chk('secret באורך שונה — 401 ולא קריסה',
  (await post({ 'x-calendar-sync-secret': 'c'.repeat(10) })).status === 401)
chk('קידומת נכונה בלבד — 401',
  (await post({ 'x-calendar-sync-secret': 'a'.repeat(47) })).status === 401)

process.env.NEW_BOOKING_SYSTEM_ENABLED = 'false'
chk('⚠️ דגל כבוי חוסם גם עם secret תקין',
  (await post({ 'x-calendar-sync-secret': GOOD })).status === 403)

// שחזור הסביבה כדי לא להשפיע על בדיקות אחרות בתהליך
if (savedSecret === undefined) delete process.env.CALENDAR_SYNC_SECRET
else process.env.CALENDAR_SYNC_SECRET = savedSecret
if (savedFlag === undefined) delete process.env.NEW_BOOKING_SYSTEM_ENABLED
else process.env.NEW_BOOKING_SYSTEM_ENABLED = savedFlag

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`)
const failed = results.filter(r => !r).length
if (failed === 0) {
  console.log(`✓ כל ${results.length} הבדיקות עברו`)
} else {
  console.log(`✗ ${failed} מתוך ${results.length} הבדיקות נכשלו`)
  process.exit(1)
}
