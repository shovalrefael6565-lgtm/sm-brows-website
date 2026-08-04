/**
 * בדיקת חיבור ל-Supabase — מאמתת שהמשתנים ב-.env.local נכונים ושהמיגרציה
 * הותקנה, בלי להדפיס אף ערך סודי.
 *
 * הרצה:  node scripts/check-supabase.mjs
 *
 * הפלט מציג רק ✓/✗ ורמזים לא-מזהים (אורך המפתח, הדומיין). המפתחות עצמם
 * לא מודפסים, לא נשלחים לשום מקום ולא נשמרים.
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const ENV_PATH = new URL('../.env.local', import.meta.url)

const results = []
const chk = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`)
}

// ── קריאת .env.local ────────────────────────────────────────────────────────
if (!existsSync(ENV_PATH)) {
  console.log('✗ לא נמצא קובץ .env.local בשורש הפרויקט')
  process.exit(1)
}

const env = {}
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
const PEPPER = env.OTP_PEPPER

console.log('── פורמט המשתנים ' + '─'.repeat(42))

chk('NEXT_PUBLIC_SUPABASE_URL קיים ותקין',
  !!URL_ && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(URL_),
  URL_ ? `דומיין: ${URL_.replace(/^https:\/\/([a-z0-9]{4})[a-z0-9]*/, 'https://$1…')}` : 'חסר')

chk('NEXT_PUBLIC_SUPABASE_ANON_KEY קיים',
  !!ANON && ANON.length > 30, ANON ? `אורך ${ANON.length} תווים` : 'חסר')

chk('SUPABASE_SERVICE_ROLE_KEY קיים',
  !!SERVICE && SERVICE.length > 30, SERVICE ? `אורך ${SERVICE.length} תווים` : 'חסר')

chk('שני המפתחות שונים זה מזה',
  !!ANON && !!SERVICE && ANON !== SERVICE,
  ANON === SERVICE ? '⚠️ הודבק אותו מפתח פעמיים' : '')

chk('OTP_PEPPER קיים ובאורך סביר',
  !!PEPPER && PEPPER.length >= 32, PEPPER ? `אורך ${PEPPER.length}` : 'חסר — הרץ: openssl rand -hex 32')

chk('SMS_PROVIDER מוגדר', !!env.SMS_PROVIDER, env.SMS_PROVIDER ?? 'חסר')
chk('ADMIN_PHONE_E164 בפורמט E.164',
  !!env.ADMIN_PHONE_E164 && /^\+9725\d{8}$/.test(env.ADMIN_PHONE_E164),
  env.ADMIN_PHONE_E164 ?? 'חסר')

if (!URL_ || !ANON || !SERVICE) {
  console.log('\n⛔ חסרים משתנים — לא ניתן להמשיך לבדיקת החיבור.')
  process.exit(1)
}

// ── חיבור אמיתי ─────────────────────────────────────────────────────────────
console.log('\n── חיבור לפרויקט ' + '─'.repeat(42))

const anonClient = createClient(URL_, ANON, { auth: { persistSession: false } })
const adminClient = createClient(URL_, SERVICE, { auth: { persistSession: false } })

// business_settings פתוח לקריאה לכולם — בדיקה טובה למפתח ה-anon
const r1 = await anonClient.from('business_settings').select('key').order('key')
chk('התחברות עם anon key', !r1.error, r1.error?.message ?? '')
chk('המיגרציה מותקנת (6 הגדרות מדיניות)',
  !r1.error && r1.data?.length === 6, r1.data ? `נמצאו ${r1.data.length}` : '')

// customers חסום ל-anon ע"י RLS — אמור לחזור ריק, לא שגיאה
const r2 = await anonClient.from('customers').select('id')
chk('RLS חוסם גישה אנונימית ללקוחות',
  !r2.error && (r2.data?.length ?? 0) === 0,
  r2.error ? r2.error.message : `הוחזרו ${r2.data?.length ?? 0} שורות`)

// service_role עוקף RLS — אמור להצליח
const r3 = await adminClient.from('customers').select('id', { count: 'exact', head: true })
chk('service_role עובד ועוקף RLS', !r3.error, r3.error?.message ?? `${r3.count ?? 0} לקוחות רשומות`)

const r4 = await adminClient.from('appointments').select('id', { count: 'exact', head: true })
chk('טבלת התורים נגישה', !r4.error, r4.error?.message ?? `${r4.count ?? 0} תורים`)

const r5 = await adminClient.from('otp_attempts').select('id', { count: 'exact', head: true })
chk('טבלת ה-OTP נגישה לשרת', !r5.error, r5.error?.message ?? '')

// ודא שהמפתחות לא הוחלפו בטעות: anon לא אמור לראות otp_attempts
const r6 = await anonClient.from('otp_attempts').select('id')
chk('otp_attempts חסום לצד הלקוח',
  !!r6.error || (r6.data?.length ?? 0) === 0,
  r6.error ? 'חסום כצפוי' : `הוחזרו ${r6.data?.length ?? 0} שורות`)

const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0
  ? '✓ הכול תקין — אפשר להמשיך לשלב 2'
  : `✗ ${failed} בדיקות נכשלו`)
process.exit(failed === 0 ? 0 : 1)
