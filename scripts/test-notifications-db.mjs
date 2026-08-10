/**
 * בדיקות שלב 15F — 0024 + 0025 מול Postgres אמיתי (PGlite).
 *
 * המיקוד הוא בהחלטות שאין דרך לתקן בדיעבד אם ישתבשו:
 *
 *   1. 🔒 **ביטול תור מקורי אינו שולח "בקשת שינוי המועד לא אושרה".**
 *      0022 סוגרת בקשה פתוחה ב-'rejected' באותה טרנזקציה, וטריגר נאיבי היה
 *      שולח ללקוחה הודעה שקרית על בקשה שהיא עצמה סגרה. זו הסיבה שהטריגר
 *      יושב על appointment_history ולא על appointments.
 *
 *   2. 🔒 **לחיצה כפולה אינה שולחת פעמיים** — unique ברמת DB, לא בדיקה בקוד.
 *
 *   3. 🔒 **delivery_unknown לעולם אינו הופך ל-retrying.**
 *
 *   4. 🔒 **ביטול מצד העסק (מחיקת אירוע ביומן) מיידע את הלקוחה** — הפער
 *      שהיה פתוח עד 15F.
 *
 *   5. מה שאינו מייצר התראה: תפוגה, יצירה ידנית ע"י שובל, הזזה מ-Google.
 *
 * הרצה:  npm run test:notifications-db
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(66)}${extra}`)
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
chk('0024 ו-0025 ברשימה',
  migrations.includes('0024_admin_notification_phone.sql')
  && migrations.includes('0025_appointment_notifications.sql'))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
const hours = h => new Date(Date.now() + h * 3600_000).toISOString()

const ADMIN = '11111111-1111-1111-1111-111111111111'

let phoneSeq = 0
// customers_phone_e164_check: ^\+9725[0-9]{8}$ — כלומר +9725 ואחריו 8 ספרות.
const nextPhone = () => `+9725${String(20000000 + phoneSeq++).slice(-8)}`

async function makeCustomer(name = 'לקוחה') {
  return one(
    `insert into public.customers (phone_e164, full_name) values ($1,$2) returning *`,
    [nextPhone(), name],
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

/** ההתראות של תור, כרשימת "event/role" ממוינת — קריאה בקלות בהשוואות. */
async function notifsFor(appointmentId) {
  const rows = await all(
    `select event, recipient_role, status from public.appointment_notifications
     where appointment_id = $1 order by event, recipient_role`,
    [appointmentId],
  )
  return rows.map(r => `${r.event}/${r.recipient_role}`)
}

// ════════════════════════════════════════════════════════════════════════════
section('0024 — יעד ההתראות')

const unsetPhone = await one(`select public.admin_notification_phone() as p`)
chk('🔒 היעד מתחיל כלא-מוגדר (המיגרציה אינה מנחשת מספר)', unsetPhone.p === null,
  `p=${unsetPhone.p}`)

const settingRow = await one(
  `select value from public.business_settings where key='admin_notification_phone'`)
chk('השורה קיימת וגלויה לעריכה', settingRow !== undefined)

/**
 * 🔒 קוד הכניסה לבניין — ב-DB ולא ב-git.
 *
 * ⚠️ הקוד נמסר לכל לקוחה בהודעת האישור ואינו סוד מבצעי, אבל מחרוזת
 * שנכנסת ל-git נשארת שם לתמיד — גם אחרי שהקוד בבניין יוחלף.
 */
const entryCode = await one(
  `select value from public.business_settings where key='building_entry_code'`)
chk('🔒 building_entry_code קיים ומתחיל ריק', entryCode !== undefined
  && (entryCode.value === null || entryCode.value === 'null'),
  JSON.stringify(entryCode?.value))

await db.query(`update public.business_settings set value=$1::jsonb where key='admin_notification_phone'`,
  ['"not-a-phone"'])
const badPhone = await one(`select public.admin_notification_phone() as p`)
chk('🔒 ערך פסול מחזיר null ולא מספר שגוי', badPhone.p === null, `p=${badPhone.p}`)

