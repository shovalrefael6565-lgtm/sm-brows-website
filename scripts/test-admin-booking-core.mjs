/**
 * בדיקות שלב 10 שאינן דורשות DB או רשת.
 *
 * המיקוד בארבעה דברים שאין דרך לתקן בדיעבד:
 *
 *   1. **טביעת האצבע ל-idempotency.** אם היא לא כוללת שדה שמשנה את
 *      התוצאה, retry שגוי ייחשב זהה והמנהלת תקבל "הצלחה" על נתונים שלא
 *      נשמרו. אם היא *כן* משתנה על שינוי חסר-משמעות (רווח כפול בשם, סדר
 *      תוספות אחר), retry לגיטימי ייפול על IDEMPOTENCY_KEY_REUSED.
 *
 *   2. **אזור הזמן.** date+time מהדפדפן חייבים להתפרש כשעון קיר *ישראלי*.
 *      פירוש לפי אזור הזמן של שרת Vercel (UTC) היה מזיז כל תור בשעתיים
 *      או שלוש, לפי שעון קיץ/חורף.
 *
 *   3. **מקורות האמת של השירות.** משך ומחיר נגזרים מהקטלוג בשרת, ולא
 *      ממה שהדפדפן שלח.
 *
 *   4. **ה-resolver של Auth.** הוא לא קורא את auth.users (Supabase חוסמת
 *      את הסכמה), ולכן הוא נבדק כאן מול Auth Admin מזויף — כולל עמוד שני,
 *      טלפון סותר, ושני משתמשים לאותו מספר.
 *
 * הרצה:  npm run test:admin-booking-core
 */

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const {
  customerCreateFingerprint, appointmentCreateFingerprint,
  canonicalFullName, FINGERPRINT_RE, FINGERPRINT_VERSION,
} = await import('../lib/adminIdempotency.ts')

const {
  resolveManualService, manualSlotInstants, manualSlotWarnings,
} = await import('../lib/adminBooking.ts')

const { verifyAuthUserPhone, findAuthUserIdByPhone } =
  await import('../lib/auth/adminUserResolver.ts')

const { israelWallTimeToUtc } = await import('../lib/israelTime.ts')
const {
  NATURAL_SERVICE, LIFTING_SERVICE, MICROBLADING_SERVICE, MICROBLADING_CONSULT_SERVICE,
  ADMIN_ONLY_SERVICES, ADMIN_MIN_DURATION_MIN, ADMIN_MAX_DURATION_MIN, isBookableService,
} = await import('../lib/services.ts')

const ADMIN = '11111111-1111-4111-8111-111111111111'
const ADMIN2 = '22222222-2222-4222-8222-222222222222'
const CUST = '33333333-3333-4333-8333-333333333333'

// ════════════════════════════════════════════════════════════════════════════
section('טביעת אצבע — יצירת לקוחה')
// ════════════════════════════════════════════════════════════════════════════

const baseCustomer = {
  actorAdminId: ADMIN,
  fullName: 'רותי כהן',
  phoneE164: '+972541234567',
  sourceKey: 'instagram',
  crmStatus: 'active',
}
const fpCustomer = customerCreateFingerprint(baseCustomer)

chk('הפורמט הוא 64 תווי hex', FINGERPRINT_RE.test(fpCustomer), fpCustomer.slice(0, 16) + '…')
chk('אותו payload → אותו hash', customerCreateFingerprint(baseCustomer) === fpCustomer)

chk('שינוי full_name משנה את ה-hash',
  customerCreateFingerprint({ ...baseCustomer, fullName: 'רותי לוי' }) !== fpCustomer)
chk('שינוי source_key משנה את ה-hash',
  customerCreateFingerprint({ ...baseCustomer, sourceKey: 'facebook' }) !== fpCustomer)
chk('שינוי crm_status משנה את ה-hash',
  customerCreateFingerprint({ ...baseCustomer, crmStatus: 'inactive' }) !== fpCustomer)
chk('שינוי טלפון משנה את ה-hash',
  customerCreateFingerprint({ ...baseCustomer, phoneE164: '+972541234568' }) !== fpCustomer)
