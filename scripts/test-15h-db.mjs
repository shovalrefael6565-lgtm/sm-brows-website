/**
 * בדיקות שלב 15H — 0027 + 0028 מול Postgres אמיתי (PGlite).
 *
 * המיקוד הוא בהחלטות שאין דרך לתקן בדיעבד אם ישתבשו:
 *
 *   1. 🔒 **ביטול ניהולי מיידע את הלקוחה — פעם אחת בדיוק.** שורת היסטוריה
 *      אחת = SMS אחד (מפתח source_history_id ב-0025). לחיצה כפולה חייבת
 *      לצאת ב-'already_cancelled' **לפני** כתיבת היסטוריה שנייה.
 *
 *   2. 🔒 **ביטול ניהולי אינו שולח "בקשת שינוי המועד לא אושרה".** בקשה
 *      פתוחה נסגרת עם reason='original_cancelled', ש-0025 מחריגה במפורש.
 *
 *   3. 🔒 **claim_calendar_sync מכירה את (cancelled_by_business, delete).**
 *      בלי זה האירוע נשאר ביומן לנצח — כשל שקט לחלוטין.
 *
 *   4. 🔒 **אין ביטול רטרואקטיבי**, אבל **אין cutoff של 6 שעות** למנהלת.
 *
 *   5. 🔒 **היסטוריה עסקית לא נמחקת**: לקוחה עם תור אינה ניתנת למחיקה,
 *      וה-FK on delete restrict הוא האכיפה בפועל.
 *
 *   6. 🔒 **טלפון של לקוחה מחוברת נעול** — שינויו היה מנתק אותה מהאזור האישי.
 *
 * הרצה:  npm run test:15h-db
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(70)}${extra}`)
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
chk('0027 ו-0028 ברשימה',
  migrations.includes('0027_admin_cancellation.sql')
  && migrations.includes('0028_customer_management.sql'))

/*
 * 🔒 מנגנון ההתראות כבוי כברירת מחדל (0025) — enqueue_appointment_notification
 * יוצאת מיד כש-notifications_enabled=false. בלי ההדלקה כאן כל בדיקות ה-SMS
 * למטה היו "עוברות" מול אפס שורות, כלומר לא בודקות דבר.
 */
await db.query(
  `update public.business_settings set value='true'::jsonb where key='notifications_enabled'`)

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
const hours = h => new Date(Date.now() + h * 3600_000).toISOString()

const ADMIN = '11111111-1111-1111-1111-111111111111'
const OUTSIDER = '22222222-2222-2222-2222-222222222222'

await db.query(`insert into auth.users (id) values ($1), ($2)`, [ADMIN, OUTSIDER])
await db.query(`insert into public.admins (user_id) values ($1)`, [ADMIN])

let phoneSeq = 0
const nextPhone = () => `+9725${String(30000000 + phoneSeq++).slice(-8)}`

async function makeCustomer(name = 'לקוחה בדיקה', authUserId = null) {
  return one(
    `insert into public.customers (phone_e164, full_name, auth_user_id)
     values ($1,$2,$3) returning *`,
    [nextPhone(), name, authUserId],
  )
}

