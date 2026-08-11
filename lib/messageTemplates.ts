import { SITE_URL } from '@/lib/utils'

/**
 * שלב 15F — מקור האמת היחיד לנוסחי ההתראות.
 *
 * ⚠️ הקובץ אינו 'server-only' בכוונה: נוסחי ה-WhatsApp נקראים גם
 * מקומפוננטות לקוח. אין כאן שום סוד, שום גישה ל-DB ושום מספר טלפון של
 * לקוחה.
 *
 * ═══ למה שני ערוצים ולא נוסח אחד ═══
 *
 * `STAGE-15F-APPROVED-TEMPLATES.md` הניח בתחילה ש"נוסח אחד משרת את שני
 * הערוצים". ההנחה **בוטלה**, כי שני הערוצים שונים מהותית:
 *
 *   SMS      — מקטע אחד, ≤70 תווים, עולה כסף לכל מקטע, **אינו מוצפן**.
 *   WhatsApp — עשיר, דינמי, נשלח ידנית ע"י שובל בלחיצה.
 *
 * מכאן שתי תכונות שאינן סגנוניות:
 *
 * 1. **נוסחי ה-SMS סטטיים לחלוטין — אפס placeholders.** לכן מגבלת ה-70
 *    נאכפת כ-assertion על הקבועים עצמם (ראה למטה) ולא כבדיקה על נתוני
 *    ריצה שעלולה להיכשל רק בפרודקשן, על לקוחה אמיתית.
 *
 * 2. **ה-SMS אינו נושא PII.** אין בגוף שם, טיפול, תאריך, שעה או מחיר.
 *    SMS עובר ברשת הסלולרית ללא הצפנה ונשאר על מסך נעול. ההפניה לאזור
 *    האישי היא שיפור פרטיות, לא רק קיצור — וזו הסיבה ש-
 *    `loadNotificationRecipient` צריכה **רק** מספר טלפון, בניגוד ל-
 *    `loadReminderRecipient` הקיימת שטוענת גם service_key ו-variants.
 */

// ════════════════════════════════════════════════════════════════════════════
// SMS — עשרת הנוסחים המאושרים
// ════════════════════════════════════════════════════════════════════════════

/**
 * 🔒 מגבלת המקטע היחיד.
 *
 * ⚠️ עברית מכריחה קידוד UCS-2, ולכן מקטע SMS הוא **70 תווים** ולא 160.
 * הודעה של 71 תווים אינה "מעט ארוכה" — היא **שתי הודעות**, פי שניים
 * בעלות, על כל אירוע של כל לקוחה.
 *
 * ⚠️ זו **אינה** `SMS019_MAX_MESSAGE_CHARS` (=1005). הקבוע ההוא הוא תקרת
 * הספק — הגבול שמעליו 019 דוחה את הבקשה. הוא אינו מגן על העלות ואינו
 * יודע דבר על מקטעים, ולכן הוא חסר משמעות כאן.
 */
export const SMS_MAX_CHARS = 70

/**
 * 🔒 ה-URL הוא הרכיב היקר בהודעה, וכל תו בו נגזל מהטקסט העברי.
 *
 * `/admin` = 27 תווים · `/account` = 29. הטקסט העברי חי בתוך ~41 תווים.
 * המרווח הצפוף ביותר הוא **6 תווים** (`reschedule_rejected`, 64/70).
 * ⚠️ **כל תוספת מילה מחייבת ספירה מחדש**, וה-assertion למטה תיפול.
 */
const ADMIN_URL = `${SITE_URL}/admin`
const ACCOUNT_URL = `${SITE_URL}/account`

/**
 * האירועים הטרנזקציוניים של 15F.
 *
 * ⚠️ תזכורות (`day_before`, `two_hours_before`) **אינן כאן** — הן מסלול
 * נפרד עם snapshot, `scheduled_for` ו-`expires_at`, והן שייכות ל-15G.
 * הנוסחים שלהן נשמרים בתחתית הקובץ כקבועים לא-מחווטים.
 */
