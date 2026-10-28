/**
 * ההרשמה לעדכון על השקת מוצר — הלוגיקה והחוזים, בלי DB ובלי רשת.
 *
 * מכסה:
 *   1. lib/products.ts — רשימת ההיתר: slug, מצב המוצר, גוון, מקור.
 *   2. normalizePhone על הקלט שהטופס שולח בפועל.
 *   3. ה-route: סדר ההגנות, ו-🔒 מה שאסור שיהיה בו (שבת, יצירת לקוחה,
 *      דיוור, SMS, יומן).
 *   4. כל מסלול יציאה מה-route מחזיר JSON — גם כשל.
 *   5. הדיאלוג: טלפון בלבד, alreadyRegistered כהצלחה, fail-closed.
 *   6. הפרטיות: נקודת איסוף חדשה, גרסה, ועקביות בין הדיאלוג לעמוד.
 *   7. ה-slug הסופי, ואין שאריות TODO בתוכן המוצר.
 *
 * הרצה:  npm run test:product-interest-core
 */

import { readFileSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(68)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
/** מסיר הערות, כדי ש"אסור שיופיע X" לא ייפול על הערה שמסבירה למה אין X. */
const stripComments = s =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const routeSrc = stripComments(src('app/api/product-interest/route.ts'))
const dbSrc = stripComments(src('lib/db/productInterest.ts'))
const dialogSrc = stripComments(src('components/shop/ProductNotifyDialog.tsx'))
const migrationSrc = src('supabase/migrations/0038_product_interest.sql')
const privacyNoticeSrc = src('lib/privacyNotice.ts')
const privacyContentSrc = src('components/privacy/PrivacyContent.tsx')
const dataSrc = src('lib/data.ts')

const { findProductBySlug, isOpenForInterest, resolveShade, isValidSource } =
  await import('../lib/products.ts')
const { normalizePhone } = await import('../lib/phone.ts')

// ─────────────────────────────────────────────────────────────────────────────
section('1 — lib/products.ts: רשימת ההיתר')

const product = findProductBySlug('micro-brow-pen')
chk('המוצר נמצא לפי ה-slug', Boolean(product))
chk('slug שאינו קיים מחזיר null', findProductBySlug('nope') === null)
chk('slug ריק מחזיר null', findProductBySlug('') === null)
chk('🔒 slug ישן (coming-soon-product) כבר אינו קיים',
  findProductBySlug('coming-soon-product') === null)
chk('המוצר פתוח להרשמה (coming_soon)', isOpenForInterest(product))

const available = { ...product, status: 'available' }
chk('🔒 מוצר available אינו פתוח להרשמה', isOpenForInterest(available) === false)
chk('🔒 מוצר בלי status אינו פתוח להרשמה',
  isOpenForInterest({ ...product, status: undefined }) === false)

section('1b — גוון')
chk('null → אין גוון', resolveShade(product, null).ok && resolveShade(product, null).shade === null)
chk('undefined → אין גוון', resolveShade(product, undefined).shade === null)
chk("'' → אין גוון", resolveShade(product, '').shade === null)
chk('🔒 גוון שאינו ברשימה נדחה', resolveShade(product, 'shade-1').ok === false)
chk('🔒 גוון שאינו מחרוזת נדחה', resolveShade(product, 42).ok === false)
chk('🔒 גוון על מוצר ללא גוונים נדחה (אינו מתעלם בשקט)',
  resolveShade(product, 'anything').ok === false)

const withShades = { ...product, shades: [{ id: 'sand', name: 'חול' }] }
chk('גוון חוקי של המוצר מתקבל', resolveShade(withShades, 'sand').shade === 'sand')
chk('גוון של מוצר אחר נדחה', resolveShade(withShades, 'other').ok === false)

section('1c — מקור')
chk("'product_page' תקין", isValidSource('product_page'))
chk('🔒 מקור חופשי נדחה', isValidSource('whatever') === false)
chk('🔒 מקור שאינו מחרוזת נדחה', isValidSource(null) === false)

// ─────────────────────────────────────────────────────────────────────────────
section('2 — normalizePhone על הקלט של הטופס')

for (const [input, expected] of [
  ['0501112233', '+972501112233'],
  ['050-111-2233', '+972501112233'],
  ['050 111 2233', '+972501112233'],
  ['+972501112233', '+972501112233'],
  ['972501112233', '+972501112233'],
  ['00972501112233', '+972501112233'],
]) {
  chk(`${input.padEnd(16)} → ${expected}`, normalizePhone(input) === expected)
}
for (const bad of ['', '12345', '03-1234567', '+14155550123', 'לא מספר', '05011122334']) {
  chk(`🔒 נדחה: ${JSON.stringify(bad)}`, normalizePhone(bad) === null)
}

// ─────────────────────────────────────────────────────────────────────────────
section('3 — ה-route: מה יש בו')

chk('קורא ל-resolveClientIp', /resolveClientIp\(req\.headers\)/.test(routeSrc))
chk('fail-closed על IP שאינו מהימן', /ipResult\.ok/.test(routeSrc))
chk('מגביל את גודל הגוף', /readJsonWithLimit/.test(routeSrc) && /DEFAULT_MAX_JSON_BYTES/.test(routeSrc))
chk('מאמת את ה-slug מול הקטלוג בשרת', /findProductBySlug/.test(routeSrc))
chk('דורש שהמוצר יהיה פתוח להרשמה', /isOpenForInterest/.test(routeSrc))
chk('מנרמל את הטלפון', /normalizePhone\(/.test(routeSrc))
chk('בודק את גרסת הודעת הפרטיות מול הקבוע',
  /privacyNoticeVersion !== PRIVACY_NOTICE_VERSION/.test(routeSrc))
chk('דורש privacyNoticeAcknowledged === true',
  /privacyNoticeAcknowledged !== true/.test(routeSrc))
chk('מאמת גוון מול המוצר', /resolveShade\(/.test(routeSrc))
chk('מאמת את המקור', /isValidSource\(/.test(routeSrc))
chk('מעביר ip ל-DB למגבלת קצב', /ip: ipResult\.ip/.test(routeSrc))
chk('POST בלבד — אין GET/PUT/DELETE/PATCH מיוצאים',
  !/export async function (GET|PUT|DELETE|PATCH)/.test(routeSrc))

section('3b — 🔒 מה שאסור שיהיה ב-route')
const forbidden = [
  ['isShabbat', /isShabbat/],
  ['link_or_create_customer_by_phone', /link_or_create_customer/],
  ['marketing_consent', /marketing_consent/],
  ['marketing_opted_out_at', /marketing_opted_out/],
  ['dispatchNow', /dispatchNow/],
  ['שליחת SMS', /sendSms|smsProvider|sms019/i],
  ['Google Calendar', /googleCalendar|calendar_change_queue/i],
  ['לוגיקת תורים', /appointments|createBooking|resolveAvailability/],
]
for (const [label, re] of forbidden) {
  chk(`🔒 אין ${label}`, !re.test(routeSrc))
}
chk('🔒 אין יצירת לקוחה גם בשכבת ה-DB', !/link_or_create_customer/.test(dbSrc))
chk('🔒 שכבת ה-DB אינה רושמת טלפון ללוג',
  !/console\.(error|log|warn)\([^)]*(phone|Phone)/.test(dbSrc))
chk('🔒 שכבת ה-DB אינה רושמת את error.message ללוג',
  !/console\.error\([^)]*error\.message/.test(dbSrc))

// ─────────────────────────────────────────────────────────────────────────────
section('4 — כל מסלול יציאה מחזיר JSON')

const returns = routeSrc.match(/return\s+(?:fail\(|NextResponse\.json\()/g) ?? []
const bareReturns = routeSrc.match(/return\s+new\s+Response\(/g) ?? []
chk(`כל ה-returns הם fail()/NextResponse.json (${returns.length})`, returns.length >= 8)
chk('🔒 אין Response גולמי בלי JSON', bareReturns.length === 0)
chk('fail() תמיד נושא error + message + saved:false',
  /whatsappFallback: fallback, saved: false/.test(routeSrc))
chk('הצלחה מחזירה saved:true ו-alreadyRegistered',
  /saved: true, alreadyRegistered/.test(routeSrc))

// ─────────────────────────────────────────────────────────────────────────────
section('5 — הדיאלוג')

chk('🔒 אין שדה שם', !/fullName/.test(dialogSrc))
chk('משתמש ב-normalizePhone', /normalizePhone\(/.test(dialogSrc))
chk('שולח את הטלפון המנורמל', /phone: normalizedPhone/.test(dialogSrc))
chk('alreadyRegistered מוביל למסך הצלחה', /data\.alreadyRegistered \? 'already'/.test(dialogSrc))
chk('🔒 הצלחה רק כשהשרת אמר saved', /res\.ok && data\?\.saved/.test(dialogSrc))
chk('🔒 כשל שאינו JSON מפעיל נפילה לוואטסאפ', /data \? Boolean\(data\.whatsappFallback\) : true/.test(dialogSrc))
chk('שולח privacyNoticeVersion', /privacyNoticeVersion: PRIVACY_NOTICE_VERSION/.test(dialogSrc))
chk('שולח source', /source,/.test(dialogSrc))
chk('נוסח ההצלחה: "את ברשימה 🤎"', /את ברשימה 🤎/.test(dialogSrc))
chk('נוסח הכפילות: "את כבר ברשימה 🤎"', /את כבר ברשימה 🤎/.test(dialogSrc))

// ─────────────────────────────────────────────────────────────────────────────
section('6 — פרטיות')

chk('קיימת הודעת איסוף ייעודית', /PRODUCT_INTEREST_PRIVACY_NOTICE/.test(privacyNoticeSrc))
chk('הדיאלוג מציג אותה', /PRODUCT_INTEREST_PRIVACY_NOTICE/.test(dialogSrc))
/*
 * 🔴 ההודעה חייבת לתאר את הטופס **כפי שהוא בפועל**.
 *
 * הגרסה הקודמת הצהירה "שם ומספר טלפון הם שדות חובה" והזכירה בחירת גוון,
 * בזמן ששדה השם הוסר ולמוצר אין גוונים — הצהרה שגויה בנקודת האיסוף,
 * שגם סתרה את עמוד הפרטיות. הבדיקות הקודמות פספסו כי הן בדקו מה ההודעה
 * **כן** אומרת ולא אם היא תואמת לשדות שנאספים.
 *
 * ⚠️ הבדיקה נעשית על המחרוזת המורכבת ולא על קוד המקור: הקבוע נבנה
 * משרשור, וחיפוש על המקור היה נחתך בגבולות השורות.
 */
const noticeText = (() => {
  const block = privacyNoticeSrc.match(
    /export const PRODUCT_INTEREST_PRIVACY_NOTICE =([\s\S]*?)\n\n/)
  return [...block[1].matchAll(/'([^']*)'/g)].map(m => m[1]).join('')
})()

/**
 * ⚠️ גבול מילה ולא substring. `'להירשם'.includes('שם')` הוא **true** —
 * המילה מסתיימת ב-ש+ם — ובדיקה נאיבית הייתה נכשלת על נוסח תקין לחלוטין.
 * Hebrew letters: א-ת.
 */
const hasWord = w =>
  new RegExp(`(^|[^\\u05D0-\\u05EA])${w}([^\\u05D0-\\u05EA]|$)`).test(noticeText)

chk('🔴 ההודעה אינה מזכירה "שם" (אין שדה שם בטופס)', hasWord('שם') === false)
chk('🔴 ההודעה אינה מזכירה "גוון" (אין בורר גוונים)', !/גוון/.test(noticeText))
chk('ההודעה מציינת "מספר הטלפון"', noticeText.includes('מספר הטלפון'))
chk('ההודעה מצהירה "הודעה אחת"', noticeText.includes('הודעה אחת'))
chk('ההודעה מבהירה שאינה הסכמה לדיוור שיווקי',
  noticeText.includes('אינה הסכמה לדיוור שיווקי'))
chk('🔒 עקביות עם עמוד הפרטיות: שם המסמך השני אומר "ללא שם"',
  /ללא שם/.test(privacyContentSrc))
chk('🔒 כל עוגן קישור מופיע פעם אחת (splitNoticeLinks תלוי בזה)',
  (noticeText.match(/עמוד יצירת הקשר/g) ?? []).length === 1
  && (noticeText.match(/מדיניות הפרטיות/g) ?? []).length === 1)
chk('🔒 ההודעה אינה מזכירה מייל', !/מייל|דואר אלקטרוני/.test(noticeText))
chk('ההודעה מצהירה שאינה הסכמה לדיוור',
  /אינה הסכמה לדיוור/.test(privacyNoticeSrc))
chk('ההודעה מפרטת את מקבלי המידע',
  /Vercel/.test(privacyNoticeSrc) && /Supabase/.test(privacyNoticeSrc) && /019/.test(privacyNoticeSrc))
// (הבדיקה על מייל נעשית למעלה על המחרוזת המורכבת — מדויקת יותר מחיתוך מקור.)
chk('עמוד הפרטיות מתאר את המטרה החדשה',
  /הרשמה לעדכון על השקת מוצר/.test(privacyContentSrc))
chk('עמוד הפרטיות מציין "הודעה חד-פעמית"', /הודעה חד-פעמית/.test(privacyContentSrc))
chk('עמוד הפרטיות מציין שאינה הסכמה לדיוור שיווקי',
  /אינה הסכמה לדיוור שיווקי/.test(privacyContentSrc))
chk('עמוד הפרטיות מציין שלא נוצר כרטיס לקוחה',
  /לא נוצר עבורך כרטיס לקוחה/.test(privacyContentSrc))
chk('הגרסה עלתה מעבר ל-1.2', /PRIVACY_NOTICE_VERSION = '1\.[3-9]/.test(privacyNoticeSrc))
chk('עמוד הפרטיות קורא את הגרסה מהקבוע',
  /\{PRIVACY_NOTICE_VERSION\}/.test(privacyContentSrc))

// ─────────────────────────────────────────────────────────────────────────────
section('7 — המיגרציה, ה-slug והתוכן')

chk('0038 מגדירה טבלה משלה', /create table if not exists public\.product_interest_requests/.test(migrationSrc))
chk('🔒 הטלפון נשמר על השורה עם אותו CHECK כמו customers',
  /phone_e164\s+text not null check \(phone_e164 ~ '\^\\\+9725\[0-9\]\{8\}\$'\)/.test(migrationSrc))
chk('🔒 customer_id הוא nullable', /customer_id\s+uuid references public\.customers\(id\)/.test(migrationSrc))
chk('מניעת כפילות על (phone, slug) כשהסטטוס open',
  /product_interest_open_unique[\s\S]*?\(phone_e164, product_slug\)[\s\S]*?where status = 'open'/.test(migrationSrc))
chk('status מוגבל ל-open/notified/closed',
  /check \(status in \('open', 'notified', 'closed'\)\)/.test(migrationSrc))
chk('🔒 RLS מופעל', /alter table public\.product_interest_requests enable row level security/.test(migrationSrc))
chk('🔒 revoke ל-anon/authenticated',
  /revoke all on public\.product_interest_requests from anon, authenticated/.test(migrationSrc))
/*
  ⚠️ לא "אין אזכור": השם מופיע ב-`comment on table` שמסביר **למה** המונה
  נפרד, וזה תיעוד שצריך להישאר. מה שנבדק הוא שאין שאילתה בפועל מול
  הטבלה ההיא — insert/select/delete/update.
*/
chk('🔒 אינה קוראת או כותבת ל-booking_rate_events',
  !/(insert\s+into|from|delete\s+from|update)\s+public\.booking_rate_events/i
    .test(migrationSrc))
chk('מונה קצב נפרד', /product_interest_rate_events/.test(migrationSrc))

chk("ה-slug הוא 'micro-brow-pen'", /slug: 'micro-brow-pen'/.test(dataSrc))
chk('🔒 אין יותר הפניה ל-slug הישן בקוד', !/'coming-soon-product'/.test(dataSrc))
const productBlock = dataSrc.slice(dataSrc.indexOf("id: 'p9'"))
chk('🔒 אין שאריות TODO בתוכן המוצר', !/TODO/.test(productBlock))

// ─────────────────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
