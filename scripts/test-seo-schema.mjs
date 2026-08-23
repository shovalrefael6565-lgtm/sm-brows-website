/**
 * ROUND A1 — נעילת התיקונים של ה-SEO/GEO audit.
 *
 * כל בדיקה כאן נכתבה מול תקלה שנמצאה בפועל ב-production, לא מול תרחיש
 * תיאורטי. הקובץ קיים כדי שהתקלות האלה לא יחזרו בשקט.
 *
 * מכסה:
 *   1. absoluteUrl — לא משרשר SITE_URL ל-URL שכבר מוחלט.
 *      התקלה: `image: ${SITE_URL}${post.image}` ותמונות הבלוג הן Unsplash,
 *      כך שכל BlogPosting בפרודקשן נשא
 *      "https://smbrows.co.ilhttps://images.unsplash.com/...".
 *   2. אף קובץ מקור לא מחזיר את דפוס השרשור הזה.
 *   3. האקורדיונים מרנדרים תשובות תמיד.
 *      התקלה: `{isOpen && …}` עם openKey=null — 17 תשובות ב-/faq ו-9
 *      ב-/services לא היו ב-HTML כלל, לא ב-SSR ולא אחרי hydration.
 *   4. FAQPage מתאר אחד-לאחד את התוכן הגלוי — שניהם מ-lib/faq.ts.
 *   5. גרף הישויות: @id יציב אחד לעסק, בלי ישויות משוכפלות.
 *   6. sitemap לא חותם lastModified בזמן הבנייה.
 *   7. h1 יחיד בדף הבית, והטקסט מתחלץ עם רווחים.
 *   8. /gallery מופנה 308 ב-next.config, וה-route נמחק.
 *   9. כל עמוד ציבורי מגדיר openGraph משלו (Next יורש את של ה-layout
 *      במלואו כשהעמוד לא מגדיר — ראה generate-metadata.md).
 *
 * לא נדרש שרת רץ ולא בסיס נתונים.
 *
 * הרצה:  npm run test:seo-schema
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { absoluteUrl, SITE_URL, BUSINESS_ID, WEBSITE_ID, PERSON_ID, PHONE_E164, PHONE_NUMBER, STREET_ADDRESS } from '../lib/utils.ts'
import { REVIEW_QUOTE_COUNT } from './seo-fixtures.mjs'
import { FAQ_SECTIONS } from '../lib/faq.ts'
import { breadcrumbJsonLd } from '../lib/breadcrumbs.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(72)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * מסיר תגובות לפני סריקה.
 *
 * ⚠️ נדרש: התיקונים בפאס הזה מתועדים בתגובות שמצטטות את הקוד השבור
 * ("היה כאן {isOpen && …}", "ייצר smbrows.co.ilhttps://..."). בלי הסרת
 * תגובות הטסט נכשל בדיוק על ההסבר למה הוא קיים.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
}
const readCode = (rel) => stripComments(read(rel))

// ─── 1. absoluteUrl ─────────────────────────────────────────────────────────
section('absoluteUrl — הבאג שייצר smbrows.co.ilhttps://')

const UNSPLASH = 'https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?w=800'
chk('URL מוחלט חוזר בלי שינוי', absoluteUrl(UNSPLASH) === UNSPLASH)
chk('http:// מוחלט חוזר בלי שינוי', absoluteUrl('http://x.com/a.png') === 'http://x.com/a.png')
chk('נתיב יחסי מקבל SITE_URL', absoluteUrl('/hero.webp') === `${SITE_URL}/hero.webp`)
chk('נתיב בלי לוכסן מוביל מקבל לוכסן', absoluteUrl('hero.webp') === `${SITE_URL}/hero.webp`)
chk(
  'התוצאה לעולם לא מכילה דומיין כפול',
  ![UNSPLASH, '/hero.webp', 'hero.webp'].some((v) => absoluteUrl(v).includes('smbrows.co.ilhttp')),
)

// ─── 2. דפוס השרשור לא קיים בשום מקור ───────────────────────────────────────
section('דפוס השרשור המסוכן לא חזר לקוד')

const SCAN_DIRS = ['app', 'components', 'lib']
const IGNORE = new Set(['node_modules', '.next', '.git', '.agents', '.claude'])
function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collect(full))
    else if (/\.(tsx?|mjs)$/.test(entry)) out.push(full)
  }
  return out
}
const sources = SCAN_DIRS.flatMap((d) => collect(path.join(ROOT, d)))

const concatOffenders = sources.filter((f) => {
  const s = stripComments(readFileSync(f, 'utf8'))
  // ${SITE_URL}${...image...} — שרשור של קבוע הדומיין לערך שעלול להיות מוחלט
  return /\$\{SITE_URL\}\$\{[^}]*[Ii]mage[^}]*\}/.test(s)
})
chk('אין `${SITE_URL}${...image}` בשום קובץ', concatOffenders.length === 0,
  concatOffenders.map((f) => path.relative(ROOT, f)).join(', '))

const literalOffenders = sources.filter((f) => stripComments(readFileSync(f, 'utf8')).includes('smbrows.co.ilhttp'))
chk('אין מחרוזת "smbrows.co.ilhttp" בקוד', literalOffenders.length === 0)

const blogPage = readCode('app/blog/[slug]/page.tsx')
chk('BlogPosting.image משתמש ב-absoluteUrl', /image:\s*absoluteUrl\(post\.image\)/.test(blogPage))

// ─── 3. האקורדיונים מרנדרים תמיד ────────────────────────────────────────────
section('תשובות ה-FAQ קיימות ב-DOM גם כשהאקורדיון סגור')

const accordions = {
  'components/faq/FaqContent.tsx': readCode('components/faq/FaqContent.tsx'),
  'components/services/ServiceFaqSection.tsx': readCode('components/services/ServiceFaqSection.tsx'),
}
for (const [file, src] of Object.entries(accordions)) {
  const short = path.basename(file)
  chk(`${short}: אין רינדור מותנה {isOpen && …}`, !/\{\s*isOpen\s*&&/.test(src))
  chk(`${short}: אין AnimatePresence סביב הפאנל`, !src.includes('AnimatePresence'))
  chk(`${short}: הקיפול ב-gridTemplateRows`, src.includes('gridTemplateRows'))
  chk(`${short}: aria-controls קיים`, src.includes('aria-controls={panelId}'))
  chk(`${short}: aria-expanded קיים`, src.includes('aria-expanded={isOpen}'))
  chk(`${short}: לפאנל יש role+aria-labelledby`,
    src.includes('role="region"') && src.includes('aria-labelledby={buttonId}'))
}

// ─── 4. FAQPage משקף את התוכן הגלוי ─────────────────────────────────────────
section('FAQPage — התאמה אחד-לאחד לתוכן הנראה')

const faqPage = readCode('app/faq/page.tsx')
const faqComponent = accordions['components/faq/FaqContent.tsx']

chk('lib/faq.ts הוא המקור של הקומפוננטה', faqComponent.includes("from '@/lib/faq'"))
chk('lib/faq.ts הוא המקור של ה-schema', faqPage.includes("from '@/lib/faq'"))
chk('הקומפוננטה לא מגדירה FAQ משלה', !/const FAQ_(DATA|SECTIONS)\s*[:=]/.test(faqComponent))

const questions = FAQ_SECTIONS.flatMap((s) => s.items)
chk('יש שאלות ב-FAQ_SECTIONS', questions.length > 0, `(${questions.length})`)
chk('לכל שאלה יש תשובה לא ריקה', questions.every((i) => i.q?.trim() && i.a?.trim()))
chk('אין שאלות כפולות', new Set(questions.map((i) => i.q)).size === questions.length)

// בניית ה-schema באותו אופן שהעמוד בונה אותו, ואימות שהוא JSON תקין
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/faq#faq`,
  inLanguage: 'he-IL',
  mainEntity: questions.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
}
let faqRoundTrip = null
try { faqRoundTrip = JSON.parse(JSON.stringify(faqJsonLd)) } catch { /* נשאר null */ }
chk('FAQPage עובר JSON.parse', faqRoundTrip !== null)
chk('FAQPage: מספר השאלות זהה לתוכן', faqRoundTrip?.mainEntity.length === questions.length)
chk('FAQPage: לכל Question יש acceptedAnswer.text',
  faqRoundTrip?.mainEntity.every((q) => q.acceptedAnswer?.text?.length > 0))

