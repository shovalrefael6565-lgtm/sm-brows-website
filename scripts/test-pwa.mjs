/**
 * שלב 9 — בדיקת תקינות ה-Web App / PWA.
 *
 * הבדיקה סטטית לחלוטין: לא נדרש שרת רץ, לא בסיס נתונים ולא רשת. היא
 * מאמתת את שלושת הדברים שבאמת שוברים התקנה בפרודקשן, ושאף אחד מהם לא
 * מתגלה ב-lint/typecheck:
 *
 *   1. המניפסט מכיל את מה ש-Chrome דורש ל-installability (name/short_name,
 *      start_url, display, אייקון 192 ואייקון 512, purpose maskable).
 *   2. כל קובץ שהמניפסט או ה-<link> מצביעים עליו באמת קיים ב-public/,
 *      הוא PNG תקין, ובדיוק במידות שהוצהרו — כולל 10 מסכי הפתיחה של iOS.
 *      (iOS שלא מוצא את הקובץ פשוט מציג מסך ריק, בלי שום שגיאה.)
 *   3. אף נכס PWA אינו gitignored — כלומר כולם יגיעו ל-Vercel.
 *
 * בנוסף: apple-touch-icon חייב להיות אטום (iOS מדביק שקיפות על שחור),
 * צבעי המניפסט חייבים להתאים ל-themeColor של app/layout.tsx, ואסור
 * שיוזרק service worker (שלב 9 במפורש בלי offline caching).
 *
 * הרצה:  npm run test:pwa
 */

import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { APPLE_SPLASH, splashSrc, splashMedia } from '../lib/pwa'
import * as manifestMod from '../app/manifest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = path.join(ROOT, 'public')

const results = []
function chk(name, ok, extra = '') {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(66)}${extra}`)
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 74 - title.length))}`)
}

