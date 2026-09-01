/**
 * הסכמת דיוור מתוך טופס ההזמנה — התיבה השנייה, האופציונלית.
 *
 * ─── מה נבדק כאן ולמה דווקא כאן ─────────────────────────────────────────────
 *
 * ארבעה דברים שטעות בהם היא או שליחת דיוור למי שלא ביקשה, או חסימת קביעת
 * תור בגלל תיבה שאינה חובה:
 *
 *   1. **התיבה אינה יכולה לחסום כלום.** לא ב-validateFinal, לא ב-canSubmit,
 *      לא ב-route. לא מסומנת מראש, בשני טופסי ההזמנה.
 *   2. **לא סומן ⟹ לא נכתב.** שום עמודת consent אינה נוגעת, וההסכמה
 *      הקיימת (או היעדרה) נשארת כפי שהיא.
 *   3. **סומן ⟹ בדיוק שלושת השדות** + ניקוי ההסרה, כ-re-consent מפורש.
 *      נבדק מול DB אמיתי (PGlite) עם כל המיגרציות — כולל ה-CHECKים של 0035.
 *   4. **המסלול התפעולי והדיוור הקיים לא זזו.** תזכורות/OTP/הודעות שירות
 *      אינם קוראים את העמודות האלה, ובדיוור: consent=false אינו חוסם,
 *      opted_out כן חוסם.
 *
 * אפס רשת, אפס SMS, אפס כתיבה לייצור.
 *
 * הרצה:  npm run test:marketing-consent
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

let pass = 0, fail = 0
const chk = (name, ok = true, extra = '') => {
  if (ok) pass++; else fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = p => readFileSync(join(ROOT, p), 'utf8')
const stripComments = s =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const bookingFormSrc = src('components/booking/BookingForm.tsx')
const accountFormSrc = src('components/account/AccountBookingForm.tsx')
const publicRouteSrc = src('app/api/bookings/request/route.ts')
const accountRouteSrc = src('app/api/appointments/route.ts')
const privacyNoticeSrc = src('lib/privacyNotice.ts')
const dbMarketingSrc = src('lib/db/marketing.ts')
const decideSrc = src('lib/marketing/decide.ts')
const crmPageSrc = src('app/admin/(protected)/customers/[customerId]/page.tsx')

const C = await import('../lib/marketing/consent.ts')
const { decideRecipient } = await import('../lib/marketing/decide.ts')

// ════════════════════════════════════════════════════════════════════════════
section('הנוסח — מקור אחד, בדיוק כפי שאושר')
// ════════════════════════════════════════════════════════════════════════════

const LABEL =
  'אני מאשרת לקבל מ-S.M BROWS עדכונים, הטבות ותזכורות לקביעת תורים ב-SMS. ניתן להסיר בכל עת.'
chk('MARKETING_CONSENT_LABEL הוא בדיוק הנוסח שאושר',
  privacyNoticeSrc.includes(`export const MARKETING_CONSENT_LABEL =\n  '${LABEL}'`))
for (const [name, formSrc] of [['BookingForm', bookingFormSrc], ['AccountBookingForm', accountFormSrc]]) {
  chk(`${name}: מרנדר את הקבוע ולא עותק של הנוסח`,
    /\{MARKETING_CONSENT_LABEL\}/.test(formSrc) && !formSrc.includes(LABEL))
}
chk('🔒 נוסח האישור הקיים (PRIVACY_ACK_LABEL) לא שונה',
  /export const PRIVACY_ACK_LABEL = 'קראתי את הודעת הפרטיות ואת מדיניות הפרטיות'/.test(privacyNoticeSrc))

// ════════════════════════════════════════════════════════════════════════════
section('🔒 התיבה אינה חובה — בשום שכבה')
// ════════════════════════════════════════════════════════════════════════════

{
  const code = stripComments(bookingFormSrc)
  chk('BookingForm: marketingConsent מתחיל false ב-EMPTY_FORM',
    /marketingConsent:\s*false,?\n?\}/.test(code) || /marketingConsent: false/.test(code.split('EMPTY_FORM')[1] ?? ''))
  chk('BookingForm: checked={form.marketingConsent} (לא מסומן מראש)',
    /checked=\{form\.marketingConsent\}/.test(code))
  chk('🔒 BookingForm: validateFinal אינה נוגעת ב-marketingConsent',
    !/if \(!f\.marketingConsent\)/.test(code) &&
    !/e\.marketingConsent/.test(code))
  chk('🔒 BookingForm: אין aria-required על תיבת הדיוור',
    !/id="booking-marketing"[\s\S]{0,400}aria-required/.test(code))
  chk('BookingForm: הערך נשלח ל-route', /marketingConsent: f\.marketingConsent/.test(code))
}
{
  const code = stripComments(accountFormSrc)
  chk('AccountBookingForm: useState(false)',
    /const \[marketingConsent, setMarketingConsent\] = useState\(false\)/.test(code))
  chk('🔒 AccountBookingForm: canSubmit אינו דורש marketingConsent',
    !/canSubmit =[\s\S]{0,300}marketingConsent/.test(code))
  chk('🔒 AccountBookingForm: אין aria-required על תיבת הדיוור',
    !/id="account-booking-marketing"[\s\S]{0,400}aria-required/.test(code))
  chk('AccountBookingForm: reset מחזיר את התיבה ל-false',
    /setMarketingConsent\(false\)/.test(code))
  chk('AccountBookingForm: הערך נשלח ל-route', /\n\s+marketingConsent,/.test(code))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 לא סומן ⟹ לא נכתב; סומן ⟹ אחרי שהתור נשמר')
// ════════════════════════════════════════════════════════════════════════════

for (const [name, routeSrc, fn, createFn] of [
  ['bookings/request (ציבורי)', publicRouteSrc, 'recordBookingMarketingConsentByPhone', 'createPublicBookingRequest('],
  ['appointments (אזור אישי)', accountRouteSrc, 'recordBookingMarketingConsent', 'createPersonalAreaBookingRequest('],
]) {
  const code = stripComments(routeSrc)
  chk(`${name}: כותב אך ורק כש-marketingConsent === true`,
    /if \(body\.marketingConsent === true\) \{/.test(code) &&
    (code.match(/body\.marketingConsent/g) ?? []).length === 1)
  chk(`🔒 ${name}: אין ענף שמכבה consent קיים (אין כתיבה בענף false)`,
    !/marketing_consent:\s*false/.test(code))
  const iCreate = code.indexOf(createFn)
  const iConsent = code.indexOf('body.marketingConsent === true')
  chk(`🔒 ${name}: ההסכמה נכתבת אחרי יצירת הבקשה, לא לפניה`,
    iCreate !== -1 && iConsent !== -1 && iCreate < iConsent)
  chk(`🔒 ${name}: כישלון ההסכמה אינו מפיל את הבקשה (try/catch סביב הקריאה)`,
    new RegExp(String.raw`try \{\s*await ${fn}\([\s\S]{0,120}\} catch`).test(code))
  chk(`🔒 ${name}: הלוג של הכשל אינו נושא את אובייקט השגיאה (עלול להכיל טלפון)`,
    !/marketing consent write threw', err\)/.test(code))
  chk(`🔒 ${name}: התשובה ללקוחה אינה מסגירה את מצב ההסכמה`,
    !/marketingConsent[\s\S]{0,60}NextResponse\.json/.test(code.split('body.marketingConsent === true')[1] ?? ''))
}

// ════════════════════════════════════════════════════════════════════════════
section('העדכון עצמו — שלושת השדות, בלי actor, עם ניקוי ההסרה')
// ════════════════════════════════════════════════════════════════════════════

{
  const now = new Date('2026-09-01T10:20:30.000Z')
  const patch = C.buildBookingConsentUpdate(now)
  chk('marketing_consent = true', patch.marketing_consent === true)
  chk('marketing_consent_at = now()', patch.marketing_consent_at === now.toISOString())
  chk("marketing_consent_source = 'booking_form'", patch.marketing_consent_source === 'booking_form')
  chk('🔴 marketing_consent_by = null (ההסכמה של הלקוחה, לא של מנהלת)',
    patch.marketing_consent_by === null)
  chk('🔴 marketing_opted_out_at = null (re-consent מפורש)', patch.marketing_opted_out_at === null)
  chk('אין בעדכון שום שדה נוסף', Object.keys(patch).length === 5)
  chk('🔒 שכבת ה-DB משתמשת בפונקציה הזו ולא בונה עדכון משלה',
    /update\(buildBookingConsentUpdate\(new Date\(\)\)\)/.test(dbMarketingSrc) &&
    !/marketing_consent:\s*true/.test(stripComments(dbMarketingSrc)))
  chk('🔒 שכבת ה-DB אינה כותבת customer_crm_activity על הסכמה עצמית',
    !/customer_crm_activity[\s\S]{0,200}marketing_consent_granted/.test(dbMarketingSrc))
}

// ════════════════════════════════════════════════════════════════════════════
section('סטטוס ה-CRM — שלושה מצבים, וההסרה גוברת')
// ════════════════════════════════════════════════════════════════════════════

{
  const OUT = '2026-08-01T00:00:00.000Z'
  chk("consent=true, לא הוסרה ⟹ 'מאושר'",
    C.marketingConsentStatus({ consent: true, optedOutAt: null }) === 'granted')
  chk("consent=false, לא הוסרה ⟹ 'לא אושר'",
    C.marketingConsentStatus({ consent: false, optedOutAt: null }) === 'none')
  chk("consent=false + הוסרה ⟹ 'הוסרה מדיוור'",
    C.marketingConsentStatus({ consent: false, optedOutAt: OUT }) === 'opted_out')
  chk('🔴 consent=true + הוסרה ⟹ ההסרה גוברת (כמו ב-decideRecipient)',
    C.marketingConsentStatus({ consent: true, optedOutAt: OUT }) === 'opted_out')
  chk('התוויות הן בדיוק מאושר / לא אושר / הוסרה מדיוור',
    C.MARKETING_CONSENT_STATUS_LABELS.granted === 'מאושר' &&
    C.MARKETING_CONSENT_STATUS_LABELS.none === 'לא אושר' &&
    C.MARKETING_CONSENT_STATUS_LABELS.opted_out === 'הוסרה מדיוור')
  chk('מסך הלקוחה מציג את התווית מהקבוע המשותף',
    /MARKETING_CONSENT_STATUS_LABELS\[marketing\.status\]/.test(crmPageSrc))
  chk('🔒 מסך הלקוחה אינו מאפשר לסמן לקוחה כמסכימה (תצוגה בלבד)',
    !/recordBookingMarketingConsent|marketing_consent:/.test(crmPageSrc))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 הדיוור הקיים לא זז: consent=false אינו חוסם, opted_out חוסם')
// ════════════════════════════════════════════════════════════════════════════

{
  const base = {
    optedOutAt: null, archivedAt: null, isBlocked: false,
    normalizedPhone: '+972521111111', currentPhoneHash: 'h', storedPhoneHash: 'h',
  }
  chk('לקוחה בלי הסכמה — נשלחת (PHASE 1 לא השתנה)', decideRecipient({ ...base }).send === true)
  chk('🔴 לקוחה שהסירה את עצמה — נחסמת',
    decideRecipient({ ...base, optedOutAt: '2026-08-01T00:00:00Z' }).skipReason === 'opted_out')
  chk('🔒 decideRecipient אינה מכירה בכלל סיבת דילוג של היעדר הסכמה',
    !/no_consent/.test(decideSrc))
  chk('🔒 רשימת המועמדות עדיין אינה מסננת לפי marketing_consent',
    !/\.eq\('marketing_consent'/.test(dbMarketingSrc) && !/\.is\('marketing_consent'/.test(dbMarketingSrc))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 המסלול התפעולי לא נגוע')
// ════════════════════════════════════════════════════════════════════════════

for (const [name, raw] of [
  ['bookings/request', publicRouteSrc], ['appointments', accountRouteSrc],
  ['lib/db/marketing.ts', dbMarketingSrc],
]) {
  // ⚠️ בלי הערות: ההבטחה "אינו נוגע ב-appointment_reminders" כתובה בראש
  // lib/db/marketing.ts כתיעוד. מה שנבדק כאן הוא הקוד עצמו.
  const code = stripComments(raw)
  chk(`${name}: אינו נוגע ב-appointment_reminders`, !/appointment_reminders/.test(code))
  chk(`${name}: אינו נוגע ב-appointment_notifications`, !/appointment_notifications/.test(code))
}
chk('🔒 מסלול ההזמנה אינו שולח SMS בעקבות ההסכמה',
  !/sendSms|renderMarketingSms|sendCampaignBatch/.test(publicRouteSrc + accountRouteSrc))

// ════════════════════════════════════════════════════════════════════════════
section('מול DB אמיתי (PGlite) — כל המיגרציות, כולל ה-CHECKים של 0035')
// ════════════════════════════════════════════════════════════════════════════

const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

const db = new PGlite({ extensions: { btree_gist } })
await db.waitReady
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, phone text);
  create table auth._session (uid uuid);
  create or replace function auth.uid() returns uuid language sql stable
    security definer set search_path = auth as $$ select uid from auth._session limit 1 $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
`)

const q = async (sql, p = []) => (await db.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const fails = async (sql, p = []) => { try { await db.query(sql, p); return false } catch { return true } }
const uuid = () => crypto.randomUUID()

const ADMIN = uuid()
for (const name of MIGRATIONS) {
  if (name.startsWith('0010')) {
    await db.exec(`
      insert into auth.users values ('${ADMIN}', '972541110002');
      insert into customers (id, phone_e164, full_name) values ('${ADMIN}', '+972541110002', 'שובל');
      insert into admins (user_id) values ('${ADMIN}');`)
  }
  try {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  } catch (e) {
    chk(`${name.slice(0, 4)} רצה ללא שגיאה`, false, e.message)
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו`)

const NEW = uuid(), OPTED = uuid(), UNTOUCHED = uuid()
await db.exec(`insert into customers (id, phone_e164, full_name) values
  ('${NEW}',       '+972521234561', 'לקוחה חדשה'),
  ('${OPTED}',     '+972521234562', 'לקוחה שהוסרה'),
  ('${UNTOUCHED}', '+972521234563', 'לקוחה שלא סימנה');`)

/** אותו עדכון בדיוק שהקוד שולח — נבנה מהפונקציה, לא משוכפל כאן */
const applyConsent = async (customerId, now) => {
  const patch = C.buildBookingConsentUpdate(now)
  const cols = Object.keys(patch)
  const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ')
  await db.query(
    `update customers set ${sets} where id = $${cols.length + 1}`,
    [...Object.values(patch), customerId],
  )
}

