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
  /** עד כמה שעות לפני התור מותר להזיז */
  rescheduleCutoffHours: number
  /** מספר הזזות מקסימלי לתור */
  maxReschedules: number
  /** האם מותר לבטל תור ששולמה עליו מקדמה */
  allowCancelWithDeposit: boolean
  /** האם מותר להזיז תור ששולמה עליו מקדמה */
  allowRescheduleWithDeposit: boolean
  /** עד כמה שעות לפני התור מותר להזיז תור עם מקדמה (מיקרובליידינג) */
  depositRescheduleCutoffHours: number
}

/**
 * ברירות המחדל תואמות למדיניות המפורסמת בעמוד /booking-policy:
 * שינוי או ביטול מעל 24 שעות · תור עם מקדמה — מעל 48 שעות.
 * שינוי כאן מחייב עדכון גם בנוסח המדיניות באתר.
 */
export const DEFAULT_POLICY: AppointmentPolicy = {
  cancelCutoffHours: 24,
  rescheduleCutoffHours: 24,
  maxReschedules: 2,
  allowCancelWithDeposit: false,
  allowRescheduleWithDeposit: true,
  depositRescheduleCutoffHours: 48,
}

export type PolicyDenialReason =
  | 'too_late'            // עברנו את חלון הזמן
  | 'max_reschedules'     // מיצתה את מספר ההזזות
  | 'deposit_locked'      // תור עם מקדמה שלא ניתן לשנות/לבטל
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
  hasDeposit: boolean
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

  if (appt.hasDeposit && !policy.allowCancelWithDeposit) {
    return deny(
      'deposit_locked',
      'לתור זה שולמה מקדמה, ולכן הביטול מתבצע מול שובל ישירות.',
    )
  }

  if (hours < policy.cancelCutoffHours) {
    return deny(
      'too_late',
      `ניתן לבטל עד ${policy.cancelCutoffHours} שעות לפני התור. לביטול במועד קרוב יותר יש ליצור קשר בוואטסאפ.`,
    )
  }

  return ALLOWED
}

/** האם הלקוחה רשאית להזיז את התור בעצמה */
export function canReschedule(
  appt: AppointmentForPolicy,
  policy: AppointmentPolicy = DEFAULT_POLICY,
  now: Date = new Date(),
): PolicyDecision {
  if (!ACTIVE_STATUSES.includes(appt.status)) {
    return deny('not_active', 'לא ניתן לשנות תור שאינו פעיל.')
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

  if (appt.hasDeposit) {
    if (!policy.allowRescheduleWithDeposit) {
      return deny(
        'deposit_locked',
        'לתור זה שולמה מקדמה, ולכן שינוי המועד מתבצע מול שובל ישירות.',
      )
    }
    // תור עם מקדמה — חלון זמן מחמיר יותר
    if (hours < policy.depositRescheduleCutoffHours) {
      return deny(
        'too_late',
        `תור ששולמה עליו מקדמה ניתן להזזה עד ${policy.depositRescheduleCutoffHours} שעות מראש. יש ליצור קשר בוואטסאפ.`,
      )
    }
    return ALLOWED
  }

  if (hours < policy.rescheduleCutoffHours) {
    return deny(
      'too_late',
      `ניתן לשנות מועד עד ${policy.rescheduleCutoffHours} שעות לפני התור. לשינוי במועד קרוב יותר יש ליצור קשר בוואטסאפ.`,
    )
  }

  return ALLOWED
}
