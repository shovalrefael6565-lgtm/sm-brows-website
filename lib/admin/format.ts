import type { AppointmentRow } from '@/lib/db/appointments'
import { NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS } from '@/lib/services'

/** תוויות הסטטוסים בעברית — תואמות ל-appointment_status ב-DB (0001_customer_accounts.sql) */
export const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending:                { label: 'ממתינה לאישור',      className: 'bg-brand-gold/15 text-brand-gold-text border-brand-gold/40' },
  confirmed:              { label: 'מאושר',               className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  completed:              { label: 'הושלם',                className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  cancelled_by_customer:  { label: 'בוטל על ידי הלקוחה',   className: 'bg-red-50 text-red-600 border-red-200' },
  cancelled_by_business:  { label: 'בוטל על ידי העסק',     className: 'bg-red-50 text-red-600 border-red-200' },
  rescheduled:            { label: 'הוזז',                 className: 'bg-blue-50 text-blue-700 border-blue-200' },
  no_show:                { label: 'לא הגיעה',             className: 'bg-red-50 text-red-600 border-red-200' },
  expired:                { label: 'תוקף הבקשה פג',        className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
}

export function treatmentLabel(appt: Pick<AppointmentRow, 'service_key' | 'variants'>): string {
  if (appt.service_key === NATURAL_SERVICE) {
    const labels = NATURAL_VARIANTS.filter(v => appt.variants.includes(v.id)).map(v => v.label)
    return labels.length > 0 ? labels.join(' + ') : NATURAL_SERVICE
  }
  if (appt.service_key === LIFTING_SERVICE) return LIFTING_SERVICE
  return appt.service_key
}

/** "כמה זמן נשאר עד תפוגת בקשת pending" — null אם אין תפוגה או שכבר עברה */
export function formatTimeRemaining(pendingExpiresAt: string | null): string | null {
  if (!pendingExpiresAt) return null
  const diffMs = new Date(pendingExpiresAt).getTime() - Date.now()
  if (diffMs <= 0) return null
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000))
  if (hours > 0) return `נותרו ${hours} שע' ו-${minutes} דק' לתפוגה`
  return `נותרו ${minutes} דק' לתפוגה`
}

export function formatDateTimeIL(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', year: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  return { date, time }
}

// ─── CRM (שלב 9) ────────────────────────────────────────────────────────────
//
// כל תווית CRM יושבת כאן ולא מפוזרת ברכיבים, מאותו טעם ש-STATUS_LABELS
// מרוכז למעלה: מחרוזת שמופיעה בשני מקומות מתפצלת בסופו של דבר.

/** סטטוס CRM ניהולי — נפרד לחלוטין מ-appointment status ומ-is_blocked */
export const CRM_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active:   { label: 'פעילה',     className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  inactive: { label: 'לא פעילה',  className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
}

/** תוויות פעולות ה-CRM ביומן הפעילות */
export const CRM_ACTION_LABELS: Record<string, string> = {
  crm_status_changed: 'שינוי סטטוס',
  source_changed:     'שינוי מקור הגעה',
  note_created:       'נוספה הערה',
  note_updated:       'הערה עודכנה',
  note_archived:      'הערה הועברה לארכיון',
  customer_created:   'הלקוחה נוצרה במערכת הניהול',
}

/** תוויות ה-actor בהיסטוריית תור */
export const HISTORY_ACTOR_LABELS: Record<string, string> = {
  customer: 'הלקוחה',
  admin:    'הנהלה',
  system:   'המערכת',
}

export const HISTORY_ACTION_LABELS: Record<string, string> = {
  created:        'נוצר',
  rescheduled:    'הוזז',
  cancelled:      'בוטל',
  status_changed: 'שינוי סטטוס',
  expired:        'פג תוקף',
}

/**
 * מקור הפעולה. 'google_calendar' מוצג כפעולה שהגיעה מהיומן — בלי לייחס
 * אותה לשובל או לרפאל אישית, כי Google Calendar API אינו מוכיח מי גרר את
 * האירוע (ראה ההערה על appointment_history.source ב-0008).
 */
export function historySourceLabel(source: string | null): string | null {
  if (!source) return null
  if (source === 'google_calendar') return 'מיומן Google'
  if (source === 'admin_dashboard') return 'ממערכת הניהול'
  return null
}

/** הודעות שגיאה מסוננות למנהל. אף אחת אינה חושפת פרטים טכניים. */
export const CRM_ERROR_MESSAGES: Record<string, string> = {
  not_admin:              'ההרשאה שלך אינה תקפה יותר. יש להתחבר מחדש.',
  invalid_status:         'סטטוס לא חוקי.',
  invalid_source:         'מקור הגעה לא חוקי.',
  source_inactive:        'המקור הזה כבר אינו פעיל ואי אפשר לבחור בו.',
  customer_not_found:     'הלקוחה לא נמצאה.',
  note_not_found:         'ההערה לא נמצאה.',
  note_archived:          'אי אפשר לערוך הערה שהועברה לארכיון.',
  note_empty:             'לא ניתן לשמור הערה ריקה.',
  note_too_long:          'ההערה ארוכה מדי (עד 2,000 תווים).',
  idempotency_key_reused: 'התוכן השתנה מאז השליחה הקודמת. רענני את העמוד ונסי שוב.',
  missing_request_id:     'הבקשה אינה תקינה. רענני את העמוד ונסי שוב.',
  unknown:                'הפעולה נכשלה. נסי שוב.',
}

/**
 * הודעות שגיאה לפעולות הניהול של שלב 10 (יצירת לקוחה ויצירת תור).
 *
 * ⚠️ phone_taken מנוסח בכוונה בלי לומר *למי* שייך המספר: הוא מוחזר גם
 * כשהמספר שייך לחשבון מנהל, ואין להסגיר זאת.
 */
export const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  ...CRM_ERROR_MESSAGES,
  invalid_name:         'יש להזין שם מלא (2 עד 80 תווים).',
  invalid_phone:        'מספר הטלפון אינו תקין. יש להזין מספר נייד ישראלי.',
  phone_taken:          'המספר הזה כבר קיים במערכת.',
  bad_fingerprint:      'הבקשה אינה תקינה. רענני את העמוד ונסי שוב.',
  invalid_service:      'יש לבחור טיפול.',
  variants_required:    'יש לבחור לפחות תוספת אחת לטיפול.',
  invalid_variants:     'התוספות שנבחרו אינן מתאימות לטיפול הזה.',
  invalid_slot:         'המועד שנבחר אינו תקין.',
  start_in_past:        'לא ניתן לקבוע תור במועד שכבר עבר.',
  invalid_duration:     'משך הטיפול אינו תקין.',
  slot_taken:           'המועד הזה כבר תפוס. יש לבחור מועד אחר.',
  calendar_conflict:    'המועד הזה מתנגש עם אירוע קיים ביומן. יש לבחור מועד אחר.',
  calendar_unavailable: 'לא הצלחנו לבדוק את היומן כרגע. נסי שוב בעוד רגע.',
  customer_is_admin:    'לא ניתן לקבוע תור לחשבון ניהולי.',
  integrity_error:      'נמצאה אי-התאמה בנתוני הבקשה. רענני את העמוד ובדקי את רשימת התורים.',
}