// ─── 5. גרף הישויות ────────────────────────────────────────────────────────
section('גרף הישויות — ישות עסקית אחת')

const layout = readCode('app/layout.tsx')
const coursePage = readCode('app/course/page.tsx')

chk('BUSINESS_ID הוא fragment ולא עמוד', BUSINESS_ID === `${SITE_URL}/#business`)
chk('WEBSITE_ID הוא fragment ולא עמוד', WEBSITE_ID === `${SITE_URL}/#website`)
chk('ה-layout פולט @graph', layout.includes("'@graph'"))
chk('BeautySalon נושא את BUSINESS_ID', /'@type': 'BeautySalon',\s*\n\s*'@id': BUSINESS_ID/.test(layout))
chk('WebSite נושא את WEBSITE_ID', /'@type': 'WebSite',\s*\n\s*'@id': WEBSITE_ID/.test(layout))
chk('WebSite.publisher מפנה ל-@id של העסק', layout.includes("publisher: { '@id': BUSINESS_ID }"))
chk('אין Organization משוכפל ב-layout', !layout.includes("'@type': 'Organization'"))
chk('Course.provider מפנה ל-@id', coursePage.includes("provider: { '@id': BUSINESS_ID }"))
chk('אין Organization משוכפל ב-/course', !coursePage.includes("'@type': 'Organization'"))
chk('BlogPosting.author מפנה ל-@id', blogPage.includes("author: { '@id': PERSON_ID }"))
chk('BlogPosting.publisher מפנה ל-@id', blogPage.includes("publisher: { '@id': BUSINESS_ID }"))
chk('אין Organization משוכפל בפוסט', !blogPage.includes("'@type': 'Organization'"))