async function makeConfirmed(customerId, startsAt) {
  return one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, calendar_sync_status, calendar_sync_operation, google_event_id)
     values ($1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, 20, 'confirmed', 'synced', 'upsert', 'evt_' || gen_random_uuid())
     returning *`,
    [customerId, startsAt],
  )
}

async function notifsFor(appointmentId) {
  const rows = await all(
    `select event, recipient_role from public.appointment_notifications
     where appointment_id = $1 order by event, recipient_role`,
    [appointmentId],
  )
  return rows.map(r => `${r.event}/${r.recipient_role}`)
}

const cancelByAdmin = (apptId, adminId = ADMIN) =>
  one(`select public.cancel_confirmed_appointment_by_admin($1,$2) as r`, [apptId, adminId])

// ════════════════════════════════════════════════════════════════════════════
section('0027 — הביטול הניהולי')

{
  const c = await makeCustomer()
  const a = await makeConfirmed(c.id, hours(48))
  const res = (await cancelByAdmin(a.id)).r

  chk('ביטול תור מאושר מחזיר applied', res.outcome === 'applied', `outcome=${res.outcome}`)

  const row = await one(`select * from public.appointments where id=$1`, [a.id])
  chk('הסטטוס הוא cancelled_by_business', row.status === 'cancelled_by_business', row.status)

  /*
   * 🔒 הבדיקה שמונעת את הכשל השקט: בלי (cancelled_by_business, delete)
   * ברשימה של claim_calendar_sync, האירוע נשאר ביומן לנצח.
   */
  chk('calendar_sync_operation=delete ו-status=pending — כלומר יש מה למחוק ביומן',
    row.calendar_sync_operation === 'delete' && row.calendar_sync_status === 'pending',
    `${row.calendar_sync_operation}/${row.calendar_sync_status}`)

  const claimed = await one(`select public.claim_calendar_sync($1) as r`, [a.id])
  chk('🔒 claim_calendar_sync תופסת את התור המבוטל (אחרת האירוע לא יימחק)',
    claimed.r !== null && claimed.r !== undefined)

  const hist = await all(
    `select action, from_status, to_status, actor, actor_id, source
     from public.appointment_history where appointment_id=$1 order by id`, [a.id])
  chk('נכתבה שורת היסטוריה אחת בדיוק', hist.length === 1, `n=${hist.length}`)
  chk('ההיסטוריה נושאת actor=admin עם המזהה האמיתי',
    hist[0]?.actor === 'admin' && hist[0]?.actor_id === ADMIN)
  chk('action=cancelled · confirmed → cancelled_by_business · source=admin',
    hist[0]?.action === 'cancelled' && hist[0]?.from_status === 'confirmed'
    && hist[0]?.to_status === 'cancelled_by_business' && hist[0]?.source === 'admin')

  const notifs = await notifsFor(a.id)
  chk('🔒 ההתראה שנרשמה: booking_cancelled ללקוחה **בלבד**',
    notifs.length === 1 && notifs[0] === 'booking_cancelled/customer', notifs.join(','))
}

{
  // 🔒 idempotency — הבדיקה החשובה ביותר: לחיצה שנייה לא שולחת SMS שני.
  const c = await makeCustomer()
  const a = await makeConfirmed(c.id, hours(48))
  await cancelByAdmin(a.id)
  const second = (await cancelByAdmin(a.id)).r

  chk('לחיצה שנייה מחזירה already_cancelled', second.outcome === 'already_cancelled',
    `outcome=${second.outcome}`)

  const hist = await all(`select id from public.appointment_history where appointment_id=$1`, [a.id])
  chk('🔒 אין שורת היסטוריה שנייה', hist.length === 1, `n=${hist.length}`)

  const notifs = await notifsFor(a.id)
  chk('🔒 אין התראה שנייה — הלקוחה לא מקבלת שני SMS', notifs.length === 1, `n=${notifs.length}`)
}

{
  // השעה משתחררת: 'cancelled_by_business' אינו נמנה ב-appointments_no_overlap.
  const c1 = await makeCustomer()
  const c2 = await makeCustomer()
  const slot = hours(72)
  const a = await makeConfirmed(c1.id, slot)
  await cancelByAdmin(a.id)

  let taken = true
  try {
    await makeConfirmed(c2.id, slot)
  } catch {
    taken = false
  }
  chk('🔒 השעה משתחררת מיד — לקוחה אחרת יכולה לקבל אותה', taken)
}

{
  // 🔒 ghost pending — בדיוק הבאג ש-15E תיקן, בכיוון הניהולי.
  const c = await makeCustomer()
  const original = await makeConfirmed(c.id, hours(60))
  const request = await one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, reschedule_of_appointment_id, pending_expires_at,
        calendar_sync_status, calendar_sync_operation)
     values ($1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             $2::timestamptz, 20, 'pending', $3, now() + interval '3 hours',
             'not_applicable', 'upsert')
     returning *`,
    [c.id, hours(80), original.id],
  )

  const res = (await cancelByAdmin(original.id)).r
  chk('הביטול מחזיר את מזהה הבקשה שנסגרה', res.cancelled_request_id === request.id)

  const req = await one(`select status, pending_expires_at from public.appointments where id=$1`,
    [request.id])
  chk('🔒 בקשת שינוי המועד הפתוחה נסגרה (rejected) — אין ghost pending',
    req.status === 'rejected' && req.pending_expires_at === null, req.status)

  const reqHist = await all(
    `select reason, actor, actor_id from public.appointment_history where appointment_id=$1`,
    [request.id])
  chk('שורת ההיסטוריה של הבקשה נושאת reason=original_cancelled ו-actor=admin',
    reqHist[0]?.reason === 'original_cancelled' && reqHist[0]?.actor === 'admin'
    && reqHist[0]?.actor_id === ADMIN)

  const reqNotifs = await notifsFor(request.id)
  chk('🔒 **אין** התראת reschedule_rejected — שובל לא דחתה שום בקשה',
    reqNotifs.length === 0, reqNotifs.join(','))

  const origNotifs = await notifsFor(original.id)
  chk('הלקוחה מקבלת הודעה אחת בלבד — על הביטול עצמו',
    origNotifs.length === 1 && origNotifs[0] === 'booking_cancelled/customer', origNotifs.join(','))
}

