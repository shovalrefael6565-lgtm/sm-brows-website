/**
 * שלב 13 — `NEW_BOOKING_SYSTEM_ENABLED=false` הוא kill-switch אמיתי.
 *
 * ═══ מה נבדק כאן, ולמה זו בדיקה נפרדת ═══
 *
 * עד שלב 13 הדגל גידר את `/admin` ואת `/api/admin/*` בלבד. `/login`,
 * `/account`, `/api/auth/otp/send`, `/api/auth/otp/verify` ו-`/api/auth/session`
 * המשיכו לעבוד — כלומר deployment "כבוי" עדיין חשף אזור אישי, יצר sessions,
 * ו**שלח SMS בתשלום דרך 019**.
 *
 * ⚠️ הבדיקה החשובה כאן היא שהשער נמצא **לפני** כל תופעת לוואי: לפני קריאת
 * גוף הבקשה, לפני המסד ולפני הספק. שער שממוקם אחרי `issueOtp` היה מחזיר
 * 403 תקין ועדיין מוציא כסף.
 *
 * הרצה:  npm run test:feature-flag-killswitch
 *
 * ⚠️ tsx + --conditions=react-server (מקובע ב-package.json).
 */

process.env.OTP_PEPPER ??= 'test-pepper'
process.env.SESSION_SECRET ??= 'x'.repeat(48)