await db.query(`update public.business_settings set value=$1::jsonb where key='admin_notification_phone'`,
  ['"+972501112233"'])
const goodPhone = await one(`select public.admin_notification_phone() as p`)
chk('ערך תקין נקרא כמו שהוא', goodPhone.p === '+972501112233', `p=${goodPhone.p}`)

// ════════════════════════════════════════════════════════════════════════════
section('0ב. 🔒 מתג ההפעלה — כבוי = אפס רישום')

chk('🔒 המתג מתחיל כבוי אחרי המיגרציה',
  (await one(`select public.setting_boolean('notifications_enabled', false) as b`)).b === false)

/**
 * 🔒 **הבדיקה המרכזית של המתג.**
 *
 * ⚠️ הדרישה אינה "לא נשלח" אלא **"לא נרשם"**. אילו הטריגר היה ממשיך
 * לרשום שורות בזמן שהמתג כבוי, רגע ההפעלה היה משחרר backlog של התראות על
 * תורים שכבר אושרו, בוטלו או קרו — כולן בבת אחת, ללקוחות אמיתיות.
 */
const cOff = await makeCustomer()
const reqOff = await one(
  `select * from public.create_personal_area_booking_request(
     $1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
     $2::timestamptz, 20, null, 'v1', $3::timestamptz)`,
  [cOff.id, hours(30), hours(3)],
)
chk('🔒 מתג כבוי → אפס שורות התראה (אין backlog)',
  (await notifsFor(reqOff.id)).length === 0, (await notifsFor(reqOff.id)).join(','))

await db.query(`select public.approve_pending_appointment($1,$2)`, [reqOff.id, ADMIN])
chk('🔒 גם אישור בזמן כיבוי אינו רושם כלום',
  (await notifsFor(reqOff.id)).length === 0, (await notifsFor(reqOff.id)).join(','))

// ⚠️ ערך פסול = כבוי, לא דלוק. מצב לא-ידוע אינו סיבה לשלוח SMS.
await db.query(`update public.business_settings set value='"maybe"'::jsonb where key='notifications_enabled'`)
const cBad = await makeCustomer()
const reqBad = await one(
  `select * from public.create_personal_area_booking_request(
     $1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
     $2::timestamptz, 20, null, 'v1', $3::timestamptz)`,
  [cBad.id, hours(31), hours(3)],
)
chk('🔒 ערך פסול במתג = כבוי (fail-closed)',
  (await notifsFor(reqBad.id)).length === 0, (await notifsFor(reqBad.id)).join(','))

// מכאן ואילך — המתג דלוק, וכל שאר הבדיקות רצות מולו.
await db.query(`update public.business_settings set value='true'::jsonb where key='notifications_enabled'`)
chk('המתג נדלק לשאר הבדיקות',
  (await one(`select public.setting_boolean('notifications_enabled', false) as b`)).b === true)

// 🔒 האירועים שקרו בזמן הכיבוי אינם "מתעוררים" בדיעבד.
chk('🔒 הפעלה אינה מייצרת רטרואקטיבית התראות על מה שקרה בזמן הכיבוי',
  (await notifsFor(reqOff.id)).length === 0, (await notifsFor(reqOff.id)).join(','))

// ════════════════════════════════════════════════════════════════════════════
section('1. בקשת תור → שובל')

const req1 = await one(
  `select * from public.create_public_booking_request(
     $1,'לקוחה ציבורית','עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
     $2::timestamptz, 20, null, 'v1', $3::timestamptz, '1.2.3.4'::inet, 5)`,
  [nextPhone(), hours(48), hours(3)],
)
const c1 = { id: req1.customer_id }
chk('בקשה ציבורית מייצרת booking_requested/admin',
  (await notifsFor(req1.id)).join(',') === 'booking_requested/admin',
  (await notifsFor(req1.id)).join(','))