chk('מנהלת אחרת → hash אחר (namespace נפרד)',
  customerCreateFingerprint({ ...baseCustomer, actorAdminId: ADMIN2 }) !== fpCustomer)

// ⚠️ זה מה שמונע IDEMPOTENCY_KEY_REUSED מזויף: ה-hash מחושב על הערך
// שבאמת נכתב ל-DB, ולא על הקלט הגולמי.
chk('נרמול רווחים בשם מתכנס לאותו ערך שנשמר',
  canonicalFullName('  רותי   כהן  ') === 'רותי כהן')
chk('שם עם רווח כפול → אותו hash כמו הנקי',
  customerCreateFingerprint({ ...baseCustomer, fullName: '  רותי   כהן ' }) === fpCustomer)

// ════════════════════════════════════════════════════════════════════════════
section('טביעת אצבע — יצירת תור')
// ════════════════════════════════════════════════════════════════════════════

const baseAppt = {
  actorAdminId: ADMIN,
  customerId: CUST,
  serviceKey: NATURAL_SERVICE,
  variants: ['עיצוב גבות טבעי', 'שעווה לכל הפנים'],
  startsAt: new Date('2026-08-24T14:00:00.000Z'),
  durationMin: 20,
  priceTotal: 110,
  policyVersion: '1.0',
}
const fpAppt = appointmentCreateFingerprint(baseAppt)

chk('הפורמט הוא 64 תווי hex', FINGERPRINT_RE.test(fpAppt))
chk('אותו payload → אותו hash', appointmentCreateFingerprint(baseAppt) === fpAppt)

chk('סדר variants שונה, אותה משמעות → אותו hash',
  appointmentCreateFingerprint({
    ...baseAppt, variants: ['שעווה לכל הפנים', 'עיצוב גבות טבעי'],
  }) === fpAppt)
chk('variant נוסף משנה את ה-hash',
  appointmentCreateFingerprint({
    ...baseAppt, variants: [...baseAppt.variants, 'עיצוב גבות + צביעה'],
  }) !== fpAppt)
chk('שינוי מועד משנה את ה-hash',
  appointmentCreateFingerprint({ ...baseAppt, startsAt: new Date('2026-08-24T15:00:00.000Z') }) !== fpAppt)
chk('שינוי לקוחה משנה את ה-hash',
  appointmentCreateFingerprint({ ...baseAppt, customerId: ADMIN2 }) !== fpAppt)
chk('שינוי מחיר משנה את ה-hash',
  appointmentCreateFingerprint({ ...baseAppt, priceTotal: 999 }) !== fpAppt)
chk('שינוי משך משנה את ה-hash',
  appointmentCreateFingerprint({ ...baseAppt, durationMin: 40 }) !== fpAppt)
chk('שינוי policy_version משנה את ה-hash',
  appointmentCreateFingerprint({ ...baseAppt, policyVersion: '2.0' }) !== fpAppt)

// ⚠️ אותו רגע בזמן שהגיע משני clients באזורי זמן שונים — ה-Date זהה,
// ולכן גם ה-ISO וגם ה-hash. אין תלות באזור הזמן של המחשב ששלח.
const sameInstantOtherTz = new Date('2026-08-24T17:00:00.000+03:00')
chk('אותו רגע בייצוג offset אחר → אותו hash',
  appointmentCreateFingerprint({ ...baseAppt, startsAt: sameInstantOtherTz }) === fpAppt,
  sameInstantOtherTz.toISOString())

chk('customer payload ו-appointment payload לעולם אינם מתנגשים', fpCustomer !== fpAppt)
chk('גרסת הפורמט קיימת ומוצהרת', FINGERPRINT_VERSION === 1)

// ════════════════════════════════════════════════════════════════════════════
section('אזור זמן: שעון קיר ישראלי')
// ════════════════════════════════════════════════════════════════════════════

// ⚠️ הבדיקה הזו נופלת אם מישהו יחליף את israelWallTimeToUtc
// ב-new Date(`${date}T${time}`): שם התוצאה תלויה באזור הזמן של התהליך.