{
  // 🔒 אין cutoff — שובל מבטלת גם שעה לפני, וזה בדיוק המצב האמיתי.
  const c = await makeCustomer()
  const a = await makeConfirmed(c.id, hours(1))
  const res = (await cancelByAdmin(a.id)).r
  chk('🔒 ביטול שעה לפני התור מותר למנהלת (אין cancel_cutoff_hours)',
    res.outcome === 'applied', `outcome=${res.outcome}`)
}

{
  // 🔒 אבל ביטול רטרואקטיבי חסום.
  const c = await makeCustomer()
  const past = await one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, calendar_sync_status, calendar_sync_operation)
     values ($1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             now() - interval '2 hours', 20, 'confirmed', 'synced', 'upsert')
     returning *`, [c.id])

  const res = (await cancelByAdmin(past.id)).r
  chk('🔒 תור שכבר התחיל אינו ניתן לביטול (in_past)', res.outcome === 'in_past',
    `outcome=${res.outcome}`)

  const row = await one(`select status from public.appointments where id=$1`, [past.id])
  chk('התור שעבר נשאר confirmed — לא נגעו בהיסטוריה עסקית', row.status === 'confirmed', row.status)

  const notifs = await notifsFor(past.id)
  chk('לא נשלחה שום התראה על תור שעבר', notifs.length === 0)
}

{
  // completed אינו מבוטל — היסטוריה עסקית.
  const c = await makeCustomer()
  const done = await one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, calendar_sync_status, calendar_sync_operation)
     values ($1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             now() - interval '10 days', 20, 'completed', 'synced', 'upsert')
     returning *`, [c.id])

  const res = (await cancelByAdmin(done.id)).r
  chk('🔒 תור שהושלם מוחזר כ-not_cancellable עם הסטטוס בפועל',
    res.outcome === 'not_cancellable' && res.current_status === 'completed',
    `${res.outcome}/${res.current_status}`)
}

{
  const c = await makeCustomer()
  const a = await makeConfirmed(c.id, hours(30))
  let blocked = false
  try {
    await cancelByAdmin(a.id, OUTSIDER)
  } catch (e) {
    blocked = /NOT_ADMIN/.test(e.message)
  }
  chk('🔒 מזהה שאינו בטבלת admins נחסם (NOT_ADMIN)', blocked)

  const row = await one(`select status from public.appointments where id=$1`, [a.id])
  chk('התור לא השתנה בניסיון הלא מורשה', row.status === 'confirmed', row.status)
}