const c2 = await makeCustomer()
const req2 = await one(
  `select * from public.create_personal_area_booking_request(
     $1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
     $2::timestamptz, 20, null, 'v1', $3::timestamptz)`,
  [c2.id, hours(50), hours(3)],
)
chk('🔒 בקשה מהאזור האישי מייצרת בדיוק את אותה התראה (טריגר אחד לשני המסלולים)',
  (await notifsFor(req2.id)).join(',') === 'booking_requested/admin',
  (await notifsFor(req2.id)).join(','))

// ════════════════════════════════════════════════════════════════════════════
section('2. אישור ודחייה → הלקוחה')

await db.query(`select public.approve_pending_appointment($1,$2)`, [req1.id, ADMIN])
chk('אישור מוסיף booking_approved/customer',
  (await notifsFor(req1.id)).includes('booking_approved/customer'),
  (await notifsFor(req1.id)).join(','))
chk('🔒 והתראת הבקשה המקורית נשארת — היסטוריה ולא החלפה',
  (await notifsFor(req1.id)).includes('booking_requested/admin'))

await db.query(`select public.reject_pending_appointment($1,$2)`, [req2.id, ADMIN])
chk('דחייה מוסיפה booking_rejected/customer',
  (await notifsFor(req2.id)).includes('booking_rejected/customer'),
  (await notifsFor(req2.id)).join(','))

// ⚠️ לחיצה כפולה: ה-RPC השנייה נכשלת ב-NOT_PENDING, אבל גם אילו הייתה
// עוברת — ה-unique הוא מה שמונע התראה שנייה, לא ה-RPC.
const dupCount = await one(
  `select count(*)::int c from public.appointment_notifications
   where appointment_id=$1 and event='booking_approved' and recipient_role='customer'`,
  [req1.id])
chk('🔒 שורה אחת בלבד לכל (תור, אירוע, נמען)', dupCount.c === 1, `c=${dupCount.c}`)

/**
 * 🔒 enqueue חוזר על **אותה שורת היסטוריה** אינו יוצר שורה שנייה.
 *
 * ⚠️ זהו מסלול ה-retry: אותו אירוע עסקי, אותו מפתח, שום דבר חדש.
 */
const histId = await one(
  `select source_history_id h from public.appointment_notifications
   where appointment_id=$1 and event='booking_approved'`, [req1.id])
await db.query(
  `select public.enqueue_appointment_notification($1,$2,'booking_approved','customer')`,
  [histId.h, req1.id])
const afterDup = await one(
  `select count(*)::int c from public.appointment_notifications
   where appointment_id=$1 and event='booking_approved'`, [req1.id])
chk('🔒 enqueue חוזר על אותה שורת היסטוריה אינו יוצר שורה שנייה',
  afterDup.c === 1, `c=${afterDup.c}`)

// ════════════════════════════════════════════════════════════════════════════
section('3. 🔴 ביטול המקור אינו מדווח על "דחיית בקשת שינוי"')

const c3 = await makeCustomer()
const orig = await makeConfirmed(c3.id, hours(72))
const rr = await one(
  `select * from public.create_reschedule_request($1,$2,$3::timestamptz,$4::timestamptz)`,
  [orig.id, c3.id, hours(96), hours(3)],
)
chk('בקשת שינוי מייצרת reschedule_requested/admin',
  (await notifsFor(rr.id)).join(',') === 'reschedule_requested/admin',
  (await notifsFor(rr.id)).join(','))

// הלקוחה מבטלת את התור המקורי. 0022 סוגרת את הבקשה ל-'rejected' באותה
// טרנזקציה, עם reason='original_cancelled'.
await db.query(`select public.cancel_confirmed_appointment_by_customer($1,$2)`, [orig.id, c3.id])

const reqStatus = await one(`select status from public.appointments where id=$1`, [rr.id])
chk('הבקשה אכן עברה ל-rejected (המצב שהטריגר חייב להבחין בו)',
  reqStatus.status === 'rejected', `status=${reqStatus.status}`)

