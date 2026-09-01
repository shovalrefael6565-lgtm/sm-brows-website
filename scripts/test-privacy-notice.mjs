/**
 * שלב 8 — יידוע פרטיות, אישור מתועד וצמצום מידע רגיש.
 *
 * בדיקות מבוססות-מקור (regex/substring) על הרכיבים והראוטים, במקביל
 * לבדיקות ה-DB האמיתיות (PGlite) שכבר קיימות ב-scripts/test-public-booking-db.mjs
 * ו-scripts/test-personal-area-db.mjs (אכיפת PRIVACY_NOT_ACKNOWLEDGED,
 * privacy_notice_version/privacy_notice_acknowledged_at, ואי-קבלת אישור מזויף
 * בתור ידני של אדמין).
 *
 * מכסה:
 *   1. אין ניסוח שמזמין רגישויות/אלרגיות/מידע רפואי בשדות הטופס עצמם, אבל
 *      אזהרת השדה כן אוסרת עליהן במפורש (איסור, לא הזמנה).
 *   2. יידוע קצר + קישור ל-/privacy בכל נקודת איסוף (הזמנה ציבורית, הזמנה
 *      באזור אישי, OTP, השלמת פרופיל).
 *   3. checkbox חובה, לא מסומן מראש, בשני טופסי ההזמנה — ולא במסך הכניסה.
 *      שם השדה privacyNoticeAcknowledged (לא privacyAccepted/consent), והנוסח
 *      הוא acknowledgement של קריאה, לא "אני מסכימה".
 *   4. שני ה-routes דוחים בקשה בלי privacyNoticeAcknowledged/גרסה תקפה, לפני
 *      כל כתיבה.
 *   5. הערות חופשיות אינן נכנסות לשום הודעת WhatsApp שהקוד בונה (כולל
 *      buildBookingRequestMessage) וגם לא לתיאור אירוע Google Calendar;
 *      מספר הטלפון גם הוא הוסר מאירועי Google Calendar — רק שם, טיפול ומועד.
 *   6. מדיניות הפרטיות כוללת קטגוריות מידע, ספקים וזכויות, משקפת נכון את
 *      מה שה-Calendar מקבל בפועל (בלי טלפון), ומתארת את ה-checkbox
 *      כ-acknowledgement ולא כהסכמת עיבוד. גרסתה תואמת את PRIVACY_NOTICE_VERSION.
 *   7. consent של שלב 6 (GA/Meta) עדיין מחובר ל-npm run test.
 *   8. lib/sms/twilioProvider.ts אינו רושם data.message גולמי.
 *   9. אין בשום מקום טענה שה-RPC מגן מפני service_role שדלף/נוצל לרעה.
 *   10. אזהרת מידע רפואי/רגיש קיימת ליד הערות ה-CRM הפנימיות של האדמין.
 *
 * הרצה:  npm run test:privacy-notice
 */

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(70)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}

import { readFileSync } from 'fs'
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const bookingFormSrc = src('components/booking/BookingForm.tsx')
const accountFormSrc = src('components/account/AccountBookingForm.tsx')
const loginFormSrc = src('components/account/LoginForm.tsx')
const profileFormSrc = src('components/account/CompleteProfileForm.tsx')
const privacyNoticeSrc = src('lib/privacyNotice.ts')
const privacyContentSrc = src('components/privacy/PrivacyContent.tsx')
const publicRouteSrc = src('app/api/bookings/request/route.ts')
const accountRouteSrc = src('app/api/appointments/route.ts')
const whatsappTemplatesSrc = src('lib/whatsappTemplates.ts')
const googleCalendarSrc = src('lib/googleCalendar.ts')
const twilioSrc = src('lib/sms/twilioProvider.ts')
const migrationSrc = src('supabase/migrations/0031_privacy_notice_ack.sql')
const dbLayerSrc = src('lib/db/appointments.ts')
const customerNotesSrc = src('components/admin/CustomerNotes.tsx')

// ─── 1. שדות הטופס עצמם אינם מזמינים מידע רגיש, אבל האזהרה אוסרת עליו ────────
section('שדות הטופס אינם מזמינים מידע רגיש; האזהרה אוסרת עליו במפורש')

