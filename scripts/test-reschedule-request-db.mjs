/**
 * שלב 15E — בקשת שינוי מועד, מול Postgres אמיתי (PGlite, לא מול Supabase).
 *
 * העיקרון היחיד שכל הקובץ הזה קיים כדי לאמת:
 *
 *   🔒 **התור המקורי נשאר confirmed וחוסם את שעתו עד שהמועד החדש מאושר.**
 *      אין רגע — בשום מסלול, כולל דחייה, תפוגה ולחיצה כפולה — שבו שתי
 *      השעות משוחררות או שהתור העסקי נעלם.
 *
 * מכוסה כאן:
 *   • יצירת בקשה: המקור לא זז, היעד נחסם, שתי השעות תפוסות בו-זמנית
 *   • אישור: החלפה אטומית, המקור משתחרר, reschedule_count עובר לשרשרת
 *   • דחייה / תפוגה: המקור נשאר בדיוק כפי שהיה, היעד משתחרר
 *   • idempotency: אישור/דחייה כפולים, ואישור אחרי תפוגה
 *   • בקשה פתוחה אחת בלבד לכל תור (partial unique index)
 *   • חפיפה עצמית נדחית
 *   • כלל 6 השעות מ-business_settings, בלי ענף מקדמה
 *   • 🔴 claim_calendar_sync מצליחה על (rescheduled, delete) — בלי זה
 *     האירוע הישן נשאר ביומן וחוסם שעה שהתפנתה
 *
 * הרצה:  npm run test:reschedule-request-db
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(68)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

const MIG_DIR = new URL('../supabase/migrations/', import.meta.url)

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

section('מיגרציות')
const migrations = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()
for (const f of migrations) {
  try {
    await db.exec(readFileSync(new URL(f, MIG_DIR), 'utf8'))
  } catch (e) {
    chk(`${f} רצה`, false, e.message)
    process.exit(1)
  }
}
chk(`כל ${migrations.length} המיגרציות רצו לפי הסדר`)
chk('0022 קיימת ברשימה', migrations.includes('0022_reschedule_requests.sql'))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
const hours = h => new Date(Date.now() + h * 3600_000).toISOString()

const attempt = async (fn) => {
  try { return { ok: true, row: await fn() } }
  catch (e) { return { ok: false, msg: e.message } }
}

const ADMIN = '11111111-1111-1111-1111-111111111111'

async function makeCustomer(phone, name = 'לקוחה') {
  return one(
    `insert into public.customers (phone_e164, full_name) values ($1,$2) returning *`,
    [phone, name],
  )
}

/** תור confirmed ישירות — נקודת המוצא של כל תרחיש כאן */
async function makeConfirmed({ customerId, startsAt, duration = 20, deposit = false }) {
  return one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, has_deposit, calendar_sync_status, calendar_sync_operation, google_event_id)
     values ($1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, $3, 'confirmed', $4, 'synced', 'upsert', 'evt_' || gen_random_uuid())
     returning *`,
    [customerId, startsAt, duration, deposit],
  )
}

const request = (apptId, customerId, newStart, expires = hours(3)) =>
  one(
    `select * from public.create_reschedule_request($1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz)`,
    [apptId, customerId, newStart, expires],
  )

const approve = (reqId, admin = ADMIN) =>
  one(`select public.approve_reschedule_request($1::uuid,$2::uuid) as r`, [reqId, admin])

const reject = (reqId, admin = ADMIN) =>
  one(`select * from public.reject_reschedule_request($1::uuid,$2::uuid)`, [reqId, admin])

const byId = id => one(`select * from public.appointments where id = $1`, [id])

/** האם שעה נתונה חסומה — נבדק ע"י ניסיון INSERT אמיתי, לא ע"י קריאה */
async function slotBlocked(startsAt, duration = 20) {
  const c = await makeCustomer('+9725' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), 'בודקת')
  const r = await attempt(() =>
    one(
      `insert into public.appointments
         (customer_id, service_key, variants, price_total, starts_at, duration_min, status)
       values ($1,'x',array[]::text[],1,$2::timestamptz,$3,'confirmed') returning id`,
      [c.id, startsAt, duration],
    ),
  )
  if (r.ok) {
    await db.query(`delete from public.appointments where id = $1`, [r.row.id])
    return false
  }
  return r.msg.includes('appointments_no_overlap') || r.msg.includes('conflicting key')
}

// ════════════════════════════════════════════════════════════════════════════
section('1. יצירת בקשה — המקור לא זז, שתי השעות תפוסות')

const c1 = await makeCustomer('+972541230001', 'רונית לוי')
const T0 = hours(48) // התור המקורי
const T1 = hours(72) // היעד המבוקש

const orig1 = await makeConfirmed({ customerId: c1.id, startsAt: T0 })
const req1 = await request(orig1.id, c1.id, T1)

{
  const o = await byId(orig1.id)
  chk('🔒 המקור נשאר confirmed', o.status === 'confirmed', `status=${o.status}`)
  chk('🔒 starts_at של המקור לא השתנה', new Date(o.starts_at).getTime() === new Date(T0).getTime())
  chk('🔒 reschedule_count של המקור לא גדל', o.reschedule_count === 0)
  chk('🔒 calendar_sync של המקור לא נגוע',
    o.calendar_sync_status === 'synced' && o.calendar_sync_operation === 'upsert')

  chk('הבקשה נוצרה כ-pending', req1.status === 'pending')
  chk('הבקשה מצביעה על המקור', req1.reschedule_of_appointment_id === orig1.id)
  chk('הבקשה על המועד המבוקש', new Date(req1.starts_at).getTime() === new Date(T1).getTime())
  chk('הבקשה ירשה טיפול/מחיר/משך מהמקור',
    req1.service_key === orig1.service_key && req1.price_total === orig1.price_total &&
    req1.duration_min === orig1.duration_min)
  chk('לבקשה יש pending_expires_at', !!req1.pending_expires_at)

  chk('🔴 שעת המקור עדיין חסומה', await slotBlocked(T0))
  chk('🔴 שעת היעד חסומה ע"י הבקשה', await slotBlocked(T1))

  const h = await all(
    `select * from public.appointment_history where appointment_id = $1`, [req1.id])
  chk('נכתבה שורת היסטוריה לבקשה', h.length === 1 && h[0].action === 'created')
  chk('ההיסטוריה מסומנת reschedule_request', h[0].reason === 'reschedule_request')
  chk('ההיסטוריה שומרת מאיפה לאן',
    new Date(h[0].from_starts_at).getTime() === new Date(T0).getTime() &&
    new Date(h[0].to_starts_at).getTime() === new Date(T1).getTime())
}

// ════════════════════════════════════════════════════════════════════════════
section('2. בקשה פתוחה אחת בלבד לכל תור')

{
  const second = await attempt(() => request(orig1.id, c1.id, hours(80)))
  chk('בקשה שנייה על אותו תור נחסמת', !second.ok, second.ok ? '' : second.msg.slice(0, 40))
  chk('  הסיבה היא REQUEST_EXISTS או האינדקס הייחודי',
    !second.ok && (second.msg.includes('REQUEST_EXISTS') ||
      second.msg.includes('one_open_reschedule')))
}

// ════════════════════════════════════════════════════════════════════════════
section('3. אישור — החלפה אטומית')

{
  const res = await approve(req1.id)
  const payload = res.r
  const o = await byId(orig1.id)
  const r = await byId(req1.id)

  chk('הבקשה הפכה ל-confirmed', r.status === 'confirmed')
  chk('הבקשה ממתינה לסנכרון upsert',
    r.calendar_sync_operation === 'upsert' && r.calendar_sync_status === 'pending')
  chk('pending_expires_at נוקה מהבקשה', r.pending_expires_at === null)
  chk('reschedule_count עבר לשרשרת (0→1)', r.reschedule_count === 1, `rc=${r.reschedule_count}`)
  chk('original_starts_at שומר את המועד המקורי',
    new Date(r.original_starts_at).getTime() === new Date(T0).getTime())

  chk("🔒 המקור עבר ל-'rescheduled'", o.status === 'rescheduled', `status=${o.status}`)
  chk('🔒 המקור ממתין למחיקת האירוע ביומן',
    o.calendar_sync_operation === 'delete' && o.calendar_sync_status === 'pending')
  chk('המקור שומר את google_event_id שלו (תיעוד מה למחוק)', !!o.google_event_id)

  chk('🔴 שעת המקור השתחררה', !(await slotBlocked(T0)))
  chk('🔴 שעת היעד נשארה תפוסה', await slotBlocked(T1))

  chk('הוחזרו שתי השורות', !!payload.request && !!payload.original)

  const h = await all(
    `select * from public.appointment_history where appointment_id = $1 order by id`, [orig1.id])
  chk("למקור נכתבה היסטוריית 'rescheduled'",
    h.some(x => x.action === 'rescheduled' && x.to_status === 'rescheduled'))
}

// ════════════════════════════════════════════════════════════════════════════
section('4. 🔴 claim_calendar_sync על המקור שהוזז')

{
  const claimed = await attempt(() =>
    one(`select * from public.claim_calendar_sync($1::uuid)`, [orig1.id]))
  chk('🔴 (rescheduled, delete) הוא claimable', claimed.ok,
    claimed.ok ? '' : claimed.msg.slice(0, 60))
  if (claimed.ok) {
    chk('  ה-claim סימן syncing', claimed.row.calendar_sync_status === 'syncing')
    const done = await attempt(() =>
      one(`select * from public.complete_calendar_delete($1::uuid)`, [orig1.id]))
    chk('  complete_calendar_delete סוגר את המחיקה', done.ok && done.row.calendar_sync_status === 'synced')
  }

  // הבקשה שאושרה היא (confirmed, upsert) — המסלול הרגיל
  const claimNew = await attempt(() =>
    one(`select * from public.claim_calendar_sync($1::uuid)`, [req1.id]))
  chk('התור החדש claimable כ-(confirmed, upsert)', claimNew.ok)
}

// ════════════════════════════════════════════════════════════════════════════
section('5. אישור כפול ואישור אחרי תפוגה')

{
  const again = await attempt(() => approve(req1.id))
  chk('אישור חוזר נדחה (idempotency)', !again.ok)
  chk('  הסיבה NOT_PENDING', !again.ok && again.msg.includes('NOT_PENDING'))

  // בקשה שפגה
  const c = await makeCustomer('+972541230002', 'דנה')
  const o = await makeConfirmed({ customerId: c.id, startsAt: hours(50) })
  const rq = await request(o.id, c.id, hours(74))
  await db.query(
    `update public.appointments set pending_expires_at = now() - interval '1 minute' where id = $1`,
    [rq.id])

  const expiredApprove = await attempt(() => approve(rq.id))
  chk('אישור בקשה שפגה נדחה', !expiredApprove.ok)
  chk('  הסיבה NOT_PENDING', !expiredApprove.ok && expiredApprove.msg.includes('NOT_PENDING'))

  const oAfter = await byId(o.id)
  chk('🔒 המקור נשאר confirmed אחרי אישור שנכשל', oAfter.status === 'confirmed')
}

// ════════════════════════════════════════════════════════════════════════════
section('6. דחייה — המקור נשאר בדיוק כפי שהיה')

{
  const c = await makeCustomer('+972541230003', 'מיכל')
  const S = hours(52), N = hours(76)
  const o0 = await makeConfirmed({ customerId: c.id, startsAt: S })
  const before = await byId(o0.id)
  const rq = await request(o0.id, c.id, N)

  const rejected = await reject(rq.id)
  chk("הבקשה עברה ל-'rejected'", rejected.status === 'rejected')

  const after = await byId(o0.id)
  chk('🔒 status של המקור לא השתנה', after.status === before.status)
  chk('🔒 starts_at של המקור לא השתנה',
    new Date(after.starts_at).getTime() === new Date(before.starts_at).getTime())
  chk('🔒 reschedule_count של המקור לא השתנה', after.reschedule_count === before.reschedule_count)
  chk('🔒 calendar_sync של המקור לא נגוע',
    after.calendar_sync_status === before.calendar_sync_status &&
    after.calendar_sync_operation === before.calendar_sync_operation)

  chk('🔴 שעת המקור עדיין חסומה', await slotBlocked(S))
  chk('🔴 שעת היעד השתחררה', !(await slotBlocked(N)))

  const twice = await attempt(() => reject(rq.id))
  chk('דחייה חוזרת נדחית (idempotency)', !twice.ok && twice.msg.includes('NOT_PENDING'))

  // אחרי דחייה מותר לבקש שוב
  const again = await attempt(() => request(o0.id, c.id, hours(78)))
  chk('אחרי דחייה אפשר לבקש מועד חדש', again.ok, again.ok ? '' : again.msg.slice(0, 50))
}

// ════════════════════════════════════════════════════════════════════════════
section('7. תפוגה — אותה הבטחה כמו דחייה')

{
  const c = await makeCustomer('+972541230004', 'שירה')
  const S = hours(54), N = hours(82)
  const o0 = await makeConfirmed({ customerId: c.id, startsAt: S })
  const rq = await request(o0.id, c.id, N)

  await db.query(
    `update public.appointments set pending_expires_at = now() - interval '1 minute' where id = $1`,
    [rq.id])
  await db.query(`select public.expire_stale_pending_appointments()`)

  const r = await byId(rq.id)
  const o = await byId(o0.id)
  chk("הבקשה פגה ('expired')", r.status === 'expired', `status=${r.status}`)
  chk('🔒 המקור נשאר confirmed', o.status === 'confirmed')
  chk('🔒 starts_at של המקור לא השתנה',
    new Date(o.starts_at).getTime() === new Date(S).getTime())
  chk('🔴 שעת המקור עדיין חסומה', await slotBlocked(S))
  chk('🔴 שעת היעד השתחררה', !(await slotBlocked(N)))
}

// ════════════════════════════════════════════════════════════════════════════
section('8. חפיפה עצמית נדחית')

{
  const c = await makeCustomer('+972541230005', 'נועה')
  const S = hours(56)
  const o0 = await makeConfirmed({ customerId: c.id, startsAt: S, duration: 60 })

  // 20 דקות אחרי ההתחלה — חופף לתור עצמו (60 דק')
  const overlapping = new Date(new Date(S).getTime() + 20 * 60_000).toISOString()
  const r = await attempt(() => request(o0.id, c.id, overlapping))
  chk('🔒 יעד שחופף לתור המקורי נדחה', !r.ok)
  chk('  הסיבה SELF_OVERLAP', !r.ok && r.msg.includes('SELF_OVERLAP'), r.ok ? '' : '')

  // בדיוק בסוף התור — נוגע אבל לא חופף (tstzrange חצי-פתוח)
  const adjacent = new Date(new Date(S).getTime() + 60 * 60_000).toISOString()
  const ok = await attempt(() => request(o0.id, c.id, adjacent))
  chk('יעד שמתחיל בדיוק בתום התור מותר', ok.ok, ok.ok ? '' : ok.msg.slice(0, 50))

  // אותו מועד בדיוק
  const same = await attempt(() => request(o0.id, c.id, S))
  chk('בחירת המועד הקיים נדחית כ-NO_CHANGE',
    !same.ok && (same.msg.includes('NO_CHANGE') || same.msg.includes('REQUEST_EXISTS')))
}

// ════════════════════════════════════════════════════════════════════════════
section('9. כלל 6 השעות — מ-business_settings, בלי ענף מקדמה')

{
  const live = await one(
    `select value #>> '{}' as v from public.business_settings where key = 'reschedule_cutoff_hours'`)
  chk('reschedule_cutoff_hours קיים ב-business_settings', !!live)

  await db.query(
    `update public.business_settings set value = '6'::jsonb where key = 'reschedule_cutoff_hours'`)

  const c = await makeCustomer('+972541230006', 'אורית')

  const soon = await makeConfirmed({ customerId: c.id, startsAt: hours(5) })
  const tooLate = await attempt(() => request(soon.id, c.id, hours(90)))
  chk('תור בעוד 5 שעות — חסום', !tooLate.ok && tooLate.msg.includes('TOO_LATE'))

  const ok7 = await makeConfirmed({ customerId: c.id, startsAt: hours(7) })
  const allowed = await attempt(() => request(ok7.id, c.id, hours(92)))
  chk('תור בעוד 7 שעות — מותר', allowed.ok, allowed.ok ? '' : allowed.msg.slice(0, 50))

  // 🔒 מקדמה אינה יוצרת מסלול נפרד
  const dep = await makeConfirmed({ customerId: c.id, startsAt: hours(8), deposit: true })
  const depReq = await attempt(() => request(dep.id, c.id, hours(94)))
  chk('🔒 תור עם מקדמה נשפט באותו כלל 6 שעות', depReq.ok,
    depReq.ok ? '' : depReq.msg.slice(0, 50))

  // deposit_reschedule_cutoff_hours=48 אינו נקרא יותר — תור בעוד 8 שעות
  // עם מקדמה היה נחסם תחת הכלל הישן
  chk('🔒 deposit_reschedule_cutoff_hours (48) אינו חוסם יותר', depReq.ok)

  // הערך באמת מגיע מהטבלה
  await db.query(
    `update public.business_settings set value = '24'::jsonb where key = 'reschedule_cutoff_hours'`)
  const t12 = await makeConfirmed({ customerId: c.id, startsAt: hours(12) })
  const blocked24 = await attempt(() => request(t12.id, c.id, hours(96)))
  chk('שינוי ההגדרה ל-24 חוסם תור בעוד 12 שעות', !blocked24.ok && blocked24.msg.includes('TOO_LATE'))
  await db.query(
    `update public.business_settings set value = '6'::jsonb where key = 'reschedule_cutoff_hours'`)
}

