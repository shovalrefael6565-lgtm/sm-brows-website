/**
 * מקור אמת יחיד לנוסחי WhatsApp שהמנהלת שולחת ידנית אחרי אישור/דחייה
 * (ראה app/api/admin/appointments/[id]/{approve,reject}/route.ts).
 *
 * המערכת אף פעם לא שולחת הודעה אוטומטית — היא רק פותחת שיחה עם טקסט
 * מוכן, ושובל לוחצת בעצמה "שליחה". הנוסחים כאן זמניים ומיועדים להחלפה
 * בהמשך בלי לגעת בלוגיקת האישור/הדחייה עצמה.
 */

/**
 * נוסח **בקשת התור** שהלקוחה שולחת לשובל.
 *
 * ⚠️ הועתק מילה במילה מ-`BookingForm.buildWhatsAppMessage`, שהיה עד שלב
 * 15B הנוסח היחיד ו-חי בתוך הקומפוננטה. החילוץ לכאן נועד לדבר אחד בלבד:
 * שהאזור האישי (15D) ישלח **בדיוק** את אותו נוסח, בלי עותק שני שיתבדר.
 *
 * ⚠️ כל שינוי כאן משנה את הנוסח שהלקוחות שולחות היום.
 * `scripts/test-public-booking-core.mjs` מחזיק snapshot של הנוסח ונכשל על
 * כל סטייה — כולל רווח או אמוג'י.
 *
 * ─── 15F: שורת המשך הוסרה ──────────────────────────────────────────────────
 *
 * ⚠️ עד 15F הייתה כאן שורת `⏱️ {משך}`, והיא נבנתה בקומפוננטה מתוך
 * `isLifting ? '40 דקות' : undefined` — כלומר **מספר קשיח בצד הלקוח** לטיפול
 * אחד, בזמן ש-`duration_min` האמיתי נשמר על שורת התור. זהו בדיוק דפוס
 * "90 מול 40 דקות" מ-Risks של 15A: שני מקורות לאותה עובדה, שאחד מהם אינו
 * מתעדכן. שובל רואה את המשך האמיתי במסך הניהול, ולכן השורה לא הוסיפה לה
 * מידע — רק סיכנה להציג לה מספר שגוי.
 *
 * ⚠️ הקובץ הזה אינו 'server-only' בכוונה: הפונקציה נקראת מקומפוננטת לקוח.
 * אין בה שום סוד ושום גישה ל-DB.
 *
 * ─── למה אין כאן שורת אישור מדיניות ────────────────────────────────────────
 *
 * אישור המדיניות הוא **תנאי חוסם** לשליחת הבקשה (`validateFinal` ב-
 * BookingForm), ולכן אי אפשר שתגיע בקשה שלא אושרה. שורה שמצהירה על משהו
 * שתמיד נכון אינה מוסיפה מידע — היא רק מאריכה את ההודעה.
 *
 * ⚠️ התיעוד עצמו לא אבד: `policy_version` נשמר על שורת התור
 * (`create_public_booking_request`), יחד עם `created_at`.
 */
export interface BookingRequestMessageParams {
  customerName: string
  /** כפי שהוקלד בטופס — לתצוגה בלבד, לא מנורמל */
  phone: string
  /** שם הטיפול המוצג (וריאציות מאוחדות ב-' + ', או שם השירות) */
  treatment: string
  /** סה"כ מחיר. 0 או undefined ⟶ השורה מושמטת */
  priceTotal?: number
  /** האם להוסיף קידומת "סה"כ " לפני המחיר (עיצוב טבעי בלבד) */
  priceIsSum?: boolean
  /** תאריך בעברית לתצוגה, למשל '24 אוגוסט 2026' */
  dateLabel?: string
  /** שעה או טווח שעות, למשל '17:00' או '17:00–17:40' */
  timeLabel?: string
  notes?: string
}

