/**
 * סדר השלבים בטופס ההזמנה הציבורי — הפרטים לפני היומן.
 *
 * ─── מה נבדק כאן ולמה דווקא כאן ─────────────────────────────────────────────
 *
 * עד 06.09.2026 סדר השלבים בזרימת היומן היה: טיפול → יומן → פרטים. הלקוחה
 * בחרה תאריך ושעה לפני שידעה בכלל שנדרשים ממנה שם וטלפון, וגילתה זאת רק
 * כשה-validation חסם את השליחה בסוף. הסדר הפוך היום, ואסור שיחזור:
 *
 *   1. **שלב 2 בזרימת היומן הוא הפרטים**, לא היומן. היומן הוא שלב 3.
 *   2. **המעבר ליומן חסום** בלי שם וטלפון תקינים — אותה ולידציה בדיוק
 *      שרצה ב-validateFinal, רק מוקדם יותר.
 *   3. **כל מעבר שלב גולל לראש השלב** — הלקוחה לא נוחתת באמצע היומן.
 *   4. **שדה השם והטלפון מופיע פעם אחת בכל זרימה** — מקור אחד, בלי עותק
 *      שני שיתבדר בין השלבים.
 *   5. **שום דבר בזמינות / בשליחה לא זז**: אותו מסלול /api/bookings/request,
 *      אותה validateFinal, אותו selectDisplaySlots.
 *
 * טופס האזור האישי (AccountBookingForm) לא נגע — הוא מקבל שם/טלפון
 * מה-session ולא סבל מהבעיה מלכתחילה.
 *
 * אפס רשת, אפס DB.
 *
 * הרצה:  npm run test:booking-step-order
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

let pass = 0, fail = 0
const chk = (name, ok = true, extra = '') => {
  if (ok) pass++; else fail++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = p => readFileSync(join(ROOT, p), 'utf8')
const stripComments = s =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const FORM = src('components/booking/BookingForm.tsx')
const CODE = stripComments(FORM)
const ACCOUNT = stripComments(src('components/account/AccountBookingForm.tsx'))

// ════════════════════════════════════════════════════════════════════════════
section('1. בחירת טיפול + המשך → פרטים, לא יומן')
// ════════════════════════════════════════════════════════════════════════════

chk('זרימת היומן היא 4 שלבים, והשני הוא הפרטים',
  /stepLabels\s*=\s*isCalendar[\s\S]{0,200}?'בחירת טיפול',\s*'הפרטים שלך',\s*'בחירת מועד',\s*'אישור ושליחה'/.test(CODE))
chk('זרימת הוואטסאפ (בלי יומן) נשארה 2 שלבים',
  /:\s*\['בחירת טיפול',\s*'פרטים ואישור'\]/.test(CODE))
chk('שלב 2 בזרימת היומן מרנדר את שדות הפרטים',
  /step === 2 && isCalendar[\s\S]{0,2500}?\{nameAndPhoneFields\}/.test(CODE))
chk('🔒 היומן אינו שלב 2 — הוא שלב 3',
  /step === 3 && isCalendar/.test(CODE) && !/step === 2 && isCalendar[\s\S]{0,3000}?בחירת תאריך/.test(CODE))
chk('goNext מגביל את זרימת היומן ל-4 שלבים',
  /const total = \(f\.service === NATURAL \|\| f\.service === LIFTING\) \? 4 : 2/.test(CODE))
chk('כפתור ההמשך אומר לאן הוא מוביל',
  /continueLabel = isCalendar && step === 2 \? 'המשך לבחירת תאריך' : 'המשך'/.test(CODE) &&
  /\{continueLabel\}/.test(CODE))

// ════════════════════════════════════════════════════════════════════════════
section('2. שם וטלפון חובה לפני המעבר ליומן')
// ════════════════════════════════════════════════════════════════════════════

const step2Validation = CODE.match(/if \(s === 2 && isCal\) \{[\s\S]*?\n    \}/)?.[0] ?? ''
chk('validateStep(2) דורשת שם', /!f\.name\.trim\(\)/.test(step2Validation))
chk('validateStep(2) דורשת טלפון', /!f\.phone\.trim\(\)/.test(step2Validation))
chk('🔒 validateStep(2) דורשת נייד ישראלי תקין — כמו validateFinal',
  /isValidIsraeliMobile\(f\.phone\)/.test(step2Validation))
chk('חסימה מחזירה פוקוס לשדה החסר', /target\?\.focus\(\{ preventScroll: true \}\)/.test(CODE))
chk('הודעות השגיאה נשארות role="alert" ומקושרות ב-aria-describedby',
  /id="err-name" role="alert"/.test(CODE) &&
  /id="err-phone" role="alert"/.test(CODE) &&
  /aria-describedby=\{errors\.name \? 'err-name' : undefined\}/.test(CODE) &&
  /aria-describedby=\{errors\.phone \? 'err-phone' : undefined\}/.test(CODE))

// ════════════════════════════════════════════════════════════════════════════
section('3. אחרי פרטים תקינים — מעבר ליומן, בראש השלב')
// ════════════════════════════════════════════════════════════════════════════

const step3Validation = CODE.match(/if \(s === 3 && isCal\) \{[\s\S]*?\n    \}/)?.[0] ?? ''
chk('ולידציית היומן (תאריך/שעה/סוג טיפול) עברה לשלב 3',
  /!f\.date/.test(step3Validation) && /!f\.time/.test(step3Validation) &&
  /f\.variants\.length === 0/.test(step3Validation))
chk('goNext גולל לראש השלב החדש', /setStep\(cur => Math\.min\(cur \+ 1, total\)\)\s*\n\s*scrollToStepTop\(\)/.test(CODE))
chk('goBack גולל גם הוא', /setStep\(s => Math\.max\(s - 1, 1\)\)\s*\n\s*scrollToStepTop\(\)/.test(CODE))
chk('יעד הגלילה הוא ראש הטופס, עם scroll-mt', /ref=\{stepTopRef\} className="scroll-mt-24"/.test(CODE))
chk('🔒 selectService עדיין גולל לכפתור ההמשך בלבד (block:"nearest")',
  /ctaRef\.current\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'nearest' \}\)/.test(CODE))

// ════════════════════════════════════════════════════════════════════════════
section('4. מקור אחד לשדות, וקריאוּת במובייל')
// ════════════════════════════════════════════════════════════════════════════

chk('שדות השם והטלפון מוגדרים פעם אחת', (CODE.match(/id="booking-name"/g) ?? []).length === 1)
chk('שדה הטלפון מוגדר פעם אחת', (CODE.match(/id="booking-phone"/g) ?? []).length === 1)
chk('בזרימת היומן השדות אינם מוצגים שוב בשלב האחרון',
  /\{!isCalendar && nameAndPhoneFields\}/.test(CODE))
chk('הסיכום מציג את השם והטלפון שנאספו, עם קישור לעריכה',
  /עריכת השם והטלפון/.test(CODE) && /setStep\(2\); scrollToStepTop\(\)/.test(CODE))
chk('⚠️ text-base במובייל — כדי ש-iOS לא יזום על הטופס בפוקוס',
  (CODE.match(/text-base sm:text-sm/g) ?? []).length === 2)
chk('שדה הטלפון פותח מקלדת מספרים', /inputMode="tel"/.test(CODE))

// ════════════════════════════════════════════════════════════════════════════
section('5. אין regression — זמינות, שליחה, ואזור אישי')
// ════════════════════════════════════════════════════════════════════════════

chk('🔒 השליחה עדיין דרך /api/bookings/request', /'\/api\/bookings\/request'/.test(CODE))
chk('🔒 validateFinal נשארה השומר האחרון על שם/טלפון/אישורים',
  /const validateFinal = \(\) => \{[\s\S]*?!f\.name\.trim\(\)[\s\S]*?!f\.phone\.trim\(\)[\s\S]*?f\.policyAccepted[\s\S]*?f\.privacyNoticeAcknowledged/.test(CODE))
chk('🔒 הזמינות עדיין נגזרת מ-selectDisplaySlots המשותף', /selectDisplaySlots\(\{/.test(CODE))
chk('🔒 חלון ההזמנה (30 יום) ושישי/שבת לא זזו',
  /withinHorizon\(viewYear, viewMonth, day\)/.test(CODE) && /dow === 5 \|\| dow === 6/.test(CODE))
chk('🔒 handleSubmit לא השתנה — אותה זרימה אחת עם fallback לוואטסאפ',
  /openBlankWhatsAppWindow\(\)\s*\n\s*void finalizeBooking\(\)/.test(CODE))
chk('🔒 AccountBookingForm לא קיבל שלבים — הוא ממלא שם/טלפון מה-session',
  !/stepLabels/.test(ACCOUNT) && !/scrollToStepTop/.test(ACCOUNT))

console.log(`\n${'─'.repeat(64)}`)
console.log(`${pass}/${pass + fail} בדיקות עברו`)
if (fail) { console.log('✗ נכשל'); process.exit(1) }
console.log('✓ סדר השלבים בטופס ההזמנה תקין')