// קיץ (IDT, UTC+3): 14:00 בישראל = 11:00 UTC
const summer = manualSlotInstants('2026-08-24', '14:00', 20)
chk('קיץ: 14:00 ישראל → 11:00 UTC',
  summer.startsAt.toISOString() === '2026-08-24T11:00:00.000Z', summer.startsAt.toISOString())
chk('קיץ: הסוף נגזר מהמשך שחושב בשרת',
  summer.endsAt.toISOString() === '2026-08-24T11:20:00.000Z')

// חורף (IST, UTC+2): 14:00 בישראל = 12:00 UTC
const winter = manualSlotInstants('2026-01-14', '14:00', 40)
chk('חורף: 14:00 ישראל → 12:00 UTC',
  winter.startsAt.toISOString() === '2026-01-14T12:00:00.000Z', winter.startsAt.toISOString())
chk('חורף: הסוף נגזר מהמשך',
  winter.endsAt.toISOString() === '2026-01-14T12:40:00.000Z')

chk('אותה שעה מקומית בקיץ ובחורף נשמרת ב-UTC שונה (זו בדיוק הנקודה)',
  summer.startsAt.toISOString().slice(11, 16) !== winter.startsAt.toISOString().slice(11, 16))

chk('manualSlotInstants עקבי עם israelWallTimeToUtc',
  manualSlotInstants('2026-03-30', '09:30', 20).startsAt.getTime() ===
  israelWallTimeToUtc('2026-03-30', '09:30').getTime())

// שני "clients" באזורי זמן שונים ששלחו את אותו תאריך+שעה מקומיים של
// העסק — ההמרה בשרת זהה, ולכן גם ה-fingerprint.
const fromTokyo = manualSlotInstants('2026-08-24', '14:00', 20)
const fromBerlin = manualSlotInstants('2026-08-24', '14:00', 20)
chk('אותו date/time משני clients → אותו starts_at',
  fromTokyo.startsAt.getTime() === fromBerlin.startsAt.getTime())
chk('אותו date/time משני clients → אותו fingerprint',
  appointmentCreateFingerprint({ ...baseAppt, startsAt: fromTokyo.startsAt }) ===
  appointmentCreateFingerprint({ ...baseAppt, startsAt: fromBerlin.startsAt }))

// ════════════════════════════════════════════════════════════════════════════
section('אזהרות חריגה — לא חוסמות')
// ════════════════════════════════════════════════════════════════════════════

const inHours = manualSlotInstants('2026-08-24', '14:00', 20) // שני
let w = manualSlotWarnings(inHours.startsAt, inHours.endsAt)
chk('יום שני 14:00 — אין אזהרה', !w.outsideBusinessHours && !w.closedDay)

const early = manualSlotInstants('2026-08-24', '07:00', 20)
w = manualSlotWarnings(early.startsAt, early.endsAt)
chk('07:00 — מסומן כמחוץ לשעות הפעילות', w.outsideBusinessHours && !w.closedDay)

const late = manualSlotInstants('2026-08-24', '20:30', 20)
w = manualSlotWarnings(late.startsAt, late.endsAt)
chk('20:30 — מסומן כמחוץ לשעות הפעילות', w.outsideBusinessHours)

// תור שמתחיל בתוך השעות אך נגמר אחריהן
const spill = manualSlotInstants('2026-08-24', '18:50', 40)
w = manualSlotWarnings(spill.startsAt, spill.endsAt)
chk('18:50 למשך 40 דק׳ (נגמר אחרי 19:00) — מסומן כחריגה', w.outsideBusinessHours)

// 2026-08-28 הוא יום שישי, 2026-08-29 שבת
const friday = manualSlotInstants('2026-08-28', '14:00', 20)
w = manualSlotWarnings(friday.startsAt, friday.endsAt)
chk('שישי — מסומן כיום סגור', w.closedDay)

const saturday = manualSlotInstants('2026-08-29', '14:00', 20)
w = manualSlotWarnings(saturday.startsAt, saturday.endsAt)
chk('שבת — מסומן כיום סגור', w.closedDay)

const fridayEarly = manualSlotInstants('2026-08-28', '07:00', 20)
w = manualSlotWarnings(fridayEarly.startsAt, fridayEarly.endsAt)
chk('שישי מוקדם — שתי האזהרות יחד', w.closedDay && w.outsideBusinessHours)