{
  // lease פעיל — לא מושכים את השטיח מתחת לפעולת יומן שרצה.
  const c = await makeCustomer()
  const a = await makeConfirmed(c.id, hours(40))
  await db.query(
    `update public.appointments
     set calendar_sync_status='syncing', calendar_sync_started_at=now() where id=$1`, [a.id])

  let blocked = false
  try {
    await cancelByAdmin(a.id)
  } catch (e) {
    blocked = /SYNC_IN_PROGRESS/.test(e.message)
  }
  chk('🔒 סנכרון יומן פעיל חוסם את הביטול (SYNC_IN_PROGRESS)', blocked)
}

// ════════════════════════════════════════════════════════════════════════════
section('0028 — עריכה, ארכיון ומחיקה')

const updateDetails = (id, fields, adminId = ADMIN) =>
  one(`select public.update_customer_details($1,$2,$3,$4) as r`,
    [id, adminId, fields.name ?? null, fields.phone ?? null])

{
  const c = await makeCustomer('שם ישן')
  const res = (await updateDetails(c.id, { name: 'שם חדש' })).r
  chk('עדכון שם מחזיר updated', res.outcome === 'updated', `outcome=${res.outcome}`)

  const row = await one(`select full_name from public.customers where id=$1`, [c.id])
  chk('השם נשמר', row.full_name === 'שם חדש', row.full_name)

  const act = await all(
    `select action, old_value, new_value from public.customer_crm_activity
     where customer_id=$1 and action='name_updated'`, [c.id])
  chk('נרשמה פעילות name_updated עם הערך הישן והחדש',
    act.length === 1 && act[0].old_value === 'שם ישן' && act[0].new_value === 'שם חדש')

  const again = (await updateDetails(c.id, { name: 'שם חדש' })).r
  chk('עדכון לאותו ערך מחזיר no_change ואינו כותב פעילות',
    again.outcome === 'no_change', `outcome=${again.outcome}`)
}

{
  // 🔒 הסעיף המסוכן: טלפון של לקוחה מחוברת.
  const linked = await makeCustomer('לקוחה מחוברת', OUTSIDER)
  let blocked = false
  try {
    await updateDetails(linked.id, { phone: '+972501112233' })
  } catch (e) {
    blocked = /HAS_LOGIN_ACCOUNT/.test(e.message)
  }
  chk('🔒 שינוי טלפון ללקוחה עם חשבון התחברות חסום (HAS_LOGIN_ACCOUNT)', blocked)

  const manual = await makeCustomer('לקוחה ידנית')
  const res = (await updateDetails(manual.id, { phone: '+972501112233' })).r
  chk('שינוי טלפון ללקוחה בלי חשבון מותר', res.outcome === 'updated', `outcome=${res.outcome}`)

  const act = await all(
    `select old_value, new_value from public.customer_crm_activity
     where customer_id=$1 and action='phone_updated'`, [manual.id])
  chk('🔒 הטלפון **אינו** נשמר ביומן הפעילות',
    act.length === 1 && act[0].old_value === null && act[0].new_value === null)

  const other = await makeCustomer('לקוחה אחרת')
  let taken = false
  try {
    await updateDetails(other.id, { phone: '+972501112233' })
  } catch (e) {
    taken = /PHONE_TAKEN/.test(e.message)
  }
  chk('🔒 מספר שכבר קיים במערכת נדחה (PHONE_TAKEN)', taken)
}

{
  const c = await makeCustomer('לארכוב')
  const res = (await one(`select public.archive_customer($1,$2) as r`, [c.id, ADMIN])).r
  chk('ארכוב מחזיר archived', res.outcome === 'archived', `outcome=${res.outcome}`)

  const row = await one(`select archived_at, archived_by from public.customers where id=$1`, [c.id])
  chk('archived_at ו-archived_by נשמרו יחד',
    row.archived_at !== null && row.archived_by === ADMIN)

  const again = (await one(`select public.archive_customer($1,$2) as r`, [c.id, ADMIN])).r
  chk('ארכוב חוזר idempotent (already_archived)', again.outcome === 'already_archived')

  const back = (await one(`select public.unarchive_customer($1,$2) as r`, [c.id, ADMIN])).r
  const after = await one(`select archived_at, archived_by from public.customers where id=$1`, [c.id])
  chk('החזרה מהארכיון מנקה את שני השדות',
    back.outcome === 'unarchived' && after.archived_at === null && after.archived_by === null)
}