export function buildBookingRequestMessage(p: BookingRequestMessageParams): string {
  const lines = [
    'היי שובל 🤍',
    '',
    'בקשת תור חדשה 🌸',
    '',
    `👤 ${p.customerName}`,
    `📞 ${p.phone}`,
    '',
    `💆 ${p.treatment}`,
    ...(p.priceTotal ? [`💰 ${p.priceIsSum ? 'סה"כ ' : ''}₪${p.priceTotal}`] : []),
    ...(p.dateLabel ? [`📅 ${p.dateLabel}`] : []),
    ...(p.timeLabel ? [`⏰ ${p.timeLabel}`] : []),
    ...(p.notes?.trim() ? ['', `📝 ${p.notes}`] : []),
  ]
  return lines.join('\n')
}

/**
 * 🔒 פרטי הסטודיו שנכנסים לכל הודעת אישור.
 *
 * ⚠️ מרוכזים בקבוע אחד ולא מפוזרים בתוך הנוסח, כדי שעדכון כתובת או קוד
 * כניסה יהיה שינוי **בנקודה אחת**. אותו שיקול בדיוק כמו SPECIAL_WINDOWS.
 *
 * 🔒 **קוד הכניסה לבניין אינו כאן, ובכוונה.** הוא מגיע מ-`business_settings`
 * (‏0024) ומועבר כפרמטר. הקוד נמסר לכל לקוחה בהודעת האישור ואינו סוד
 * מבצעי, אבל מחרוזת שנכנסת ל-git נשארת שם **לתמיד** — גם אחרי שהקוד
 * בבניין יוחלף, וגם בכל fork, clone או גיבוי. ההיסטוריה אינה נמחקת.
 *
 * ⚠️ הכתובת ואמצעי התשלום **כן** כאן: הכתובת מופיעה בעמוד צור-קשר ובכל
 * מפת Google, ומספר ה-Bit הוא מספר עסקי מפורסם. אין להם מה להסתיר.
 */
export const STUDIO_DETAILS = {
  address: 'הכורמים 14, קומה 4, דירה 16',
  addressNote: '(הבניין על הכיכר)',
  paymentMethods: 'מזומן / Bit / PayBox',
  paymentPhone: '054-7261564',
} as const

export interface ApprovalMessageParams {
  /**
   * ⚠️ אינו בשימוש בגוף ההודעה, ונשאר בחתימה **בכוונה**.
   *
   * הנוסח המאושר פותח ב"נקבע לך תור" ואינו פונה ללקוחה בשמה — זו בחירה
   * מפורשת של המשתמש ולא השמטה, ואין להוסיף פנייה בשם. השדה נשמר כדי
   * שהקוראים הקיימים לא ישתנו, ושהכוונה תהיה מתועדת במקום שבו מישהו
   * ינסה "לתקן" את זה.
   */
  customerName?: string
  date: string
  time: string
  treatment: string
  /** פירוט הווריאציות והמחיר. undefined ⟶ השורה מושמטת */
  priceLine?: string
  /**
   * 🔒 קוד הכניסה לבניין, מ-`business_settings`. **חובה.**
   *
   * ⚠️ אין לו ברירת מחדל ואינו אופציונלי: הודעת אישור בלי קוד כניסה
   * שולחת לקוחה לבניין שאינה יכולה להיכנס אליו. הקורא אחראי לא לבנות
   * הודעה כשהערך חסר.
   */
  buildingCode: string
  /**
   * 🔒 שורת מדיניות הביטול/שינוי, **נגזרת מ-business_settings**.
   *
   * ⚠️ אינה ברירת מחדל ואינה מספר קשיח. ראה `cutoffPolicyLines` למטה.
   */
  cutoffLines: string[]
}