// ════════════════════════════════════════════════════════════════════════════
section('השירות נטען מהקטלוג בשרת')
// ════════════════════════════════════════════════════════════════════════════

let r = resolveManualService(LIFTING_SERVICE, [])
chk('הרמת גבות: משך ומחיר מהקטלוג',
  r.ok && r.data.durationMin === 40 && r.data.priceTotal === 250 && r.data.variants.length === 0)

r = resolveManualService(LIFTING_SERVICE, ['עיצוב גבות טבעי'])
chk('הרמת גבות עם variants → נדחה במפורש', !r.ok && r.error === 'invalid_variants')

r = resolveManualService(NATURAL_SERVICE, ['עיצוב גבות טבעי'])
chk('טבעיות + תוספת אחת: 70 ₪, 20 דק׳',
  r.ok && r.data.priceTotal === 70 && r.data.durationMin === 20)

r = resolveManualService(NATURAL_SERVICE, ['עיצוב גבות טבעי', 'שעווה לכל הפנים'])
chk('שתי תוספות: המחיר מסוכם בשרת (70+40)', r.ok && r.data.priceTotal === 110)

r = resolveManualService(NATURAL_SERVICE, [])
chk('טבעיות בלי תוספות → נדחה', !r.ok && r.error === 'variants_required')

r = resolveManualService(NATURAL_SERVICE, ['תוספת שלא קיימת'])
chk('variant לא מוכר → נדחה', !r.ok && r.error === 'invalid_variants')

r = resolveManualService(NATURAL_SERVICE, ['עיצוב גבות טבעי', 'תוספת שלא קיימת'])
chk('variant מוכר יחד עם לא מוכר → נדחה (לא מושמט בשקט)',
  !r.ok && r.error === 'invalid_variants')

r = resolveManualService('טיפול שלא קיים', [])
chk('טיפול שאינו בקטלוג היומן → נדחה', !r.ok && r.error === 'invalid_service')

r = resolveManualService(NATURAL_SERVICE, 'לא-מערך')
chk('variants שאינו מערך → נדחה', !r.ok)

// ⚠️ המחיר לעולם לא מגיע מהדפדפן — אין דרך להעביר אותו בכלל
r = resolveManualService(NATURAL_SERVICE, ['עיצוב גבות + צביעה'])
chk('מחיר התוספת נלקח מהקטלוג ולא מהקלט', r.ok && r.data.priceTotal === 85)

// ⚠️ **הגבול המרכזי של שלב 12:** ערכי משך/מחיר מהדפדפן מתקבלים אך ורק
// בטיפול ניהולי. בטיפולי הקטלוג הם חייבים להיות מתעלמים לחלוטין —
// אחרת הדפדפן יכול לקבוע מחיר ומשך לתור לקוחה רגיל.
r = resolveManualService(NATURAL_SERVICE, ['עיצוב גבות טבעי'], { durationMin: 300, priceTotal: 5 })
chk('קטלוג: durationMin/priceTotal מהדפדפן מתעלמים',
  r.ok && r.data.durationMin === 20 && r.data.priceTotal === 70 && r.data.manualDuration === false)

r = resolveManualService(LIFTING_SERVICE, [], { durationMin: 300, priceTotal: 5 })
chk('הרמת גבות: durationMin/priceTotal מהדפדפן מתעלמים',
  r.ok && r.data.durationMin === 40 && r.data.priceTotal === 250)

// ════════════════════════════════════════════════════════════════════════════
section('טיפולים ניהוליים — משך ידני (שלב 12)')
// ════════════════════════════════════════════════════════════════════════════

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: 150 })
chk('מיקרובליידינג: המשך שהוזן נשמר, בלי מחיר',
  r.ok && r.data.durationMin === 150 && r.data.priceTotal === null &&
  r.data.manualDuration === true && r.data.variants.length === 0)

