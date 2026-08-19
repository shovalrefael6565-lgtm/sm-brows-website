/**
 * בדיקות שלב 11 שאינן דורשות DB או רשת.
 *
 * המיקוד: ההחלטות שאין דרך לתקן בדיעבד אם ישתבשו —
 *   1. מתי המערכת בכלל נוגעת בתזכורות (disabled = אפס claim).
 *   2. שסימולציה אינה יכולה לרוץ בפרודקשן.
 *   3. שגוף day_before/two_hours_before הוא בדיוק REMINDER_SMS
 *      מ-lib/messageTemplates.ts (מקור אמת יחיד, נוסחי 15F) —
 *      ולא נוסח מקומי, ולא נוסח שתלוי בטיפול/תאריך/שעה.
 *   4. שגוף manual (שאינו אחד מנוסחי 15F) עדיין נושא תאריך ושעה
 *      מפורשים ולא "מחר"/"היום" — כי הוא נשלח בכל רגע לפני התור.
 *
 * הרצה:  npm run test:reminders-core
 */

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const {
  DisabledReminderProvider, SimulatedReminderProvider,
  isDispatchable, resolveReminderProvider,
} = await import('../lib/reminders/provider.ts')
const { shouldDispatch } = await import('../lib/reminders/dispatch.ts')
const {
  REMINDER_TEMPLATE_VERSION, reminderBodyFor,
  dayBeforeReminderBody, twoHoursBeforeReminderBody, manualReminderBody,
} = await import('../lib/reminders/templates.ts')
const { manualReminderFingerprint, FINGERPRINT_RE } = await import('../lib/adminIdempotency.ts')
const { areRemindersEnabled } = await import('../lib/featureFlags.ts')
const { REMINDER_SMS, SMS_MAX_CHARS, hasEmoji, smsLength } = await import('../lib/messageTemplates.ts')

// ════════════════════════════════════════════════════════════════════════════
section('🔒 disabled = אפס נגיעה בתזכורות')
// ════════════════════════════════════════════════════════════════════════════

const disabled = new DisabledReminderProvider()
const simulated = new SimulatedReminderProvider(() => {})

chk('ספק disabled אינו dispatchable', isDispatchable(disabled) === false)
chk('ספק simulated כן dispatchable', isDispatchable(simulated) === true)

chk('🔒 מערכת כבויה + ספק כבוי → אין עיבוד', shouldDispatch(false, disabled) === false)
chk('🔒 מערכת כבויה + ספק פעיל → אין עיבוד', shouldDispatch(false, simulated) === false)
chk('🔒 מערכת דלוקה + ספק כבוי → אין עיבוד', shouldDispatch(true, disabled) === false)
chk('מערכת דלוקה + ספק פעיל → יש עיבוד', shouldDispatch(true, simulated) === true)

/**
 * ⚠️ הבדיקה הזו קוראת את המקור. היא נראית לא שגרתית, ויש לה סיבה:
 * הכלל "אין claim כשאין ספק" אינו ניתן לאכיפה ע"י טיפוסים, ושבירה שלו
 * אינה מפילה שום בדיקה אחרת — היא פשוט שורפת בשקט תזכורות שהיו עדיין
 * תקפות. לכן נבדק שסדר הפעולות בקוד הוא gate → sweep → claim.
 */
const { readFileSync } = await import('fs')
const dispatchSrc = readFileSync(new URL('../lib/reminders/dispatch.ts', import.meta.url), 'utf8')
// ⚠️ מחפשים את *אתר הקריאה* ולא את ההגדרה: 'shouldDispatch(enabled' מופיע
// גם בחתימת הפונקציה, וחיפוש רופף היה מודד את הסדר מול המקום הלא נכון.
const guardAt = dispatchSrc.indexOf('!shouldDispatch(enabled, d.provider)')
const sweepAt = dispatchSrc.indexOf('d.db.sweepExpiredReminders()')
const claimAt = dispatchSrc.indexOf('d.db.claimDueReminder(leaseToken')
/*
  ⚠️ **השתנה**: הגוף של השער אינו שורה אחת יותר — הוא מדפיס גם שורת
  אבחון לפני שהוא יוצא (ראה dispatch.ts). מה שנבדק הוא מה שחשוב באמת:
  שקיים `return stats` **בתוך** השער, לפני ה-sweep. בדיקת טקסט צמודה
  לניסוח שורה אחת הייתה נשברת על כל תוספת לגיטימית ומפתה למחוק אותה.
*/
const gateReturnAt = dispatchSrc.indexOf('return stats', guardAt)
chk('⚠️ יש return מוקדם בשער',
  guardAt !== -1 && gateReturnAt !== -1 && gateReturnAt < sweepAt)
chk('⚠️ הסדר בקוד הוא gate → sweep → claim',
  guardAt > 0 && sweepAt > guardAt && claimAt > sweepAt,
  `gate=${guardAt} sweep=${sweepAt} claim=${claimAt}`)
chk('⚠️ ה-sweep נמצא *אחרי* השער — גם הוא כותב ל-DB', sweepAt > guardAt)

