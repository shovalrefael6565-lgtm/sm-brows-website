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
  buildReminderWhatsAppMessage,
  buildWhatsAppLinkToBusiness,
  buildWhatsAppLinkToCustomer,
  cutoffPolicyLines,
  rescheduleCutoffLines,
  STUDIO_DETAILS,
} = await import('../lib/whatsappTemplates.ts')
const { hasEmoji } = await import('../lib/messageTemplates.ts')

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
 * (.handoff/STAGE-15F-APPROVED-TEMPLATES.md), **אחרי** הסרת האמוג'י:
 * WhatsApp Business מציג אותם ללקוחה כ-`???` (באג encoding אמיתי בפרודקשן,
 * לא בקוד). כל תווית שהאמוג'י שימש בשבילה קיבלה מילה בעברית במקומו —
 * "תאריך:", "שעה:", "כתובת:" וכו' — כך שהמידע לא הלך לאיבוד. כל סטייה
 * נוספת — כולל רווח — היא ניסוח מחדש של נוסח מאושר, ולכן נכשלת כאן.
 */
const APPROVED = [
  'נקבע לך תור ל־עיצוב גבות טבעי',
  '',
  'תאריך: 24 אוגוסט 2026',
  'שעה: 17:00',
  '',
  'כתובת: הכורמים 14, קומה 4, דירה 16',
  '(הבניין על הכיכר)',
  `קוד כניסה לבניין: ${CODE}`,
  '',
  'הטיפול שלך:',
  'עיצוב גבות טבעי',
  '₪110',
  '',
  'אמצעי תשלום: מזומן / Bit / PayBox / כרטיס אשראי',
  'Bit / PayBox: 054-7261564',
  '',
  'לשינוי או ביטול התור:',
  'עד 6 שעות לפני התור ניתן לבצע שינוי או ביטול דרך האזור האישי באתר.',
  'פחות מ־6 שעות לפני התור יש לפנות אלינו בוואטסאפ.',
  '',
  'ניפגש',
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
 * 🔒 **באג ה-encoding.** WhatsApp Business מציג אמוג'י ללקוחה כ-`???`.
 * ההודעה הזו נפתחת אצל שובל ב-WhatsApp Business, ולכן אסור שיהיה בה
 * ולו אמוג'י אחד — לא רק שהיא תואמת ל-snapshot שכבר לא מכיל אמוג'י.
 */
chk("🔒 אפס אמוג'י (WhatsApp Business הופך אמוג'י ל-???)", !hasEmoji(actual))

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
 * ⚠️ snapshot תו-בתו של שלושת הנוסחים שנמסרו ואושרו — **אחרי** הסרת
 * האמוג'י (WhatsApp Business מציג אותם ללקוחה כ-`???`, ראה הערת
 * ה-encoding בראש lib/whatsappTemplates.ts).
 *
 * 🔒 **הרווחים המוביל/נגרר עדיין כולל.** אלה לא היו ריפוד סביב אמוג'י
 * בכל מקום — הרווח הנגרר ב-REJECT קיים במקור המאושר גם בלי קשר לאמוג'י,
 * ולכן נשאר. רווחים שהיו **אך ורק** ריפוד סביב ❤️ שהוסר (בפתיחה/סיום של
 * RESCHED_OK, ובפתיחת RESCHED_NO) הוסרו יחד איתו.
 */
{
  const REJECT = [
    'היי דנה',
    '',
    'לצערי לא ניתן לאשר את התור שביקשת ל־עיצוב גבות טבעי',
    'בתאריך 24 אוגוסט 2026 בשעה 17:00.',
    '',
    'אפשר לבחור מועד אחר דרך האתר או לשלוח לנו הודעה בוואטסאפ ונשמח לעזור ',
  ].join('\n')

  const got = buildRejectionMessage({
    customerName: 'דנה', treatment: 'עיצוב גבות טבעי',
    date: '24 אוגוסט 2026', time: '17:00',
  })
  chk('🔒 דחיית בקשת תור — זהה למאושר תו-בתו', got === REJECT)
  if (got !== REJECT) console.log('--- צפוי ---\n' + REJECT + '\n--- בפועל ---\n' + got)
  chk('🔒 הרווח הנגרר בשורה האחרונה נשמר', got.endsWith('ונשמח לעזור '))
  chk('הנוסח פונה ללקוחה בשמה (בניגוד לנוסח האישור)', got.startsWith('היי דנה'))
  chk("🔒 אפס אמוג'י (WhatsApp Business הופך אמוג'י ל-???)", !hasEmoji(got))
}

