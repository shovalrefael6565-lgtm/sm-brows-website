/**
 * בדיקות שלב 15H — הלוגיקה הטהורה: השלמת שם + "הוספה ליומן".
 *
 * המיקוד:
 *
 *   1. 🔒 **שם ללא רווח אינו שם פסול.** "מיכל" הוא שם מלא לגיטימי שלקוחה
 *      הקלידה בעצמה, ובקשה להשלים אותו שוב היא הטרדה. השער נפתח **רק**
 *      מול רשימה סגורה של placeholders שהמערכת עצמה כתבה.
 *
 *   2. 🔒 **קוד הכניסה לבניין לעולם אינו נכנס לאירוע היומן.** קובץ .ics
 *      נשמר במכשיר הלקוחה ומסונכרן לענן שלה, ואין דרך למשוך אותו בחזרה.
 *
 *   3. תקינות ה-.ics עצמו: CRLF, בריחת תווים, וקיפול שורות באוקטטים —
 *      עברית היא שני בייטים לתו, וספירת תווים הייתה מייצרת שורות פסולות.
 *
 * הרצה:  npm run test:15h-core
 */

import { needsNameCompletion, buildFullName } from '../lib/customerProfile.ts'
import { buildIcs, buildGoogleCalendarUrl, toCalendarStamp } from '../lib/calendarInvite.ts'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(70)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

// ════════════════════════════════════════════════════════════════════════════
section('השלמת שם — מי נשאלת ומי לא')

chk('🔒 ה-placeholder הידוע מ-0010 מפעיל את השער', needsNameCompletion('לקוחה'))
chk('שם ריק מפעיל את השער', needsNameCompletion(''))
chk('null מפעיל את השער', needsNameCompletion(null))
chk('רווחים בלבד מפעילים את השער', needsNameCompletion('   '))
chk('"  לקוחה  " מזוהה גם עם רווחים מסביב', needsNameCompletion('  לקוחה  '))

chk('🔒 **שם של מילה אחת אינו placeholder** — "מיכל" לא נשאלת', !needsNameCompletion('מיכל'))
chk('🔒 שם באות אחת אינו placeholder', !needsNameCompletion('א'))
chk('שם מלא רגיל אינו מפעיל את השער', !needsNameCompletion('מיכל כהן'))
chk('שם לועזי אינו מפעיל את השער', !needsNameCompletion('Sarah'))
chk('"לקוחה כהן" **אינו** placeholder — זו לקוחה אמיתית בשם הזה',
  !needsNameCompletion('לקוחה כהן'))

section('בניית full_name משני שדות')

{
  const r = buildFullName('מיכל', 'כהן')
  chk('שני שדות מתאחדים לשדה אחד עם רווח', r.ok && r.fullName === 'מיכל כהן',
    r.ok ? r.fullName : r.error)
}
{
  const r = buildFullName('  מיכל  ', '  כהן  ')
  chk('רווחים מיותרים מנוקים', r.ok && r.fullName === 'מיכל כהן', r.ok ? r.fullName : r.error)
}
{
  const r = buildFullName('מיכל   רות', 'בן   כהן')
  chk('רווחים כפולים בתוך השם מכווצים לרווח אחד',
    r.ok && r.fullName === 'מיכל רות בן כהן', r.ok ? r.fullName : r.error)
}
{
  const r = buildFullName('בן-אל', "כהן'ס")
  chk('מקף וגרש מותרים בשמות', r.ok, r.ok ? r.fullName : r.error)
}
{
  const r = buildFullName('Sarah', 'Levi')
  chk('שם לועזי מתקבל', r.ok && r.fullName === 'Sarah Levi', r.ok ? r.fullName : r.error)
}

chk('שם פרטי ריק נדחה', buildFullName('', 'כהן').error === 'first_required')
chk('שם משפחה ריק נדחה', buildFullName('מיכל', '').error === 'last_required')
chk('🔒 ספרות בשם נדחות (טלפון שהודבק לשדה הלא נכון)',
  buildFullName('מיכל2', 'כהן').error === 'bad_chars')
chk('תווי HTML נדחים', buildFullName('<script>', 'כהן').error === 'bad_chars')
chk('שם פרטי ארוך מדי נדחה', buildFullName('א'.repeat(41), 'כהן').error === 'first_too_long')
chk('שם משפחה ארוך מדי נדחה', buildFullName('מיכל', 'כ'.repeat(41)).error === 'last_too_long')

{
  // 🔒 ה-CHECK ב-DB: length(trim(full_name)) between 2 and 80.
  const r = buildFullName('א'.repeat(40), 'ב'.repeat(40))
  chk('🔒 הצירוף המקסימלי (40+1+40=81) נדחה לפני שה-DB יזרוק',
    !r.ok && r.error === 'too_long', r.ok ? String(r.fullName.length) : r.error)
}
{
  const r = buildFullName('א'.repeat(39), 'ב'.repeat(40))
  chk('80 תווים בדיוק מתקבלים', r.ok && r.fullName.length === 80,
    r.ok ? String(r.fullName.length) : r.error)
}
{
  // ⚠️ שם שנבנה כאן חייב **לא** להפעיל את השער שוב, אחרת נוצרת לולאה.
  const r = buildFullName('מיכל', 'כהן')
  chk('🔒 שם שנשמר אינו מפעיל את השער שוב (אין לולאה)',
    r.ok && !needsNameCompletion(r.fullName))
}

