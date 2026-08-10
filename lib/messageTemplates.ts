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
 * 🔒 שמונת נוסחי ה-SMS הטרנזקציוניים, לפי (אירוע, נמען).
 *
 * ⚠️ `/account` בהודעות ללקוחה נשאר **בכוונה** גם ללקוחה שאין לה חשבון
 * (מסלול ציבורי, `auth_user_id = null`): היא תעבור OTP ותגיע לאזור האישי.
 * זו התנהגות רצויה ולא פער — ראה החלטה 2 ב-STAGE-15F-ARCHITECTURE.
 *
 * ⚠️ `booking_cancelled` הוא הזוג היחיד ששולח לשני נמענים. שתי השורות
 * נבדלות ב-`recipient_role`, ולכן ה-unique index
 * `(appointment_id, event, recipient_role)` מתיר את שתיהן ועדיין חוסם
 * כפילות בכל אחת מהן בנפרד.
 */
export const SMS_TEXT: Readonly<
  Partial<Record<NotificationEvent, Partial<Record<RecipientRole, string>>>>
> = {
  booking_requested: {
    admin: `בקשת תור חדשה. לניהול: ${ADMIN_URL}`,
  },
  reschedule_requested: {
    admin: `בקשת שינוי מועד. לניהול: ${ADMIN_URL}`,
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
    admin: `תור בוטל ע"י לקוחה. לניהול: ${ADMIN_URL}`,
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
