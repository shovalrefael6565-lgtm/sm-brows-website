import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpHash,
  otpExpiryDate,
  checkOtpRateLimit,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_DAY,
  type RateLimitDecision,
} from '@/lib/otp'

/**
 * גישה לטבלת otp_attempts — הצד שנוגע בבסיס הנתונים.
 *
 * הלוגיקה הטהורה (יצירת קוד, גיבוב, הגבלות) יושבת ב-lib/otp.ts ונבדקת שם
 * בלי DB. כאן רק הקריאות עצמן.
 *
 * הטבלה נגישה רק ל-service_role — אין עליה שום RLS policy — ולכן הקובץ
 * הזה חייב להישאר server-only.
 */

export type OtpPurpose = 'login' | 'booking'

export interface IssueResult {
  ok: boolean
  code?: string          // מוחזר לקורא כדי שישלח ב-SMS; לא נשמר בשום מקום
  expiresAt?: Date
  limit?: RateLimitDecision
}

/**
 * מייצר קוד חדש ושומר את הגיבוב שלו — אחרי בדיקת הגבלות קצב.
 *
 * ההגבלות נבדקות מול היסטוריית השליחות האמיתית ב-DB, ולא מול מונה בזיכרון,
 * כדי שהן יחזיקו גם כשהאתר רץ בכמה מופעים (כמו ב-Vercel).
 */
export async function issueOtp(
  phoneE164: string,
  purpose: OtpPurpose,
  ip: string | null,
): Promise<IssueResult> {
  const db = createSupabaseAdminClient()
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()

  // היסטוריית השליחות למספר הזה ביממה האחרונה
  const { data: recent, error: recentErr } = await db
    .from('otp_attempts')
    .select('created_at')
    .eq('phone_e164', phoneE164)
    .gte('created_at', dayAgo)
    .order('created_at', { ascending: false })
    .limit(OTP_MAX_PER_DAY + 1)

  if (recentErr) {
    console.error('[otp] failed to read history', recentErr.message)
    return { ok: false }
  }

  // כמה בקשות הגיעו מאותו מקור בשעה האחרונה — מונע סריקה על פני מספרים רבים
  let countForIpLastHour = 0
  if (ip) {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count } = await db
      .from('otp_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', hourAgo)
    countForIpLastHour = count ?? 0
  }

  const limit = checkOtpRateLimit({
    recentForPhone: (recent ?? []).map(r => new Date(r.created_at as string)),
    countForIpLastHour,
  })
  if (!limit.allowed) return { ok: false, limit }

  const code = generateOtpCode()
  const expiresAt = otpExpiryDate()

  const { error } = await db.from('otp_attempts').insert({
    phone_e164: phoneE164,
    code_hash: hashOtpCode(code, phoneE164),
    purpose,
    expires_at: expiresAt.toISOString(),
    ip,
  })

  if (error) {
    console.error('[otp] failed to store code', error.message)
    return { ok: false }
  }

  return { ok: true, code, expiresAt }
}

export type VerifyOutcome =
  | 'ok'
  | 'no_code'        // לא נשלח קוד למספר הזה
  | 'expired'        // פג תוקף
  | 'too_many'       // מוצו הניסיונות
  | 'wrong'          // קוד שגוי
  | 'error'

/**
 * מאמת קוד מול הרשומה הפעילה האחרונה.
 *
 * שריפת הקוד מיד עם ההצלחה (consumed_at) היא מה שהופך אותו לחד-פעמי —
 * אותו קוד לא יאפשר התחברות שנייה.
 */
export async function verifyOtp(
  phoneE164: string,
  purpose: OtpPurpose,
  code: string,
): Promise<VerifyOutcome> {
  const db = createSupabaseAdminClient()

  const { data: rows, error } = await db
    .from('otp_attempts')
    .select('id, code_hash, expires_at, attempts, consumed_at')
    .eq('phone_e164', phoneE164)
    .eq('purpose', purpose)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('[otp] failed to read code', error.message)
    return 'error'
  }

  const row = rows?.[0]
  if (!row) return 'no_code'

  if (new Date(row.expires_at as string).getTime() < Date.now()) return 'expired'
  if ((row.attempts as number) >= OTP_MAX_ATTEMPTS) return 'too_many'

  const matches = verifyOtpHash(row.code_hash as string, code, phoneE164)

  if (!matches) {
    // מונה הניסיונות עולה גם בכישלון — אחרת אפשר לנחש 10^6 קודים בלי הגבלה
    await db
      .from('otp_attempts')
      .update({ attempts: (row.attempts as number) + 1 })
      .eq('id', row.id)
    return (row.attempts as number) + 1 >= OTP_MAX_ATTEMPTS ? 'too_many' : 'wrong'
  }

  await db
    .from('otp_attempts')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)

  return 'ok'
}