const reqNotifs = await notifsFor(rr.id)
chk('🔴 🔒 **אין** reschedule_rejected — הלקוחה סגרה את זה בעצמה',
  !reqNotifs.includes('reschedule_rejected/customer'), reqNotifs.join(','))

const origNotifs = await notifsFor(orig.id)
chk('הלקוחה כן מקבלת התראה על הפעולה שקרתה — ביטול',
  origNotifs.includes('booking_cancelled/customer'), origNotifs.join(','))
chk('ושובל מקבלת אותה גם היא',
  origNotifs.includes('booking_cancelled/admin'), origNotifs.join(','))

// ════════════════════════════════════════════════════════════════════════════
section('4. דחיית בקשת שינוי ע"י שובל — כן מדווחת')

const c4 = await makeCustomer()
const orig4 = await makeConfirmed(c4.id, hours(120))
const rr4 = await one(
  `select * from public.create_reschedule_request($1,$2,$3::timestamptz,$4::timestamptz)`,
  [orig4.id, c4.id, hours(144), hours(3)],
)
await db.query(`select public.reject_reschedule_request($1,$2)`, [rr4.id, ADMIN])
chk('🔒 דחייה של שובל **כן** מייצרת reschedule_rejected/customer',
  (await notifsFor(rr4.id)).includes('reschedule_rejected/customer'),
  (await notifsFor(rr4.id)).join(','))

const c5 = await makeCustomer()
const orig5 = await makeConfirmed(c5.id, hours(168))
const rr5 = await one(
  `select * from public.create_reschedule_request($1,$2,$3::timestamptz,$4::timestamptz)`,
  [orig5.id, c5.id, hours(192), hours(3)],
)
await db.query(`select public.approve_reschedule_request($1,$2)`, [rr5.id, ADMIN])
chk('אישור שינוי מייצר reschedule_approved/customer',
  (await notifsFor(rr5.id)).includes('reschedule_approved/customer'),
  (await notifsFor(rr5.id)).join(','))
chk('🔒 ולא booking_approved — שני מצבים שונים לחלוטין',
  !(await notifsFor(rr5.id)).includes('booking_approved/customer'))
chk('🔒 התור המקורי שהוזז אינו מדווח כמבוטל',
  (await notifsFor(orig5.id)).length === 0, (await notifsFor(orig5.id)).join(','))

// ════════════════════════════════════════════════════════════════════════════
section('5. 🔴 ביטול מצד העסק — הפער שנסגר ב-15F')

const c6 = await makeCustomer()
const appt6 = await makeConfirmed(c6.id, hours(200))
await db.query(`select public.apply_google_cancellation($1,$2,$3)`,
  [appt6.id, appt6.google_event_id, 1])

const n6 = await notifsFor(appt6.id)
chk('🔴 מחיקת האירוע ביומן מיידעת את הלקוחה',
  n6.includes('booking_cancelled/customer'), n6.join(','))
chk('🔒 ולא את שובל — היא זו שביצעה את הפעולה',
  !n6.includes('booking_cancelled/admin'), n6.join(','))

// ════════════════════════════════════════════════════════════════════════════
section('6. מה שאינו מייצר התראה')

// תפוגה — 0003 כותבת 'expired' ולא 'rejected'
const c7 = await makeCustomer()
const req7 = await one(
  `select * from public.create_personal_area_booking_request(
     $1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
     $2::timestamptz, 20, null, 'v1', $3::timestamptz)`,
  [c7.id, hours(220), hours(3)],
)
// ⚠️ ה-RPC דוחה תפוגה בעבר (BAD_EXPIRY), ולכן מזדקנים את השורה ישירות.
await db.query(
  `update public.appointments set pending_expires_at = now() - interval '1 hour' where id = $1`,
  [req7.id])