{
  const RESCHED_OK = [
    'שינוי המועד שלך אושר',
    '',
    'הטיפול: עיצוב גבות טבעי',
    '',
    'תאריך חדש: 25 אוגוסט 2026',
    'שעה חדשה: 18:00',
    '',
    'כתובת: הכורמים 14, קומה 4, דירה 16',
    '(הבניין על הכיכר)',
    `קוד כניסה לבניין: ${CODE}`,
    '',
    'לשינוי או ביטול:',
    'עד 6 שעות לפני התור ניתן לבצע דרך האזור האישי באתר.',
    'פחות מכך יש לפנות אלינו בוואטסאפ.',
    '',
    'ניפגש',
  ].join('\n')

  const got = buildRescheduleApprovedMessage({
    treatment: 'עיצוב גבות טבעי', date: '25 אוגוסט 2026', time: '18:00',
    buildingCode: CODE,
    cutoffLines: rescheduleCutoffLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 }),
  })
  chk('🔒 אישור שינוי מועד — זהה למאושר תו-בתו', got === RESCHED_OK)
  if (got !== RESCHED_OK) console.log('--- צפוי ---\n' + RESCHED_OK + '\n--- בפועל ---\n' + got)
  chk('🔒 קוד הכניסה מגיע מהפרמטר',
    buildRescheduleApprovedMessage({
      treatment: 'ט', date: 'ד', time: '17:00', buildingCode: '#9999',
      cutoffLines: rescheduleCutoffLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 6 }),
    }).includes('#9999'))
  chk("🔒 אפס אמוג'י (WhatsApp Business הופך אמוג'י ל-???)", !hasEmoji(got))
}

{
  const RESCHED_NO = [
    'בקשת שינוי המועד שלך לא אושרה.',
    '',
    'התור המקורי שלך נשאר שמור',
    '',
    'הטיפול: עיצוב גבות טבעי',
    'תאריך: 24 אוגוסט 2026',
    'שעה: 17:00',
    '',
    ' אם תרצי לבדוק מועד אחר, אפשר להיכנס שוב לאזור האישי.',
  ].join('\n')

  const got = buildRescheduleRejectedMessage({
    treatment: 'עיצוב גבות טבעי', date: '24 אוגוסט 2026', time: '17:00',
  })
  chk('🔒 דחיית שינוי מועד — זהה למאושר תו-בתו', got === RESCHED_NO)
  if (got !== RESCHED_NO) console.log('--- צפוי ---\n' + RESCHED_NO + '\n--- בפועל ---\n' + got)
  chk("🔒 אפס אמוג'י (WhatsApp Business הופך אמוג'י ל-???)", !hasEmoji(got))
}

// ════════════════════════════════════════════════════════════════════════════
section('8. 🔒 תזכורת ידנית ב-WhatsApp (snapshot)')

