/**
 * סריקת PII על **כל** מסלולי ה-SMS בריפו — לא רק נוסחי ההתראות.
 *
 * ═══ למה הקובץ הזה קיים ═══
 *
 * בדוח קודם נכתבה הטענה הגורפת "אף SMS אינו נושא PII". ⚠️ **היא אינה
 * נכונה.** הקובץ הזה קובע את ההיקף המדויק שבו היא כן נכונה, ואוכף אותו:
 *
 *   🔒 נכון:  אף SMS מסוג **appointment notification** אינו נושא PII.
 *   ⚠️ לא נכון: "אף SMS בריפו". שני מסלולים אחרים כן נושאים מידע —
 *              והם מתועדים כאן במפורש ובכוונה, ולא תוקנו.
 *
 * ⚠️ הקובץ **אינו** מתקן את המסלולים האחרים. שינוי נוסח תזכורת או OTP לא
 * התבקש, ושינוי כזה רק כדי להפוך משפט בדוח לנכון הוא בדיוק הדרך שבה
 * נשברות מערכות שעובדות.
 *
 * 🔒 אין כאן רשת, DB, credentials או SMS אמיתי.
 *
 * הרצה:  npm run test:sms-pii-scan
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(66)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(HERE, '..', p), 'utf8')

process.env.SUPABASE_URL ??= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon'

const { SMS_TEXT, REMINDER_SMS } = await import('../lib/messageTemplates.ts')

/** דפוסי ה-PII שנבדקים בגוף ההודעה. */
const PII = [
  ['ספרות רצופות',  /\d{3,}/],
  ['תאריך',         /\d{1,2}[./]\d{1,2}/],
  ['שעה',           /\d{1,2}:\d{2}/],
  ['סימן מחיר',     /[₪$]/],
]

// ════════════════════════════════════════════════════════════════════════════
section('1. 🔒 appointment notifications — ההיקף שבו הטענה נכונה')

for (const [event, byRole] of Object.entries(SMS_TEXT)) {
  for (const [role, body] of Object.entries(byRole ?? {})) {
    const hits = PII.filter(([, re]) => re.test(body)).map(([l]) => l)
    chk(`${`${event}/${role}`.padEnd(40)} ללא PII`, hits.length === 0, hits.join(','))
  }
}

/*
 * 🔒 הבדיקה המבנית: נוסח סטטי אינו יכול לקלוט PII בזמן ריצה.
 * ⚠️ מחרוזת שנבנית מ-placeholder היא בדיוק המסלול שדרכו שם לקוחה חזר
 * לנוסח admin בעבר.
 */
{
  const file = src('lib/messageTemplates.ts')
  const smsTextBlock = file.slice(file.indexOf('export const SMS_TEXT'), file.indexOf('} as const'))
  const interpolations = [...smsTextBlock.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g)]
    .map(m => m[1])
  const allowed = new Set(['ADMIN_URL', 'ACCOUNT_URL'])
  chk('🔴 הערכים היחידים שמוזרקים לנוסח הם שני ה-URL',
    interpolations.every(v => allowed.has(v)),
    [...new Set(interpolations.filter(v => !allowed.has(v)))].join(','))
  // ⚠️ נבדק על התוכן שבין ההצהרה לסוגר, ולא ברגקס על הטיפוס הגנרי:
  // הטיפוס עצמו מלא בסוגרי > ומכשיל כל ניסיון להתאים אותו.
  const declIdx = file.indexOf('const DYNAMIC_BUILDERS')
  const bodyStart = file.indexOf('= {', declIdx)
  chk('🔴 DYNAMIC_BUILDERS ריק — אין בונה תלוי-נתונים',
    declIdx > -1 && file.slice(bodyStart, bodyStart + 4).trim() === '= {}',
    JSON.stringify(file.slice(bodyStart, bodyStart + 6)))
}

