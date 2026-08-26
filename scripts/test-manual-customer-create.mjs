/**
 * 15K — יצירת לקוחה ידנית: ה-RPC האמיתי, המתרגם האמיתי, וחוזה ה-route.
 *
 * ─── התקלה שהבדיקות האלה נועדו למנוע מלחזור ─────────────────────────────────
 *
 * create_manual_customer מחזירה `jsonb_build_object('customer_id', …)` —
 * snake_case, כמו כל RPC במיגרציות. lib/db/manualCustomers.ts הכריז על
 * `customerId` וגישר על הפער ב-`as unknown as`, כלומר ביקש מ-TypeScript
 * לא להסתכל. `customerId` היה `undefined` בכל יצירה **מוצלחת**:
 *
 *   • ה-DB כתב את הלקוחה ו-commit.
 *   • ה-route החזיר 200 עם גוף שבו השדה נעלם (JSON.stringify משמיט
 *     undefined).
 *   • CustomerPicker בדק `!data.customerId` והציג "יצירת הלקוחה נכשלה".
 *
 * הצלחה שהוצגה ככישלון, על לקוחה שכבר יושבת ב-CRM.
 *
 * ─── למה אף בדיקה קיימת לא תפסה את זה ──────────────────────────────────────
 *
 * בדיקות ה-DB קוראות ל-RPC ישירות וקוראות `j.customer_id` — ולכן עברו.
 * בדיקות הליבה לא נגעו ב-DB. הפער היה בדיוק **בתפר** ביניהן, ולכן כאן
 * ה-jsonb האמיתי של ה-RPC עובר דרך readCreateResult האמיתית.
 *
 * PGlite בזיכרון. אפס כתיבות לייצור, אפס רשת, אפס SMS.
 *
 * הרצה:  npm run test:manual-customer-create
 */

import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

