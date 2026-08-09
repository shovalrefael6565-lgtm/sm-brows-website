/**
 * בדיקות ללוגיקה הטהורה של האזור האישי — נירמול טלפון, מדיניות שינוי/ביטול,
 * וקודי אימות והגבלת קצב. לא נדרש בסיס נתונים ולא ספק SMS.
 *
 * הרצה:  npm run test:account-core
 *
 * ⚠️ אין להריץ עם `node` ישירות. הסקריפט חייב לרוץ תחת tsx ועם הדגל
 * --conditions=react-server (שניהם מקובעים ב-package.json):
 *   • tsx — כי הייבוא עובר דרך קבצי .ts שמייבאים זה את זה בלי סיומת
 *     (סגנון bundler, כמו ב-tsconfig), ו-node לא יודע לפתור אותם.
 *   • --conditions=react-server — כדי ש-'server-only' ייפתר לגרסה הריקה
 *     שלו מחוץ ל-Next.js. בלעדיו הייבוא של lib/otp.ts ייכשל *בכוונה*
 *     עם "This module cannot be imported from a Client Component module",
 *     וזו התנהגות תקינה של החבילה — לא באג בקוד.
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
const { canCancel, canRequestReschedule, DEFAULT_POLICY } = await import('../lib/appointmentPolicy.ts')

const now = new Date('2026-08-04T10:00:00Z')
const at = h => new Date(now.getTime() + h * 3_600_000)
const appt = (o = {}) => ({ startsAt: at(48), status: 'confirmed', rescheduleCount: 0, ...o })
const p = DEFAULT_POLICY

// 🔒 15E — ברירת המחדל היא 6 שעות, ותואמת ל-business_settings בפרודקשן.
chk('ברירת המחדל לביטול היא 6 שעות', p.cancelCutoffHours === 6, `=${p.cancelCutoffHours}`)
chk('ברירת המחדל לשינוי מועד היא 6 שעות', p.rescheduleCutoffHours === 6, `=${p.rescheduleCutoffHours}`)

chk('ביטול 48 ש\' מראש — מותר', canCancel(appt(), p, now).allowed)
chk('ביטול 7 ש\' מראש — מותר', canCancel(appt({ startsAt: at(7) }), p, now).allowed)
chk('ביטול 5 ש\' מראש — חסום', canCancel(appt({ startsAt: at(5) }), p, now).reason === 'too_late')
chk('ביטול תור שעבר — חסום', canCancel(appt({ startsAt: at(-1) }), p, now).reason === 'in_past')
chk('ביטול תור מבוטל — חסום', canCancel(appt({ status: 'cancelled_by_customer' }), p, now).reason === 'not_active')

// 🔒 15E — מקדמה **אינה** יוצרת מסלול נפרד יותר. תור עם מקדמה נשפט
// בדיוק באותם 6 שעות, וההעברה של hasDeposit אינה משנה דבר.
chk('ביטול תור עם מקדמה 7 ש\' — מותר (אין deposit_locked)',
  canCancel(appt({ hasDeposit: true, startsAt: at(7) }), p, now).allowed)
chk('שינוי מועד לתור עם מקדמה 7 ש\' — מותר',
  canRequestReschedule(appt({ hasDeposit: true, startsAt: at(7) }), p, now).allowed)
chk('שינוי מועד לתור עם מקדמה 30 ש\' — מותר (48 בוטל)',
  canRequestReschedule(appt({ hasDeposit: true, startsAt: at(30) }), p, now).allowed)

chk('בקשת שינוי 48 ש\' מראש — מותר', canRequestReschedule(appt(), p, now).allowed)
chk('בקשת שינוי 7 ש\' מראש — מותר', canRequestReschedule(appt({ startsAt: at(7) }), p, now).allowed)
chk('בקשת שינוי 5 ש\' מראש — חסום',
  canRequestReschedule(appt({ startsAt: at(5) }), p, now).reason === 'too_late')
chk('בקשת שינוי אחרי 2 הזזות — חסום',
  canRequestReschedule(appt({ rescheduleCount: 2 }), p, now).reason === 'max_reschedules')
chk('בקשת שינוי לתור "לא הגיעה" — חסום',
  canRequestReschedule(appt({ status: 'no_show' }), p, now).reason === 'not_active')
// ⚠️ 15E: רק תור confirmed ניתן להזזה — בקשה שממתינה לאישור אינה "תור".
chk('בקשת שינוי לתור pending — חסום',
  canRequestReschedule(appt({ status: 'pending' }), p, now).reason === 'not_active')

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