export type NotificationEvent =
  | 'booking_requested'
  | 'reschedule_requested'
  | 'booking_approved'
  | 'booking_rejected'
  | 'reschedule_approved'
  | 'reschedule_rejected'
  | 'booking_cancelled'
  /**
   * שובל גררה את האירוע ביומן Google והתור זז — המקרה היחיד שבו מועד
   * התור משתנה בלי שהלקוחה ביקשה ובלי שהיא אישרה.
   *
   * 🔒 **האירוע היחיד שיכול לחזור על אותו תור**, ולכן הוא זה שקבע שמפתח
   * ה-idempotency ב-0025 יהיה `source_history_id` ולא (תור, אירוע, נמען):
   * גרירה שנייה חייבת לייצר התראה שנייה.
   */
  | 'appointment_moved_by_business'

export type RecipientRole = 'admin' | 'customer'

/**
 * 🔒 נוסחי ה-SMS ה**סטטיים**, לפי (אירוע, נמען).
 *
 * ⚠️ שני נוסחי ה-admin שנעשו דינמיים — `reschedule_requested` ו-
 * `booking_cancelled/admin` — **אינם כאן**. הם חיים ב-DYNAMIC_BUILDERS
 * למטה, כי אורכם תלוי בשם הלקוחה ולא ניתן לאכיפה כ-assertion על קבוע.
 *
 * ⚠️ `/account` בהודעות ללקוחה נשאר **בכוונה** גם ללקוחה שאין לה חשבון
 * (מסלול ציבורי, `auth_user_id = null`): היא תעבור OTP ותגיע לאזור האישי.
 * זו התנהגות רצויה ולא פער — ראה החלטה 2 ב-STAGE-15F-ARCHITECTURE.
 *
 * ⚠️ `booking_cancelled` עדיין נשלח לשני נמענים — אבל רק צד הלקוחה סטטי;
 * צד ה-admin דינמי ויושב למטה. שתי השורות נבדלות ב-`recipient_role`,
 * ולכן מפתח ה-idempotency `(source_history_id, recipient_role)` מתיר את
 * שתיהן ועדיין חוסם כפילות בכל אחת מהן בנפרד.
 */
export const SMS_TEXT: Readonly<
  Partial<Record<NotificationEvent, Partial<Record<RecipientRole, string>>>>
> = {
  booking_requested: {
    admin: `בקשת תור חדשה. לניהול: ${ADMIN_URL}`,
  },
  booking_approved: {
    customer: `תורך אושר. לפרטים: ${ACCOUNT_URL}`,
  },
  booking_rejected: {
    customer: `בקשת התור לא אושרה. לפרטים: ${ACCOUNT_URL}`,
  },
  reschedule_approved: {
    customer: `שינוי המועד אושר. לפרטים: ${ACCOUNT_URL}`,
  },
  reschedule_rejected: {
    // ⚠️ 64/70 — הנוסח הצפוף ביותר. אין כאן מקום למילה נוספת.
    customer: `בקשת שינוי המועד לא אושרה. לפרטים: ${ACCOUNT_URL}`,
  },
  booking_cancelled: {
    customer: `תורך בוטל. לפרטים: ${ACCOUNT_URL}`,
  },
  appointment_moved_by_business: {
    /*
     * ⚠️ הנוסח אינו אומר מי הזיז ואינו מציג את המועד החדש — בדיוק כמו
     * שאר השמונה. המועד המדויק נמצא באזור האישי, ו-SMS אינו מוצפן.
     *
     * 🔒 זהו האירוע היחיד שיכול לחזור על אותו תור. ראה source_history_id
     * ב-0025: כל גרירה מייצרת שורת היסטוריה חדשה, ולכן התראה חדשה.
     */
    customer: `מועד התור שלך עודכן. לפרטים: ${ACCOUNT_URL}`,
  },
} as const

/**
 * גוף ההודעה לזוג (אירוע, נמען), או null אם אין נוסח מאושר.
 *
 * ⚠️ מחזירה null ואינה זורקת, ואינה ממציאה נוסח חלופי. זוג שאין לו נוסח
 * הוא באג בחיווט, והתשובה הנכונה היא שההתראה תיכשל בקול (`failed` עם קוד
 * שגיאה) — לא שתישלח ללקוחה הודעה שאיש לא אישר.
 */
export function smsBodyFor(
  event: NotificationEvent,
  role: RecipientRole,
): string | null {
  return SMS_TEXT[event]?.[role] ?? null
}

