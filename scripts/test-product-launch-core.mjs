/**
 * מסך הניהול של ההתעניינות במוצרים ומנגנון הודעת ההשקה — החוזים, בלי DB
 * ובלי רשת ובלי SMS אמיתי.
 *
 * מכסה:
 *   1. הנוסח והקישור נגזרים בשרת בלבד.
 *   2. שני הברזים: דגל השליחה + ספק. אף אחד מהם לבדו אינו מספיק.
 *   3. 🔒 אין arbitrary body / url / recipients מה-client.
 *   4. 🔴 'notified' אינו ניתן לסימון ידני — בשלוש שכבות.
 *   5. אבטחת ה-admin: requireAdminApi + isSameOrigin, ואין GET שמחזיר PII.
 *   6. 🔒 אין נגיעה במערכת הקמפיינים ובעמודות הדיוור.
 *   7. אין PII בלוגים.
 *   8. דגל ההרשמה לבדו אינו פותח שליחה.
 *
 * הרצה:  npm run test:product-launch-core
 */

import { readFileSync } from 'fs'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(68)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const stripComments = s =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const adminDbSrc = stripComments(src('lib/db/productInterestAdmin.ts'))
const launchRouteSrc = stripComments(src('app/api/admin/product-interest/launch/route.ts'))
const statusRouteSrc = stripComments(src('app/api/admin/product-interest/route.ts'))
const pageSrc = stripComments(src('app/admin/(protected)/product-interest/page.tsx'))
const buttonSrc = stripComments(src('components/admin/LaunchNotificationButton.tsx'))
const selectSrc = stripComments(src('components/admin/ProductInterestStatusSelect.tsx'))
const migrationSrc = src('supabase/migrations/0039_product_interest_admin.sql')
const navSrc = src('components/admin/AdminNav.tsx')
const envExample = src('.env.example')

const { buildLaunchMessage, launchIdempotencyKey, LAUNCH_SMS_MAX_LENGTH } =
  await import('../lib/productLaunch/template.ts')
const { resolveProductLaunchProvider } = await import('../lib/productLaunch/provider.ts')
const { findProductBySlug } = await import('../lib/products.ts')
const { SITE_URL } = await import('../lib/utils.ts')

// ─────────────────────────────────────────────────────────────────────────────
section('1 — הנוסח והקישור נגזרים בשרת')

const product = findProductBySlug('micro-brow-pen')
const msg = buildLaunchMessage(product)
chk('נבנתה הודעה', Boolean(msg))
chk('הקישור נגזר מ-SITE_URL ומה-slug',
  msg.productUrl === `${SITE_URL}/shop/micro-brow-pen`)
chk('הקישור מופיע בגוף ההודעה', msg.body.includes(msg.productUrl))
chk('ההודעה מזכירה את שם המוצר', msg.body.includes('Micro Brow Pen'))
chk('ההודעה מזכירה שהלקוחה ביקשה עדכון', msg.body.includes('ביקשת שנעדכן'))
chk(`ההודעה בתוך מגבלת האורך (${msg.body.length} ≤ ${LAUNCH_SMS_MAX_LENGTH})`,
  msg.body.length <= LAUNCH_SMS_MAX_LENGTH)
chk('מוצר בלי slug אינו מקבל הודעה',
  buildLaunchMessage({ ...product, slug: undefined }) === null)

section('1b — 🔒 מה שאסור שיהיה בנוסח')
for (const [label, re] of [
  ['מבצע/הנחה', /מבצע|הנחה|%/],
  ['קוד קופון', /קופון|coupon|קוד/i],
  ['מוצרים נוספים', /עוד מוצרים|מוצרים נוספים/],
  ['הצטרפות לדיוור', /דיוור|להצטרף לרשימה|עדכונים שוטפים/],
]) {
  chk(`🔒 אין ${label} בנוסח`, !re.test(msg.body))
}

