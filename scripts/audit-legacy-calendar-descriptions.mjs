/**
 * 9C.2 — audit read-only ל-Format A (הנתיב הציבורי הישן, ללא DB link,
 * ללא extendedProperties — ר. lib/legacyCalendarAudit.ts לניתוח המלא).
 *
 * ⚠️ read-only מוחלט. אין --execute, אין PATCH, אין שום קריאת mutate
 * בקובץ הזה או ב-lib/legacyCalendarAudit.ts. סורק את *כל* היומן —
 * עבר ועתיד — בלי timeMin/timeMax ובלי שום cutoff מבוסס תאריך/commit.
 * הפלט הוא counts בלבד: שום summary/description/event-id לא מודפס.
 *
 * שימוש (tsx מקומי — לא npx):
 *   npm exec --no -- tsx scripts/audit-legacy-calendar-descriptions.mjs --help
 *   npm exec --no -- tsx scripts/audit-legacy-calendar-descriptions.mjs
 *
 * ⚠️ ממצא strict_candidates *אינו* הוכחת בעלות — אין דרך לזהות אוטומטית
 * שאירוע כזה שייך ל-SM Brows ולא לאירוע אחר (אין extendedProperties על
 * Format A בשום מצב). הטיפול הבא הוא ידני, ע"י בעלת העסק, בממשק
 * Google Calendar עצמו — ר. docs/calendar-phone-cleanup-runbook.md.
 *
 * ⚠️ אותו סדר אתחול קשיח כמו scripts/cleanup-calendar-phone.mjs: --help/
 * ארגומנט שגוי יוצאים *לפני* כל קריאת env/רשת; main() רץ רק כשהקובץ הוא
 * ה-entrypoint, לא כשהוא מיובא.
 */

import { existsSync, readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { google } from 'googleapis'
import {
  resolveAuditCliPlan,
  runLegacyAudit,
  createGoogleCalendarListClient,
} from '../lib/legacyCalendarAudit.ts'

export const USAGE = `audit read-only ל-Format A (טלפון/הערות ב-Google Calendar היסטורי) — 9C.2

read-only מוחלט: אין --execute, שום PATCH לא מתבצע בשום מצב.

שימוש:
  npm exec --no -- tsx scripts/audit-legacy-calendar-descriptions.mjs --help
  npm exec --no -- tsx scripts/audit-legacy-calendar-descriptions.mjs

--help לא קורא env ולא פותח חיבור רשת.
`

function loadEnvLocal(envPath) {
  if (!existsSync(envPath)) return null
  const env = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

function findMissingEnvNames(env) {
  const missing = []
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 && !env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    missing.push('GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 (או GOOGLE_SERVICE_ACCOUNT_KEY)')
  }
  if (!env.GOOGLE_CALENDAR_ID) missing.push('GOOGLE_CALENDAR_ID')
  return missing
}

/** ⚠️ כל catch כאן לא קושר את השגיאה — ר. ההערה המקבילה ב-cleanup-calendar-phone.mjs. */
function buildRealClient(env) {
  let credentials
  try {
    credentials = env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
      ? JSON.parse(Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf8'))
      : JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY)
  } catch {
    return { ok: false, reason: 'invalid_google_credentials_json' }
  }

  let calendar
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      // scope לקריאה בלבד — הכלי הזה לא זקוק (ולא מבקש) הרשאת כתיבה.
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    })
    calendar = google.calendar({ version: 'v3', auth })
  } catch {
    return { ok: false, reason: 'invalid_google_auth_config' }
  }

  return { ok: true, client: createGoogleCalendarListClient(calendar, env.GOOGLE_CALENDAR_ID) }
}

export async function main(argv, envPath) {
  const plan = resolveAuditCliPlan(argv)

  if (plan.kind === 'help') {
    console.log(USAGE)
    return 0
  }

  if (plan.kind === 'error') {
    console.error(plan.message)
    console.error('')
    console.error(USAGE)
    return 1
  }

  // ── מכאן והלאה: עכשיו, ורק עכשיו, נוגעים ב-env/רשת. ────────────────────

  const env = loadEnvLocal(envPath)
  if (env === null) {
    console.error('לא נמצא קובץ .env.local')
    return 1
  }

  const missing = findMissingEnvNames(env)
  if (missing.length > 0) {
    console.error('חסרים משתני סביבה נדרשים ב-.env.local:')
    for (const name of missing) console.error(`  - ${name}`)
    return 1
  }

  const built = buildRealClient(env)
  if (!built.ok) {
    console.error(`אתחול הלקוח נכשל (${built.reason}). בדקי את תוכן .env.local — אין פרטים נוספים בלוג במכוון.`)
    return 1
  }

  console.log('סורק את כל היומן (ללא הגבלת תאריך) — זה יכול לקחת זמן על יומן גדול...')

  let counts
  try {
    counts = await runLegacyAudit(built.client)
  } catch {
    console.error('הסריקה נעצרה עקב שגיאה לא צפויה. אין פרטים נוספים בלוג במכוון.')
    return 1
  }

  console.log(JSON.stringify({ counts }, null, 2))
  return 0
}

// ── Entrypoint guard: הקוד למעלה (main) לא רץ אם הקובץ רק מיובא ────────────
const isMainModule = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href
  } catch {
    return false
  }
})()

if (isMainModule) {
  const envPath = new URL('../.env.local', import.meta.url)
  const exitCode = await main(process.argv.slice(2), envPath)
  process.exit(exitCode)
}