/**
 * אירועים שהמערכת **רושמת** אבל טרם אושר להם נוסח.
 *
 * ⚠️ **ריקה כרגע** — כל שמונת האירועים נושאים נוסח מאושר.
 * `appointment_moved_by_business` היה כאן עד שנוסחו אושר.
 *
 * המנגנון נשאר במקומו בכוונה: ההפרדה מ-"זוג לא חוקי" היא תפעולית.
 * `booking_approved/admin` הוא באג בחיווט וצריך להיחקר, ואילו אירוע
 * שממתין לאישור נוסח הוא החלטה עסקית פתוחה. שניהם מחזירים null
 * מ-`smsBodyFor`, ובלי ההבחנה הזו שניהם היו נראים זהים ברשימת "דורש
 * טיפול". האירוע הבא שיתווסף לפני שנוסחו אושר ייכנס לכאן.
 */
export const AWAITING_APPROVED_TEMPLATE: ReadonlySet<NotificationEvent> =
  new Set<NotificationEvent>([])

export function isAwaitingApprovedTemplate(event: NotificationEvent): boolean {
  return AWAITING_APPROVED_TEMPLATE.has(event)
}

// ════════════════════════════════════════════════════════════════════════════
// נוסחי ADMIN דינמיים
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ **שני הנוסחים האלה שוברים במכוון שתי הנחות של 15F**, ולכן הם מופרדים
 * מ-`SMS_TEXT` ולא נדחפו לתוכו:
 *
 * 1. **הם אינם סטטיים.** מגבלת ה-70 אינה ניתנת יותר לאכיפה כ-assertion על
 *    קבוע, כי האורך תלוי בשם הלקוחה. במקומה יש **תקציב**: החלק הקבוע נמדד,
 *    והשם מקוצץ למה שנשאר. ה-assertion בטעינת המודול בודק את המקרה הגרוע —
 *    שם ארוך פתולוגית — ולכן הגבול עדיין מוכח בזמן בנייה ולא בפרודקשן.
 *
 * 2. **הם נושאים PII.** שם הלקוחה, ובביטול גם מועד התור, עוברים ב-SMS לא
 *    מוצפן. ⚠️ זו הרחבה מודעת של מה שהוסכם ב-15F, והיא מוגבלת לשני
 *    נוסחים ש**נמענם הוא שובל בלבד** — בעלת העסק, שהנתונים האלה שלה
 *    ממילא. 🔒 אף נוסח שנמען ללקוחה לא השתנה ואינו נושא PII.
 */

/** מה שהבונים הדינמיים צריכים. מגיע מנתוני הלקוחה הקנוניים. */
export interface AdminSmsContext {
  /** `customers.full_name` — מקור האמת היחיד. לא שם שהוקלד בטופס ולא cache. */
  customerName: string
  /** מועד **התור שבוטל**, בשעון ישראל. לא חותמת הזמן של הביטול. */
  appointmentDate?: string
  appointmentTime?: string
}

/**
 * סימן הקיצוץ.
 *
 * ⚠️ U+2026 (…) ולא שלוש נקודות: תו אחד במקום שלושה, בטווח BMP, ואינו
 * אמוג'י — כלומר אינו מפר את כלל ה-multipart ואינו נספר פעמיים.
 */
const TRUNCATION_MARK = '\u2026'

/**
 * ניקוי שם לקוחה לפני שהוא נכנס ל-SMS.
 *
 * ⚠️ `full_name` הוא טקסט חופשי שהלקוחה הקלידה בטופס, ולכן הוא יכול
 * להכיל בדיוק את מה שאסור בהודעה שנמדדת בתווים:
 *
 *   אמוג'י     → שתי יחידות UCS-2, ומסכן תצוגה. מוסר.
 *   שורה חדשה  → שוברת הודעה בת שורה אחת. הופכת לרווח.
 *   רווחים כפולים → אורך מבוזבז בתקציב צפוף.
 *
 * ⚠️ ההסרה קודמת למדידה: אחרת אמוג'י היה "תופס" שני תווים מהתקציב של השם
 * ואז מוסר, והתוצאה הייתה קצרה מהנדרש בלי סיבה.
 */