section('1c — idempotency key')
chk('המפתח נגזר ממזהה השורה', launchIdempotencyKey('abc-123').includes('abc-123'))
chk('יציב בין קריאות', launchIdempotencyKey('x') === launchIdempotencyKey('x'))
chk('🔒 אינו מכיל חותמת זמן', !/\d{13}/.test(launchIdempotencyKey('x')))

// ─────────────────────────────────────────────────────────────────────────────
section('2 — שני הברזים')

chk('ברירת המחדל של הספק היא disabled',
  resolveProductLaunchProvider({}).name === 'disabled')
chk('ספק לא מוכר נופל ל-disabled',
  resolveProductLaunchProvider({ PRODUCT_LAUNCH_SMS_PROVIDER: 'nonsense' }).name === 'disabled')
chk('🔒 simulated חסום בפרודקשן',
  resolveProductLaunchProvider({
    PRODUCT_LAUNCH_SMS_PROVIDER: 'simulated', NODE_ENV: 'production',
  }).name === 'disabled')
chk('simulated מותר מחוץ לפרודקשן',
  resolveProductLaunchProvider({
    PRODUCT_LAUNCH_SMS_PROVIDER: 'simulated', NODE_ENV: 'development',
  }).name === 'simulated')
chk('🔒 sms_019 בלי credentials נופל ל-disabled',
  resolveProductLaunchProvider({ PRODUCT_LAUNCH_SMS_PROVIDER: 'sms_019' }).name === 'disabled')
chk('🔒 ספק disabled אינו isLive',
  resolveProductLaunchProvider({}).isLive === false)

chk('🔒 נפרד מ-REMINDER_PROVIDER',
  resolveProductLaunchProvider({ REMINDER_PROVIDER: 'sms_019' }).name === 'disabled')
chk('🔒 נפרד מ-MARKETING_SMS_PROVIDER',
  resolveProductLaunchProvider({ MARKETING_SMS_PROVIDER: 'sms_019' }).name === 'disabled')
chk('🔒 נפרד מ-NOTIFICATION_PROVIDER',
  resolveProductLaunchProvider({ NOTIFICATION_PROVIDER: 'sms_019' }).name === 'disabled')

section('2b — הדגל נבדק בנפרד מהספק')
chk('previewLaunch בודק את דגל השליחה',
  /areProductLaunchNotificationsEnabled\(\)/.test(adminDbSrc))
chk('previewLaunch בודק גם את הספק', /provider\.isLive/.test(adminDbSrc))
chk('🔒 חסימה כשהדגל כבוי', /blockedReason = 'notifications_disabled'/.test(adminDbSrc))
chk('🔒 חסימה כשהספק כבוי', /blockedReason = 'provider_disabled'/.test(adminDbSrc))
chk('🔒 sendLaunchBatch יוצא מוקדם אם אי אפשר לשלוח',
  /if \(!preview\.canSend\) return/.test(adminDbSrc))
chk('🔒 PRODUCT_INTEREST_ENABLED לבדו אינו מוזכר כמתיר שליחה',
  !/isProductInterestEnabled/.test(adminDbSrc))
chk('שני הדגלים מתועדים ב-.env.example',
  /PRODUCT_INTEREST_NOTIFICATIONS_ENABLED=false/.test(envExample)
  && /PRODUCT_LAUNCH_SMS_PROVIDER=disabled/.test(envExample))

// ─────────────────────────────────────────────────────────────────────────────
section('3 — 🔒 אין קלט חופשי מה-client')

for (const [label, re] of [
  ['body', /body\.(body|text|message|smsBody)/],
  ['url', /body\.(url|productUrl|link)/],
  ['recipients', /body\.(recipients|phones|to|numbers)/],
]) {
  chk(`🔒 ה-route אינו קורא ${label} מהגוף`, !re.test(launchRouteSrc))
}
chk('🔒 ה-route מקבל productSlug בלבד ומאמת מול הקטלוג',
  /findProductBySlug\(slug\)/.test(launchRouteSrc))
