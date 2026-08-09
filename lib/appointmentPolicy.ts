/**
 * מדיניות שינוי וביטול — הלוגיקה שקובעת מה לקוחה רשאית לעשות בתור שלה.
 *
 * הערכים כאן הם ברירות מחדל בלבד. בזמן ריצה הם נטענים מטבלת
 * business_settings ומאפשרים לשנות מדיניות בלי פריסת קוד. הפונקציות
 * טהורות (pure) כדי שאפשר יהיה לבדוק אותן ולהריץ אותן גם בשרת וגם בדפדפן.
 *
 * ⚠️ הפונקציות האלה מיועדות לאכיפה בצד השרת. השימוש בצד הלקוח הוא רק
 * להצגת כפתורים והודעות — לעולם לא כתחליף לבדיקה בשרת.
 */

export interface AppointmentPolicy {
  /** עד כמה שעות לפני התור מותר לבטל */
  cancelCutoffHours: number
  /** עד כמה שעות לפני התור מותר לבקש שינוי מועד */
  rescheduleCutoffHours: number
  /** מספר הזזות מקסימלי לשרשרת התור */
  maxReschedules: number
}

/**
 * ⚠️ **15E — כלל אחד, 6 שעות, לכל לקוחה.**
 *
 * עד 15E היה כאן מסלול מקביל למקדמה: 48 שעות להזזה, וחסימה מוחלטת
 * לביטול (allow_cancel_with_deposit=false). המסלול הזה **בוטל במפורש**
 * — has_deposit אינו משפיע יותר על ניהול עצמי. שלוש התכונות שהחזיקו
 * אותו (allowCancelWithDeposit, allowRescheduleWithDeposit,
 * depositRescheduleCutoffHours) הוסרו כאן ולא נקראות יותר ב-RPCs.
 *
 * ה-keys deposit_reschedule_cutoff_hours ו-allow_cancel_with_deposit
 * נשארים בטבלת business_settings (0022 היא מיגרציה תוספתית ואינה מוחקת
 * שורות), אבל שום קוד אינו קורא אותם.
 *
 * ⚠️ הערכים כאן הם **ברירות מחדל בלבד**, ומשמשים רק כש-key בודד חסר
 * מהטבלה. בפרודקשן cancel_cutoff_hours ו-reschedule_cutoff_hours כבר
 * שווים 6, ולכן ברירת המחדל אינה נכנסת לפעולה בפועל — היא קיימת כדי
 * שמחיקה בטעות לא תחזיר בשקט את הכלל הישן של 24 שעות.
 *
 * 🔒 שינוי הערכים כאן מחייב עדכון גם בנוסח המדיניות באתר:
 * components/booking-policy/BookingPolicyContent.tsx ו-
 * components/faq/FaqContent.tsx.
 */
export const DEFAULT_POLICY: AppointmentPolicy = {
  cancelCutoffHours: 6,
  rescheduleCutoffHours: 6,
  maxReschedules: 2,
}

export type PolicyDenialReason =
  | 'too_late'            // עברנו את חלון הזמן
  | 'max_reschedules'     // מיצתה את מספר ההזזות
  | 'not_active'          // התור כבר בוטל / הושלם
  | 'in_past'             // התור כבר עבר

export interface PolicyDecision {
  allowed: boolean
  reason?: PolicyDenialReason
  /** נוסח בעברית להצגה ללקוחה */
  message?: string
}

export interface AppointmentForPolicy {
  startsAt: Date
  status: string
  rescheduleCount: number
  /**
   * ⚠️ נשמר בטיפוס כי הוא עדיין נתון אמיתי על התור ומוצג בניהול, אבל
   * **אינו משפיע יותר** על canCancel/canRequestReschedule (החלטת 15E).
   */
  hasDeposit?: boolean
}

const ACTIVE_STATUSES = ['pending', 'confirmed']

const ALLOWED: PolicyDecision = { allowed: true }

function deny(reason: PolicyDenialReason, message: string): PolicyDecision {
  return { allowed: false, reason, message }
}

function hoursUntil(startsAt: Date, now: Date): number {
  return (startsAt.getTime() - now.getTime()) / 3_600_000
}

/** האם הלקוחה רשאית לבטל את התור בעצמה */
export function canCancel(
  appt: AppointmentForPolicy,
  policy: AppointmentPolicy = DEFAULT_POLICY,
  now: Date = new Date(),
): PolicyDecision {
  if (!ACTIVE_STATUSES.includes(appt.status)) {
    return deny('not_active', 'לא ניתן לבטל תור שאינו פעיל.')
  }

  const hours = hoursUntil(appt.startsAt, now)
  if (hours <= 0) {
    return deny('in_past', 'מועד התור כבר עבר.')
  }

  // ⚠️ 15E — אין כאן ענף has_deposit. כלל אחד לכל לקוחה.
  if (hours < policy.cancelCutoffHours) {
    return deny(
      'too_late',
      `ניתן לבטל עד ${policy.cancelCutoffHours} שעות לפני התור. לביטול במועד קרוב יותר יש ליצור קשר בוואטסאפ.`,
    )
  }

  return ALLOWED
}

/**
 * האם הלקוחה רשאית **לבקש** שינוי מועד.
 *
 * ⚠️ שם הפונקציה השתנה מ-canReschedule בכוונה. עד 15E לחיצה על "שינוי
 * מועד" *הזיזה את התור*; מ-15E היא פותחת **בקשה** שממתינה לשובל, והתור
 * המקורי נשאר confirmed וחוסם את שעתו עד ההכרעה. שם הפונקציה חייב
 * לשקף את ההבדל הזה כדי שקורא עתידי לא יניח את הסמנטיקה הישנה.
 */
export function canRequestReschedule(
  appt: AppointmentForPolicy,
  policy: AppointmentPolicy = DEFAULT_POLICY,
  now: Date = new Date(),
): PolicyDecision {
  // ⚠️ רק תור **מאושר** ניתן להזזה: בקשה שממתינה לאישור עדיין לא תפסה
  // מקום עסקי, ו-15E אינו מגדיר "הזזה של בקשה".
  if (appt.status !== 'confirmed') {
    return deny('not_active', 'ניתן לבקש שינוי מועד רק לתור מאושר.')
  }

  const hours = hoursUntil(appt.startsAt, now)
  if (hours <= 0) {
    return deny('in_past', 'מועד התור כבר עבר.')
  }

  if (appt.rescheduleCount >= policy.maxReschedules) {
    return deny(
      'max_reschedules',
      `ניתן להזיז תור עד ${policy.maxReschedules} פעמים. לשינוי נוסף יש ליצור קשר בוואטסאפ.`,
    )
  }

  // ⚠️ 15E — אין כאן ענף has_deposit.
  if (hours < policy.rescheduleCutoffHours) {
    return deny(
      'too_late',
      `ניתן לבקש שינוי מועד עד ${policy.rescheduleCutoffHours} שעות לפני התור. לשינוי במועד קרוב יותר יש ליצור קשר בוואטסאפ.`,
    )
  }

  return ALLOWED
}