await db.query(`select public.expire_stale_pending_appointments()`)
const st7 = await one(`select status from public.appointments where id=$1`, [req7.id])
chk('תפוגה כותבת expired', st7.status === 'expired', `status=${st7.status}`)
chk('🔒 תפוגה אינה מייצרת התראת דחייה',
  !(await notifsFor(req7.id)).some(n => n.includes('rejected')),
  (await notifsFor(req7.id)).join(','))

// יצירה ידנית ע"י שובל — created + confirmed, לא בקשה ולא אישור
const c8 = await makeCustomer()
// create_manual_appointment אוכפת assert_crm_actor_is_admin — נדרשת שורת admins.
await db.query(`insert into auth.users (id) values ($1) on conflict do nothing`, [ADMIN])
await db.query(`insert into public.admins (user_id) values ($1) on conflict do nothing`, [ADMIN])
const manualRes = await one(
  `select public.create_manual_appointment(
     $1,'עיצוב גבות טבעיות', array['עיצוב גבות טבעי']::text[], 70,
     $2::timestamptz, 20, 'v1', $3, gen_random_uuid(), repeat('a', 64)) as j`,
  [c8.id, hours(240), ADMIN],
)
const manualId = manualRes.j.appointment?.id ?? manualRes.j.appointment_id
chk('🔒 תור שנקבע ידנית ע"י שובל אינו מייצר שום התראה',
  (await notifsFor(manualId)).length === 0, (await notifsFor(manualId)).join(','))

// ════════════════════════════════════════════════════════════════════════════
section('6ב. 🔴 גרירת אירוע ביומן — התור זז תחת הלקוחה')

/**
 * ⚠️ המקרה היחיד שבו מועד התור משתנה בלי שהלקוחה ביקשה ובלי שאישרה.
 * ההתראה **נרשמת**, אבל אין לה נוסח מאושר — ולכן ה-dispatcher יסמן אותה
 * skipped/awaiting_approved_template והיא תופיע ברשימת "דורש טיפול".
 */
const c9 = await makeCustomer()
const appt9 = await makeConfirmed(c9.id, hours(300))
await db.query(`select public.apply_google_reschedule($1,$2,$3::timestamptz,$4,$5)`,
  [appt9.id, appt9.google_event_id, hours(310), true, 2])
chk('🔴 הזזה מ-Google רושמת appointment_moved_by_business/customer',
  (await notifsFor(appt9.id)).join(',') === 'appointment_moved_by_business/customer',
  (await notifsFor(appt9.id)).join(','))

/**
 * 🔴 🔒 **הבדיקה שקבעה את מפתח ה-idempotency.**
 *
 * ⚠️ שובל יכולה לגרור את אותו אירוע ביומן שוב ושוב, וכל גרירה היא מועד
 * חדש שהלקוחה חייבת לדעת עליו. מפתח לפי (תור, אירוע, נמען) היה רושם את
 * הראשונה ובולע את כל השאר ב-`on conflict do nothing` — הלקוחה הייתה
 * נשארת עם המועד הראשון ומגיעה ביום הלא נכון.
 */
await db.query(`select public.apply_google_reschedule($1,$2,$3::timestamptz,$4,$5)`,
  [appt9.id, appt9.google_event_id, hours(320), true, 5])
const afterSecondMove = await all(
  `select id, source_history_id from public.appointment_notifications
   where appointment_id=$1 and event='appointment_moved_by_business'`, [appt9.id])
chk('🔴 🔒 גרירה **שנייה** מייצרת התראה שנייה',
  afterSecondMove.length === 2, `rows=${afterSecondMove.length}`)
chk('🔒 ושתיהן נשענות על שורות היסטוריה שונות',
  new Set(afterSecondMove.map(r => r.source_history_id)).size === 2)

// ⚠️ המועד נשמר במשתנה: hours() נגזר מ-Date.now() בכל קריאה, ושתי קריאות
// רצופות מחזירות חותמות שונות — כלומר לא echo אלא הזזה נוספת.
const thirdMoveAt = hours(330)
await db.query(`select public.apply_google_reschedule($1,$2,$3::timestamptz,$4,$5)`,
  [appt9.id, appt9.google_event_id, thirdMoveAt, true, 6])
