import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_POLICY, type AppointmentPolicy } from '@/lib/appointmentPolicy'

/**
 * טעינת מדיניות ההזזה והביטול מ-business_settings.
 *
 * עד שלב 7 הטבלה הזו הייתה תשתית בלבד: DEFAULT_POLICY ב-
 * lib/appointmentPolicy.ts החזיק את אותם ערכים כקבועים, ואף אחד לא קרא
 * מהטבלה. מכאן ואילך הטבלה היא מקור האמת, כך ששינוי מדיניות אינו מצריך
 * פריסת קוד.
 *
 * ⚠️ ההבחנה החשובה כאן היא בין שני סוגי כישלון:
 *
 *   • key בודד חסר / ערך לא תקין / ערך שלא ניתן להמרה →
 *     ברירת המחדל של *אותו key בלבד*. שאר הערכים מהטבלה נשמרים.
 *
 *   • כשל בעצם השאילתה (תקלת רשת, Supabase למטה, הרשאות) →
 *     אין מדיניות. אסור להשתמש ב-DEFAULT_POLICY בשקט: אם ההגדרות
 *     האמיתיות של העסק מחמירות יותר מברירת המחדל, "ברירת מחדל שקטה"
 *     הייתה מאפשרת ללקוחה לבטל תור שלפי המדיניות בפועל כבר נעול.
 *     במקרה כזה הפעולה נחסמת לגמרי (503), ושום דבר לא נכתב.
 *
 * אותה הבחנה בדיוק מיושמת גם בצד ה-SQL (setting_numeric/setting_boolean
 * ב-0005): key חסר → ברירת מחדל; כשל בקריאה → הטרנזקציה נופלת.
 */

export type PolicyLoadResult =
  | { ok: true; policy: AppointmentPolicy }
  | { ok: false; error: 'settings_unavailable' }

/**
 * ה-keys ב-business_settings שמרכיבים את AppointmentPolicy.
 *
 * ⚠️ 15E הסיר מכאן את deposit_reschedule_cutoff_hours,
 * allow_cancel_with_deposit ו-allow_reschedule_with_deposit. השורות
 * עצמן **נשארות בטבלה** (0022 תוספתית), אבל שום קוד אינו קורא אותן —
 * כלל אחד של 6 שעות חל על כל לקוחה, עם מקדמה או בלי.
 */
type NumericKey =
  | 'cancel_cutoff_hours'
  | 'reschedule_cutoff_hours'
  | 'max_reschedules'

/**
 * הערכים ב-business_settings.value הם jsonb — 24, false וכו'. supabase-js
 * מפענח אותם ל-number/boolean, אבל ערך שנשמר ידנית כמחרוזת ("24") עדיין
 * אפשרי, ולכן ההמרה סלחנית ומאמתת את התוצאה.
 */
function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const n = Number(raw.trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

export async function loadAppointmentPolicy(): Promise<PolicyLoadResult> {
  const db = createSupabaseAdminClient()

  let rows: { key: string; value: unknown }[]
  try {
    const { data, error } = await db.from('business_settings').select('key, value')
    if (error) {
      // הודעת השגיאה נשארת בלוג בלבד — היא לעולם לא מגיעה ללקוחה
      console.error('[businessSettings] load failed', error.message)
      return { ok: false, error: 'settings_unavailable' }
    }
    rows = (data ?? []) as { key: string; value: unknown }[]
  } catch (err) {
    console.error('[businessSettings] load threw', err instanceof Error ? err.message : String(err))
    return { ok: false, error: 'settings_unavailable' }
  }

  const byKey = new Map(rows.map(r => [r.key, r.value]))
  const policy: AppointmentPolicy = { ...DEFAULT_POLICY }

  const num = (key: NumericKey, fallback: number): number => {
    if (!byKey.has(key)) return fallback
    const parsed = toNumber(byKey.get(key))
    if (parsed === null || parsed < 0) {
      console.warn(`[businessSettings] ערך לא תקין ל-${key} — נעשה שימוש בברירת המחדל`)
      return fallback
    }
    return parsed
  }

  policy.cancelCutoffHours = num('cancel_cutoff_hours', DEFAULT_POLICY.cancelCutoffHours)
  policy.rescheduleCutoffHours = num('reschedule_cutoff_hours', DEFAULT_POLICY.rescheduleCutoffHours)
  policy.maxReschedules = num('max_reschedules', DEFAULT_POLICY.maxReschedules)

  return { ok: true, policy }
}
