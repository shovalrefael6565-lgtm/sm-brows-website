/**
 * בדיקות מסירת התזכורות — מקצה לקצה, בלי רשת ובלי SMS אמיתי.
 *
 * ═══ מה מיוחד בקובץ הזה לעומת שלושת הקיימים ═══
 *
 *   test-reminders.mjs       — SQL בלבד (PGlite), בלי ה-dispatcher.
 *   test-reminders-core.mjs  — ה-dispatcher בלבד, מול DB מזויף.
 *   test-sms019.mjs          — הספק בלבד, מול fetch מזויף.
 *
 * ⚠️ שלושתם נחוצים ואף אחד מהם אינו מוכיח את מה שנשאל כאן: **שתזכורת של
 * תור אמיתי יוצאת בדיוק פעם אחת.** התשובה לשאלה הזו נמצאת בדיוק בתפר —
 * ה-RPCs של 0011 מול לולאת ה-dispatch מול ספק 019 — ותפר אינו נבדק ע"י
 * בדיקת שלושת הצדדים לחוד. לכן כאן מחוברים שלושתם: Postgres אמיתי
 * (PGlite, המיגרציות האמיתיות), `runReminderDispatch` האמיתי, ו-
 * `Sms019ReminderProvider` האמיתי — כשהדבר היחיד המזויף הוא `fetch`.
 *
 * 🔒 אפס SMS אמיתי, אפס רשת, אפס DB חיצוני. ה-fetch מוזרק, ו-PGlite רץ
 * בזיכרון התהליך. הבדיקה אינה קוראת ולו משתנה סביבה אחד של 019 אמיתי.
 *
 * הרצה:  npm run test:reminder-delivery
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', 'supabase', 'migrations')
const ALL_MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

/*
 * ⚠️ הבדיקה רצה בכוונה על **סכמת הפרודקשן בפועל** — עד 0030 ועד בכלל.
 *
 * לפני המיזוג זה קרה מאליו, כי 0031/0032 פשוט לא היו בענף. אחרי המיזוג הן
 * כאן, ולכן ההגבלה חייבת להיות מפורשת: 0031/0032 **טרם הופעלו על שום מסד
 * נתונים** (docs/privacy-production-rollout.md, סעיף 0), והקוד הזה ייפרס
 * לפרודקשן מול schema ≤0030. אם התיקון של מסירת התזכורות יסתמך בשקט על
 * טבלה או עמודה מ-0031/0032, הבדיקה הייתה ירוקה והפרודקשן היה נשבר.
 *
 * ⚠️ יש להסיר את ההגבלה רק אחרי ש-0031 ו-0032 הופעלו בפועל על הפרודקשן
 * (סעיף 3, צעדים 7–12) — ולא לפני.
 */
const PROD_SCHEMA_MAX = 30
const migNum = f => Number(f.slice(0, 4))
const MIGRATIONS = ALL_MIGRATIONS.filter(f => migNum(f) <= PROD_SCHEMA_MAX)

// ════════════════════════════════════════════════════════════════════════════
section('הקמת Postgres אמיתי בזיכרון + המיגרציות')
// ════════════════════════════════════════════════════════════════════════════

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, phone text);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
`)

const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const uuid = () => crypto.randomUUID()

const ADMIN_AUTH = uuid()
for (const name of MIGRATIONS) {
  if (name.startsWith('0010')) {
    await db.exec(`
      insert into auth.users values ('${ADMIN_AUTH}', '972541110002');
      insert into customers (id, phone_e164, full_name)
        values ('${ADMIN_AUTH}', '+972541110002', 'שובל');
      insert into admins (user_id) values ('${ADMIN_AUTH}');
    `)
  }
  try {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  } catch (e) {
    chk(`${name} רצה`, false, e.message)
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו`, true)

// ⚠️ ההגבלה מוכיחה שהתיקון אינו תלוי ב-0031/0032, שטרם הופעלו בפרודקשן.
chk('⚠️ הבדיקה רצה על סכמת הפרודקשן בפועל (עד 0030, בלי 0031/0032)',
  MIGRATIONS.every(m => migNum(m) <= PROD_SCHEMA_MAX),
  MIGRATIONS[MIGRATIONS.length - 1])

/*
 * 🔒 ההגבלה למעלה חייבת להיות הגבלה אמיתית ולא no-op. אם 0031/0032 ייעלמו
 * מהעץ (או יקבלו מספור אחר), הסינון היה מפסיק לסנן דבר והבדיקה הייתה
 * ממשיכה להיות ירוקה בזמן שהיא כבר אינה בודקת כלום.
 */