let pass = 0, fail = 0
const chk = (name, ok = true, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = p => readFileSync(join(ROOT, p), 'utf8')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

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
  do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
`)

const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const uuid = () => crypto.randomUUID()
const ADMIN_ID = uuid()

section('הרצת כל המיגרציות')
for (const name of MIGRATIONS) {
  if (name.startsWith('0010')) {
    await db.exec(`
      insert into auth.users values ('${ADMIN_ID}', '972541110002');
      insert into customers (id, phone_e164, full_name)
        values ('${ADMIN_ID}', '+972541110002', 'שובל');
      insert into admins (user_id) values ('${ADMIN_ID}');
    `)
  }
  try {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
  } catch (e) {
    chk(`${name.slice(0, 4)} רצה ללא שגיאה`, false, e.message)
    process.exit(1)
  }
}
chk(`כל ${MIGRATIONS.length} המיגרציות רצו ללא שגיאה`)

// ⚠️ הפונקציות האמיתיות של האפליקציה — לא העתקים.
const { normalizePhone } = await import('../lib/phone.ts')
const { readCreateResult, createManualCustomer } = await import('../lib/db/manualCustomers.ts')

/**
 * ה-RPC מוזרק אל **הפונקציה האמיתית** של האפליקציה, ומופנה ל-PGlite.
 * כך createManualCustomer עצמה רצה כאן — לא העתק שלה — ולכן החזרת
 * ה-cast הישן מפילה את הבדיקות ולא רק את בדיקת המקור.
 */
const pgliteRpc = async args => {
  try {
    const r = await one(
      `select public.create_manual_customer($1,$2,$3,$4,$5,$6,$7) j`,
      [args.p_full_name, args.p_phone_e164, args.p_source_key, args.p_crm_status,
       args.p_admin_id, args.p_client_request_id, args.p_payload_fingerprint],
    )
    return { data: r.j, error: null }
  } catch (e) {
    return { data: null, error: { message: e.message } }
  }
}

/**
 * המסלול המלא של השרת, בלי HTTP: נירמול טלפון → fingerprint → ה-RPC
 * האמיתי → readCreateResult האמיתית → גוף התשובה שה-route מחזיר.
 *
 * ⚠️ `body` נבנה דרך JSON.parse(JSON.stringify(...)) בכוונה: זה בדיוק מה
 * ש-NextResponse.json עושה, וזה מה שהעלים את השדה undefined מהתשובה.
 */
async function createCustomerViaServer(rawName, rawPhone, requestId = uuid()) {
  // ── מה שה-route עושה לפני שהוא קורא ל-lib ──
  const fullName = String(rawName).trim().replace(/\s+/g, ' ')
  if (fullName.length < 2 || fullName.length > 80) {
    return { httpStatus: 400, body: { error: 'invalid_name' } }
  }
  const phoneE164 = normalizePhone(rawPhone)
  if (!phoneE164) return { httpStatus: 400, body: { error: 'invalid_phone' } }

  // ── ומכאן הפונקציה האמיתית, מילה במילה ──
  let rpcJson = null
  const res = await createManualCustomer(
    {
      fullName, phoneE164, sourceKey: 'whatsapp', crmStatus: 'active',
      adminUserId: ADMIN_ID, clientRequestId: requestId,
    },
    async args => { const r = await pgliteRpc(args); rpcJson = r.data; return r },
  )

  if (!res.ok) {
    const status = res.error === 'idempotency_key_reused' ? 409
      : res.error === 'unknown' || res.error === 'integrity_error' ? 500 : 400
    return { httpStatus: status, body: { error: res.error } }
  }
  if (res.data.result === 'admin_phone_exists') {
    return { httpStatus: 409, body: { result: 'phone_taken' } }
  }
  const { customerId } = res.data
  if (!customerId) return { httpStatus: 500, body: { error: 'integrity_error' } }

  return {
    httpStatus: 200,
    rpcJson,
    body: JSON.parse(JSON.stringify({
      result: res.data.result,
      customerId,
      created: res.data.result === 'customer_created',
      replayed: res.data.replayed,
    })),
  }
}

const countCustomers = async phone =>
  Number((await one(`select count(*)::int n from customers where phone_e164 = $1`, [phone])).n)

// ════════════════════════════════════════════════════════════════════════════
section('1 · לקוחה חדשה → נוצרת פעם אחת → הצלחה')
// ════════════════════════════════════════════════════════════════════════════

const R1 = await createCustomerViaServer('  דנה   לוי ', '052-123-4567')

chk('HTTP 200', R1.httpStatus === 200, `status=${R1.httpStatus}`)
chk('result = customer_created', R1.body.result === 'customer_created')
chk('created = true', R1.body.created === true)
// 🔴 השורה שנפלה קודם: השדה נעלם מהגוף אחרי JSON.stringify.
chk('customerId קיים בגוף התשובה', 'customerId' in R1.body, JSON.stringify(R1.body))
chk('ואינו undefined', R1.body.customerId != null)
chk('והוא UUID תקין',
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(R1.body.customerId ?? ''))
chk('נוצרה בדיוק לקוחה אחת', await countCustomers('+972521234567') === 1)

// 🔒 המקור עצמו: ה-RPC מחזיר snake_case, והתשובה camelCase.
chk('ה-RPC מחזיר customer_id (snake_case)', 'customer_id' in R1.rpcJson)
chk('והמתרגם הפך אותו ל-customerId', R1.body.customerId === R1.rpcJson.customer_id)

// הלקוחה אכן ב-CRM, עם פרופיל — לא שורה חלקית.
const crm = await one(
  `select c.full_name, c.auth_user_id, p.crm_status, p.source_key
     from customers c join customer_crm_profiles p on p.customer_id = c.id
    where c.id = $1`, [R1.body.customerId])
chk('הלקוחה נמצאת ב-CRM עם פרופיל', Boolean(crm))
chk('השם נשמר מנורמל', crm.full_name === 'דנה לוי', crm.full_name)
chk('בלי חשבון התחברות', crm.auth_user_id === null)
chk('עם המקור והסטטוס שנבחרו', crm.crm_status === 'active' && crm.source_key === 'whatsapp')

// ════════════════════════════════════════════════════════════════════════════
section('2 · המזהה שחוזר הוא זה שהטופס בוחר')
// ════════════════════════════════════════════════════════════════════════════

{
  // הבורר טוען את הלקוחה מהשרת לפי הטלפון ומאתר אותה לפי המזהה שחזר.
  const rows = await q(`select * from public.list_crm_customers($1,'all',null,'last_activity',null,null,10,0)`,
    ['052-123-4567'])
  const items = rows[0].list_crm_customers.items ?? []
  const found = items.find(c => c.id === R1.body.customerId)
  chk('החיפוש לפי הטלפון שהוקלד מוצא את הלקוחה', Boolean(found))
  chk('ולפי אותו מזהה שחזר מהיצירה', found?.id === R1.body.customerId)
  chk('עם השם השמור', found?.full_name === 'דנה לוי')
  chk('הבורר בוחר לפי data.customerId',
    src('components/admin/CustomerPicker.tsx').includes('c.id === data.customerId'))
}

// ════════════════════════════════════════════════════════════════════════════
section('3 · 05XXXXXXXX ו-+972 הם אותה לקוחה')
// ════════════════════════════════════════════════════════════════════════════

{
  chk('נירמול: 052-123-4567 → +972521234567', normalizePhone('052-123-4567') === '+972521234567')
  chk('נירמול: +972-52-123-4567 → אותו מספר', normalizePhone('+972-52-123-4567') === '+972521234567')
  chk('נירמול: 0521234567 → אותו מספר', normalizePhone('0521234567') === '+972521234567')

  const intl = await createCustomerViaServer('דנה לוי', '+972521234567')
  chk('הפורמט הבינלאומי חוזר כהצלחה', intl.httpStatus === 200)
  chk('ומזוהה כלקוחה קיימת', intl.body.result === 'existing_customer')
  chk('created = false', intl.body.created === false)
  chk('🔒 אותו customerId בדיוק', intl.body.customerId === R1.body.customerId)
  chk('ולא נוצרה שורה שנייה', await countCustomers('+972521234567') === 1)

  const noZero = await createCustomerViaServer('שם אחר לגמרי', '972521234567')
  chk('גם בלי + ובלי 0 — אותה לקוחה', noZero.body.customerId === R1.body.customerId)
  chk('⚠️ והשם הקיים לא נדרס',
    (await one(`select full_name from customers where id = $1`, [R1.body.customerId])).full_name === 'דנה לוי')
  chk('עדיין לקוחה אחת בלבד', await countCustomers('+972521234567') === 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('4 · ניסיון חוזר אינו יוצר כפילות')
// ════════════════════════════════════════════════════════════════════════════

{
  // retry אמיתי: **אותו** client_request_id, כמו שהטופס שולח אחרי כשל.
  const rid = uuid()
  const first  = await createCustomerViaServer('נועה כהן', '053-987-6543', rid)
  const second = await createCustomerViaServer('נועה כהן', '053-987-6543', rid)

  chk('הניסיון הראשון הצליח', first.httpStatus === 200 && first.body.created === true)
  chk('הניסיון החוזר הצליח גם הוא', second.httpStatus === 200)
  chk('🔒 עם אותו customerId', second.body.customerId === first.body.customerId)
  chk('ומסומן replayed', second.body.replayed === true)
  chk('הראשון לא סומן replayed', first.body.replayed === false)
  chk('נוצרה לקוחה אחת בלבד', await countCustomers('+972539876543') === 1)
  chk('ורשומת אודיט אחת בלבד', Number((await one(
    `select count(*)::int n from customer_crm_activity
      where customer_id = $1 and action = 'customer_created'`, [first.body.customerId])).n) === 1)

  // מפתח שנשלח שוב עם נתונים אחרים אינו "הצלחה" ואינו נוגע בלקוחה.
  const reused = await createCustomerViaServer('מישהי אחרת', '054-111-2222', rid)
  chk('אותו מפתח עם payload שונה נדחה', reused.httpStatus !== 200)
  chk('ולא נוצרה לקוחה מהמספר השני', await countCustomers('+972541112222') === 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('5 · לקוחה קיימת → נבחרת בהצלחה, לא שגיאה')
// ════════════════════════════════════════════════════════════════════════════

{
  const again = await createCustomerViaServer('דנה לוי', '052-123-4567')
  chk('HTTP 200 — לא 409 ולא 500', again.httpStatus === 200, `status=${again.httpStatus}`)
  chk('הזרימה רואה בזה הצלחה', again.body.result === 'existing_customer')
  chk('עם מזהה לבחירה', Boolean(again.body.customerId))
  chk('created=false מפעיל את ההודעה "כבר קיימת"',
    again.body.created === false &&
    src('components/admin/CustomerPicker.tsx').includes('setExistingNotice(data.created === false)'))
}

// ════════════════════════════════════════════════════════════════════════════
section('6 · אפשר להמשיך מיד ליצירת תור')
// ════════════════════════════════════════════════════════════════════════════

{
  // getBookingCustomer עוברת דרך get_crm_customer — אותה דלת שטופס התור
  // משתמש בה. לקוחה ידנית טרייה חייבת לעבור בה.
  const got = (await one(`select public.get_crm_customer($1) j`, [R1.body.customerId])).j
  chk('הלקוחה שנוצרה נטענת לטופס התור', got?.id === R1.body.customerId)
  chk('בלי חשבון התחברות', got?.has_login_account === false)

  // ה-RPC של התור מקבל אותה כלקוחה תקפה (auth_user_id = NULL).
  const appt = (await one(
    `select public.create_manual_appointment(
       $1,'ייעוץ מיקרובליידינג','{}'::text[],null,now() + interval '3 days',30,'v1',$2,$3,$4) j`,
    [R1.body.customerId, ADMIN_ID, uuid(), 'b'.repeat(64)])).j
  chk('נוצר תור ידני ללקוחה שזה עתה נוצרה', appt?.result === 'appointment_created')
  chk('התור מקושר אליה', (await one(
    `select customer_id from appointments where id = $1`, [appt.appointment_id])).customer_id
    === R1.body.customerId)

  // הקישור בין המסכים עובר באותו מזהה.
  chk('מסך "לקוחה חדשה" מקשר ליצירת תור עם המזהה',
    src('components/admin/NewCustomerForm.tsx')
      .includes('/admin/appointments/new?customerId=${result.customerId}'))
}

// ════════════════════════════════════════════════════════════════════════════
section('7 · שגיאה אמיתית עדיין מוצגת כשגיאה')
// ════════════════════════════════════════════════════════════════════════════

{
  chk('טלפון לא תקין נדחה', (await createCustomerViaServer('דנה לוי', '123')).httpStatus === 400)
  chk('שם קצר מדי נדחה', (await createCustomerViaServer('א', '055-000-1111')).httpStatus !== 200)
  chk('ולא נוצרה לקוחה', await countCustomers('+972550001111') === 0)

  // ⚠️ שורה שאי אפשר לקרוא אינה "הצלחה חלקית" — היא integrity_error.
  chk('שורה בלי customer_id → integrity_error',
    readCreateResult({ result: 'customer_created', customer_id: null, replayed: false }).error
      === 'integrity_error')
  chk('שורה עם result לא מוכר → integrity_error',
    readCreateResult({ result: 'משהו אחר', customer_id: uuid(), replayed: false }).error
      === 'integrity_error')
  chk('null → integrity_error', readCreateResult(null).error === 'integrity_error')
  // חשבון מנהל הוא היחיד שמותר לו לחזור בלי מזהה.
  chk('admin_phone_exists מותר בלי מזהה', (() => {
    const r = readCreateResult({ result: 'admin_phone_exists', customer_id: null, replayed: false })
    return r.ok && r.data.customerId === null
  })())

  // 🔒 והתרגום נעשה בקריאת שדות, לא ב-cast שמשתיק את TypeScript.
  // ⚠️ ההערות מסולקות לפני הבדיקה: התיעוד **מצטט** את ה-cast שירד, וציטוט
  // בהערה אינו קוד. הבדיקה היא על מה שרץ.
  const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const lib = stripComments(src('lib/db/manualCustomers.ts'))
  chk('אין יותר as unknown as בקוד של manualCustomers', !lib.includes('as unknown as'))
  chk('customer_id נקרא בשמו', lib.includes('row.customer_id'))
  chk('ה-route אינו מחזיר 200 בלי מזהה',
    src('app/api/admin/customers/route.ts').includes('if (!customerId) {'))
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} עברו, ${fail} נכשלו`)
process.exit(fail === 0 ? 0 : 1)