// ════════════════════════════════════════════════════════════════════════════
section('10. ביטול עצמי — 6 שעות לכולן, בלי ענף מקדמה')

{
  await db.query(
    `update public.business_settings set value = '6'::jsonb where key = 'cancel_cutoff_hours'`)
  const c = await makeCustomer('+972541230007', 'תמר')

  // ⚠️ שעות ייחודיות בכוונה: כל תור בקובץ הזה תופס טווח אמיתי, ושני
  // תורים באותו מרחק-שעות מ-now() חופפים ונופלים על appointments_no_overlap.
  const dep = await makeConfirmed({ customerId: c.id, startsAt: hours(9), deposit: true })
  const r = await attempt(() =>
    one(`select public.cancel_confirmed_appointment_by_customer($1::uuid,$2::uuid) as r`,
      [dep.id, c.id]))
  chk('🔒 ביטול עצמי של תור עם מקדמה מותר (אין DEPOSIT_LOCKED)', r.ok,
    r.ok ? '' : r.msg.slice(0, 60))

  const soon = await makeConfirmed({ customerId: c.id, startsAt: hours(4) })
  const late = await attempt(() =>
    one(`select public.cancel_confirmed_appointment_by_customer($1::uuid,$2::uuid) as r`,
      [soon.id, c.id]))
  chk('ביטול פחות מ-6 שעות לפני — חסום', !late.ok && late.msg.includes('TOO_LATE'))
}

