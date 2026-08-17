/**
 * 9C.2 — כלי CLI חד-פעמי: מנקה את שורת הטלפון מ-description של אירועי
 * Google Calendar היסטוריים (Format B — נוצרו ע"י createAppointmentEvent,
 * מקושרים ל-DB דרך appointments.google_event_id + extendedProperties).
 *
 * ⚠️⚠️⚠️ אל תריצי את הכלי הזה — לא dry-run ולא execute — לפני שאומת
 * *בפועל* (לא רק commit מקומי) שהגרסה שכבר לא כותבת טלפון ל-description
 * פרוסה בפרודקשן. אחרת אירועים חדשים ימשיכו להיווצר עם טלפון גם אחרי
 * שהניקוי ירוץ. סדר נכון: deploy → verify → dry-run → אישור → execute.
 * ר. docs/calendar-phone-cleanup-runbook.md.
 *
 * ברירת מחדל: dry-run (לעולם לא PATCH). שני שערי אישור, בכוונה קשים
 * לטעות:
 *   --deployment-confirm=PHONE_FREE_CREATION_DEPLOYED_V1   (חובה תמיד)
 *   --execute --confirm=REMOVE_LINKED_CALENDAR_PHONE_V1    (רק ל-execute)
 *
 * שימוש (tsx מקומי — לא npx, כדי לא להסתכן בהורדת חבילה):
 *   npm exec --no -- tsx scripts/cleanup-calendar-phone.mjs --help
 *   npm exec --no -- tsx scripts/cleanup-calendar-phone.mjs --deployment-confirm=PHONE_FREE_CREATION_DEPLOYED_V1
 *   npm exec --no -- tsx scripts/cleanup-calendar-phone.mjs --deployment-confirm=PHONE_FREE_CREATION_DEPLOYED_V1 \
 *     --execute --confirm=REMOVE_LINKED_CALENDAR_PHONE_V1 [--batch-size=100]
 *
 * ⚠️ הלוגיקה עצמה (sanitizer, בעלות, retry, לולאה) חיה ב-
 * lib/calendarPhoneCleanup.ts — טהורה, בדוקה בלי DB/רשת ב-
 * scripts/test-calendar-phone-cleanup.mjs. הקובץ הזה הוא רק חיווט: קריאת
 * env, בניית לקוחות אמיתיים, הרצה, הדפסת counts. אין כאן שום לוגיקה
 * עסקית משלו.
 *
 * ⚠️ סדר אתחול קשיח, לא רק כוונה:
 *   1. resolveCleanupCliPlan — טהורה, לא נוגעת ב-env/רשת.
 *   2. --help / ארגומנט שגוי → יציאה כאן, *לפני* כל קריאת env/קובץ/רשת.
 *   3. רק אחרי ששני שערי האישור עברו: קריאת .env.local, בניית לקוחות.
 * כל השלבים האלה חיים בתוך main(), ומופעלים רק כשהקובץ *הוא* ה-entrypoint
 * (ר. תנאי ה-import.meta.url למטה) — ייבוא הקובץ הזה ממקום אחר (בדיקה,
 * סקריפט אחר) לא מריץ שום דבר כתופעת לוואי.
 */

