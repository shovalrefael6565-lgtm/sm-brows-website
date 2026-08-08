/**
 * שלב 15B — בדיקות ללוגיקה הטהורה של המסלול הציבורי.
 *
 * מכסה: תפוגת pending (TTL + כלל הלילה + אזור זמן), חילוץ IP מהימן,
 * חלון ההכנה של 40 דק', נוסח בקשת התור, וקבועי מגבלת הקצב.
 *
 * לא נדרש בסיס נתונים. הבדיקות מול Postgres נמצאות ב-
 * scripts/test-public-booking-db.mjs.
 *
 * הרצה:  npm run test:public-booking-core
 */

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(62)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}

const { israelWallTimeToUtc } = await import('../lib/israelTime.ts')
const {
  computePendingExpiresAt, describeExpiry, isSanePendingExpiry,
  PENDING_TTL_HOURS, PENDING_RELEASE_HHMM, PENDING_EXPIRY_MAX_HOURS,
} = await import('../lib/pendingExpiry.ts')

// ─── תפוגת pending ──────────────────────────────────────────────────────────
section('תפוגת pending — TTL וכלל הלילה')

chk('TTL ברירת המחדל הוא 3 שעות', PENDING_TTL_HOURS === 3)
chk("שעת השחרור היא 11:00", PENDING_RELEASE_HHMM === '11:00')

const at = (d, t) => israelWallTimeToUtc(d, t)
const expOf = (d, t) => describeExpiry(computePendingExpiresAt(at(d, t)))

// 2026-08-10 = יום שני · 2026-08-13 = חמישי · 14 = שישי · 15 = שבת · 16 = ראשון
chk('יום עבודה 15:00 → 18:00 באותו יום',
  expOf('2026-08-10', '15:00') === '2026-08-10 18:00', expOf('2026-08-10', '15:00'))
chk('יום עבודה 09:00 → 12:00 באותו יום',
  expOf('2026-08-10', '09:00') === '2026-08-10 12:00', expOf('2026-08-10', '09:00'))
chk('גבול תחתון 15:59 → 18:59 באותו יום (לא מתגלגל)',
  expOf('2026-08-10', '15:59') === '2026-08-10 18:59', expOf('2026-08-10', '15:59'))
chk('גבול עליון 16:00 → 11:00 למחרת (התוצאה היא 19:00)',
  expOf('2026-08-10', '16:00') === '2026-08-11 11:00', expOf('2026-08-10', '16:00'))
chk('יום עבודה 17:00 → 11:00 ביום העבודה הבא',
  expOf('2026-08-10', '17:00') === '2026-08-11 11:00', expOf('2026-08-10', '17:00'))

// ⚠️ המקרה שהכלל המילולי לא כיסה, ושאושר במפורש: חלון הטיפול הוא
// [09:00, 19:00), ולכן תפוגה שנוחתת אחרי חצות מתגלגלת גם היא.
chk('לילה 23:00 → 11:00 ביום העבודה הבא (דוגמה מאושרת)',
  expOf('2026-08-10', '23:00') === '2026-08-11 11:00', expOf('2026-08-10', '23:00'))
chk('לילה 23:30 → 11:00 למחרת, לא 02:30',
  expOf('2026-08-10', '23:30') === '2026-08-11 11:00', expOf('2026-08-10', '23:30'))
chk('חמישי 23:00 → ראשון 11:00 (חוצה חצות ואז שישי/שבת)',
  expOf('2026-08-13', '23:00') === '2026-08-16 11:00', expOf('2026-08-13', '23:00'))
// גבולות החלון עצמו, במפורש
chk('גבול תחתון: תפוגה ב-09:00 בדיוק מתקבלת ואינה מתגלגלת',
  expOf('2026-08-10', '06:00') === '2026-08-10 09:00', expOf('2026-08-10', '06:00'))
chk('מתחת לגבול: תפוגה ב-08:59 מתגלגלת ל-11:00',
  expOf('2026-08-10', '05:59') === '2026-08-10 11:00', expOf('2026-08-10', '05:59'))
chk('לילה 02:00 → 11:00 באותו בוקר',
  expOf('2026-08-11', '02:00') === '2026-08-11 11:00', expOf('2026-08-11', '02:00'))