// ── סימון ראשון ────────────────────────────────────────────────────────────
await applyConsent(NEW, new Date('2026-09-01T09:00:00.000Z'))
{
  const row = await one(
    `select marketing_consent, marketing_consent_at, marketing_consent_source,
            marketing_consent_by, marketing_opted_out_at from customers where id = $1`, [NEW])
  chk('סימון ⟹ marketing_consent=true', row.marketing_consent === true)
  chk('סימון ⟹ נשמר מועד ההסכמה', row.marketing_consent_at !== null)
  chk("סימון ⟹ המקור הוא 'booking_form' (עובר את ה-CHECK של 0035)",
    row.marketing_consent_source === 'booking_form')
  chk('סימון ⟹ בלי actor מנהלת', row.marketing_consent_by === null)
  chk('סימון ⟹ אינה מסומנת כמוסרת', row.marketing_opted_out_at === null)
}

// ── מה שהיה קורה בלי שלושת השדות יחד ───────────────────────────────────────
chk('🔒 ה-DB דוחה consent=true בלי מועד ומקור (ולכן העדכון חייב לכלול את שלושתם)',
  await fails(
    `update customers set marketing_consent = true, marketing_consent_at = null,
       marketing_consent_source = null where id = $1`, [NEW]))
chk("🔒 ה-DB דוחה מקור שאינו ברשימה", await fails(
  `update customers set marketing_consent = true, marketing_consent_at = now(),
     marketing_consent_source = 'sms_form' where id = $1`, [NEW]))

