import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual, createHash } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { readJsonWithLimit } from '@/lib/http/bodyLimit'

export const dynamic = 'force-dynamic'

/**
 * 9B — נקודת הרצה פנימית לניקוי retention. scheduler-neutral: מוכנה לתזמון
 * עתידי (Vercel Cron או QStash, ר' docs/data-retention-policy.md), ולא
 * מחוברת לאף אחד מהם כרגע. אין vercel.json, אין cron מוגדר.
 *
 * ═══ חוזה קודי התגובה — אותו דפוס בדיוק כמו app/api/internal/reminders ═══
 *
 *   404 — PRIVACY_RETENTION_SECRET אינו מוגדר, או קצר מ-32 תווים.
 *   405 — method שאינו POST.
 *   401 — כשל אימות בלבד (אין Authorization, scheme אחר, secret שגוי).
 *   413/400 — גוף בקשה חורג מ-4KB / JSON לא תקין / גוף שאינו object.
 *   200 — הבקשה אומתה. ברירת המחדל היא dry-run בלבד.
 *
 * 🔒 9B.1 — **כל תגובה, ללא יוצא מן הכלל, כולל 400/401/404/405/413/500,
 * נושאת Cache-Control: private, no-store.** נעשה דרך noStore() למטה,
 * כדי שלא יהיה נתיב תגובה ששוכח את הכותרת.
 *
 * ═══ ברירת המחדל היא תצוגה מקדימה, לא ביצוע ═══
 *
 * mode='dry_run' (או שדה mode חסר) → קוראת רק ל-privacy_retention_dry_run,
 * ספירות בלבד, אינה נוגעת בנתונים.
 *
 * mode='execute' דורשת **שני** תנאים בו-זמנית:
 *   1. body.mode === 'execute'
 *   2. body.confirm === 'APPLY_RETENTION_V1'
 * חסר אחד מהם → 400, ואינה מבצעת דבר. זו הגנה מפני הרצת execute בטעות
 * ע"י scheduler שהוגדר בחיפזון עם body ריק/דיפולטי.
 *
 * execute מפעילה **רק** את שלוש פונקציות ה-v1 הבטוחות (0032): OTP+sessions,
 * ניסיוני התראה סגורים, ואיפוס notes ישנות. אין מחיקת appointment_reminder_
 * attempts, אין מחיקת rejected, ואין שום פעולה ברמת לקוחה (ארכוב/אנונימיזציה)
 * — אלה נשארות ידניות, ר' docs/data-retention-policy.md.
 *
 * ⚠️ 9B.1 — **execute אינה טרנזקציה אטומית אחת.** שלוש הקריאות רצות
 * במקביל (Promise.all), כל אחת RPC נפרד עם ה-transaction הפנימית שלה.
 * כשל באמצע (למשל timeout ברשת בין ה-route ל-Postgres) עלול להשאיר
 * ביצוע חלקי — חלק מהשלוש הצליחו, חלק לא. זה **בטוח להרצה חוזרת**: כל
 * שלוש הפונקציות idempotent (batch שכבר נוקה מוחזר כ-0 בפעם הבאה), ולכן
 * קריאה נוספת ל-execute לאחר כשל חלקי משלימה את מה שנשאר בלי לשכפל דבר.
 * ראה תיעוד מפורש ב-docs/data-retention-policy.md.
 *
 * ═══ ההגנה ═══
 *
 *   • secret נפרד לגמרי מ-REMINDERS_DISPATCH_SECRET ומ-CALENDAR_SYNC_SECRET.
 *   • השוואה בזמן קבוע — שני הצדדים עוברים sha256 לפני timingSafeEqual,
 *     ולכן תמיד באותו אורך (32 בייט) גם כשה-token הגולמי קצר/ארוך/ריק.
 *   • secret מתקבל אך ורק מכותרת Authorization — לעולם לא מ-query string,
 *     לעולם לא מגוף הבקשה.
 *   • הגוף מוגבל ל-4KB, נאכף **לפני** JSON.parse (readJsonWithLimit).
 *   • גוף שאינו JSON object (מערך/מחרוזת/מספר/null) נדחה כ-400.
 *   • שגיאת פענוח/type אינה מחזירה את תוכן הבקשה בתגובה.
 *   • התגובה והלוגים הם ספירות/קודי שגיאה בלבד — לעולם לא PII, IDs, notes,
 *     טלפון או ה-secret עצמו.
 */

/**
 * תקרת body קשיחה — 4KB. הבקשה האמיתית (mode/confirm/batchLimit) קטנה
 * בסדרי גודל. מיוצא כדי שבדיקה תוכל לאמת את הערך *האמיתי* שה-route
 * משתמש בו (ר' scripts/test-api-hardening.mjs), לא ערך מנוחש/משוכפל.
 */
export const MAX_BODY_BYTES = 4096

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const

function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * 9B.2 — כל method שאינו POST נדחה כאן, ולא ע"י ברירת המחדל הלא-מבוקרת
 * של Next.js. `Allow: POST` הוא חובה ב-405 לפי RFC 7231 §6.5.5, ולא רק
 * תוספת נחמדה — לקוח (או סורק) תקין אמור להסתמך עליו כדי לדעת מה כן מותר.
 *
 * 🔒 אין כאן שום כותרת Access-Control-*: זהו route פנימי server-to-server
 * בלבד, לא endpoint שאמור לתמוך בקריאות דפדפן חוצות-מקור. OPTIONS נדחה
 * באותה צורה בדיוק כמו כל method אחר שאינו POST — לא preflight מוצלח.
 */
