/**
 * שלב 13 — בדיקות ל-`lib/bookingAvailability.ts`.
 *
 * ⚠️ הבדיקה המרכזית כאן היא **שלילית**: שרשימת "תפוס" ריקה לעולם אינה
 * מוחזרת כתשובה תקפה כשמקור אמת נדרש נפל. באג כזה אינו מתגלה בהרצה ידנית —
 * הלוח נראה תקין לחלוטין, פשוט עם יותר שעות פנויות ממה שיש באמת.
 *
 * הרצה:  npm run test:booking-availability
 *
 * ⚠️ חייב לרוץ תחת tsx עם --conditions=react-server (מקובע ב-package.json),
 * כדי ש-'server-only' ייפתר מחוץ ל-Next.js.
 */

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 54 - title.length))}`)
}

const { resolveAvailability } = await import('../lib/bookingAvailability.ts')

const DATE = '2026-08-24'
const CAL = [{ start: '10:00', end: '10:20' }]
const DB = [{ start: '14:00', end: '14:20' }]

/** בונה מקורות עם מונה קריאות לכל צד, כדי שאפשר יהיה להוכיח *אי*-קריאה. */
function sources({ calendar, db, enabled }) {
  const calls = { calendar: 0, db: 0, logs: 0 }
  return {
    calls,
    src: {
      newBookingSystemEnabled: () => enabled,
      calendarBusy: async () => {
        calls.calendar++
        if (calendar instanceof Error) throw calendar
        return calendar
      },
      dbBusy: async () => {
        calls.db++
        if (db instanceof Error) throw db
        return db
      },
      log: () => { calls.logs++ },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
section('דגל כבוי — Google בלבד, אפס נגיעה ב-Supabase')

{
  const { calls, src } = sources({ calendar: CAL, db: DB, enabled: false })
  const r = await resolveAvailability(DATE, src)
  chk('מחזיר ok עם התפוסה מהיומן', r.ok && JSON.stringify(r.busy) === JSON.stringify(CAL))
  chk('🔒 dbBusy לא נקרא אף פעם', calls.db === 0, `db=${calls.db}`)
  chk('calendarBusy נקרא פעם אחת', calls.calendar === 1)
  chk('🔒 תפוסת ה-DB אינה מופיעה בתוצאה',
    r.ok && !JSON.stringify(r.busy).includes('14:00'))
}

{
  // Supabase שבור לגמרי — בדיוק המצב של משתנה סביבה חסר בפרודקשן
  const boom = new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const { calls, src } = sources({ calendar: CAL, db: boom, enabled: false })
  const r = await resolveAvailability(DATE, src)
  chk('🔒 Supabase חסר/שבור — הזמינות מהיומן ממשיכה לעבוד',
    r.ok && JSON.stringify(r.busy) === JSON.stringify(CAL))
  chk('🔒 dbBusy לא נקרא, ולכן הזריקה שלו לא רלוונטית', calls.db === 0)
}

{
  const { src } = sources({ calendar: new Error('google down'), db: DB, enabled: false })
  const r = await resolveAvailability(DATE, src)
  chk('כשל יומן במסלול הישן → legacy_calendar_unavailable',
    !r.ok && r.reason === 'legacy_calendar_unavailable')
  chk('⚠️ אינו מחזיר busy כלל (ה-route מחליט על מטמון/ריק)',
    !r.ok && !('busy' in r))
}

// ─────────────────────────────────────────────────────────────────────────────
section('דגל דלוק — שני המקורות נדרשים')

{
  const { calls, src } = sources({ calendar: CAL, db: DB, enabled: true })
  const r = await resolveAvailability(DATE, src)
  chk('שני המקורות מתאחדים', r.ok && r.busy.length === 2)
  chk('התפוסה מהיומן נכללת', r.ok && r.busy.some(b => b.start === '10:00'))
  chk('התפוסה מה-DB נכללת', r.ok && r.busy.some(b => b.start === '14:00'))
  chk('כל מקור נקרא פעם אחת', calls.calendar === 1 && calls.db === 1)
}

{
  const boom = new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const { src } = sources({ calendar: CAL, db: boom, enabled: true })
  const r = await resolveAvailability(DATE, src)
  chk('🔒 כשל Supabase → source_unavailable', !r.ok && r.reason === 'source_unavailable')
  chk('🔒 ⚠️ אינו מחזיר busy ריק — זו הרגרסיה שהקובץ נכתב כדי לסגור',
    !r.ok && !('busy' in r))
}

{
  const { src } = sources({ calendar: new Error('google down'), db: DB, enabled: true })
  const r = await resolveAvailability(DATE, src)
  chk('🔒 כשל יומן כשהדגל דלוק → source_unavailable (גם היומן fail-closed)',
    !r.ok && r.reason === 'source_unavailable')
  chk('🔒 תפוסת ה-DB לבדה אינה מוחזרת כתשובה חלקית', !r.ok && !('busy' in r))
}

{
  const { src } = sources({
    calendar: new Error('google down'),
    db: new Error('db down'),
    enabled: true,
  })
  const r = await resolveAvailability(DATE, src)
  chk('שני המקורות נפלו → source_unavailable', !r.ok && r.reason === 'source_unavailable')
}

// ─────────────────────────────────────────────────────────────────────────────
section('רשימות ריקות — "אין תפוסה" מול "אין תשובה"')

{
  const { src } = sources({ calendar: [], db: [], enabled: true })
  const r = await resolveAvailability(DATE, src)
  chk('⚠️ יום פנוי באמת הוא ok עם רשימה ריקה — ולא כישלון',
    r.ok && r.busy.length === 0)
}

{
  const { src } = sources({ calendar: [], db: [], enabled: false })
  const r = await resolveAvailability(DATE, src)
  chk('אותו דבר במסלול הישן', r.ok && r.busy.length === 0)
}

// ─────────────────────────────────────────────────────────────────────────────
section('לוגים — שגיאה בלבד, בלי פרטי לקוחה')

{
  const { calls, src } = sources({ calendar: CAL, db: new Error('x'), enabled: true })
  await resolveAvailability(DATE, src)
  chk('כישלון נרשם ללוג פעם אחת', calls.logs === 1)
}

{
  const { calls, src } = sources({ calendar: CAL, db: DB, enabled: true })
  await resolveAvailability(DATE, src)
  chk('הצלחה אינה נרשמת ללוג', calls.logs === 0)
}

// ─────────────────────────────────────────────────────────────────────────────
section('הדגל נקרא בכל קריאה, ולא נשמר במטמון')

{
  let enabled = false
  const calls = { db: 0 }
  const src = {
    newBookingSystemEnabled: () => enabled,
    calendarBusy: async () => CAL,
    dbBusy: async () => { calls.db++; return DB },
  }
  await resolveAvailability(DATE, src)
  chk('קריאה ראשונה (כבוי) — אפס קריאות DB', calls.db === 0)
  enabled = true
  await resolveAvailability(DATE, src)
  chk('קריאה שנייה (דלוק) — DB נקרא', calls.db === 1)
}

// ─────────────────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} נכשלו`)
process.exit(failed === 0 ? 0 : 1)