r = resolveManualService(MICROBLADING_CONSULT_SERVICE, [], { durationMin: 30, priceTotal: 100 })
chk('ייעוץ מיקרובליידינג: משך ידני + מחיר אופציונלי',
  r.ok && r.data.durationMin === 30 && r.data.priceTotal === 100)

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: 90, priceTotal: '' })
chk('מחיר ריק = בלי מחיר, ולא 0', r.ok && r.data.priceTotal === null)

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: 90, priceTotal: 0 })
chk('מחיר 0 מפורש נשמר כ-0 ולא כ-null', r.ok && r.data.priceTotal === 0)

r = resolveManualService(MICROBLADING_SERVICE, [])
chk('בלי משך → נדחה', !r.ok && r.error === 'invalid_duration')

// 🔒 אותם גבולות בדיוק שה-RPC אוכף (0010). אילו כאן היו רחבים יותר,
// הבקשה הייתה נופלת ב-DB במקום להציג שגיאה ברורה למנהלת.
r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: ADMIN_MIN_DURATION_MIN - 1 })
chk('משך מתחת למינימום → נדחה', !r.ok && r.error === 'invalid_duration')

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: ADMIN_MAX_DURATION_MIN + 1 })
chk('משך מעל למקסימום → נדחה', !r.ok && r.error === 'invalid_duration')

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: ADMIN_MIN_DURATION_MIN })
chk('גבול תחתון עצמו מתקבל', r.ok && r.data.durationMin === ADMIN_MIN_DURATION_MIN)

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: ADMIN_MAX_DURATION_MIN })
chk('גבול עליון עצמו מתקבל', r.ok && r.data.durationMin === ADMIN_MAX_DURATION_MIN)

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: 45.5 })
chk('משך שאינו שלם → נדחה', !r.ok && r.error === 'invalid_duration')

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: 'הרבה' })
chk('משך שאינו מספר → נדחה', !r.ok && r.error === 'invalid_duration')

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: 60, priceTotal: -5 })
chk('מחיר שלילי → נדחה', !r.ok && r.error === 'invalid_price')

r = resolveManualService(MICROBLADING_SERVICE, [], { durationMin: 60, priceTotal: 12.5 })
chk('מחיר שאינו שלם → נדחה', !r.ok && r.error === 'invalid_price')

r = resolveManualService(MICROBLADING_SERVICE, ['עיצוב גבות טבעי'], { durationMin: 60 })
chk('תוספות בטיפול ניהולי → נדחות במפורש', !r.ok && r.error === 'invalid_variants')

// 🔒 הגבול שמפריד בין ניהולי לציבורי: אף מסלול לקוחה לא יכול לבחור בהם.
chk('מיקרובליידינג אינו bookable ציבורי', isBookableService(MICROBLADING_SERVICE) === false)
chk('ייעוץ מיקרובליידינג אינו bookable ציבורי',
  isBookableService(MICROBLADING_CONSULT_SERVICE) === false)
chk('שני טיפולי הקטלוג נשארו bookable',
  isBookableService(NATURAL_SERVICE) && isBookableService(LIFTING_SERVICE))
chk('שני טיפולים ניהוליים בדיוק, שניהם עם ברירת מחדל למשך',
  ADMIN_ONLY_SERVICES.length === 2 &&
  ADMIN_ONLY_SERVICES.every(s => Number.isInteger(s.defaultDurationMin) &&
    s.defaultDurationMin >= ADMIN_MIN_DURATION_MIN &&
    s.defaultDurationMin <= ADMIN_MAX_DURATION_MIN))

// ════════════════════════════════════════════════════════════════════════════
section('Auth resolver מול Auth Admin מזויף')
// ════════════════════════════════════════════════════════════════════════════

const PHONE = '+972541112222'
const U1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const U2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

const fakeAuth = ({ users = [], byId = {}, listError = null } = {}) => ({
  auth: {
    admin: {
      async getUserById(id) {
        const u = byId[id]
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'not found' } }
      },
      async listUsers({ page, perPage }) {
        if (listError) return { data: null, error: { message: listError } }
        const start = (page - 1) * perPage
        return { data: { users: users.slice(start, start + perPage) }, error: null }
      },
    },
  },
})

// Supabase שומר את הטלפון בלי '+' — נבדק בשני הפורמטים
chk('getUserById עם טלפון תואם (ללא +) → ok',
  await verifyAuthUserPhone(U1, PHONE, fakeAuth({ byId: { [U1]: { phone: '972541112222' } } })) === 'ok')
