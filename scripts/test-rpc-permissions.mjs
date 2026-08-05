/**
 * שומר ההרשאות: כל RPC רגיש חייב להיות סגור ל-anon ול-authenticated.
 *
 * הבדיקה הזו קוראת את קבצי המיגרציה עצמם ולא את בסיס הנתונים, ולכן היא
 * נכשלת *בזמן פיתוח* — לפני שמישהו מריץ מיגרציה חדשה בפרודקשן. זו בדיוק
 * הטעות שקרתה ב-0003–0005: הדפוס `revoke ... from public` נראה נכון,
 * חזר על עצמו בשלוש מיגרציות, ואף אחד לא הבחין שהוא לא מסיר את ההענקה
 * הישירה ש-Supabase נותנת ל-anon ול-authenticated.
 *
 * מה נדרש מכל פונקציה חדשה בסכמה public:
 *   revoke execute on function public.X(<חתימה מלאה>) from public, anon, authenticated;
 *   grant  execute on function public.X(<חתימה מלאה>) to service_role;
 *
 * פונקציות שמותר להן להישאר פתוחות מפורטות ב-INTENTIONALLY_OPEN למטה, כל
 * אחת עם הנימוק שלה. הוספה לרשימה היא החלטה מודעת שנשארת מתועדת.
 *
 * הרצה:  npm run test:rpc-permissions
 */