/**
 * 🔒 שורות המדיניות, לפי שני ה-cutoff שב-DB.
 *
 * ⚠️ **הכלל הנעול:** ב-`business_settings` יש **שני** מפתחות נפרדים —
 * `cancel_cutoff_hours` ו-`reschedule_cutoff_hours`. הנוסח המאושר מכיל
 * מספר אחד, ולכן:
 *
 *   שווים  ⟶ הנוסח המשותף המאושר ("עד N שעות לפני התור...").
 *   שונים  ⟶ **חובה להציג אותם בנפרד.**
 *
 * 🔒 **לעולם לא להציג מספר שגוי, ואין ברירת מחדל שקטה.** "לוקחים את
 * הראשון" הוא בדיוק דפוס הכשל של "90 מול 40 דקות" מ-Risks של 15A, ושל
 * 24/12 השעות שנתפס ב-15E בעמוד מדיניות ההזמנות. הודעה שמבטיחה ללקוחה
 * חלון של 6 שעות בזמן שהמערכת אוכפת 12 היא הבטחה שהאתר עצמו ישבור.
 */
export function cutoffPolicyLines(p: {
  cancelCutoffHours: number
  rescheduleCutoffHours: number
}): string[] {
  if (p.cancelCutoffHours === p.rescheduleCutoffHours) {
    const n = p.cancelCutoffHours
    return [
      `עד ${n} שעות לפני התור ניתן לבצע שינוי או ביטול דרך האזור האישי באתר.`,
      `פחות מ־${n} שעות לפני התור יש לפנות אלינו בוואטסאפ.`,
    ]
  }

  // ⚠️ שני מספרים שונים ⟶ שתי שורות מפורשות. אין מיזוג ואין בחירה.
  return [
    `עד ${p.rescheduleCutoffHours} שעות לפני התור ניתן לשנות מועד דרך האזור האישי באתר.`,
    `עד ${p.cancelCutoffHours} שעות לפני התור ניתן לבטל דרך האזור האישי באתר.`,
    'מעבר לכך יש לפנות אלינו בוואטסאפ.',
  ]
}

/**
 * 🔒 **הנוסח המאושר** של הודעת אישור התור.
 *
 * ⚠️ הוחלף ב-15F. הנוסח הקודם ("היי {שם} 🌸 / התור שלך אושר ליום...") היה
 * נוסח **זמני** שנכתב בשלב 6 וסומן ככזה בקוד. הנוסח כאן הוא זה שנמסר
 * ואושר, ואין לנסח אותו מחדש.
 *
 * ⚠️ שם הטיפול מופיע **פעמיים** — בשורה הראשונה ובבלוק "הטיפול שלך".
 * זה מכוון ולא כפילות שנשכחה.
 */
export function buildApprovalMessage(params: ApprovalMessageParams): string {
  return [
    `נקבע לך תור ל־${params.treatment} ❤️`,
    '',
    `📅 תאריך: ${params.date}`,
    `🕒 שעה: ${params.time}`,
    '',
    `📍 כתובת: ${STUDIO_DETAILS.address}`,
    STUDIO_DETAILS.addressNote,
    `🔑 קוד כניסה לבניין: ${params.buildingCode}`,
    '',
    '💆‍♀️ הטיפול שלך:',
    params.treatment,
    ...(params.priceLine ? [params.priceLine] : []),
    '',
    `💳 אמצעי תשלום: ${STUDIO_DETAILS.paymentMethods}`,
    `Bit / PayBox: ${STUDIO_DETAILS.paymentPhone}`,
    '',
    '🔄 לשינוי או ביטול התור:',
    ...params.cutoffLines,
    '',
    'ניפגש ❤️',
  ].join('\n')
}