{
  const c = await makeCustomer('עם תור עתידי')
  await makeConfirmed(c.id, hours(50))
  const res = (await one(`select public.archive_customer($1,$2) as r`, [c.id, ADMIN])).r
  chk('🔒 לקוחה עם תור פעיל בעתיד אינה ניתנת לארכוב',
    res.outcome === 'blocked_active_appointments' && res.active_count === 1,
    `${res.outcome}/${res.active_count}`)
}

{
  // 🔒 היסטוריה עסקית לא נמחקת.
  const c = await makeCustomer('עם היסטוריה')
  await one(
    `insert into public.appointments
       (customer_id, service_key, variants, price_total, starts_at, duration_min,
        status, calendar_sync_status, calendar_sync_operation)
     values ($1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
             now() - interval '30 days', 20, 'completed', 'synced', 'upsert')
     returning id`, [c.id])

  const res = (await one(`select public.delete_customer_if_safe($1,$2) as r`, [c.id, ADMIN])).r
  chk('🔒 לקוחה עם תור אינה נמחקת (blocked_has_appointments)',
    res.outcome === 'blocked_has_appointments' && res.appointment_count === 1,
    `${res.outcome}/${res.appointment_count}`)

  const still = await one(`select id from public.customers where id=$1`, [c.id])
  chk('הכרטיס עדיין קיים', still !== undefined)

  // ה-FK עצמו הוא האכיפה — גם מול DELETE ידני.
  let fkBlocked = false
  try {
    await db.query(`delete from public.customers where id=$1`, [c.id])
  } catch (e) {
    fkBlocked = /foreign key|violates/i.test(e.message)
  }
  chk('🔒 גם DELETE ישיר נחסם ע"י on delete restrict', fkBlocked)
}