chk('🔒 הנוסח נבנה ב-lib ולא ב-route',
  !/היי 🤎/.test(launchRouteSrc) && !/היי 🤎/.test(buttonSrc))
chk('🔒 הנמענות נשלפות לפי status=open בשרת',
  /\.eq\('status', 'open'\)/.test(adminDbSrc))
chk('🔒 הקומפוננטה אינה שולחת גוף הודעה', !/body:\s*preview\.body/.test(buttonSrc))
chk('שליחה דורשת confirm מפורש', /body\.confirm !== true/.test(launchRouteSrc))
chk('הקומפוננטה שולחת confirm רק בפעולת send',
  /action === 'send'[\s\S]{0,120}confirm: true/.test(buttonSrc))

// ─────────────────────────────────────────────────────────────────────────────
section("4 — 🔴 'notified' אינו ידני")

chk('המיגרציה דוחה אותו', /NOTIFIED_IS_NOT_MANUAL/.test(migrationSrc))
chk('הסימון מותנה ב-open', /status = 'open'\s*--/.test(migrationSrc)
  || /and status = 'open'/.test(migrationSrc))
chk('ה-route מקבל open/closed בלבד',
  /body\.status !== 'open' && body\.status !== 'closed'/.test(statusRouteSrc))
chk('ה-route מסביר למה notified חסום', /לא ניתן לסמן "עודכנה" ידנית/.test(statusRouteSrc))
chk('שכבת ה-DB מקבלת טיפוס מצומצם',
  /status: 'open' \| 'closed'/.test(adminDbSrc))
chk('🔒 הבורר במסך אינו מציע notified',
  !/value: 'notified'/.test(selectSrc))
chk('שורה notified מוצגת כתווית ולא כבורר',
  /status === 'notified'/.test(selectSrc))
chk('רק מנגנון השליחה קורא ל-mark_product_interest_notified',
  /mark_product_interest_notified/.test(adminDbSrc)
  && !/mark_product_interest_notified/.test(statusRouteSrc))

// ─────────────────────────────────────────────────────────────────────────────
section('5 — אבטחת admin')

for (const [label, s] of [['status', statusRouteSrc], ['launch', launchRouteSrc]]) {
  chk(`${label}: requireAdminApi`, /requireAdminApi\(\)/.test(s))
  chk(`${label}: בודק את תוצאת ה-guard לפני הכל`, /if \(!guard\.ok\) return guard\.response/.test(s))
  chk(`${label}: isSameOrigin`, /isSameOrigin\(req\)/.test(s))
  chk(`🔒 ${label}: אין GET מיוצא`, !/export async function GET/.test(s))
}
chk('🔒 אין endpoint שמחזיר את רשימת הטלפונים',
  !/phone_e164/.test(statusRouteSrc) && !/phone_e164/.test(launchRouteSrc))
chk('הרשימה נקראת ברינדור השרת של העמוד המוגן',
  /listProductInterest/.test(pageSrc))
chk('המסך בניווט הניהול', /\/admin\/product-interest/.test(navSrc))
chk('🔒 חיפוש הטלפון עובר normalizePhone', /normalizePhone\(sp\.phone\)/.test(pageSrc))
chk('🔒 חיפוש טלפון הוא התאמה מדויקת ולא like',
  /\.eq\('phone_e164', filters\.phone\)/.test(adminDbSrc) && !/ilike/.test(adminDbSrc))

// ─────────────────────────────────────────────────────────────────────────────
section('6 — 🔒 אין נגיעה בדיוור ובקמפיינים')