/** קורא IHDR של PNG — מחזיר { width, height } או null אם לא PNG תקין */
function pngSize(file) {
  const buf = readFileSync(file)
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length < 33 || !buf.subarray(0, 8).equals(sig)) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function assetExists(rel, expected) {
  const abs = path.join(PUBLIC, rel.replace(/^\//, ''))
  if (!existsSync(abs)) return chk(`קיים: ${rel}`, false, 'חסר בדיסק')
  const size = pngSize(abs)
  if (!size) return chk(`קיים: ${rel}`, false, 'לא PNG תקין')
  const ok = !expected || (size.width === expected.w && size.height === expected.h)
  chk(`קיים: ${rel}`, ok, `${size.width}×${size.height}${ok ? '' : ` (צפוי ${expected.w}×${expected.h})`}`)
}

const layout = readFileSync(path.join(ROOT, 'app', 'layout.tsx'), 'utf8')
const nextConfig = readFileSync(path.join(ROOT, 'next.config.mjs'), 'utf8')
// tsx עוטף מודול TS עם export default בשכבת interop נוספת כשמייבאים
// אותו מ-.mjs — לכן מקלפים עד שמגיעים לפונקציה עצמה.
let manifestFn = manifestMod
while (manifestFn && typeof manifestFn !== 'function') manifestFn = manifestFn.default
const m = manifestFn()

/* ─────────────────────────── 1. המניפסט ─────────────────────────── */
section('manifest — installability')

chk('name קיים', typeof m.name === 'string' && m.name.length > 0, m.name)
chk('short_name קיים ולא ארוך מדי (≤12 תווים)',
  typeof m.short_name === 'string' && m.short_name.length > 0 && m.short_name.length <= 12,
  m.short_name)
chk('start_url = /', m.start_url === '/', m.start_url)
chk('scope = / (כל האתר בתוך האפליקציה)', m.scope === '/', m.scope)
chk("display = standalone", m.display === 'standalone', m.display)
chk('lang=he ו-dir=rtl', m.lang === 'he' && m.dir === 'rtl', `${m.lang}/${m.dir}`)
chk('id קיים (זהות יציבה לאפליקציה)', typeof m.id === 'string' && m.id.length > 0, m.id)

const icons = m.icons ?? []
const any192 = icons.find((i) => i.sizes === '192x192' && (i.purpose ?? 'any').includes('any'))
const any512 = icons.find((i) => i.sizes === '512x512' && (i.purpose ?? 'any').includes('any'))
const mask192 = icons.find((i) => i.sizes === '192x192' && String(i.purpose).includes('maskable'))
const mask512 = icons.find((i) => i.sizes === '512x512' && String(i.purpose).includes('maskable'))
chk('אייקון 192×192 purpose=any', !!any192, any192?.src ?? '')
chk('אייקון 512×512 purpose=any', !!any512, any512?.src ?? '')
chk('אייקון 192×192 purpose=maskable', !!mask192, mask192?.src ?? '')
chk('אייקון 512×512 purpose=maskable (אנדרואיד — אייקון אדפטיבי)', !!mask512, mask512?.src ?? '')
chk('כל אייקון הוא image/png', icons.every((i) => i.type === 'image/png'))

const CREAM = '#FAF7F5'
chk('theme_color = brand-cream', String(m.theme_color).toUpperCase() === CREAM, String(m.theme_color))
chk('background_color = brand-cream (מסך הפתיחה בצבע האתר)',
  String(m.background_color).toUpperCase() === CREAM, String(m.background_color))
chk('theme_color זהה ל-viewport.themeColor ב-layout',
  layout.includes(`themeColor: '${CREAM.toLowerCase()}'`) || layout.includes(`themeColor: '${CREAM}'`))

for (const s of m.shortcuts ?? []) {
  const dir = path.join(ROOT, 'app', s.url.replace(/^\//, ''))
  chk(`קיצור "${s.name}" מצביע לעמוד קיים`, existsSync(path.join(dir, 'page.tsx')), s.url)
}

/* ─────────────────────── 2. קיום הנכסים בפועל ─────────────────────── */
section('נכסים — כל מה שמוצהר באמת קיים ובמידות הנכונות')

for (const i of icons) {
  const [w, h] = String(i.sizes).split('x').map(Number)
  assetExists(i.src, { w, h })
}
assetExists('/apple-touch-icon.png', { w: 180, h: 180 })
assetExists('/favicon-64.png')
for (const s of APPLE_SPLASH) assetExists(splashSrc(s), { w: s.w, h: s.h })

// iOS מדביק שקיפות על רקע שחור — apple-touch-icon חייב להיות אטום לגמרי.
{
  const buf = readFileSync(path.join(PUBLIC, 'apple-touch-icon.png'))
  const colorType = buf[25]
  let opaque = colorType !== 6 && colorType !== 4
  if (!opaque) {
    // RGBA — נבדוק את ערוץ האלפא בפועל דרך המפענח של הסקריפט המייצר
    const { decodePng } = await import('./generate-pwa-assets.mjs')
    const img = decodePng(buf)
    opaque = true
    for (let i = 3; i < img.data.length; i += 4) {
      if (img.data[i] !== 255) { opaque = false; break }
    }
  }
  chk('apple-touch-icon אטום לחלוטין (בלי שקיפות)', opaque)
}

/* ─────────────────── 2ב. גיאומטריה ואיכות של האייקון ─────────────────── */
section('אייקונים — מקור, מרכוז, גודל ואיכות')

{
  const { decodePng } = await import('./generate-pwa-assets.mjs')
  const MASTER = 'pwa-logo-master.png'

  const masterPath = path.join(PUBLIC, MASTER)
  chk('קובץ המאסטר של האייקון קיים', existsSync(masterPath), MASTER)
  const master = decodePng(readFileSync(masterPath))
  chk('המאסטר ריבועי וברזולוציה גבוהה (≥1000px)',
    master.width === master.height && master.width >= 1000, `${master.width}×${master.height}`)
  chk('הסקריפט המייצר קורא מהמאסטר ולא מ-logo.png',
    readFileSync(path.join(ROOT, 'scripts', 'generate-pwa-assets.mjs'), 'utf8')
      .includes(`const MASTER = '${MASTER}'`))

  /**
   * מודד אייקון: התיבה החוסמת של הדיו (כל מה שכהה מהקרם), מרכז המסה,
   * צבע הרקע, ופיקסלים "לבנים" — כלומר בהירים וחסרי גוון, מה שמסמן את
   * שרידי השוליים הלבנים שמחוץ לפינות הכרטיס.
   */
  function measure(rel) {
    const img = decodePng(readFileSync(path.join(PUBLIC, rel.replace(/^\//, ''))))
    const { width: W, height: H, data } = img
    let x0 = W, y0 = H, x1 = -1, y1 = -1
    let sx = 0, sy = 0, sw = 0
    let white = 0, minLum = 255
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const max = Math.max(r, g, b), min = Math.min(r, g, b)
        // רק בפינות — מחוץ למעגל החסום. שם ורק שם חיו השוליים הלבנים,
        // והיצירה עצמה לעולם לא מגיעה לשם. בדיקה על כל הקנבס תפסה
        // הדגשות לבנות לגיטימיות בתוך הזהב של הגבה וב-S.
        if (min >= 246 && max - min <= 6 && Math.hypot(x - W / 2, y - H / 2) > W * 0.5) white++
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        if (lum < minLum) minLum = lum
        if (lum >= 215) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
        const wgt = 215 - lum
        sx += x * wgt; sy += y * wgt; sw += wgt
      }
    }
    const inkRadius = Math.max(
      ...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - W / 2, y - H / 2)),
    ) / W
    return {
      W, H, x0, y0, x1, y1, white, minLum, inkRadius,
      markH: (y1 - y0 + 1) / H,
      bboxCx: (x0 + x1) / 2, bboxCy: (y0 + y1) / 2,
      massCx: sx / sw, massCy: sy / sw,
      corner: [data[0], data[1], data[2]],
    }
  }

  const bg = measure('/apple-touch-icon.png').corner
  const icons = [
    ['/apple-touch-icon.png', 'full'],
    ['/icons/icon-192.png', 'full'],
    ['/icons/icon-512.png', 'full'],
    ['/icons/icon-maskable-192.png', 'maskable'],
    ['/icons/icon-maskable-512.png', 'maskable'],
  ]

  for (const [rel, kind] of icons) {
    const m = measure(rel)
    const name = rel.replace('/icons/', '').replace(/^\//, '')

    // מרכוז: גם מרכז התיבה וגם מרכז המסה בתוך 2.5% מהמרכז.
    const tol = m.W * 0.025
    const d = [Math.abs(m.bboxCx - m.W / 2), Math.abs(m.bboxCy - m.H / 2),
               Math.abs(m.massCx - m.W / 2), Math.abs(m.massCy - m.H / 2)]
    chk(`${name} — ממורכז (תיבה ומסה)`, d.every((v) => v <= tol),
      `${d.map((v) => v.toFixed(1)).join('/')}px, סף ${tol.toFixed(1)}`)

    // גודל: הלוקאפ תופס חלק משמעותי מהאייקון ואינו נראה אבוד בתוך הקרם.
    chk(`${name} — הלוגו ממלא ${(m.markH * 100).toFixed(0)}% מהגובה`,
      m.markH >= 0.5 && m.markH <= 0.75)
    chk(`${name} — לא חתוך (יש שוליים בכל צד)`,
      m.x0 > 0 && m.y0 > 0 && m.x1 < m.W - 1 && m.y1 < m.H - 1,
      `${m.x0}/${m.W - 1 - m.x1}/${m.y0}/${m.H - 1 - m.y1}`)

    // ⚠️ שרידי הלבן שמחוץ לפינות הכרטיס. הם מה שהופיע כרסיסים בהירים
    // בפינות האייקון במסך הבית, ושתי גישות מילוי נכשלו עליהם לפני
    // שהוחלף למילוי גלישה מהפינות. אפס = השוליים נוקו לגמרי.
    chk(`${name} — בלי שרידי רקע לבן בפינות`, m.white === 0, `${m.white} פיקסלים`)

    // הרקע זהה בכל האייקונים — הקרם של הכרטיס עצמו.
    chk(`${name} — רקע אחיד rgb(${bg})`,
      m.corner[0] === bg[0] && m.corner[1] === bg[1] && m.corner[2] === bg[2],
      `rgb(${m.corner})`)

    // חדות: החום הכהה של הלוקאפ שרד את ההקטנה ולא נשטף לאפור.
    chk(`${name} — הלוגו שמר על העומק (הגוון הכהה ביותר ${m.minLum.toFixed(0)})`,
      m.minLum < 120)

    if (kind === 'maskable') {
      chk(`${name} — כל הדיו בתוך מעגל הבטיחות (40%)`,
        m.inkRadius <= 0.4, `רדיוס ${(m.inkRadius * 100).toFixed(1)}%`)
    }
  }

  // הדמיה ישירה של החיתוך שאנדרואיד עושה: אף פיקסל דיו לא נחתך.
  for (const rel of ['/icons/icon-maskable-192.png', '/icons/icon-maskable-512.png']) {
    const img = decodePng(readFileSync(path.join(PUBLIC, rel.replace(/^\//, ''))))
    const { width: W, height: H, data } = img
    let clipped = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.hypot(x - W / 2, y - H / 2) <= W * 0.4) continue
        const i = (y * W + x) * 4
        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 215) clipped++
      }
    }
    chk(`${rel.replace('/icons/', '')} — חיתוך למעגל לא מוריד שום פיקסל לוגו`,
      clipped === 0, `${clipped} פיקסלים`)
  }

  // מסכי הפתיחה נבנים מאותו מאסטר — אותו רקע בדיוק, בלי תפר.
  {
    const sp = decodePng(readFileSync(path.join(PUBLIC, 'icons', 'splash', 'apple-splash-750x1334.png')))
    chk('מסך פתיחה — אותו רקע קרם כמו האייקונים',
      sp.data[0] === bg[0] && sp.data[1] === bg[1] && sp.data[2] === bg[2],
      `rgb(${sp.data[0]},${sp.data[1]},${sp.data[2]})`)
  }
}

/* ────────────────────── 3. תגיות ה-<head> ב-layout ────────────────── */
section('layout — metadata של iOS')

chk('appleWebApp.capable = true (standalone באייפון)',
  /appleWebApp:\s*\{[^}]*capable:\s*true/s.test(layout))
chk('appleWebApp.title = S.M BROWS',
  /appleWebApp:\s*\{[^}]*title:\s*'S\.M BROWS'/s.test(layout))
chk('statusBarStyle מוגדר (סרגל סטטוס תואם לרקע הבהיר)',
  /statusBarStyle:\s*'(default|black)'/.test(layout))
chk('apple-touch-icon מצביע לקובץ הייעודי ולא ל-logo.png',
  layout.includes("url: '/apple-touch-icon.png'") && !/apple:\s*'\/logo\.png'/.test(layout))
chk('מסכי הפתיחה מוזרקים מ-lib/pwa (מקור אמת יחיד)',
  layout.includes("rel: 'apple-touch-startup-image'") && layout.includes('APPLE_SPLASH.map'))
chk('applicationName מוגדר', layout.includes("applicationName: 'S.M BROWS'"))
chk('apple-mobile-web-app-capable ידני (iOS < 15.4 לא מכיר את התקן החדש)',
  layout.includes("'apple-mobile-web-app-capable': 'yes'"))

// שאילתות המדיה חייבות להיות ייחודיות — שתי רשומות זהות אומרות שאחד
// המכשירים לעולם לא יקבל את מסך הפתיחה שלו.
{
  const medias = APPLE_SPLASH.map(splashMedia)
  chk('שאילתות המדיה של מסכי הפתיחה ייחודיות',
    new Set(medias).size === medias.length, `${medias.length} מסכים`)
  chk('כל שאילתת מדיה כוללת device-width/height ו-dpr',
    medias.every((q) => /device-width: \d+px/.test(q) && /device-height: \d+px/.test(q) && /-webkit-device-pixel-ratio: \d/.test(q)))
}

/* ─────────────────────── 4. אין service worker ─────────────────────── */
section('ללא service worker / offline caching (כנדרש בשלב 9)')

{
  const grep = (pattern) => {
    try {
      return execSync(
        `git grep -l -E "${pattern}" -- 'app/**' 'components/**' 'lib/**' 'public/**' || true`,
        { cwd: ROOT, encoding: 'utf8' },
      ).trim()
    } catch { return '' }
  }
  const sw = grep('serviceWorker\\\\.register|navigator\\\\.serviceWorker')
  chk('אין רישום service worker בקוד', sw === '', sw)
  chk('אין קובץ sw.js / workbox ב-public', !existsSync(path.join(PUBLIC, 'sw.js')))
}

/* ─────────────────────── 5. CSP ו-git ─────────────────────── */
section('פרודקשן — CSP ו-git')

chk("CSP מתיר manifest-src 'self'", nextConfig.includes("manifest-src 'self'"))
chk("CSP מתיר img-src 'self' (אייקונים ומסכי פתיחה)", nextConfig.includes("img-src 'self'"))

{
  // כל נכסי ה-PWA חייבים להגיע ל-Vercel: לא gitignored.
  const assets = [
    ...icons.map((i) => i.src),
    '/apple-touch-icon.png',
    ...APPLE_SPLASH.map(splashSrc),
  ].map((p) => `public${p}`)
  let ignored = []
  try {
    const out = execSync(`git check-ignore ${assets.map((a) => `'${a}'`).join(' ')} || true`,
      { cwd: ROOT, encoding: 'utf8' }).trim()
    ignored = out ? out.split('\n') : []
  } catch { /* check-ignore יוצא 1 כשאין התאמות */ }
  chk('אף נכס PWA אינו gitignored', ignored.length === 0, ignored.join(', '))
}

/* ─────────────────────────── סיכום ─────────────────────────── */
const failed = results.filter((r) => !r).length
console.log(`\n${failed === 0 ? '✅' : '❌'} ${results.length - failed}/${results.length} בדיקות עברו`)
process.exit(failed === 0 ? 0 : 1)
