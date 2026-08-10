/**
 * בדיקות שלב 15F — נוסחי ה-WhatsApp.
 *
 * המיקוד:
 *
 *   1. 🔒 **נוסח אישור התור זהה למאושר, תו-בתו.** הוא נמסר ואושר; אין
 *      לנסח אותו מחדש.
 *   2. 🔒 **כלל ה-cutoff.** ב-DB שני מפתחות נפרדים ובנוסח מספר אחד. שווים
 *      ⟶ נוסח משותף; שונים ⟶ **חובה להציג בנפרד**. לעולם לא מספר שגוי.
 *   3. 🔒 **בקשת התור לא זזה** מלבד הסרת שורת המשך (ראה
 *      test-public-booking-core).
 *   4. 🔒 **הודעת האישור אינה פונה ללקוחה בשמה** — בחירה מפורשת.
 *
 * הרצה:  npm run test:whatsapp-templates
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(64)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(HERE, '..', p), 'utf8')
const stripComments = code => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const {
  buildApprovalMessage,
  buildLateChangeMessage,
  buildRejectionMessage,
  buildRescheduleApprovedMessage,
  buildRescheduleRejectedMessage,
  buildWhatsAppLinkToBusiness,
  cutoffPolicyLines,
  rescheduleCutoffLines,
  STUDIO_DETAILS,
} = await import('../lib/whatsappTemplates.ts')

/**
 * 🔒 **קוד בדיקה, לא הקוד האמיתי.**
 *
 * ⚠️ הקוד האמיתי חי ב-`business_settings` (0024) ואינו נכנס ל-git — גם
 * לא דרך קובץ בדיקות. ה-snapshot בודק את **המבנה** של ההודעה, ולשם כך כל
 * קוד משמש באותה מידה.
 */
const CODE = '#0000'

// ════════════════════════════════════════════════════════════════════════════
section('1. נוסח אישור התור (snapshot מאושר)')

/**
 * ⚠️ snapshot תו-בתו של הנוסח שנמסר ואושר ב-2026-08-09
 * (.handoff/STAGE-15F-APPROVED-TEMPLATES.md). כל סטייה — כולל אמוג'י או
 * רווח — היא ניסוח מחדש של נוסח מאושר, ולכן נכשלת כאן.
 */
const APPROVED = [
  'נקבע לך תור ל־עיצוב גבות טבעי ❤️',
  '',
  '📅 תאריך: 24 אוגוסט 2026',
  '🕒 שעה: 17:00',
  '',
  '📍 כתובת: הכורמים 14, קומה 4, דירה 16',
  '(הבניין על הכיכר)',
  `🔑 קוד כניסה לבניין: ${CODE}`,
  '',
  '💆‍♀️ הטיפול שלך:',
  'עיצוב גבות טבעי',
  '₪110',
  '',
  '💳 אמצעי תשלום: מזומן / Bit / PayBox',
  'Bit / PayBox: 054-7261564',
  '',
  '🔄 לשינוי או ביטול התור:',
  'עד 6 שעות לפני התור ניתן לבצע שינוי או ביטול דרך האזור האישי באתר.',
  'פחות מ־6 שעות לפני התור יש לפנות אלינו בוואטסאפ.',
  '',
  'ניפגש ❤️',
].join('\n')

const actual = buildApprovalMessage({
  date: '24 אוגוסט 2026',
  time: '17:00',
  treatment: 'עיצוב גבות טבעי',
  priceLine: '₪110',
  buildingCode: CODE,
  cutoffLines: cutoffPolicyLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 }),
})
chk('🔒 הנוסח זהה למאושר תו-בתו', actual === APPROVED)
if (actual !== APPROVED) {
  console.log('--- צפוי ---\n' + APPROVED + '\n--- בפועל ---\n' + actual)
}

/**
 * ⚠️ הנוסח המאושר פותח ב"נקבע לך תור" ואינו פונה ללקוחה בשמה. זו בחירה
 * מפורשת ולא השמטה — הנוסח הזמני הקודם פתח ב"היי {שם} 🌸".
 */
chk('🔒 אין פנייה בשם הלקוחה', !/היי /.test(actual))
chk('🔒 והשדה customerName אינו משפיע על הפלט', buildApprovalMessage({
  customerName: 'דנה כהן', date: '24 אוגוסט 2026', time: '17:00',
  treatment: 'עיצוב גבות טבעי', priceLine: '₪110', buildingCode: CODE,
  cutoffLines: cutoffPolicyLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 }),
}) === APPROVED)

