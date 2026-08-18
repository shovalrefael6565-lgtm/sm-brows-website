/**
 * בדיקות פעולות התור באזור האישי — "ביטול תור" ו"בקשת שינוי מועד".
 *
 * ═══ 🔴 התקלה שהבדיקות האלה נולדו ממנה ═══
 *
 * הודעת העוגיות (components/ui/CookieNotice.tsx) היא `fixed bottom-0
 * inset-x-0 z-50`, ומרונדרת ב-DeferredWidgets **אחרי** {children}
 * ב-app/layout.tsx. שני הדיאלוגים של האזור האישי היו גם הם z-50 — ובאותו
 * z-index מנצח מי שמאוחר יותר ב-DOM. במובייל שני הדיאלוגים הם גיליון
 * תחתון (items-end), כלומר בדיוק היכן שהבאנר יושב:
 *
 *   • "ביטול תור" — הדיאלוג נפתח, אך היה מכוסה במלואו. ללקוחה זה נראה
 *     כאילו הכפתור "לא עובד".
 *   • "בקשת שינוי מועד" — רק שורת הכותרת הציצה מעל הבאנר; בחירת התאריך
 *     והשעה הייתה מוסתרת. ללקוחה זה נראה כאילו הכפתור "לא מופיע".
 *
 * אותה תקלה בדיוק כבר טופלה במגירת הניווט (Navbar, z-[60]) — הדיאלוגים
 * של האזור האישי לא עודכנו יחד איתה. סעיף 6 כאן הוא שער הרגרסיה.
 *
 * ⚠️ **מה מוכח כאן ומה לא.** אין בפרויקט harness לרינדור React/DOM
 * (ראה ההערה המקבילה ב-test-whatsapp-templates.mjs). לכן:
 *   • תנאי ההצגה נבדקים על הפונקציות הטהורות (capabilitiesFor,
 *     canCancel, canRequestReschedule) — בדיקה התנהגותית אמיתית.
 *   • החיווט של ה-JSX (מי פותח dialog, מי שולח POST, מה קורה בהצלחה
 *     ובכישלון) נבדק על **קוד המקור**. זה מוכיח שהחיווט קיים ונכון, לא
 *     שהדפדפן ביצע אותו.
 *
 * ⚠️ אין כאן שום fetch יוצא ושום DB — רק ייבוא פונקציות טהורות וקריאת
 * קבצים מהריפו.
 *
 * הרצה:  npm run test:account-actions
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(72)}${extra}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const HERE = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(HERE, '..', p), 'utf8')
const stripComments = code => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const { capabilitiesFor } = await import('../lib/appointmentSelfService.ts')
const { DEFAULT_POLICY } = await import('../lib/appointmentPolicy.ts')

const ACCOUNT_PAGE   = 'app/account/page.tsx'
const ACTIONS        = 'components/account/AppointmentActions.tsx'
const CANCEL_DIALOG  = 'components/account/CancelConfirmedDialog.tsx'
const RESCHED_DIALOG = 'components/account/RescheduleDialog.tsx'
const PENDING_BTN    = 'components/account/CancelPendingButton.tsx'
const COOKIE_NOTICE  = 'components/ui/CookieNotice.tsx'
const CANCEL_ROUTE   = 'app/api/appointments/[id]/cancel/route.ts'

const NOW = new Date('2026-08-18T09:00:00.000Z')
const hoursFromNow = h => new Date(NOW.getTime() + h * 3_600_000).toISOString()
const policy = { ...DEFAULT_POLICY }   // 6 / 6 / 2

const appt = (over = {}) => ({
  status: 'confirmed',
  starts_at: hoursFromNow(48),
  reschedule_count: 0,
  ...over,
})

/**
 * מה שהעמוד באמת עושה (app/account/page.tsx): כפתורי הניהול העצמי מוצגים
 * רק ל-confirmed עתידי כשהמדיניות נטענה. משוכפל כאן כפונקציה כדי שאפשר
 * יהיה לבדוק את המטריצה; סעיף 5 מוודא שהתנאי בעמוד עצמו לא זז.
 */