/**
 * נוסח ה-prefill למסלול ה-`<cutoff` — כשהלקוחה אינה יכולה לבטל או לשנות
 * דרך האתר ומופנית לוואטסאפ.
 *
 * ═══ למה מותר לבנות אותו כאן ═══
 *
 * ⚠️ זו הודעה ש**הלקוחה שולחת לשובל**, בדיוק כמו `buildBookingRequestMessage`
 * — לא הודעה עסקית משובל ללקוחה. היא נפתחת בחלון WhatsApp, הלקוחה רואה
 * אותה, יכולה לערוך אותה, ולוחצת "שליחה" בעצמה. שום דבר אינו נשלח
 * אוטומטית.
 *
 * ⚠️ לכן הנוסח בנוי על אותה תבנית מאושרת בדיוק של `buildBookingRequestMessage`
 * ("היי שובל 🤍" + פרטים) ואינו מנסח שום מסר עסקי חדש. שלושת הנוסחים
 * ש**שובל שולחת ללקוחה** (דחייה, אישור/דחיית שינוי מועד) הם עניין אחר
 * לגמרי, ואין להמציא אותם.
 *
 * ⚠️ עד 15F שלושת המקומות האלה הפנו ל-`WHATSAPP_BASE` **חשוף**: נפתח חלון
 * ריק, והלקוחה נדרשה לנסח בעצמה מה היא רוצה ולציין על איזה תור מדובר.
 * שובל קיבלה "היי, אני צריכה לבטל" בלי תאריך ובלי שם טיפול.
 */
export interface LateChangeMessageParams {
  action: 'cancel' | 'reschedule'
  /** שם הטיפול המוצג */
  treatment: string
  /** תיאור המועד כפי שהוא מוצג ללקוחה, למשל 'יום ראשון, 24 באוגוסט, 17:00' */
  whenLabel: string
}

export function buildLateChangeMessage(p: LateChangeMessageParams): string {
  const what = p.action === 'cancel' ? 'לבטל את' : 'לשנות את המועד של'
  return [
    'היי שובל 🤍',
    '',
    `רציתי ${what} התור שלי 🌸`,
    '',
    `💆 ${p.treatment}`,
    `📅 ${p.whenLabel}`,
  ].join('\n')
}

/** קישור לשיחה עם **העסק** (לא עם הלקוחה), עם טקסט מוכן */
export function buildWhatsAppLinkToBusiness(base: string, message: string): string {
  return `${base}?text=${encodeURIComponent(message)}`
}

/**
 * 🔒 שורת ה-cutoff בניסוח של **הודעת אישור שינוי המועד**.
 *
 * ⚠️ ניסוח שונה מזה של הודעת האישור הרגילה ("ניתן לבצע" במקום "ניתן לבצע
 * שינוי או ביטול"), ולכן פונקציה נפרדת ולא שימוש חוזר. שני הנוסחים אושרו
 * בנפרד ואין לאחד אותם.
 *
 * 🔒 **אותו כלל נעול בדיוק:** הנוסח המאושר מכיל `{cutoffHours}` יחיד, אבל
 * ב-DB יש שני מפתחות. שווים ⟶ מספר אחד; שונים ⟶ **חובה להציג בנפרד**.
 * לעולם לא מספר שגוי, ואין ברירת מחדל שקטה.
 */
export function rescheduleCutoffLines(p: {
  cancelCutoffHours: number
  rescheduleCutoffHours: number
}): string[] {
  if (p.cancelCutoffHours === p.rescheduleCutoffHours) {
    return [
      `עד ${p.cancelCutoffHours} שעות לפני התור ניתן לבצע דרך האזור האישי באתר.`,
      'פחות מכך יש לפנות אלינו בוואטסאפ.',
    ]
  }
  return [
    `עד ${p.rescheduleCutoffHours} שעות לפני התור ניתן לשנות מועד דרך האזור האישי באתר.`,
    `עד ${p.cancelCutoffHours} שעות לפני התור ניתן לבטל דרך האזור האישי באתר.`,
    'מעבר לכך יש לפנות אלינו בוואטסאפ.',
  ]
}

/**
 * 🔒 **הנוסח המאושר** של דחיית בקשת תור.
 *
 * ⚠️ הוחלף ב-15F. הנוסח הקודם היה זמני וסומן ככזה. הנוסח כאן נמסר ואושר
 * מילה במילה — כולל מיקום האמוג'י והרווחים. אין לנסח אותו מחדש ואין
 * "לתקן" את הרווח בסוף השורה האחרונה: זה מה שאושר.
 *
 * ⚠️ בניגוד להודעת האישור, הנוסח הזה **כן** פונה ללקוחה בשמה.
 */