// כל '@id' מילולי בקוד המקור מוגדר פעם אחת בלבד כישות (עם '@type' צמוד)
const idDefinitions = sources.flatMap((f) => {
  const s = stripComments(readFileSync(f, 'utf8'))
  return [...s.matchAll(/'@type':\s*'([A-Za-z]+)',\s*\n\s*'@id':\s*([A-Za-z_]+)/g)]
    .map((m) => `${m[2]}`)
})
chk('אף @id לא מוגדר כישות פעמיים', new Set(idDefinitions).size === idDefinitions.length,
  idDefinitions.join(', '))

// טלפון: E.164 ב-schema, תצוגה ללא שינוי
chk('PHONE_E164 בפורמט בינלאומי', /^\+972\d{9}$/.test(PHONE_E164))
chk('E.164 ו-התצוגה הן אותו מספר',
  PHONE_E164.replace('+972', '0') === PHONE_NUMBER.replace(/-/g, ''))
chk('ה-schema משתמש ב-E164', layout.includes('telephone: PHONE_E164'))
chk('התצוגה עדיין PHONE_NUMBER', read('components/layout/Footer.tsx').includes('PHONE_NUMBER'))

// ─── 5b. ROUND B — שובל כישות, ובלי עובדות מומצאות ─────────────────────────
section('ROUND B — Person, פרטיות, ומחירים')

const microTeaser = readCode('components/home/MicrobladingTeaser.tsx')
const testimonials = readCode('components/home/TestimonialsSection.tsx')

chk('PERSON_ID הוא fragment יציב', PERSON_ID === `${SITE_URL}/#shoval`)
chk('Person מוגדר ב-layout', /'@type': 'Person',\s*\n\s*'@id': PERSON_ID/.test(layout))
chk('Person נכנס ל-@graph', layout.includes('personJsonLd'))
chk('Person.worksFor מפנה לעסק', layout.includes("worksFor: { '@id': BUSINESS_ID }"))
chk('העסק מצביע חזרה ל-founder', layout.includes("founder: { '@id': PERSON_ID }"))
chk('Course.instructor הוא שובל', coursePage.includes("instructor: { '@id': PERSON_ID }"))
chk('Course.provider נשאר העסק', coursePage.includes("provider: { '@id': BUSINESS_ID }"))
chk('BlogPosting.author הוא שובל', blogPage.includes("author: { '@id': PERSON_ID }"))
chk('BlogPosting.publisher נשאר העסק', blogPage.includes("publisher: { '@id': BUSINESS_ID }"))
chk('שם המחבר מוצג גם בתוכן הגלוי', blogPage.includes('מאת {PERSON_NAME}'))

