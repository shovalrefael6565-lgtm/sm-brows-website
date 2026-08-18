/**
 * אישור מדיניות הפרטיות — מקור אמת יחיד לגרסה, לנוסח הקצר ולנתיב.
 *
 * PRIVACY_NOTICE_VERSION מתעדכן בכל שינוי מהותי בנוסח מדיניות הפרטיות, כדי
 * שניתן יהיה לדעת לאיזו גרסת הודעה אישרה הלקוחה שקראה בכל בקשת תור (הגרסה
 * נשמרת על שורת התור ב-DB, יחד עם privacy_notice_acknowledged_at שנקבע בשרת).
 *
 * ⚠️ נפרד לגמרי מ-lib/bookingPolicy.ts (POLICY_VERSION). זו מדיניות
 * פרטיות — מה קורה עם המידע האישי — ולא מדיניות תורים/ביטולים. שני
 * העמודות ב-appointments (policy_version מול privacy_notice_version)
 * נשמרות בנפרד ואינן מתערבבות.
 */
export const PRIVACY_NOTICE_VERSION = '1.1'
export const PRIVACY_NOTICE_UPDATED = 'אוגוסט 2026'
export const PRIVACY_PATH = '/privacy'
export const CONTACT_PATH = '/contact'

const PRIVACY_LINK_ANCHOR = 'מדיניות הפרטיות'
const CONTACT_LINK_ANCHOR = 'עמוד יצירת הקשר'

/**
 * מפצלת נוסח שמכיל את המחרוזת "מדיניות הפרטיות" (ההופעה הראשונה) לשלושה
 * מקטעים, כדי שאפשר יהיה לרנדר אותה כקישור אמיתי (`<Link>`) בלי לשכפל את
 * הנוסח בכל קומפוננטה בנפרד:
 *
 *   {before}<Link href={PRIVACY_PATH}>{linkText}</Link>{after}
 *
 * הרכבה מחדש (before + linkText + after) שווה תמיד למחרוזת המקורית — כך
 * שהטקסט המוצג בפועל לעולם לא יכול לסטות מהנוסח המאושר כאן.
 *
 * ⚠️ משמשת רק את PRIVACY_ACK_LABEL (checkbox, קישור יחיד). שלושת הודעות
 * נקודת האיסוף (BOOKING/OTP/PROFILE_PRIVACY_NOTICE) כוללות **שני** קישורים
 * (יצירת קשר + מדיניות פרטיות) ולכן מרונדרות דרך splitNoticeLinks למטה.
 */
export function splitPrivacyLink(text: string): { before: string; linkText: string; after: string } {
  const i = text.indexOf(PRIVACY_LINK_ANCHOR)
  if (i === -1) return { before: text, linkText: '', after: '' }
  return {
    before: text.slice(0, i),
    linkText: PRIVACY_LINK_ANCHOR,
    after: text.slice(i + PRIVACY_LINK_ANCHOR.length),
  }
}

export interface NoticeSegment {
  text: string
  /** קיים ⟺ המקטע הזה צריך לרנדר כ-<Link>, לא כטקסט רגיל */
  href?: string
}

/**
 * מפצלת נוסח הודעת איסוף לרשימת מקטעים, לרינדור כקישורים אמיתיים בלי
 * לשכפל את הנוסח בקומפוננטה. מזהה שני עוגנים בלבד, לפי סדר הופעתם בטקסט:
 * "עמוד יצירת הקשר" (→ CONTACT_PATH) ו-"מדיניות הפרטיות" (→ PRIVACY_PATH).
 *
 * הרכבה מחדש של כל ה-`text` במקטעים שווה תמיד למחרוזת המקורית — הטקסט
 * המוצג בפועל לעולם לא יכול לסטות מהנוסח המאושר כאן.
 */
export function splitNoticeLinks(text: string): NoticeSegment[] {
  const anchors: { label: string; href: string }[] = [
    { label: CONTACT_LINK_ANCHOR, href: CONTACT_PATH },
    { label: PRIVACY_LINK_ANCHOR, href: PRIVACY_PATH },
  ]
  const segments: NoticeSegment[] = []
  let remaining = text
  while (remaining.length > 0) {
    let matchIndex = -1
    let matchAnchor: { label: string; href: string } | null = null
    for (const anchor of anchors) {
      const idx = remaining.indexOf(anchor.label)
      if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) {
        matchIndex = idx
        matchAnchor = anchor
      }
    }
    if (matchIndex === -1 || !matchAnchor) {
      segments.push({ text: remaining })
      break
    }
    if (matchIndex > 0) segments.push({ text: remaining.slice(0, matchIndex) })
    segments.push({ text: matchAnchor.label, href: matchAnchor.href })
    remaining = remaining.slice(matchIndex + matchAnchor.label.length)
  }
  return segments
}