chk('🔒 ההגבלה אכן פעילה — 0031/0032 קיימות בעץ והוחרגו במפורש',
  ALL_MIGRATIONS.length > MIGRATIONS.length
    && ALL_MIGRATIONS.some(m => m.startsWith('0031'))
    && ALL_MIGRATIONS.some(m => m.startsWith('0032')),
  `הורצו ${MIGRATIONS.length} מתוך ${ALL_MIGRATIONS.length}`)

// ════════════════════════════════════════════════════════════════════════════
// גשר: ה-RPCs של 0011 בחתימה של lib/db/reminders.ts
//
// ⚠️ אינו מדמה את ה-RPC ואינו מחקה אותו — הוא **קורא לו**. ההחלטות
// (claim, lease, precheck, סגירת ניסיון) מתקבלות ב-SQL האמיתי, וזה כל
// הטעם: גשר שמחקה את הלוגיקה היה בודק את החיקוי.
// ════════════════════════════════════════════════════════════════════════════

const rpc = async (fn, args) => {
  const keys = Object.keys(args)
  const ph = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  const r = await one(`select public.${fn}(${ph}) as out`, keys.map(k => args[k]))
  return r.out
}

const LEASE_SECONDS = 120

const pgDb = {
  sweepExpiredReminders: async () => {
    const out = await rpc('sweep_expired_reminders', {})
    return { expired: out?.expired ?? 0, cancelled: out?.cancelled ?? 0 }
  },
  claimDueReminder: async (leaseToken, provider, maxAttempts) => {
    const out = await rpc('claim_due_reminder', {
      p_lease_token: leaseToken, p_lease_seconds: LEASE_SECONDS,
      p_max_attempts: maxAttempts, p_provider: provider,
    })
    if (!out?.claimed || !out.reminder) return null
    return {
      reminder: out.reminder,
      appointmentStatus: out.appointment_status ?? '',
      appointmentStartsAt: out.appointment_starts_at ?? '',
      appointmentDurationMin: out.appointment_duration_min ?? 0,
    }
  },
  reminderPrecheck: async (reminderId, leaseToken) => {
    const out = await rpc('reminder_precheck', {
      p_reminder_id: reminderId, p_lease_token: leaseToken,
    })
    return out?.ok ? { ok: true } : { ok: false, reason: out?.reason ?? 'lease_lost' }
  },
  loadReminderRecipient: async appointmentId => {
    const r = await one(`
      select a.service_key, a.variants, c.phone_e164
      from appointments a join customers c on c.id = a.customer_id
      where a.id = $1`, [appointmentId])
    if (!r?.phone_e164) return null
    return { phoneE164: r.phone_e164, serviceKey: r.service_key, variants: r.variants ?? [] }
  },
  finishReminderAttempt: async p => rpc('finish_reminder_attempt', {
    p_reminder_id: p.reminderId, p_lease_token: p.leaseToken, p_outcome: p.outcome,
    p_error_code: p.errorCode, p_provider_message_id: p.providerMessageId,
    p_provider: p.provider, p_max_attempts: p.maxAttempts ?? 4,
    p_appointment_changed: p.appointmentChanged,
  }),
  abortReminderAttempt: async (reminderId, leaseToken, reason) => rpc('abort_reminder_attempt', {
    p_reminder_id: reminderId, p_lease_token: leaseToken, p_reason: reason,
  }),
}

// ════════════════════════════════════════════════════════════════════════════
// הספק — 019 האמיתי, מול fetch מזויף
// ════════════════════════════════════════════════════════════════════════════

const { Sms019ReminderProvider } = await import('../lib/reminders/sms019.ts')
const { SMS019_API_URL } = await import('../lib/reminders/sms019Mapping.ts')
const { runReminderDispatch, TWO_HOURS_FRESHNESS_MS, isReminderStillTruthful } =
  await import('../lib/reminders/dispatch.ts')
const { REMINDER_SMS, SMS_MAX_CHARS, smsLength, hasEmoji } =
  await import('../lib/messageTemplates.ts')

const CFG = { username: 'u', token: 't', source: 'SM BROWS', timeoutMs: 5000 }

/** מתעד כל בקשה יוצאת, ועונה לפי תסריט. ברירת המחדל — קבלה תקינה. */
function mkProvider(reply = () => ({ status: 0, shipment_id: 'ship-1' })) {
  const calls = []
  let seq = 0
  const fetchSpy = async (url, init) => {
    const payload = JSON.parse(init.body)
    calls.push({ url, payload, authorization: init.headers.Authorization })
    const body = reply(++seq, payload)
    if (body instanceof Error) throw body
    return {
      status: body.__http ?? 200,
      json: async () => {
        if (body.__badJson) throw new Error('bad json')
        return body
      },
    }
  }
  return {
    calls,
    provider: new Sms019ReminderProvider(CFG, { fetch: fetchSpy, log: () => {} }),
  }
}