const REQUIRED_PLACEHOLDER = 'לדוגמה: בקשה בנוגע לשעת ההגעה או לתיאום התור'
for (const [name, formSrc] of [['BookingForm.tsx (ציבורי)', bookingFormSrc], ['AccountBookingForm.tsx (אזור אישי)', accountFormSrc]]) {
  chk(`${name}: placeholder השדה הוא הנוסח הלוגיסטי הנדרש`,
    formSrc.includes(`placeholder="${REQUIRED_PLACEHOLDER}"`))
  chk(`${name}: שם השדה "בקשות לתיאום התור"`, /בקשות לתיאום התור/.test(formSrc))
  chk(`${name}: אין בטופס עצמו (placeholder/label) הזמנה למלא רגישויות/אלרגיות/מידע רפואי`,
    !new RegExp(`placeholder="[^"]*(רגיש|אלרג|רפוא)`).test(formSrc))
}

chk('🔒 NOTES_SENSITIVE_INFO_NOTICE אוסרת במפורש מידע רפואי', /מידע רפואי/.test(privacyNoticeSrc))
chk('🔒 NOTES_SENSITIVE_INFO_NOTICE אוסרת במפורש רגישויות', /רגישויות/.test(privacyNoticeSrc))
chk('🔒 NOTES_SENSITIVE_INFO_NOTICE אוסרת במפורש אלרגיות', /אלרגיות/.test(privacyNoticeSrc))
chk('🔒 NOTES_SENSITIVE_INFO_NOTICE מפנה לבירור בטלפון או בפגישה',
  /בטלפון[\s\S]{0,30}בפגישה|בפגישה[\s\S]{0,30}בטלפון/.test(privacyNoticeSrc))
chk('🔒 NOTES_SENSITIVE_INFO_NOTICE שוללת בירור דרך האתר או WhatsApp',
  /לא דרך האתר או WhatsApp/.test(privacyNoticeSrc))
chk('🔒 שני הטפסים מרנדרים את NOTES_SENSITIVE_INFO_NOTICE ליד שדה ההערות',
  /NOTES_SENSITIVE_INFO_NOTICE/.test(bookingFormSrc) && /NOTES_SENSITIVE_INFO_NOTICE/.test(accountFormSrc))

// ─── 2. יידוע + קישור ל-/privacy בכל נקודת איסוף ─────────────────────────────
section('יידוע פרטיות קצר + קישור ל-/privacy ול-/contact בכל נקודת איסוף')

chk('🔒 CONTACT_PATH הוא /contact', /export const CONTACT_PATH = '\/contact'/.test(privacyNoticeSrc))
chk('🔒 splitNoticeLinks ממפה את עוגן "עמוד יצירת הקשר" ל-CONTACT_PATH',
  /label:\s*CONTACT_LINK_ANCHOR,\s*href:\s*CONTACT_PATH/.test(privacyNoticeSrc))
chk('🔒 splitNoticeLinks ממפה את עוגן "מדיניות הפרטיות" ל-PRIVACY_PATH',
  /label:\s*PRIVACY_LINK_ANCHOR,\s*href:\s*PRIVACY_PATH/.test(privacyNoticeSrc))

for (const [name, src, noticeConst] of [
  ['BookingForm (ציבורי)', bookingFormSrc, 'BOOKING_PRIVACY_NOTICE'],
  ['AccountBookingForm (אזור אישי)', accountFormSrc, 'BOOKING_PRIVACY_NOTICE'],
  ['LoginForm (OTP)', loginFormSrc, 'OTP_PRIVACY_NOTICE'],
  ['CompleteProfileForm (השלמת פרופיל)', profileFormSrc, 'PROFILE_PRIVACY_NOTICE'],
]) {
  chk(`${name} מייבא ומרנדר את היידוע דרך splitNoticeLinks (שני קישורים אפשריים, לא splitPrivacyLink)`,
    new RegExp(noticeConst).test(src) && /splitNoticeLinks/.test(src))
  chk(`${name}: מרנדרת <Link> עם href דינמי (seg.href) ולא URL קשיח בגוף היידוע`,
    /href=\{seg\.href\}/.test(src))
}
chk('🔒 LoginForm אינו מוסיף checkbox חובה למסך הכניסה',
  !/type="checkbox"/.test(loginFormSrc))

