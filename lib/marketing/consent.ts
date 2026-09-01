/**
 * הסכמת דיוור מטופס ההזמנה — הלוגיקה הטהורה.
 *
 * ═══ למה זה קובץ נפרד ═════════════════════════════════════════════════════
 *
 * שתי החלטות שאסור להן להיקבר בתוך קריאת DB:
 *
 *   1. **מה בדיוק נכתב כשלקוחה מסמנת את התיבה** — כולל ניקוי
 *      marketing_opted_out_at. סימון מחדש אחרי הסרה הוא re-consent מפורש:
 *      הלקוחה ראתה את הנוסח וסימנה אותו בעצמה עכשיו, ולכן ההסרה הישנה
 *      אינה גוברת על הבחירה החדשה שלה. בלי הניקוי, ההסכמה החדשה הייתה
 *      נרשמת ונשארת חסרת משמעות — decideRecipient חוסם קודם כול לפי
 *      opted_out.
 *   2. **מה מוצג ב-CRM** — שלושה מצבים, לא שניים. "לא אושר" ו-"הוסרה
 *      מדיוור" הם מצבים שונים לחלוטין: הראשון פירושו שאיש לא ביקש דבר,
 *      השני הוא בקשה מפורשת של הלקוחה שחוסמת דיוור בפועל.
 *
 * ⚠️ אין כאן DB ואין רשת — כדי שאפשר יהיה לבדוק את שניהם על כל צירוף.
 */

/** המקור היחיד שנרשם ממסלול ההזמנה. מוגבל ע"י CHECK ב-0035. */
export const BOOKING_CONSENT_SOURCE = 'booking_form'

/**
 * העדכון המדויק שנכתב ל-customers כשלקוחה סימנה את תיבת הדיוור.
 *
 * 🔴 `marketing_consent_by: null` בכוונה — ההסכמה ניתנה ע"י הלקוחה עצמה
 * ולא ע"י מנהלת. השארת actor ישן מתיעוד `admin_recorded` קודם הייתה
 * מייחסת את ההסכמה החדשה למנהלת שלא נגעה בה.
 */
export function buildBookingConsentUpdate(now: Date) {
  return {
    marketing_consent: true,
    marketing_consent_at: now.toISOString(),
    marketing_consent_source: BOOKING_CONSENT_SOURCE,
    marketing_consent_by: null,
    /** 🔴 re-consent מפורש — ראה ההערה בראש הקובץ */
    marketing_opted_out_at: null,
  } as const
}

export type MarketingConsentStatus = 'opted_out' | 'granted' | 'none'

export interface MarketingConsentState {
  consent: boolean
  /** לא null ⟹ הלקוחה הסירה את עצמה מדיוור */
  optedOutAt: string | null
}

/**
 * ⚠️ הסרה מדיוור **גוברת תמיד** על ההסכמה, בדיוק כמו ב-decideRecipient.
 * הצגת "מאושר" ללקוחה שהסירה את עצמה הייתה שולחת את שובל לשלוח לה.
 */
export function marketingConsentStatus(s: MarketingConsentState): MarketingConsentStatus {
  if (s.optedOutAt !== null) return 'opted_out'
  return s.consent ? 'granted' : 'none'
}

export const MARKETING_CONSENT_STATUS_LABELS: Record<MarketingConsentStatus, string> = {
  granted: 'מאושר',
  none: 'לא אושר',
  opted_out: 'הוסרה מדיוור',
}
