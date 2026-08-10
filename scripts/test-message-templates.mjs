/**
 * בדיקות שלב 15F — נוסחי ההתראות.
 *
 * ⚠️ **הקובץ הזה נכתב לפני החיווט, בכוונה.** מגבלת ה-70 תווים אינה עניין
 * של סגנון: 71 תווים בעברית = שני מקטעי SMS = פי שניים בעלות על כל אירוע
 * של כל לקוחה. נוסח שחוצה את הגבול חייב להיכשל בבנייה, לא בפרודקשן.
 *
 * המיקוד:
 *   1. כל נוסח מאושר ≤70 יחידות UCS-2, ואפס אמוג'י.
 *   2. הנוסחים תואמים תו-בתו למה שאושר ונמדד ב-2026-08-10 (snapshot).
 *   3. ה-SMS אינו נושא PII — אין placeholders ואין נתוני לקוחה.
 *   4. נוסחי התזכורות קיימים אבל **אינם מחווטים** למסלול הטרנזקציוני.
 *   5. חמש התבניות המתות ב-lib/sms/templates.ts נמחקו ולא חזרו.
 *
 * ⚠️ הקובץ אינו פותח חיבור, אינו ניגש ל-DB ואינו קורא credentials.
 *
 * הרצה:  npm run test:message-templates
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(HERE, '..', p), 'utf8')

const {
  SMS_MAX_CHARS,
  SMS_TEXT,
  REMINDER_SMS_V2_UNWIRED,
  smsBodyFor,
  smsLength,
  hasEmoji,
} = await import('../lib/messageTemplates.ts')

// ─── 1. המגבלה ──────────────────────────────────────────────────────────────
section('מגבלת המקטע היחיד')

chk('המגבלה היא 70 תווים', SMS_MAX_CHARS === 70, `בפועל ${SMS_MAX_CHARS}`)

/** כל הנוסחים בקובץ, כולל אלה של התזכורות. */
const allTexts = []
for (const [event, byRole] of Object.entries(SMS_TEXT)) {
  for (const [role, body] of Object.entries(byRole)) allTexts.push([`${event}/${role}`, body])
}
for (const [kind, body] of Object.entries(REMINDER_SMS_V2_UNWIRED)) {
  allTexts.push([`reminder/${kind}`, body])
}

chk('11 נוסחים בסך הכול', allTexts.length === 11, `נמצאו ${allTexts.length}`)

for (const [label, body] of allTexts) {
  const len = smsLength(body)
  chk(`${label} ≤ 70`, len <= SMS_MAX_CHARS, `${len} תווים`)
}

chk("🔒 אפס אמוג'י בכל הנוסחים", allTexts.every(([, b]) => !hasEmoji(b)),
  allTexts.filter(([, b]) => hasEmoji(b)).map(([l]) => l).join(', '))

/**
 * ⚠️ הספירה היא של יחידות UCS-2 ולא של נקודות קוד. אמוג'י אחד הוא surrogate
 * pair — שתי יחידות — ו-[...s].length היה מדווח 1 ומחמיץ בדיוק את המקרה
 * שהמגבלה קיימת בשבילו.
 */
chk('🔒 smsLength סופר יחידות UCS-2 ולא נקודות קוד',
  smsLength('❤️') > [...'❤️'].length - 1 && smsLength('א❤️') === 3,
  `smsLength('א❤️')=${smsLength('א❤️')}`)

/**
 * ⚠️ **הרשימה הזו תפסה באג אמיתי.** המימוש הראשון בדק `[\uD800-\uDFFF]`,
 * כלומר surrogate pairs בלבד — והתחמקו ממנו ❤️ (‏BMP + variation selector),
 * ✅ (‏BMP בודד) ו-🇮🇱 (‏regional indicators). ❤️ הוא בדיוק האמוג'י שבנוסח
 * ה-WhatsApp המאושר, ולכן המועמד הסביר ביותר להידבק בהעתקה לנוסח SMS.
 */
for (const e of ['❤️', '🌸', '✅', '⚠️', '😀', '🇮🇱', '💆‍♀️']) {
  chk(`hasEmoji תופס ${e}`, hasEmoji(`תורך אושר ${e}`))
}
chk('hasEmoji אינו מסמן טקסט עברי נקי',
  !hasEmoji('בקשת שינוי המועד לא אושרה. לפרטים: https://smbrows.co.il/account')
  && !hasEmoji('תור בוטל ע"י לקוחה. לניהול: https://smbrows.co.il/admin'))

// ─── 2. snapshot של הנוסחים ─────────────────────────────────────────────────
section('הנוסחים המאושרים (snapshot)')

/**
 * ⚠️ snapshot תו-בתו של מה שאושר ונמדד ב-2026-08-10. כל סטייה — כולל נקודה
 * או רווח — היא שינוי בנוסח שיישלח ללקוחות, ולכן היא נכשלת כאן ולא עוברת
 * בשקט. המספר בסוגריים הוא האורך שנמדד באישור.
 */