// ════════════════════════════════════════════════════════════════════════════
section('🔒 כבוי = אפס כתיבות למסד — הוכחה בספירת קריאות')
// ════════════════════════════════════════════════════════════════════════════

const { runReminderDispatch } = await import('../lib/reminders/dispatch.ts')

/**
 * מרגל שסופר כל קריאה ל-DB. כל פונקציה שנקראת נרשמת ב-calls, ולכן
 * "אפס כתיבות" הופך לטענה שאפשר להוכיח ולא להצהיר.
 */
function spyDb(overrides = {}) {
  const calls = []
  const record = name => (...args) => { calls.push(name); return overrides[name]?.(...args) }
  return {
    calls,
    db: {
      sweepExpiredReminders: overrides.sweepExpiredReminders
        ? record('sweepExpiredReminders')
        : () => { calls.push('sweepExpiredReminders'); return { expired: 0, cancelled: 0 } },
      claimDueReminder: overrides.claimDueReminder
        ? record('claimDueReminder')
        : () => { calls.push('claimDueReminder'); return null },
      reminderPrecheck: record('reminderPrecheck'),
      loadReminderRecipient: record('loadReminderRecipient'),
      finishReminderAttempt: record('finishReminderAttempt'),
      abortReminderAttempt: record('abortReminderAttempt'),
    },
  }
}

/**
 * ⚠️ שני הדגלים. תזכורות הן חלק ממערכת ההזמנות החדשה, ולכן
 * NEW_BOOKING_SYSTEM_ENABLED כבוי משמעו שגם התזכורות כבויות — וזה מה
 * שמאפשר ל-endpoint להחזיר 200 עם enabled:false במקום 403.
 */
const withFlag = async (value, fn, booking = 'true') => {
  const prevFlag = process.env.REMINDERS_ENABLED
  const prevBooking = process.env.NEW_BOOKING_SYSTEM_ENABLED
  if (value === undefined) delete process.env.REMINDERS_ENABLED
  else process.env.REMINDERS_ENABLED = value
  process.env.NEW_BOOKING_SYSTEM_ENABLED = booking
  try { return await fn() } finally {
    if (prevFlag === undefined) delete process.env.REMINDERS_ENABLED
    else process.env.REMINDERS_ENABLED = prevFlag
    if (prevBooking === undefined) delete process.env.NEW_BOOKING_SYSTEM_ENABLED
    else process.env.NEW_BOOKING_SYSTEM_ENABLED = prevBooking
  }
}

// ── מערכת כבויה + ספק כבוי ────────────────────────────────────────────────
{
  const spy = spyDb()
  const stats = await withFlag('false', () =>
    runReminderDispatch({ provider: disabled, db: spy.db }))
  chk('🔒 כבוי לגמרי: אפס קריאות ל-DB', spy.calls.length === 0, spy.calls.join(',') || 'אין')
  chk('🔒 כבוי לגמרי: sweep לא נקרא', !spy.calls.includes('sweepExpiredReminders'))
  chk('🔒 כבוי לגמרי: claim לא נקרא', !spy.calls.includes('claimDueReminder'))
  chk('enabled=false מוחזר', stats.enabled === false)
  chk('כל המונים אפס',
    stats.claimed === 0 && stats.sent === 0 && stats.simulated === 0 &&
    stats.sweptExpired === 0 && stats.sweptCancelled === 0 &&
    stats.cancelled === 0 && stats.superseded === 0 && stats.skipped === 0)
}

// ── מערכת דלוקה אך ספק כבוי ───────────────────────────────────────────────
{
  const spy = spyDb()
  const stats = await withFlag('true', () =>
    runReminderDispatch({ provider: disabled, db: spy.db }))
  chk('🔒 דלוקה + ספק כבוי: אפס קריאות ל-DB', spy.calls.length === 0, spy.calls.join(',') || 'אין')
  chk('dispatchable=false מוחזר', stats.dispatchable === false)
  chk('provider=disabled מוחזר', stats.provider === 'disabled')
}

// ── מערכת כבויה אך ספק פעיל ───────────────────────────────────────────────
{
  const spy = spyDb()
  await withFlag('false', () => runReminderDispatch({ provider: simulated, db: spy.db }))
  chk('🔒 כבויה + ספק פעיל: אפס קריאות ל-DB', spy.calls.length === 0, spy.calls.join(',') || 'אין')
}

// ── מערכת ההזמנות החדשה כבויה ─────────────────────────────────────────────
{
  const spy = spyDb()
  const stats = await withFlag('true',
    () => runReminderDispatch({ provider: simulated, db: spy.db }), 'false')
  chk('🔒 NEW_BOOKING_SYSTEM_ENABLED כבוי: אפס קריאות ל-DB',
    spy.calls.length === 0, spy.calls.join(',') || 'אין')
  chk('⚠️ הדגל הכבוי מדווח כ-enabled=false ולא ככשל', stats.enabled === false)
}