chk('🔴 וגם שלישית', (await all(
  `select 1 from public.appointment_notifications
   where appointment_id=$1 and event='appointment_moved_by_business'`, [appt9.id])).length === 3)

/**
 * ⚠️ הכיוון ההפוך: `apply_google_reschedule` על **אותו מועד** היא echo,
 * יוצאת מוקדם ואינה כותבת היסטוריה — ולכן אינה מייצרת התראה רביעית.
 * זהו ה-retry האמיתי של המסלול הזה.
 */
const echo = await one(`select public.apply_google_reschedule($1,$2,$3::timestamptz,$4,$5) as j`,
  [appt9.id, appt9.google_event_id, thirdMoveAt, true, 7])
chk('אותו מועד מסווג echo ע"י ה-RPC', echo.j.outcome === 'echo', `outcome=${echo.j.outcome}`)
chk('🔒 echo (אותו מועד) אינו מייצר התראה נוספת', (await all(
  `select 1 from public.appointment_notifications
   where appointment_id=$1 and event='appointment_moved_by_business'`, [appt9.id])).length === 3)
chk('🔒 ולא מדווחת כביטול או כאישור שינוי',
  !(await notifsFor(appt9.id)).some(n =>
    n.includes('cancelled') || n.includes('reschedule_approved')))

// ⚠️ אישור בקשת שינוי כותב אף הוא action='rescheduled' על התור המקורי —
// אבל עם to_status='rescheduled' ובלי source='google_calendar'. ההפרדה
// הזו היא מה שמונע התראה כפולה על כל אישור שינוי מועד.
chk('🔒 אישור בקשת שינוי אינו נספר כגרירה מ-Google',
  !(await notifsFor(orig5.id)).includes('appointment_moved_by_business/customer'),
  (await notifsFor(orig5.id)).join(','))

// ════════════════════════════════════════════════════════════════════════════
section('7. claim / finish')

const target = await one(
  `select id from public.appointment_notifications
   where appointment_id=$1 and recipient_role='customer' limit 1`, [appt6.id])

const LEASE = '22222222-2222-2222-2222-222222222222'
const claimed = await one(
  `select * from public.claim_appointment_notification($1,$2,120,4,'sms_019')`,
  [appt6.id, LEASE])
chk('claim תופסת שורה ומעלה attempt_count',
  claimed.id === target.id && claimed.status === 'sending' && claimed.attempt_count === 1,
  `status=${claimed.status} n=${claimed.attempt_count}`)

const claimedAgain = await one(
  `select * from public.claim_appointment_notification($1,$2,120,4,'sms_019')`,
  [appt6.id, '33333333-3333-3333-3333-333333333333'])
chk('🔒 שורה שנתפסה אינה נתפסת שוב', claimedAgain.id === null, `id=${claimedAgain.id}`)

const attemptRow = await one(
  `select count(*)::int c from public.appointment_notification_attempts where notification_id=$1`,
  [target.id])
chk('נפתחה שורת אודיט לניסיון', attemptRow.c === 1, `c=${attemptRow.c}`)

// 🔒 delivery_unknown — סופי
const unknownDone = await one(
  `select * from public.finish_notification_attempt($1,$2,'delivery_unknown','sms019_timeout',null,'sms_019',4)`,
  [target.id, LEASE])
chk('🔒 delivery_unknown נשאר delivery_unknown ולא retrying',
  unknownDone.status === 'delivery_unknown', `status=${unknownDone.status}`)
chk('🔒 delivery_unknown אינו נתפס שוב אוטומטית', (await one(
  `select * from public.claim_appointment_notification($1,$2,120,4,'sms_019')`,
  [appt6.id, LEASE])).id === null)

// retryable → retrying, ואחרי מיצוי → failed
const c10 = await makeCustomer()
const appt10 = await makeConfirmed(c10.id, hours(400))
await db.query(`select public.apply_google_cancellation($1,$2,$3)`,
  [appt10.id, appt10.google_event_id, 3])