const EXPECTED = {
  'booking_requested/admin':    ['בקשת תור חדשה. לניהול: https://smbrows.co.il/admin', 50],
  'reschedule_requested/admin': ['בקשת שינוי מועד. לניהול: https://smbrows.co.il/admin', 52],
  'booking_cancelled/admin':    ['תור בוטל ע"י לקוחה. לניהול: https://smbrows.co.il/admin', 55],
  'booking_approved/customer':  ['תורך אושר. לפרטים: https://smbrows.co.il/account', 48],
  'booking_rejected/customer':  ['בקשת התור לא אושרה. לפרטים: https://smbrows.co.il/account', 57],
  'reschedule_approved/customer': ['שינוי המועד אושר. לפרטים: https://smbrows.co.il/account', 55],
  'reschedule_rejected/customer': ['בקשת שינוי המועד לא אושרה. לפרטים: https://smbrows.co.il/account', 64],
  'booking_cancelled/customer': ['תורך בוטל. לפרטים: https://smbrows.co.il/account', 48],
  'appointment_moved_by_business/customer':
    ['מועד התור שלך עודכן. לפרטים: https://smbrows.co.il/account', 58],
  'reminder/day_before':        ['תזכורת: התור שלך מחר. פרטים: https://smbrows.co.il/account', 58],
  'reminder/two_hours_before':  ['תזכורת: התור שלך היום. פרטים: https://smbrows.co.il/account', 59],
}

const actual = new Map(allTexts)
for (const [label, [text, expectedLen]] of Object.entries(EXPECTED)) {
  const got = actual.get(label)
  chk(`${label} זהה ל-snapshot`, got === text, got === text ? '' : `בפועל: ${got}`)
  chk(`${label} באורך שנמדד (${expectedLen})`, smsLength(text) === expectedLen,
    `בפועל ${smsLength(text)}`)
}

chk('🔒 אין נוסח שלא נמדד', allTexts.every(([l]) => l in EXPECTED),
  allTexts.filter(([l]) => !(l in EXPECTED)).map(([l]) => l).join(', '))

/**
 * ⚠️ המרווח הצפוף ביותר הוא 6 תווים. הבדיקה הזו אינה מיותרת מול בדיקת
 * ה-≤70: היא מתריעה כשמישהו מתקרב לגבול, בזמן שעוד אפשר לקצר במכוון
 * במקום לגלות את זה בתוספת המילה הבאה.
 */
const tightest = allTexts.reduce((a, b) => (smsLength(a[1]) >= smsLength(b[1]) ? a : b))
chk('הנוסח הצפוף ביותר הוא reschedule_rejected/customer',
  tightest[0] === 'reschedule_rejected/customer', `${tightest[0]} (${smsLength(tightest[1])})`)
chk('נשארו לפחות 6 תווים מרווח', SMS_MAX_CHARS - smsLength(tightest[1]) >= 6,
  `מרווח ${SMS_MAX_CHARS - smsLength(tightest[1])}`)

// ─── 3. אפס PII ─────────────────────────────────────────────────────────────
section('ה-SMS אינו נושא PII')

/**
 * 🔒 ההודעה מכילה עובדה אחת ולינק. אין בה שם, טיפול, תאריך, שעה, מחיר או
 * טלפון — SMS עובר ללא הצפנה ונשאר על מסך נעול.
 */
