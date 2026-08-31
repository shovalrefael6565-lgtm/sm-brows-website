import { SMS019_MAX_MESSAGE_CHARS } from '@/lib/reminders/sms019Mapping'

/**
 * 🔒 המנוע היחיד שסופר, מרכיב ומאמת הודעת דיוור.
 *
 * ═══ למה זה קובץ אחד, ולמה הוא טהור ═══════════════════════════════════════
 *
 * המונה במסך, ה-preview, האימות בשרת, בדיקת התקן של 019 והשליחה עצמה —
 * **כולם קוראים לפונקציות שכאן**. אילו המסך היה סופר לבד והשרת אחרת, שובל
 * הייתה רואה "יחידה אחת" ומשלמת על שתיים, או מקבלת דחייה על הודעה שהמסך
 * אישר. מספר אחד, מקור אחד.
 *
 * ⚠️ בלי 'server-only' ובלי import לשום דבר שרתי: הקובץ נטען גם בדפדפן.
 * הקבוע היחיד שמיובא הוא מגבלת האורך של 019, והוא ידע טהור על הספק.
 */

/** זיהוי העסק בראש כל הודעת דיוור. חובה — הנמענת חייבת לדעת ממי זה. */
export const BUSINESS_IDENTIFIER = 'S.M BROWS'

/** הבסיס של קישור ההסרה. ללא סכמה — https:// היה עולה 8 תווים לחינם. */
export const OPT_OUT_URL_BASE = 'smbrows.co.il/u/'

/**
 * אורך ה-token: 16 בתים ב-base64url = 22 תווים, **תמיד**.
 *
 * ⚠️ זה מה שהופך את ספירת ה-segments לדטרמיניסטית: לכל נמענת קישור אחר,
 * אבל באותו אורך בדיוק, ולכן ההודעה הסופית זהה באורכה לכולן. אפשר לחשב
 * ולהציג מספר אחד לפני שיודעים למי שולחים.
 */
export const OPT_OUT_TOKEN_LENGTH = 22

/** תו placeholder באורך הנכון, ל-preview ולספירה לפני שיש token אמיתי. */
const TOKEN_PLACEHOLDER = 'x'.repeat(OPT_OUT_TOKEN_LENGTH)

/** מגבלת הספק. חורג ממנה = לא נשלח, ולא "נחתך". */
export const PROVIDER_MAX_CHARS = SMS019_MAX_MESSAGE_CHARS

/**
 * גבולות יחידת SMS בעברית.
 *
 * ⚠️ עברית אינה ב-GSM-7 ולכן כל הודעה עם עברית נשלחת ב-UCS-2: 70 תווים
 * ליחידה בודדת, ו-67 לכל חלק כשההודעה מתפצלת (3 תווים לכל חלק הולכים
 * לכותרת השרשור). זו הסיבה ש-71 תווים הם **שתי** יחידות ולא אחת וקצת.
 */
export const UCS2_SINGLE_MAX = 70
export const UCS2_CONCAT_PART = 67

/** גבולות GSM-7, למקרה שההודעה כולה באנגלית/ספרות */
const GSM7_SINGLE_MAX = 160
const GSM7_CONCAT_PART = 153

/**
 * ⚠️ נספר ביחידות קוד UTF-16 ולא ב-code points: זו היחידה שבה נמדדת
 * הודעת UCS-2 בפועל. אמוג'י מחוץ ל-BMP תופס שניים, וזה נכון — הוא באמת
 * תופס שני תווים בהודעה.
 */
export function messageLength(text: string): number {
  return text.length
}

const GSM7_CHARS =
  '@£$¥èéùìòÇØøÅå_ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà\n\r'
const GSM7_EXTENDED = '^{}\\[~]|€'

/** האם כל התווים נכנסים ב-GSM-7. תו עברי אחד מספיק כדי שהתשובה תהיה לא. */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_CHARS.includes(ch) && !GSM7_EXTENDED.includes(ch)) return false
  }
  return true
}