/*
  ⚠️ אין להמציא הכשרות. הרשימה הזו היא בדיוק ה-properties שמפתים
  להוסיף לפרופיל מקצועי — ואף אחת מהן לא נמסרה לנו.
*/
const FABRICATION_RISK = ['alumniOf', 'hasCredential', 'award', 'educationalCredentialAwarded', 'memberOf']
for (const prop of FABRICATION_RISK) {
  chk(`אין ${prop} מומצא`, !layout.includes(`${prop}:`))
}

// פרטיות — כתובת הרחוב לא מתפרסמת בשום מקום ציבורי
chk('STREET_ADDRESS עדיין קיים כקבוע פנימי', typeof STREET_ADDRESS === 'string' && STREET_ADDRESS.length > 0)
chk('אך אינו מיובא ל-layout', !layout.includes('STREET_ADDRESS'))
chk('אין streetAddress ב-JSON-LD', !layout.includes('streetAddress'))
/*
  ⚠️ שני חריגים מכוונים:
    lib/utils.ts            — STREET_ADDRESS מוגדר שם כקבוע פנימי.
    lib/whatsappTemplates.ts — הכתובת המלאה נמסרת ללקוחה בהודעת אישור
                               התור, וזה בדיוק המקום שבו היא אמורה להימסר.
  כל השאר — כולל כל קומפוננטה שמרנדרת תוכן — חייב להיות נקי.
*/
const publicSources = sources.filter(
  (f) => !f.includes('/lib/utils.ts') && !f.includes('/lib/whatsappTemplates.ts'),
)
const leaks = publicSources.filter((f) => stripComments(readFileSync(f, 'utf8')).includes(STREET_ADDRESS))
chk('כתובת הרחוב המלאה לא מופיעה בשום קומפוננטה', leaks.length === 0,
  leaks.map((f) => path.relative(ROOT, f)).join(', '))

/*
  ⚠️ גם שם הרחוב לבדו, בלי מספר בית, אסור בתוכן ציבורי.
  הוא דלף דרך ה-href של קישור המפה ב-/contact: הטקסט הגלוי היה
  "עיר היין, אשקלון" אבל ה-URL נשא "הכורמים". שער נפרד כי הוא תופס
  את המחרוזת גם בלי המספר.
*/
const STREET_NAME_ONLY = STREET_ADDRESS.replace(/\s*\d+\s*$/, '')
const streetLeaks = publicSources.filter(
  (f) => stripComments(readFileSync(f, 'utf8')).includes(STREET_NAME_ONLY),
)
chk(`שם הרחוב ("${STREET_NAME_ONLY}") לא מופיע בשום מקור ציבורי`, streetLeaks.length === 0,
  streetLeaks.map((f) => path.relative(ROOT, f)).join(', '))
chk('קישור המפה בנוי מ-LOCATION', readCode('components/contact/ContactContent.tsx')
  .includes('encodeURIComponent(LOCATION)'))

// מחירים — רק מה שגלוי
chk('אין מחיר מיקרובליידינג ב-JSON-LD', !/name: 'מיקרובליידינג' \}, priceCurrency/.test(layout))
chk("אין '1800' בשום JSON-LD", !layout.includes("'1800'"))
const servicesSrc = readCode('app/services/page.tsx') + readCode('lib/data.ts')
for (const price of ['70', '250']) {
  chk(`המחיר ₪${price} שנשאר ב-schema אכן גלוי באתר`, servicesSrc.includes(price))
}