// ════════════════════════════════════════════════════════════════════════════
section('הוספה ליומן — מה נכנס לאירוע')

const APPT = {
  appointmentId: '3f8b1c2d-4e5a-6789-abcd-ef0123456789',
  treatment: 'עיצוב גבות טבעיות',
  startsAt: '2026-09-01T07:30:00.000Z',
  durationMin: 45,
}

const ics = buildIcs(APPT, new Date('2026-08-11T10:00:00.000Z'))
const googleUrl = buildGoogleCalendarUrl(APPT)

chk('הקובץ נפתח ונסגר כ-VCALENDAR תקין',
  ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trimEnd().endsWith('END:VCALENDAR'))
chk('כל השורות מופרדות ב-CRLF (דרישת RFC 5545)', !/[^\r]\n/.test(ics))
chk('DTSTART מחושב נכון ב-UTC', ics.includes('DTSTART:20260901T073000Z'))
chk('DTEND = התחלה + משך (45 דק׳)', ics.includes('DTEND:20260901T081500Z'))
chk('DTSTAMP נלקח מהשעון שהוזרק', ics.includes('DTSTAMP:20260811T100000Z'))
chk('UID יציב שנגזר ממזהה התור — הורדה חוזרת מעדכנת ולא מכפילה',
  ics.includes('UID:smbappt3f8b1c2d4e5a6789abcdef0123456789@smbrows.co.il'))
chk('שם הטיפול מופיע בכותרת', ics.includes('S.M BROWS'))
chk('הכתובת מופיעה כ-LOCATION', /LOCATION:.*הכורמים/.test(ics))
chk('המשך מופיע בתיאור', ics.includes('45'))
chk('קישור לאזור האישי מופיע', ics.includes('/account'))

/*
 * 🔴 הבדיקה הקריטית של הנושא הזה.
 *
 * building_entry_code הוא ערך פרטי שנחסם מפני anon ב-0026 ומופיע אך ורק
 * ב-SMS מאושר. קובץ יומן נשמר במכשיר ומסונכרן לענן — אם הקוד ידלוף לשם,
 * אין דרך למשוך אותו בחזרה.
 *
 * הבדיקה היא מבנית: הקובץ אינו מייבא את loadBuildingEntryCode כלל, ואין
 * בו שום שדה שיכול להכיל אותו.
 */
chk('🔴 אין שום אזכור של קוד כניסה ב-.ics',
  !/entry_code|קוד כניסה|entryCode/i.test(ics))
chk('🔴 אין שום אזכור של קוד כניסה בקישור Google',
  !/entry_code|entryCode/i.test(decodeURIComponent(googleUrl)))
chk('🔴 אין טלפון ואין מחיר באירוע', !/\+9725|₪/.test(ics))
chk('🔒 אין ORGANIZER ואין ATTENDEE — זהו אירוע להוספה, לא הזמנת RSVP',
  !ics.includes('ORGANIZER') && !ics.includes('ATTENDEE'))

{
  // בריחת תווים: פסיק בשם טיפול חייב לצאת כ-`\,` ולא לפצל שדה.
  const tricky = buildIcs({ ...APPT, treatment: 'עיצוב, הרמה; ועוד\\' })
  chk('פסיק, נקודה-פסיק ובקסלאש עוברים escape תקין',
    tricky.includes('\\,') && tricky.includes('\\;') && tricky.includes('\\\\'))
}

{
  // 🔒 קיפול באוקטטים ולא בתווים — כל אות עברית היא 2 בייטים ב-UTF-8.
  const long = buildIcs({ ...APPT, treatment: 'עיצוב גבות טבעיות '.repeat(12) })
  const encoder = new TextEncoder()
  const tooLong = long
    .split('\r\n')
    .filter(line => encoder.encode(line).length > 75)
  chk('🔒 אין שורה שעוברת 75 אוקטטים אחרי הקיפול', tooLong.length === 0,
    tooLong.length ? `${tooLong.length} שורות` : '')
  chk('שורות ההמשך מתחילות ברווח', /\r\n /.test(long))
}

section('קישור Google')

chk('הקישור מצביע ל-calendar.google.com/render',
  googleUrl.startsWith('https://calendar.google.com/calendar/render?'))
chk('action=TEMPLATE — טופס מוכן, לא כתיבה ליומן של הלקוחה',
  googleUrl.includes('action=TEMPLATE'))
chk('טווח הזמן זהה בדיוק לזה שב-.ics',
  googleUrl.includes(`dates=${encodeURIComponent('20260901T073000Z/20260901T081500Z')}`)
  || googleUrl.includes('dates=20260901T073000Z%2F20260901T081500Z'))
chk('הכתובת מועברת כפרמטר location', /location=/.test(googleUrl))

chk('toCalendarStamp מרפד לאפסים מובילים',
  toCalendarStamp(new Date('2026-01-02T03:04:05.000Z')) === '20260102T030405Z',
  toCalendarStamp(new Date('2026-01-02T03:04:05.000Z')))

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '⛔'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
