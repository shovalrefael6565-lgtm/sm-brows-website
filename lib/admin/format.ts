import type { AppointmentRow } from '@/lib/db/appointments'
import { NATURAL_SERVICE, LIFTING_SERVICE, NATURAL_VARIANTS } from '@/lib/services'
import { israelDateStr, fmtIsrael } from '@/lib/israelTime'

/**
 * תוויות הסטטוסים בעברית — תואמות ל-appointment_status ב-DB
 * (0001_customer_accounts.sql, + 'expired' ב-0002, + 'rejected' ב-0016).
 *
 * ⚠️ 'rejected' ו-'cancelled_by_business' הם **שתי עובדות שונות** ולכן שתי
 * תוויות שונות: הראשונה = בקשה שמעולם לא אושרה ונדחתה; השנייה = תור שכבר
 * היה מאושר ובוטל. מיזוגן לתווית אחת היה מבטל את כל מטרת 0019.
 */
export const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending:                { label: 'ממתינה לאישור',      className: 'bg-brand-gold/15 text-brand-gold-text border-brand-gold/40' },
  confirmed:              { label: 'מאושר',               className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  completed:              { label: 'הושלם',                className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  cancelled_by_customer:  { label: 'בוטל על ידי הלקוחה',   className: 'bg-red-50 text-red-600 border-red-200' },
  cancelled_by_business:  { label: 'בוטל על ידי העסק',     className: 'bg-red-50 text-red-600 border-red-200' },
  rejected:               { label: 'הבקשה נדחתה',          className: 'bg-red-50 text-red-600 border-red-200' },
  rescheduled:            { label: 'הוזז',                 className: 'bg-blue-50 text-blue-700 border-blue-200' },
  no_show:                { label: 'לא הגיעה',             className: 'bg-red-50 text-red-600 border-red-200' },
  expired:                { label: 'תוקף הבקשה פג',        className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
}

/** מקור הבקשה, לתצוגה בכרטיס הבקשה הממתינה. */
export const BOOKING_SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  public_booking: { label: 'טופס באתר',   className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  personal_area:  { label: 'אזור אישי',   className: 'bg-blue-50 text-blue-700 border-blue-200' },
  admin_manual:   { label: 'נקבע בניהול', className: 'bg-purple-50 text-purple-700 border-purple-200' },
}

export function treatmentLabel(appt: Pick<AppointmentRow, 'service_key' | 'variants'>): string {
  if (appt.service_key === NATURAL_SERVICE) {
    const labels = NATURAL_VARIANTS.filter(v => appt.variants.includes(v.id)).map(v => v.label)
    return labels.length > 0 ? labels.join(' + ') : NATURAL_SERVICE
  }
  if (appt.service_key === LIFTING_SERVICE) return LIFTING_SERVICE
  return appt.service_key
}

/**
 * התוספות שנבחרו, כרשימה נפרדת לתצוגה (שלב 15C).
 *
 * ⚠️ הפונקציה הזו קיימת דווקא כי treatmentLabel **מאבדת מידע**: היא מסננת
 * מול NATURAL_VARIANTS, וערך שאינו בקטלוג נעלם ממנה בשקט — ואם יום אחד
 * ישתנה מזהה בקטלוג, שובל תראה "עיצוב גבות טבעיות" בלי לדעת שהלקוחה
 * ביקשה משהו אחר. כאן ערך שאינו מוכר מוצג כמות שהוא, בדיוק כמו
 * REMINDER_ERROR_CODE_LABELS: slug לא מוכר עדיף על השמטה שקטה.
 *
 * 🔒 הרמת גבות מחזירה מערך ריק ולא "חסר" — היא טיפול יחיד ללא תוספות
 * מעצם הגדרתה (lib/adminBooking.ts דוחה variants עבורה במפורש).
 */
export function variantLabels(appt: Pick<AppointmentRow, 'variants'>): string[] {
  return appt.variants.map(id => NATURAL_VARIANTS.find(v => v.id === id)?.label ?? id)
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

/**
 * מועד התפוגה כתאריך ושעה מוחלטים בשעון ישראל (שלב 15C).
 *
 * ⚠️ נדרש **בנוסף** ל-formatTimeRemaining ולא במקומו. מאז כלל הלילה של
 * 15B (lib/pendingExpiry.ts), בקשה שנשלחה בחמישי אחה"צ פגה ב-11:00 ביום
 * ראשון — "נותרו 66 שע' ו-12 דק' לתפוגה" הוא מספר שאי אפשר לתכנן לפיו.
 * שובל צריכה לדעת *מתי*, לא רק *כמה*.
 */
export function formatAbsoluteExpiry(pendingExpiresAt: string | null): string | null {
  if (!pendingExpiresAt) return null
  const { date, time } = formatDateTimeIL(pendingExpiresAt)
  return `${date}, ${time}`
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

/**
 * מועד קומפקטי ל-SMS: `24/08/2026` ו-`17:00`, בשעון ישראל.
 *
 * ⚠️ נפרד מ-`formatDateTimeIL` בכוונה. זה מחזיר "24 באוגוסט 2026" — 15
 * תווים, כמעט שליש מהודעת SMS שלמה. בהודעה שנמדדת בתווים החודש המילולי
 * הוא מותרות; במסך ניהול הוא קריא יותר. שני שימושים, שני נוסחים.
 *
 * ⚠️ נגזר מ-`israelDateStr` (en-CA, Asia/Jerusalem) ולא מ-`he-IL`: הפורמט
 * של he-IL הוא `24.08.2026` עם נקודות, והוא נתון לשינוי לפי גרסת ICU.
 * כאן הפלט דטרמיניסטי לחלוטין.
 */
export function formatDateTimeCompactIL(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const [y, m, day] = israelDateStr(d).split('-')
  return { date: `${day}/${m}/${y}`, time: fmtIsrael(d) }
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
  // ── 15H ──
  name_updated:       'השם עודכן',
  // ⚠️ בלי ערכים: הטלפון עצמו לעולם אינו נשמר ביומן הפעילות (0009:208).
  phone_updated:      'מספר הטלפון עודכן',
  archived:           'הכרטיס הועבר לארכיון',
  unarchived:         'הכרטיס הוחזר מהארכיון',
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
  // ── 15H ──
  bad_name:               'יש להזין שם מלא (2 עד 80 תווים).',
  bad_phone:              'מספר הטלפון אינו תקין. יש להזין מספר נייד ישראלי.',
  phone_taken:            'המספר הזה כבר קיים במערכת.',
  /*
   * ⚠️ הנוסח מסביר **למה** ולא רק ש"אי אפשר": ניסיון לתקן טלפון של לקוחה
   * מחוברת הוא פעולה שנראית תמימה לחלוטין, והחסימה בלעדיה נראית כמו באג.
   * ראה 0028 — שינוי כזה היה מנתק אותה מהאזור האישי לשני הכיוונים.
   */
  has_login_account:      'אי אפשר לשנות מספר טלפון ללקוחה שיש לה חשבון התחברות — השינוי היה מנתק אותה מהאזור האישי. יש לפנות אליה בוואטסאפ.',
  not_a_customer:         'הכרטיס הזה אינו כרטיס לקוחה.',
  // ── 9B ──
  bad_hold:               'בקשה לא תקינה: יש לשלוח ערך אמת/שקר בלבד.',
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

// ─── תזכורות (שלב 11) ───────────────────────────────────────────────────────

/**
 * ⚠️ ההפרדה בין 'נמסרה לספק השליחה' ל'סימולציה' אינה קוסמטית — היא הדרישה
 * המרכזית של השלב. כל עוד אין ספק אמיתי, אסור שמסך כלשהו ייתן רושם שיצא SMS.
 *
 * ⚠️ התווית של 'sent' אינה "נשלחה" ואינה "הגיעה ללקוחה". התשובה של 019
 * (status=0) היא **קבלת הבקשה למשלוח** ולא אישור מסירה לטלפון. אישור מסירה
 * אמיתי קיים רק ב-DLR, שאינו ממומש. ניסוח שמבטיח יותר ממה שידוע יגרום
 * למנהלת להסיק שהלקוחה קיבלה תזכורת — ולא להתקשר אליה כשהיא לא קיבלה.
 */
export const REMINDER_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  scheduled:        { label: 'מתוזמנת',              className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  retrying:         { label: 'ממתינה לניסיון חוזר',  className: 'bg-brand-gold/15 text-brand-gold-text border-brand-gold/40' },
  processing:       { label: 'בעיבוד',               className: 'bg-blue-50 text-blue-700 border-blue-200' },
  sent:             { label: 'נמסרה לספק השליחה',    className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  simulated:        { label: 'סימולציה — לא נשלח SMS', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  failed:           { label: 'נכשלה',                className: 'bg-red-50 text-red-600 border-red-200' },
  delivery_unknown: { label: 'תוצאה לא ודאית',       className: 'bg-brand-gold/15 text-brand-gold-text border-brand-gold/40' },
  cancelled:        { label: 'בוטלה',                className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  superseded:       { label: 'הוחלפה (המועד שונה)',  className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
  skipped:          { label: 'לא נשלחה — החלון נסגר', className: 'bg-brand-cream text-brand-muted border-brand-cream-dark' },
}

export const REMINDER_KIND_LABELS: Record<string, string> = {
  day_before:       'יום לפני',
  two_hours_before: 'שעתיים לפני',
  manual:           'ידנית',
}

/** הסברי ה-outcome_reason. כל אחד מהם קוד מסונן שנכתב ע"י ה-DB. */
export const REMINDER_REASON_LABELS: Record<string, string> = {
  window_passed_at_creation:       'מועד התזכורת כבר חלף כשהתור נקבע',
  expired_before_send:             'חלון השליחה נסגר לפני שהגיע התור לשלוח',
  starts_at_changed:               'מועד התור שונה',
  cancel_requested:                'התבקש ביטול בזמן העיבוד',
  appointment_cancelled_by_customer: 'התור בוטל על ידי הלקוחה',
  appointment_cancelled_by_business: 'התור בוטל על ידי העסק',
  appointment_completed:           'התור הושלם',
  appointment_no_show:             'הלקוחה לא הגיעה',
  appointment_expired:             'תוקף הבקשה פג',
  appointment_rescheduled:         'התור סומן כהוזז',
  appointment_not_confirmed:       'התור אינו מאושר',
  appointment_missing:             'התור אינו קיים יותר',
  appointment_started:             'התור כבר התחיל',
  max_attempts_exhausted:          'מוצו כל הניסיונות',
  retry_window_expired:            'לא נותר זמן לניסיון נוסף לפני סגירת החלון',
  permanent_error:                 'שגיאה קבועה של הספק',
  sent_after_appointment_change:   '⚠️ ההודעה יצאה לפני שהיה אפשר לעצור אותה — התור השתנה בזמן השליחה',
}

export const REMINDER_ATTEMPT_OUTCOME_LABELS: Record<string, string> = {
  accepted:             'הספק קיבל',
  simulated:            'סימולציה — לא נשלח',
  retryable_error:      'שגיאה זמנית',
  permanent_error:      'שגיאה קבועה',
  delivery_unknown:     'תוצאה לא ודאית',
  aborted_precondition: 'הופסק לפני השליחה',
  lease_expired:        'העיבוד נקטע',
}

/**
 * תוויות ל-last_error_code שנרשם בשורת התזכורת.
 *
 * ⚠️ הקודים עצמם הם slugs מסוננים (`^[a-z0-9_]{1,60}$` נאכף ב-DB) ואינם
 * מכילים טקסט מהספק, מספר טלפון או גוף הודעה. התווית כאן היא נוחות בלבד;
 * קוד שאינו במפה מוצג כמות שהוא, וזו התנהגות רצויה — עדיף slug לא מוכר
 * מאשר "שגיאה כללית" שמסתירה מה קרה.
 */
export const REMINDER_ERROR_CODE_LABELS: Record<string, string> = {
  provider_threw:                    'הספק נכשל באמצע — לא ידוע אם ההודעה יצאה',
  provider_disabled:                 'אין ספק שליחה מוגדר',
  sms019_timeout:                    'אין תשובה מהספק — לא ידוע אם ההודעה יצאה',
  sms019_transport_unknown:          'החיבור לספק נקטע — לא ידוע אם ההודעה יצאה',
  sms019_connect_failed:             'לא הצלחנו להתחבר לספק',
  sms019_malformed_response:         'תשובה לא מובנת מהספק',
  sms019_unmapped_status:            'קוד תשובה לא מוכר מהספק',
  sms019_unsupported_destination:    'מספר שאינו ישראלי — לא נתמך',
  sms019_message_empty:              'גוף ההודעה ריק',
  sms019_message_too_long:           'ההודעה ארוכה מדי',
  sms019_send_time_not_permitted_5:  'אין הרשאת שליחה בשעה זו',
  sms019_auth_invalid_token_3:       'פרטי הגישה לספק שגויים',
  sms019_auth_expired_token_10:      'תוקף ה-token של הספק פג',
  sms019_auth_token_user_mismatch_11:'ה-token אינו תואם למשתמש',
  sms019_auth_token_not_found_504:   'ה-token לא נמצא אצל הספק',
  sms019_unverified_source_515:      'שם השולח אינו מאושר אצל הספק',
  sms019_no_permission_511:          'אין הרשאה לפעולה אצל הספק',
  sms019_insufficient_credit_4:      'אין יתרת SMS',
  sms019_insufficient_credit_12:     'אין יתרת SMS',
  sms019_all_destinations_blocked_8: 'המספר חסום אצל הספק',
  sms019_temporarily_blocked_715:    'המספר חסום זמנית אצל הספק',
  sms019_bad_destination_9:          'מספר היעד אינו תקין',
  sms019_message_length_989:         'אורך ההודעה נדחה ע"י הספק',
  sms019_source_length_992:          'שם השולח נדחה ע"י הספק',
}

export const REMINDER_ERROR_MESSAGES: Record<string, string> = {
  ...ADMIN_ERROR_MESSAGES,
  reminder_not_found:           'התזכורת לא נמצאה.',
  appointment_not_found:        'התור לא נמצא.',
  not_confirmed:                'אפשר לשלוח תזכורת רק לתור מאושר.',
  appointment_not_confirmed:    'התור אינו מאושר יותר.',
  appointment_in_past:          'התור כבר התחיל או עבר.',
  duplicate_risk_not_confirmed: 'התוצאה הקודמת אינה ודאית. יש לאשר במפורש שייתכן שההודעה תישלח פעמיים.',
  lease_active:                 'התזכורת בעיבוד ברגע זה. נסי שוב בעוד רגע.',
  snapshot_stale:               'מועד התור השתנה מאז. רענני את העמוד.',
  window_closed:                'חלון השליחה של התזכורת נסגר.',
  unknown:                      'הפעולה נכשלה. נסי שוב.',
}