import { readFileSync } from 'fs'

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}`)
}

const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
/** מסיר הערות, כדי שאזכור בתיעוד לא ייחשב לקוד. */
const stripComments = s =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const savedFlag = process.env.NEW_BOOKING_SYSTEM_ENABLED

/** בקשה מזויפת. ⚠️ `json()` זורק — אם הוא נקרא, השער ממוקם מאוחר מדי. */
const reqThatFailsIfRead = () => ({
  headers: { get: () => null },
  json: async () => { throw new Error('BODY_WAS_READ') },
  nextUrl: { searchParams: { get: () => null } },
})

// ════════════════════════════════════════════════════════════════════════════
section('הדגל עצמו')

const { isNewBookingSystemEnabled, areRemindersEnabled } =
  await import('../lib/featureFlags.ts')

delete process.env.NEW_BOOKING_SYSTEM_ENABLED
chk('לא מוגדר → כבוי', isNewBookingSystemEnabled() === false)
process.env.NEW_BOOKING_SYSTEM_ENABLED = 'false'
chk('"false" → כבוי', isNewBookingSystemEnabled() === false)
process.env.NEW_BOOKING_SYSTEM_ENABLED = 'TRUE'
chk('⚠️ "TRUE" → כבוי (השוואה תלוית רישיות, אין הדלקה בטעות)',
  isNewBookingSystemEnabled() === false)
process.env.NEW_BOOKING_SYSTEM_ENABLED = '1'
chk('⚠️ "1" → כבוי', isNewBookingSystemEnabled() === false)
process.env.NEW_BOOKING_SYSTEM_ENABLED = 'true'
chk('"true" → דלוק', isNewBookingSystemEnabled() === true)

// ════════════════════════════════════════════════════════════════════════════
section('POST /api/auth/otp/send — 403 בלי SMS ובלי מסד')

const { POST: otpSend } = await import('../app/api/auth/otp/send/route.ts')

process.env.NEW_BOOKING_SYSTEM_ENABLED = 'false'
{
  const res = await otpSend(reqThatFailsIfRead())
  chk('🔒 הדגל כבוי → 403', res.status === 403)
  const body = await res.json()
  chk('הנוסח feature_disabled, עקבי עם requireAdminApi',
    body.error === 'feature_disabled')
  chk('🔒 ⚠️ גוף הבקשה כלל לא נקרא — השער לפני כל תופעת לוואי', true)
}

delete process.env.NEW_BOOKING_SYSTEM_ENABLED
{
  const res = await otpSend(reqThatFailsIfRead())
  chk('הדגל לא מוגדר → 403 (ברירת המחדל היא כבוי)', res.status === 403)
}

// ════════════════════════════════════════════════════════════════════════════
section('POST /api/bookings/request — המסלול הציבורי (15B)')
//
// ⚠️ זהו ה-endpoint היחיד שאינו מאומת ושכותב ל-DB. כשהדגל כבוי הוא חייב
// לחזור להתנהגות legacy מוחלטת: אפס כתיבות, אפס קריאות ל-Supabase, ואפילו
// בלי לקרוא את גוף הבקשה.
//
// ⚠️ **ה-route אינו ניתן לייבוא בהרנס הזה**, בדיוק כמו otp/verify ו-session
// למטה: הוא מייבא את lib/shabbat.ts שמושך את @hebcal/core, שאין לו export
// לתנאי react-server. זו מגבלת סביבה ולא פגם בקוד — ולכן החוזה שלו נבדק
// כאן על **המקור**, ולא בהרצה.
//
// ⚠️ אין להפוך את זה ל"נבדק בהרצה" בהצהרה. הבדיקות למטה הן טקסטואליות.
// האכיפה בפועל של המסלול נבדקת מול Postgres ב-test-public-booking-db.mjs.

{
  const code = stripComments(src('app/api/bookings/request/route.ts'))

  chk('bookings/request — מחזיר 403 feature_disabled',
    /feature_disabled/.test(code) && /status:\s*403/.test(code))

  // השער חייב להיות לפני ה-await הראשון בקובץ — כלומר לפני קריאת הגוף,
  // לפני Google ולפני כל נגיעה ב-Supabase.
  const gateAt = code.search(/isNewBookingSystemEnabled\(\)/)
  const firstAwait = code.search(/\bawait\b/)
  chk('🔒 השער לפני ה-await הראשון בקובץ',
    gateAt !== -1 && firstAwait !== -1 && gateAt < firstAwait,
    `gate@${gateAt} await@${firstAwait}`)

  // 🔒 השער גם לפני חילוץ ה-IP ולפני קריאת הגוף
  // ⚠️ שלב 3: req.json() הוחלף ב-readJsonWithLimit (מגבלת גודל לפני parse) —
  // אותה נקודת קריאה בדיוק, תבנית חדשה.
  const ipAt = code.search(/resolveClientIp\(/)
  const jsonAt = code.search(/readJsonWithLimit\s*[<(]/)
  chk('🔒 השער לפני חילוץ ה-IP ולפני קריאת גוף הבקשה',
    gateAt < ipAt && gateAt < jsonAt, `gate@${gateAt} ip@${ipAt} json@${jsonAt}`)

  // 🔒 fail-closed על IP — ההגנה המרכזית של מסלול לא מאומת
  chk('🔒 ה-route נכשל סגור כשאין IP מהימן',
    /if\s*\(!ipResult\.ok\)/.test(code) && /ip_unavailable/.test(code))

  // 🔒 אין silent failure: הצלחה מוחזרת בדיוק במקום אחד
  chk('🔒 saved: true מוחזר רק פעם אחת — אחרי יצירה מוצלחת',
    (code.match(/saved:\s*true/g) ?? []).length === 1)

  // ⚠️ המסלול הציבורי אינו נוגע ב-OTP, ב-session או באזור האישי
  chk('🔒 ה-route אינו נוגע ב-OTP או ב-session',
    !/getCurrentCustomerId|issueOtp|verifyOtp|createSession/.test(code))
}

// ════════════════════════════════════════════════════════════════════════════
section('POST /api/appointments — האזור האישי (9E.1)')
//
// 🔴 עד 9E.1 הנתיב הזה **לא נבדק כאן כלל**, למרות שהוא המסלול השני שכותב
// תור ל-DB ושקורא לאותו RPC שחתימתו משתנה ב-0031. חלון התחזוקה נשען על
// כך ששני המסלולים חסומים — בדיקה של אחד מהם בלבד אינה מוכיחה זאת.
//
// ⚠️ גם כאן הבדיקה טקסטואלית על המקור: ה-route מייבא את lib/shabbat.ts
// (@hebcal/core) שאין לו export לתנאי react-server. אותה מגבלת סביבה
// בדיוק כמו bookings/request למעלה.

{
  const code = stripComments(src('app/api/appointments/route.ts'))

  chk('appointments — מחזיר 403 feature_disabled',
    /feature_disabled/.test(code) && /status:\s*403/.test(code))

  const gateAt = code.search(/isNewBookingSystemEnabled\(\)/)
  const firstAwait = code.search(/\bawait\b/)
  chk('🔒 השער לפני ה-await הראשון בקובץ',
    gateAt !== -1 && firstAwait !== -1 && gateAt < firstAwait,
    `gate@${gateAt} await@${firstAwait}`)

  // 🔒 השער לפני זיהוי הלקוחה, לפני קריאת הגוף, ולפני כל נגיעה ב-DB.
  // ⚠️ ה-route הזה קורא `await req.json()` ישירות (ולא readJsonWithLimit
  // כמו המסלול הציבורי) — הוא מאומת-session, ולכן אינו חשוף לגוף ענק
  // אנונימי. הבדיקה מכוונת לנקודת הקריאה שקיימת בפועל, לא לזו שהיינו
  // מצפים לה, כדי שלא "תעבור" על regex שאינו מתאים לכלום.
  for (const [re, label] of [
    [/await\s+req\.json\s*\(/, 'קריאת גוף הבקשה'],
    [/getCurrentCustomerId\s*\(/, 'זיהוי הלקוחה מה-session'],
    [/createPersonalAreaBookingRequest\s*\(/, 'כתיבת התור ל-DB'],
  ]) {
    const at = code.search(re)
    chk(`🔒 השער לפני ${label}`, at !== -1 && gateAt < at, `gate@${gateAt} effect@${at}`)
  }

  // 🔒 השער לפני ה-RPC שחתימתו משתנה ב-0031 — זה מה שמאפשר לפרוס את
  // הקוד החדש מול schema ישן בלי 500.
  chk('🔒 ה-route אינו קורא ל-RPC ישירות (רק דרך lib/db/appointments.ts)',
    !/\.rpc\(/.test(code))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 9E.1 — הטפסים מציגים fallback ל-WhatsApp כשהשער סגור')
//
// שער שמחזיר 403 נכון אך משאיר את הלקוחה בלי דרך פעולה הוא כשל מוצר.
// שני הטפסים חייבים להציג מסלול חלופי מפורש.

{
  const code = stripComments(src('components/booking/BookingForm.tsx'))
  // ה-route מחזיר whatsappFallback: true על 403 (fallback: true ב-fail()).
  chk('BookingForm — קורא את whatsappFallback מהתשובה',
    /whatsappFallback/.test(code))
  chk('BookingForm — מציג קישור WhatsApp כשה-fallback דלוק',
    /saveError\.fallback/.test(code) && /WHATSAPP_BASE/.test(code))
  chk('🔒 BookingForm — אומר במפורש שהבקשה לא נשמרה (לא "אולי")',
    /לא נשמרה/.test(src('components/booking/BookingForm.tsx')))
}

{
  const code = stripComments(src('components/account/AccountBookingForm.tsx'))
  chk('AccountBookingForm — feature_disabled מפעיל את מסלול ה-WhatsApp',
    /feature_disabled/.test(code) && /setShowWhatsApp/.test(code))
  chk('AccountBookingForm — קישור WhatsApp קיים', /WHATSAPP_BASE/.test(code))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 9E.1 — הדגל fail-closed: רק המחרוזת המדויקת "true" פותחת')
//
// ⚠️ נבדק על **המקור** של lib/featureFlags.ts ולא רק התנהגותית, כדי
// שהשוואה רופפת (== , toLowerCase, Boolean(), !== 'false') לא תיכנס בעתיד
// בלי שהבדיקה תיפול. `!== 'false'` היה הופך ערך שגוי/ריק ל"פתוח" — בדיוק
// ההפך מ-fail-closed.

{
  const code = stripComments(src('lib/featureFlags.ts'))
  chk('🔒 isNewBookingSystemEnabled משתמש בהשוואה קשיחה ל-\'true\'',
    /process\.env\.NEW_BOOKING_SYSTEM_ENABLED\s*===\s*'true'/.test(code))
  chk('🔒 אין השוואה מתירנית (!== \'false\' / toLowerCase / Boolean)',
    !/NEW_BOOKING_SYSTEM_ENABLED\s*!==\s*'false'/.test(code) &&
    !/NEW_BOOKING_SYSTEM_ENABLED[^\n]*toLowerCase/.test(code) &&
    !/Boolean\(\s*process\.env\.NEW_BOOKING_SYSTEM_ENABLED/.test(code))
}

for (const [value, label] of [
  ['', 'מחרוזת ריקה'],
  [' true', 'רווח מוביל'],
  ['true ', 'רווח נגרר'],
  ['True', 'רישיות שונה'],
  ['yes', 'ערך לא תקין'],
  ['0', 'אפס'],
]) {
  process.env.NEW_BOOKING_SYSTEM_ENABLED = value
  chk(`🔒 ${JSON.stringify(value)} (${label}) → כבוי`, isNewBookingSystemEnabled() === false)
}
if (savedFlag === undefined) delete process.env.NEW_BOOKING_SYSTEM_ENABLED
else process.env.NEW_BOOKING_SYSTEM_ENABLED = savedFlag

// ════════════════════════════════════════════════════════════════════════════
section('verify ו-session — בדיקה מבנית')
//
// ⚠️ שני ה-routes האלה **אינם ניתנים לייבוא בהרנס הזה**: הם מגיעים דרך
// lib/auth/session.ts ל-`next/headers`, שמושך את entry ה-server של React
// ונופל מחוץ ל-Next.js ("not yet supported outside of experimental
// channels"). זו מגבלת סביבה, לא פגם בקוד — ולכן החוזה שלהם נבדק על המקור
// בסעיף הבא, ולא בהרצה. ⚠️ אין להפוך את זה ל"נבדק" בהצהרה: הבדיקה היחידה
// שקיימת עליהם היא בדיקת סדר טקסטואלית.

for (const path of ['app/api/auth/otp/verify/route.ts', 'app/api/auth/session/route.ts']) {
  const code = stripComments(src(path))
  chk(`${path.replace('app/api/', '')} — מחזיר 403 feature_disabled`,
    /feature_disabled/.test(code) && /status:\s*403/.test(code))
  // השער חייב להיות לפני ה-await הראשון בקובץ
  const gateAt = code.search(/isNewBookingSystemEnabled\(\)/)
  const firstAwait = code.search(/\bawait\b/)
  chk(`${path.replace('app/api/', '')} — השער לפני ה-await הראשון`,
    gateAt !== -1 && firstAwait !== -1 && gateAt < firstAwait,
    `gate@${gateAt} await@${firstAwait}`)
}

// ════════════════════════════════════════════════════════════════════════════
section('GET /api/bookings/slots')

const { GET: slotsGet } = await import('../app/api/bookings/slots/route.ts')

const slotsReq = date => ({
  nextUrl: { searchParams: { get: k => (k === 'date' ? date : null) } },
})

process.env.NEW_BOOKING_SYSTEM_ENABLED = 'false'
{
  const res = await slotsGet(slotsReq(null))
  chk('בלי date → 400', res.status === 400)
}
{
  const code = stripComments(src('app/api/bookings/slots/route.ts'))
  chk('🔒 ה-route אינו קורא ל-getDbBusyRangesForDate ישירות — רק מעביר הפניה',
    !/getDbBusyRangesForDate\s*\(/.test(code))
  chk('🔒 תשובת 503 אינה מכילה שדה busy',
    /availability_unavailable/.test(code) &&
    !/busy:\s*\[\][^}]*503|503[^}]*busy:\s*\[\]/.test(code))
  chk('⚠️ תשובת כישלון אינה נשמרת במטמון',
    code.indexOf('cache.set') < code.indexOf('availability_unavailable'))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 השער ממוקם לפני תופעות הלוואי — בדיקת מקור')

const flagGate = /isNewBookingSystemEnabled\(\)/

for (const [path, sideEffect, label] of [
  ['app/api/auth/otp/send/route.ts', /await\s+issueOtp\(/, 'issueOtp'],
  ['app/api/auth/otp/send/route.ts', /await\s+sendSms\(/, 'sendSms'],
  ['app/api/auth/otp/send/route.ts', /readJsonWithLimit\s*[<(]/, 'readJsonWithLimit'],
  ['app/api/auth/otp/verify/route.ts', /await\s+verifyOtp\(/, 'verifyOtp'],
  ['app/api/auth/otp/verify/route.ts', /await\s+createSession\(/, 'createSession'],
  ['app/api/auth/session/route.ts', /await\s+getCurrentCustomerId\(/, 'getCurrentCustomerId'],
]) {
  const code = stripComments(src(path))
  const gateAt = code.search(flagGate)
  const effectAt = code.search(sideEffect)
  chk(`${path.replace('app/api/', '')} — השער לפני ${label}`,
    gateAt !== -1 && effectAt !== -1 && gateAt < effectAt,
    `gate@${gateAt} effect@${effectAt}`)
}

for (const path of ['app/login/page.tsx', 'app/account/page.tsx']) {
  const code = stripComments(src(path))
  chk(`${path.replace('app/', '')} — מגודר בדגל`, flagGate.test(code))
  chk(`${path.replace('app/', '')} — מחזיר notFound() ולא הודעת שגיאה`,
    /notFound\(\)/.test(code))
}

{
  // ⚠️ שער אחרי הכתיבה למסד היה מחזיר 403 תקין ועדיין מוציא כסף.
  const code = stripComments(src('app/api/auth/otp/send/route.ts'))
  const gateAt = code.search(flagGate)
  const firstEffect = Math.min(
    ...[/readJsonWithLimit\s*[<(]/, /await\s+issueOtp\(/, /await\s+sendSms\(/]
      .map(re => code.search(re)).filter(i => i !== -1),
  )
  chk('🔒 ⚠️ ב-otp/send השער קודם ל**כל** תופעת לוואי, לא רק לאחת',
    gateAt !== -1 && gateAt < firstEffect)
}

// ════════════════════════════════════════════════════════════════════════════
section('מה נשאר פתוח בכוונה')

{
  const code = stripComments(src('app/api/auth/logout/route.ts'))
  chk('⚠️ logout נשאר פתוח — מסלול יציאה נקי גם כשהמערכת כבויה',
    !flagGate.test(code))
}

{
  // /admin כבר מגודר מקודם — הבדיקה כאן היא שלא נשבר
  const code = stripComments(src('lib/auth/adminGuard.ts'))
  chk('adminGuard עדיין מגודר בדגל (ללא שינוי)', flagGate.test(code))
  chk('requireAdminPage עדיין notFound()', /notFound\(\)/.test(code))
}

// ════════════════════════════════════════════════════════════════════════════
section('תזכורות — שער כפול, ללא שינוי')

process.env.NEW_BOOKING_SYSTEM_ENABLED = 'true'
process.env.REMINDERS_ENABLED = 'false'
chk('REMINDERS_ENABLED=false → כבוי', areRemindersEnabled() === false)
{
  const code = stripComments(src('lib/reminders/dispatch.ts'))
  chk('🔒 dispatch דורש את שני הדגלים',
    /areRemindersEnabled\(\)\s*&&\s*isNewBookingSystemEnabled\(\)/.test(code))
}

// ════════════════════════════════════════════════════════════════════════════
// שחזור הסביבה כדי לא להשפיע על סוויטות אחרות באותה הרצה
if (savedFlag === undefined) delete process.env.NEW_BOOKING_SYSTEM_ENABLED
else process.env.NEW_BOOKING_SYSTEM_ENABLED = savedFlag

const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
