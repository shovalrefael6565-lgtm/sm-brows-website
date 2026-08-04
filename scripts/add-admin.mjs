/**
 * מוסיף מנהלת לטבלת admins לפי מספר טלפון — כלי הרצה מקומי חד-פעמי.
 *
 * תנאי מקדים: המנהלת כבר התחברה פעם אחת דרך /login או /admin/login
 * (כדי שיהיה לה auth.users), כי הסקריפט רק מאתר ומקשר — הוא לא יוצר
 * זהות חדשה.
 *
 * הרצה:  node scripts/add-admin.mjs +972541234567
 *
 * idempotent: הרצה חוזרת על אותו מספר לא יוצרת כפילות ולא נכשלת.
 * אין הדפסה של מספרי טלפון, tokens או secrets — רק ✓/✗ ו-user_id.
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const ENV_PATH = new URL('../.env.local', import.meta.url)
const E164_IL_MOBILE = /^\+9725\d{8}$/

function normalizePhone(input) {
  if (!input) return null
  let digits = input.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)

  let national
  if (digits.startsWith('972')) {
    national = digits.slice(3)
    if (national.startsWith('0')) national = national.slice(1)
  } else if (digits.startsWith('0')) {
    national = digits.slice(1)
  } else {
    national = digits
  }

  const e164 = `+972${national}`
  return E164_IL_MOBILE.test(e164) ? e164 : null
}

const rawPhone = process.argv[2]
if (!rawPhone) {
  console.log('שימוש: node scripts/add-admin.mjs <מספר טלפון>')
  process.exit(1)
}

const phone = normalizePhone(rawPhone)
if (!phone) {
  console.log('✗ מספר הטלפון אינו נייד ישראלי תקין')
  process.exit(1)
}

if (!existsSync(ENV_PATH)) {
  console.log('✗ לא נמצא קובץ .env.local בשורש הפרויקט')
  process.exit(1)
}

const env = {}
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.log('✗ חסרים NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ב-.env.local')
  process.exit(1)
}

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

// GoTrue admin listUsers אינו תומך בסינון לפי טלפון — מדפדפים על כל
// המשתמשים ומחפשים התאמה. קביל בעסק קטן עם מעט מאוד משתמשים.
const targetPhone = phone.replace('+', '') // כך Supabase שומר את הטלפון
let authUser = null
let page = 1
const perPage = 200
for (;;) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage })
  if (error) {
    console.log('✗ שגיאה בקריאת משתמשים:', error.message)
    process.exit(1)
  }
  authUser = data.users.find(u => u.phone === targetPhone) ?? null
  if (authUser || data.users.length < perPage) break
  page += 1
}

if (!authUser) {
  console.log('✗ לא נמצא משתמש למספר הזה. יש להתחבר קודם דרך /login או /admin/login, ואז להריץ שוב.')
  process.exit(1)
}

const shortId = `${authUser.id.slice(0, 8)}…`

const { data: existing, error: findErr } = await db
  .from('admins')
  .select('user_id')
  .eq('user_id', authUser.id)
  .maybeSingle()

if (findErr) {
  console.log('✗ שגיאה בבדיקת admins:', findErr.message)
  process.exit(1)
}

if (existing) {
  console.log(`✓ המשתמש ${shortId} כבר מוגדר כמנהל — לא בוצע שינוי`)
  process.exit(0)
}

const { error: insertErr } = await db.from('admins').insert({ user_id: authUser.id })
if (insertErr) {
  console.log('✗ הוספת admin נכשלה:', insertErr.message)
  process.exit(1)
}

console.log(`✓ המשתמש ${shortId} נוסף כמנהל בהצלחה`)
