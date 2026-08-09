/**
 * שלב 15D — בדיקות ללוגיקה ולחוזים של קביעת תור מהאזור האישי.
 *
 * מכסה: אותה תפוגה כמו במסלול הציבורי, חלון ההכנה של 40 דק', חישוב מחיר
 * ומשך בשרת, שימוש חוזר באלגוריתם הזמינות המשותף, גידור בדגל, וההפרדה
 * בין המסלול המאומת למסלול הציבורי.
 *
 * הבדיקות מול Postgres נמצאות ב-scripts/test-personal-area-db.mjs.
 *
 * הרצה:  npm run test:personal-area-booking
 *
 * ⚠️ חייב לרוץ תחת tsx עם --conditions=react-server (מקובע ב-package.json) —
 * ראה ההסבר בראש scripts/test-account-core.mjs.
 */

import { readFileSync } from 'fs'

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(64)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`)
}

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
/** קוד בלי הערות — הערות מסבירות דברים ולכן מכילות מילות מפתח שאינן קוד */
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const ROUTE = read('app/api/appointments/route.ts')
const ROUTE_CODE = codeOf(ROUTE)
const FORM = read('components/account/AccountBookingForm.tsx')
const FORM_CODE = codeOf(FORM)
const DBLAYER = read('lib/db/appointments.ts')
const DBLAYER_CODE = codeOf(DBLAYER)


// ════════════════════════════════════════════════════════════════════════════
section('התפוגה — אותו כלל בדיוק כמו במסלול הציבורי')

const { computePendingExpiresAt, describeExpiry, PENDING_TTL_HOURS } =
  await import('../lib/pendingExpiry.ts')
const { israelWallTimeToUtc } = await import('../lib/israelTime.ts')

chk('🔒 ה-route קורא ל-computePendingExpiresAt',
  /computePendingExpiresAt\(\)/.test(ROUTE_CODE))
chk('🔒 ה-route מייבא אותה מ-lib/pendingExpiry — אין חישוב מקומי',
  /import\s*\{\s*computePendingExpiresAt\s*\}\s*from\s*'@\/lib\/pendingExpiry'/.test(ROUTE_CODE))
chk('🔒 אין בשום מקום ב-route מספר שעות תפוגה משלו',
  !/pending_expiration_hours|12\s*\*\s*60\s*\*\s*60/.test(ROUTE_CODE))

// אותה פונקציה = אותן תוצאות. נבדק על אותן דוגמאות שאושרו ב-15A.
const at = (d, t) => israelWallTimeToUtc(d, t)
const expOf = (d, t) => describeExpiry(computePendingExpiresAt(at(d, t)))
chk('TTL הוא 3 שעות (ולא 12 של ה-RPC שהוסר)', PENDING_TTL_HOURS === 3)
chk('יום עבודה 15:00 → 18:00 באותו יום',
  expOf('2026-08-10', '15:00') === '2026-08-10 18:00', expOf('2026-08-10', '15:00'))
chk('יום עבודה 17:00 → 11:00 ביום העבודה הבא',
  expOf('2026-08-10', '17:00') === '2026-08-11 11:00', expOf('2026-08-10', '17:00'))
chk('חמישי 17:00 → ראשון 11:00',
  expOf('2026-08-13', '17:00') === '2026-08-16 11:00', expOf('2026-08-13', '17:00'))

{
  // 🔒 שני המסלולים מעבירים את הערך ל-RPC ולא נותנים ל-DB לחשב אותו
  const publicRoute = codeOf(read('app/api/bookings/request/route.ts'))
  chk('🔒 גם המסלול הציבורי משתמש באותה פונקציה — מקור אמת אחד',
    /computePendingExpiresAt\(/.test(publicRoute))
  /*
   * 🔒 האינווריאנטה: **כל** מסלול שיוצר שורת pending מעביר את התפוגה
   * מהשרת, ואף אחד לא נותן ל-DB לחשב אותה בעצמו (כלל 15B — 3 שעות עם
   * גלגול ל-11:00 — אינו ניתן לביטוי ב-SQL).
   *
   * ⚠️ נבדק לפי שמות ה-RPC ולא לפי ספירה. הספירה הייתה 2 עד 15E, ואז
   * נוספה create_reschedule_request — מספר קשיח היה נשבר בכל מסלול חדש
   * ומסתיר את השאלה האמיתית, שהיא אילו מסלולים קיימים ומה כל אחד שולח.
   */
  const PENDING_CREATORS = [
    'create_public_booking_request',
    'create_personal_area_booking_request',
    'create_reschedule_request',
  ]
  for (const rpc of PENDING_CREATORS) {
    const call = DBLAYER_CODE.slice(DBLAYER_CODE.indexOf(`'${rpc}'`))
    const body = call.slice(0, call.indexOf('})'))
    chk(`🔒 ${rpc} מקבל p_expires_at מהשרת`,
      DBLAYER_CODE.includes(`'${rpc}'`) && /p_expires_at:/.test(body))
  }
}


// ════════════════════════════════════════════════════════════════════════════
section('ה-RPC הישן הוסר מכל שכבת הקוד')

chk('🔒 createPendingAppointment אינה מיוצאת יותר',
  !/export\s+async\s+function\s+createPendingAppointment/.test(DBLAYER_CODE))
chk("🔒 אין קריאה ל-rpc('create_pending_appointment')",
  !/rpc\(\s*'create_pending_appointment'/.test(DBLAYER_CODE))
chk('🔒 ה-route אינו מזכיר את הפונקציה הישנה',
  !/createPendingAppointment/.test(ROUTE_CODE))
chk('createPersonalAreaBookingRequest מיוצאת במקומה',
  /export\s+async\s+function\s+createPersonalAreaBookingRequest/.test(DBLAYER_CODE))


// ════════════════════════════════════════════════════════════════════════════
section('🔒 פריסה דו-שלבית — 0020 תוספתית, 0021 מוחקת')

{
  const m20 = read('supabase/migrations/0020_personal_area_booking.sql')
  const m21 = read('supabase/migrations/0021_drop_legacy_create_pending.sql')
  const code20 = codeOf(m20).replace(/--.*$/gm, '')
  const code21 = codeOf(m21).replace(/--.*$/gm, '')

  /*
   * ⚠️ זו הבדיקה שמגנה על חלון הפריסה עצמו. מיגרציה ופריסת קוד אינן
   * אטומיות; אם ה-DROP יחזור ל-0020, כל בקשה שתגיע ל-deployment הישן בין
   * הרצת המיגרציה לסיום הפריסה תיפול על 500. הבדיקה נכשלת אם מישהו
   * יאחד את שתיהן בחזרה.
   */
  chk('🔒 0020 אינה מכילה שום DROP',
    !/drop\s+function/i.test(code20))
  chk('🔒 0020 דורשת שה-RPC הישן **עדיין קיים** (תופסת 0021 מוקדם מדי)',
    /0021 הורצה לפני הזמן/.test(m20))

  chk('0021 מכילה DROP מפורש עם החתימה המלאה',
    /drop function if exists public\.create_pending_appointment\(\s*uuid, text, text\[\], integer, timestamptz, integer, text, text\s*\)/.test(code21))
  chk('0021 מאמתת שה-DROP באמת הצליח',
    /create_pending_appointment עדיין קיימת/.test(m21))
  chk('0021 מאמתת ש-0020 כבר הותקנה לפניה',
    /0020 לא הותקנה/.test(m21))
  chk('0021 מאמתת ששתי הפונקציות הנותרות מ-0003 שרדו',
    /cancel_pending_appointment נמחקה בטעות/.test(m21) &&
    /expire_stale_pending_appointments נמחקה בטעות/.test(m21))
  chk('🔒 0021 אינה יוצרת ואינה משנה שום פונקציה',
    !/create\s+(or\s+replace\s+)?function/i.test(code21))
  chk('🔒 0021 אינה נוגעת בסכימה או בנתונים',
    !/alter\s+table|insert\s+into|update\s+public\.|delete\s+from/i.test(code21))
}


// ════════════════════════════════════════════════════════════════════════════
section('חלון ההכנה — 40 דקות, אותו קבוע בשני הצדדים')

const { MIN_LEAD_MINUTES, hasLeadTime, isBookableDate, isValidTimeSlot, isValidLiftingStart } =
  await import('../lib/bookingWindow.ts')

chk('MIN_LEAD_MINUTES = 40', MIN_LEAD_MINUTES === 40)
chk('🔒 ה-route אוכף hasLeadTime', /hasLeadTime\(/.test(ROUTE_CODE))
chk('🔒 ה-route משתמש בקבוע ולא במספר קשיח בהודעה',
  /\$\{MIN_LEAD_MINUTES\}/.test(ROUTE_CODE))
chk('🔒 ה-route אוכף isBookableDate', /isBookableDate\(/.test(ROUTE_CODE))
chk('🔒 ה-route אוכף את רשת השעות לשני הטיפולים',
  /isValidTimeSlot\(/.test(ROUTE_CODE) && /isValidLiftingStart\(/.test(ROUTE_CODE))

{
  // ההתנהגות עצמה, לא רק נוכחות הקריאה: 40 דק' מותר, 39 לא.
  const now = at('2026-08-10', '12:00')
  const okAt = hasLeadTime(2026, 7, 10, '12:40', now)
  const tooSoon = hasLeadTime(2026, 7, 10, '12:39', now)
  chk('בדיוק 40 דק׳ קדימה — מותר', okAt === true)
  chk('39 דק׳ קדימה — חסום', tooSoon === false)
}


// ════════════════════════════════════════════════════════════════════════════
section('מחיר ומשך מחושבים בשרת בלבד')

const {
  NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS,
  LIFTING_PRICE, LIFTING_DURATION_MIN, NATURAL_DURATION_MIN,
} = await import('../lib/services.ts')

chk('🔒 ה-route אינו קורא מחיר מגוף הבקשה',
  !/body\.(price|priceTotal|price_total)/.test(ROUTE_CODE))
chk('🔒 ה-route אינו קורא משך מגוף הבקשה',
  !/body\.(duration|durationMin|duration_min)/.test(ROUTE_CODE))
chk('🔒 המחיר מחושב מ-NATURAL_VARIANTS בשרת',
  /matched\.reduce\(\(sum, v\) => sum \+ v\.price, 0\)/.test(ROUTE_CODE))
chk('🔒 וריאנטים לא מוכרים מסוננים ולא נשמרים',
  /NATURAL_VARIANTS\.filter\(v => requested\.includes\(v\.id\)\)/.test(ROUTE_CODE))
chk('הרמת גבות — מחיר ומשך קבועים מ-lib/services',
  LIFTING_PRICE === 250 && LIFTING_DURATION_MIN === 40 && NATURAL_DURATION_MIN === 20)


// ════════════════════════════════════════════════════════════════════════════
section('הזהות — מה-session בלבד')

chk('🔒 customerId מגיע מ-getCurrentCustomerId', /getCurrentCustomerId\(\)/.test(ROUTE_CODE))
chk('🔒 אין קריאת טלפון מגוף הבקשה',
  !/body\.phone/.test(ROUTE_CODE) && !/normalizePhone/.test(ROUTE_CODE))
chk('🔒 אין קריאת customerId מגוף הבקשה',
  !/body\.(customerId|customer_id)/.test(ROUTE_CODE))
chk('🔒 היעדר session מחזיר 401',
  /if \(!customerId\)/.test(ROUTE_CODE) && /status: 401/.test(ROUTE_CODE))
chk('🔒 לקוחה חסומה נחסמת גם לפני הכתיבה וגם בתוך ה-RPC',
  /customer\.is_blocked/.test(ROUTE_CODE) && /result\.error === 'blocked'/.test(ROUTE_CODE))
chk("🔒 הטופס אינו שולח טלפון או שם", !/phone|fullName/.test(FORM_CODE))


// ════════════════════════════════════════════════════════════════════════════
section('שני מסלולים נפרדים — אין ערבוב')

{
  const publicRoute = codeOf(read('app/api/bookings/request/route.ts'))
  chk('🔒 המסלול הציבורי אינו דורש session',
    !/getCurrentCustomerId/.test(publicRoute))
  chk('🔒 המסלול הציבורי נשאר ללא OTP',
    !/verifyOtp|issueOtp/.test(publicRoute))
  chk('🔒 המסלול המאומת אינו נוגע ב-IP ובמגבלת הקצב',
    !/resolveClientIp/.test(ROUTE_CODE) && !/bookingRateLimit/.test(ROUTE_CODE))
  chk('🔒 כל מסלול קורא ל-RPC משלו',
    /create_public_booking_request/.test(DBLAYER_CODE) &&
    /create_personal_area_booking_request/.test(DBLAYER_CODE))

  // ⚠️ הטופס הציבורי לא נגענו בו. אם מישהו יחליף אותו בעתיד — הבדיקה תיפול.
  const publicForm = codeOf(read('components/booking/BookingForm.tsx'))
  chk('🔒 BookingForm הציבורי עדיין קורא ל-/api/bookings/request',
    /'\/api\/bookings\/request'/.test(publicForm))
  chk('🔒 BookingForm הציבורי אינו קורא ל-/api/appointments',
    !/fetch\(\s*'\/api\/appointments'/.test(publicForm))
}


// ════════════════════════════════════════════════════════════════════════════
section('הטופס באזור האישי — שימוש חוזר, בלי כללים משלו')

const { selectDisplaySlots } = await import('../lib/slotSelection.ts')

chk('🔒 הזמינות מגיעה מ-lib/slotSelection (אותו קובץ כמו /booking)',
  /from '@\/lib\/slotSelection'/.test(FORM_CODE) && /selectDisplaySlots\(/.test(FORM_CODE))
chk('🔒 התפוסה מגיעה מ-/api/bookings/slots',
  /'\/api\/bookings\/slots\?date=/.test(FORM_CODE) || /\/api\/bookings\/slots\?date=\$\{/.test(FORM_CODE))
chk('🔒 הימים הפתוחים נקבעים ע"י isBookableDate',
  /from '@\/lib\/bookingWindow'/.test(FORM_CODE) && /isBookableDate\(/.test(FORM_CODE))
chk('🔒 הטיפולים והמחירים מיובאים מ-lib/services',
  /from '@\/lib\/services'/.test(FORM_CODE))
chk('🔒 אין בטופס רשימת שעות משלו',
  !/TIME_SLOTS\s*=/.test(FORM_CODE) && !/'09:00'.*'09:20'/.test(FORM_CODE))
chk('🔒 אין בטופס חישוב תפוגה משלו', !/expires|pending_expires/.test(FORM_CODE))

{
  // 🔒 האינווריאנטה של שלב 13: כישלון מקור זמינות אינו "היום פנוי".
  chk('🔒 תשובת כישלון מ-slots אינה מתורגמת לרשימה ריקה של תפוסים',
    /if \(!res\.ok\)/.test(FORM_CODE) && /setSlotsUnavailable\(true\)/.test(FORM_CODE))
  chk('🔒 כש-slotsUnavailable דלוק לא מוצגות שעות כלל',
    /!slotsUnavailable/.test(FORM_CODE))
}

{
  // אותו אלגוריתם, אותה תוצאה — 40 דק' מציג רק התחלות עם רצף
  const params = { year: 2026, month: 8, day: 14, busyRanges: [], now: at('2026-09-10', '10:00') }
  const short = selectDisplaySlots({ ...params, durationMin: 20 })
  const long = selectDisplaySlots({ ...params, durationMin: 40 })
  chk('40 דק׳ מקבל תת-קבוצה של 20 דק׳ (רק התחלות עם רצף)',
    long.every(s => short.includes(s)) && long.length <= short.length,
    `${short.length} → ${long.length}`)
}


// ════════════════════════════════════════════════════════════════════════════
section('גידור בדגל')

chk('🔒 ה-route חוסם כשהדגל כבוי, לפני כל קריאה ל-DB',
  ROUTE_CODE.indexOf('isNewBookingSystemEnabled()') <
  ROUTE_CODE.indexOf('getCurrentCustomerId()'))
chk('🔒 ה-route נעול בשבת', /isShabbat\(\)/.test(ROUTE_CODE))

{
  const layout = codeOf(read('app/layout.tsx'))
  const navbar = codeOf(read('components/layout/Navbar.tsx'))
  chk('🔒 הדגל נקרא בשרת ומועבר ל-Navbar כ-prop',
    /newBookingSystemEnabled=\{isNewBookingSystemEnabled\(\)\}/.test(layout))
  chk("🔒 Navbar אינו מייבא את lib/featureFlags (server-only)",
    !/featureFlags/.test(navbar))
  chk('🔒 ברירת המחדל ב-Navbar היא false — שכחה מסתירה ולא חושפת',
    /newBookingSystemEnabled\s*=\s*false/.test(navbar))
  chk('הקישור לאזור האישי מצביע ל-/login',
    /href="\/login"/.test(navbar))
  // ⚠️ שני מופעי רינדור בלבד (שולחן + נייד), ושניהם מותנים בדגל ותו לא.
  chk('הקישור מרונדר פעמיים — תפריט שולחן ותפריט נייד',
    (navbar.match(/\{newBookingSystemEnabled && \(/g) ?? []).length === 2)
  chk('🔒 הקישור אינו מותנה במצב התחברות — Navbar אינו יודע על session כלל',
    !/loggedIn|getSession|sm_session|isAdmin/.test(navbar))
}


// ════════════════════════════════════════════════════════════════════════════
section('אין silent failure')

chk('slot_taken מוחזר כ-409', /error: 'slot_taken'[\s\S]{0,200}status: 409/.test(ROUTE_CODE))
chk('pending_limit_reached מוחזר כ-409',
  /error: 'pending_limit_reached'[\s\S]{0,300}status: 409/.test(ROUTE_CODE))
chk('כשל שמירה מוחזר כ-500 עם הודעה מפורשת',
  /לא הצלחנו לשמור את הבקשה/.test(ROUTE))
chk('🔒 הטופס אינו מציג הצלחה על תשובה שאינה ok',
  /if \(!res\.ok\)/.test(FORM_CODE) && FORM_CODE.indexOf('if (!res.ok)') < FORM_CODE.indexOf('router.refresh()'))
chk('🔒 slot_taken מרענן את הזמינות במקום להשאיר בחירה מיושנת',
  /data\.error === 'slot_taken'/.test(FORM_CODE) && /fetchBusy\(selected\.isoDate\)/.test(FORM_CODE))


// ── סיכום ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(70))
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
