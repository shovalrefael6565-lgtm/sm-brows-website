/**
 * בדיקות ללוגיקה הטהורה של האזור האישי — נירמול טלפון, מדיניות שינוי/ביטול,
 * וקודי אימות והגבלת קצב. לא נדרש בסיס נתונים ולא ספק SMS.
 *
 * הרצה:
 *   npx tsx --conditions=react-server scripts/test-account-core.mjs
 *
 * (הדגל --conditions=react-server נדרש כדי ש-'server-only' ייפתר לגרסה הריקה
 *  שלו מחוץ ל-Next.js. בלעדיו הייבוא של lib/otp.ts ייכשל בכוונה.)
 */

process.env.OTP_PEPPER ??= 'test-pepper'

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(46)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`)
}

// ─── נירמול טלפון ───────────────────────────────────────────────────────────
section('נירמול טלפון (lib/phone.ts)')
const { normalizePhone, formatPhoneForDisplay, maskPhone } = await import('../lib/phone.ts')

const phoneCases = [
  ['0541234567', '+972541234567'],
  ['054-123-4567', '+972541234567'],
  ['054 123 4567', '+972541234567'],
  ['+972541234567', '+972541234567'],
  ['972541234567', '+972541234567'],
  ['00972541234567', '+972541234567'],
  ['+972-54-123-4567', '+972541234567'],
  ['9720541234567', '+972541234567'],
  ['541234567', '+972541234567'],
  ['0501234567', '+972501234567'],
  ['08-1234567', null],   // קו נייח — נדחה
  ['021234567', null],
  ['05412345', null],     // קצר מדי
  ['05412345678', null],  // ארוך מדי
  ['', null],
  ['abc', null],
  ['+15551234567', null], // לא ישראלי
]
for (const [input, expected] of phoneCases) {
  const got = normalizePhone(input)
  chk(`${JSON.stringify(input)} → ${expected}`, got === expected, got === expected ? '' : ` got ${got}`)
}
chk('כל הפורמטים מתכנסים לחשבון אחד',
  new Set(['0541234567', '+972541234567', '972541234567'].map(normalizePhone)).size === 1)
chk('תצוגה ומיסוך', formatPhoneForDisplay('+972541234567') === '054-123-4567'
  && maskPhone('+972541234567') === '054-***-4567')

// ─── מדיניות שינוי וביטול ──────────────────────────────────────────────────
section('מדיניות שינוי וביטול (lib/appointmentPolicy.ts)')
const { canCancel, canReschedule, DEFAULT_POLICY } = await import('../lib/appointmentPolicy.ts')

const now = new Date('2026-08-04T10:00:00Z')
const at = h => new Date(now.getTime() + h * 3_600_000)
const appt = (o = {}) => ({ startsAt: at(48), status: 'confirmed', rescheduleCount: 0, hasDeposit: false, ...o })
const p = DEFAULT_POLICY

chk('ביטול 48 ש\' מראש — מותר', canCancel(appt(), p, now).allowed)
chk('ביטול 25 ש\' מראש — מותר', canCancel(appt({ startsAt: at(25) }), p, now).allowed)
chk('ביטול 23 ש\' מראש — חסום', canCancel(appt({ startsAt: at(23) }), p, now).reason === 'too_late')
chk('ביטול תור שעבר — חסום', canCancel(appt({ startsAt: at(-1) }), p, now).reason === 'in_past')
chk('ביטול תור מבוטל — חסום', canCancel(appt({ status: 'cancelled_by_customer' }), p, now).reason === 'not_active')
chk('ביטול תור עם מקדמה — חסום', canCancel(appt({ hasDeposit: true }), p, now).reason === 'deposit_locked')
chk('הזזה 48 ש\' מראש — מותר', canReschedule(appt(), p, now).allowed)
chk('הזזה 23 ש\' מראש — חסום', canReschedule(appt({ startsAt: at(23) }), p, now).reason === 'too_late')
chk('הזזה אחרי 2 הזזות — חסום', canReschedule(appt({ rescheduleCount: 2 }), p, now).reason === 'max_reschedules')
chk('הזזת תור עם מקדמה 72 ש\' — מותר', canReschedule(appt({ hasDeposit: true, startsAt: at(72) }), p, now).allowed)
chk('הזזת תור עם מקדמה 30 ש\' — חסום', canReschedule(appt({ hasDeposit: true, startsAt: at(30) }), p, now).reason === 'too_late')
chk('הזזת תור "לא הגיעה" — חסום', canReschedule(appt({ status: 'no_show' }), p, now).reason === 'not_active')

// ─── OTP והגבלת קצב ────────────────────────────────────────────────────────
section('קודי אימות והגבלת קצב (lib/otp.ts)')
const { generateOtpCode, hashOtpCode, verifyOtpHash, checkOtpRateLimit } = await import('../lib/otp.ts')

const code = generateOtpCode()
const phone = '+972541234567'
const hash = hashOtpCode(code, phone)

chk('הקוד הוא 6 ספרות', /^\d{6}$/.test(code))
chk('הקודים אקראיים (500 הגרלות)',
  new Set(Array.from({ length: 500 }, generateOtpCode)).size > 400)
chk('הקוד עצמו לא נשמר', !hash.includes(code))
chk('אימות קוד נכון', verifyOtpHash(hash, code, phone))
chk('קוד שגוי נדחה', !verifyOtpHash(hash, code === '000000' ? '111111' : '000000', phone))
chk('אותו קוד למספר אחר נדחה', !verifyOtpHash(hash, code, '+972549999999'))

const ago = s => new Date(now.getTime() - s * 1000)
chk('בקשה ראשונה — מותרת',
  checkOtpRateLimit({ recentForPhone: [], countForIpLastHour: 0 }, now).allowed)
chk('בקשה חוזרת אחרי 10 ש\' — חסומה',
  checkOtpRateLimit({ recentForPhone: [ago(10)], countForIpLastHour: 0 }, now).reason === 'cooldown')
chk('בקשה חוזרת אחרי 61 ש\' — מותרת',
  checkOtpRateLimit({ recentForPhone: [ago(61)], countForIpLastHour: 0 }, now).allowed)
chk('5 קודים בשעה — חסום',
  checkOtpRateLimit({ recentForPhone: [ago(120), ago(300), ago(600), ago(900), ago(1200)], countForIpLastHour: 0 }, now).reason === 'hourly_limit')
chk('10 קודים ביום — חסום',
  checkOtpRateLimit({ recentForPhone: Array.from({ length: 10 }, (_, i) => ago(3700 + i * 3600)), countForIpLastHour: 0 }, now).reason === 'daily_limit')
chk('15 בקשות מאותו IP — חסום',
  checkOtpRateLimit({ recentForPhone: [], countForIpLastHour: 15 }, now).reason === 'ip_limit')

// ─── סיכום ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${'═'.repeat(60)}`)
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} בדיקות נכשלו`)
process.exit(failed === 0 ? 0 : 1)