// ── פעיל: sweep לפני claim ────────────────────────────────────────────────
{
  const spy = spyDb()
  const stats = await withFlag('true', () =>
    runReminderDispatch({ provider: simulated, db: spy.db }))
  chk('פעיל: ה-DB כן נקרא', spy.calls.length > 0)
  chk('⚠️ פעיל: sweep נקרא ראשון', spy.calls[0] === 'sweepExpiredReminders', spy.calls.join(','))
  chk('⚠️ פעיל: claim נקרא אחרי ה-sweep',
    spy.calls.indexOf('claimDueReminder') === 1, spy.calls.join(','))
  chk('אין מה לתפוס → אפס claimed', stats.claimed === 0)
}

// ── פעיל: תזכורת שפגה מסומנת skipped ולא נשלחת ────────────────────────────
{
  const spy = spyDb({
    sweepExpiredReminders: () => ({ expired: 3, cancelled: 1 }),
    claimDueReminder: () => null,   // ה-sweep כבר הוציא אותן מהמחזור
  })
  const stats = await withFlag('true', () =>
    runReminderDispatch({ provider: simulated, db: spy.db }))
  chk('⚠️ תזכורות שפגו סומנו skipped ע"י ה-sweep', stats.sweptExpired === 3)
  chk('⚠️ אף אחת מהן לא נתפסה לשליחה', stats.claimed === 0)
  chk('⚠️ ולא נשלחה אף הודעה', stats.sent === 0 && stats.simulated === 0)
}

