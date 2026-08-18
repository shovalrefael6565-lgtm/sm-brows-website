/**
 * בדיקת נגישות — תקן ישראלי 5568 (WCAG 2.0 AA) + סעיפי 2.2 הרלוונטיים.
 *
 * ⚠️ הבדיקות כאן הן **שערים על הקוד**, לא סריקת דפדפן. הן נועדו למנוע
 * נסיגה שקטה: כל אחד מהסעיפים למטה מתעד תקלה אמיתית שנמצאה בביקורת
 * הנגישות ותוקנה — ושחזרתה לא הייתה נתפסת בשום בדיקה קיימת.
 *
 * ⚠️ בלי רשת ובלי DB, כמו שאר הבדיקות בריפו.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0, fail = 0
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`)
const chk = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(70)} ${extra}`)
  if (ok) pass++
  else fail++
}

const src = (p) => readFileSync(p, 'utf8')

/*
 * ⚠️ מסיר **רק** גושי /* *\/ ושורות //, ולא את הצורה `{/* ... *\/}`.
 * הגרסה שמסירה גם את העטיפה המסולסלת בולעת בקבצים גדולים טווחים שלמים
 * של קוד (התאמה חמדנית שמתחילה ב-{ אחד ונסגרת ב-*\/} רחוק), ואז בדיקות
 * עוברות/נכשלות על סמך קוד שכלל לא נבדק. הסוגריים המסולסלים הריקים
 * שנשארים אינם מפריעים לאף אחת מהבדיקות כאן.
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}
const ALL_TSX = [...walk('app'), ...walk('components')]

// ════════════════════════════════════════════════════════════════════════════
section('1. Landmarks — main יחיד, בלי id כפול')
{
  /*
    🔴 התקלה: app/booking/page.tsx רינדר <main id="main-content"> **בתוך**
    ה-<main id="main-content"> של app/layout.tsx. התוצאה: שני landmarks
    מסוג main באותו עמוד ו-id כפול — קורא מסך מדווח על שני אזורי תוכן
    ראשיים, וקישור "דלגי לתוכן הראשי" מעביר focus לאלמנט הלא נכון.
    אותה תקלה בדיוק הייתה בפריסת אזור הניהול.
  */
  const withMain = ALL_TSX.filter((f) => /<main[\s>]/.test(stripComments(src(f))))
  chk('בדיוק קובץ אחד מרנדר <main> — app/layout.tsx',
    withMain.length === 1 && withMain[0] === join('app', 'layout.tsx'),
    withMain.join(', '))

  const withSkipTarget = ALL_TSX.filter((f) => /id="main-content"/.test(stripComments(src(f))))
  chk('id="main-content" מוגדר במקום אחד בלבד',
    withSkipTarget.length === 1, withSkipTarget.join(', '))

  const layout = stripComments(src(join('app', 'layout.tsx')))
  chk('קישור דילוג לתוכן קיים ומוסתר עד focus', /href="#main-content"/.test(layout) && /sr-only focus:not-sr-only/.test(layout))
  chk('יעד הדילוג ניתן למיקוד תכנותי (tabIndex={-1})', /id="main-content" tabIndex=\{-1\}/.test(layout))
  chk('שפה וכיוון מוגדרים על <html>', /lang="he"/.test(layout) && /dir="rtl"/.test(layout))
}