// areaServed — אזור, לא סניפים
for (const city of ['אשקלון', 'אשדוד', 'קריית גת', 'שדרות', 'נתיבות']) {
  chk(`areaServed כולל ${city}`, layout.includes(`name: '${city}'`))
}
chk('אין addressLocality מלבד אשקלון',
  (layout.match(/addressLocality: '([^']+)'/g) || []).every((m) => m.includes('אשקלון')))

// תוכן גלוי על שובל
chk('שובל מאירה מופיעה בטקסט גלוי', microTeaser.includes('שובל מאירה'))
chk('S.M BROWS מקושר אליה באותו משפט', microTeaser.includes('מייסדת S.M BROWS'))
chk('אשקלון מופיעה באותו הקשר', microTeaser.includes('אשקלון'))
chk('חמש שנות ניסיון בטקסט ולא כ-property', microTeaser.includes('חמש שנים') && !layout.includes('yearsOfExperience'))

// המלצות — טקסט אמיתי, בלי PII, בלי Review schema
chk('יש ציטוטים מתומללים', testimonials.includes('quote:'))
const quoteLines = (testimonials.match(/quote: '/g) || []).length
chk('מספר הציטוטים תואם לצפוי', quoteLines === REVIEW_QUOTE_COUNT, `(${quoteLines})`)
chk('הציטוט מוצג כ-blockquote', testimonials.includes('<blockquote'))
chk('וכ-figcaption במודאל', testimonials.includes('<figcaption'))
chk('⚠️ אין Review schema', !testimonials.includes("'@type': 'Review'") && !layout.includes("'@type': 'Review'"))
chk('⚠️ אין aggregateRating', !testimonials.includes('aggregateRating') && !layout.includes('aggregateRating'))
chk('⚠️ אין ratingValue מומצא', !testimonials.includes('ratingValue') && !layout.includes('ratingValue'))
/*
  PII — מספרי טלפון בציטוטים. הצילומים הם צ'אטים פרטיים, ותמלול
  שגורר איתו מספר או שם משפחה הופך המלצה לחשיפת מידע אישי.
*/
chk('אין מספרי טלפון בציטוטים', !/quote: '[^']*\d{9,}/.test(testimonials))
chk('אין תבנית טלפון ישראלי בציטוטים', !/quote: '[^']*0\d{1,2}-?\d{7}/.test(testimonials))

// ─── 6. sitemap ────────────────────────────────────────────────────────────
section('sitemap — בלי תאריכים מומצאים')

const sitemap = readCode('app/sitemap.ts')
chk('אין lastModified בזמן בנייה', !/lastModified:\s*now/.test(sitemap))
chk('אין `const now = new Date()`', !/const now = new Date\(\)/.test(sitemap))
chk('פוסטי הבלוג שומרים תאריך אמיתי', /lastModified: new Date\(post\.date\)/.test(sitemap))
chk('/gallery לא ב-sitemap', !sitemap.includes('/gallery'))

// ─── 7. h1 בדף הבית ────────────────────────────────────────────────────────
section('דף הבית — h1 יחיד וטקסט שמתחלץ נכון')

const hero = readCode('components/home/Hero.tsx')
const h1Count = (hero.match(/<motion\.h1/g) || []).length
chk('בדיוק <h1> אחד ב-Hero', h1Count === 1, `(נמצאו ${h1Count})`)
chk('לתאום יש role=heading + aria-level', hero.includes('role="heading"') && hero.includes('aria-level={1}'))
chk('הרווחים מפורשים בכותרת', hero.includes("{'גבות '}") && hero.includes("{' בעד עצמן'}"))

// ─── 8. /gallery ───────────────────────────────────────────────────────────
section('/gallery — 308 קבוע')

const nextConfig = readCode('next.config.mjs')
chk('redirects() מוגדר', /async redirects\(\)/.test(nextConfig))
chk('/gallery → / עם permanent: true',
  /source:\s*'\/gallery',\s*destination:\s*'\/',\s*permanent:\s*true/.test(nextConfig))
chk('app/gallery נמחק', !existsSync(path.join(ROOT, 'app/gallery')))

// ─── 8b. דומיין הכפילות ────────────────────────────────────────────────────
section('vercel.app — noindex על הדומיין המשני בלבד')

/*
  ⚠️ הכלל הזה מסוכן אם הוא לא מדויק: `has` שגוי יוציא את כל האתר
  מהאינדקס. השערים כאן מוודאים שהוא מכוון לדומיין המשני ולא לקנוני.
*/
chk('קיים כלל X-Robots-Tag', nextConfig.includes("key: 'X-Robots-Tag'"))
chk('הערך הוא noindex', /value: 'noindex, nofollow'/.test(nextConfig))
chk('מותנה ב-host', /has: \[\{ type: 'host', value: 'sm-brows-website\.vercel\.app' \}\]/.test(nextConfig))
chk('⚠️ הדומיין הקנוני אינו מופיע בשום תנאי host',
  !/type: 'host', value: 'smbrows\.co\.il'/.test(nextConfig))
chk('⚠️ אין כלל noindex ללא תנאי host', (() => {
  // כל בלוק שמכיל X-Robots-Tag חייב להכיל גם has: host
  const blocks = nextConfig.split(/\{\s*source:/).filter((b) => b.includes('X-Robots-Tag'))
  return blocks.length > 0 && blocks.every((b) => b.includes("type: 'host'"))
})())

// ─── 9. OpenGraph לכל עמוד ציבורי ──────────────────────────────────────────
section('OpenGraph — כל עמוד ציבורי מגדיר משלו')

const OG_PAGES = {
  '/': 'app/page.tsx',
  '/services': 'app/services/page.tsx',
  '/course': 'app/course/page.tsx',
  '/faq': 'app/faq/page.tsx',
  '/blog': 'app/blog/page.tsx',
  '/booking': 'app/booking/page.tsx',
  '/contact': 'app/contact/page.tsx',
  '/shop': 'app/shop/layout.tsx',
}
for (const [route, file] of Object.entries(OG_PAGES)) {
  const src = read(file)
  const hasOg = /openGraph:\s*\{/.test(src)
  const hasImages = /images:\s*\[/.test(src)
  const hasLocale = /locale:\s*'he_IL'/.test(src)
  chk(`${route.padEnd(10)} openGraph + images + locale`, hasOg && hasImages && hasLocale,
    hasOg ? (hasImages ? (hasLocale ? '' : 'חסר locale') : 'חסר images') : 'חסר openGraph')
}
// כל עמוד ציבורי מצהיר canonical מפורש
for (const [route, file] of Object.entries(OG_PAGES)) {
  chk(`${route.padEnd(10)} canonical מפורש`, /alternates:\s*\{\s*canonical:/.test(read(file)))
}

// ─── 10. BreadcrumbList ────────────────────────────────────────────────────
section('BreadcrumbList — היררכיה אמיתית בלבד')

const crumbs = breadcrumbJsonLd([{ name: 'מאמרים', path: '/blog' }, { name: 'פוסט', path: '/blog/x' }])
chk('הפריט הראשון הוא הבית', crumbs.itemListElement[0].name === 'בית')
chk('הבית מצביע לשורש בלי לוכסן כפול', crumbs.itemListElement[0].item === SITE_URL)
chk('position רץ מ-1 ברצף',
  crumbs.itemListElement.every((c, i) => c.position === i + 1))
chk('כל item הוא URL מוחלט',
  crumbs.itemListElement.every((c) => c.item.startsWith(SITE_URL)))
chk('BreadcrumbList עובר JSON.parse', (() => {
  try { JSON.parse(JSON.stringify(crumbs)); return true } catch { return false }
})())
chk('אין breadcrumb בדף הבית', !read('app/page.tsx').includes('breadcrumbJsonLd'))
for (const f of ['app/services/page.tsx', 'app/course/page.tsx', 'app/faq/page.tsx',
                 'app/blog/page.tsx', 'app/blog/[slug]/page.tsx']) {
  chk(`breadcrumb ב-${path.relative('app', f)}`, read(f).includes('breadcrumbJsonLd'))
}

// ─── 11. קישורים פנימיים ל-/booking ────────────────────────────────────────
section('קישורים פנימיים ל-/booking')

const linkSources = {
  '/faq': 'components/faq/FaqContent.tsx',
  '/contact': 'components/contact/ContactContent.tsx',
  'blog post': 'app/blog/[slug]/page.tsx',
}
for (const [name, file] of Object.entries(linkSources)) {
  chk(`${name.padEnd(10)} מקשר ל-/booking`, read(file).includes('href="/booking"'))
}

// ─── סיכום ─────────────────────────────────────────────────────────────────
const passed = results.filter(Boolean).length
console.log(`\n${'─'.repeat(64)}`)
console.log(`${passed}/${results.length} בדיקות עברו`)
if (passed !== results.length) {
  console.error('✗ test-seo-schema נכשל')
  process.exit(1)
}
console.log('✓ כל בדיקות ה-SEO/schema עברו')