for (const [label, s] of [
  ['שכבת ה-DB', adminDbSrc], ['route השליחה', launchRouteSrc],
  ['route הסטטוס', statusRouteSrc], ['המסך', pageSrc],
]) {
  for (const [what, re] of [
    ['sms_campaigns', /sms_campaigns/],
    ['marketing_consent', /marketing_consent/],
    ['marketing_opted_out', /marketing_opted_out/],
    ['lib/db/marketing', /db\/marketing/],
    ['resolveMarketingProvider', /resolveMarketingProvider/],
  ]) {
    chk(`🔒 ${label}: אין ${what}`, !re.test(s))
  }
}
chk('🔒 המיגרציה מאמתת שאין נגיעה בדיוור', /sms_campaigns/.test(migrationSrc))

// ─────────────────────────────────────────────────────────────────────────────
section('7 — 🔒 אין PII בלוגים')

const logLines = adminDbSrc.match(/console\.(error|log|warn)\([^\n]*/g) ?? []
chk(`נמצאו ${logLines.length} קריאות לוג`, logLines.length > 0)
chk('🔒 אף לוג אינו מכיל טלפון',
  !logLines.some(l => /phone|to:|phone_e164/i.test(l)))
chk('🔒 אף לוג אינו מכיל גוף הודעה',
  !logLines.some(l => /body/i.test(l)))
chk('🔒 אף לוג אינו מדפיס error.message גולמי',
  !logLines.some(l => /error\.message/.test(l)))
chk('לוג הכשל מדפיס errorCode מנורמל בלבד',
  /console\.error\('\[product-interest-admin\] send failed', result\.errorCode\)/.test(adminDbSrc))

// ─────────────────────────────────────────────────────────────────────────────
section('8 — טיפול בכישלון ובמנות')

/*
 * ⚠️ הכשל הוודאי יוצא ב-`continue` **לפני** הקריאה ל-mark: הבדיקה היא
 * שהענף הזה קיים ושהוא מגדיל את failed, ולא שהוא סמוך טקסטואלית ל-mark.
 */
chk('כשל ודאי מגדיל failed ואינו ממשיך לסימון',
  /permanent_error'\)\s*\{[\s\S]{0,400}?summary\.failed \+= 1\s*\n\s*continue/.test(adminDbSrc))
chk('delivery_unknown נחשב התקבל (כדי לא לשלוח פעמיים)',
  /result\.outcome === 'delivery_unknown'/.test(adminDbSrc))
chk('שליחה סדרתית ולא במקביל',
  /for \(const row of rows\)/.test(adminDbSrc) && !/Promise\.all\(rows/.test(adminDbSrc))
chk('מנה מוגבלת בגודל', /LAUNCH_BATCH_SIZE/.test(adminDbSrc) && /limit\(LAUNCH_BATCH_SIZE\)/.test(adminDbSrc))
chk('הסיכום כולל successful/failed/skippedAlreadyNotified',
  /successful/.test(adminDbSrc) && /failed/.test(adminDbSrc) && /skippedAlreadyNotified/.test(adminDbSrc))
chk('הסיכום כולל markFailed (נשלח אך לא סומן)', /markFailed/.test(adminDbSrc))
chk('הסיכום כולל remaining להמשך ריצה', /remaining/.test(adminDbSrc))
chk('🔒 סימון שנכשל אינו נספר ככישלון (כדי לא לשלוח שוב)',
  /summary\.markFailed \+= 1/.test(adminDbSrc))

// ─────────────────────────────────────────────────────────────────────────────
section('9 — 🔴 נעילת הריצה: סדר הפעולות')

/*
 * ההגנה היא הסדר, ולא הפעולות. נבדק על המקור: `begin_product_launch_run`
 * חייב להופיע **לפני** שליפת הנמענות ולפני הקריאה לספק.
 */
const beginIdx = adminDbSrc.indexOf('begin_product_launch_run')
const selectIdx = adminDbSrc.indexOf("from('product_interest_requests')\n      .select('id, phone_e164")
const sendIdx = adminDbSrc.indexOf('provider.send(')
const finishIdx = adminDbSrc.indexOf('finish_product_launch_run')

chk('begin_product_launch_run קיים', beginIdx > -1)
chk('🔴 begin מופיע לפני שליפת הנמענות', beginIdx > -1 && selectIdx > -1 && beginIdx < selectIdx)
chk('🔴 begin מופיע לפני הקריאה לספק', beginIdx > -1 && sendIdx > -1 && beginIdx < sendIdx)
chk('finish מופיע אחרי השליחה', finishIdx > sendIdx)
chk('🔒 כישלון בפתיחה מחזיר מיד, לפני כל שליחה',
  /runBlocked: 'already_running'[\s\S]{0,40}\}\s*$/m.test(adminDbSrc)
  || /return \{ \.\.\.empty, runBlocked: 'already_running' \}/.test(adminDbSrc))
chk('🔒 needs_review גם הוא חוסם בפתיחה',
  /runBlocked: 'needs_review'/.test(adminDbSrc))
chk('הריצה נסגרת ב-finally (גם אם נזרקה חריגה)', /\} finally \{/.test(adminDbSrc))
chk('🔒 הקוד אינו מבקש סטטוס סיום — ה-RPC מחליט',
  !/p_status: 'completed'/.test(adminDbSrc) && !/p_status: 'needs_review'/.test(adminDbSrc))
chk('delivery_unknown נספר בנפרד', /summary\.deliveryUnknown \+= 1/.test(adminDbSrc))
chk('🔒 כשל ודאי אינו מסמן notified',
  /retryable_error' \|\| result\.outcome === 'permanent_error'/.test(adminDbSrc))
chk('מזהה המנהלת מגיע מה-guard ולא מהגוף',
  /sendLaunchBatch\(product\.slug, guard\.userId\)/.test(launchRouteSrc))
chk('🔒 חסימת ריצה מחזירה 409', /status: 409/.test(launchRouteSrc))
chk('ה-UI מסביר שלא נשלחה אף הודעה', /לא נשלחה אף הודעה/.test(buttonSrc))
chk('ה-UI מציג "כבר מתבצעת שליחת השקה"', /כבר מתבצעת שליחת השקה/.test(launchRouteSrc))
/*
 * ⚠️ נבדקת **פעולה**, לא מילה: טקסט האזהרה עצמו אומר "אין לשחרר אותה
 * בלי לבדוק", וחיפוש המילה היה נופל על ההסבר שמונע את הפעולה.
 */
chk('🔒 אין קריאת API שמשחררת/מבטלת ריצה',
  !/action:\s*'(release|cancel|force|unlock|reset)'/i.test(buttonSrc)
  && !/cancel_product_launch_run|release_product_launch/i.test(buttonSrc + pageSrc + adminDbSrc))
chk('🔒 ה-route אינו מכיר פעולת שחרור',
  !/'(release|cancel|unlock|force)'/i.test(launchRouteSrc))
/*
 * 'cancelled' קיים בסכמה ובטיפוס (שמשקף אותה), אבל אסור שיהיה **כתיבה**
 * אליו: שחרור חסימה בלי בדיקה הוא בדיוק resend עיוור. הבדיקה מבחינה בין
 * הגדרת טיפוס לבין קוד שמציב את הערך.
 */
chk("🔒 'cancelled' מוגדר בסכמה", /'cancelled'/.test(migrationSrc))
chk("🔒 אין קוד שכותב 'cancelled'",
  !/status\s*[:=]\s*'cancelled'/.test(adminDbSrc + launchRouteSrc + buttonSrc))
chk("🔒 ה-route אינו מזכיר cancelled כלל", !/cancelled/.test(launchRouteSrc))
chk('המסך מציג ריצה חוסמת', /runBlocking/.test(pageSrc))
chk('המסך מציג את גיל הריצה', /started_at/.test(pageSrc))

// ─────────────────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
