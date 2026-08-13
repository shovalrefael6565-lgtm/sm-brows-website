/**
 * 0030 — נורמליזציית נתונים קיימים (חלק 7), מול Postgres אמיתי (PGlite).
 *
 * ═══ למה הסוויטה הזו קיימת ═══
 *
 * 0030 מבטלת תפוגה מבוססת-זמן לבקשות pending, אבל שורות שנוצרו **לפני**
 * שהיא הוחלה כבר נושאות pending_expires_at אמיתי (מהגרסה הישנה של
 * שלוש פונקציות היצירה). בלי backfill, שובל הייתה ממשיכה לראות "פגה
 * בעוד X" על בקשות פעילות במסך הניהול — הטעיה, כי בפועל שום דבר לא
 * יקרה כשהזמן הזה מגיע.
 *
 * הסוויטה הזו בונה מסד עם 0001–0029 בלבד (המצב **לפני** 0030), זורעת
 * שורות שמדמות פרודקשן באותה נקודת זמן — pending עם תפוגה שכבר עברה,
 * pending עם תפוגה עתידית, בקשת שינוי מועד pending, שורה שכבר expired,
 * ושורות confirmed/rejected עם pending_expires_at שיורי (edge case) —
 * ואז מריצה את 0030 ובודקת בדיוק את מה שהיא אמורה לעשות ורק את זה.
 *
 * ═══ מה נבדק ═══
 *
 *   1. שורת pending עם תפוגה ישנה → pending_expires_at הופך null
 *   2. השורה נשארת pending (לא משתנה סטטוס)
 *   3. השורה עדיין חוסמת את הסלוט שלה (EXCLUDE constraint)
 *   4. שורה שכבר expired נשארת expired — לא "מוחייאת", ולא נוגעים בה כלל
 *   5. בקשת שינוי מועד pending מתנהגת אותו דבר בדיוק (אותה טבלה/עמודה)
 *   6. שורות שאינן pending (confirmed/rejected) עם pending_expires_at
 *      שיורי לא נוגעות — לא רק status, גם העמודה עצמה
 *   7. idempotency: הרצה חוזרת של אותו UPDATE לא כותבת דבר בפעם השנייה
 *
 * הרצה:  npm run test:0030-backfill
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(64)}${extra}`)
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url)
const MIGRATIONS = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()
const migration0030 = MIGRATIONS.find(f => f.startsWith('0030_'))

if (!migration0030) {
  console.error('✗ לא נמצאה מיגרציית 0030')
  process.exit(1)
}

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable security definer set search_path = auth
    as $$ select uid from auth._session limit 1 $$;
  create role service_role; create role authenticated; create role anon;
`)

// ── כל המיגרציות עד 0030 (לא כולל) — המצב בפרודקשן רגע לפני שהיא חלה ────────
const before0030 = MIGRATIONS.filter(f => f < migration0030)

section('מיגרציות 0001–0029 (המצב לפני 0030)')
for (const f of before0030) {
  try {
    await db.exec(readFileSync(new URL(f, MIG_DIR), 'utf8'))
  } catch (e) {
    chk(`${f} רצה`, false, e.message)
    process.exit(1)
  }
}
chk(`${before0030.length} מיגרציות רצו, עד ${before0030[before0030.length - 1]}`, true)
chk('0030 לא הורצה עדיין', !before0030.includes(migration0030))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows

const future = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()
const past = (hours) => new Date(Date.now() - hours * 3600_000).toISOString()

let phoneSeq = 0
async function newCustomer(name = 'לקוחת בדיקה') {
  phoneSeq += 1
  const phone = `+9725412${String(phoneSeq).padStart(5, '0')}`
  return one(
    `insert into public.customers (phone_e164, full_name) values ($1, $2) returning *`,
    [phone, name],
  )
}

/** INSERT ישיר — מדמה שורה שכבר קיימת במסד לפני 0030, לא דרך RPC. */
async function insertAppointment({
  customerId, startsAt, status, pendingExpiresAt = null, rescheduleOf = null,
}) {
  return one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, pending_expires_at, policy_version, reschedule_of_appointment_id)
     values ($1, 'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, 20, $3, $4::timestamptz, 'v1', $5)
     returning *`,
    [customerId, startsAt, status, pendingExpiresAt, rescheduleOf],
  )
}

const statusOf = async (id) =>
  (await one(`select status from public.appointments where id = $1`, [id]))?.status
const expiresOf = async (id) =>
  (await one(`select pending_expires_at from public.appointments where id = $1`, [id]))?.pending_expires_at

/** ניסיון INSERT על אותה שעה — מצליח = הסלוט פנוי, נכשל ב-23P01/exclusion = חסום. */
async function slotBlocked(startsAt) {
  const c = await newCustomer('בודקת חפיפה')
  try {
    await db.query(
      `insert into public.appointments
         (customer_id, service_key, variants, price_total, starts_at, duration_min,
          status, policy_version)
       values ($1, 'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
               $2::timestamptz, 20, 'pending', 'v1')`,
      [c.id, startsAt],
    )
    return false
  } catch (e) {
    return /exclusion|23P01/.test(e.message)
  }
}


// ════════════════════════════════════════════════════════════════════════════
section('זריעת נתונים — המצב הקיים רגע לפני 0030')

const cStale = await newCustomer('פגה מזמן')
const slotStale = future(30)
const rowStalePending = await insertAppointment({
  customerId: cStale.id, startsAt: slotStale, status: 'pending',
  pendingExpiresAt: past(1), // תפוגה שכבר עברה
})

const cFuture = await newCustomer('עדיין בתוך החלון')
const slotFuture = future(32)
const rowFuturePending = await insertAppointment({
  customerId: cFuture.id, startsAt: slotFuture, status: 'pending',
  pendingExpiresAt: future(2), // תפוגה עתידית — עדיין צריכה להפוך null
})

const cResched = await newCustomer('מבקשת שינוי מועד')
const origResched = await insertAppointment({
  customerId: cResched.id, startsAt: future(34), status: 'confirmed',
})
const slotReschedTarget = future(56)
const rowReschedPending = await insertAppointment({
  customerId: cResched.id, startsAt: slotReschedTarget, status: 'pending',
  pendingExpiresAt: past(2), rescheduleOf: origResched.id,
})

const cExpired = await newCustomer('כבר פגה')
const rowExpired = await insertAppointment({
  customerId: cExpired.id, startsAt: future(36), status: 'expired',
  pendingExpiresAt: past(10),
})
const expiredExpiryBefore = await expiresOf(rowExpired.id)

const cConfirmedLeftover = await newCustomer('מאושרת עם שארית')
const rowConfirmedLeftover = await insertAppointment({
  customerId: cConfirmedLeftover.id, startsAt: future(38), status: 'confirmed',
  pendingExpiresAt: past(5), // edge case: שארית שלא אמורה להיות שם, ובכל זאת
})
const confirmedExpiryBefore = await expiresOf(rowConfirmedLeftover.id)

const cRejected = await newCustomer('נדחתה עם שארית')
const rowRejected = await insertAppointment({
  customerId: cRejected.id, startsAt: future(40), status: 'rejected',
  pendingExpiresAt: past(5),
})
const rejectedExpiryBefore = await expiresOf(rowRejected.id)

chk('נזרעו 6 שורות', true)


// ════════════════════════════════════════════════════════════════════════════
section('מריצים את 0030')

try {
  await db.exec(readFileSync(new URL(migration0030, MIG_DIR), 'utf8'))
  chk('0030 רצה במלואה ללא שגיאה', true)
} catch (e) {
  chk('0030 רצה במלואה ללא שגיאה', false, e.message)
  process.exit(1)
}


// ════════════════════════════════════════════════════════════════════════════
section('1+2. pending עם תפוגה ישנה → null, נשארת pending')

chk('🔒 pending_expires_at הפך null', (await expiresOf(rowStalePending.id)) === null)
chk('🔒 הסטטוס נשאר pending', (await statusOf(rowStalePending.id)) === 'pending')

section('1+2 (וריאציה). גם pending עם תפוגה עתידית מנורמלת — לא רק פגות')

chk('🔒 pending_expires_at הפך null גם כשהתפוגה עדיין לא עברה',
  (await expiresOf(rowFuturePending.id)) === null)
chk('🔒 הסטטוס נשאר pending', (await statusOf(rowFuturePending.id)) === 'pending')


// ════════════════════════════════════════════════════════════════════════════
section('3. עדיין חוסמת את הסלוט שלה')

chk('🔒 סלוט הבקשה שהייתה "פגה" עדיין חסום', await slotBlocked(slotStale))
chk('🔒 סלוט הבקשה השנייה עדיין חסום', await slotBlocked(slotFuture))


// ════════════════════════════════════════════════════════════════════════════
section('4. שורה שכבר expired — לא מוחייאת, לא נוגעים בה')

chk('🔒 הסטטוס נשאר expired — לא הפכה בחזרה ל-pending', (await statusOf(rowExpired.id)) === 'expired')
chk('🔒 pending_expires_at שלה לא נגע בו כלל (היקף המיגרציה: status=pending בלבד)',
  new Date(await expiresOf(rowExpired.id)).getTime() === new Date(expiredExpiryBefore).getTime())
chk('🔒 הסלוט שלה לא חסום (expired אינו נמנה ב-EXCLUDE, כמו קודם)',
  !(await slotBlocked(future(36))))


// ════════════════════════════════════════════════════════════════════════════
section('5. בקשת שינוי מועד pending — אותה התנהגות בדיוק')

chk('🔒 pending_expires_at של בקשת השינוי הפך null',
  (await expiresOf(rowReschedPending.id)) === null)
chk('🔒 בקשת השינוי נשארה pending', (await statusOf(rowReschedPending.id)) === 'pending')
chk('🔒 המקור (confirmed) לא נגעו בו', (await statusOf(origResched.id)) === 'confirmed')
chk('🔒 שעת היעד של בקשת השינוי עדיין חסומה', await slotBlocked(slotReschedTarget))


// ════════════════════════════════════════════════════════════════════════════
section('6. שורות שאינן pending — לא נוגעים בהן בכלל')

chk('🔒 confirmed עם pending_expires_at שיורי: הערך לא נגע בו',
  new Date(await expiresOf(rowConfirmedLeftover.id)).getTime() === new Date(confirmedExpiryBefore).getTime())
chk('🔒 confirmed נשארה confirmed', (await statusOf(rowConfirmedLeftover.id)) === 'confirmed')
chk('🔒 rejected עם pending_expires_at שיורי: הערך לא נגע בו',
  new Date(await expiresOf(rowRejected.id)).getTime() === new Date(rejectedExpiryBefore).getTime())
chk('🔒 rejected נשארה rejected', (await statusOf(rowRejected.id)) === 'rejected')


// ════════════════════════════════════════════════════════════════════════════
section('7. idempotency — הרצה חוזרת של ה-UPDATE לא כותבת דבר')

const beforeSecondRun = await all(
  `select id, pending_expires_at from public.appointments where status = 'pending' order by id`)
await db.query(`update public.appointments set pending_expires_at = null
                where status = 'pending' and pending_expires_at is not null`)
const afterSecondRun = await all(
  `select id, pending_expires_at from public.appointments where status = 'pending' order by id`)
chk('🔒 אין שינוי בהרצה חוזרת — כל השורות כבר null',
  JSON.stringify(beforeSecondRun) === JSON.stringify(afterSecondRun))


// ── סיכום ─────────────────────────────────────────────────────────────────
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} עברו`)
if (passed !== results.length) process.exit(1)