// ── re-consent אחרי הסרה ───────────────────────────────────────────────────
await db.query(
  `update customers set marketing_consent = true, marketing_consent_at = now(),
     marketing_consent_source = 'admin_recorded', marketing_consent_by = $2,
     marketing_opt_out_token_hash = repeat('a', 64), marketing_opt_out_token_version = 1,
     marketing_opted_out_at = timestamptz '2026-08-20 12:00:00+03' where id = $1`, [OPTED, ADMIN])
{
  const before = await one('select * from customers where id = $1', [OPTED])
  chk('לפני: הלקוחה מסומנת כמוסרת מדיוור', before.marketing_opted_out_at !== null)

  await applyConsent(OPTED, new Date('2026-09-01T09:30:00.000Z'))
  const after = await one('select * from customers where id = $1', [OPTED])
  chk('🔴 סימון מחדש ⟹ marketing_opted_out_at נוקה (re-consent מפורש)',
    after.marketing_opted_out_at === null)
  chk('סימון מחדש ⟹ ההסכמה החדשה נשמרה', after.marketing_consent === true)
  chk("סימון מחדש ⟹ המקור מתעדכן ל-'booking_form'",
    after.marketing_consent_source === 'booking_form')
  chk('סימון מחדש ⟹ מועד ההסכמה מתעדכן',
    new Date(after.marketing_consent_at).getTime() > new Date(before.marketing_consent_at).getTime())
  chk('🔴 סימון מחדש ⟹ ה-actor הישן של המנהלת נמחק (ההסכמה היא של הלקוחה)',
    after.marketing_consent_by === null)
  chk('סימון מחדש ⟹ token ההסרה נשאר תקף (אפשר להסיר שוב מיד)',
    after.marketing_opt_out_token_hash === before.marketing_opt_out_token_hash)
}

// ── לא סומן ⟹ שום דבר לא נגע ───────────────────────────────────────────────
{
  const row = await one(
    `select marketing_consent, marketing_consent_at, marketing_consent_source,
            marketing_opted_out_at from customers where id = $1`, [UNTOUCHED])
  chk('🔒 לקוחה שלא סימנה — נשארה בדיוק כפי שהייתה (false, בלי מועד ובלי מקור)',
    row.marketing_consent === false && row.marketing_consent_at === null &&
    row.marketing_consent_source === null && row.marketing_opted_out_at === null)
}

// ── הדיוור עצמו לא רואה הסכמה כשער ─────────────────────────────────────────
{
  const eligible = await q(
    `select id from customers where marketing_consent and marketing_opted_out_at is null`)
  chk('רק מי שסימנה בפועל נספרת כמסכימה', eligible.length === 2)
}

await db.close()

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} עברו, ${fail} נכשלו`)
process.exit(fail === 0 ? 0 : 1)