/** ריצת dispatch אחת, עם הדגלים דלוקים ובלי לגעת בשעון. */
const runDispatch = async (provider, extra = {}) => {
  const prev = {
    r: process.env.REMINDERS_ENABLED,
    b: process.env.NEW_BOOKING_SYSTEM_ENABLED,
  }
  process.env.REMINDERS_ENABLED = 'true'
  process.env.NEW_BOOKING_SYSTEM_ENABLED = 'true'
  try {
    return await runReminderDispatch({ provider, db: pgDb, maxAttempts: 4, ...extra })
  } finally {
    if (prev.r === undefined) delete process.env.REMINDERS_ENABLED
    else process.env.REMINDERS_ENABLED = prev.r
    if (prev.b === undefined) delete process.env.NEW_BOOKING_SYSTEM_ENABLED
    else process.env.NEW_BOOKING_SYSTEM_ENABLED = prev.b
  }
}

// ── זריעה ──────────────────────────────────────────────────────────────────

let phoneSeq = 0
const mkCustomer = async () => {
  const id = uuid()
  await q(`insert into customers (id, phone_e164, full_name) values ($1, $2, $3)`,
    [id, '+9725' + String(41000000 + phoneSeq++), 'TEST לקוחה'])
  return id
}

let slotSeq = 0
/** תור לכל יום משלו — appointments_no_overlap חל על כל התורים, לא לפי לקוחה. */
const mkAppt = async (customerId, interval = null, status = 'confirmed') => one(`
  insert into appointments (customer_id, service_key, starts_at, duration_min, ends_at,
                            status, calendar_sync_status, calendar_sync_operation)
  values ($1, 'natural', now() + $2::interval, 20, now(), $3, 'pending', 'upsert')
  returning id, starts_at`,
  [customerId, interval ?? `${2 + slotSeq++} days`, status])

const remindersOf = async apptId => q(`
  select id, reminder_kind, status, outcome_reason, attempt_count, provider,
         provider_message_id, sent_at, scheduled_for, expires_at, appointment_starts_at
  from appointment_reminders where appointment_id = $1
  order by appointment_starts_at, reminder_kind`, [apptId])

const attemptsOf = async reminderId => q(`
  select attempt_number, outcome, error_code, provider, provider_message_id
  from appointment_reminder_attempts where reminder_id = $1 order by attempt_number`,
  [reminderId])

/**
 * מזיז תזכורת אחורה בזמן כדי שתהפוך due, בלי לגעת בתור עצמו.
 *
 * ⚠️ זו הדרך היחידה לבדוק "scheduler מאוחר" בלי שעון מזויף: מה שקובע הוא
 * היחס בין scheduled_for ל-now() האמיתי של Postgres, וכאן הוא נקבע במפורש.
 */
const makeDue = async (reminderId, ago = '1 minute') =>
  q(`update appointment_reminders
     set scheduled_for = now() - $2::interval
     where id = $1`, [reminderId, ago])

// ════════════════════════════════════════════════════════════════════════════
section('הנוסחים — שתי התבניות המדויקות')
// ════════════════════════════════════════════════════════════════════════════

const EXPECTED = {
  day_before: 'תזכורת: יש לך תור מחר. לפרטים: https://smbrows.co.il/account',
  two_hours_before: 'תזכורת: התור שלך בעוד שעתיים. לפרטים: https://smbrows.co.il/account',
}

for (const kind of ['day_before', 'two_hours_before']) {
  chk(`🔒 ${kind}: הנוסח הוא בדיוק הטקסט המאושר`,
    REMINDER_SMS[kind] === EXPECTED[kind], JSON.stringify(REMINDER_SMS[kind]))
  chk(`${kind}: ${smsLength(REMINDER_SMS[kind])}/${SMS_MAX_CHARS} תווים — מקטע יחיד`,
    smsLength(REMINDER_SMS[kind]) <= SMS_MAX_CHARS)
  chk(`${kind}: אפס אמוג'י`, !hasEmoji(REMINDER_SMS[kind]))
}

/**
 * 🔒 אפס PII ואפס בנייה דינמית.
 *
 * ⚠️ נבדק על **המחרוזת הסופית** ולא על התבנית: תבנית "נקייה" שמורכבת
 * בזמן ריצה עם שם או שעה הייתה עוברת בדיקה על הקוד ונכשלת על הלקוחה.
 */