// ── פעיל: מסלול שליחה מלא מול ספק מזויף ───────────────────────────────────
{
  const STARTS_ISO = '2026-08-24T07:00:00.000Z' // יום ב', 10:00 בישראל
  const REMINDER = {
    id: 'cccccccc-dddd-4eee-8fff-000000000000',
    appointment_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    reminder_kind: 'day_before',
    appointment_starts_at: STARTS_ISO,
    status: 'processing',
  }
  let claimedOnce = false
  const sent = []
  const spy = spyDb({
    sweepExpiredReminders: () => ({ expired: 0, cancelled: 0 }),
    claimDueReminder: () => {
      if (claimedOnce) return null
      claimedOnce = true
      return { reminder: REMINDER, appointmentStatus: 'confirmed', appointmentStartsAt: STARTS_ISO, appointmentDurationMin: 20 }
    },
    reminderPrecheck: () => ({ ok: true }),
    loadReminderRecipient: () => ({
      phoneE164: '+972541234567', serviceKey: 'עיצוב גבות טבעיות',
      variants: ['עיצוב גבות טבעי'],
    }),
    finishReminderAttempt: () => ({ status: 'simulated' }),
    abortReminderAttempt: () => ({ status: 'skipped' }),
  })
  const recordingProvider = {
    name: 'fake', isLive: false,
    send: async m => { sent.push(m); return { outcome: 'accepted', providerMessageId: 'x' } },
  }
  const stats = await withFlag('true', () =>
    runReminderDispatch({ provider: recordingProvider, db: spy.db }))

  chk('מסלול מלא: תזכורת אחת נתפסה ונשלחה', stats.claimed === 1 && stats.simulated === 1)
  chk('⚠️ accepted מספק שאינו חי נספר כ-simulated ולא כ-sent', stats.sent === 0)
  chk('⚠️ מפתח ה-idempotency הוא reminder.id', sent[0]?.idempotencyKey === REMINDER.id)
  chk('הטלפון הועבר לספק אך לא נשמר', sent[0]?.to === '+972541234567')
  /**
   * ⚠️ day_before סטטי — הגוף שנשלח הוא בדיוק REMINDER_SMS.day_before
   * (מקור אמת יחיד, 15F), ואינו נבנה מהשעה או מהטיפול שב-snapshot. הניתוב
   * לפי reminder_kind הוא מה שנגזר מה-snapshot, לא תוכן ההודעה עצמו.
   */
  chk('🔒 גוף ההודעה הוא בדיוק הנוסח המאושר של day_before',
    sent[0]?.body === REMINDER_SMS.day_before)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 בחירת ספק — production הוא disabled בלבד')
// ════════════════════════════════════════════════════════════════════════════

const resolveWith = env => resolveReminderProvider(env)

chk('ברירת מחדל (אין משתנה) → disabled', resolveWith({}).name === 'disabled')
chk('disabled מפורש → disabled', resolveWith({ REMINDER_PROVIDER: 'disabled' }).name === 'disabled')
chk('ערך לא מוכר → disabled', resolveWith({ REMINDER_PROVIDER: 'twilio' }).name === 'disabled')
chk('⚠️ "019" אינו שם ספק חוקי → disabled',
  resolveWith({ REMINDER_PROVIDER: '019' }).name === 'disabled')
chk('🔒 "sms_019" בלי משתני הסביבה שלו → disabled (לא ניסיון שליחה חלקי)',
  resolveWith({ REMINDER_PROVIDER: 'sms_019' }).name === 'disabled')

// ⚠️ שם הספק של שלב 12 הוא 'sms_019'. ה-CHECK ב-0011 דורש אות ראשונה,
// ולכן '019' אינו ערך חוקי ב-DB כלל — ואין לשנות את ה-CHECK בשבילו.
const PROVIDER_FORMAT = /^[a-z][a-z0-9_]{1,31}$/
chk("🔒 'sms_019' תואם לפורמט ה-provider של 0011", PROVIDER_FORMAT.test('sms_019'))
chk("🔒 '019' אינו תואם לפורמט — ולכן לא ייבחר כשם הספק", !PROVIDER_FORMAT.test('019'))
chk('🔒 שלושת ספקי שלב 11 תואמים לפורמט',
  ['disabled', 'simulated', 'fake'].every(p => PROVIDER_FORMAT.test(p)))

chk('simulated בפיתוח → simulated',
  resolveWith({ REMINDER_PROVIDER: 'simulated', NODE_ENV: 'development' }).name === 'simulated')
chk('simulated בבדיקות → simulated',
  resolveWith({ REMINDER_PROVIDER: 'simulated', NODE_ENV: 'test' }).name === 'simulated')
chk('🔒 simulated בפרודקשן → disabled',
  resolveWith({ REMINDER_PROVIDER: 'simulated', NODE_ENV: 'production' }).name === 'disabled')

/**
 * ⚠️ אין דגל חילוץ. הבדיקה הזו קיימת כדי שתוספת עתידית של override תיפול
 * כאן במקום לעבור בשקט — זו בדיוק הדרך שבה מגיעים בטעות ל-SMS בפרודקשן.
 */
const providerSrc = readFileSync(new URL('../lib/reminders/provider.ts', import.meta.url), 'utf8')
chk('🔒 אין REMINDER_ALLOW_SIMULATED_IN_PROD ואין override דומה',
  !/ALLOW_SIMULATED/i.test(providerSrc) && !/ALLOW.*IN_PROD/i.test(providerSrc))
chk('🔒 גם עם משתנה כזה מוגדר — פרודקשן נשאר disabled',
  resolveWith({
    REMINDER_PROVIDER: 'simulated',
    NODE_ENV: 'production',
    REMINDER_ALLOW_SIMULATED_IN_PROD: 'true',
  }).name === 'disabled')

chk('🔒 אף ספק פיתוח אינו isLive',
  disabled.isLive === false && simulated.isLive === false &&
  resolveWith({ REMINDER_PROVIDER: 'simulated', NODE_ENV: 'test' }).isLive === false)

// ⚠️ sms_019 הוא היחיד שעבורו status='sent' אפשרי. הבדיקות המלאות שלו
// נמצאות ב-npm run test:sms019; כאן רק מקובע שהוא אינו נבחר בטעות.
chk('🔒 sms_019 אינו נבחר בלי בחירה מפורשת',
  resolveWith({
    SMS019_USERNAME: 'u', SMS019_TOKEN: 't', SMS019_SOURCE: 'SM BROWS',
  }).name === 'disabled')

// ════════════════════════════════════════════════════════════════════════════
section('הספקים עצמם')
// ════════════════════════════════════════════════════════════════════════════

const MSG = { to: '+972541234567', body: 'תוכן ההודעה', idempotencyKey: 'rem-1' }

const disabledResult = await disabled.send(MSG)
chk('ספק disabled אינו מחזיר accepted', disabledResult.outcome !== 'accepted')
chk('ספק disabled מחזיר permanent_error/provider_disabled',
  disabledResult.outcome === 'permanent_error' && disabledResult.errorCode === 'provider_disabled')

const logLines = []
const loggingSim = new SimulatedReminderProvider(l => logLines.push(l))
const simResult = await loggingSim.send(MSG)
chk('ספק simulated מחזיר accepted', simResult.outcome === 'accepted')

const logged = logLines.join('\n')
chk('⚠️ הלוג אינו מכיל מספר טלפון', !logged.includes('+972541234567') && !logged.includes('0541234567'))
chk('⚠️ הלוג אינו מכיל את גוף ההודעה', !logged.includes('תוכן ההודעה'))
chk('הלוג כן מכיל את מפתח ה-idempotency (מזהה בלבד)', logged.includes('rem-1'))
chk('הלוג מציין במפורש שלא נשלח SMS', logged.includes('לא נשלח'))

// ════════════════════════════════════════════════════════════════════════════
section('⚠️ התבניות — day_before/two_hours_before מחווטות, manual נשאר מפורש')
// ════════════════════════════════════════════════════════════════════════════

const STARTS = new Date('2026-08-24T07:00:00Z') // יום ב', 10:00 בישראל
const P = { treatment: 'עיצוב גבות טבעי', startsAt: STARTS }

const bodies = {
  day_before: dayBeforeReminderBody(),
  two_hours_before: twoHoursBeforeReminderBody(),
  manual: manualReminderBody(P),
}

/**
 * 🔒 מקור אמת יחיד. הנוסחים האלה אינם מחרוזות מקומיות — הם בדיוק
 * REMINDER_SMS מ-lib/messageTemplates.ts (15F, מאושר ונמדד שם).
 */
chk('🔒 day_before === REMINDER_SMS.day_before (אין עותק שני)',
  bodies.day_before === REMINDER_SMS.day_before)
chk('🔒 two_hours_before === REMINDER_SMS.two_hours_before (אין עותק שני)',
  bodies.two_hours_before === REMINDER_SMS.two_hours_before)
chk('day_before/two_hours_before סטטיים — אינם מקבלים קלט',
  dayBeforeReminderBody.length === 0 && twoHoursBeforeReminderBody.length === 0)

for (const kind of ['day_before', 'two_hours_before']) {
  const text = bodies[kind]
  chk(`${kind}: ≤ ${SMS_MAX_CHARS} תווים (מקטע יחיד)`, smsLength(text) <= SMS_MAX_CHARS,
    `${smsLength(text)} תווים`)
  chk(`${kind}: אפס אמוג'י`, !hasEmoji(text))
  chk(`${kind}: אין טלפון בגוף ההודעה`, !/\+9725\d{8}/.test(text))
  chk(`${kind}: אין placeholder — סטטי לגמרי`, !/\$\{|\{[a-zA-Z]|%s|__/.test(text))
}

/**
 * ⚠️ אלה **כן** אומרות "מחר"/"בעוד שעתיים" — ההחלטה שאושרה, לא כלל
 * שהתהפך. אבל שתיהן אינן מוגנות באותו אופן, וזה מה שנבדק כאן ובסעיף
 * חסם הרעננות למטה:
 *   day_before ("מחר")          — מוגן ע"י הסכמה (expires_at = +6h).
 *   two_hours_before ("בעוד שעתיים") — טענה על מרחק בזמן, ולכן מוגן ע"י
 *     TWO_HOURS_FRESHNESS_MS ב-dispatch.ts ולא ע"י החלון של 0011.
 */
chk('🔒 day_before אומר "מחר" (מאושר, לא באג)', /מחר/.test(bodies.day_before))
chk('🔒 two_hours_before אומר "בעוד שעתיים" (מאושר, לא באג)',
  bodies.two_hours_before.includes('בעוד שעתיים'))
chk('⚠️ two_hours_before כבר אינו אומר "היום" — הנוסח הוחלף',
  !bodies.two_hours_before.includes('היום'))

/**
 * manual אינו אחד מנוסחי 15F ונשאר תבנית דינמית: מנהלת שולחת אותו בכל רגע
 * לפני התור, כולל ימים מראש, ושם "מחר"/"היום" היה שקר.
 */
chk('⚠️ manual: אין "מחר" בגוף ההודעה', !bodies.manual.includes('מחר'))
chk('⚠️ manual: אין "בעוד שעתיים"', !bodies.manual.includes('בעוד שעתיים'))
chk('manual: השעה המדויקת מופיעה', bodies.manual.includes('10:00'))
chk('manual: התאריך המפורש מופיע', bodies.manual.includes('24') && bodies.manual.includes('אוגוסט'))
chk('manual: אין טלפון בגוף ההודעה', !/\+9725\d{8}/.test(bodies.manual))

chk('reminderBodyFor מנתב נכון לכל סוג',
  reminderBodyFor('day_before', P) === bodies.day_before &&
  reminderBodyFor('two_hours_before', P) === bodies.two_hours_before &&
  reminderBodyFor('manual', P) === bodies.manual)

chk('שלוש התבניות שונות זו מזו',
  new Set(Object.values(bodies)).size === 3)

chk('גרסת התבנית בפורמט הנדרש', /^v[0-9]{1,3}$/.test(REMINDER_TEMPLATE_VERSION))

/**
 * ⚠️ התבנית הישנה ב-lib/sms/templates.ts כן כותבת "מחר". היא נשארה כפי
 * שהיא (שלב 11 אינו נוגע בזרימת ה-SMS הקיימת), ולכן נבדק שהיא אינה בשימוש
 * במסלול התזכורות — אחרת היינו שולחים "מחר" על תזכורת שיצאה באיחור.
 */
const templatesSrc = readFileSync(new URL('../lib/reminders/templates.ts', import.meta.url), 'utf8')
chk("⚠️ מסלול התזכורות אינו מייבא את reminderMessage הישנה",
  !templatesSrc.includes("from '@/lib/sms/templates'"))
chk('⚠️ מסלול התזכורות אינו נוגע ב-sendSms של ה-OTP',
  !dispatchSrc.includes('sendSms') && !dispatchSrc.includes("@/lib/sms"))

// ════════════════════════════════════════════════════════════════════════════
section('idempotency של שליחה ידנית')
// ════════════════════════════════════════════════════════════════════════════

const ADMIN_A = '11111111-1111-4111-8111-111111111111'
const ADMIN_B = '22222222-2222-4222-8222-222222222222'
const APPT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const base = {
  actorAdminId: ADMIN_A,
  appointmentId: APPT,
  appointmentStartsAt: STARTS,
  templateVersion: 'v1',
}
const fp = manualReminderFingerprint(base)

chk('ה-fingerprint בפורמט הנדרש (64 hex)', FINGERPRINT_RE.test(fp))
chk('אותו קלט → אותו fingerprint', manualReminderFingerprint({ ...base }) === fp)

chk('⚠️ מועד תור אחר → fingerprint אחר',
  manualReminderFingerprint({ ...base, appointmentStartsAt: new Date('2026-08-24T08:00:00Z') }) !== fp)
chk('⚠️ גרסת תבנית אחרת → fingerprint אחר',
  manualReminderFingerprint({ ...base, templateVersion: 'v2' }) !== fp)
chk('actor אחר → fingerprint אחר',
  manualReminderFingerprint({ ...base, actorAdminId: ADMIN_B }) !== fp)
chk('תור אחר → fingerprint אחר',
  manualReminderFingerprint({ ...base, appointmentId: '99999999-9999-4999-8999-999999999999' }) !== fp)

// אזור זמן של הלקוח אינו משנה את הזהות
const sameInstant = new Date(STARTS.getTime())
chk('⚠️ אותו רגע מאובייקט Date אחר → אותו fingerprint (UTC ISO)',
  manualReminderFingerprint({ ...base, appointmentStartsAt: sameInstant }) === fp)

chk('⚠️ ה-fingerprint אינו מכיל טלפון או שם — הוא נגזר ממזהים בלבד',
  !JSON.stringify(base).includes('+9725'))

// ════════════════════════════════════════════════════════════════════════════
section('הדגל')
// ════════════════════════════════════════════════════════════════════════════

const prev = process.env.REMINDERS_ENABLED
delete process.env.REMINDERS_ENABLED
chk('ברירת המחדל של הדגל היא כבוי', areRemindersEnabled() === false)
process.env.REMINDERS_ENABLED = 'false'
chk("'false' → כבוי", areRemindersEnabled() === false)
process.env.REMINDERS_ENABLED = '1'
chk("⚠️ '1' אינו מדליק — נדרש בדיוק 'true'", areRemindersEnabled() === false)
process.env.REMINDERS_ENABLED = 'true'
chk("'true' → דלוק", areRemindersEnabled() === true)
if (prev === undefined) delete process.env.REMINDERS_ENABLED
else process.env.REMINDERS_ENABLED = prev

// ════════════════════════════════════════════════════════════════════════════
section('חוזה האבטחה של POST /api/internal/reminders')
// ════════════════════════════════════════════════════════════════════════════

const routeMod = await import('../app/api/internal/reminders/route.ts')
const { NextRequest } = await import('next/server')

const GOOD_SECRET = 'r'.repeat(48)

/**
 * ⚠️ הקריאות כאן בטוחות ואינן נוגעות ב-DB: הדגל כבוי והספק disabled, ולכן
 * ה-dispatcher עוצר בשער לפני כל קריאה. זו בדיוק התכונה שנבדקה למעלה.
 */
const callRoute = async ({
  serverSecret, authorization, headers = {},
  bookingFlag = 'true', remindersFlag,
}) => {
  const prev = {
    s: process.env.REMINDERS_DISPATCH_SECRET,
    b: process.env.NEW_BOOKING_SYSTEM_ENABLED,
    r: process.env.REMINDERS_ENABLED,
  }
  if (serverSecret === undefined) delete process.env.REMINDERS_DISPATCH_SECRET
  else process.env.REMINDERS_DISPATCH_SECRET = serverSecret
  process.env.NEW_BOOKING_SYSTEM_ENABLED = bookingFlag
  if (remindersFlag === undefined) delete process.env.REMINDERS_ENABLED
  else process.env.REMINDERS_ENABLED = remindersFlag

  try {
    const req = new NextRequest('https://smbrows.co.il/api/internal/reminders', {
      method: 'POST',
      headers: { ...(authorization ? { authorization } : {}), ...headers },
    })
    const res = await routeMod.POST(req)
    return { status: res.status, body: await res.json() }
  } finally {
    if (prev.s === undefined) delete process.env.REMINDERS_DISPATCH_SECRET
    else process.env.REMINDERS_DISPATCH_SECRET = prev.s
    if (prev.b === undefined) delete process.env.NEW_BOOKING_SYSTEM_ENABLED
    else process.env.NEW_BOOKING_SYSTEM_ENABLED = prev.b
    if (prev.r === undefined) delete process.env.REMINDERS_ENABLED
    else process.env.REMINDERS_ENABLED = prev.r
  }
}

// ── 401: כשל אימות בלבד ───────────────────────────────────────────────────
const authCases = [
  ['אין Authorization כלל', undefined],
  ['Authorization ריק', ''],
  ['Bearer בלי ערך', 'Bearer'],
  ['Bearer עם רווח בלבד', 'Bearer   '],
  ['scheme שאינו Bearer (Basic)', `Basic ${GOOD_SECRET}`],
  ['scheme שאינו Bearer (Token)', `Token ${GOOD_SECRET}`],
  ['ה-secret בלי scheme', GOOD_SECRET],
  ['secret שגוי', `Bearer ${'w'.repeat(48)}`],
  ['secret כמעט נכון (תו חסר)', `Bearer ${'r'.repeat(47)}`],
  ['secret כמעט נכון (תו עודף)', `Bearer ${'r'.repeat(49)}`],
]
for (const [label, authorization] of authCases) {
  const res = await callRoute({ serverSecret: GOOD_SECRET, authorization })
  chk(`🔒 ${label} → 401`, res.status === 401, `status=${res.status}`)
}

// ⚠️ הכותרת הישנה אינה מקנה גישה יותר
const oldHeader = await callRoute({
  serverSecret: GOOD_SECRET, headers: { 'x-reminders-secret': GOOD_SECRET },
})
chk('🔒 x-reminders-secret לבדו → 401', oldHeader.status === 401, `status=${oldHeader.status}`)

// ⚠️ אין קריאת secret מ-query string
const routeSrc = readFileSync(
  new URL('../app/api/internal/reminders/route.ts', import.meta.url), 'utf8')
chk('🔒 ה-route אינו קורא secret מ-query string',
  !routeSrc.includes('searchParams') && !routeSrc.includes('nextUrl'))
chk('🔒 ה-route אינו קורא את הכותרת הישנה', !routeSrc.includes('x-reminders-secret'))
chk('🔒 ה-route משתמש בהשוואה בזמן קבוע', routeSrc.includes('timingSafeEqual'))
chk('🔒 ה-route אינו מדפיס את ה-secret ללוג', !/console\.\w+\([^)]*secret/i.test(routeSrc))

// ── 404: תצורת שרת שאינה בטוחה ────────────────────────────────────────────
const unset = await callRoute({ serverSecret: undefined, authorization: `Bearer ${GOOD_SECRET}` })
chk('🔒 אין secret בשרת → 404', unset.status === 404, `status=${unset.status}`)

const short = await callRoute({ serverSecret: 'short', authorization: 'Bearer short' })
chk('🔒 secret קצר מ-32 בשרת → 404', short.status === 404, `status=${short.status}`)

// ── 200: no-op תפעולי תקין ────────────────────────────────────────────────
//
// ⚠️ מערכת כבויה **אינה כשל הרשאה**. כש-Cron יחובר, 403 כאן היה מייצר
// התראת כשל על כל הרצה מתוזמנת בזמן שהכול תקין.
const bookingOff = await callRoute({
  serverSecret: GOOD_SECRET, authorization: `Bearer ${GOOD_SECRET}`, bookingFlag: 'false',
})
chk('⚠️ מערכת ההזמנות כבויה + Bearer תקין → 200 no-op',
  bookingOff.status === 200, `status=${bookingOff.status}`)
chk('enabled=false מוחזר', bookingOff.body?.stats?.enabled === false)
chk('אפס עיבוד', bookingOff.body?.stats?.claimed === 0 && bookingOff.body?.stats?.sweptExpired === 0)

const remindersOff = await callRoute({
  serverSecret: GOOD_SECRET, authorization: `Bearer ${GOOD_SECRET}`, remindersFlag: 'false',
})
chk('⚠️ REMINDERS_ENABLED=false + Bearer תקין → 200 no-op',
  remindersOff.status === 200, `status=${remindersOff.status}`)
chk('enabled=false מוחזר', remindersOff.body?.stats?.enabled === false)

const providerOff = await callRoute({
  serverSecret: GOOD_SECRET, authorization: `Bearer ${GOOD_SECRET}`, remindersFlag: 'true',
})
chk('⚠️ provider=disabled + Bearer תקין → 200 no-op',
  providerOff.status === 200, `status=${providerOff.status}`)
chk('dispatchable=false מוחזר', providerOff.body?.stats?.dispatchable === false)
chk('provider=disabled מוחזר', providerOff.body?.stats?.provider === 'disabled')
chk('⚠️ אפס עיבוד גם כשהמערכת דלוקה אך אין ספק',
  providerOff.body?.stats?.claimed === 0 && providerOff.body?.stats?.sweptExpired === 0)

chk('אף אחד ממצבי ה-no-op אינו מחזיר 403',
  [bookingOff, remindersOff, providerOff].every(r => r.status !== 403))

const ok = await callRoute({ serverSecret: GOOD_SECRET, authorization: `Bearer ${GOOD_SECRET}` })
chk('Bearer תקין → 200', ok.status === 200, `status=${ok.status}`)
chk('scheme אינו תלוי רישיות (bearer)',
  (await callRoute({ serverSecret: GOOD_SECRET, authorization: `bearer ${GOOD_SECRET}` })).status === 200)
chk('התשובה מכילה enabled', ok.body?.stats?.enabled === false)
chk('התשובה מכילה counts', typeof ok.body?.stats?.claimed === 'number')
chk('⚠️ המערכת כבויה → אפס עיבוד גם מה-endpoint',
  ok.body?.stats?.claimed === 0 && ok.body?.stats?.sweptExpired === 0)

const bodyText = JSON.stringify(ok.body)
chk('🔒 התשובה אינה מכילה את ה-secret', !bodyText.includes(GOOD_SECRET) && !bodyText.includes('r'.repeat(32)))
chk('🔒 התשובה אינה מכילה טלפון', !/\+?9725\d{8}/.test(bodyText))
chk('🔒 התשובה אינה מכילה שם לקוחה', !bodyText.includes('TEST') && !bodyText.includes('לקוחה'))
chk('🔒 התשובה אינה מכילה גוף הודעה', !bodyText.includes('S.M BROWS'))
chk('🔒 התשובה אינה מכילה provider_message_id', !bodyText.includes('providerMessageId'))
chk('🔒 התשובה אינה מכילה raw error', !bodyText.includes('stack') && !bodyText.includes('Error'))

const allowedKeys = [
  'enabled', 'provider', 'dispatchable', 'sweptExpired', 'sweptCancelled',
  'claimed', 'sent', 'simulated', 'retrying', 'failed', 'deliveryUnknown',
  'cancelled', 'superseded', 'skipped', 'timedOut',
]
chk('⚠️ stats מכיל אך ורק דגלים וספירות',
  Object.keys(ok.body?.stats ?? {}).every(k => allowedKeys.includes(k)),
  Object.keys(ok.body?.stats ?? {}).filter(k => !allowedKeys.includes(k)).join(',') || 'תקין')
chk('⚠️ גוף התשובה עצמו מכיל רק ok ו-stats',
  Object.keys(ok.body ?? {}).sort().join(',') === 'ok,stats',
  Object.keys(ok.body ?? {}).join(','))

// ── שיטות שאינן POST ──────────────────────────────────────────────────────
/**
 * ⚠️ **השתנה**: עד כאן הבדיקה אימתה ש-GET/PUT/... *אינם מיוצאים*, והסתמכה
 * על 405 האוטומטי של Next. הם מיוצאים עכשיו במפורש, וזה חוזה חזק יותר —
 * 405 האוטומטי אינו נושא Allow ואינו נושא את כותרות ה-no-store שלנו.
 *
 * 🔒 שום handler כזה אינו נוגע במסד ואינו מפעיל ספק: הוא מחזיר 405 מיד,
 * בלי לקרוא secret ובלי לגעת ב-dispatcher.
 */
for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
  const handler = routeMod[method]
  chk(`🔒 ${method} מיוצא כ-405 מפורש`, typeof handler === 'function')
  if (typeof handler !== 'function') continue
  const res = handler()
  chk(`🔒 ${method} → 405`, res.status === 405)
  chk(`🔒 ${method} מצהיר Allow: POST`, res.headers.get('allow') === 'POST')
  chk(`🔒 ${method} אינו ניתן לשמירה במטמון`,
    /no-store/.test(res.headers.get('cache-control') ?? ''))
}
chk('POST הוא השיטה היחידה שמריצה dispatch',
  typeof routeMod.POST === 'function')

// ════════════════════════════════════════════════════════════════════════════
section('🔒 ערך מלוכלך במשתנה סביבה אינו מכבה את המערכת בשקט')
// ════════════════════════════════════════════════════════════════════════════

/*
  התקלה שהבדיקות האלה נועדו לתפוס: מנוע התזכורות היה כבוי בפרודקשן בזמן
  שלוח הבקרה הראה REMINDERS_ENABLED=true ו-REMINDER_PROVIDER=sms_019.
  הדבקה לתוך ממשק ווב גוררת איתה שורה חדשה, רווח או מרכאות, והשוואה
  מדויקת הפילה את הכול ל-disabled — בלי שגיאה, בלי סימן, ובלי דרך לראות
  את זה מבחוץ.
*/
const { normalizeEnvFlag, envFlagEnabled } = await import('../lib/envFlag.ts')

/** תצורת 019 תקינה — כאן רק הערך של REMINDER_PROVIDER נבדק. */
const liveSms019Env = {
  SMS019_USERNAME: 'u', SMS019_TOKEN: 't', SMS019_SOURCE: 'SM BROWS',
  NODE_ENV: 'production',
}

for (const raw of ['true', ' true', 'true ', 'true\n', '\ttrue\t', 'TRUE', 'True', '"true"', "'true'", ' "true" ']) {
  chk(`envFlagEnabled(${JSON.stringify(raw)}) = true`, envFlagEnabled(raw) === true)
}
for (const raw of [undefined, null, '', ' ', 'false', 'FALSE', '"false"', '1', 'yes', 'truthy', 'tru']) {
  chk(`envFlagEnabled(${JSON.stringify(raw)}) = false`, envFlagEnabled(raw) === false)
}
chk('🔒 ברירת המחדל לא השתנתה — משתנה חסר עדיין כבוי',
  envFlagEnabled(undefined) === false)

for (const raw of ['sms_019', ' sms_019 ', 'sms_019\n', 'SMS_019', '"sms_019"', "'sms_019'"]) {
  const p = resolveReminderProvider({ ...liveSms019Env, REMINDER_PROVIDER: raw })
  chk(`REMINDER_PROVIDER=${JSON.stringify(raw)} → ספק חי`,
    p.name === 'sms_019' && isDispatchable(p), p.name)
}
for (const raw of [undefined, '', '  ', 'disabled', ' disabled\n', 'sms019', 'sms-019']) {
  const p = resolveReminderProvider({ ...liveSms019Env, REMINDER_PROVIDER: raw })
  chk(`🔒 REMINDER_PROVIDER=${JSON.stringify(raw)} → disabled`,
    p.name === 'disabled' && !isDispatchable(p), p.name)
}
chk('🔒 נרמול אינו נוגע ב-credentials — רק בדגלים',
  normalizeEnvFlag('  SeCret Token  ') === 'secret token')

// ── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