{
  // 🔒 כל אחד משלושת הנוסחים חייב לכלול: חובה/רשות, מטרה, תוצאת אי-מסירה,
  // מיפוי מדויק (לא "ספקים כגון" עמום) של מקבלי המידע והמטרה של כל אחד,
  // זכות עיון/תיקון, זהות בעלת השליטה ("שובל מאירה (SM Brows)") וקישור
  // ליצירת קשר, וקישור יחיד למדיניות (כדי ש-splitNoticeLinks יקשר בדיוק
  // את המופע הנכון של כל עוגן).
  const extractNotice = (name) => {
    const re = new RegExp(`export const ${name} =([\\s\\S]*?)\\n\\n`)
    const m = privacyNoticeSrc.match(re)
    if (!m) return null
    return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]).join('')
  }
  const notices = {
    BOOKING_PRIVACY_NOTICE: extractNotice('BOOKING_PRIVACY_NOTICE'),
    OTP_PRIVACY_NOTICE: extractNotice('OTP_PRIVACY_NOTICE'),
    PROFILE_PRIVACY_NOTICE: extractNotice('PROFILE_PRIVACY_NOTICE'),
  }
  for (const [name, text] of Object.entries(notices)) {
    chk(`${name}: חולץ מהמקור בהצלחה`, typeof text === 'string' && text.length > 0)
    if (!text) continue
    chk(`${name}: מזכיר "חובה" (רכיב חובה/רשות)`, /חובה/.test(text))
    chk(`${name}: מסביר תוצאת אי-מסירה ("ללא מסירת")`, /ללא מסירת/.test(text))
    chk(`${name}: מזכיר סוג מקבל מידע רלוונטי (Vercel/Supabase/Google Calendar/019)`,
      /Vercel|Supabase|Google Calendar|019/.test(text))
    chk(`${name}: 🔒 אין ניסוח עמום "ספקים כגון"`, !/ספקים כגון/.test(text))
    chk(`${name}: כולל זכות עיון/תיקון ("לעיין במידע או לתקנו")`,
      /לעיין במידע או לתקנו/.test(text))
    chk(`${name}: 🔒 מזכיר במפורש את בעלת השליטה — "שובל מאירה (SM Brows)"`,
      /שובל מאירה \(SM Brows\)/.test(text))
    chk(`${name}: 🔒 מכיל "עמוד יצירת הקשר" פעם אחת בדיוק (קישור ל-/contact, בלי להמציא פרטי קשר)`,
      (text.match(/עמוד יצירת הקשר/g) ?? []).length === 1)
    chk(`${name}: מכיל "מדיניות הפרטיות" פעם אחת בדיוק (כדי שהקישור יפול במקום הנכון)`,
      (text.match(/מדיניות הפרטיות/g) ?? []).length === 1)
  }
  chk('BOOKING_PRIVACY_NOTICE: מבחין בין שם+טלפון (חובה) לבין הערות (רשות)',
    /שדה ההערות הוא רשות/.test(notices.BOOKING_PRIVACY_NOTICE ?? ''))

  // 🔒 Supabase הוא מאגר המידע הראשי; Vercel רק מפעילה את האתר. אסור לטעון
  // ששני הספקים "שומרים" את המידע יחד — ראה תיקון הניסוח (סבב אחרון).
  for (const [name, text] of Object.entries(notices)) {
    chk(`${name}: 🔒 אין ניסוח מטעה "נשמר באמצעות Vercel ו-Supabase" (Vercel מפעילה, לא שומרת)`,
      !/נשמר(ת)? באמצעות Vercel ו-Supabase|מעובד(ים)? (ו)?נשמר(ים)? באמצעות Vercel ו-Supabase/.test(text))
    chk(`${name}: 🔒 מפריד בין הפעלת האתר (Vercel) לשמירת המידע (Supabase) בשתי אמירות נפרדות`,
      /האתר מופעל באמצעות Vercel/.test(text))
  }

  chk('🔒 BOOKING_PRIVACY_NOTICE: "האתר מופעל באמצעות Vercel; בקשת התור נשמרת ב-Supabase"',
    /האתר מופעל באמצעות Vercel; בקשת התור נשמרת ב-Supabase/.test(notices.BOOKING_PRIVACY_NOTICE ?? ''))
  chk('🔒 BOOKING_PRIVACY_NOTICE: Google Calendar מקבל שם+טיפול+מועד בלבד',
    /שם, טיפול ומועד בלבד עשויים להירשם ב-Google Calendar/.test(notices.BOOKING_PRIVACY_NOTICE ?? ''))
  chk('🔒 BOOKING_PRIVACY_NOTICE: 019 SMS משמש להודעות שירות (לא לכל מטרה)',
    /019 SMS/.test(notices.BOOKING_PRIVACY_NOTICE ?? ''))

  chk('🔒 OTP_PRIVACY_NOTICE: "האתר מופעל באמצעות Vercel; נתוני האימות מעובדים ונשמרים ב-Supabase"',
    /האתר מופעל באמצעות Vercel; נתוני האימות מעובדים ונשמרים ב-Supabase/.test(notices.OTP_PRIVACY_NOTICE ?? ''))
  chk('🔒 OTP_PRIVACY_NOTICE: מספר הטלפון מועבר ל-019 לשליחת קוד הכניסה',
    /מספר הטלפון מועבר ל-019 לצורך שליחת קוד הכניסה/.test(notices.OTP_PRIVACY_NOTICE ?? ''))

  chk('🔒 PROFILE_PRIVACY_NOTICE: "האתר מופעל באמצעות Vercel; פרטי הפרופיל נשמרים ב-Supabase"',
    /האתר מופעל באמצעות Vercel; פרטי הפרופיל נשמרים ב-Supabase/.test(notices.PROFILE_PRIVACY_NOTICE ?? ''))
  chk('🔒 PROFILE_PRIVACY_NOTICE: כאשר מנוהל תור, Google Calendar מקבל שם+טיפול+מועד בלבד',
    /כאשר מנוהל תור, שם, טיפול ומועד בלבד עשויים להירשם ב-Google Calendar/.test(notices.PROFILE_PRIVACY_NOTICE ?? ''))
}