const n10 = await one(
  `select id from public.appointment_notifications where appointment_id=$1 limit 1`, [appt10.id])

const cl10 = await one(
  `select * from public.claim_appointment_notification($1,$2,120,2,'sms_019')`, [appt10.id, LEASE])
const r10 = await one(
  `select * from public.finish_notification_attempt($1,$2,'retryable_error','sms019_http_500',null,'sms_019',2)`,
  [n10.id, LEASE])
chk('שגיאה זמנית → retrying', r10.status === 'retrying', `status=${r10.status}`)

const cl10b = await one(
  `select * from public.claim_appointment_notification($1,$2,120,2,'sms_019')`, [appt10.id, LEASE])
chk('retrying נתפסת שוב לניקוז ידני', cl10b.id === n10.id && cl10b.attempt_count === 2,
  `n=${cl10b.attempt_count}`)
const r10b = await one(
  `select * from public.finish_notification_attempt($1,$2,'retryable_error','sms019_http_500',null,'sms_019',2)`,
  [n10.id, LEASE])
chk('🔒 מיצוי הניסיונות → failed ולא לולאה אינסופית',
  r10b.status === 'failed', `status=${r10b.status}`)

// 🔒 ספק שאינו אמיתי לא יכול להיות 'sent'
const c11 = await makeCustomer()
const appt11 = await makeConfirmed(c11.id, hours(500))
await db.query(`select public.apply_google_cancellation($1,$2,$3)`,
  [appt11.id, appt11.google_event_id, 4])
await db.query(`select public.claim_appointment_notification($1,$2,120,4,'simulated')`,
  [appt11.id, LEASE])
const n11 = await one(
  `select id from public.appointment_notifications where appointment_id=$1 limit 1`, [appt11.id])
const sim = await one(
  `select * from public.finish_notification_attempt($1,$2,'accepted',null,'msg-1','simulated',4)`,
  [n11.id, LEASE])
chk("🔒 ספק שאינו אמיתי מקבל 'simulated' ולא 'sent'",
  sim.status === 'simulated', `status=${sim.status}`)

// ════════════════════════════════════════════════════════════════════════════
section('8. טעינת הנמען — טלפון בלבד')

const custPhone = await one(
  `select public.notification_recipient_phone($1,'customer') as p`, [appt6.id])
chk('נמען customer = הטלפון של הלקוחה', custPhone.p === (await one(
  `select phone_e164 p from public.customers where id=$1`, [c6.id])).p, `p=${custPhone.p}`)

const adminPhone = await one(
  `select public.notification_recipient_phone($1,'admin') as p`, [appt6.id])
chk('נמען admin = היעד מ-business_settings', adminPhone.p === '+972501112233', `p=${adminPhone.p}`)

await db.query(`update public.business_settings set value='null'::jsonb where key='admin_notification_phone'`)
const adminUnset = await one(
  `select public.notification_recipient_phone($1,'admin') as p`, [appt6.id])
chk('🔒 יעד לא מוגדר → null (המסלול ל-skipped, לא שליחה למספר מומצא)',
  adminUnset.p === null, `p=${adminUnset.p}`)

// ════════════════════════════════════════════════════════════════════════════
section('9. הרשאות')

const exposed = await all(`
  select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and p.proname in ('enqueue_appointment_notification','claim_appointment_notification',
                      'finish_notification_attempt','skip_notification',
                      'notification_recipient_phone','admin_notification_phone')
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'))
`)
chk('🔒 אף פונקציה של 15F אינה חשופה ל-anon/authenticated',
  exposed.length === 0, exposed.map(r => r.proname).join(', '))