chk('שם הטיפול מופיע פעמיים (בכוונה)',
  actual.split('עיצוב גבות טבעי').length - 1 === 2)

chk('בלי מחיר — השורה מושמטת ולא מוצג ₪0', !buildApprovalMessage({
  date: 'ד', time: '17:00', treatment: 'ט', buildingCode: CODE,
  cutoffLines: cutoffPolicyLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 }),
}).includes('₪'))

// ════════════════════════════════════════════════════════════════════════════
section('2. 🔒 כלל ה-cutoff')

{
  const same = cutoffPolicyLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 })
  chk('ערכים שווים → הנוסח המשותף המאושר',
    same.length === 2 && same[0].includes('שינוי או ביטול')
    && same.every(l => !/\b12\b/.test(l)))
}

{
  /**
   * 🔒 **הבדיקה שמונעת שקר ללקוחה.**
   *
   * ⚠️ שני מפתחות נפרדים ב-DB. אילו הנוסח היה לוקח "את הראשון", לקוחה
   * הייתה מקבלת הבטחה לחלון של 6 שעות בזמן שהמערכת אוכפת 12 — והייתה
   * נתקלת בחומה אחרי שהובטח לה אחרת. זהו דפוס "90 מול 40 דקות"
   * מ-Risks של 15A, ו-24/12 שנתפס ב-15E.
   */
  const diff = cutoffPolicyLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 12 })
  chk('🔒 ערכים שונים → שני המספרים מוצגים בנפרד',
    diff.some(l => l.includes('12') && l.includes('לשנות'))
    && diff.some(l => l.includes('6') && l.includes('לבטל')),
    diff.join(' | '))
  chk('🔒 אין מיזוג לשורה אחת ואין "לוקחים את הראשון"',
    !diff.some(l => /שינוי או ביטול/.test(l)))

  const msg = buildApprovalMessage({
    date: 'ד', time: '17:00', treatment: 'ט', buildingCode: CODE, cutoffLines: diff,
  })
  chk('🔒 ההודעה המלאה נושאת את שני המספרים',
    msg.includes('12') && msg.includes('6'))
}

{
  // ⚠️ כל ערך שנקרא מה-DB חייב להופיע כפי שהוא — לא מעוגל ולא מוחלף.
  const odd = cutoffPolicyLines({ cancelCutoffHours: 48, rescheduleCutoffHours: 48 })
  chk('ערך שאינו 6 מוצג כפי שהוא', odd.every(l => l.includes('48')), odd.join(' | '))
}

// ════════════════════════════════════════════════════════════════════════════
section('3. פרטי הסטודיו — נקודה אחת')

chk('הפרטים הציבוריים מרוכזים בקבוע אחד',
  STUDIO_DETAILS.address.includes('הכורמים 14')
  && STUDIO_DETAILS.paymentPhone === '054-7261564')

/**
 * 🔒 **קוד הכניסה אינו בקוד המקור.**
 *
 * ⚠️ הקוד נמסר לכל לקוחה בהודעת האישור ואינו סוד מבצעי, אבל מחרוזת
 * שנכנסת ל-git נשארת שם **לתמיד** — גם אחרי שהקוד בבניין יוחלף, וגם בכל
 * fork, clone או גיבוי. הוא מגיע מ-business_settings (0024) כפרמטר.
 */
chk('🔒 buildingCode אינו שדה של STUDIO_DETAILS',
  !('buildingCode' in STUDIO_DETAILS))

/**
 * ⚠️ הבדיקה מוודאת שהפרטים אינם משוכפלים בתוך גוף הנוסח. עדכון כתובת או
 * קוד כניסה חייב להיות שינוי בנקודה אחת.
 */
{
  const clean = stripComments(src('lib/whatsappTemplates.ts'))
  const body = clean.slice(clean.indexOf('export function buildApprovalMessage'))
  chk('🔒 אין כתובת/תשלום קשיחים בתוך buildApprovalMessage',
    !body.includes('הכורמים') && !body.includes('054-7261564'))
}

/**
 * 🔒 הבדיקה החשובה מכולן בסעיף הזה: **הקוד עצמו אינו מופיע בשום מקום
 * בקוד המקור.** לא בקבוע, לא בהערה, ולא בערך ברירת מחדל.
 */