/**
 * ⚠️ snapshot תו-בתו של הנוסח המאושר. שולח כפתור "שליחת WhatsApp" במסך
 * "כל התורים" (app/admin/(protected)/appointments/page.tsx), לתור
 * confirmed עתידי בלבד — ראה סעיף 10.
 */
{
  const REMINDER = [
    'תזכורת לתור שלך ב-SM BROWS',
    '',
    'טיפול: עיצוב גבות טבעי',
    'תאריך: 24 אוגוסט 2026',
    'שעה: 17:00',
    '',
    'כתובת: הכורמים 14, קומה 4, דירה 16',
    '',
    'ניפגש',
  ].join('\n')

  const got = buildReminderWhatsAppMessage({
    treatment: 'עיצוב גבות טבעי', date: '24 אוגוסט 2026', time: '17:00',
  })
  chk('🔒 תזכורת WhatsApp — זהה למאושר תו-בתו', got === REMINDER)
  if (got !== REMINDER) console.log('--- צפוי ---\n' + REMINDER + '\n--- בפועל ---\n' + got)
  chk("🔒 אפס אמוג'י (WhatsApp Business הופך אמוג'י ל-???)", !hasEmoji(got))
  chk('🔒 הכתובת זהה ל-STUDIO_DETAILS.address (אין עותק שני)',
    got.includes(`כתובת: ${STUDIO_DETAILS.address}`))
  /**
   * ⚠️ בניגוד ל-buildApprovalMessage, הנוסח הזה **אינו** כולל addressNote
   * ('(הבניין על הכיכר)') ואינו כולל אמצעי תשלום — זה מה שאושר: תזכורת
   * תמציתית, לא חזרה על הודעת האישור המלאה.
   */
  chk('🔒 אין addressNote בתזכורת (בכוונה, בניגוד להודעת האישור)',
    !got.includes(STUDIO_DETAILS.addressNote))
  chk('🔒 אין קישור בתזכורת (בכוונה — זו תזכורת, לא כפתור ניהול)',
    !/https?:/.test(got))
}

/**
 * 🔒 **בדיקת רשת ביטחון**, נפרדת מה-snapshots הבודדים למעלה: סורקת את כל
 * חמשת הנוסחים ש**שובל שולחת ללקוחה** ומוודאת שאין ולו אמוג'י אחד באף
 * אחד מהם, על פני קלט שרירותי — לא רק על ערכי הבדיקה הקבועים. אמוג'י
 * חדש שייכנס בעתיד לאחד הנוסחים האלה ייתפס כאן גם אם אף אחד לא עדכן
 * snapshot.
 */
{
  const FIVE_ADMIN_TO_CUSTOMER = [
    ['buildApprovalMessage', buildApprovalMessage({
      date: 'ד', time: 'ש', treatment: 'ט', priceLine: '₪1', buildingCode: CODE,
      cutoffLines: cutoffPolicyLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 12 }),
    })],
    ['buildRejectionMessage', buildRejectionMessage({
      customerName: 'ל', treatment: 'ט', date: 'ד', time: 'ש',
    })],
    ['buildRescheduleApprovedMessage', buildRescheduleApprovedMessage({
      treatment: 'ט', date: 'ד', time: 'ש', buildingCode: CODE,
      cutoffLines: rescheduleCutoffLines({ cancelCutoffHours: 6, rescheduleCutoffHours: 12 }),
    })],
    ['buildRescheduleRejectedMessage', buildRescheduleRejectedMessage({
      treatment: 'ט', date: 'ד', time: 'ש',
    })],
    ['buildReminderWhatsAppMessage', buildReminderWhatsAppMessage({
      treatment: 'ט', date: 'ד', time: 'ש',
    })],
  ]
  for (const [name, body] of FIVE_ADMIN_TO_CUSTOMER) {
    chk(`🔒 ${name}: אפס אמוג'י על קלט שרירותי`, !hasEmoji(body))
  }

  /**
   * ⚠️ ההפך המכוון: customer→business לא נגעו, ועדיין מכילות אמוג'י. אם
   * הבדיקה הזו תיפול, מישהו הסיר אמוג'י ממקום שלא אמור להשתנות.
   */
  const cancelPrefill = buildLateChangeMessage({ action: 'cancel', treatment: 'ט', whenLabel: 'ד' })
  chk('🔒 customer→business (buildLateChangeMessage) לא נגעו — עדיין עם אמוג\'י',
    hasEmoji(cancelPrefill))
}