chk('חמישי 17:00 → ראשון 11:00 (שישי ושבת מדולגים)',
  expOf('2026-08-13', '17:00') === '2026-08-16 11:00', expOf('2026-08-13', '17:00'))
chk('שישי בבוקר → ראשון 11:00',
  expOf('2026-08-14', '09:00') === '2026-08-16 11:00', expOf('2026-08-14', '09:00'))
chk('מוצאי שבת 21:00 → ראשון 11:00',
  expOf('2026-08-15', '21:00') === '2026-08-16 11:00', expOf('2026-08-15', '21:00'))

// 🔒 אזור זמן: אותו כלל בדיוק גם בשעון חורף
chk('חורף — חמישי 17:00 → ראשון 11:00',
  expOf('2026-01-15', '17:00') === '2026-01-18 11:00', expOf('2026-01-15', '17:00'))
chk('חורף — יום עבודה 15:00 → 18:00 באותו יום',
  expOf('2026-01-12', '15:00') === '2026-01-12 18:00', expOf('2026-01-12', '15:00'))

// 🔒 החישוב אינו תלוי באזור הזמן של השרת
{
  const before = process.env.TZ
  process.env.TZ = 'UTC'
  const utcResult = expOf('2026-08-10', '17:00')
  process.env.TZ = before ?? 'Asia/Jerusalem'
  chk('התוצאה זהה גם כששעון השרת UTC', utcResult === '2026-08-11 11:00', utcResult)
}

chk('התפוגה תמיד קדימה בזמן', (() => {
  for (const [d, t] of [['2026-08-10','15:00'],['2026-08-13','17:00'],['2026-08-14','09:00'],['2026-08-10','23:30']]) {
    const c = at(d, t)
    if (computePendingExpiresAt(c).getTime() <= c.getTime()) return false
  }
  return true
})())

chk('המקרה הארוך ביותר (חמישי ערב) נשאר מתחת לתקרה', (() => {
  const c = at('2026-08-13', '17:00')
  return isSanePendingExpiry(computePendingExpiresAt(c), c)
})())
chk(`תקרת הביטחון היא ${PENDING_EXPIRY_MAX_HOURS} שעות`, PENDING_EXPIRY_MAX_HOURS === 72)
chk('תפוגה בעבר נדחית', !isSanePendingExpiry(new Date(Date.now() - 1000)))
chk('תפוגה מעבר לתקרה נדחית',
  !isSanePendingExpiry(new Date(Date.now() + 80 * 3600 * 1000)))

// ─── חילוץ IP ───────────────────────────────────────────────────────────────
section('חילוץ IP מהימן (lib/clientIp.ts)')

const { resolveClientIp, isValidIpAddress } = await import('../lib/clientIp.ts')
const H = (obj) => new Headers(obj)
const VERCEL = { VERCEL: '1' }
const LOCAL = {}

chk('Vercel: x-vercel-forwarded-for מתקבל', (() => {
  const r = resolveClientIp(H({ 'x-vercel-forwarded-for': '203.0.113.7' }), { env: VERCEL })
  return r.ok && r.ip === '203.0.113.7' && r.source === 'vercel'
})())

// 🔒 הבדיקה המרכזית: fail-closed
chk('🔒 Vercel בלי הכותרת המהימנה → נכשל (fail-closed)', (() => {
  const r = resolveClientIp(H({}), { env: VERCEL })
  return !r.ok && r.reason === 'trusted_header_missing'
})())

chk('🔒 Vercel: x-forwarded-for לבדו אינו מספיק', (() => {
  const r = resolveClientIp(H({ 'x-forwarded-for': '9.9.9.9' }), { env: VERCEL })
  return !r.ok
})())

chk('🔒 Vercel: x-real-ip לבדו אינו מספיק', (() => {
  const r = resolveClientIp(H({ 'x-real-ip': '9.9.9.9' }), { env: VERCEL })
  return !r.ok
})())

chk('Vercel: ערך לא תקין נדחה ולא מועבר ל-inet', (() => {
  const r = resolveClientIp(H({ 'x-vercel-forwarded-for': 'not-an-ip' }), { env: VERCEL })
  return !r.ok && r.reason === 'invalid_address'
})())

chk('מקומי: נפילה ל-x-forwarded-for מותרת', (() => {
  const r = resolveClientIp(H({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }), { env: LOCAL })
  return r.ok && r.ip === '198.51.100.4' && r.source === 'local_fallback'
})())