function methodNotAllowed() {
  return NextResponse.json(
    { error: 'method_not_allowed' },
    { status: 405, headers: { ...NO_STORE, Allow: 'POST' } },
  )
}

/** HEAD/OPTIONS: אותם headers בדיוק, אבל בלי גוף תגובה כלל — לא רק גוף ריק בתוך JSON. */
function methodNotAllowedNoBody() {
  return new NextResponse(null, { status: 405, headers: { ...NO_STORE, Allow: 'POST' } })
}

export async function GET() { return methodNotAllowed() }
export async function PUT() { return methodNotAllowed() }
export async function PATCH() { return methodNotAllowed() }
export async function DELETE() { return methodNotAllowed() }
export async function HEAD() { return methodNotAllowedNoBody() }
export async function OPTIONS() { return methodNotAllowedNoBody() }

export async function POST(req: NextRequest) {
  const secret = process.env.PRIVACY_RETENTION_SECRET

  // לא מוגדר, או קצר מכדי להיות סוד אמיתי → אין route. נבדק *לפני* כל
  // קריאה ל-body, כדי שסביבה לא-מוגדרת לא תבצע שום עבודה מיותרת.
  if (!secret || secret.length < 32) {
    return noStore({ error: 'not_found' }, 404)
  }

  const token = bearerToken(req.headers.get('authorization'))
  if (!token || !secretsMatch(token, secret)) {
    return noStore({ error: 'unauthorized' }, 401)
  }

  // ⚠️ בקשה בלי body בכלל (req.body === null, למשל curl -X POST בלי -d)
  // היא ברירת המחדל התקינה — dry-run. body שכן נשלח עובר readJsonWithLimit
  // עם תקרת 4KB, ככל בקשה אחרת, וכשל פענוח/type אמיתי עדיין נדחה כ-400/413.
  type Body = { mode?: unknown; confirm?: unknown; batchLimit?: unknown }
  let body: Body = {}
  if (req.body) {
    const bodyResult = await readJsonWithLimit<unknown>(req, MAX_BODY_BYTES)
    if (!bodyResult.ok) {
      return noStore({ error: 'bad_request' }, bodyResult.status)
    }
    // 🔒 9B.1 — JSON תקין אך אינו object (מערך/מחרוזת/מספר/null/boolean)
    // נדחה במפורש. בלי הבדיקה הזו, גישה ל-body.mode על ערך פרימיטיבי
    // הייתה "מצליחה בשקט" (undefined) במקום להיכשל בקול על קלט שגוי.
    if (typeof bodyResult.body !== 'object' || bodyResult.body === null
        || Array.isArray(bodyResult.body)) {
      return noStore({ error: 'bad_request' }, 400)
    }
    body = bodyResult.body as Body
  }

  const mode = body.mode === 'execute' ? 'execute' : 'dry_run'

  let batchLimit = 1000
  if (body.batchLimit !== undefined) {
    if (typeof body.batchLimit !== 'number' || !Number.isInteger(body.batchLimit)
        || body.batchLimit < 1 || body.batchLimit > 5000) {
      return noStore({ error: 'bad_batch_limit' }, 400)
    }
    batchLimit = body.batchLimit
  }

  const db = createSupabaseAdminClient()

  if (mode === 'dry_run') {
    const { data, error } = await db.rpc('privacy_retention_dry_run', { p_batch_limit: batchLimit })
    if (error) {
      console.error('[internal/privacy-retention] dry_run failed', error.code ?? 'unknown')
      return noStore({ ok: false, error: 'dry_run_failed' }, 500)
    }
    return noStore({ ok: true, mode: 'dry_run', result: data })
  }

  // ── mode === 'execute' ────────────────────────────────────────────────────
  if (body.confirm !== 'APPLY_RETENTION_V1') {
    return noStore({ error: 'confirm_required' }, 400)
  }

  // ⚠️ שלוש קריאות RPC עצמאיות, לא טרנזקציה אחת — ר' התיעוד בראש הקובץ
  // וב-docs/data-retention-policy.md. כל אחת idempotent בפני עצמה.
  const [otpSessions, notificationAttempts, notesReset] = await Promise.all([
    db.rpc('privacy_retention_purge_otp_sessions', { p_batch_limit: batchLimit }),
    db.rpc('privacy_retention_purge_notification_attempts', { p_batch_limit: batchLimit }),
    db.rpc('privacy_retention_reset_old_notes', { p_batch_limit: batchLimit }),
  ])

  for (const [name, res] of [
    ['otp_sessions', otpSessions],
    ['notification_attempts', notificationAttempts],
    ['notes_reset', notesReset],
  ] as const) {
    if (res.error) {
      console.error(`[internal/privacy-retention] ${name} failed`, res.error.code ?? 'unknown')
    }
  }

  return noStore({
    ok: true,
    mode: 'execute',
    result: {
      otp_sessions: otpSessions.error ? null : otpSessions.data,
      notification_attempts: notificationAttempts.error ? null : notificationAttempts.data,
      notes_reset: notesReset.error ? null : notesReset.data,
    },
  })
}

/** מחלץ את ה-token מ-`Authorization: Bearer <token>`. ראה app/api/internal/reminders/route.ts. */
function bearerToken(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer[ \t]+(\S.*)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1].trim()
  return token.length > 0 ? token : null
}

/**
 * השוואה בזמן קבוע. שני הצדדים עוברים sha256 תחילה כדי שהאורכים יהיו תמיד
 * שווים (32 בייט) — timingSafeEqual זורק על buffers באורך שונה, וההבדל
 * באורך עצמו הוא דליפה. ר' app/api/internal/reminders/route.ts.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}