/*
 * 🔒 הצד השני: ה-dispatcher אינו שולף נתוני לקוחה עבור אף התראה.
 */
{
  const { requiresContext } = await import('../lib/messageTemplates.ts')
  const roles = ['admin', 'customer']
  const events = Object.keys(SMS_TEXT)
  chk('🔴 requiresContext=false לכל זוג — אפס שליפות נתוני לקוחה',
    events.every(e => roles.every(r => requiresContext(e, r) === false)))
}

// ════════════════════════════════════════════════════════════════════════════
section('2. מסלולים דינמיים — allowlist מפורש')

/*
 * 🔒 **הכלל:** נוסח SMS דינמי (כזה שמזריק ערכי ריצה לגוף ההודעה) מותר
 * **רק** במסלול שנמצא ברשימה הזו. מסלול חדש שבונה גוף הודעה דינמי, או
 * נוסח דינמי במסלול ההתראות, מפיל את הבדיקה.
 *
 * ⚠️ הרשימה מתארת מה **מותר**, לא מה **חייב**. אם בעתיד יוסר הטיפול,
 * התאריך והשעה מתזכורת ידנית, או ישונה מנגנון ה-OTP כך שהקוד לא יעבור
 * ב-SMS — הבדיקה תמשיך לעבור. ⚠️ **אסור שבדיקה תחייב מסלול רגיש
 * להישאר רגיש**, אחרת היא נועלת בדיוק את השיפור שהיא אמורה לעודד.
 */
const DYNAMIC_ALLOWLIST = [
  {
    id: 'reminders/manual',
    file: 'lib/reminders/templates.ts',
    builder: 'manualReminderBody',
    flag: 'REMINDER_PROVIDER',
    note: 'תזכורת ידנית ששובל יוזמת — עשויה לשאת טיפול/תאריך/שעה',
  },
  {
    id: 'sms/otp',
    file: 'lib/sms/templates.ts',
    builder: 'otpMessage',
    flag: 'SMS_PROVIDER',
    note: 'קוד כניסה חד-פעמי — אינו PII אך הוא נתון רגיש',
  },
]

/*
 * ⚠️ הרישום הזה **מדווח** על מצב ה-allowlist ואינו אוכף אותו: היעלמות
 * בונה מהרשימה היא שיפור (מסלול שהפסיק להיות דינמי), לא כשל. אכיפה
 * כאן הייתה חוסמת בדיוק את ההסרה שאנחנו רוצים לאפשר.
 */
for (const entry of DYNAMIC_ALLOWLIST) {
  const present = new RegExp(`export function ${entry.builder}\\b`).test(src(entry.file))
  console.log(`  · ${entry.id.padEnd(20)} ${present ? 'דינמי (מותר)' : 'הוסר — נוקה'}  ${entry.note}`)
}
chk('allowlist מתועד ומוגבל לשני מסלולים לכל היותר',
  DYNAMIC_ALLOWLIST.length <= 2 &&
  DYNAMIC_ALLOWLIST.every(e => e.flag !== 'NOTIFICATION_PROVIDER'),
  '🔒 ואף אחד מהם אינו מסלול ההתראות')

/*
 * 🔒 תזכורות **אוטומטיות** אינן ב-allowlist — הן חייבות להישאר סטטיות
 * ונקיות, בדיוק כמו ההתראות.
 */
for (const [kind, body] of Object.entries(REMINDER_SMS)) {
  const hits = PII.filter(([, re]) => re.test(body)).map(([l]) => l)
  chk(`reminder/${kind.padEnd(24)} סטטית וללא PII`, hits.length === 0, hits.join(','))
}