chk('מקומי: בלי שום כותרת → loopback', (() => {
  const r = resolveClientIp(H({}), { env: LOCAL })
  return r.ok && r.ip === '127.0.0.1'
})())

chk('פורט מוסר מ-IPv4', (() => {
  const r = resolveClientIp(H({ 'x-vercel-forwarded-for': '203.0.113.7:44321' }), { env: VERCEL })
  return r.ok && r.ip === '203.0.113.7'
})())

chk('IPv6 בסוגריים עם פורט', (() => {
  const r = resolveClientIp(H({ 'x-vercel-forwarded-for': '[2001:db8::1]:443' }), { env: VERCEL })
  return r.ok && r.ip === '2001:db8::1'
})())

chk('IPv6 חשוף אינו נחתך בטעות', (() => {
  const r = resolveClientIp(H({ 'x-vercel-forwarded-for': '2001:db8::1' }), { env: VERCEL })
  return r.ok && r.ip === '2001:db8::1'
})())

chk('ולידציה: כתובות תקינות', ['1.2.3.4', '255.255.255.255', '::1', '2001:db8::1', '::ffff:192.0.2.1'].every(isValidIpAddress))
chk('ולידציה: כתובות פסולות', !['256.1.1.1', '1.2.3', 'abc', '', '1.2.3.4.5', '2001:::1'].some(isValidIpAddress))

// ─── חלון ההכנה ─────────────────────────────────────────────────────────────
section('חלון ההכנה — 40 דקות')

const { MIN_LEAD_MINUTES, hasLeadTime } = await import('../lib/bookingWindow.ts')
chk('MIN_LEAD_MINUTES = 40', MIN_LEAD_MINUTES === 40)

{
  // "עכשיו" = 2026-08-10 12:00 בישראל
  const now = at('2026-08-10', '12:00')
  const ymd = [2026, 7, 10]
  chk('40 דק׳ מעכשיו (12:40) — זמין', hasLeadTime(...ymd, '12:40', now))
  chk('41 דק׳ מעכשיו (12:41) — זמין', hasLeadTime(...ymd, '12:41', now))
  chk('39 דק׳ מעכשיו (12:39) — חסום', !hasLeadTime(...ymd, '12:39', now))
  chk('20 דק׳ מעכשיו — חסום', !hasLeadTime(...ymd, '12:20', now))
  chk('מחר — חלון ההכנה אינו חל', hasLeadTime(2026, 7, 11, '09:00', now))
}

// 🔒 מקור אמת יחיד: אותו קבוע גם באלגוריתם ההצגה
{
  const src = await import('node:fs').then(m =>
    m.readFileSync(new URL('../lib/slotSelection.ts', import.meta.url), 'utf8'))
  // השורה שקובעת את חלון ההכנה חייבת להישען על הקבוע המשותף, ולא על מספר
  // מקומי. זה מה שמונע את הבאג שהתגלה ב-15A (90 בשני קבצים שהתבדרו).
  const leadLine = src.split('\n').find(l => l.includes('const minStartMin'))
  chk('🔒 slotSelection נשען על MIN_LEAD_MINUTES ולא על מספר קשיח',
    !!leadLine && leadLine.includes('MIN_LEAD_MINUTES') && !/\d{2}\s*:\s*0\b.*\+\s*\d/.test(leadLine),
    leadLine?.trim() ?? 'לא נמצאה השורה')
}

// ─── נוסח בקשת התור ─────────────────────────────────────────────────────────
section('נוסח בקשת התור (snapshot)')

const { buildBookingRequestMessage } = await import('../lib/whatsappTemplates.ts')

// ⚠️ snapshot של הנוסח. כל סטייה — כולל רווח או אמוג'י — היא שינוי בנוסח
// שהלקוחות שולחות בפועל.
//
// ⚠️ שורת "אישרה את מדיניות התורים" הוסרה במכוון: האישור הוא תנאי חוסם
// לשליחה, ולכן שורה שמצהירה עליו תמיד נכונה ואינה מוסיפה מידע.
// policy_version ממשיך להישמר על שורת התור ב-DB.
const EXPECTED = [
  'היי שובל 🤍',
  '',
  'בקשת תור חדשה 🌸',
  '',
  '👤 דנה כהן',
  '📞 054-123-4567',
  '',
  '💆 עיצוב גבות טבעי + שעווה לכל הפנים',
  '💰 סה"כ ₪110',
  '📅 24 אוגוסט 2026',
  '⏰ 17:00',
  '',
  '📝 רגישות בעור',
].join('\n')