chk('🔒 אין placeholders בשום נוסח',
  allTexts.every(([, b]) => !/\$\{|\{[a-zA-Z]|%s|__/.test(b)),
  allTexts.filter(([, b]) => /\$\{|\{[a-zA-Z]|%s|__/.test(b)).map(([l]) => l).join(', '))

chk('🔒 אין ספרות מלבד אלה שב-URL', allTexts.every(([, b]) => {
  const withoutUrl = b.replace(/https:\/\/\S+/g, '')
  return !/\d/.test(withoutUrl)
}))

/** הנוסחים סטטיים — קריאה חוזרת מחזירה בדיוק את אותה מחרוזת. */
chk('🔒 הנוסחים סטטיים (אין תלות בשעון או במצב)',
  smsBodyFor('booking_approved', 'customer') === smsBodyFor('booking_approved', 'customer')
  && smsBodyFor('booking_approved', 'customer') === EXPECTED['booking_approved/customer'][0])

// ─── 4. המיפוי ──────────────────────────────────────────────────────────────
section('מיפוי (אירוע, נמען)')

chk('booking_cancelled הוא היחיד עם שני נמענים',
  Object.entries(SMS_TEXT).filter(([, r]) => Object.keys(r).length === 2)
    .every(([e]) => e === 'booking_cancelled')
  && Object.keys(SMS_TEXT.booking_cancelled).sort().join(',') === 'admin,customer')

chk('בקשות הולכות לאדמין, הכרעות ללקוחה',
  !!SMS_TEXT.booking_requested.admin && !SMS_TEXT.booking_requested.customer
  && !!SMS_TEXT.reschedule_requested.admin && !SMS_TEXT.reschedule_requested.customer
  && !!SMS_TEXT.booking_approved.customer && !SMS_TEXT.booking_approved.admin
  && !!SMS_TEXT.booking_rejected.customer && !SMS_TEXT.booking_rejected.admin
  && !!SMS_TEXT.reschedule_approved.customer && !SMS_TEXT.reschedule_approved.admin
  && !!SMS_TEXT.reschedule_rejected.customer && !SMS_TEXT.reschedule_rejected.admin)

/**
 * ⚠️ זוג שאין לו נוסח מחזיר null ואינו זורק ואינו ממציא תחליף. התשובה
 * הנכונה להתראה בלי נוסח היא כישלון בקול, לא הודעה שאיש לא אישר.
 */
chk('🔒 זוג ללא נוסח מחזיר null ולא נוסח חלופי',
  smsBodyFor('booking_approved', 'admin') === null
  && smsBodyFor('booking_requested', 'customer') === null)

// ─── 5. התזכורות אינן מחווטות ───────────────────────────────────────────────
section('תזכורות — 15G, לא מחווטות')

chk('🔒 day_before/two_hours_before אינם ב-SMS_TEXT',
  !('day_before' in SMS_TEXT) && !('two_hours_before' in SMS_TEXT))

/**
 * 🔒 גרירה ביומן — הנוסח אושר ב-15F ואינו ממתין עוד.
 *
 * ⚠️ הבדיקה החשובה עליו אינה כאן אלא ב-test-notifications-db: הוא האירוע
 * היחיד שיכול לחזור על אותו תור, ולכן מפתח ה-idempotency הוא
 * source_history_id ולא (תור, אירוע, נמען).
 */
chk('appointment_moved_by_business נושא נוסח מאושר',
  smsBodyFor('appointment_moved_by_business', 'customer')
  === 'מועד התור שלך עודכן. לפרטים: https://smbrows.co.il/account')
chk('🔒 ולשובל אין נוסח — היא זו שגררה',
  smsBodyFor('appointment_moved_by_business', 'admin') === null)

chk('🔒 smsBodyFor אינו יודע להחזיר נוסח תזכורת',
  smsBodyFor('day_before', 'customer') === null
  && smsBodyFor('two_hours_before', 'customer') === null)

/** ⚠️ לתזכורת יש חלון ולא רגע — ולכן "מחר"/"היום" ולא שעה מדויקת. */
chk('נוסחי התזכורות מדברים בחלון ולא בשעה',
  /מחר/.test(REMINDER_SMS_V2_UNWIRED.day_before)
  && /היום/.test(REMINDER_SMS_V2_UNWIRED.two_hours_before)
  && !/\d{1,2}:\d{2}/.test(REMINDER_SMS_V2_UNWIRED.day_before)
  && !/\d{1,2}:\d{2}/.test(REMINDER_SMS_V2_UNWIRED.two_hours_before))

// ─── 6. חמש התבניות המתות ───────────────────────────────────────────────────
section('ניקוי lib/sms/templates.ts')

/**
 * ⚠️ הערות מוסרות לפני הסריקה. בלי זה תיעוד שמסביר *למה* תבנית נמחקה
 * נספר כאילו התבנית עדיין שם — ובדיקה שנופלת על התיעוד של עצמה היא בדיוק
 * הבדיקה שמישהו מוחק במקום לתקן.
 */
const stripComments = code => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const smsTemplatesSrc = stripComments(src('lib/sms/templates.ts'))
const DEAD = [
  'bookingConfirmedMessage',
  'bookingRescheduledMessage',
  'bookingCancelledMessage',
  'reminderMessage',
  'adminNoticeMessage',
]
for (const fn of DEAD) {
  chk(`🔒 ${fn} נמחקה`, !new RegExp(`export function ${fn}\\b`).test(smsTemplatesSrc))
}

chk('otpMessage נשארה — היא היחידה המחוברת',
  /export function otpMessage\b/.test(smsTemplatesSrc))

/**
 * ⚠️ reminderMessage שנמחקה כתבה "מחר" בהודעה שנשלחת מתי שהיא — בדיוק מה
 * ש-lib/reminders/templates.ts אוסר. הבדיקה מוודאת שהמילה לא חזרה לקובץ
 * שאין לה בו מקום.
 */
chk('🔒 אין "מחר" ב-lib/sms/templates.ts', !/מחר/.test(smsTemplatesSrc))

// ─── סיכום ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✓' : '✗'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