for (const f of ['lib/whatsappTemplates.ts', 'lib/appointmentApproval.ts', 'lib/utils.ts']) {
  // ⚠️ קוד הכניסה הוא '#' ואחריו ספרות. הדפוס הזה אינו מופיע בקוד לשום
  // מטרה אחרת, ולכן הוא סימן מובהק לקוד שהודבק פנימה.
  chk(`🔒 ${f.split('/').pop()} אינו מכיל קוד כניסה קשיח`,
    !/#\d{3,6}/.test(src(f)))
}

// ════════════════════════════════════════════════════════════════════════════
section('4. prefill למסלול <cutoff')

{
  const cancel = buildLateChangeMessage({
    action: 'cancel', treatment: 'עיצוב גבות טבעי', whenLabel: 'ראשון, 24 אוגוסט בשעה 17:00',
  })
  chk('נוסח הביטול תקין דקדוקית ("לבטל את התור שלי")',
    cancel.includes('לבטל את התור שלי'), cancel.split('\n')[2])
  chk('כולל טיפול ומועד — שובל אינה צריכה לחפש',
    cancel.includes('עיצוב גבות טבעי') && cancel.includes('24 אוגוסט'))
  /**
   * ⚠️ אותה פתיחה בדיוק כמו buildBookingRequestMessage המאושר. זו הודעה
   * שהלקוחה שולחת, ולכן היא נשענת על התבנית הקיימת ואינה מנסחת מסר עסקי
   * חדש — בניגוד לנוסחים ששובל שולחת ללקוחה.
   */
  chk('נשען על תבנית בקשת התור המאושרת', cancel.startsWith('היי שובל 🤍'))

  const resched = buildLateChangeMessage({
    action: 'reschedule', treatment: 'ט', whenLabel: 'ד',
  })
  chk('נוסח שינוי המועד תקין דקדוקית',
    resched.includes('לשנות את המועד של התור שלי'), resched.split('\n')[2])
  chk('שני הנוסחים שונים זה מזה', cancel !== resched)
}

chk('הקישור מקודד את הטקסט לפרמטר text',
  buildWhatsAppLinkToBusiness('https://wa.me/972552932813', 'שלום עולם')
  === 'https://wa.me/972552932813?text=' + encodeURIComponent('שלום עולם'))

// ════════════════════════════════════════════════════════════════════════════
section('5. 🔒 שלושת המקומות אינם מפנים לחלון ריק')

for (const f of [
  'components/account/AppointmentActions.tsx',
  'components/account/RescheduleDialog.tsx',
  'components/account/CancelConfirmedDialog.tsx',
]) {
  const clean = stripComments(src(f))
  chk(`${f.split('/').pop()} — הקישור נושא טקסט מוכן`,
    /buildWhatsAppLinkToBusiness\(\s*WHATSAPP_BASE/.test(clean))
  /**
   * ⚠️ הבדיקה ההפוכה: `href={WHATSAPP_BASE}` חשוף פירושו חלון ריק,
   * והלקוחה נדרשת לנסח בעצמה ולציין על איזה תור מדובר.
   */
  chk(`${f.split('/').pop()} — 🔒 אין href ל-WHATSAPP_BASE חשוף`,
    !/href=\{WHATSAPP_BASE\}/.test(clean))
}

// ════════════════════════════════════════════════════════════════════════════
section('6. 🔒 מה שלא זז')

{
  const clean = stripComments(src('lib/whatsappTemplates.ts'))
  chk('buildBookingRequestMessage עדיין קיימת',
    /export function buildBookingRequestMessage/.test(clean))
  chk('buildWhatsAppLinkPlain (CRM, בלי טקסט) עדיין קיימת',
    /export function buildWhatsAppLinkPlain/.test(clean))
}

// ════════════════════════════════════════════════════════════════════════════
section('7. שלושת הנוסחים המאושרים (snapshot)')

/**
 * ⚠️ snapshot תו-בתו של שלושת הנוסחים שנמסרו ואושרו.
 *
 * 🔒 **כולל הרווחים ומיקום האמוג'י.** הנוסחים נכתבו ב-RTL, ולכן ❤️ מופיע
 * במקור לפני הטקסט ("❤️אפשר...") ומוצג בסופו. רווח מוביל או נגרר אינו
 * "לכלוך" שיש לנקות — הוא מה שאושר, וניקוי שלו הוא שינוי נוסח.
 */
{
  const REJECT = [
    'היי דנה 🌸',
    '',
    'לצערי לא ניתן לאשר את התור שביקשת ל־עיצוב גבות טבעי',
    'בתאריך 24 אוגוסט 2026 בשעה 17:00.',
    '',
    '❤️אפשר לבחור מועד אחר דרך האתר או לשלוח לנו הודעה בוואטסאפ ונשמח לעזור ',
  ].join('\n')

  const got = buildRejectionMessage({
    customerName: 'דנה', treatment: 'עיצוב גבות טבעי',
    date: '24 אוגוסט 2026', time: '17:00',
  })
  chk('🔒 דחיית בקשת תור — זהה למאושר תו-בתו', got === REJECT)
  if (got !== REJECT) console.log('--- צפוי ---\n' + REJECT + '\n--- בפועל ---\n' + got)
  chk('🔒 הרווח הנגרר בשורה האחרונה נשמר', got.endsWith('ונשמח לעזור '))
  chk('הנוסח פונה ללקוחה בשמה (בניגוד לנוסח האישור)', got.startsWith('היי דנה'))
}

{
  const RESCHED_OK = [
    ' ❤️שינוי המועד שלך אושר',
    '',
    '💆‍♀️ עיצוב גבות טבעי',
    '',
    '📅 תאריך חדש: 25 אוגוסט 2026',
    '🕒 שעה חדשה: 18:00',
    '',
    '📍 הכורמים 14, קומה 4, דירה 16',
    '(הבניין על הכיכר)',
    `🔑 קוד כניסה לבניין: ${CODE}`,
    '',
    'לשינוי או ביטול:',
    'עד 6 שעות לפני התור ניתן לבצע דרך האזור האישי באתר.',
    'פחות מכך יש לפנות אלינו בוואטסאפ.',
    '',
    ' ❤️ניפגש ',
  ].join('\n')

  const got = buildRescheduleApprovedMessage({
    treatment: 'עיצוב גבות טבעי', date: '25 אוגוסט 2026', time: '18:00',
    buildingCode: CODE,
    cutoffLines: rescheduleCutoffLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 }),
  })
  chk('🔒 אישור שינוי מועד — זהה למאושר תו-בתו', got === RESCHED_OK)
  if (got !== RESCHED_OK) console.log('--- צפוי ---\n' + RESCHED_OK + '\n--- בפועל ---\n' + got)
  chk('🔒 הרווחים המובילים/נגררים נשמרו',
    got.startsWith(' ❤️') && got.endsWith(' ❤️ניפגש '))
  chk('🔒 קוד הכניסה מגיע מהפרמטר',
    buildRescheduleApprovedMessage({
      treatment: 'ט', date: 'ד', time: '17:00', buildingCode: '#9999',
      cutoffLines: rescheduleCutoffLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 }),
    }).includes('#9999'))
}

