/**
 * שלב 12A — בדיקת חיבור יבשה מול 019.
 *
 * 🔒 **הכלי הזה אינו שולח SMS ואינו נוגע בבסיס הנתונים.**
 *
 * הוא פונה אך ורק ל-https://019sms.co.il/api/test, שהתיעוד מגדיר כך:
 * "this will look the same as the real request but won't submit the actions".
 * הוא מאמת token, username, שם שולח ופורמט מספר — ותו לא.
 *
 * ⚠️ מה שהכלי הזה **אינו** עושה, וחשוב שיישאר כך:
 *   • אינו מייבא את dispatcher, את הספק של ה-runtime, או את supabase.
 *   • אינו יוצר ואינו מעדכן reminder, attempt, status, sent_at או
 *     provider_message_id. הצלחת dry-run לעולם לא תסומן 'sent'.
 *   • אינו יכול לפנות לכתובת ה-production. היא אינה מוזכרת בקובץ הזה בכלל.
 *
 * ⚠️ הפלט אינו מכיל token, מספר מלא או גוף הודעה.
 *
 * הרצה (דרך tsx — הקובץ מייבא את מודול המיפוי שכתוב ב-TypeScript):
 *   npm run probe:019 -- --phone=+9725XXXXXXXX
 *   npm run probe:019                 ← לוקח את SMS019_PROBE_PHONE מ-.env.local
 *
 * ⚠️ הצורה השנייה עדיפה: מספר הבדיקה נשאר מקומי ואינו עובר בשורת הפקודה,
 * בהיסטוריית ה-shell או בצ'אט.
 *
 * דורש ב-.env.local:  SMS019_USERNAME · SMS019_TOKEN · SMS019_SOURCE
 */

import { readFileSync } from 'fs'

const {
  SMS019_TEST_API_URL, SMS019_SOURCE_RE,
  buildSms019Payload, classifySms019Body, classifySms019HttpStatus,
  classifySms019TransportError, maskPhone, toLocalIsraeliPhone,
} = await import('../lib/reminders/sms019Mapping.ts')

const die = msg => { console.error(`\n✗ ${msg}\n`); process.exit(1) }

// ── טעינת .env.local ────────────────────────────────────────────────────────
// ⚠️ נקרא לזיכרון בלבד. הקובץ אינו נכתב, אינו משתנה ואינו מודפס.
const env = { ...process.env }
try {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (env[m[1]] === undefined) env[m[1]] = v
  }
} catch {
  console.warn('⚠️  לא נמצא .env.local — מסתמך על משתני הסביבה בלבד')
}

// ── יעד הבדיקה ──────────────────────────────────────────────────────────────
// ⚠️ SMS019_PROBE_PHONE הוא הדרך המועדפת: המספר נשאר ב-.env.local ואינו עובר
// בשורת הפקודה. --phone קיים כעקיפה מפורשת וגובר עליו.
const phoneArg =
  process.argv.find(a => a.startsWith('--phone='))?.slice('--phone='.length)
  ?? env.SMS019_PROBE_PHONE?.trim()

if (!phoneArg) {
  die('אין יעד בדיקה. הגדר SMS019_PROBE_PHONE ב-.env.local, או העבר --phone=+9725XXXXXXXX')
}

const phoneSource = process.argv.some(a => a.startsWith('--phone='))
  ? '--phone'
  : 'SMS019_PROBE_PHONE'

const localPhone = toLocalIsraeliPhone(phoneArg)
if (!localPhone) {
  die('המספר אינו נייד ישראלי בפורמט E.164. צפוי: +9725XXXXXXXX')
}

// ── תצורה ───────────────────────────────────────────────────────────────────
const username = env.SMS019_USERNAME?.trim()
const token = env.SMS019_TOKEN?.trim()
const source = env.SMS019_SOURCE?.trim()

const missing = ['SMS019_USERNAME', 'SMS019_TOKEN', 'SMS019_SOURCE']
  .filter(k => !env[k]?.trim())
if (missing.length) die(`חסרים משתני סביבה: ${missing.join(', ')}`)
if (!SMS019_SOURCE_RE.test(source)) {
  die('SMS019_SOURCE אינו עומד בפורמט המתועד (עד 11 תווים, אותיות אנגליות וספרות)')
}

const timeoutMs = Number(env.SMS019_TIMEOUT_MS) || 10_000

// ── הבקשה ───────────────────────────────────────────────────────────────────
const externalId = `probe-${Date.now()}`
const payload = buildSms019Payload({
  username,
  source,
  localPhone,
  message: 'S.M BROWS — בדיקת חיבור. הודעה זו אינה נשלחת.',
  externalId,
})

console.log('\n═══ 019 dry-run ═══')
console.log(`כתובת:      ${SMS019_TEST_API_URL}`)
console.log('             ⚠️ כתובת בדיקה בלבד — הפעולה אינה מבוצעת')
console.log(`שם שולח:    ${source}  (${source.length} תווים)`)
console.log(`יעד:        ${maskPhone(localPhone)}  (מקור: ${phoneSource})`)
console.log(`external_id: ${externalId}`)
console.log(`timeout:    ${timeoutMs}ms`)
console.log('משתמש:      (מוגדר, לא מודפס)')
console.log('token:      (מוגדר, לא מודפס)\n')

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), timeoutMs)

let res
try {
  res = await fetch(SMS019_TEST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
} catch (err) {
  clearTimeout(timer)
  const mapped = classifySms019TransportError(err)
  console.log(`✗ כשל תעבורה → ${mapped.outcome} / ${mapped.errorCode}`)
  console.log('  (בשליחה אמיתית זה מה שהיה נרשם לתזכורת)\n')
  process.exit(1)
}
clearTimeout(timer)

console.log(`HTTP ${res.status}`)

const byHttp = classifySms019HttpStatus(res.status)
if (byHttp) {
  console.log(`✗ מיפוי → ${byHttp.outcome} / ${byHttp.errorCode}\n`)
  process.exit(1)
}

let body
try {
  body = await res.json()
} catch {
  console.log('✗ הגוף אינו JSON תקין → delivery_unknown / sms019_malformed_response\n')
  process.exit(1)
}

// ⚠️ מודפסים רק שדות מוכרים ומוגדרים — לא הגוף הגולמי.
const status = body?.status
const shipmentId = body?.shipment_id
const mapped = classifySms019Body(body)

console.log(`status הספק:  ${status}`)
console.log(`shipment_id:  ${shipmentId ?? '(אין)'}`)
console.log(`מיפוי אצלנו:  ${mapped.outcome}${mapped.errorCode ? ' / ' + mapped.errorCode : ''}\n`)

if (mapped.outcome === 'accepted') {
  console.log('✓ התצורה תקינה: token, שם השולח ופורמט המספר התקבלו.')
  console.log('  ⚠️ לא נשלח SMS. זו כתובת הבדיקה בלבד.')
  console.log('  ⚠️ לא נוצרה ולא עודכנה שום שורה במסד.\n')
  process.exit(0)
}

console.log('✗ 019 דחה את הבקשה. ראה את הקוד למעלה מול טבלת השגיאות בתיעוד.')
if (status === 515) console.log('  515 = שם השולח אינו מאושר בחשבון. יש לפנות לתמיכת 019.')
if (status === 3 || status === 10 || status === 11 || status === 504) {
  console.log('  שגיאת token/username. ייתכן גם חסימת IP allowlist.')
}
console.log('')
process.exit(1)