export interface SmsUnits {
  chars: number
  segments: number
  encoding: 'gsm7' | 'ucs2'
  /** כמה תווים נשארו עד היחידה הבאה */
  charsUntilNextSegment: number
}

/**
 * ספירת יחידות ה-SMS של טקסט נתון.
 *
 * ⚠️ טקסט ריק הוא 0 יחידות ולא 1 — אין הודעה, אין חיוב.
 */
export function smsUnits(text: string): SmsUnits {
  const chars = messageLength(text)
  const gsm = isGsm7(text)
  const single = gsm ? GSM7_SINGLE_MAX : UCS2_SINGLE_MAX
  const part = gsm ? GSM7_CONCAT_PART : UCS2_CONCAT_PART

  if (chars === 0) {
    return { chars: 0, segments: 0, encoding: gsm ? 'gsm7' : 'ucs2', charsUntilNextSegment: single }
  }

  const segments = chars <= single ? 1 : Math.ceil(chars / part)
  const capacity = segments === 1 ? single : segments * part
  return {
    chars,
    segments,
    encoding: gsm ? 'gsm7' : 'ucs2',
    charsUntilNextSegment: capacity - chars,
  }
}

/**
 * 🔒 ההרכבה של ההודעה הסופית — **הפונקציה היחידה** שיודעת איך נראית
 * הודעת דיוור שיוצאת מהמערכת.
 *
 *   S.M BROWS: <גוף הקמפיין>
 *   להסרה: smbrows.co.il/u/<token>
 *
 * ⚠️ זיהוי העסק וקישור ההסרה אינם אופציה. שולח אלפאנומרי אינו מקבל
 * תשובות, ולכן הקישור הוא **ערוץ ההסרה היחיד** של הנמענת — הודעה בלעדיו
 * היא דיוור שאי אפשר לצאת ממנו.
 */
export function renderMarketingSms(body: string, token: string): string {
  return `${BUSINESS_IDENTIFIER}: ${body.trim()}\nלהסרה: ${OPT_OUT_URL_BASE}${token}`
}

/**
 * אותה הרכבה בדיוק, עם token דמה באורך הנכון.
 *
 * 🔒 זו הפונקציה שהמונה ב-UI, ה-preview והאימות בשרת קוראים לה. היא מחזירה
 * טקסט שאורכו **זהה** לאורך מה שיישלח בפועל לכל נמענת, ולכן המספר שמוצג
 * הוא המספר שיחויב.
 */
export function renderMarketingSmsPreview(body: string): string {
  return renderMarketingSms(body, TOKEN_PLACEHOLDER)
}

export type MarketingBodyError = 'empty' | 'too_long_for_provider'

export interface MarketingMessageStats extends SmsUnits {
  /** ההודעה הסופית כפי שתיראה (עם token דמה) */
  preview: string
  /** null = תקין */
  error: MarketingBodyError | null
}

/**
 * הערכת גוף קמפיין — הפונקציה שמזינה גם את המסך וגם את השרת.
 *
 * ⚠️ מגבלת הספק נבדקת על ה-**הודעה הסופית**, לא על הגוף שהוקלד. גוף באורך
 * המקסימום עם קישור הסרה חורג ממנו, ואילו נבדק הגוף לבדו היינו שולחים
 * ל-019 הודעה שהוא דוחה.
 *
 * ⚠️ אין חיתוך אוטומטי. חורג = שגיאה, והמנהלת מקצרת בעצמה.
 */
export function evaluateMarketingBody(body: string): MarketingMessageStats {
  const preview = renderMarketingSmsPreview(body)
  const units = smsUnits(preview)

  let error: MarketingBodyError | null = null
  if (body.trim() === '') error = 'empty'
  else if (units.chars > PROVIDER_MAX_CHARS) error = 'too_long_for_provider'

  return { ...units, preview, error }
}