import { existsSync, readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import {
  resolveCleanupCliPlan,
  runCleanup,
  createSupabaseAppointmentLinkReader,
  createGoogleCalendarEventClient,
  DEPLOYMENT_CONFIRM_VALUE,
  EXECUTE_CONFIRM_VALUE,
  DEFAULT_BATCH_SIZE,
  MIN_BATCH_SIZE,
  MAX_BATCH_SIZE,
} from '../lib/calendarPhoneCleanup.ts'

export const USAGE = `כלי ניקוי טלפון מ-Google Calendar (Format B) — 9C.2

⚠️ אל תריצי לפני שאומת בפועל ש-deploy+verify של הקוד נטול-הטלפון הושלמו.
   ר. docs/calendar-phone-cleanup-runbook.md.

שימוש:
  npm exec --no -- tsx scripts/cleanup-calendar-phone.mjs --help
  npm exec --no -- tsx scripts/cleanup-calendar-phone.mjs --deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}
  npm exec --no -- tsx scripts/cleanup-calendar-phone.mjs --deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE} \\
    --execute --confirm=${EXECUTE_CONFIRM_VALUE} [--batch-size=N]

דגלים:
  --deployment-confirm=${DEPLOYMENT_CONFIRM_VALUE}   חובה תמיד (dry-run וגם execute)
  --execute                                                     מעבר ממצב dry-run (ברירת מחדל) לביצוע בפועל
  --confirm=${EXECUTE_CONFIRM_VALUE}                 חובה רק עם --execute
  --batch-size=N                                                ${MIN_BATCH_SIZE}-${MAX_BATCH_SIZE}, ברירת מחדל ${DEFAULT_BATCH_SIZE}
  --help                                                        התיעוד הזה בלבד — לא קורא env, לא פותח חיבור רשת
`

const REQUIRED_ENV_NAMES = {
  google: ['GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 (או GOOGLE_SERVICE_ACCOUNT_KEY)', 'GOOGLE_CALENDAR_ID'],
  supabase: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
}

/** קורא .env.local ידנית (לא process.env של Next) — כמו שאר סקריפטי ה-live בפרויקט. */
function loadEnvLocal(envPath) {
  if (!existsSync(envPath)) return null
  const env = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

/** בדיקת *קיום* בלבד — לעולם לא מחזירים/מדפיסים ערך. */
function findMissingEnvNames(env) {
  const missing = []
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 && !env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    missing.push(REQUIRED_ENV_NAMES.google[0])
  }
  if (!env.GOOGLE_CALENDAR_ID) missing.push(REQUIRED_ENV_NAMES.google[1])
  if (!env.NEXT_PUBLIC_SUPABASE_URL) missing.push(REQUIRED_ENV_NAMES.supabase[0])
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push(REQUIRED_ENV_NAMES.supabase[1])
  return missing
}

/**
 * ⚠️ כל catch בקובץ הזה *לא קושר* את השגיאה לשם משתנה כלשהו — לא רק
 * כוונה, הגבלה מבנית: קוד שאינו יכול להתייחס לאובייקט השגיאה לא יכול
 * להדליף ממנו תוכן כלשהו, גם בטעות. הפלט היחיד הוא slug קבוע.
 */
function buildRealClients(env) {
  let credentials
  try {
    credentials = env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64
      ? JSON.parse(Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf8'))
      : JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY)
  } catch {
    return { ok: false, reason: 'invalid_google_credentials_json' }
  }

  let db
  try {
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  } catch {
    return { ok: false, reason: 'invalid_supabase_config' }
  }

  let calendar
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    })
    calendar = google.calendar({ version: 'v3', auth })
  } catch {
    return { ok: false, reason: 'invalid_google_auth_config' }
  }

  return {
    ok: true,
    reader: createSupabaseAppointmentLinkReader(db),
    calendar: createGoogleCalendarEventClient(calendar, env.GOOGLE_CALENDAR_ID),
  }
}

export async function main(argv, envPath) {
  const plan = resolveCleanupCliPlan(argv)

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

  // ── מכאן והלאה: הפלאגים תקינים. עכשיו, ורק עכשיו, נוגעים ב-env/רשת. ────

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

  const clients = buildRealClients(env)
  if (!clients.ok) {
    console.error(`אתחול הלקוחות נכשל (${clients.reason}). בדקי את תוכן .env.local — אין פרטים נוספים בלוג במכוון.`)
    return 1
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

  console.log(`מצב: ${plan.mode === 'execute' ? 'EXECUTE — כתיבה בפועל' : 'dry-run — ללא כתיבה'} | batch-size: ${plan.batchSize}`)

  let outcome
  try {
    outcome = await runCleanup({
      reader: clients.reader,
      calendar: clients.calendar,
      sleep,
      batchSize: plan.batchSize,
      mode: plan.mode,
    })
  } catch {
    // לעולם לא raw message/stack — עלולים לשאת פרטי בקשה/URL/secret.
    console.error('הריצה נעצרה עקב שגיאה לא צפויה (DB או רשת). אין פרטים נוספים בלוג במכוון.')
    return 1
  }

  console.log(JSON.stringify({ mode: plan.mode, batchSize: plan.batchSize, counts: outcome.counts }, null, 2))

  if (outcome.kind === 'aborted_auth_error') {
    console.error('נעצר: שגיאת אימות/הרשאות (401/403) מול Google Calendar. הסריקה לא הושלמה.')
    return 1
  }

  if (outcome.counts.transient_failure > 0) {
    console.error(`${outcome.counts.transient_failure} אירועים נכשלו אחרי מיצוי retries. ניתן להריץ שוב — הכלי idempotent.`)
    return 1
  }

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