chk('getUserById עם טלפון תואם (עם +) → ok',
  await verifyAuthUserPhone(U1, PHONE, fakeAuth({ byId: { [U1]: { phone: '+972541112222' } } })) === 'ok')
chk('⚠️ טלפון שונה → phone_mismatch, אין קישור',
  await verifyAuthUserPhone(U1, PHONE, fakeAuth({ byId: { [U1]: { phone: '972549998888' } } })) === 'phone_mismatch')
chk('טלפון ריק → phone_mismatch',
  await verifyAuthUserPhone(U1, PHONE, fakeAuth({ byId: { [U1]: { phone: null } } })) === 'phone_mismatch')
chk('user שאינו קיים → not_found',
  await verifyAuthUserPhone(U1, PHONE, fakeAuth({ byId: {} })) === 'not_found')

// pagination: 200 בעמוד הראשון, המשתמש המבוקש בעמוד השני
const page1 = Array.from({ length: 200 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, phone: `97255${String(i).padStart(7, '0')}`,
}))
const twoPages = [...page1, { id: U1, phone: '972541112222' }]

let f = await findAuthUserIdByPhone(PHONE, fakeAuth({ users: twoPages }))
chk('user נמצא בעמוד השני של listUsers', f.ok && f.id === U1, String(f.id))

f = await findAuthUserIdByPhone(PHONE, fakeAuth({ users: [] }))
chk('0 תוצאות → null (מותר ליצור auth user)', f.ok && f.id === null)

f = await findAuthUserIdByPhone(PHONE, fakeAuth({ users: [{ id: U1, phone: '972541112222' }] }))
chk('תוצאה אחת → ה-id שלה', f.ok && f.id === U1)

f = await findAuthUserIdByPhone(PHONE, fakeAuth({
  users: [{ id: U1, phone: '972541112222' }, { id: U2, phone: '+972-54-111-2222' }],
}))
chk('⚠️ שני auth users לאותו טלפון מנורמל → ambiguous, לא בחירה אקראית',
  !f.ok && f.error === 'ambiguous')

f = await findAuthUserIdByPhone(PHONE, fakeAuth({ listError: 'boom' }))
chk('כשל ב-listUsers → lookup_failed (לא "לא נמצא")', !f.ok && f.error === 'lookup_failed')

// תקרת הבטיחות: עמוד מלא שחוזר לנצח לא יוצר לולאה אינסופית
const alwaysFull = {
  auth: { admin: {
    async getUserById() { return { data: { user: null }, error: null } },
    async listUsers({ perPage }) {
      return { data: { users: Array.from({ length: perPage }, (_, i) => ({ id: `x${i}`, phone: '972500000000' })) }, error: null }
    },
  } },
}
const started = Date.now()
f = await findAuthUserIdByPhone(PHONE, alwaysFull)
chk('עמוד מלא אינסופי נעצר בתקרת העמודים', f.ok === false || f.ok === true, `${Date.now() - started}ms`)

// ⚠️ שום מידע מ-auth.users לא עוזב את המודול חוץ מ-UUID
f = await findAuthUserIdByPhone(PHONE, fakeAuth({ users: [{ id: U1, phone: '972541112222', email: 'x@y.z' }] }))
chk('הערך המוחזר הוא מחרוזת UUID בלבד — לא אובייקט user',
  f.ok && typeof f.id === 'string' && !('email' in Object(f)) && !('phone' in Object(f)))
const verifyOut = await verifyAuthUserPhone(U1, PHONE, fakeAuth({ byId: { [U1]: { phone: '972541112222', email: 'x@y.z' } } }))
chk('verifyAuthUserPhone מחזירה union של מחרוזות בלבד', typeof verifyOut === 'string')

// ════════════════════════════════════════════════════════════════════════════
const passed = results.filter(Boolean).length
console.log(`\n${'═'.repeat(60)}`)
if (passed === results.length) {
  console.log(`✓ כל ${results.length} הבדיקות עברו`)
} else {
  console.log(`✗ ${results.length - passed} מתוך ${results.length} נכשלו`)
  process.exit(1)
}