{
  const RESCHED_NO = [
    'בקשת שינוי המועד שלך לא אושרה.',
    '',
    '❤️התור המקורי שלך נשאר שמור ',
    '',
    '💆‍♀️ עיצוב גבות טבעי',
    '📅 24 אוגוסט 2026',
    '🕒 17:00',
    '',
    ' אם תרצי לבדוק מועד אחר, אפשר להיכנס שוב לאזור האישי.',
  ].join('\n')

  const got = buildRescheduleRejectedMessage({
    treatment: 'עיצוב גבות טבעי', date: '24 אוגוסט 2026', time: '17:00',
  })
  chk('🔒 דחיית שינוי מועד — זהה למאושר תו-בתו', got === RESCHED_NO)
  if (got !== RESCHED_NO) console.log('--- צפוי ---\n' + RESCHED_NO + '\n--- בפועל ---\n' + got)
}

// ════════════════════════════════════════════════════════════════════════════
section('8. 🔒 כלל ה-cutoff חל גם על נוסח אישור השינוי')

{
  const same = rescheduleCutoffLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 })
  chk('ערכים שווים → מספר אחד, בניסוח המאושר',
    same.length === 2 && same[0] === 'עד 6 שעות לפני התור ניתן לבצע דרך האזור האישי באתר.',
    same.join(' | '))

  /**
   * 🔒 אותו כלל נעול בדיוק כמו בהודעת האישור: הנוסח מכיל {cutoffHours}
   * יחיד, אבל ב-DB יש שני מפתחות. לעולם לא מספר שגוי.
   */
  const diff = rescheduleCutoffLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 12 })
  chk('🔒 ערכים שונים → שני המספרים בנפרד',
    diff.some(l => l.includes('12') && l.includes('לשנות'))
    && diff.some(l => l.includes('6') && l.includes('לבטל')),
    diff.join(' | '))

  // ⚠️ שני הניסוחים אושרו בנפרד ואין לאחד אותם.
  chk('🔒 ניסוח נפרד מזה של הודעת האישור',
    same[0] !== cutoffPolicyLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 })[0])
}

// ─── סיכום ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✓' : '✗'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