/**
 * הנוסח הקצר שמוצג ליד כל נקודת איסוף PII (טפסי הזמנה, OTP, השלמת פרופיל).
 * יש לרנדר דרך splitNoticeLinks (לא splitPrivacyLink — יש כאן שני קישורים).
 *
 * 🔒 כל נוסח כולל בכוונה: חובה/רשות, מטרה, תוצאת אי-מסירה, מיפוי מדויק של
 * מקבלי המידע **והמטרה של כל אחד** (לא "ספקים כגון" עמום — כל ספק מופיע
 * עם הסיבה הקונקרטית שבגללה המידע מגיע אליו, לפי הזרימה בפועל של נקודת
 * האיסוף הזו בלבד), אפשרות לבקש עיון/תיקון, זהות בעלת השליטה במידע וקישור
 * ליצירת קשר (בלי להמציא פרטי קשר חדשים — /contact הוא עמוד קיים באתר),
 * וקישור למדיניות הפרטיות. "עמוד יצירת הקשר" ו-"מדיניות הפרטיות" מופיעים
 * **פעם אחת בלבד** כל אחד, כדי ש-splitNoticeLinks יקשר בדיוק את המופע הנכון.
 */
export const BOOKING_PRIVACY_NOTICE =
  'שם ומספר טלפון הם שדות חובה ונדרשים לצורך זיהוי הלקוחה, ניהול כרטיס הלקוחה, ' +
  'טיפול בבקשת התור ויצירת קשר בקשר לשירות. ללא מסירתם לא ניתן לשלוח בקשת תור. ' +
  'שדה ההערות הוא רשות. האתר מופעל באמצעות Vercel; בקשת התור נשמרת ב-Supabase; ' +
  'שם, טיפול ומועד בלבד עשויים להירשם ב-Google Calendar לצורך ניהול היומן; ' +
  'מספר הטלפון עשוי לשמש למשלוח הודעות שירות באמצעות 019 SMS. ניתן לבקש לעיין במידע או ' +
  'לתקנו. בעלת השליטה במידע היא שובל מאירה (SM Brows). ניתן ליצור קשר באמצעות עמוד יצירת ' +
  'הקשר באתר. מידע נוסף במדיניות הפרטיות.'

export const OTP_PRIVACY_NOTICE =
  'מספר הטלפון הוא שדה חובה, נדרש לצורך זיהוי ושליחת קוד כניסה חד-פעמי. ללא מסירתו לא ניתן ' +
  'להיכנס לאזור האישי. האתר מופעל באמצעות Vercel; נתוני האימות מעובדים ונשמרים ב-Supabase; ' +
  'מספר הטלפון מועבר ל-019 לצורך שליחת קוד הכניסה. ניתן לבקש לעיין במידע או ' +
  'לתקנו. בעלת השליטה במידע היא שובל מאירה (SM Brows). ניתן ליצור קשר באמצעות עמוד יצירת ' +
  'הקשר באתר. מידע נוסף במדיניות הפרטיות.'

export const PROFILE_PRIVACY_NOTICE =
  'השם הוא שדה חובה, נדרש לצורך זיהוי, ניהול כרטיס הלקוחה והתורים ויצירת קשר בנוגע לשירות. ' +
  'ללא מסירתו לא ניתן להשלים את הפרופיל. האתר מופעל באמצעות Vercel; פרטי הפרופיל נשמרים ' +
  'ב-Supabase; כאשר מנוהל תור, שם, טיפול ומועד בלבד עשויים להירשם ב-Google Calendar. ' +
  'ניתן לבקש לעיין במידע או לתקנו. בעלת השליטה במידע היא שובל מאירה (SM Brows). ' +
  'ניתן ליצור קשר באמצעות עמוד יצירת הקשר באתר. מידע נוסף במדיניות הפרטיות.'

/**
 * ⚠️ החלטת בעלים מחייבת (שלב 8): אין לבקש או להעביר מידע רפואי, רגישויות
 * או אלרגיות דרך האתר או WhatsApp — בירור כזה נעשה רק בטלפון או בפגישה עם
 * שובל. הנוסח כאן **אוסר** מפורשות את הקטגוריות האלה, ולכן הן מוזכרות
 * בכוונה (בהקשר איסור, לא הזמנה למלא אותן).
 */
export const NOTES_SENSITIVE_INFO_NOTICE =
  'אין להזין כאן מידע רפואי, רגישויות, אלרגיות או מידע אישי רגיש. לבירור התאמה לטיפול ' +
  'יש לפנות לשובל בטלפון או לשוחח איתה בפגישה — לא דרך האתר או WhatsApp.'

/**
 * נוסח checkbox האישור החובה בטופסי ההזמנה (ציבורי + אזור אישי). יש לרנדר
 * דרך splitPrivacyLink.
 *
 * 🔒 שלב 8 — זהו acknowledgement שקראה את הודעת הפרטיות ואת מדיניות
 * הפרטיות, **לא** הסכמה לעיבוד המידע. אין לנסח מחדש בכיוון "אני מסכימה" —
 * עיבוד המידע מבוסס על הכרחיות למתן השירות, לא רק על הסכמה, וערבוב בין
 * השניים היה שקר משפטי. אינו כולל פרסום, דיוור שיווקי, GA4 או Meta Pixel —
 * אלה נשארים ב-consent הנפרד של שלב 6 (lib/consentContext.tsx). אין להרחיב
 * את הנוסח הזה כדי לכלול אותם.
 */
export const PRIVACY_ACK_LABEL = 'קראתי את הודעת הפרטיות ואת מדיניות הפרטיות'

export const PRIVACY_ACK_ERROR = 'יש לאשר את מדיניות הפרטיות כדי לשלוח בקשת תור'