// ════════════════════════════════════════════════════════════════════════════
section('9. 🔒 כלל ה-cutoff חל גם על נוסח אישור השינוי')

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

// ════════════════════════════════════════════════════════════════════════════
section('10. 🔒 כפתור "שליחת WhatsApp" — חיווט וגייטינג במסך "כל התורים"')

/**
 * ⚠️ עמוד שרת (React Server Component) בלי שום harness לרינדור בפרויקט
 * הזה — כמו בדיקות סעיף 5, החיווט נבדק על **קוד המקור** ולא על DOM
 * מרונדר. זה בודק שהכפתור מחובר נכון ושהתנאים הנכונים קיימים בקוד; זה
 * *אינו* מוכיח שהם מתבצעים נכון בזמן ריצה (לכך יש את test:reminders-core
 * ואת test:15h-core לתנאים המקבילים ב-canCancel).
 */
{
  const PAGE = 'app/admin/(protected)/appointments/page.tsx'
  const clean = stripComments(src(PAGE))

  chk('🔒 מייבא את buildReminderWhatsAppMessage ואת buildWhatsAppLinkToCustomer',
    /import\s*\{[^}]*buildReminderWhatsAppMessage[^}]*\}\s*from\s*'@\/lib\/whatsappTemplates'/.test(clean)
    && /import\s*\{[^}]*buildWhatsAppLinkToCustomer[^}]*\}\s*from\s*'@\/lib\/whatsappTemplates'/.test(clean))

  chk('🔒 מייבא את E164_IL_MOBILE — אותו מקור אמת יחיד לתקינות טלפון',
    /import\s*\{[^}]*E164_IL_MOBILE[^}]*\}\s*from\s*'@\/lib\/phone'/.test(clean))

  /**
   * ⚠️ canSendReminder **נשען על** canCancel ולא משכפל את שלושת התנאים
   * שלו (confirmed, לא שורת בקשת שינוי מועד, עתידי) — כך שאי אפשר שהכפתור
   * יוצג בתנאים שונים מכפתור הביטול בלי ששני המקומות עודכנו יחד.
   */
  chk('🔒 canSendReminder נשען על canCancel (לא כפילות תנאים)',
    /canSendReminder\s*=\s*\n?\s*canCancel\s*&&\s*E164_IL_MOBILE\.test\(appt\.customer_phone_e164\)/.test(clean))

  chk('🔒 הכפתור מוצג רק כש-canSendReminder אמת',
    /\{canSendReminder\s*&&\s*\(/.test(clean))

  chk('🔒 הקישור נבנה מ-buildWhatsAppLinkToCustomer עם טלפון + buildReminderWhatsAppMessage',
    /buildWhatsAppLinkToCustomer\(\s*\n?\s*appt\.customer_phone_e164,\s*\n?\s*buildReminderWhatsAppMessage\(/.test(clean))

  chk('נפתח בטאב חדש עם rel="noopener noreferrer" (לא ניווט-עזיבה מהניהול)',
    /target="_blank"[\s\S]{0,80}rel="noopener noreferrer"/.test(clean))

  /**
   * 🔒 **אין קריאת רשת בעמוד הזה בכלל.** הכפתור הוא קישור wa.me בלבד —
   * פתיחתו אינה יכולה לשנות DB או סטטוס תזכורת, כי אין שום קוד בעמוד
   * שקורא לשרת. (הביטול עצמו חי ב-CancelAppointmentButton, קובץ נפרד.)
   */
  chk('🔒 העמוד עצמו אינו מבצע שום fetch/קריאת API',
    !/\bfetch\(/.test(clean))

  chk('הטקסט על הכפתור עצמו', /שליחת WhatsApp/.test(clean))
}

// ─── סיכום ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✓' : '✗'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