{
  const c = await makeCustomer('בלי תורים')
  await db.query(
    `insert into public.customer_notes (customer_id, body, created_by_admin_id, client_request_id)
     values ($1,'הערה',$2,gen_random_uuid())`, [c.id, ADMIN])

  const res = (await one(`select public.delete_customer_if_safe($1,$2) as r`, [c.id, ADMIN])).r
  chk('לקוחה בלי אף תור ובלי חשבון נמחקת', res.outcome === 'deleted', `outcome=${res.outcome}`)

  const gone = await one(`select id from public.customers where id=$1`, [c.id])
  chk('הכרטיס אינו קיים יותר', gone === undefined)

  const notes = await all(`select id from public.customer_notes where customer_id=$1`, [c.id])
  chk('ההערות נמחקו איתה ב-cascade', notes.length === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔴 0028 — מחיקה לעולם לא משאירה auth יתום')

/*
 * ═══ מה נבדק כאן, ולמה זה החלק המסוכן ביותר ב-15H ═══
 *
 * מחיקת שורת customers **אינה** נוגעת ב-auth.users: ה-FK הוא
 * `on delete set null` ובכיוון ההפוך בלבד. בלי החסימה, מחיקת לקוחה
 * מחוברת הייתה משאירה שלוש שאריות בבת אחת:
 *
 *   1. auth user שאינו מצביע על אף לקוחה
 *   2. sessions חיים — app_sessions תלוי ב-auth user, לא בכרטיס
 *   3. כרטיס חדש בשקט בהתחברות הבאה
 *
 * ואי אפשר למחוק את ה-auth user באותה טרנזקציה: הוא שייך ל-GoTrue.
 * לכן הכלל הוא חסימה מוחלטת, וכאן מוכיחים שהיא באמת חוסמת.
 */

const AUTH_LINKED = '33333333-3333-3333-3333-333333333333'
await db.query(`insert into auth.users (id) values ($1)`, [AUTH_LINKED])

{
  const linked = await makeCustomer('מחוברת בלי תורים', AUTH_LINKED)

  const res = (await one(`select public.delete_customer_if_safe($1,$2) as r`, [linked.id, ADMIN])).r
  chk('🔴 לקוחה עם חשבון התחברות **אינה נמחקת**, גם בלי אף תור',
    res.outcome === 'blocked_has_login_account', `outcome=${res.outcome}`)

  const still = await one(`select id, auth_user_id from public.customers where id=$1`, [linked.id])
  chk('הכרטיס נשאר, והקישור ל-auth נשאר שלם',
    still !== undefined && still.auth_user_id === AUTH_LINKED)

  const authRow = await one(`select id from auth.users where id=$1`, [AUTH_LINKED])
  chk('🔴 ה-auth user לא נגע — אין זהות יתומה', authRow !== undefined)

  /*
   * 🔒 הוכחת ה-mapping: **אין** ב-DB שום auth user שנשאר בלי לקוחה
   * בעקבות פעולות הבדיקה. זו הטענה שהמשתמש ביקש לאכוף — "לעולם לא
   * להשאיר orphan auth/customer mapping" — והיא נבדקת על מצב המסד כולו
   * ולא על שורה בודדת.
   *
   * ⚠️ ADMIN ו-OUTSIDER מוחרגים: הראשון הוא חשבון ניהול (אינו לקוחה
   * מלכתחילה), והשני נוצר כ-auth user לבדיקות הרשאה ולא כלקוחה.
   */
  const orphans = await all(
    `select u.id from auth.users u
     left join public.customers c on c.auth_user_id = u.id
     where c.id is null and u.id not in ($1,$2)`, [ADMIN, OUTSIDER])
  chk('🔴 אין ולו auth user אחד ללא לקוחה מקושרת', orphans.length === 0,
    orphans.length ? `${orphans.length} יתומים` : '')
}

{
  // ה-session חי אחרי מחיקה — ההוכחה שהחסימה אינה "ליתר ביטחון".
  const sessionAuth = '44444444-4444-4444-4444-444444444444'
  await db.query(`insert into auth.users (id) values ($1)`, [sessionAuth])
  const c = await makeCustomer('עם session', sessionAuth)
  await db.query(
    `insert into public.app_sessions (id, auth_user_id, role, expires_at)
     values (gen_random_uuid(), $1, 'customer', now() + interval '30 days')`, [sessionAuth])

  const res = (await one(`select public.delete_customer_if_safe($1,$2) as r`, [c.id, ADMIN])).r
  chk('לקוחה עם session פעיל נחסמת מאותה סיבה',
    res.outcome === 'blocked_has_login_account', `outcome=${res.outcome}`)

  /*
   * ⚠️ הבדיקה שמסבירה **למה** החסימה נחוצה: ה-session תלוי ב-auth user
   * ולא בלקוחה. אילו המחיקה הייתה עוברת, השורה הזו הייתה שורדת אותה —
   * cookie חתום ותקף שמצביע על לקוחה שאינה קיימת.
   */
  const sessions = await all(
    `select id from public.app_sessions where auth_user_id=$1`, [sessionAuth])
  chk('🔒 ה-session תלוי ב-auth user ולא בכרטיס — לכן מחיקה לא הייתה מנקה אותו',
    sessions.length === 1)

  // ניקוי, כדי שבדיקת ה-orphans הגלובלית למטה תישאר משמעותית.
  await db.query(`delete from public.app_sessions where auth_user_id=$1`, [sessionAuth])
}

{
  /*
   * 🔒 שתי הנחות היסוד של החסימה, ישירות מהסכימה.
   *
   * ⚠️ הסינון לפי **שם העמודה** אינו קישוט: מ-customers יוצאים *שני* FK
   * ל-auth.users — auth_user_id (SET NULL) ו-archived_by שנוסף ב-0028
   * (NO ACTION, כמו created_by_admin_id ב-0009). בדיקה בלי הסינון תופסת
   * את מי מהם שיחזור ראשון, ועוברת או נכשלת באקראי.
   */
  const custFk = await one(
    `select confdeltype from pg_constraint
     where conrelid='public.customers'::regclass and contype='f'
       and confrelid='auth.users'::regclass
       and pg_get_constraintdef(oid) like 'FOREIGN KEY (auth\\_user\\_id)%'`)
  chk('🔒 customers.auth_user_id הוא on delete set null (מחיקת auth אינה מוחקת לקוחה)',
    custFk?.confdeltype === 'n', `confdeltype=${custFk?.confdeltype}`)

  const sessFk = await one(
    `select confdeltype from pg_constraint
     where conrelid='public.app_sessions'::regclass and contype='f'
       and confrelid='auth.users'::regclass`)
  chk('🔒 app_sessions.auth_user_id הוא on delete cascade (sessions תלויים ב-auth)',
    sessFk?.confdeltype === 'c', `confdeltype=${sessFk?.confdeltype}`)
}

{
  // ארכיון הוא המסלול החלופי, וחייב לעבוד בדיוק על הלקוחה שנחסמה למחיקה.
  const authId = '55555555-5555-5555-5555-555555555555'
  await db.query(`insert into auth.users (id) values ($1)`, [authId])
  const c = await makeCustomer('מחוברת לארכוב', authId)

  const res = (await one(`select public.archive_customer($1,$2) as r`, [c.id, ADMIN])).r
  chk('🔒 לקוחה מחוברת שאי אפשר למחוק — **כן** ניתנת לארכוב',
    res.outcome === 'archived', `outcome=${res.outcome}`)

  const row = await one(
    `select archived_at, auth_user_id from public.customers where id=$1`, [c.id])
  chk('הארכוב שימר את הקישור ל-auth — הלקוחה תוכל להתחבר ולראות את ההיסטוריה',
    row.archived_at !== null && row.auth_user_id === authId)
}

{
  let blocked = false
  const c = await makeCustomer('מוגן')
  try {
    await one(`select public.delete_customer_if_safe($1,$2) as r`, [c.id, OUTSIDER])
  } catch (e) {
    blocked = /NOT_ADMIN/.test(e.message)
  }
  chk('🔒 מחיקה ע"י מי שאינו מנהלת נחסמת', blocked)
}

// ════════════════════════════════════════════════════════════════════════════
section('0028 — הרשימה מסתירה את הארכיון')

{
  const visible = await makeCustomer('גלויה ברשימה')
  const hidden = await makeCustomer('מוסתרת בארכיון')
  await one(`select public.archive_customer($1,$2) as r`, [hidden.id, ADMIN])

  const list = (await one(
    `select public.list_crm_customers(null,'all',null,'last_activity',null,null,100,0) as r`)).r
  const ids = list.items.map(i => i.id)
  chk('🔒 לקוחה מאורכבת אינה מופיעה ברשימה הרגילה', !ids.includes(hidden.id))
  chk('לקוחה רגילה כן מופיעה', ids.includes(visible.id))

  const archivedList = (await one(
    `select public.list_crm_customers(null,'archived',null,'last_activity',null,null,100,0) as r`)).r
  const archivedIds = archivedList.items.map(i => i.id)
  chk('הפילטר archived מציג אותה ואותה בלבד',
    archivedIds.includes(hidden.id) && !archivedIds.includes(visible.id))
  chk('archived_at נחשף ברשימה',
    archivedList.items.find(i => i.id === hidden.id)?.archived_at != null)

  // 🔒 קישור ישיר חייב להמשיך לעבוד — אחרת אי אפשר להוציא מהארכיון.
  const profile = (await one(`select public.get_crm_customer($1) as r`, [hidden.id])).r
  chk('🔒 הכרטיס הבודד נטען גם כשהוא בארכיון', profile?.id === hidden.id)
  chk('archived_at נחשף גם בכרטיס', profile?.archived_at != null)
}

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '⛔'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
