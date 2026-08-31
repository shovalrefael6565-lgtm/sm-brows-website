/**
 * דיוור SMS — הליבה: הרכבת ההודעה, ספירת היחידות, ה-token וההחלטה על נמענת.
 *
 * ─── מה נבדק כאן ולמה דווקא כאן ─────────────────────────────────────────────
 *
 * שלושה דברים שטעות בהם עולה כסף אמיתי או שולחת הודעה שאסור לשלוח:
 *
 *   1. **המונה.** אם המסך סופר אחרת מהשרת, שובל רואה "יחידה אחת" ומשלמת על
 *      שתיים. הבדיקות כאן מריצות את אותה פונקציה שהמסך והשרת קוראים לה.
 *   2. **ה-token.** 128 סיביות, אורך קבוע, דטרמיניסטי — ובמסד רק החותם.
 *   3. **ההחלטה על נמענת.** מי שהסירה את עצמה, ומספר שהוחלף מאז שהרשימה
 *      אושרה. זו ההחלטה שמונעת דיוור אסור.
 *
 * אפס רשת, אפס DB, אפס SMS.
 *
 * הרצה:  npm run test:bulk-sms
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

let pass = 0, fail = 0
const chk = (name, ok = true, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = p => readFileSync(join(ROOT, p), 'utf8')

const M = await import('../lib/marketing/message.ts')
const { decideRecipient } = await import('../lib/marketing/decide.ts')

process.env.MARKETING_OPT_OUT_SECRET_V1 = 'test-secret-'.padEnd(48, 'x')
const T = await import('../lib/marketing/tokens.ts')

// ════════════════════════════════════════════════════════════════════════════
section('ההודעה הסופית — זיהוי + גוף + קישור הסרה')
// ════════════════════════════════════════════════════════════════════════════

{
  const rendered = M.renderMarketingSms('תזכורת לקבוע תור לחג', 'a'.repeat(22))
  chk('נפתחת בזיהוי העסק', rendered.startsWith('S.M BROWS:'), rendered)
  chk('מכילה את גוף הקמפיין', rendered.includes('תזכורת לקבוע תור לחג'))
  chk('מכילה קישור הסרה', rendered.includes(`${M.OPT_OUT_URL_BASE}${'a'.repeat(22)}`))

  // 🔒 ה-preview חייב להיות **זהה באורכו** למה שיישלח, אחרת המונה משקר.
  const preview = M.renderMarketingSmsPreview('תזכורת לקבוע תור לחג')
  chk('ה-preview זהה באורכו להודעה האמיתית', preview.length === rendered.length,
    `${preview.length} vs ${rendered.length}`)
  chk('אורך ה-token קבוע ב-22', M.OPT_OUT_TOKEN_LENGTH === 22)

  // אורך ה-token זהה לכל נמענת ⟹ אותו מספר יחידות לכולן
  const a = M.renderMarketingSms('שלום', 'b'.repeat(22))
  const b = M.renderMarketingSms('שלום', 'c'.repeat(22))
  chk('שתי נמענות ⟹ אותו אורך בדיוק', a.length === b.length)
}

// ════════════════════════════════════════════════════════════════════════════
section('גבול 70/71 — עברית היא UCS-2')
// ════════════════════════════════════════════════════════════════════════════

{
  const heb = n => 'א'.repeat(n)
  chk('70 תווים בעברית = יחידה אחת', M.smsUnits(heb(70)).segments === 1)
  // 🔴 השורה שכל התמחור תלוי בה: 71 הם **שתיים**, ולא אחת וקצת.
  chk('71 תווים בעברית = שתי יחידות', M.smsUnits(heb(71)).segments === 2)
  chk('67 תווים = יחידה אחת', M.smsUnits(heb(67)).segments === 1)
  chk('134 תווים (67×2) = שתיים', M.smsUnits(heb(134)).segments === 2)
  chk('135 תווים = שלוש', M.smsUnits(heb(135)).segments === 3)
  chk('טקסט ריק = אפס יחידות (אין חיוב)', M.smsUnits('').segments === 0)
  chk('קידוד עברית מזוהה כ-ucs2', M.smsUnits(heb(10)).encoding === 'ucs2')

  // אנגלית נקייה = GSM-7, 160
  chk('160 תווי אנגלית = יחידה אחת', M.smsUnits('a'.repeat(160)).segments === 1)
  chk('161 תווי אנגלית = שתיים', M.smsUnits('a'.repeat(161)).segments === 2)
  chk('קידוד אנגלית מזוהה כ-gsm7', M.smsUnits('hello').encoding === 'gsm7')
  chk('תו עברי אחד הופך הכל ל-ucs2', M.smsUnits('hello א').encoding === 'ucs2')

  chk('נותרו עד היחידה הבאה', M.smsUnits(heb(65)).charsUntilNextSegment === 5)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 המונה נמדד על ההודעה הסופית, לא על מה שהוקלד')
// ════════════════════════════════════════════════════════════════════════════

{
  const body = 'שלום'
  const stats = M.evaluateMarketingBody(body)
  chk('הספירה גדולה מאורך הגוף לבדו', stats.chars > body.length, `${stats.chars} > ${body.length}`)
  chk('והיא בדיוק אורך ה-preview', stats.chars === stats.preview.length)

  // גוף של 30 תווים כבר חורג מיחידה אחת, בגלל הזיהוי והקישור
  const overhead = M.evaluateMarketingBody('').preview.length
  chk('התקורה הקבועה מחושבת', overhead > 0, `${overhead} תווים`)
  const roomy = M.evaluateMarketingBody('א'.repeat(M.UCS2_SINGLE_MAX - overhead))
  chk('גוף שממלא בדיוק את היחידה — עדיין אחת', roomy.segments === 1, `chars=${roomy.chars}`)
  const overflow = M.evaluateMarketingBody('א'.repeat(M.UCS2_SINGLE_MAX - overhead + 1))
  chk('תו אחד מעבר — שתי יחידות', overflow.segments === 2, `chars=${overflow.chars}`)
}

// ════════════════════════════════════════════════════════════════════════════
section('מגבלת הספק נבדקת על ההודעה הסופית')
// ════════════════════════════════════════════════════════════════════════════

{
  chk('המגבלה מיובאת מהידע על 019 ולא מומצאת', M.PROVIDER_MAX_CHARS === 1005)

  const overheadLen = M.evaluateMarketingBody('').preview.length
  // גוף שנכנס בדיוק במגבלה **אחרי** התוספות
  const exact = M.evaluateMarketingBody('א'.repeat(M.PROVIDER_MAX_CHARS - overheadLen))
  chk('הודעה סופית באורך המקסימום מתקבלת', exact.error === null, `chars=${exact.chars}`)

  // 🔴 גוף שהיה עובר אילו נבדק לבדו — ונדחה כי הסופית חורגת
  const over = M.evaluateMarketingBody('א'.repeat(M.PROVIDER_MAX_CHARS - overheadLen + 1))
  chk('תו אחד מעבר נדחה', over.error === 'too_long_for_provider', `chars=${over.chars}`)
  chk('⚠️ הגוף עצמו עדיין מתחת למגבלה — ולכן בדיקה עליו לבדו הייתה מפספסת',
    M.PROVIDER_MAX_CHARS - overheadLen + 1 < M.PROVIDER_MAX_CHARS)

  chk('גוף ריק נדחה', M.evaluateMarketingBody('   ').error === 'empty')
  chk('אין חיתוך אוטומטי בשום מקום',
    !/\.slice\(0,\s*(70|1005)\)/.test(src('lib/marketing/message.ts')))
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 מקור אחד לספירה — המסך והשרת')
// ════════════════════════════════════════════════════════════════════════════

{
  const ui = src('components/admin/BulkSmsComposer.tsx')
  const createRoute = src('app/api/admin/campaigns/route.ts')
  const testRoute = src('app/api/admin/campaigns/test/route.ts')
  const dbLayer = src('lib/db/marketing.ts')

  chk('המסך קורא ל-evaluateMarketingBody', ui.includes('evaluateMarketingBody'))
  chk('route היצירה קורא לאותה פונקציה', createRoute.includes('evaluateMarketingBody'))
  chk('שכבת ה-DB קוראת לאותה פונקציה', dbLayer.includes('evaluateMarketingBody'))
  chk('הבדיקה משתמשת באותו renderer', testRoute.includes('renderMarketingSms'))
  chk('⚠️ אין במסך חישוב אורך עצמאי',
    !/body\.length\s*[<>]/.test(ui) && !/Math\.ceil\([^)]*70/.test(ui))
  chk('השליחה בפועל מרכיבה דרך renderMarketingSms', dbLayer.includes('renderMarketingSms(body, t.token)'))
}

// ════════════════════════════════════════════════════════════════════════════
section('token ההסרה')
// ════════════════════════════════════════════════════════════════════════════

{
  const id = '8680a691-61dd-4f82-8f0a-7ec21fda8ebe'
  const t = T.deriveOptOutToken(id)
  chk('נגזר בהצלחה', t.ok === true)
  chk('אורך 22 תווי base64url', t.token.length === 22, t.token)
  chk('128 סיביות', Buffer.from(t.token, 'base64url').length === 16)
  chk('base64url בלבד', /^[A-Za-z0-9_-]{22}$/.test(t.token))

  // 🔒 יציב — קישור מהודעה ישנה חייב להמשיך לעבוד
  chk('דטרמיניסטי לאותה לקוחה', T.deriveOptOutToken(id).token === t.token)
  chk('שונה בין לקוחות',
    T.deriveOptOutToken('11111111-1111-4111-8111-111111111111').token !== t.token)

  // 🔒 תלוי בסוד — בלי הסוד אי אפשר לגזור
  const saved = process.env.MARKETING_OPT_OUT_SECRET_V1
  process.env.MARKETING_OPT_OUT_SECRET_V1 = ''
  chk('בלי הסוד אין token', T.deriveOptOutToken(id).ok === false)
  chk('ו-optOutSecretReady מדווח false', T.optOutSecretReady() === false)
  process.env.MARKETING_OPT_OUT_SECRET_V1 = saved
  chk('עם הסוד — מוכן', T.optOutSecretReady() === true)

  const h = T.optOutTokenHash(t.token)
  chk('החותם הוא sha256 hex', /^[0-9a-f]{64}$/.test(h))
  chk('⚠️ החותם אינו ה-token', h !== t.token)

  chk('token תקין עובר ולידציה', T.isWellFormedOptOutToken(t.token))
  chk('token קצר נדחה', T.isWellFormedOptOutToken('abc') === false)
  chk('token עם תווים אסורים נדחה', T.isWellFormedOptOutToken('a'.repeat(21) + '/') === false)
  chk('לא-מחרוזת נדחית', T.isWellFormedOptOutToken(null) === false)

  // גרסה לא מוכרת אינה גוזרת דבר
  chk('גרסת סוד לא מוכרת נדחית', T.deriveOptOutToken(id, 99).ok === false)

  // 🔒 קישור ישן נשאר תקף: החותם נכתב פעם אחת ואינו נדרס
  chk('החותם נכתב פעם אחת בלבד',
    src('lib/db/marketing.ts').includes(".is('marketing_opt_out_token_version', null)"))
}

// ════════════════════════════════════════════════════════════════════════════
section('חותם הטלפון — 05… ו-+972… הם נמען אחד')
// ════════════════════════════════════════════════════════════════════════════

{
  const { normalizePhone } = await import('../lib/phone.ts')
  const a = T.phoneHash(normalizePhone('052-123-4567'))
  const b = T.phoneHash(normalizePhone('+972521234567'))
  const c = T.phoneHash(normalizePhone('0521234567'))
  chk('שלושת הפורמטים מנורמלים לאותו מספר',
    normalizePhone('052-123-4567') === normalizePhone('+972521234567'))
  chk('🔒 ולכן אותו חותם בדיוק', a.hash === b.hash && b.hash === c.hash)
  chk('מספר אחר ⟹ חותם אחר', T.phoneHash('+972529999999').hash !== a.hash)
  chk('החותם הוא sha256 hex', /^[0-9a-f]{64}$/.test(a.hash))
  chk('השוואה בזמן קבוע עובדת', T.hashesEqual(a.hash, b.hash) === true)
  chk('ולא מתבלבלת', T.hashesEqual(a.hash, T.phoneHash('+972529999999').hash) === false)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔴 ההחלטה על נמענת — כל הצירופים')
// ════════════════════════════════════════════════════════════════════════════

{
  const H = 'a'.repeat(64)
  const base = {
    optedOutAt: null, archivedAt: null, isBlocked: false,
    normalizedPhone: '+972521234567', currentPhoneHash: H, storedPhoneHash: H,
  }

  chk('לקוחה תקינה — שולחים', decideRecipient(base).send === true)

  // 🔴 החסימה הקשה של PHASE 1
  chk('הסירה את עצמה — לא שולחים',
    decideRecipient({ ...base, optedOutAt: '2026-08-01T00:00:00Z' }).skipReason === 'opted_out')
  chk('⚠️ וההסרה גוברת גם על ארכיון וגם על מספר שהוחלף',
    decideRecipient({ ...base, optedOutAt: '2026-08-01T00:00:00Z', archivedAt: '2026-08-02T00:00:00Z',
      currentPhoneHash: 'b'.repeat(64) }).skipReason === 'opted_out')

  chk('בארכיון — לא שולחים',
    decideRecipient({ ...base, archivedAt: '2026-08-01T00:00:00Z' }).skipReason === 'archived')
  chk('חסומה — לא שולחים',
    decideRecipient({ ...base, isBlocked: true }).skipReason === 'blocked')
  chk('מספר לא תקין — לא שולחים',
    decideRecipient({ ...base, normalizedPhone: null, currentPhoneHash: null }).skipReason === 'invalid_phone')

  // 🔴 המספר הוחלף בין אישור הרשימה לשליחה
  chk('מספר שהוחלף — לא שולחים',
    decideRecipient({ ...base, currentPhoneHash: 'b'.repeat(64) }).skipReason === 'phone_changed')
  chk('⚠️ וההודעה בוודאי לא נשלחת למספר החדש — ההחלטה היא send:false',
    decideRecipient({ ...base, currentPhoneHash: 'b'.repeat(64) }).send === false)
}

// ════════════════════════════════════════════════════════════════════════════
section('🔒 המסלול התפעולי לא נגוע')
// ════════════════════════════════════════════════════════════════════════════

{
  // אף מסלול תפעולי אינו יודע דבר על דיוור או על הסרה ממנו.
  const transactional = [
    'lib/reminders/dispatch.ts',
    'lib/notifications/dispatch.ts',
    'lib/notifications/provider.ts',
    'lib/sms/index.ts',
    'lib/reminders/sms019.ts',
  ]
  const leaked = transactional.filter(p => /marketing|opted_out|opt_out|campaign/i.test(src(p)))
  chk('אף מסלול תפעולי אינו מזכיר דיוור/הסרה', leaked.length === 0, leaked.join(', '))

  // דגל נפרד לכל מערכת — כיבוי הדיוור לא נוגע בתזכורות
  // ⚠️ ההערות מסולקות: התיעוד **מסביר** למה הדגל נפרד ולכן מזכיר את שני
  // האחרים בשמם. אזכור בהערה אינו קריאה. הבדיקה היא על מה שרץ.
  const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const mp = stripComments(src('lib/marketing/provider.ts'))
  chk('לדיוור דגל סביבה משלו', mp.includes('MARKETING_SMS_PROVIDER'))
  chk('הקוד אינו קורא את דגל התזכורות', !mp.includes('env.REMINDER_PROVIDER'))
  chk('הקוד אינו קורא את דגל ההתראות', !mp.includes('env.NOTIFICATION_PROVIDER'))
  chk('🔴 ברירת המחדל היא disabled', mp.includes("|| 'disabled'"))

  // עמוד ההסרה מבטיח במפורש שההודעות התפעוליות ממשיכות
  chk('עמוד ההסרה מבהיר שתזכורות ממשיכות',
    src('components/marketing/UnsubscribeForm.tsx').includes('ימשיכו להישלח'))
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} עברו, ${fail} נכשלו`)
process.exit(fail === 0 ? 0 : 1)