export interface RejectionMessageParams {
  customerName: string
  treatment: string
  date: string
  time: string
}

export function buildRejectionMessage(params: RejectionMessageParams): string {
  return [
    `היי ${params.customerName} 🌸`,
    '',
    `לצערי לא ניתן לאשר את התור שביקשת ל־${params.treatment}`,
    `בתאריך ${params.date} בשעה ${params.time}.`,
    '',
    '❤️אפשר לבחור מועד אחר דרך האתר או לשלוח לנו הודעה בוואטסאפ ונשמח לעזור ',
  ].join('\n')
}

/**
 * 🔒 **הנוסח המאושר** של אישור שינוי מועד.
 *
 * ⚠️ נוסח שהיה **חסר לגמרי** עד 15F — הנתיב reschedule-approve לא החזיר
 * whatsappUrl בכלל, ושובל נאלצה לכתוב ללקוחה מאפס.
 *
 * ⚠️ קוד הכניסה מגיע כפרמטר מ-`business_settings`, ולא מהקוד. ראה
 * STUDIO_DETAILS.
 */
export interface RescheduleApprovedMessageParams {
  treatment: string
  /** המועד **החדש** */
  date: string
  time: string
  buildingCode: string
  cutoffLines: string[]
}

export function buildRescheduleApprovedMessage(p: RescheduleApprovedMessageParams): string {
  return [
    ' ❤️שינוי המועד שלך אושר',
    '',
    `💆‍♀️ ${p.treatment}`,
    '',
    `📅 תאריך חדש: ${p.date}`,
    `🕒 שעה חדשה: ${p.time}`,
    '',
    `📍 ${STUDIO_DETAILS.address}`,
    STUDIO_DETAILS.addressNote,
    `🔑 קוד כניסה לבניין: ${p.buildingCode}`,
    '',
    'לשינוי או ביטול:',
    ...p.cutoffLines,
    '',
    ' ❤️ניפגש ',
  ].join('\n')
}

/**
 * 🔒 **הנוסח המאושר** של דחיית בקשת שינוי מועד.
 *
 * ⚠️ המועד בהודעה הוא **המועד המקורי** ולא זה שהתבקש. זו כל הנקודה של
 * ההודעה: התור הקיים נשאר שמור, והלקוחה צריכה לראות מולו את המועד שאליו
 * עליה להגיע. הצגת המועד שביקשה ושלא אושר הייתה בדיוק ההפך.
 */
export interface RescheduleRejectedMessageParams {
  treatment: string
  /** המועד **המקורי**, זה שנשאר שמור */
  date: string
  time: string
}

export function buildRescheduleRejectedMessage(p: RescheduleRejectedMessageParams): string {
  return [
    'בקשת שינוי המועד שלך לא אושרה.',
    '',
    '❤️התור המקורי שלך נשאר שמור ',
    '',
    `💆‍♀️ ${p.treatment}`,
    `📅 ${p.date}`,
    `🕒 ${p.time}`,
    '',
    ' אם תרצי לבדוק מועד אחר, אפשר להיכנס שוב לאזור האישי.',
  ].join('\n')
}

/** בונה קישור wa.me לשיחה עם הלקוחה (לא עם העסק) — טלפון + טקסט מקודד */
export function buildWhatsAppLinkToCustomer(phoneE164: string, message: string): string {
  const digits = phoneE164.replace(/^\+/, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

/**
 * קישור לשיחה עם הלקוחה **בלי טקסט מוכן** — לכפתור ה-WhatsApp ב-CRM.
 *
 * בכוונה ללא הודעה: פתיחת שיחה מפרופיל הלקוחה אינה פעולה טיפולית או
 * שיווקית, ואין שום נוסח שנכון להמציא עבורה. שובל כותבת בעצמה.
 * הכפתור נפתח אך ורק בלחיצה, ואינו נרשם כאילו נשלחה הודעה.
 */
export function buildWhatsAppLinkPlain(phoneE164: string): string {
  return `https://wa.me/${phoneE164.replace(/^\+/, '')}`
}