import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = title => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`)

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')

/**
 * פונקציות שנשארות נגישות בכוונה, עם הנימוק. כל תוספת כאן היא החלטת
 * אבטחה מודעת — לא דרך לעקוף בדיקה שנכשלה.
 */
const INTENTIONALLY_OPEN = {
  is_admin:
    'נקראת מתוך מדיניות RLS, שמוערכת בהרשאות התפקיד השואל. שלילת EXECUTE ' +
    'מ-authenticated הייתה שוברת כל קריאה של לקוחה מחוברת. SECURITY DEFINER, ' +
    'מחזירה בוליאני על הקורא בלבד.',
}

// ── קריאת המיגרציות ─────────────────────────────────────────────────────────

const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
const sources = files.map(f => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }))

/** מסיר הערות שורה כדי שדוגמאות בתוך תיעוד לא ייחשבו לקוד אמיתי */
const stripComments = sql =>
  sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n')

/**
 * ⚠️ שתי צורות שונות לאותה חתימה:
 *   CREATE FUNCTION מפרט שם *ושם טיפוס*  → 'p_variants text[]'
 *   REVOKE/GRANT מפרטים טיפוסים בלבד     → 'text[]'
 * שתיהן חייבות להצטמצם לאותו מפתח, אחרת ההשוואה שקטה ולא נכשלת.
 */
function declaredParamType(param) {
  const cleaned = param.trim().replace(/\s+default\s+.*$/i, '').trim()
  if (!cleaned) return null
  const parts = cleaned.split(/\s+/)
  return parts.slice(1).join(' ').toLowerCase() || null
}

function bareParamType(param) {
  const cleaned = param.trim().toLowerCase()
  return cleaned || null
}

function parseArgs(argList, mode = 'declared') {
  if (!argList.trim()) return []
  const parse = mode === 'bare' ? bareParamType : declaredParamType
  return argList.split(',').map(parse).filter(Boolean)
}

/** מפתח השוואה יציב: 'name(type,type)' */
const sigKey = (name, types) => `${name}(${types.join(',')})`

// ── כל הפונקציות שנוצרות ─────────────────────────────────────────────────────

const CREATE_RE = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([^)]*)\)([\s\S]{0,120})/gi

const defined = new Map()   // sigKey → { name, types, files:Set, isTrigger }
for (const { file, sql } of sources) {
  const clean = stripComments(sql)
  for (const m of clean.matchAll(CREATE_RE)) {
    const [, name, argList, tail] = m
    const types = parseArgs(argList)
    const key = sigKey(name, types)
    const isTrigger = /returns\s+trigger/i.test(tail)
    const entry = defined.get(key) ?? { name, types, files: new Set(), isTrigger }
    entry.files.add(file)
    entry.isTrigger = entry.isTrigger || isTrigger
    defined.set(key, entry)
  }
}

section('פונקציות שנמצאו במיגרציות')
chk(`נמצאו ${defined.size} חתימות פונקציה ב-${files.length} מיגרציות`, defined.size > 0)

// ── REVOKE / GRANT ──────────────────────────────────────────────────────────

const REVOKE_RE =
  /revoke\s+execute\s+on\s+function\s+public\.(\w+)\s*\(([^)]*)\)\s*from\s+([^;]+);/gi
const GRANT_RE =
  /grant\s+execute\s+on\s+function\s+public\.(\w+)\s*\(([^)]*)\)\s*to\s+([^;]+);/gi

const revokedFrom = new Map()   // sigKey → Set(roles)
const grantedTo = new Map()     // sigKey → Set(roles)

for (const { sql } of sources) {
  const clean = stripComments(sql)
  for (const m of clean.matchAll(REVOKE_RE)) {
    const key = sigKey(m[1], parseArgs(m[2], 'bare'))
    const roles = m[3].split(',').map(r => r.trim().toLowerCase())
    const set = revokedFrom.get(key) ?? new Set()
    roles.forEach(r => set.add(r))
    revokedFrom.set(key, set)
  }
  for (const m of clean.matchAll(GRANT_RE)) {
    const key = sigKey(m[1], parseArgs(m[2], 'bare'))
    const roles = m[3].split(',').map(r => r.trim().toLowerCase())
    const set = grantedTo.get(key) ?? new Set()
    roles.forEach(r => set.add(r))
    grantedTo.set(key, set)
  }
}

// ── האכיפה ──────────────────────────────────────────────────────────────────

section('כל RPC רגיש סגור ל-anon ול-authenticated')

const sensitive = [...defined.entries()].filter(([, e]) =>
  !e.isTrigger && !(e.name in INTENTIONALLY_OPEN))

chk(`${sensitive.length} פונקציות מסווגות כרגישות`, sensitive.length > 0)

for (const [key, entry] of sensitive) {
  const revoked = revokedFrom.get(key) ?? new Set()
  const missing = ['anon', 'authenticated'].filter(r => !revoked.has(r))
  chk(`${key} — REVOKE מ-anon ומ-authenticated`,
    missing.length === 0,
    missing.length ? `חסר: ${missing.join(', ')} (נוצרה ב-${[...entry.files].join(', ')})` : '')
}

section('service_role עדיין מורשה')

for (const [key] of sensitive) {
  const granted = grantedTo.get(key) ?? new Set()
  chk(`${key} — GRANT ל-service_role`, granted.has('service_role'))
}

section('אין REVOKE גורף שעלול לסגור פונקציה ציבורית')

{
  let broad = null
  for (const { file, sql } of sources) {
    const clean = stripComments(sql)
    if (/revoke\s+execute\s+on\s+all\s+functions\s+in\s+schema/i.test(clean)) broad = file
  }
  chk('אין "revoke execute on all functions in schema"', broad === null, broad ?? '')
}

section('פונקציות שנשארו פתוחות בכוונה')

for (const [name, reason] of Object.entries(INTENTIONALLY_OPEN)) {
  const found = [...defined.values()].some(e => e.name === name)
  chk(`${name} מתועדת ועדיין קיימת`, found, reason.slice(0, 60) + '…')
}

{
  const triggers = [...defined.values()].filter(e => e.isTrigger).map(e => e.name)
  chk('פונקציות טריגר אינן נדרשות ל-REVOKE (לא נגישות כ-RPC)',
    triggers.length > 0, triggers.join(', '))
}

// ── סיכום ───────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
if (failed > 0) {
  console.log('⛔ RPC רגיש ללא REVOKE ל-anon/authenticated.')
  console.log('   הוסף למיגרציה *חדשה*:')
  console.log('   revoke execute on function public.X(<חתימה>) from public, anon, authenticated;')
  console.log('   grant  execute on function public.X(<חתימה>) to service_role;')
}
console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed}/${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