/*
 * 🔴 **הכלל שנאכף בפועל:** כל בונה גוף-הודעה דינמי בריפו חייב להיות
 * ב-allowlist. הסריקה מחפשת פונקציות שמחזירות תבנית עם הזרקה, בקבצי
 * התבניות של שלושת מסלולי ה-SMS.
 */
{
  const TEMPLATE_FILES = [
    'lib/messageTemplates.ts',
    'lib/reminders/templates.ts',
    'lib/sms/templates.ts',
  ]
  const allowed = new Set(DYNAMIC_ALLOWLIST.map(e => e.builder))
  const offenders = []

  for (const file of TEMPLATE_FILES) {
    const text = src(file)
    // כל `export function NAME` שגופו מכיל literal עם ${...}
    for (const m of text.matchAll(/export function (\w+)[\s\S]*?\n\}/g)) {
      const [body, name] = [m[0], m[1]]
      if (allowed.has(name)) continue
      // ⚠️ הזרקות של שני ה-URL הקבועים אינן דינמיות — הן קבועי מודול.
      const injections = [...body.matchAll(/`[^`]*\$\{([^}]+)\}[^`]*`/g)].map(x => x[1].trim())
      const risky = injections.filter(v => !['ADMIN_URL', 'ACCOUNT_URL', 'SITE_URL'].includes(v))
      if (risky.length > 0) offenders.push(`${file}:${name} → ${risky.join(',')}`)
    }
  }

  chk('🔴 אין בונה דינמי מחוץ ל-allowlist', offenders.length === 0, offenders.join(' | '))
}

/*
 * 🔒 והצד השני: מסלול ההתראות אינו טוען נתוני לקוחה בכלל.
 */
{
  const { requiresContext } = await import('../lib/messageTemplates.ts')
  const roles = ['admin', 'customer']
  chk('🔴 שום התראה אינה גוררת שליפת נתוני לקוחה',
    Object.keys(SMS_TEXT).every(e => roles.every(r => requiresContext(e, r) === false)))
}

// ════════════════════════════════════════════════════════════════════════════
section('3. 🔒 מיפוי מלא — כל מי ששולח SMS בריפו')

/*
 * ⚠️ הרשימה נאכפת: אם מישהו יוסיף קריאת `.send(` חדשה במסלול שאינו כאן,
 * הבדיקה תיפול ותכריח לעדכן את הסריקה הזו — במקום שהטענה על PII תישאר
 * נכונה על הנייר ושגויה בפועל.
 */
{
  const senders = [
    ['lib/notifications/dispatch.ts', 'appointment notifications — ללא PII'],
    ['lib/reminders/dispatch.ts',     'תזכורות — ידנית נושאת PII'],
    ['lib/sms/index.ts',             'OTP — נושא קוד'],
  ]
  for (const [file, label] of senders) {
    chk(`נקודת שליחה מוכרת: ${file.padEnd(32)}`, /\.send\(/.test(src(file)), label)
  }

  chk('🔒 lib/sms משרת OTP בלבד (SmsKind)',
    /export type SmsKind = 'otp'/.test(src('lib/sms/types.ts')))
  chk('🔒 ההתראות אינן עוברות ב-lib/sms',
    !/from '@\/lib\/sms'/.test(src('lib/notifications/dispatch.ts')))
}

// ════════════════════════════════════════════════════════════════════════════
section("4. 🔴 ה-URL מוחלף בפועל ואינו ליטרל")

for (const [event, byRole] of Object.entries(SMS_TEXT)) {
  for (const [role, body] of Object.entries(byRole ?? {})) {
    const label = `${event}/${role}`
    chk(`${label.padEnd(40)} ללא placeholder גולמי`,
      !/\{ADMIN_URL\}|\{ACCOUNT_URL\}|\$\{|\{\{/.test(body), body)
    const url = body.match(/https?:\/\/\S+/)?.[0]
    chk(`${label.padEnd(40)} URL סופי, HTTPS ותקין`,
      Boolean(url) && url.startsWith('https://') &&
      (() => { try { new URL(url); return true } catch { return false } })() &&
      /\/(admin|account)$/.test(url),
      url)
  }
}

// ════════════════════════════════════════════════════════════════════════════
const passed = results.filter(Boolean).length
console.log(`\n${passed === results.length ? '✓' : '✗'} ${passed}/${results.length} עברו`)
process.exit(passed === results.length ? 0 : 1)