function visibleActions(row, { policyLoaded = true, openRequest = false } = {}) {
  const isFuture = new Date(row.starts_at).getTime() > NOW.getTime()
  const canSelfManage = row.status === 'confirmed' && isFuture && policyLoaded
  const caps = canSelfManage ? capabilitiesFor(row, policy, NOW, openRequest) : null
  return {
    cancelPending: row.status === 'pending',
    reschedule: caps ? { shown: true, enabled: caps.reschedule.allowed, message: caps.reschedule.message } : { shown: false },
    cancel: caps ? { shown: true, enabled: caps.cancel.allowed, message: caps.cancel.message } : { shown: false },
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('1. confirmed עתידי — שני הכפתורים מוצגים ופעילים')
{
  const v = visibleActions(appt())
  chk('כפתור ביטול תור מוצג ופעיל',      v.cancel.shown && v.cancel.enabled)
  chk('כפתור בקשת שינוי מועד מוצג ופעיל', v.reschedule.shown && v.reschedule.enabled)
  chk('אין כפתור "ביטול הבקשה" על תור מאושר', !v.cancelPending)
}

// ════════════════════════════════════════════════════════════════════════════
section('2. pending — ביטול בקשה בלבד, בלי שינוי מועד')
{
  const v = visibleActions(appt({ status: 'pending' }))
  chk('כפתור ביטול הבקשה מוצג', v.cancelPending)
  chk('🔒 אין כפתור שינוי מועד לבקשה שממתינה לאישור', !v.reschedule.shown)
  chk('🔒 אין כפתור ביטול-תור-מאושר לבקשה ממתינה', !v.cancel.shown)
  chk('גם ברמת המדיניות: בקשה אינה ניתנת להזזה',
    capabilitiesFor(appt({ status: 'pending' }), policy, NOW).reschedule.reason === 'not_active')
}

// ════════════════════════════════════════════════════════════════════════════
section('3. סטטוסים סופיים ותור שעבר — אין פעולות')
{
  for (const status of ['cancelled_by_customer', 'cancelled_by_business', 'rejected', 'completed', 'no_show', 'expired', 'rescheduled']) {
    const v = visibleActions(appt({ status }))
    chk(`${status} — אין אף כפתור פעולה`,
      !v.cancel.shown && !v.reschedule.shown && !v.cancelPending)
  }
  const past = visibleActions(appt({ starts_at: hoursFromNow(-1) }))
  chk('confirmed שמועדו עבר — אין אף כפתור', !past.cancel.shown && !past.reschedule.shown)
}

// ════════════════════════════════════════════════════════════════════════════
section('4. cutoff — 6 שעות, נבדק בדיוק סביב הגבול')
{
  chk('מדיניות ברירת המחדל: ביטול 6 ש׳', policy.cancelCutoffHours === 6)
  chk('מדיניות ברירת המחדל: שינוי מועד 6 ש׳', policy.rescheduleCutoffHours === 6)

  const at = h => capabilitiesFor(appt({ starts_at: hoursFromNow(h) }), policy, NOW)

  chk('6:00 שעות לפני — מותר (הגבול עצמו כלול)',
    at(6).cancel.allowed && at(6).reschedule.allowed)
  chk('6 שעות + דקה — מותר', at(6.02).cancel.allowed && at(6.02).reschedule.allowed)
  chk('5:59 שעות לפני — חסום too_late (שתי הפעולות)',
    at(5.98).cancel.reason === 'too_late' && at(5.98).reschedule.reason === 'too_late')
  chk('🔒 חסימה אינה שקטה — יש נוסח הסבר ללקוחה',
    /6 שעות/.test(at(5.98).cancel.message) && /6 שעות/.test(at(5.98).reschedule.message))
  chk('🔒 הכפתור עדיין **מוצג** כשהוא חסום (disabled + הסבר), לא נעלם',
    visibleActions(appt({ starts_at: hoursFromNow(5.98) })).cancel.shown === true)
  chk('0 שעות (מועד התור עצמו) — in_past', at(0).cancel.reason === 'in_past')

  // מדיניות שנטענה מה-DB עם ערך אחר — הגבול זז יחד איתה
  const p24 = { cancelCutoffHours: 24, rescheduleCutoffHours: 24, maxReschedules: 2 }
  chk('מדיניות 24 ש׳: 23:59 חסום, 24:00 מותר',
    capabilitiesFor(appt({ starts_at: hoursFromNow(23.98) }), p24, NOW).cancel.reason === 'too_late' &&
    capabilitiesFor(appt({ starts_at: hoursFromNow(24) }), p24, NOW).cancel.allowed)

  chk('מיצוי מכסת ההזזות חוסם שינוי מועד בלבד — הביטול נשאר פתוח',
    capabilitiesFor(appt({ reschedule_count: 2 }), policy, NOW).reschedule.reason === 'max_reschedules' &&
    capabilitiesFor(appt({ reschedule_count: 2 }), policy, NOW).cancel.allowed)

  chk('🔒 בקשת שינוי פתוחה חוסמת שינוי נוסף, ולא את הביטול',
    visibleActions(appt(), { openRequest: true }).reschedule.enabled === false &&
    visibleActions(appt(), { openRequest: true }).cancel.enabled === true)
}

// ════════════════════════════════════════════════════════════════════════════
section('5. תנאי ההצגה בעמוד עצמו לא זזו')
{
  const clean = stripComments(src(ACCOUNT_PAGE))
  chk('הכפתורים מותנים ב-confirmed + עתידי + מדיניות שנטענה',
    /canSelfManage\s*=\s*appt\.status === 'confirmed' && isFuture && policy !== null/.test(clean))
  chk('capabilitiesFor מקבל גם את דגל הבקשה הפתוחה',
    /capabilitiesFor\(appt, policy, new Date\(\), Boolean\(openRequest\)\)/.test(clean))
  chk('CancelPendingButton מוצג אך ורק ל-pending',
    /\{appt\.status === 'pending' && <CancelPendingButton/.test(clean))
  chk('AppointmentActions מוצג רק כשיש capabilities + policy',
    /\{capabilities && policy && \(/.test(clean))
}

// ════════════════════════════════════════════════════════════════════════════
section('6. 🔴 שכבות — הדיאלוגים חייבים להיות מעל הודעת העוגיות')
{
  const zOf = (file, needle) => {
    const line = src(file).split('\n').find(l => l.includes(needle))
    const m = line && line.match(/z-\[?(\d+)\]?/)
    return m ? Number(m[1]) : null
  }
  const cookieZ  = zOf(COOKIE_NOTICE, 'fixed bottom-0 inset-x-0')
  const cancelZ  = zOf(CANCEL_DIALOG, 'fixed inset-0 z-')
  const reschedZ = zOf(RESCHED_DIALOG, 'fixed inset-0 z-')

  chk('הודעת העוגיות היא z-50 (ההנחה שעליה נשענת הבדיקה)', cookieZ === 50, `cookie=${cookieZ}`)
  chk('🔒 דיאלוג הביטול מעל הודעת העוגיות', cancelZ > cookieZ, `cancel=${cancelZ}`)
  chk('🔒 דיאלוג שינוי המועד מעל הודעת העוגיות', reschedZ > cookieZ, `reschedule=${reschedZ}`)

  // ⚠️ גם מעל שכבת ההעדפות (z-[61]) ומגירת הניווט (z-[60]) — שתיהן
  // מרונדרות אחרי {children} או ב-header, ובשוויון z-index היו מנצחות.
  chk('🔒 דיאלוג הביטול מעל שכבת העדפות העוגיות (61) ומגירת הניווט (60)', cancelZ > 61)
  chk('🔒 דיאלוג שינוי המועד מעל שכבת העדפות העוגיות ומגירת הניווט', reschedZ > 61)
  chk('שני הדיאלוגים באותה שכבה בדיוק (אין "מי מעל מי" ביניהם)', cancelZ === reschedZ)
}

// ════════════════════════════════════════════════════════════════════════════
section('7. לחיצה על ביטול פותחת dialog — ואינה שולחת POST')
{
  const clean = stripComments(src(ACTIONS))
  chk('🔒 הכפתורים בכרטיס רק פותחים dialog',
    /onClick=\{\(\) => setDialog\('cancel'\)\}/.test(clean) &&
    /onClick=\{\(\) => setDialog\('reschedule'\)\}/.test(clean))
  chk('🔒 אין שום fetch ברכיב הכפתורים — POST לא יכול לצאת לפני אישור',
    !/\bfetch\(/.test(clean))
  chk('הדיאלוגים מרונדרים רק כשנבחרה פעולה',
    /\{dialog === 'cancel' && \(/.test(clean) && /\{dialog === 'reschedule' && \(/.test(clean))
  chk('כפתור חסום הוא disabled — לחיצה עליו לא פותחת כלום',
    /disabled=\{!cancel\.allowed\}/.test(clean) && /disabled=\{!reschedule\.allowed\}/.test(clean))
}

// ════════════════════════════════════════════════════════════════════════════
section('8. אישור שולח POST אחד בלבד (הגנת לחיצה כפולה)')
{
  for (const [file, label] of [[CANCEL_DIALOG, 'ביטול'], [RESCHED_DIALOG, 'שינוי מועד']]) {
    const clean = stripComments(src(file))
    chk(`${label}: שער כניסה בראש submit — קריאה שנייה יוצאת מיד`,
      /const submit = async \(\) => \{\s*if \(saving\)/.test(clean) ||
      /if \(saving[^)]*\) return/.test(clean.split('const submit')[1] ?? ''))
    chk(`${label}: כפתור האישור disabled בזמן שליחה`, /disabled=\{saving\}/.test(clean))
    chk(`${label}: בדיוק קריאת fetch אחת אל /api/appointments`,
      (clean.match(/fetch\(`\/api\/appointments\//g) || []).length === 1)
  }
  const resched = stripComments(src(RESCHED_DIALOG))
  chk('🔒 שינוי מועד: payload = isoDate + time בלבד (השאר נטען בשרת)',
    /body: JSON\.stringify\(\{\s*isoDate: selected\.isoDate,\s*time,\s*\}\)/.test(resched))
  chk('שינוי מועד: לא נשלח בלי תאריך ושעה', /if \(saving \|\| !selected \|\| !time\) return/.test(resched))
}

// ════════════════════════════════════════════════════════════════════════════
section('9. הצלחה מרעננת; כישלון מציג שגיאה ואינו משנה מצב אופטימית')
{
  const actions = stripComments(src(ACTIONS))
  chk('🔒 הצלחה סוגרת dialog, מציגה אישור וקוראת router.refresh()',
    /const finish = \(message: string\) => \{[\s\S]*?setDialog\(null\)[\s\S]*?setNotice\(message\)[\s\S]*?router\.refresh\(\)/.test(actions))

  for (const [file, label] of [[CANCEL_DIALOG, 'ביטול'], [RESCHED_DIALOG, 'שינוי מועד']]) {
    const clean = stripComments(src(file))
    chk(`${label}: כישלון API → setError + החזרת saving, בלי onDone`,
      /if \(!res\.ok\) \{[\s\S]*?setError\([\s\S]*?setSaving\(false\)[\s\S]*?return/.test(clean))
    chk(`${label}: onDone נקרא אך ורק אחרי תשובה תקינה`,
      clean.indexOf('onDone(') > clean.indexOf('if (!res.ok)'))
    chk(`${label}: כשל רשת מקבל נוסח משלו ואינו נראה כהצלחה`,
      /catch \{\s*setError\('אין חיבור לאינטרנט/.test(clean))
    chk(`${label}: ההודעה ללקוחה מגיעה מהשרת (data.message) עם ברירת מחדל`,
      /data\.message \?\?/.test(clean))
  }
  const pending = stripComments(src(PENDING_BTN))
  chk('ביטול בקשה: מרענן רק בהצלחה, ומציג שגיאה בכישלון',
    /if \(!res\.ok\) \{[\s\S]*?setError\([\s\S]*?return[\s\S]*?\}[\s\S]*?setConfirming\(false\)\s*router\.refresh\(\)/.test(pending))
  chk('ביטול בקשה: disabled בזמן טעינה (בלי POST כפול)', /disabled=\{loading\}/.test(pending))
}

// ════════════════════════════════════════════════════════════════════════════
section('10. 🔒 כשל התראה אינו הופך הצלחה עסקית לכישלון')
{
  const clean = stripComments(src(CANCEL_ROUTE))
  const okIdx  = clean.indexOf('ok: true')
  const dispIdx = clean.indexOf('waitUntil(dispatchNow(')
  chk('ההתראה נשלחת ב-waitUntil — מחוץ למסלול התשובה', dispIdx !== -1)
  chk('🔒 התשובה החיובית נבנית בלי להמתין לתוצאת ההתראה', dispIdx < okIdx)
  chk('🔒 אין await לתוצאת dispatchNow ואין תלות בה ב-status', !/await dispatchNow\(/.test(clean))

  const selfService = stripComments(src('lib/appointmentSelfService.ts'))
  chk('🔒 כשל סנכרון יומן מחזיר ok:true עם נוסח מרוכך, לא כישלון',
    /ok: true,\s*outcome: result\.outcome,\s*calendarSynced: synced,/.test(selfService))
  chk('🔒 syncQuietly בולע חריגה ומחזיר false בלבד',
    /async function syncQuietly[\s\S]*?catch \(err\) \{[\s\S]*?return false/.test(selfService))
}

// ════════════════════════════════════════════════════════════════════════════
section('11. נגישות — מקלדת ומובייל')
{
  const actions = stripComments(src(ACTIONS))
  chk('שני הכפתורים הם <button type="button"> (ניתנים ל-Tab ול-Enter/Space)',
    (actions.match(/type="button"/g) || []).length >= 2)
  chk('לשניהם טבעת מיקוד גלויה', (actions.match(/focus-visible:ring-brand-gold/g) || []).length >= 2)
  chk('🔒 הסבר החסימה מוצג כטקסט ולא רק ב-title (במובייל אין hover)',
    /blockedMessages\.map\(m => <p key=\{m\}>\{m\}<\/p>\)/.test(actions))
  chk('שורת הכפתורים עוטפת במסך צר (flex-wrap)', /flex flex-wrap gap-2/.test(actions))

  for (const [file, label] of [[CANCEL_DIALOG, 'ביטול'], [RESCHED_DIALOG, 'שינוי מועד']]) {
    const clean = stripComments(src(file))
    chk(`${label}: role="dialog" + aria-modal + aria-labelledby`,
      /role="dialog"/.test(clean) && /aria-modal="true"/.test(clean) && /aria-labelledby=/.test(clean))
    /*
     * ⚠️ ה-Escape עבר ל-lib/useDialogA11y — יחד עם לכידת focus והחזרתו,
     * שהיו חסרים כאן לגמרי (הדיאלוג הכריז aria-modal בלי לממש אותו).
     * הערובה עצמה לא השתנתה: Escape סוגר, **אבל לא בזמן שליחה** —
     * שם onClose מועבר כ-undefined, וההוק מתעלם מהמקש.
     */
    chk(`${label}: Escape סוגר (ולא בזמן שליחה)`,
      /useDialogA11y</.test(clean) && /onClose: saving \? undefined : onClose/.test(clean))
    chk(`${label}: focus נלכד בדיאלוג ומוחזר בסגירה`,
      /ref=\{dialogRef\}/.test(clean) && /const dialogRef = useDialogA11y/.test(clean))
    chk(`${label}: גיליון תחתון במובייל, ממורכז בדסקטופ`,
      /items-end sm:items-center/.test(clean))
    chk(`${label}: כפתור סגירה בעל aria-label`, /aria-label="סגירה"/.test(clean))
    chk(`${label}: הודעת שגיאה מוכרזת (role="alert")`, /role="alert"/.test(clean))
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('11.5 🔴 ביטול בקשה ממתינה — בלי window.confirm')
{
  /*
    🔴 התקלה: הכפתור "ביטול הבקשה" נראה ולא הגיב לכלום.

    הוא היה מגודר ב-`window.confirm(...)`. דפדפן שמדכא דיאלוגים נטיביים
    מחזיר false **סינכרונית, בלי להציג דבר** — ה-webview של אינסטגרם/
    פייסבוק (שדרכו מגיעה רוב התנועה), וגם כרום אחרי "מנע מהדף הזה ליצור
    דיאלוגים נוספים". התוצאה: אפס fetch, בלי ספינר, בלי שגיאה. כפתור מת.

    שוחזר ב-production build מקומי: confirm→false נתן 0 קריאות רשת ו-DOM
    ללא שינוי; confirm→true נתן POST אחד תקין.
  */
  const clean = stripComments(src(PENDING_BTN))

  chk('🔴 אין window.confirm ברכיב', !/window\.confirm|(^|[^.\w])confirm\(/.test(clean))
  chk('🔴 אין alert/prompt נטיביים ברכיב', !/window\.(alert|prompt)|(^|[^.\w])(alert|prompt)\(/.test(clean))

  // ⚠️ שער כולל: אף רכיב באזור האישי לא יחזיר את הדפוס הזה בשקט.
  for (const f of [ACTIONS, CANCEL_DIALOG, RESCHED_DIALOG, PENDING_BTN]) {
    chk(`🔒 ${f.split('/').pop()} — בלי דיאלוג נטיבי`,
      !/window\.(confirm|alert|prompt)\(/.test(stripComments(src(f))))
  }

  chk('הכפתור בכרטיס רק פותח דיאלוג', /onClick=\{\(\) => setConfirming\(true\)\}/.test(clean))
  chk('🔒 הדיאלוג מרונדר רק אחרי בחירה מפורשת', /\{confirming && \(/.test(clean))
  chk('דיאלוג React אמיתי: role + aria-modal + aria-labelledby',
    /role="dialog"/.test(clean) && /aria-modal="true"/.test(clean) && /aria-labelledby="cancel-pending-title"/.test(clean))
  // ⚠️ כמו בשני הדיאלוגים האחרים: Escape + לכידת focus עברו ל-useDialogA11y.
  // loading חוסם סגירה, כדי לא לנטוש POST שכבר בדרך.
  chk('Escape סוגר (ולא בזמן שליחה)',
    /useDialogA11y</.test(clean) && /onClose: loading \? undefined : \(\) => setConfirming\(false\)/.test(clean))
  chk('focus נלכד בדיאלוג ומוחזר בסגירה',
    /ref=\{dialogRef\}/.test(clean) && /const dialogRef = useDialogA11y/.test(clean))
  chk('גיליון תחתון במובייל, ממורכז בדסקטופ', /items-end sm:items-center/.test(clean))

  const zOfPending = (() => {
    const line = src(PENDING_BTN).split('\n').find(l => l.includes('fixed inset-0 z-'))
    const m = line && line.match(/z-\[?(\d+)\]?/)
    return m ? Number(m[1]) : null
  })()
  chk('🔒 הדיאלוג מעל הודעת העוגיות ושכבת ההעדפות', zOfPending > 61, `pending=${zOfPending}`)

  chk('🔒 בדיוק קריאת fetch אחת אל /api/appointments',
    (clean.match(/fetch\(`\/api\/appointments\//g) || []).length === 1)

  /*
    ⚠️ `if (loading) return` ו-disabled={loading} לבדם אינם מונעים POST
    כפול: שניהם נשענים על state שמתעדכן רק ברינדור הבא, ושתי נגיעות באותו
    tick רואות שתיהן loading=false. אומת: שלוש לחיצות סינכרוניות ייצרו
    שלושה POST לפני התיקון, ואחת אחריו.
  */
  chk('🔒 שער סינכרוני נגד POST כפול (createInFlightGuard, לא רק state)',
    /createInFlightGuard/.test(clean) && /if \(!inFlight\.current\.tryStart\(\)\) return/.test(clean))
  chk('🔒 השער משוחרר בכל מסלול כישלון', (clean.match(/inFlight\.current\.finish\(\)/g) || []).length >= 2)
  chk('כפתור האישור disabled בזמן שליחה', /disabled=\{loading\}/.test(clean))

  chk('🔒 401 מקבל נוסח משלו — "נסי שוב" לא היה עוזר לעולם',
    /res\.status === 401/.test(clean) && /נותקת מהחשבון/.test(clean))
  chk('🔒 401 מציע מסלול יציאה אמיתי (קישור להתחברות)',
    /href="\/login"/.test(clean))
  chk('שגיאה אחרת מגיעה מהשרת עם ברירת מחדל', /data\.message \?\? 'הביטול נכשל/.test(clean))
  chk('כשל רשת מקבל נוסח משלו', /catch \{\s*setError\('אין חיבור לאינטרנט/.test(clean))
  chk('הודעת השגיאה מוכרזת (role="alert")', /role="alert"/.test(clean))

  chk('🔒 הצלחה סוגרת את הדיאלוג ומרעננת', /setConfirming\(false\)\s*router\.refresh\(\)/.test(clean))
  chk('🔒 כישלון אינו מרענן ואינו סוגר (המצב לא משתנה אופטימית)',
    clean.indexOf('router.refresh()') > clean.lastIndexOf('setLoading(false)\n        inFlight.current.finish()\n        return'))

  /*
    ⚠️ 69×16 פיקסלים היה גודל היעד הקודם — הרבה מתחת ל-44×44. נמדד
    בדפדפן: 101×44 אחרי התיקון.
  */
  chk('🔒 יעד נגיעה בגובה 44px לפחות (h-11)', /className="[^"]*\bh-11\b/.test(clean))
  chk('טבעת מיקוד גלויה למקלדת', /focus-visible:ring-brand-gold/.test(clean))
}

// ════════════════════════════════════════════════════════════════════════════
section('12. הבדיקות עצמן — בלי רשת ובלי DB')
{
  /*
    ⚠️ הבדיקה מסתכלת על הקובץ הזה עצמו. שמות ה-tokens האסורים מורכבים
    בזמן ריצה כדי שהמחרוזות בשמות הבדיקות לא ייספרו כמופע.
  */
  const self = src('scripts/test-account-actions.mjs')
  const body = stripComments(self).split("section('12.")[0]
  const banned = ['fet' + 'ch(', 'supa' + 'base', 'create' + 'Client', 'htt' + 'p://', 'http' + 's://']
  for (const token of banned) {
    chk(`🔒 אין "${token}" בגוף הבדיקות — בלי רשת ובלי DB`, !body.includes(token))
  }
}

// ─── סיכום ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r).length
console.log(`\n${failed === 0 ? '✓' : '✗'} ${results.length - failed}/${results.length} עברו`)
process.exit(failed === 0 ? 0 : 1)