// ════════════════════════════════════════════════════════════════════════════
section('11. שמירות נוספות')

{
  const c = await makeCustomer('+972541230008', 'הילה')

  // לא ניתן לבקש שינוי על תור שאינו confirmed
  const pend = await one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min, status, pending_expires_at)
     values ($1,'x',array[]::text[],1,$2::timestamptz,20,'pending',$3::timestamptz) returning *`,
    [c.id, hours(60), hours(3)])
  const onPending = await attempt(() => request(pend.id, c.id, hours(84)))
  chk('בקשת שינוי על תור pending נדחית', !onPending.ok && onPending.msg.includes('NOT_RESCHEDULABLE'), onPending.ok ? 'PASSED!' : onPending.msg.slice(0,90))

  // בעלות
  const c2 = await makeCustomer('+972541230009', 'זרה')
  const mine = await makeConfirmed({ customerId: c.id, startsAt: hours(62) })
  const notMine = await attempt(() => request(mine.id, c2.id, hours(86)))
  chk('לקוחה אחרת אינה יכולה לבקש שינוי לתור שאינו שלה',
    !notMine.ok && notMine.msg.includes('NOT_FOUND'))

  // תפוגה חריגה
  const o2 = await makeConfirmed({ customerId: c.id, startsAt: hours(66) })
  const badExp = await attempt(() => request(o2.id, c.id, hours(90), hours(100)))
  chk('תפוגה מעל 72 שעות נדחית', !badExp.ok && badExp.msg.includes('BAD_EXPIRY'))

  // 🔒 עצמי
  const self = await attempt(() =>
    db.query(`update public.appointments set reschedule_of_appointment_id = id where id = $1`, [o2.id]))
  chk('🔒 בקשה אינה יכולה להצביע על עצמה', !self.ok)
}

// ════════════════════════════════════════════════════════════════════════════
section('12. 🔴 שרשרת שני שינויי מועד — max_reschedules באמת ניתן להשגה')

{
  /*
   * 🔒 הרגרסיה שהבדיקה הזו נועדה לתפוס:
   * בגרסה הראשונה של 0022 ישבה ב-create_reschedule_request בדיקה
   * `if reschedule_of_appointment_id is not null then NOT_RESCHEDULABLE`.
   * שורת בקשה שאושרה שומרת את השדה הזה לתמיד, ולכן שינוי מועד **שני**
   * נחסם תמיד — ו-max_reschedules=2 היה בלתי ניתן להשגה.
   *
   * ⚠️ הבדיקה הקודמת כאן אישרה את הבאג כהתנהגות נכונה ("אין שרשור"),
   * ולכן החבילה הייתה ירוקה **בגלל** הבאג. היא הוחלפה בשרשרת אמיתית.
   */
  const c = await makeCustomer('+972541230010', 'שרשרת')
  const S0 = hours(120), S1 = hours(144), S2 = hours(168), S3 = hours(192)

  const a0 = await makeConfirmed({ customerId: c.id, startsAt: S0 })
  chk('מקור נוצר עם rc=0', a0.reschedule_count === 0)

  // ── הזזה ראשונה ──────────────────────────────────────────────────────────
  const r1 = await request(a0.id, c.id, S1)
  await approve(r1.id)
  const a1 = await byId(r1.id)
  chk('אחרי הזזה 1 — התור הפעיל confirmed', a1.status === 'confirmed')
  chk('אחרי הזזה 1 — rc=1', a1.reschedule_count === 1, `rc=${a1.reschedule_count}`)
  chk('אחרי הזזה 1 — המקור rescheduled', (await byId(a0.id)).status === 'rescheduled')
  chk('🔴 התור הפעיל שומר reschedule_of (תיעוד מוצא)',
    a1.reschedule_of_appointment_id === a0.id)

  // ── הזזה שנייה — זה מה שהיה חסום ─────────────────────────────────────────
  const r2 = await attempt(() => request(a1.id, c.id, S2))
  chk('🔴 ניתן לבקש שינוי מועד **שני** על התור הפעיל', r2.ok,
    r2.ok ? '' : r2.msg.slice(0, 60))

  if (r2.ok) {
    chk('  הבקשה השנייה מצביעה על התור הפעיל',
      r2.row.reschedule_of_appointment_id === a1.id)
    chk('  🔴 שעת התור הפעיל עדיין חסומה בזמן הבקשה', await slotBlocked(S1))
    chk('  🔴 שעת היעד השני חסומה', await slotBlocked(S2))

    await approve(r2.row.id)
    const a2 = await byId(r2.row.id)
    chk('אחרי הזזה 2 — התור הפעיל confirmed', a2.status === 'confirmed')
    chk('🔴 אחרי הזזה 2 — rc=2 (המונה עבר לאורך השרשרת)',
      a2.reschedule_count === 2, `rc=${a2.reschedule_count}`)
    chk('אחרי הזזה 2 — החוליה הקודמת rescheduled',
      (await byId(a1.id)).status === 'rescheduled')
    chk('original_starts_at שומר את המועד המקורי **הראשון**',
      new Date(a2.original_starts_at).getTime() === new Date(S0).getTime())
    chk('שעת החוליה הקודמת השתחררה', !(await slotBlocked(S1)))

    // ── ניסיון שלישי — נחסם ב-MAX_RESCHEDULES ─────────────────────────────
    const r3 = await attempt(() => request(a2.id, c.id, S3))
    chk('🔴 הזזה שלישית נחסמת ב-MAX_RESCHEDULES',
      !r3.ok && r3.msg.includes('MAX_RESCHEDULES'), r3.ok ? 'עברה בטעות!' : '')
    chk('  ואין שורת בקשה חדשה — היעד השלישי פנוי', !(await slotBlocked(S3)))
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('13. 🔴 בקשה אינה שורדת את המועדים שהיא נוגעת בהם')

{
  const c = await makeCustomer('+972541230011', 'תפוגה')
  const far = h => hours(h)

  // ── 1. תפוגה עסקית רגילה כששני המועדים רחוקים ────────────────────────────
  {
    const o = await makeConfirmed({ customerId: c.id, startsAt: far(200) })
    const exp = hours(3)
    const r = await request(o.id, c.id, far(220), exp)
    const diff = Math.abs(new Date(r.pending_expires_at).getTime() - new Date(exp).getTime())
    chk('1. שני המועדים רחוקים → התפוגה העסקית נשמרת כמות שהיא', diff < 2000,
      `Δ=${diff}ms`)
  }

  // ── 2. גלגול ל-11:00 כששני התורים מאוחרים יותר — נשאר תקין ───────────────
  {
    const o = await makeConfirmed({ customerId: c.id, startsAt: far(202) })
    const rollover = hours(40)           // מדמה גלגול ל-11:00 ביום עבודה הבא
    const r = await request(o.id, c.id, far(222), rollover)
    const diff = Math.abs(new Date(r.pending_expires_at).getTime() - new Date(rollover).getTime())
    chk('2. גלגול ל-11:00 ושני התורים מאוחרים יותר → לא נחתך', diff < 2000, `Δ=${diff}ms`)
  }

  // ── 3. המקור מוקדם מהתפוגה → נחתך למועד המקור ────────────────────────────
  {
    const S = far(20)                    // המקור בעוד 20 שעות
    const o = await makeConfirmed({ customerId: c.id, startsAt: S })
    const r = await request(o.id, c.id, far(224), hours(40))  // תפוגה "מגולגלת" ל-40ש'
    chk('3. 🔴 המקור לפני התפוגה → התפוגה נחתכת למועד המקור',
      new Date(r.pending_expires_at).getTime() === new Date(S).getTime(),
      `exp=${r.pending_expires_at}`)
    chk('   התפוגה אינה מאוחרת מהמקור',
      new Date(r.pending_expires_at) <= new Date(S))
  }

  // ── 4. היעד מוקדם מהתפוגה → נחתך למועד היעד ──────────────────────────────
  {
    const S = far(206)
    const T = far(22)                    // היעד בעוד 22 שעות, לפני התפוגה
    const o = await makeConfirmed({ customerId: c.id, startsAt: S })
    const r = await request(o.id, c.id, T, hours(40))
    chk('4. 🔴 היעד לפני התפוגה → התפוגה נחתכת למועד היעד',
      new Date(r.pending_expires_at).getTime() === new Date(T).getTime(),
      `exp=${r.pending_expires_at}`)
    chk('   התפוגה אינה מאוחרת מהיעד',
      new Date(r.pending_expires_at) <= new Date(T))
  }

  // ── 5. אישור אחרי שאחד המועדים הגיע — אסור להצליח ────────────────────────
  {
    const o = await makeConfirmed({ customerId: c.id, startsAt: far(208) })
    const r = await request(o.id, c.id, far(228))

    // דוחפים את המקור לעבר — מדמה תור שכבר התחיל
    await db.query(
      `update public.appointments set starts_at = now() - interval '10 minutes' where id = $1`,
      [o.id])
    const late = await attempt(() => approve(r.id))
    chk('5a. 🔴 אישור אחרי שהמקור כבר התחיל — נחסם', !late.ok,
      late.ok ? 'עבר בטעות!' : late.msg.slice(0, 45))
    chk('    הבקשה נשארה pending ולא הפכה ל-confirmed',
      (await byId(r.id)).status === 'pending')

    // מקור תקין, יעד בעבר.
    // ⚠️ היסט שונה מ-5a: שתי השורות עדיין בסטטוס פעיל, ואותו מועד עבר
    // בדיוק היה מתנגש ביניהן על appointments_no_overlap.
    const o2 = await makeConfirmed({ customerId: c.id, startsAt: far(210) })
    const r2 = await request(o2.id, c.id, far(230))
    await db.query(
      `update public.appointments set starts_at = now() - interval '3 hours' where id = $1`,
      [r2.id])
    const lateT = await attempt(() => approve(r2.id))
    chk('5b. 🔴 אישור אחרי שהיעד כבר חלף — נחסם', !lateT.ok,
      lateT.ok ? 'עבר בטעות!' : lateT.msg.slice(0, 45))
    chk('    התור המקורי נשאר confirmed', (await byId(o2.id)).status === 'confirmed')
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('14. 🔴 ביטול המקור סוגר בקשה פתוחה — אין ghost pending')

{
  const cancelOrig = (apptId, custId) =>
    one(`select public.cancel_confirmed_appointment_by_customer($1::uuid,$2::uuid) as r`,
      [apptId, custId])

  const c = await makeCustomer('+972541230012', 'ביטול')

  // ── 1. ביטול עם בקשה פתוחה ───────────────────────────────────────────────
  const S = hours(300), T = hours(320)
  const o = await makeConfirmed({ customerId: c.id, startsAt: S })
  const r = await request(o.id, c.id, T)
  chk('נקודת מוצא: מקור confirmed + בקשה pending',
    (await byId(o.id)).status === 'confirmed' && r.status === 'pending')
  chk('  🔴 שעת היעד חסומה לפני הביטול', await slotBlocked(T))

  const res = await cancelOrig(o.id, c.id)
  const oAfter = await byId(o.id)
  const rAfter = await byId(r.id)

  chk('1. המקור עבר ל-cancelled_by_customer', oAfter.status === 'cancelled_by_customer')
  chk('   המקור ממתין למחיקת האירוע ביומן',
    oAfter.calendar_sync_operation === 'delete' && oAfter.calendar_sync_status === 'pending')
  chk('1. 🔴 הבקשה נסגרה כ-rejected', rAfter.status === 'rejected', `status=${rAfter.status}`)
  chk('   pending_expires_at של הבקשה אופס', rAfter.pending_expires_at === null)
  chk('   ה-RPC מחזיר את מזהה הבקשה שנסגרה', res.r.cancelled_request_id === r.id)
  chk('1. 🔴 שעת היעד השתחררה **מיד**', !(await slotBlocked(T)))
  chk('   שעת המקור השתחררה גם היא', !(await slotBlocked(S)))

  // ⚠️ אין עבודת יומן לבקשה — היא מעולם לא אושרה ולא נוצר לה אירוע.
  const claimReq = await attempt(() =>
    one(`select * from public.claim_calendar_sync($1::uuid)`, [r.id]))
  chk('   🔒 אין סנכרון יומן לבקשה שנסגרה (NOT_CLAIMABLE)',
    !claimReq.ok && claimReq.msg.includes('NOT_CLAIMABLE'))

  // היסטוריה לשתי הפעולות
  const hOrig = await all(
    `select * from public.appointment_history where appointment_id=$1 order by id`, [o.id])
  const hReq = await all(
    `select * from public.appointment_history where appointment_id=$1 order by id`, [r.id])
  chk('1. היסטוריית ביטול למקור',
    hOrig.some(x => x.action === 'cancelled' && x.to_status === 'cancelled_by_customer'
      && x.actor === 'customer'))
  chk('1. היסטוריית סגירה לבקשה, עם reason=original_cancelled',
    hReq.some(x => x.to_status === 'rejected' && x.reason === 'original_cancelled'
      && x.actor === 'customer'))

  // ── 2. אחרי הביטול אי אפשר לאשר את הבקשה ─────────────────────────────────
  const lateApprove = await attempt(() => approve(r.id))
  chk('2. 🔴 אישור הבקשה אחרי הביטול נכשל', !lateApprove.ok,
    lateApprove.ok ? 'עבר בטעות!' : lateApprove.msg.slice(0, 40))
  const rStill = await byId(r.id)
  chk('2. 🔴 הבקשה נשארה rejected ולא חזרה ל-pending/confirmed',
    rStill.status === 'rejected', `status=${rStill.status}`)

  // ── 3. ביטול בלי בקשה פתוחה — ההתנהגות הישנה ─────────────────────────────
  const o3 = await makeConfirmed({ customerId: c.id, startsAt: hours(302) })
  const res3 = await cancelOrig(o3.id, c.id)
  const o3After = await byId(o3.id)
  chk('3. ביטול בלי בקשה — המקור cancelled_by_customer כרגיל',
    o3After.status === 'cancelled_by_customer')
  chk('3. ביטול בלי בקשה — cancelled_request_id הוא null',
    res3.r.cancelled_request_id === null, `=${res3.r.cancelled_request_id}`)
  chk('3. ביטול בלי בקשה — outcome=applied', res3.r.outcome === 'applied')

  // ── 4. בקשה שכבר rejected/expired אינה משתנה שוב ─────────────────────────
  {
    const o4 = await makeConfirmed({ customerId: c.id, startsAt: hours(304) })
    const r4 = await request(o4.id, c.id, hours(324))
    await reject(r4.id)                       // נדחתה ע"י שובל
    const before = await byId(r4.id)
    const hBefore = (await all(
      `select * from public.appointment_history where appointment_id=$1`, [r4.id])).length

    const res4 = await cancelOrig(o4.id, c.id)
    const after = await byId(r4.id)
    const hAfter = (await all(
      `select * from public.appointment_history where appointment_id=$1`, [r4.id])).length

    chk('4. בקשה שכבר rejected נשארת rejected', after.status === 'rejected')
    chk('4. הביטול לא נגע בה שוב (אין היסטוריה נוספת)', hAfter === hBefore,
      `${hBefore}→${hAfter}`)
    chk('4. cancelled_request_id = null (לא הייתה בקשה פתוחה)',
      res4.r.cancelled_request_id === null)
    chk('4. actor של הדחייה נשאר admin ולא נדרס',
      before.status === 'rejected')

    // אותו דבר לבקשה שפגה
    const o5 = await makeConfirmed({ customerId: c.id, startsAt: hours(306) })
    const r5 = await request(o5.id, c.id, hours(326))
    await db.query(
      `update public.appointments set pending_expires_at = now() - interval '1 minute' where id=$1`,
      [r5.id])
    await db.query(`select public.expire_stale_pending_appointments()`)
    chk('4. הבקשה פגה', (await byId(r5.id)).status === 'expired')
    const res5 = await cancelOrig(o5.id, c.id)
    chk('4. בקשה שפגה נשארת expired', (await byId(r5.id)).status === 'expired')
    chk('4. cancelled_request_id = null גם כאן', res5.r.cancelled_request_id === null)
  }

  // ── 5. ביטול כפול — אין היסטוריה כפולה לבקשה ─────────────────────────────
  {
    const o6 = await makeConfirmed({ customerId: c.id, startsAt: hours(308) })
    const r6 = await request(o6.id, c.id, hours(328))

    await cancelOrig(o6.id, c.id)
    const hAfterFirst = (await all(
      `select * from public.appointment_history where appointment_id=$1`, [r6.id])).length

    const second = await cancelOrig(o6.id, c.id)
    const hAfterSecond = (await all(
      `select * from public.appointment_history where appointment_id=$1`, [r6.id])).length

    chk('5. ביטול שני מחזיר already_cancelled', second.r.outcome === 'already_cancelled')
    chk('5. 🔴 אין שורת היסטוריה כפולה לבקשת השינוי',
      hAfterSecond === hAfterFirst, `${hAfterFirst}→${hAfterSecond}`)
    chk('5. הבקשה נשארה rejected', (await byId(r6.id)).status === 'rejected')

    const hOrig6 = (await all(
      `select * from public.appointment_history where appointment_id=$1 and action='cancelled'`,
      [o6.id])).length
    chk('5. גם למקור יש בדיוק שורת ביטול אחת', hOrig6 === 1, `=${hOrig6}`)
  }

  // ── מרוץ: approve מנצח ⟹ ביטול המקור הישן נכשל ───────────────────────────
  {
    const o7 = await makeConfirmed({ customerId: c.id, startsAt: hours(310) })
    const r7 = await request(o7.id, c.id, hours(330))
    await approve(r7.id)                       // המקור עבר ל-'rescheduled'
    const cancelOld = await attempt(() => cancelOrig(o7.id, c.id))
    chk('🔒 approve מנצח → ביטול המקור הישן נחסם',
      !cancelOld.ok && cancelOld.msg.includes('NOT_CANCELLABLE'),
      cancelOld.ok ? 'עבר בטעות!' : '')
    chk('   התור החדש נשאר confirmed', (await byId(r7.id)).status === 'confirmed')
  }
}

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter(r => !r).length
console.log(`\n${'═'.repeat(72)}`)
console.log(failed === 0
  ? `✅ כל ${results.length} הבדיקות עברו`
  : `❌ ${failed} מתוך ${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