export function sanitizeCustomerName(raw: string): string {
  return raw
    .replace(EMOJI_STRIP_RE, '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * קיצוץ לתקציב, ביחידות UCS-2.
 *
 * ⚠️ הקיצוץ הוא **על השם בלבד** ולעולם לא על הקישור או על המועד. שם חתוך
 * עדיין מזהה את הלקוחה; קישור חתוך אינו נפתח, ומועד חתוך משקר.
 */
export function fitToBudget(name: string, budget: number): string {
  if (budget <= 0) return ''
  if (name.length <= budget) return name
  if (budget === 1) return TRUNCATION_MARK
  return name.slice(0, budget - 1).trimEnd() + TRUNCATION_MARK
}

/** החלקים הקבועים, מדודים פעם אחת — הם מגדירים את התקציב שנשאר לשם. */
const RESCHEDULE_REQ_PREFIX = 'בקשת שינוי מועד: '
const RESCHEDULE_REQ_SUFFIX = `. ניהול: ${ADMIN_URL}`
const CANCELLED_PREFIX = 'תור בוטל: '

/**
 * `בקשת שינוי מועד: {שם}. ניהול: {URL}`
 *
 * ⚠️ הקישור נשאר — שובל צריכה להגיע למסך ההכרעה, וזו הפעולה שההודעה
 * מבקשת ממנה.
 */
export function buildRescheduleRequestedAdminSms(ctx: AdminSmsContext): string {
  const fixed = RESCHEDULE_REQ_PREFIX.length + RESCHEDULE_REQ_SUFFIX.length
  const name = fitToBudget(sanitizeCustomerName(ctx.customerName), SMS_MAX_CHARS - fixed)
  return `${RESCHEDULE_REQ_PREFIX}${name}${RESCHEDULE_REQ_SUFFIX}`
}

/**
 * `תור בוטל: {שם}, {תאריך} {שעה}`
 *
 * ⚠️ **ללא קישור, במכוון.** ההודעה מוסרת עובדה מלאה — מי, מתי — ואין
 * פעולה שנדרשת משובל. הוויתור על הקישור הוא מה שמפנה 27 תווים למועד
 * ולשם.
 *
 * 🔒 **התאריך והשעה הם של התור שבוטל, לא של רגע הביטול.** הקורא אחראי
 * להעביר את `starts_at` — ראה loadNotificationContext.
 */
export function buildBookingCancelledAdminSms(ctx: AdminSmsContext): string {
  const when = [ctx.appointmentDate, ctx.appointmentTime].filter(Boolean).join(' ')
  // ⚠️ מועד חסר מקצר את ההודעה ואינו שובר אותה — אבל גם אינו ממציא מועד.
  const suffix = when ? `, ${when}` : ''
  const fixed = CANCELLED_PREFIX.length + suffix.length
  const name = fitToBudget(sanitizeCustomerName(ctx.customerName), SMS_MAX_CHARS - fixed)
  return `${CANCELLED_PREFIX}${name}${suffix}`
}

/**
 * הזוגות שדורשים הקשר. 🔒 **שניהם admin בלבד.**
 *
 * ⚠️ הרשימה הזו היא מה שקובע אם ה-dispatcher טוען נתוני לקוחה. כל שאר
 * הזוגות ממשיכים לעבור במסלול שטוען **טלפון בלבד**, כפי שנקבע ב-15F.
 */
const DYNAMIC_BUILDERS: Partial<
  Record<NotificationEvent, Partial<Record<RecipientRole, (c: AdminSmsContext) => string>>>
> = {
  reschedule_requested: { admin: buildRescheduleRequestedAdminSms },
  booking_cancelled: { admin: buildBookingCancelledAdminSms },
}

export function requiresContext(event: NotificationEvent, role: RecipientRole): boolean {
  return Boolean(DYNAMIC_BUILDERS[event]?.[role])
}

/** גוף ההודעה לזוג דינמי, או null אם הזוג אינו דינמי. */
export function smsBodyWithContext(
  event: NotificationEvent,
  role: RecipientRole,
  ctx: AdminSmsContext,
): string | null {
  const build = DYNAMIC_BUILDERS[event]?.[role]
  return build ? build(ctx) : null
}

// ════════════════════════════════════════════════════════════════════════════
// תזכורות — נוסחים מאושרים, **לא מחווטים**. 15G.
// ════════════════════════════════════════════════════════════════════════════

/**
 * 🔒 **אין לחווט את השניים האלה ב-15F.**
 *
 * הם נמדדו ואושרו יחד עם השמונה שמעליהם, ולכן הם נשמרים כאן ונבדקים ע"י
 * אותו assertion של ≤70 — אחרת המדידה המאושרת הייתה הולכת לאיבוד ומישהו
 * היה מנסח אותם מחדש ב-15G.
 *
 * ⚠️ הם **אינם** ב-`SMS_TEXT` וב-`NotificationEvent` בדיוק כדי שלא ייכנסו
 * למסלול הטרנזקציוני בטעות: לתזכורת יש חלון שליחה, snapshot של המועד
 * ו-`expires_at`, ואילו אירוע טרנזקציוני הוא נקודה בזמן. ראה את הנימוק
 * המלא ב-STAGE-15F-ARCHITECTURE (למה טבלה חדשה ולא הרחבת
 * appointment_reminders).
 *
 * ⚠️ הנוסחים אומרים "מחר" ו"היום" ולא שעה מדויקת — בהתאם לכלל של
 * [lib/reminders/templates.ts:8](reminders/templates.ts), שלתזכורת יש חלון
 * ולא רגע.
 */
export const REMINDER_SMS_V2_UNWIRED: Readonly<Record<string, string>> = {
  day_before: `תזכורת: התור שלך מחר. פרטים: ${ACCOUNT_URL}`,
  two_hours_before: `תזכורת: התור שלך היום. פרטים: ${ACCOUNT_URL}`,
} as const

// ════════════════════════════════════════════════════════════════════════════
// אכיפת המגבלה — assertion סטטי, ברגע הטעינה
// ════════════════════════════════════════════════════════════════════════════

/**
 * אורך ההודעה ב-**יחידות UCS-2**, כלומר `String.length`.
 *
 * ⚠️ זו אינה טעות ואין להחליף ב-`[...s].length`. הספירה שקובעת כמה מקטעים
 * יחויבו היא של יחידות הקידוד, לא של נקודות קוד: אמוג'י אחד הוא surrogate
 * pair — **שתי** יחידות — ולכן `[...s].length` היה מדווח 1 ומחמיץ בדיוק את
 * המקרה שהמגבלה קיימת בשבילו.
 */
export function smsLength(body: string): number {
  return body.length
}

/**
 * האם המחרוזת מכילה אמוג'י.
 *
 * ⚠️ אמוג'י בהודעת SMS אסור לא רק בגלל האורך: תצוגתו אינה מובטחת במכשירים
 * ישנים, והוא עלול להגיע כריבוע ריק. בהודעה שכל תפקידה להעביר עובדה אחת
 * ולינק, זה סיכון בלי תמורה.
 *
 * ⚠️ **בדיקת surrogate pair בלבד אינה מספיקה, וזו הייתה טעות שנתפסה
 * בבדיקות.** התיעוד מסביר שאמוג'י הוא "שתי יחידות UCS-2", וזה נכון —
 * אבל לא בהכרח דרך surrogate pair:
 *
 *   🌸 😀   → surrogate pair (מחוץ ל-BMP)  ✔ נתפס גם קודם
 *   ❤️ ⚠️   → תו BMP + variation selector U+FE0F  ✘ **התחמק**
 *   ✅ ☺    → תו BMP בודד, יחידה אחת         ✘ **התחמק**
 *   🇮🇱     → שני regional indicators         ✘ **התחמק**
 *
 * ❤️ הוא בדיוק האמוג'י שמופיע בנוסח ה-WhatsApp המאושר, ולכן הוא המועמד
 * הסביר ביותר להידבק בהעתקה לנוסח SMS. בודקים לפי מאפיין Unicode ולא לפי
 * טווח קידוד.
 */
/**
 * ⚠️ נבנה ב-`new RegExp` ולא כליטרל, ובכוונה.
 *
 * `\p{...}` מחייב את הדגל `u`, ו-`tsconfig.json` אינו מגדיר `target` —
 * ולכן `tsc --noEmit` נופל על TS1501 ("flag only available when targeting
 * es6 or later"). הוספת `target` ל-tsconfig הייתה משנה גם את הפלט
 * ש-Next מייצר לדפדפן, כלומר את ה-bundle של האתר כולו, בשביל
 * ביטוי רגולרי אחד. בנייה בזמן ריצה עוקפת את בדיקת הדגל
 * בקומפילציה, וההתנהגות זהה לחלוטין.
 *
 * ⚠️ U+FE0F נכתב כ-escape ולא כתו: variation selector בלתי נראה בעורך,
 * וקבוע בלתי נראה בביטוי רגולרי הוא בדיוק מה שנמחק בטעות בעריכה הבאה.
 */
const EMOJI_RE = new RegExp(
  '\\p{Extended_Pictographic}|\\p{Regional_Indicator}|\\uFE0F',
  'u',
)

export function hasEmoji(body: string): boolean {
  return EMOJI_RE.test(body)
}

/**
 * גרסת ההסרה של EMOJI_RE.
 *
 * ⚠️ ביטוי נפרד ולא `EMOJI_RE` עם `g`: דגל `g` שומר `lastIndex` בין
 * קריאות, ו-`test()` על ביטוי גלובלי מדלג על התאמות לסירוגין. שיתוף
 * המופע בין `hasEmoji` ל-`sanitizeCustomerName` היה הופך את הבדיקה
 * ללא-דטרמיניסטית.
 *
 * ⚠️ כולל גם ZWJ (U+200D): אחרי הסרת רכיבי אמוג'י מורכב (💆‍♀️) עלול
 * להישאר מחבר יתום, שאינו נראה אבל נספר בתקציב.
 */
const EMOJI_STRIP_RE = new RegExp(
  '\\p{Extended_Pictographic}|\\p{Regional_Indicator}|\\uFE0F|\\u200D',
  'gu',
)

/**
 * 🔒 האכיפה עצמה — רצה **בזמן טעינת המודול**, לא בזמן שליחה.
 *
 * ⚠️ זו הנקודה שבה הבדיקה שווה משהו. נוסח שחצה 70 ייפול בבנייה ובכל טסט
 * שמייבא את הקובץ, ולא בפרודקשן בשעה שלקוחה ממתינה להודעה. הנוסחים
 * סטטיים, ולכן אין שום סיבה לגלות את זה מאוחר יותר.
 */
function assertAllTextsFitOneSegment(): void {
  const all: [string, string][] = []

  for (const [event, byRole] of Object.entries(SMS_TEXT)) {
    for (const [role, body] of Object.entries(byRole ?? {})) {
      if (typeof body === 'string') all.push([`${event}/${role}`, body])
    }
  }
  for (const [kind, body] of Object.entries(REMINDER_SMS_V2_UNWIRED)) {
    all.push([`reminder/${kind}`, body])
  }

  /*
   * 🔒 הנוסחים הדינמיים, במקרה הגרוע ביותר.
   *
   * ⚠️ בלי זה מגבלת ה-70 הייתה מפסיקה להיות מוכחת בזמן בנייה ברגע ששני
   * הנוסחים האלה הפכו דינמיים. שם באורך פתולוגי הוא בדיוק המקרה שהתקציב
   * קיים בשבילו, ולכן הוא זה שנבדק — לא שם טיפוסי.
   */
  const worstName = 'א'.repeat(300)
  all.push(
    ['reschedule_requested/admin (שם מקסימלי)',
      buildRescheduleRequestedAdminSms({ customerName: worstName })],
    ['booking_cancelled/admin (שם מקסימלי)',
      buildBookingCancelledAdminSms({
        customerName: worstName, appointmentDate: '24/08/2026', appointmentTime: '17:00',
      })],
  )

  const problems: string[] = []
  for (const [label, body] of all) {
    const len = smsLength(body)
    if (len > SMS_MAX_CHARS) problems.push(`${label}: ${len} תווים (מקסימום ${SMS_MAX_CHARS})`)
    if (hasEmoji(body)) problems.push(`${label}: מכיל אמוג'י`)
  }

  if (problems.length > 0) {
    throw new Error(`[messageTemplates] נוסחי SMS פסולים:\n  ${problems.join('\n  ')}`)
  }
}

assertAllTextsFitOneSegment()