// ════════════════════════════════════════════════════════════════════════════
section('2. דיאלוגים — aria-modal חייב להיות ממומש בפועל')
{
  /*
    🔴 התקלה: כל הדיאלוגים באתר הכריזו role="dialog" aria-modal="true"
    אבל לא לכדו focus. משתמשת מקלדת המשיכה ב-Tab אל הניווט והפוטר שמאחורי
    השכבה — גלויים לסדר ה-Tab, מוסתרים ויזואלית — כלומר focus נעלם מהמסך.
    בכיוון ההפוך: הדיאלוג נפתח בלי להעביר אליו focus, ולכן קורא מסך לא
    הכריז אותו כלל; ובסגירה focus נפל ל-<body> במקום לחזור לכפתור הפותח.
  */
  const HOOK = join('lib', 'useDialogA11y.ts')
  const hook = src(HOOK)
  chk('ההוק המשותף קיים', hook.length > 0)
  chk('ההוק לוכד Tab בשני הכיוונים', /e\.shiftKey && active === first/.test(hook) && /!e\.shiftKey && active === last/.test(hook))
  chk('ההוק מחזיר focus לפותח בסגירה', /previouslyFocused\.isConnected/.test(hook) && /previouslyFocused\.focus\(\)/.test(hook))
  chk('ההוק מעביר focus פנימה בפתיחה', /initial\.focus\(\)/.test(hook))
  chk('ההוק מטפל ב-Escape', /e\.key === 'Escape'/.test(hook))

  // כל רכיב שמכריז aria-modal חייב להיות מחובר לניהול focus כלשהו:
  // או דרך ההוק המשותף, או במימוש מקומי מלא (ConsentPreferencesModal).
  const modals = ALL_TSX.filter((f) => /aria-modal="true"/.test(stripComments(src(f))))
  chk('נמצאו רכיבים מודאליים לבדיקה', modals.length >= 5, `${modals.length} רכיבים`)
  for (const f of modals) {
    const clean = stripComments(src(f))
    const viaHook = /useDialogA11y/.test(clean)
    const viaLocal = /e\.key !== 'Tab'/.test(clean) && /\.focus\(\)/.test(clean)
    chk(`${f.split('/').pop()} — aria-modal עם ניהול focus אמיתי`, viaHook || viaLocal)
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('3. שכבות נפתחות נסגרות במקלדת')
{
  /*
    🔴 התקלה: מגירת הניווט, תפריט "קבעי תור" ותיבת החיפוש נסגרו רק
    ב-mousedown מחוץ להן. למשתמשת מקלדת לא הייתה שום דרך לסגור אותן.
  */
  const nav = src(join('components', 'layout', 'Navbar.tsx'))
  chk('Navbar סוגר את השכבות ב-Escape', /if \(e\.key !== 'Escape'\) return/.test(nav))
  chk('Escape מכסה את שלוש השכבות',
    /if \(bookingOpen\)/.test(nav) && /else if \(searchOpen\)/.test(nav) && /else if \(menuOpen\)/.test(nav))
  chk('מגירת הניווט לוכדת focus',
    /const mobileMenuRef = useDialogA11y/.test(nav) && /ref=\{mobileMenuRef\}/.test(nav))
}

// ════════════════════════════════════════════════════════════════════════════
section('3.5 שכבות fixed לא נשארות תקועות אחרי סגירה')
{
  /*
    🔴 התקלה, ארבע פעמים באותו קוד: exit animation של framer-motion 11 עם
    React 19 לא תמיד משלים unmount. השכבה נשארת ב-DOM עם opacity:0 אבל
    pointer-events:auto — בלתי נראית, ובולעת נגיעות.

    שוחזר ב-hit-test:
      • תפריט הנגישות — בלע כל לחיצה ב-~365×460 בפינה, בכל עמוד באתר.
      • הלייטבוקס של "לפני ואחרי" — fixed inset-0 z-[9999], בלע את כל דף הבית.
      • מגירת הניווט בנייד — שוחזר בפרודקשן על smbrows.co.il: המסך נראה
        תקין, ו-elementFromPoint החזיר קישור מתוך מגירה סגורה.

    ⚠️ לכן: שום שכבת overlay מסוג `fixed inset-0` לא תסתמך על exit
    animation. רינדור מותנה מסיר את האלמנט מיידית ואמין.
  */
  const OVERLAY_OWNERS = [
    join('components', 'ui', 'AccessibilityWidget.tsx'),
    join('components', 'ui', 'ConsentPreferencesModal.tsx'),
    join('components', 'home', 'BeforeAfterSection.tsx'),
    join('components', 'gallery', 'Lightbox.tsx'),
    join('components', 'layout', 'Navbar.tsx'),
  ]
  /*
   * ⚠️ הבדיקה מכוונת ל**שכבות** בלבד — אלמנט motion שהוא position:fixed.
   * תפריטים נפתחים קטנים בתוך ה-navbar (absolute top-full, רוחב 180-288)
   * ממשיכים להשתמש ב-exit בלגיטימיות: גם אם אחד מהם ייתקע הוא יושב בתוך
   * אזור הכותרת ואינו מסוגל לבלוע את הדף. שער גורף על כל exit בקובץ היה
   * מכריח להסיר גם אותם בלי שום סיבה.
   */
  for (const f of OVERLAY_OWNERS) {
    const clean = stripComments(src(f))
    const openTags = clean.match(/<motion\.[a-zA-Z]+[\s\S]*?>/g) || []
    const stuckable = openTags.filter((t) => /className=(?:"|\{`|\{cn\()?[^>]*\bfixed\b/.test(t) && /\bexit=/.test(t))
    chk(`${f.split('/').pop()} — שום שכבת fixed לא נשענת על exit animation`,
      stuckable.length === 0,
      stuckable.map((t) => t.slice(0, 60).replace(/\s+/g, ' ')).join(' | '))
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('4. ניגודיות — טוקנים נגישים, לא הגוון הדקורטיבי')
{
  /*
    🔴 התקלה: brand-rose (#C4847A) שימש כצבע טקסט בכל האתר — 3.03:1 מול
    לבן, מתחת ל-4.5 הנדרשים. brand-gold (#C9A96E) היה גרוע יותר: 2.1:1.
    ירוק הוואטסאפ (#25D366) עם טקסט/אייקון לבן נתן 1.98:1 — נכשל גם
    בדרישה המקילה של 3:1 לרכיבים לא-טקסטואליים.
  */
  const tw = src('tailwind.config.ts')
  for (const token of ["'rose-text'", "'gold-text'", "'whatsapp-dark'"]) {
    chk(`טוקן נגיש מוגדר: ${token}`, tw.includes(token))
  }

  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const hexOf = (name) => (tw.match(new RegExp(`'?${name}'?:\\s*'(#[0-9A-Fa-f]{6})'`)) || [])[1]

  const WHITE = '#FFFFFF', CREAM = '#FAF7F5', LINEN = '#EDE8DF', DARK = '#2C1810'
  for (const [name, bgs] of [
    ['rose-text', { WHITE, CREAM, LINEN }],
    ['gold-text', { WHITE, CREAM, LINEN }],
    ['whatsapp-dark', { WHITE }],
    ['muted', { WHITE, CREAM }],
    ['medium', { WHITE, CREAM }],
  ]) {
    const hex = hexOf(name)
    for (const [bgName, bg] of Object.entries(bgs)) {
      const r = ratio(hex, bg)
      chk(`${name} על ${bgName} ≥ 4.5:1`, r >= 4.5, `${r.toFixed(2)}:1`)
    }
  }
  // זהב על רקע כהה הוא המקרה ההפוך — שם דווקא הגוון הבהיר הוא הנגיש.
  chk('gold על רקע כהה ≥ 4.5:1', ratio(hexOf('gold'), DARK) >= 4.5, `${ratio(hexOf('gold'), DARK).toFixed(2)}:1`)

  /*
    ⚠️ שער נגד נסיגה: ירוק הוואטסאפ הגולמי לא ישמש שוב כצבע טקסט,
    ולא כרקע שנושא טקסט לבן.
  */
  const greenText = ALL_TSX.filter((f) => /text-\[#25D366\]/i.test(src(f)))
  chk('אין text-[#25D366] — הירוק הגולמי אינו צבע טקסט', greenText.length === 0, greenText.join(', '))
  const greenOnWhite = ALL_TSX.filter((f) => /bg-\[#25D366\][^"']*text-white/i.test(src(f)))
  chk('אין bg-[#25D366] עם טקסט לבן', greenOnWhite.length === 0, greenOnWhite.join(', '))
}

// ════════════════════════════════════════════════════════════════════════════
section('5. מבנה כותרות ו-ARIA')
{
  /*
    🔴 התקלה: הפוטר השתמש ב-h3 בלי h2 לפניו, ולכן כל עמוד שתוכנו נגמר
    ב-h1 יצר דילוג h1→h3. בנוסף BlogCard רינדר תמיד h3 — גם ב-/blog,
    שם הכרטיסים יושבים ישירות מתחת ל-h1.
  */
  const footer = stripComments(src(join('components', 'layout', 'Footer.tsx')))
  chk('כותרות עמודות הפוטר הן h2 (בלי דילוג רמה)', !/<h3/.test(footer) && /<h2/.test(footer))

  const card = stripComments(src(join('components', 'blog', 'BlogCard.tsx')))
  chk('BlogCard מקבל רמת כותרת כ-prop', /headingLevel\?: 2 \| 3/.test(card))
  chk('/blog מעביר headingLevel={2}', /headingLevel=\{2\}/.test(stripComments(src(join('app', 'blog', 'page.tsx')))))

  /*
    🔴 התקלה: BeforeAfterSlider עטף את עצמו ב-role="img". תוכן של role="img"
    נחשב פרזנטציוני, ולכן ה-role="slider" שבתוכו נעלם מעץ הנגישות — הפקד
    פשוט לא היה קיים עבור קורא מסך.
  */
  const slider = stripComments(src(join('components', 'gallery', 'BeforeAfterSlider.tsx')))
  chk('BeforeAfterSlider אינו role="img" עוטף פקד', !/role="img"/.test(slider))
  chk('המחוון נשאר role="slider" עם ערכים', /role="slider"/.test(slider) && /aria-valuenow=/.test(slider) && /aria-valuetext=/.test(slider))

  /*
    🔴 התקלה: ה-live region של הלייטבוקס עטף רק נקודות aria-hidden —
    כלומר הכריז מחרוזת ריקה, ומעבר בין תמונות לא נשמע כלל.
  */
  const lightbox = stripComments(src(join('components', 'gallery', 'Lightbox.tsx')))
  chk('הלייטבוקס מכריז מעבר בין תמונות בטקסט אמיתי',
    /className="sr-only" aria-live="polite"/.test(lightbox) && /תמונה \$\{/.test(lightbox))
}

// ════════════════════════════════════════════════════════════════════════════
section('6. ווידג\'ט הנגישות — בלי מתגים ריקים')
{
  /*
    🔴 התקלה: המתג "קריינות מסך" הוסיף את המחלקה a11y-screen-reader לגוף
    המסמך. למחלקה הזו אין שום כלל CSS ואף קוד אינו קורא אותה — כלומר המתג
    נדלק, נשמר, ולא עשה דבר, תוך שהוא מבטיח "הפעלת תמיכה בקורא מסך".
  */
  const widget = stripComments(src(join('components', 'ui', 'AccessibilityWidget.tsx')))
  const css = src(join('app', 'globals.css'))

  chk('המתג הריק "קריינות מסך" הוסר', !/'screen-reader'/.test(widget))

  // ⚠️ שער כללי: לכל מחלקת a11y-* שהווידג'ט מפעיל חייב להיות כלל CSS בפועל.
  const classes = [...widget.matchAll(/cssClass: '(a11y-[a-z-]+)'/g)].map((m) => m[1])
  chk('נמצאו מתגי נגישות לבדיקה', classes.length >= 4, classes.join(', '))
  for (const c of classes) {
    chk(`למחלקה ${c} יש כלל CSS אמיתי`, css.includes(`.${c}`))
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('7. הצהרת הנגישות תואמת למצב בפועל')
{
  // ⚠️ ההערות בקוד מסבירות *למה* נוסחים הוסרו ומצטטות אותם. הבדיקה חייבת
  // להסתכל על הטקסט שמוצג בפועל, אחרת ההסבר עצמו מפיל אותה.
  const decl = stripComments(src(join('components', 'accessibility', 'AccessibilityContent.tsx')))
  /*
    ⚠️ ההצהרה היא מסמך משפטי. סעיף שמבטיח התאמה שאינה קיימת חושף את העסק
    בדיוק כמו היעדר ההתאמה. שני הנוסחים למטה הוסרו כי לא היו נכונים:
    "44×44" (הדרישה בתקן היא 24×24, וחלק מהפקדים היו מתחת גם לזה), ו-
    "מגבלה: הגלריה אינה מכריזה על החלפת תמונה" — שתוקנה בפועל.
  */
  chk('ההצהרה אינה מבטיחה יעדי נגיעה 44×44', !/44×44/.test(decl))
  chk('ההצהרה מצהירה על 24×24 לפי WCAG 2.2', /24×24/.test(decl))
  chk('הוסרה המגבלה על הכרזת הגלריה (תוקנה בפועל)', !/אינה מכריזה אוטומטית/.test(decl))
  chk('ההצהרה מזכירה לכידת focus ו-Escape בחלונות קופצים', /Escape/.test(decl) && /focus/.test(decl))
  chk('תאריך העדכון אינו מיושן', /אוגוסט 2026/.test(decl))
}

// ════════════════════════════════════════════════════════════════════════════
section('8. הבדיקות עצמן — בלי רשת ובלי DB')
{
  /*
    ⚠️ נבדק לפי ה-imports ולא לפי חיפוש מחרוזות בגוף הקובץ: הבדיקות כאן
    מחפשות בעצמן מחרוזות כמו "fetch(" בתוך קוד האתר, ולכן שער מבוסס
    substring היה נכשל על עצמו.
  */
  const self = readFileSync(new URL(import.meta.url), 'utf8')
  const imports = [...self.matchAll(/^import[\s\S]*?from '([^']+)'/gm)].map((m) => m[1])
  chk('🔒 מייבא רק מודולים מובנים של Node', imports.every((i) => i.startsWith('node:')), imports.join(', '))
  /*
   * ⚠️ הדפוסים נבנים מחלקים בזמן ריצה. ביטוי רגולרי שכתוב כאן כליטרל
   * מופיע בקוד המקור של הקובץ הזה עצמו — ולכן חיפוש שלו בקובץ תמיד
   * יימצא, והשער היה נכשל על עצמו בלי קשר למה שהקוד באמת עושה.
   */
  const netCall = new RegExp('\\b' + 'fetch' + '\\s*\\(')
  const dbRef = new RegExp(['@sup', 'abase'].join('') + '|' + ['create', 'Client'].join('') + '\\s*\\(')
  chk('🔒 אין קריאות רשת', !netCall.test(self.replace(/'[^']*'/g, "''")))
  chk('🔒 אין גישה ל-DB', !dbRef.test(self.replace(/'[^']*'/g, "''")))
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass}/${pass + fail} עברו`)
process.exit(fail === 0 ? 0 : 1)