const PII_PATTERNS = [
  [/\+?9725\d{6,}/, 'מספר טלפון'],
  [/\d{1,2}:\d{2}/, 'שעה'],
  [/\d{1,2}[./]\d{1,2}/, 'תאריך'],
  [/₪|\bש"ח\b/, 'מחיר'],
  [/\$\{|\{\{|%s|__[A-Z]/, 'placeholder'],
]
for (const kind of ['day_before', 'two_hours_before']) {
  for (const [re, label] of PII_PATTERNS) {
    chk(`🔒 ${kind}: אין ${label}`, !re.test(REMINDER_SMS[kind]))
  }
}

const tmplSrc = readFileSync(join(HERE, '..', 'lib', 'reminders', 'templates.ts'), 'utf8')
chk('🔒 dayBeforeReminderBody אינו מקבל פרמטרים (אין builder דינמי)',
  /export function dayBeforeReminderBody\(\)/.test(tmplSrc))
chk('🔒 twoHoursBeforeReminderBody אינו מקבל פרמטרים',
  /export function twoHoursBeforeReminderBody\(\)/.test(tmplSrc))

// ════════════════════════════════════════════════════════════════════════════
section('תור confirmed — day_before יוצאת בדיוק פעם אחת')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const before = await remindersOf(a.id)
  chk('התור נוצר עם שתי תזכורות scheduled',
    before.length === 2 && before.every(r => r.status === 'scheduled'),
    before.map(r => `${r.reminder_kind}:${r.status}`).join(' '))

  const day = before.find(r => r.reminder_kind === 'day_before')
  await makeDue(day.id)

  const { calls, provider } = mkProvider()
  const s1 = await runDispatch(provider)
  chk('ריצה ראשונה שלחה תזכורת אחת', s1.sent === 1, JSON.stringify(s1))
  chk('הספק נקרא בדיוק פעם אחת', calls.length === 1)
  chk('🔒 גוף ההודעה ששוגר הוא בדיוק נוסח day_before',
    calls[0].payload?.sms?.message === EXPECTED.day_before,
    JSON.stringify(calls[0].payload?.sms?.message))

  const after = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  chk('השורה סומנה sent', after.status === 'sent', after.status)
  chk('נשמר provider_message_id מהספק', after.provider_message_id === 'ship-1')
  chk('provider נרשם sms_019', after.provider === 'sms_019')

  // ── הרצה שנייה מיד אחריה — לא שולחת שוב ─────────────────────────────────
  const s2 = await runDispatch(mkProvider().provider)
  chk('🔒 ריצה שנייה אינה שולחת שוב', s2.sent === 0 && s2.claimed === 0, JSON.stringify(s2))
  const rows2 = await remindersOf(a.id)
  chk('🔒 עדיין שורת day_before אחת בלבד',
    rows2.filter(r => r.reminder_kind === 'day_before').length === 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('תור confirmed — two_hours_before יוצאת בדיוק פעם אחת')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const two = (await remindersOf(a.id)).find(r => r.reminder_kind === 'two_hours_before')
  await makeDue(two.id)

  const { calls, provider } = mkProvider(() => ({ status: 0, shipment_id: 'ship-2h' }))
  const s = await runDispatch(provider)
  chk('נשלחה תזכורת אחת', s.sent === 1, JSON.stringify(s))
  chk('🔒 הגוף הוא בדיוק נוסח two_hours_before',
    calls[0].payload?.sms?.message === EXPECTED.two_hours_before)

  const after = (await remindersOf(a.id)).find(r => r.reminder_kind === 'two_hours_before')
  chk('סומנה sent עם מזהה משלוח', after.status === 'sent' && after.provider_message_id === 'ship-2h')

  const s2 = await runDispatch(mkProvider().provider)
  chk('🔒 ריצה נוספת אינה שולחת שוב', s2.sent === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('scheduler מאוחר — משלים תזכורת שהפכה due ולא מפספס אותה')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const day = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  // ⚠️ איחור של 4 שעות — הרבה מעבר לתדירות ה-scheduler (5 דקות), ועדיין
  // בתוך חלון ה-6 שעות של day_before.
  await makeDue(day.id, '4 hours')

  const { calls, provider } = mkProvider()
  const s = await runDispatch(provider)
  chk('⚠️ scheduler שאיחר ב-4 שעות עדיין שולח day_before', s.sent === 1, JSON.stringify(s))
  chk('הודעה אחת בלבד יצאה', calls.length === 1)
}

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const two = (await remindersOf(a.id)).find(r => r.reminder_kind === 'two_hours_before')
  await makeDue(two.id, '20 minutes')
  const s = await runDispatch(mkProvider().provider)
  chk('⚠️ scheduler שאיחר ב-20 דקות עדיין שולח two_hours_before', s.sent === 1,
    JSON.stringify(s))
}

// ── חסם הרעננות של "בעוד שעתיים" ──────────────────────────────────────────
{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const two = (await remindersOf(a.id)).find(r => r.reminder_kind === 'two_hours_before')
  await makeDue(two.id, '90 minutes')

  const { calls, provider } = mkProvider()
  const s = await runDispatch(provider)
  chk('🔒 איחור של 90 דקות → "בעוד שעתיים" אינו נשלח', s.sent === 0, JSON.stringify(s))
  chk('🔒 הספק לא נקרא כלל', calls.length === 0)
  const after = (await remindersOf(a.id)).find(r => r.reminder_kind === 'two_hours_before')
  chk('⚠️ נשארת עקבה נראית: skipped / expired_before_send',
    after.status === 'skipped' && after.outcome_reason === 'expired_before_send',
    `${after.status}/${after.outcome_reason}`)
}

chk('חסם הרעננות הוא חצי שעה', TWO_HOURS_FRESHNESS_MS === 30 * 60 * 1000)
chk('🔒 day_before אינו כפוף לחסם הרעננות',
  isReminderStillTruthful('day_before', 0, 10 * 60 * 60 * 1000) === true)
chk('🔒 manual אינו כפוף לחסם הרעננות',
  isReminderStillTruthful('manual', 0, 10 * 60 * 60 * 1000) === true)
chk('two_hours_before בדיוק על הגבול — עדיין תקף',
  isReminderStillTruthful('two_hours_before', 0, TWO_HOURS_FRESHNESS_MS) === true)
chk('two_hours_before שנייה אחרי הגבול — נפסל',
  isReminderStillTruthful('two_hours_before', 0, TWO_HOURS_FRESHNESS_MS + 1) === false)

// ════════════════════════════════════════════════════════════════════════════
section('🔒 שתי ריצות מקבילות אינן שולחות פעמיים')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const day = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  await makeDue(day.id)

  const p1 = mkProvider(() => ({ status: 0, shipment_id: 'par-1' }))
  const p2 = mkProvider(() => ({ status: 0, shipment_id: 'par-2' }))
  const [s1, s2] = await Promise.all([runDispatch(p1.provider), runDispatch(p2.provider)])

  const totalSent = s1.sent + s2.sent
  const totalCalls = p1.calls.length + p2.calls.length
  chk('🔒 שתי ריצות במקביל → שליחה אחת בסך הכול', totalSent === 1,
    `sent=${totalSent} ${JSON.stringify([s1.sent, s2.sent])}`)
  chk('🔒 הספק נקרא פעם אחת בסך הכול', totalCalls === 1, `calls=${totalCalls}`)

  const after = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  chk('השורה sent', after.status === 'sent')
  chk('attempt_count אחד', after.attempt_count === 1, `attempts=${after.attempt_count}`)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 סטטוסים שאינם confirmed — אין שליחה')
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ אין ערך 'rejected' ב-enum: דחיית בקשה נרשמת כ-cancelled_by_business
 * (ראה reject_pending_appointment ב-0004), וזה מה שנבדק כאן.
 */
for (const status of [
  'cancelled_by_customer', 'cancelled_by_business', 'completed',
  'no_show', 'expired', 'rescheduled',
]) {
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const day = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  await makeDue(day.id)
  await q(`update appointments set status = $2 where id = $1`, [a.id, status])

  const { calls, provider } = mkProvider()
  const s = await runDispatch(provider)
  chk(`🔒 ${status} → אפס שליחות`, s.sent === 0 && calls.length === 0,
    `sent=${s.sent} calls=${calls.length}`)
  const rows = await remindersOf(a.id)
  chk(`🔒 ${status} → אין אף שורה sent`, rows.every(r => r.status !== 'sent'),
    rows.map(r => r.status).join(','))
}

// pending — אינו מייצר תזכורת פעילה מלכתחילה
{
  const c = await mkCustomer()
  const a = await mkAppt(c, null, 'pending')
  const rows = await remindersOf(a.id)
  chk('🔒 pending → אין אף תזכורת scheduled',
    rows.every(r => r.status !== 'scheduled'), `count=${rows.length}`)
  const { calls, provider } = mkProvider()
  const s = await runDispatch(provider)
  chk('🔒 pending → הספק לא נקרא', s.sent === 0 && calls.length === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('ביטול אחרי יצירת התזכורת ולפני ה-claim')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const day = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  await makeDue(day.id)

  // הביטול קורה אחרי שהשורה קיימת ולפני שהספק פועל.
  await q(`update appointments set status = 'cancelled_by_customer' where id = $1`, [a.id])

  const rowsAfterCancel = await remindersOf(a.id)
  chk('⚠️ הביטול הוריד את שתי התזכורות מהמסלול מיד',
    rowsAfterCancel.every(r => r.status === 'cancelled'),
    rowsAfterCancel.map(r => r.status).join(','))
  chk('הסיבה נרשמה',
    rowsAfterCancel.every(r => r.outcome_reason === 'appointment_cancelled_by_customer'))

  const { calls, provider } = mkProvider()
  const s = await runDispatch(provider)
  chk('🔒 אין claim ואין שליחה', s.claimed === 0 && calls.length === 0, JSON.stringify(s))
}

// ════════════════════════════════════════════════════════════════════════════
section('שינוי מועד — הישן מנוטרל, החדש מוכן')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const oldRows = await remindersOf(a.id)
  const oldIds = new Set(oldRows.map(r => r.id))
  await makeDue(oldRows.find(r => r.reminder_kind === 'day_before').id)

  // הזזה ב-3 שעות — נשאר באותו יום ולכן אינו מתנגש בתור אחר.
  const moved = await one(
    `update appointments set starts_at = starts_at + interval '3 hours' where id = $1
     returning starts_at`, [a.id])

  const rows = await remindersOf(a.id)
  const old = rows.filter(r => oldIds.has(r.id))
  const fresh = rows.filter(r => !oldIds.has(r.id))

  chk('🔒 שתי התזכורות של המועד הישן → superseded',
    old.length === 2 && old.every(r => r.status === 'superseded'),
    old.map(r => r.status).join(','))
  chk('הסיבה היא starts_at_changed',
    old.every(r => r.outcome_reason === 'starts_at_changed'))
  chk('⚠️ נוצרו שתי תזכורות חדשות למועד החדש', fresh.length === 2, `count=${fresh.length}`)
  chk('שתיהן scheduled', fresh.every(r => r.status === 'scheduled'))
  chk('ה-snapshot שלהן הוא המועד החדש',
    fresh.every(r => new Date(r.appointment_starts_at).getTime()
      === new Date(moved.starts_at).getTime()))
  chk('⚠️ אין שכפול — ארבע שורות בסך הכול, לא יותר', rows.length === 4, `count=${rows.length}`)

  const { calls, provider } = mkProvider()
  const s = await runDispatch(provider)
  chk('🔒 המועד הישן אינו נשלח', s.sent === 0 && calls.length === 0, JSON.stringify(s))
}

// ════════════════════════════════════════════════════════════════════════════
section('retry — אותו idempotency key, ואותו external_id')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const day = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  await makeDue(day.id)

  // ניסיון ראשון: שגיאה זמנית מוכחת (429 → retryable).
  const first = mkProvider(() => ({ __http: 429 }))
  const s1 = await runDispatch(first.provider)
  chk('שגיאה זמנית → retrying', s1.retrying === 1, JSON.stringify(s1))

  const mid = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  chk('⚠️ לא סומן sent', mid.status === 'retrying', mid.status)
  chk('⚠️ אין provider_message_id', mid.provider_message_id === null)

  // ה-backoff דוחה את הניסיון הבא; מקדימים אותו כדי לבדוק את ה-retry עצמו.
  await q(`update appointment_reminders set next_attempt_at = now() - interval '1 minute'
           where id = $1`, [day.id])

  const second = mkProvider(() => ({ status: 0, shipment_id: 'ship-retry' }))
  const s2 = await runDispatch(second.provider)
  chk('הניסיון החוזר הצליח', s2.sent === 1, JSON.stringify(s2))

  const extIdOf = call => call.payload?.sms?.destinations?.phone?.[0]?.$?.id
  chk('🔒 שני הניסיונות נשאו את אותו external_id',
    extIdOf(first.calls[0]) !== undefined &&
    extIdOf(first.calls[0]) === extIdOf(second.calls[0]),
    `${extIdOf(first.calls[0])} / ${extIdOf(second.calls[0])}`)
  chk('🔒 ה-external_id הוא reminder.id ולא מספר ניסיון/חותמת זמן',
    extIdOf(first.calls[0]) === day.id, String(extIdOf(first.calls[0])))

  const atts = await attemptsOf(day.id)
  chk('נרשמו שני ניסיונות נפרדים', atts.length === 2, `count=${atts.length}`)
  chk('הראשון retryable_error, השני accepted',
    atts[0].outcome === 'retryable_error' && atts[1].outcome === 'accepted',
    atts.map(x => x.outcome).join(','))
}

// ════════════════════════════════════════════════════════════════════════════
section('019 — מספר מקומי תקין, ותשובה בלי shipment_id')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = await mkCustomer()
  const phone = (await one(`select phone_e164 from customers where id = $1`, [c])).phone_e164
  const a = await mkAppt(c)
  const day = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  await makeDue(day.id)

  const { calls, provider } = mkProvider()
  await runDispatch(provider)

  const dest = calls[0].payload?.sms?.destinations?.phone?.[0]?._
  chk('🔒 היעד נשלח בפורמט מקומי 05XXXXXXXX',
    typeof dest === 'string' && /^05\d{8}$/.test(dest), String(dest))
  chk('🔒 היעד אינו E.164 (019 אינו מקבל +972)', !String(dest).includes('+972'))
  chk('היעד תואם למספר הלקוחה', String(dest) === phone.replace('+972', '0'))
  chk('הכתובת היא SMS019_API_URL הקבועה', calls[0].url === SMS019_API_URL)
}

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const day = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  await makeDue(day.id)

  // 🔒 hotfix של origin/main: status:0 בלי shipment_id אינו הצלחה.
  const { provider } = mkProvider(() => ({ status: 0 }))
  const s = await runDispatch(provider)
  chk('🔒 תשובה בלי shipment_id אינה נרשמת sent', s.sent === 0, JSON.stringify(s))
  chk('היא נרשמת delivery_unknown', s.deliveryUnknown === 1)

  const after = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  chk('🔒 הסטטוס במסד אינו sent', after.status === 'delivery_unknown', after.status)
  chk('🔒 אין provider_message_id מומצא', after.provider_message_id === null)
  const atts = await attemptsOf(after.id)
  chk('⚠️ קוד השגיאה מפורש ונשמר',
    atts[0].error_code === 'sms019_accepted_without_shipment_id', String(atts[0].error_code))
}

// ════════════════════════════════════════════════════════════════════════════
section('כשל ספק — עקבה נראית, והתור אינו משתנה')
// ════════════════════════════════════════════════════════════════════════════

{
  const c = await mkCustomer()
  const a = await mkAppt(c)
  const apptBefore = await one(
    `select status, starts_at, duration_min from appointments where id = $1`, [a.id])
  const day = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  await makeDue(day.id)

  // 401 → permanent_error (credentials פסולים).
  const { provider } = mkProvider(() => ({ __http: 401 }))
  await runDispatch(provider)

  const after = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  chk('⚠️ התזכורת נושאת סטטוס כושל גלוי',
    ['failed', 'retrying'].includes(after.status), after.status)
  chk('⚠️ קוד השגיאה נשמר בשורה', typeof after.outcome_reason === 'string' ||
    (await attemptsOf(after.id))[0].error_code !== null)
  const atts = await attemptsOf(after.id)
  chk('⚠️ הניסיון תועד באודיט', atts.length === 1 && atts[0].outcome === 'permanent_error',
    atts.map(x => x.outcome).join(','))
  chk('🔒 קוד השגיאה של 019 מזוהה ולא מוסתר',
    String(atts[0].error_code).startsWith('sms019_'), String(atts[0].error_code))

  const apptAfter = await one(
    `select status, starts_at, duration_min from appointments where id = $1`, [a.id])
  chk('🔒 כשל SMS לא שינה את התור',
    apptAfter.status === apptBefore.status &&
    new Date(apptAfter.starts_at).getTime() === new Date(apptBefore.starts_at).getTime() &&
    apptAfter.duration_min === apptBefore.duration_min)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 endpoint ללא הרשאה — אפס נגיעה במסד ובספק')
// ════════════════════════════════════════════════════════════════════════════

{
  const routeMod = await import('../app/api/internal/reminders/route.ts')
  const { NextRequest } = await import('next/server')

  const c = await mkCustomer()
  const a = await mkAppt(c)
  const day = (await remindersOf(a.id)).find(r => r.reminder_kind === 'day_before')
  await makeDue(day.id)

  /**
   * ⚠️ ה-route קורא ל-runReminderDispatch **בלי deps**, כלומר ל-Supabase
   * האמיתי. הבדיקה נשענת על כך שקריאה לא-מורשית עוצרת לפני זה: אילו היא
   * לא הייתה עוצרת, היא הייתה מנסה לפתוח חיבור חיצוני והבדיקה הייתה
   * נכשלת — וזה בדיוק מה שהיא באה להוכיח.
   */
  const call = async (authorization, headers = {}) => {
    const prev = process.env.REMINDERS_DISPATCH_SECRET
    process.env.REMINDERS_DISPATCH_SECRET = 'x'.repeat(48)
    try {
      const req = new NextRequest('https://smbrows.co.il/api/internal/reminders', {
        method: 'POST',
        headers: { ...(authorization ? { authorization } : {}), ...headers },
      })
      const res = await routeMod.POST(req)
      return { status: res.status, headers: res.headers, body: await res.json() }
    } finally {
      if (prev === undefined) delete process.env.REMINDERS_DISPATCH_SECRET
      else process.env.REMINDERS_DISPATCH_SECRET = prev
    }
  }

  for (const [label, auth] of [
    ['בלי כותרת', undefined],
    ['Bearer ריק', 'Bearer '],
    ['scheme אחר', 'Basic ' + 'x'.repeat(48)],
    ['טוקן שגוי', 'Bearer ' + 'y'.repeat(48)],
    ['טוקן בקידומת נכונה', 'Bearer ' + 'x'.repeat(47)],
  ]) {
    const res = await call(auth)
    chk(`🔒 ${label} → 401`, res.status === 401, `status=${res.status}`)
    chk(`🔒 ${label} → אינו ניתן לשמירה במטמון`,
      /no-store/.test(res.headers.get('cache-control') ?? ''))
  }

  const rows = await remindersOf(a.id)
  chk('🔒 אף שורה לא נגעו בה — עדיין scheduled',
    rows.every(r => r.status === 'scheduled'), rows.map(r => r.status).join(','))
  chk('🔒 אף ניסיון לא נפתח',
    (await attemptsOf(day.id)).length === 0)

  // ── secret חסר בשרת → 404, גם עם טוקן ─────────────────────────────────
  const prev = process.env.REMINDERS_DISPATCH_SECRET
  delete process.env.REMINDERS_DISPATCH_SECRET
  const noSecret = await (async () => {
    const req = new NextRequest('https://smbrows.co.il/api/internal/reminders', {
      method: 'POST', headers: { authorization: 'Bearer ' + 'x'.repeat(48) },
    })
    const res = await routeMod.POST(req)
    return { status: res.status, headers: res.headers }
  })()
  if (prev !== undefined) process.env.REMINDERS_DISPATCH_SECRET = prev
  chk('🔒 אין secret בשרת → 404 (ה-endpoint אינו מסגיר את קיומו)',
    noSecret.status === 404, `status=${noSecret.status}`)
  chk('🔒 גם 404 אינו נשמר במטמון',
    /no-store/.test(noSecret.headers.get('cache-control') ?? ''))

  // ── גוף גדול מדי → 413, לפני האימות ───────────────────────────────────
  const tooBig = await call(undefined, { 'content-length': '999999' })
  chk('🔒 גוף גדול מדי → 413 עוד לפני בדיקת ההרשאה', tooBig.status === 413,
    `status=${tooBig.status}`)
  const okLen = await call('Bearer ' + 'y'.repeat(48), { 'content-length': '10' })
  chk('גוף קטן עובר לבדיקת ההרשאה (401 ולא 413)', okLen.status === 401)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 אפס רשת אמיתית')
// ════════════════════════════════════════════════════════════════════════════

const srcOfTest = readFileSync(join(HERE, 'test-reminder-delivery.mjs'), 'utf8')
chk('🔒 הבדיקה אינה קוראת ל-fetch הגלובלי',
  !/(^|[^.\w])fetch\(/.test(srcOfTest.replace(/deps\.fetch|fetchSpy|fetch:/g, '')))
/**
 * ⚠️ שמות המשתנים נבנים בזמן ריצה ולא נכתבים כליטרל: קובץ שסורק את עצמו
 * ומחפש מחרוזת שהוא בעצמו מכיל היה נכשל תמיד, מהסיבה הלא נכונה.
 */
const envNeedle = prefix => 'process.env.' + prefix
chk('🔒 אין קריאה למשתני 019 אמיתיים בבדיקה',
  !srcOfTest.includes(envNeedle('SMS' + '019')))
chk('🔒 אין קריאה למשתני Supabase בבדיקה',
  !srcOfTest.includes(envNeedle('SUPA' + 'BASE')))

// ── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