// ─── 3. checkbox אישור פרטיות — שם שדה, נוסח וחובה ────────────────────────────
section('checkbox אישור פרטיות — privacyNoticeAcknowledged, נוסח acknowledgement, לא מסומן מראש')

chk('🔒 PRIVACY_ACK_LABEL הוא בדיוק הנוסח שנדרש (acknowledgement, לא "מסכימה")',
  /export const PRIVACY_ACK_LABEL = 'קראתי את הודעת הפרטיות ואת מדיניות הפרטיות'/.test(privacyNoticeSrc))

chk('🔒 אין שימוש בשדה privacyAccepted (שם אסור) בטופס הציבורי, באזור האישי או בשני ה-routes',
  ![bookingFormSrc, accountFormSrc, publicRouteSrc, accountRouteSrc].some(s => /\bprivacyAccepted\b/.test(s)))

chk('BookingForm: privacyNoticeAcknowledged מתחיל false ב-EMPTY_FORM',
  /privacyNoticeAcknowledged:\s*false/.test(bookingFormSrc))
chk('BookingForm: validateFinal חוסמת שליחה בלי privacyNoticeAcknowledged',
  /if \(!f\.privacyNoticeAcknowledged\)/.test(bookingFormSrc))
chk('BookingForm: ה-checkbox עצמו checked={form.privacyNoticeAcknowledged} (לא true קשיח)',
  /checked=\{form\.privacyNoticeAcknowledged\}/.test(bookingFormSrc))
chk('AccountBookingForm: useState(false) עבור privacyNoticeAcknowledged',
  /const \[privacyNoticeAcknowledged, setPrivacyNoticeAcknowledged\] = useState\(false\)/.test(accountFormSrc))
chk('AccountBookingForm: canSubmit דורש privacyNoticeAcknowledged',
  /canSubmit =[\s\S]{0,200}privacyNoticeAcknowledged/.test(accountFormSrc))

// ─── 3ב. תיבת הדיוור השנייה — רשות, ולא מעורבת באישור החובה ─────────────────
section('תיבת הדיוור האופציונלית מוזכרת בנוסח הפרטיות ואינה מתערבבת באישור החובה')

chk('🔒 BOOKING_PRIVACY_NOTICE מבהיר שסימון הדיוור הוא רשות ואינו תנאי לקביעת התור',
  /סימון אישור הדיוור הוא רשות ואינו תנאי לקביעת התור/.test(privacyNoticeSrc))
chk('🔒 BOOKING_PRIVACY_NOTICE מציין את מטרת הדיוור ואת אפשרות ההסרה',
  /עדכונים והטבות באמצעות 019 SMS/.test(privacyNoticeSrc) &&
  /להסיר את ההסכמה בכל עת/.test(privacyNoticeSrc))