const actual = buildBookingRequestMessage({
  customerName: 'דנה כהן',
  phone: '054-123-4567',
  treatment: 'עיצוב גבות טבעי + שעווה לכל הפנים',
  priceTotal: 110,
  priceIsSum: true,
  dateLabel: '24 אוגוסט 2026',
  timeLabel: '17:00',
  notes: 'רגישות בעור',
})
chk('הנוסח זהה ל-snapshot תו-בתו', actual === EXPECTED)
if (actual !== EXPECTED) {
  console.log('--- צפוי ---\n' + EXPECTED + '\n--- בפועל ---\n' + actual)
}

chk('🔒 אין שורת אישור מדיניות בשום וריאציה', (() => {
  const variants = [
    { customerName: 'א', phone: '05', treatment: 'ט' },
    { customerName: 'א', phone: '05', treatment: 'ט', notes: 'הערה', priceTotal: 70 },
    { customerName: 'א', phone: '05', treatment: 'ט', durationLabel: '40 דקות',
      dateLabel: 'ד', timeLabel: '17:00' },
  ]
  return variants.every(v => {
    const m = buildBookingRequestMessage(v)
    return !m.includes('מדיניות') && !m.includes('✅')
  })
})())

chk('ההודעה אינה מסתיימת בשורה ריקה', (() => {
  const withNotes = buildBookingRequestMessage({
    customerName: 'א', phone: '05', treatment: 'ט', notes: 'הערה' })
  const without = buildBookingRequestMessage({
    customerName: 'א', phone: '05', treatment: 'ט', timeLabel: '17:00' })
  return !/\n$/.test(withNotes) && !/\n$/.test(without)
    && withNotes.endsWith('📝 הערה') && without.endsWith('⏰ 17:00')
})())

chk('הרמת גבות: שורת משך מתווספת',
  buildBookingRequestMessage({
    customerName: 'א', phone: '0541234567', treatment: 'הרמת גבות',
    priceTotal: 250, durationLabel: '40 דקות', dateLabel: 'ד', timeLabel: '17:00–17:40',
  }).includes('⏱️ 40 דקות'))

chk('בלי מחיר — שורת המחיר מושמטת',
  !buildBookingRequestMessage({
    customerName: 'א', phone: '0541234567', treatment: 'ט', priceTotal: 0,
  }).includes('💰'))

chk('בלי הערות — שורת ההערות מושמטת',
  !buildBookingRequestMessage({
    customerName: 'א', phone: '0541234567', treatment: 'ט', notes: '   ',
  }).includes('📝'))

// ─── קבועי מגבלת הקצב ───────────────────────────────────────────────────────
section('מגבלת קצב — התאמה בין TS ל-SQL')

const { PUBLIC_BOOKING_MAX_PER_IP_PER_HOUR } = await import('../lib/bookingRateLimit.ts')
chk('המגבלה היא 5 לשעה', PUBLIC_BOOKING_MAX_PER_IP_PER_HOUR === 5)

{
  const sql = await import('node:fs').then(m =>
    m.readFileSync(new URL('../supabase/migrations/0018_public_booking_rpcs.sql', import.meta.url), 'utf8'))
  // 🔒 התקרה הקשיחה ב-SQL חייבת להיות זהה לקבוע ב-TS. אותו חוזה
  // שקיים בין lib/otp.ts ל-issue_otp_atomic.
  const m = sql.match(/least\(coalesce\(p_max_per_ip_per_hour,\s*(\d+)\),\s*(\d+)\)/)
  chk('🔒 התקרה הקשיחה ב-0018 תואמת לקבוע ב-TS',
    !!m && Number(m[1]) === PUBLIC_BOOKING_MAX_PER_IP_PER_HOUR
        && Number(m[2]) === PUBLIC_BOOKING_MAX_PER_IP_PER_HOUR,
    m ? `SQL=${m[2]}` : 'לא נמצאה תקרה')
}

// ─── סיכום ──────────────────────────────────────────────────────────────────
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} עברו`)
process.exit(passed === results.length ? 0 : 1)