for (const t of ['appointment_notifications', 'appointment_notification_attempts']) {
  const rls = await one(
    `select relrowsecurity r from pg_class where oid = ('public.' || $1)::regclass`, [t])
  chk(`RLS פעיל על ${t}`, rls.r === true)
  const grants = await all(`
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated')`, [t])
  chk(`🔒 אין הרשאות ל-anon/authenticated על ${t}`, grants.length === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('10. 🔴 business_settings — הסודות אינם נגישים ל-anon')

/**
 * 🔴 **הבדיקה הזו נולדה מדליפה אמיתית שנתפסה לפני production.**
 *
 * 0001 יצרה `business_settings_read ... using (true)` עם ההערה "אלה מספרי
 * מדיניות שגם ככה מפורסמים באתר" — נכון לגמרי באותו רגע. 0024 הוסיפה
 * `admin_notification_phone` ו-`building_entry_code`, ו-`using(true)` חל
 * עליהן אוטומטית. בפרודקשן, שבה Supabase מעניקה SELECT ל-anon כברירת
 * מחדל, כל מי שמחזיק את מפתח ה-anon (שנמצא ב-JS של הדפדפן בהגדרה) היה
 * מקבל את שניהם ב-`select('*')`.
 *
 * 0026 סוגרת בשתי שכבות. הבדיקה כאן מכסה את **השנייה** — ה-policy —
 * ולכן היא מעניקה SELECT במפורש: זה מדמה גם את ברירת המחדל של Supabase
 * וגם את התרחיש שבו מישהו יעניק הרשאה מחדש בעתיד.
 */
await db.exec(`update public.business_settings set value='"+972501112233"'::jsonb
               where key='admin_notification_phone'`)
await db.exec(`update public.business_settings set value='"#0000"'::jsonb
               where key='building_entry_code'`)

// 🔒 שכבה 1 — ההרשאה עצמה הוסרה ע"י 0026.
for (const role of ['anon', 'authenticated']) {
  const g = await one(
    `select has_table_privilege($1,'public.business_settings','select') as g`, [role])
  chk(`🔒 שכבה 1 — ל-${role} אין SELECT על business_settings`, g.g === false)
}

// 🔒 שכבה 2 — גם עם ההרשאה, ה-policy חוסם את הסודות.
await db.exec(`grant select on public.business_settings to anon, authenticated`)
await db.exec(`set role anon`)
const visible = (await all(`select key from public.business_settings order by key`))
  .map(r => r.key)
await db.exec(`reset role`)

chk('🔴 🔒 admin_notification_phone אינו נראה ל-anon',
  !visible.includes('admin_notification_phone'), visible.join(', '))
chk('🔴 🔒 building_entry_code אינו נראה ל-anon',
  !visible.includes('building_entry_code'), visible.join(', '))
chk('🔒 notifications_enabled אינו נראה ל-anon',
  !visible.includes('notifications_enabled'))

// ⚠️ הכיוון החיובי: מספרי המדיניות המפורסמים ממשיכים להיות נגישים.
chk('מספרי המדיניות המפורסמים נשארו נגישים',
  visible.includes('cancel_cutoff_hours') && visible.includes('reschedule_cutoff_hours'),
  visible.join(', '))

/**
 * 🔒 **הבדיקה שמגנה על העתיד.** key חדש שיתווסף לטבלה חייב להיות פרטי
 * כברירת מחדל. זו בדיוק ההטיה ש-`using(true)` הפך על פיה, ובגללה 15F
 * דלף.
 */
await db.exec(`insert into public.business_settings (key, value)
               values ('some_future_secret', '"סוד"'::jsonb)`)
await db.exec(`set role anon`)
const afterNewKey = (await all(`select key from public.business_settings`)).map(r => r.key)
await db.exec(`reset role`)
chk('🔒 key חדש הוא פרטי כברירת מחדל (fail-closed)',
  !afterNewKey.includes('some_future_secret'), afterNewKey.join(', '))

chk('🔒 ה-policy הישן (using true) אינו קיים יותר', (await all(
  `select 1 from pg_policy where polrelid='public.business_settings'::regclass
   and polname='business_settings_read'`)).length === 0)

// ─── סיכום ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✓' : '✗'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