chk('🔒 PRIVACY_ACK_LABEL עצמו לא הורחב לכלול דיוור שיווקי',
  !/דיוור|הטבות|עדכונים/.test(
    (privacyNoticeSrc.match(/export const PRIVACY_ACK_LABEL = '[^']*'/) ?? [''])[0]))
chk('🔒 מדיניות הפרטיות מתארת את התיבה השנייה כנפרדת, אופציונלית ולא מסומנת מראש',
  /תיבה שנייה, נפרדת ואופציונלית/.test(privacyContentSrc) &&
  /אינה מסומנת מראש ואינה תנאי לקביעת/.test(privacyContentSrc))
chk('🔒 מדיניות הפרטיות מבהירה שהסרה מדיוור אינה עוצרת הודעות שירות ו-OTP',
  /אינה עוצרת הודעות שירות בנוגע לתור ואינה עוצרת את קוד הכניסה/.test(privacyContentSrc))

// ─── 4. שני ה-routes דוחים בקשה בלי אישור, לפני כל כתיבה ────────────────────
section('אכיפת אישור פרטיות בצד השרת, לפני יצירת בקשת התור')

for (const [name, routeSrc] of [['bookings/request (ציבורי)', publicRouteSrc], ['appointments (אזור אישי)', accountRouteSrc]]) {
  chk(`${name}: בודק body.privacyNoticeAcknowledged !== true`, /privacyNoticeAcknowledged !== true/.test(routeSrc))
  chk(`${name}: בודק את הגרסה מול PRIVACY_NOTICE_VERSION`, /privacyNoticeVersion !== PRIVACY_NOTICE_VERSION/.test(routeSrc))
  chk(`${name}: מחזיר 400 privacy_not_acknowledged`, /privacy_not_acknowledged/.test(routeSrc))
}
{
  // 🔒 סדר: בדיקת הפרטיות חייבת להיות *לפני* קריאת ה-RPC/כתיבה כלשהי —
  // לא רק "קיימת בקובץ". בודקים שהיא מופיעה לפני קריאת createPublicBookingRequest/
  // createPersonalAreaBookingRequest.
  const publicCode = stripComments(publicRouteSrc)
  const iPublicCheck = publicCode.indexOf('privacyNoticeAcknowledged !== true')
  const iPublicCall = publicCode.indexOf('createPublicBookingRequest(')
  chk('🔒 bookings/request: בדיקת הפרטיות מופיעה לפני הקריאה ל-createPublicBookingRequest',
    iPublicCheck !== -1 && iPublicCall !== -1 && iPublicCheck < iPublicCall)

  const accountCode = stripComments(accountRouteSrc)
  const iAcctCheck = accountCode.indexOf('privacyNoticeAcknowledged !== true')
  const iAcctCall = accountCode.indexOf('createPersonalAreaBookingRequest(')
  chk('🔒 appointments: בדיקת הפרטיות מופיעה לפני הקריאה ל-createPersonalAreaBookingRequest',
    iAcctCheck !== -1 && iAcctCall !== -1 && iAcctCheck < iAcctCall)
}
chk('🔒 lib/db/appointments.ts ממפה PRIVACY_NOT_ACKNOWLEDGED ל-privacy_not_acknowledged בשני המסלולים',
  (dbLayerSrc.match(/PRIVACY_NOT_ACKNOWLEDGED/g) ?? []).length >= 2)

// ─── 5. הערות חופשיות אינן ב-שום הודעת WhatsApp; טלפון והערות אינם ביומן ─────
section('הערות חופשיות אינן נכנסות לשום הודעת WhatsApp, וטלפון+הערות אינם ביומן')

{
  // 🔒 שלב 8 — הצמצום חל על **כל** הודעת WhatsApp שהקוד בונה, כולל
  // buildBookingRequestMessage (customer→business) — אין יותר קטגוריה
  // "מחוץ להיקף" עבור הודעות שהלקוחה כותבת/שולחת בעצמה.
  const allMessageBuilders = [
    'buildBookingRequestMessage', 'buildLateChangeMessage',
    'buildApprovalMessage', 'buildRejectionMessage',
    'buildRescheduleApprovedMessage', 'buildRescheduleRejectedMessage',
    'buildReminderWhatsAppMessage',
  ]
  for (const fn of allMessageBuilders) {
    const start = whatsappTemplatesSrc.indexOf(`export function ${fn}(`)
    const body = start === -1 ? '' : whatsappTemplatesSrc.slice(start, whatsappTemplatesSrc.indexOf('\n}', start))
    chk(`🔒 ${fn} אינה מזכירה notes`, start !== -1 && !/\bnotes\b/i.test(body))
  }
  chk('🔒 BookingRequestMessageParams אינה מכריזה על שדה notes',
    !/interface BookingRequestMessageParams[\s\S]*?\bnotes\b[\s\S]*?\n\}/.test(whatsappTemplatesSrc))
}
{
  const start = googleCalendarSrc.indexOf('export async function createAppointmentEvent(')
  const body = googleCalendarSrc.slice(start, googleCalendarSrc.indexOf('\nexport ', start + 10))
  chk('🔒 createAppointmentEvent (מנגנון הסנכרון הפעיל) אינה מזכירה notes בכלל',
    start !== -1 && !/\bnotes\b/i.test(body))
  chk('🔒 createAppointmentEvent (מנגנון הסנכרון הפעיל) אינה מזכירה טלפון בכלל',
    start !== -1 && !/params\.phone|טלפון/i.test(body))
  chk('createAppointmentEvent ממשיכה לכלול שם הלקוחה ב-summary', /params\.customerName/.test(body))
  chk('createAppointmentEvent ממשיכה לכלול סוג הטיפול', /params\.treatment/.test(body))
  chk('🔒 CreateAppointmentEventParams אינה מכריזה על שדה phone',
    !/interface CreateAppointmentEventParams[\s\S]*?\bphone\b[\s\S]*?\n\}/.test(googleCalendarSrc))
}
{
  // קוד מת (createBookingEvent) — אינו מחווט, אבל תוקן גם הוא כניקוי בטיחות.
  const start = googleCalendarSrc.indexOf('export async function createBookingEvent(')
  const body = googleCalendarSrc.slice(start, googleCalendarSrc.indexOf('\n}', start))
  chk('🔒 createBookingEvent (קוד מת, לא מחווט) אינה מזרימה notes לתיאור',
    start !== -1 && !/params\.notes/.test(body))
  chk('🔒 createBookingEvent (קוד מת, לא מחווט) אינה מזרימה טלפון לתיאור',
    start !== -1 && !/params\.phone/.test(body))
  chk('🔒 createBookingEvent אינה מיובאת/נקראת משום מקום בקוד החי',
    !new RegExp(String.raw`(?<!export async function )createBookingEvent\(`).test(
      [publicRouteSrc, accountRouteSrc, dbLayerSrc].join('\n')))
}

// ─── 6. מדיניות הפרטיות ──────────────────────────────────────────────────────
section('מדיניות הפרטיות — קטגוריות מידע, ספקים, checkbox וגרסה')

chk('מזכירה Supabase', /Supabase/.test(privacyContentSrc))
chk('מזכירה Vercel', /Vercel/.test(privacyContentSrc))
chk('🔒 מזכירה Google Calendar עם שם+טיפול+מועד, בלי טלפון',
  /Google Calendar[\s\S]{0,200}שם הלקוחה[\s\S]{0,150}סוג הטיפול[\s\S]{0,150}מועד התור/.test(privacyContentSrc))
chk('🔒 מצהירה במפורש שהטלפון (ולא רק ההערות) אינו נכנס ליומן',
  /מספר הטלפון[\s\S]{0,80}(אינם מוכנסים|אינו מוכנס|אינם נכנסים)[\s\S]{0,20}ליומן|(אינם מוכנסים|אינם נכנסים)[\s\S]{0,80}מספר הטלפון/.test(privacyContentSrc))
chk('מזכירה את ספק ה-SMS (019)', /019/.test(privacyContentSrc))
chk('מזכירה WhatsApp', /WhatsApp/.test(privacyContentSrc))
chk('מזכירה GA4/Google Analytics ו-Meta Pixel רק לאחר הסכמה נפרדת',
  /Google Analytics[\s\S]{0,200}הסכמה נפרדת|הסכמה נפרדת[\s\S]{0,200}Meta Pixel|Meta Pixel[\s\S]{0,200}הסכמה/.test(privacyContentSrc))
chk('כוללת זכות עיון', /לעיין במידע/.test(privacyContentSrc))
chk('כוללת זכות תיקון', /לתקן מידע/.test(privacyContentSrc))
chk('כוללת אפשרות לבקש מחיקה, בכפוף לדין/לצורך העסקי', /למחוק מידע[\s\S]{0,120}(דין|צורך העסקי)/.test(privacyContentSrc))
chk('מסבירה תוצאה של אי-מסירת שם/טלפון', /לא ניתן לזהות|לא ניתן להשלים הזמנת תור/.test(privacyContentSrc))
/*
 * ⚠️ ארבע הבדיקות שהיו כאן קודם נעלו את המצב שלפני 9B: "אין מחיקה
 * אוטומטית", "ייקבע בעתיד". מאז הופעל מנגנון ה-retention של 0032
 * בפרודקשן, ולכן הן הפכו לשקריות — והוחלפו בבדיקות שנועלות את המצב
 * החדש. הכיוון לא התהפך: המסמך עדיין אסור לו להבטיח יותר ממה שקורה.
 */
chk('🔒 מצהיר על מנגנון ניקוי מבוסס-זמן שפועל בפועל',
  /מנגנון ניקוי[\s\S]{0,20}מבוסס-זמן/.test(privacyContentSrc))
chk('🔒 מפרט את שלושת ה-cutoffs של המחיקה בפועל (7/30/90 ימים)',
  /7<\/strong> ימים|<strong>7 ימים<\/strong>/.test(privacyContentSrc)
  && /<strong>30 ימים<\/strong>/.test(privacyContentSrc)
  && /<strong>90 ימים<\/strong>/.test(privacyContentSrc))
chk('🔒 מבחין בין מזעור הערה לבין מחיקת התור (לא מבטיח מחיקת התור)',
  /רק תוכן ההערה מוסר/.test(privacyContentSrc))
chk('🔒 **אינו** מבטיח מחיקה אוטומטית של כרטיס הלקוחה/היסטוריית השירות',
  /אינם כפופים למחיקה אוטומטית/.test(privacyContentSrc))
chk('🔒 מצהיר במפורש שדוח 24 החודשים הוא report-only ואינו מוחק',
  /דוח בדיקה[\s\S]{0,40}בלבד[\s\S]{0,80}אינו מוחק דבר/.test(privacyContentSrc))
chk('🔒 מזכיר את אפשרות עצירת המזעור (retention hold)',
  /המזעור האוטומטי לא יחול עליו/.test(privacyContentSrc))
chk('🔒 אין יותר הצהרה מטעה שנתוני OTP/session "נשמרים לפרק זמן קצר"',
  !/נשמרים לפרק זמן קצר/.test(privacyContentSrc))
chk('🔒 אין הצהרה ש"המידע נשמר לנצח"', !/נשמר לנצח|לצמיתות ללא הגבלה/.test(privacyContentSrc))
chk('🔒 אין תקופת שמירה מדויקת של 7 שנים', !/7 שנים|שבע שנים/.test(privacyContentSrc))
chk('🔒 אין הצהרה ש-QStash פעיל', !/QStash/.test(privacyContentSrc))
chk('🔒 אין אזכור Twilio (הספק הפעיל הוא 019, לא Twilio)', !/Twilio/.test(privacyContentSrc))
chk('🔒 אין מסקנה משפטית של ציות מלא או חסינות מתביעה',
  !/ציות מלא|חסינות מתביעה|עומד בדרישות הדין באופן מלא/.test(privacyContentSrc))
chk('🔒 ה-checkbox מתואר כ-acknowledgement של קריאה, לא כהסכמה לעיבוד',
  /מתעד שהלקוחה קראה[\s\S]{0,120}אינו מוצג כהסכמה גורפת/.test(privacyContentSrc))
chk('🔒 אין ניסוח "מסכימות לשמירה ולעיבוד" (הסכמת עיבוד) בתיאור ה-checkbox',
  !/מסכימות לשמירה ולעיבוד/.test(privacyContentSrc))
chk('🔒 אין הצגת "הכרחיות למתן השירות" כבסיס משפטי לעיבוד',
  !/הכרחיות למתן השירות|הכרחיות לביצוע השירות/.test(privacyContentSrc))
chk('🔒 אין מונח GDPR "אינטרס לגיטימי" (legitimate interest)',
  !/אינטרס לגיטימי/.test(privacyContentSrc))
chk('🔒 אין כותרת/פריימינג של "בסיס משפטי" (legal basis)',
  !/הבסיס המשפטי/.test(privacyContentSrc))
chk('🔒 סעיף 6 מנוסח עובדתית: פרטי חובה לטיפול/ניהול/יצירת קשר, וללא מסירתם לא ניתן להגיש/לטפל',
  /פרטי החובה[\s\S]{0,80}נדרשים לטיפול בבקשת התור[\s\S]{0,40}לניהול התור[\s\S]{0,40}וליצירת קשר/.test(privacyContentSrc) &&
  /ללא מסירת פרטי החובה לא ניתן להגיש את הבקשה או לטפל בה/.test(privacyContentSrc))
chk('🔒 אישור מדיניות הפרטיות מוצהר כנפרד מהסכמת אנליטיקס/שיווק',
  /נפרד[\s\S]{0,60}(אנליטיקס|שיווק)|(אנליטיקס|שיווק)[\s\S]{0,60}נפרד/.test(privacyContentSrc))
chk('גרסת המדיניות המוצגת נקראת מהקבוע המשותף (PRIVACY_NOTICE_VERSION), לא ערך קשיח',
  /\{PRIVACY_NOTICE_VERSION\}/.test(privacyContentSrc))
chk('תאריך העדכון נקרא מהקבוע המשותף (PRIVACY_NOTICE_UPDATED)',
  /\{PRIVACY_NOTICE_UPDATED\}/.test(privacyContentSrc))

// ─── 7. שדה policy_version הישן לא נדרס ──────────────────────────────────────
section('policy_version (מדיניות הזמנה/ביטולים) לא נדרס')

chk('🔒 המיגרציה 0031 אינה נוגעת בעמודת policy_version הקיימת (אין alter/drop עליה)',
  !/alter\s+.*\bpolicy_version\b|drop\s+column\s+policy_version/i.test(migrationSrc))
chk('🔒 lib/bookingPolicy.ts (POLICY_VERSION) ו-lib/privacyNotice.ts (PRIVACY_NOTICE_VERSION) הם שני קבצים נפרדים',
  src('lib/bookingPolicy.ts').includes('POLICY_VERSION') && privacyNoticeSrc.includes('PRIVACY_NOTICE_VERSION'))
chk('🔒 המיגרציה משתמשת בעמודה privacy_notice_acknowledged_at (לא privacy_acknowledged_at)',
  /privacy_notice_acknowledged_at/.test(migrationSrc) && !/(?<!notice_)privacy_acknowledged_at/.test(migrationSrc))
chk('🔒 פרמטר ה-RPC נקרא p_privacy_notice_acknowledged (לא p_privacy_acknowledged) בשתי הפונקציות',
  (migrationSrc.match(/p_privacy_notice_acknowledged\b/g) ?? []).length >= 4 &&
  !/p_privacy_acknowledged\b/.test(migrationSrc))
chk('🔒 lib/db/appointments.ts שולח p_privacy_notice_acknowledged ל-RPC (לא p_privacy_acknowledged)',
  (dbLayerSrc.match(/p_privacy_notice_acknowledged:/g) ?? []).length === 2 &&
  !/p_privacy_acknowledged:/.test(dbLayerSrc))

// ─── 8. consent של שלב 6 עדיין מחובר ──────────────────────────────────────────
section('consent של שלב 6 (GA/Meta) לא נפגע, וטסט הפרטיות מחובר')

{
  const pkg = JSON.parse(src('package.json'))
  chk('npm run test עדיין מריץ test:consent', pkg.scripts.test.includes('test:consent'))
  chk('npm run test מריץ גם את בדיקת שלב 8 (privacy-notice)', pkg.scripts.test.includes('test:privacy-notice'))
  chk('test:privacy-notice מוגדר כסקריפט משל עצמו', typeof pkg.scripts['test:privacy-notice'] === 'string')
}

// ─── 9. Twilio — אין data.message גולמי בלוג ─────────────────────────────────
section('lib/sms/twilioProvider.ts — אין data.message גולמי בלוג')

chk('🔒 אין עוד data?.message או data.message בקריאת console.error',
  !/console\.error\([^)]*data\??\.message/.test(twilioSrc))
chk('🔒 לוג הכישלון כולל provider=twilio קבוע', /'\[sms:twilio\] send failed', 'provider=twilio'/.test(twilioSrc))

// ─── 10. אין טענה שה-RPC מגן מפני service_role שדלף/נוצל לרעה ───────────────
section('אין הצהרה שה-RPC מגן מפני service_role שדלף/נוצל לרעה')

chk('🔒 המיגרציה אינה טוענת הגנה במקרה של service_role שדלף',
  !/דרך service_role שהודלף|מגן.{0,20}service_role|service_role.{0,20}מגן/.test(migrationSrc))
chk('🔒 lib/db/appointments.ts אינו טוען הגנה מפני service_role שדלף/נוצל לרעה',
  !/service_role שהודלף|service_role.{0,20}נוצל לרעה/.test(dbLayerSrc))

// ─── 11. אזהרת מידע רפואי/רגיש ליד הערות ה-CRM הפנימיות ─────────────────────
section('CustomerNotes.tsx (CRM) — אזהרה מפורשת נגד מידע רפואי/רגיש')

chk('🔒 מוזהר במפורש שלא לתעד מידע רפואי', /מידע רפואי/.test(customerNotesSrc))
chk('🔒 מוזהר במפורש שלא לתעד מידע רגיש', /רגיש/.test(customerNotesSrc))
chk('🔒 האזהרה מוצגת ליד/מעל אזור הכתיבה (לפני הכפתור "הוספת הערה")',
  (() => {
    const iWarn = customerNotesSrc.indexOf('מידע רפואי')
    const iBtn = customerNotesSrc.indexOf('הוספת הערה')
    return iWarn !== -1 && iBtn !== -1 && iWarn < iBtn
  })())

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter((r) => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
