/**
 * בדיקות lib/otpFormGuards.ts — השערים שמפעילים אימות OTP אוטומטי בטופס
 * ההתחברות (components/account/LoginForm.tsx) ומונעים בקשות כפולות.
 *
 * המיקוד:
 *
 *   1. אימות אוטומטי מופעל בדיוק פעם אחת לכל קוד בן 6 ספרות מובחן — בלי
 *      תלות באיך הקוד הגיע (הקלדה ספרה-ספרה, הדבקה של המחרוזת השלמה
 *      בבת אחת, או AutoFill של iOS): כל אלה, מבחינת השער, הם רק ערך
 *      state חדש, ולכן נבדקים כאן ישירות בלי לדמות אירועי DOM.
 *   2. אימות שנכשל אינו "תוקע" את הקוד — עריכה (ולו ספרה אחת) מאפסת
 *      את הזיכרון, וקוד מתוקן יכול להפעיל אימות אוטומטי מחדש.
 *   3. שער ה"בקשה אחת בכל רגע" חוסם קריאה שנייה בזמן שראשונה פעילה —
 *      זה מה שמונע גם אימות כפול (אוטומטי + ידני בו-זמנית) וגם מרוץ
 *      Enter/לחיצה כפולה.
 *
 * הרצה:  npm run test:otp-form-guards
 */

import { createInFlightGuard, createOtpAutoSubmitGate } from '../lib/otpFormGuards.ts'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(70)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)

// ════════════════════════════════════════════════════════════════════════════
section('אימות אוטומטי — הקלדה ספרה-ספרה')

{
  const gate = createOtpAutoSubmitGate()
  const fired = []
  for (const partial of ['1', '12', '123', '1234', '12345', '123456']) {
    if (gate.shouldFire(partial)) fired.push(partial)
  }
  chk('לא נורה כלום לפני 6 ספרות', fired.length === 1, `fired=${JSON.stringify(fired)}`)
  chk('נורה בדיוק פעם אחת, בקוד המלא', fired[0] === '123456')
}

section('אימות אוטומטי — הדבקה / AutoFill (קפיצה ישירה ל-6 ספרות)')

{
  // 🔒 בדיוק כמו הדבקה או AutoFill: אין ערכים חלקיים בדרך, רק קפיצה ישירה
  // מ-'' ל-6 ספרות. השער אדיש למקור הערך — מתעניין רק בתוצאה.
  const gate = createOtpAutoSubmitGate()
  chk('לא נורה על מחרוזת ריקה', !gate.shouldFire(''))
  chk('נורה מיד על קפיצה ישירה ל-6 ספרות (הדבקה/AutoFill)', gate.shouldFire('654321'))
}

section('אימות אוטומטי — לא נורה פעמיים לאותו קוד')

{
  const gate = createOtpAutoSubmitGate()
  chk('הפעלה ראשונה מצליחה', gate.shouldFire('111111'))
  chk('🔒 קריאה חוזרת לאותו קוד בדיוק לא נורה שוב (מגן על React StrictMode)',
    !gate.shouldFire('111111'))
  chk('🔒 קריאה שלישית לאותו קוד עדיין לא נורה', !gate.shouldFire('111111'))
}

section('אימות אוטומטי — עריכה אחרי כישלון מאפשרת ניסיון חוזר')

{
  const gate = createOtpAutoSubmitGate()
  chk('קוד ראשון נורה', gate.shouldFire('111111'))
  // הלקוחה מוחקת ספרה כדי לתקן (האימות נכשל)
  chk('ירידה מ-6 ספרות מאפסת את הזיכרון, ואינה נורה בעצמה', !gate.shouldFire('11111'))
  chk('🔒 חזרה לאותו קוד המדויק אחרי עריכה נורה שוב — לא "תקוע" לצמיתות',
    gate.shouldFire('111111'))
}

{
  const gate = createOtpAutoSubmitGate()
  gate.shouldFire('111111')
  chk('אחרי כישלון, עריכה לקוד **שונה** נורה כרגיל',
    !gate.shouldFire('11111') && gate.shouldFire('222222'))
}

section('אימות אוטומטי — reset() מפורש (שליחה חוזרת / חזרה לשלב הטלפון)')

{
  const gate = createOtpAutoSubmitGate()
  gate.shouldFire('111111')
  gate.reset()
  chk('🔒 אחרי reset, אותו קוד בדיוק נורה שוב (קוד חדש נשלח, לא קשור לקודם)',
    gate.shouldFire('111111'))
}

// ════════════════════════════════════════════════════════════════════════════
section('שער "בקשה אחת בכל רגע" — tryStart / finish')

{
  const guard = createInFlightGuard()
  chk('הקריאה הראשונה מותרת', guard.tryStart())
  chk('🔒 קריאה שנייה בזמן שהראשונה פעילה נחסמת (מרוץ Enter/לחיצה כפולה)',
    !guard.tryStart())
  chk('🔒 קריאה שלישית עדיין נחסמת', !guard.tryStart())
  guard.finish()
  chk('אחרי finish(), קריאה חדשה מותרת שוב', guard.tryStart())
}

{
  const guard = createInFlightGuard()
  guard.tryStart()
  guard.finish()
  guard.finish() // finish כפול לא אמור לזרוק ולא אמור "לשחרר יותר מדי"
  chk('finish() כפול הוא no-op בטוח', guard.tryStart())
}

// ════════════════════════════════════════════════════════════════════════════
section('שילוב — אימות אוטומטי מול אימות ידני בו-זמנית')

{
  // מדמה בדיוק את המצב בטופס: ה-effect מפעיל אימות אוטומטי ברגע ש-6
  // הספרות מגיעות, ובו-בזמן (אותו tick) הלקוחה לוחצת Enter על "כניסה".
  // shouldFire דואג שה-effect עצמו לא יפעיל את verifyCode פעמיים; tryStart
  // דואג שגם אם שתי קריאות ל-verifyCode כן יצאו, רק אחת בפועל שולחת בקשה.
  const gate = createOtpAutoSubmitGate()
  const guard = createInFlightGuard()

  function attemptVerify(code) {
    // verifyCode() האמיתי בודק tryStart ראשון-ראשון, בלי קשר למי הפעיל אותו
    return guard.tryStart()
  }

  const autoShouldFire = gate.shouldFire('987654')
  chk('ה-effect מחליט להפעיל אימות אוטומטי', autoShouldFire)
  const autoStarted = autoShouldFire && attemptVerify('987654')
  chk('הבקשה האוטומטית מקבלת את השער ומתחילה', autoStarted)

  // Enter ידני על אותו קוד, לפני שהבקשה הראשונה הסתיימה (finish() עדיין לא נקרא)
  const manualStarted = attemptVerify('987654')
  chk('🔒 ניסיון ידני בו-זמנית נחסם ע"י tryStart — אין שתי בקשות אימות',
    !manualStarted)

  guard.finish()
  chk('🔒 אחרי שהבקשה האוטומטית הסתיימה, ניסיון חדש (למשל שליחה חוזרת) מותר',
    guard.tryStart())
}

// ════════════════════════════════════════════════════════════════════════════
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✅' : '⛔'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
