/**
 * שלב 9 (Web App / PWA) — יצירת נכסי ה-PWA מתוך הלוגו הקיים.
 *
 * הסקריפט לא משנה branding: המקור היחיד הוא public/logo.png (המונוגרם
 * הקיים), והרקע היחיד הוא צבע המותג #FAF7F5 (brand-cream, אותו צבע שכבר
 * מוגדר כ-themeColor ב-app/layout.tsx וכרקע ה-<body>). כל מה שנוצר כאן
 * הוא הלוגו הקיים ממורכז על רקע הקרם הקיים — בגדלים ש-Android ו-iOS
 * דורשים.
 *
 * למה סקריפט ולא כלי חיצוני: אין ImageMagick/sharp בסביבה, ואין רצון
 * להוסיף תלות לפרויקט רק בשביל נכסים סטטיים שנוצרים פעם אחת. כאן יש
 * מפענח/מקודד PNG מינימלי מעל zlib של Node בלבד (8-bit RGBA, לא
 * interlaced — בדיוק מה ש-logo.png הוא).
 *
 * מה נוצר (הכל תחת public/):
 *   icons/icon-192.png, icons/icon-512.png            — purpose "any"
 *   icons/icon-maskable-192.png, -512.png             — purpose "maskable"
 *                                                       (הלוגו בתוך 60%
 *                                                       מרכזיים = safe zone)
 *   apple-touch-icon.png (180×180)                    — iOS Add to Home Screen
 *   icons/splash/apple-splash-<w>x<h>.png             — מסכי פתיחה ל-iOS
 *
 * הרצה:  npm run gen:pwa   (tsx — הסקריפט קורא את lib/pwa.ts)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { deflateSync, inflateSync } from 'zlib'
import path from 'path'
import { fileURLToPath } from 'url'
import { APPLE_SPLASH } from '../lib/pwa'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = path.join(ROOT, 'public')

/* ────────────────────────── PNG decode ────────────────────────── */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** מפענח PNG 8-bit RGB/RGBA לא-interlaced → { width, height, data: RGBA } */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG')
  let off = 8
  let width = 0, height = 0, bitDepth = 0, colorType = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const body = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]
      colorType = body[9]
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
      if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported color type ${colorType}`)
      if (body[12] !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }

  const channels = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    const line = Buffer.from(raw.subarray(p, p + stride))
    p += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4 + 0] = line[x * channels + 0]
      out[(y * width + x) * 4 + 1] = line[x * channels + 1]
      out[(y * width + x) * 4 + 2] = line[x * channels + 2]
      out[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255
    }
    prev = line
  }
  return { width, height, data: out }
}

/* ────────────────────────── PNG encode ────────────────────────── */

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, body) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

/** מקודד RGBA ל-PNG. פילטר Sub בכל שורה — רקע אחיד הופך לאפסים ונדחס היטב. */
function encodePng({ width, height, data }) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1)
    raw[o] = 1 // Sub
    for (let i = 0; i < stride; i++) {
      const cur = data[y * stride + i]
      const left = i >= 4 ? data[y * stride + i - 4] : 0
      raw[o + 1 + i] = (cur - left) & 0xff
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // RGBA
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ────────────────────────── composition ────────────────────────── */

function canvas(width, height, [r, g, b]) {
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

const CREAM = [0xfa, 0xf7, 0xf5] // brand-cream #FAF7F5

/*
 * פרמטרי ההחלקה של קו המתאר, שנבחרו מהשוואה חזותית של האייקון ב-512 —
 * הגודל שבו כל פגם מתגלה, כי הוא הגדלה של פי 3.6 מהמקור:
 *   0.4  — מדרגות הפיקסל של המקור עדיין נראות על עקומות ה-S.
 *   1.2  — הנבחר: העקומות רציפות, וחוד הוו והפינות של ה-M נשארים חדים.
 *   1.6+ — חוד הוו מתחיל להתעגל בלי רווח נראה לעין בעקומות.
 *
 * ⚠️ מה שנשאר אחרי ההחלקה — שינויי עובי קלים לאורך הקו — הוא המונוגרם
 * עצמו ולא ארטיפקט: המקור מצויר ביד ברזולוציה נמוכה (ראו את המסכה
 * מוגדלת). החלקה חזקה יותר לא "מתקנת" אותו, היא רק מוחקת אותו.
 */
const CONTOUR_SIGMA = 1.2
const CHAIKIN_ITERATIONS = 2

/**
 * ⚠️ הממצא שמכתיב את כל הצינור הזה: ערוץ האלפא של public/logo.png הוא
 * **בינארי לחלוטין** — 7,586 פיקסלים באלפא 255 ואפס פיקסלים באלפא חלקי.
 * כלומר המונוגרם אינו וקטור ואינו תמונה מוחלקת, אלא מסכה משוננת שגודלה
 * האמיתי 140×170 בלבד. כל דגימה מחדש שלה (בילינארית, box, Lanczos — לא
 * משנה) רק מרחיחה את המדרגות: הקטנה מטשטשת אותן, הגדלה מגדילה אותן. זו
 * הסיבה שהאייקון נראה רך ומשונן במסך הבית.
 *
 * הפתרון הוא לא לדגום פיקסלים אלא לשחזר גיאומטריה: מוציאים את קווי
 * המתאר של המסכה (marching squares), מחליקים אותם לאורך העקומה
 * (Chaikin) כדי להסיר את מדרגות הפיקסל, ומרסטרים מחדש בכל גודל עם
 * אנטי-אליאסינג אנליטי. בפועל הלוגו מומר לווקטור פעם אחת, ומשם כל
 * אייקון נוצר בחדות מלאה — 512 בדיוק כמו 180.
 *
 * הצורה עצמה לא משתנה: אותו קו מתאר, אותו מונוגרם, ואותו צבע דיו
 * (rgb(109,103,98) — נדגם מהקובץ, לא נבחר מחדש).
 */

/**
 * marching squares — מוציא את קווי המתאר הסגורים של המסכה הבינארית.
 *
 * הצורה נדגמת ברמת הקצה ולא ברמת הפיקסל: כל תא בין ארבעה פיקסלים תורם
 * קטע קו באמצע הצלעות שבהן הערך מתהפך. התוצאה היא פוליגונים סגורים
 * (כולל החורים של ה-S וה-M) בקואורדינטות המסכה.
 */
function marchingSquares(mask, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x])
  const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`
  const segs = []
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1)
      const idx = (tl << 3) | (tr << 2) | (br << 1) | bl
      if (idx === 0 || idx === 15) continue
      // נקודות אמצע הצלעות של התא (מרכזי הפיקסלים הם x+0.5 וכו')
      const N = [x + 1, y + 0.5]
      const E = [x + 1.5, y + 1]
      const S = [x + 1, y + 1.5]
      const W = [x + 0.5, y + 1]
      // הקטעים מכוונים כך שהמילוי נשאר משמאל לכיוון ההליכה.
      const table = {
        1: [[W, S]], 2: [[S, E]], 3: [[W, E]], 4: [[E, N]],
        5: [[W, N], [S, E]],          // אמביוולנטי — נפתר לטובת חיבור הרקע
        6: [[S, N]], 7: [[W, N]], 8: [[N, W]], 9: [[N, S]],
        10: [[N, E], [W, S]],         // אמביוולנטי — סימטרי למקרה 5
        11: [[N, E]], 12: [[E, W]], 13: [[E, S]], 14: [[S, W]],
      }
      for (const seg of table[idx]) segs.push(seg)
    }
  }
  // חיבור הקטעים ללולאות סגורות לפי נקודות קצה משותפות
  const byStart = new Map()
  for (const seg of segs) {
    const k = key(seg[0])
    if (!byStart.has(k)) byStart.set(k, [])
    byStart.get(k).push(seg)
  }
  const used = new Set()
  const loops = []
  for (const seg of segs) {
    if (used.has(seg)) continue
    const loop = [seg[0]]
    let cur = seg
    while (cur && !used.has(cur)) {
      used.add(cur)
      loop.push(cur[1])
      const next = (byStart.get(key(cur[1])) ?? []).find((s) => !used.has(s))
      cur = next
    }
    if (loop.length > 3) loops.push(loop)
  }
  return loops
}

/**
 * מסנן נמוך-תדר מחזורי לאורך קו המתאר.
 *
 * ⚠️ זה השלב שבאמת מסיר את מדרגות הפיקסל, ולא Chaikin לבדו: Chaikin
 * מתכנס ל-B-spline ריבועי אחרי מעט איטרציות ומשם רק מוסיף נקודות, כך
 * שגל ברוחב פיקסל שורד אותו. ממוצע גאוסייני **לאורך העקומה** מסנן בדיוק
 * את התדר הזה. הוא חד-ממדי לאורך המסלול, ולכן אינו מזיז את הצורה —
 * בניגוד לטשטוש דו-ממדי של שדה מרחק, שנוסה קודם ונפסל כי הוא דוחף דפנות
 * זו לזו והוציא את ה-S גלי ואת חוד הוו מקהה.
 *
 * סיגמה של ~1.6 נקודות מתאר ≈ 1.6 פיקסלי מקור: מוחקת רעש בסדר גודל של
 * פיקסל, ומשאירה כל מאפיין אמיתי של הסימן (עובי הקו 13px, הפינות
 * בסדר גודל של עשרות) ללא שינוי.
 */
function smoothLoop(loop, sigma) {
  const closed = loop.slice(0, -1) // הנקודה האחרונה = הראשונה
  const n = closed.length
  if (n < 8) return loop
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = []
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel.push(v)
    sum += v
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum
  const out = []
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0
    for (let k = -radius; k <= radius; k++) {
      const p = closed[(i + k + n * 8) % n]
      x += p[0] * kernel[k + radius]
      y += p[1] * kernel[k + radius]
    }
    out.push([x, y])
  }
  out.push(out[0])
  return out
}

/**
 * החלקת Chaikin (corner cutting) לאורך קו המתאר.
 *
 * ⚠️ זה ההבדל המהותי מהחלקה גאוסיינית של השדה, שנוסתה קודם ונפסלה:
 * ההחלקה כאן היא **חד-ממדית לאורך העקומה**, ולכן היא מסירה את מדרגות
 * הפיקסל בלי להזיז את הצורה. טשטוש דו-ממדי, לעומת זאת, דוחף גם את
 * הדפנות זו לזו ומעגל פינות אמיתיות — ה-S יצא ממנו גלי וקצה הוו התקהה.
 * שלוש איטרציות מספיקות: המדרגה היא בסדר גודל של פיקסל אחד, והפינות
 * האמיתיות של הסימן הן בסדר גודל של עשרות פיקסלים ולכן שורדות.
 */
function chaikin(loop, iterations) {
  let pts = loop
  for (let it = 0; it < iterations; it++) {
    const out = []
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]
      const [x1, y1] = pts[i + 1]
      out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25])
      out.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75])
    }
    out.push(out[0])
    pts = out
  }
  return pts
}

/**
 * רסטור פוליגונים עם אנטי-אליאסינג אנליטי.
 *
 * לכל תת-שורה נאספות חציות הקצוות, ממוינות, ומולאות בזוגות (even-odd,
 * ולכן החורים של הסימן יוצאים ריקים בלי תלות בכיוון הלולאה). הכיסוי
 * האופקי מחושב בדיוק תת-פיקסלי, והאנכי לפי SUBS תת-שורות — כלומר קצה
 * חלק אמיתי, לא ממוצע של פיקסלים משוננים.
 */
const SUBS = 16
function rasterize(loops, width, height, transform) {
  const cov = new Float64Array(width * height)
  // דלי לכל שורת פיקסלים: קצה נבדק רק בשורות שהוא באמת חוצה. בלי זה
  // מסך פתיחה בגובה 2868 עם ~12,500 קצוות היה 550 מיליון בדיקות לקובץ.
  const buckets = Array.from({ length: height }, () => [])
  for (const loop of loops) {
    const p = loop.map(transform)
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1]
      if (a[1] === b[1]) continue
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1])))
      const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1])))
      for (let y = y0; y <= y1; y++) buckets[y].push([a, b])
    }
  }
  const xs = []
  for (let y = 0; y < height; y++) {
    const rowEdges = buckets[y]
    if (rowEdges.length < 2) continue
    for (let sub = 0; sub < SUBS; sub++) {
      const sy = y + (sub + 0.5) / SUBS
      xs.length = 0
      for (const [[ax, ay], [bx, by]] of rowEdges) {
        if ((sy >= ay && sy < by) || (sy >= by && sy < ay)) {
          xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax))
        }
      }
      if (xs.length < 2) continue
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = Math.max(0, xs[i])
        const x1 = Math.min(width, xs[i + 1])
        if (x1 <= x0) continue
        const px0 = Math.floor(x0)
        const px1 = Math.min(width - 1, Math.floor(x1 - 1e-9))
        if (px0 === px1) {
          cov[y * width + px0] += (x1 - x0) / SUBS
          continue
        }
        cov[y * width + px0] += (px0 + 1 - x0) / SUBS
        for (let x = px0 + 1; x < px1; x++) cov[y * width + x] += 1 / SUBS
        cov[y * width + px1] += (x1 - px1) / SUBS
      }
    }
  }
  return cov
}

/**
 * מרנדר את המונוגרם על קנבס קרם.
 *
 * @param shape  קווי המתאר המוחלקים + המידות, צבע הדיו והמרכז האופטי
 * @param markH  גובה המונוגרם כשבר מהצלע הקצרה של הקנבס
 */
function render(shape, width, height, markH) {
  const { loops, inkH, ink, opticalCx, opticalCy } = shape
  const scale = (Math.min(width, height) * markH) / inkH
  const originX = width / 2 - opticalCx * scale
  const originY = height / 2 - opticalCy * scale
  const cov = rasterize(loops, width, height, ([x, y]) => [originX + x * scale, originY + y * scale])
  const out = canvas(width, height, CREAM)
  for (let i = 0; i < width * height; i++) {
    const c = Math.min(1, cov[i])
    if (c <= 0) continue
    for (let ch = 0; ch < 3; ch++) {
      out.data[i * 4 + ch] = Math.round(ink[ch] * c + CREAM[ch] * (1 - c))
    }
  }
  return out
}

/**
 * מפיק מהלוגו מסכה בינארית, צבע דיו ומרכז אופטי.
 *
 * מרכוז: התיבה החוסמת ממרכזת גיאומטרית, אבל מסת הדיו של המונוגרם יושבת
 * ימינה — הקו האנכי של ה-M מלא, בעוד שצדו השמאלי של הסימן הוא וו פתוח.
 * מרכוז לפי התיבה בלבד השאיר את הסימן נראה דחוף שמאלה. המרכז האופטי כאן
 * הוא אמצע הדרך בין מרכז התיבה למרכז המסה — הכלל המקובל לסימנים
 * א-סימטריים, ומה שנראה הכי מאוזן מבין הווריאציות שנבדקו.
 */
function analyzeLogo(src) {
  const { width: w, height: h, data } = src
  const alpha = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    // ההילה הבהירה שאפויה בקובץ המקור (235,224,214 באלפא ~66) אינה חלק
    // מהסימן — בלתי נראית מעל הקרם של האתר, ריבוע רפאים מעל קנבס אטום.
    alpha[i] = data[i * 4 + 3] > 128 && lum <= 200 ? 1 : 0
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  let sx = 0, sy = 0, n = 0
  let r = 0, g = 0, b = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!alpha[y * w + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      sx += x; sy += y; n++
      r += data[(y * w + x) * 4]
      g += data[(y * w + x) * 4 + 1]
      b += data[(y * w + x) * 4 + 2]
    }
  }
  if (x1 < 0) throw new Error('logo has no visible pixels')
  const inkW = x1 - x0 + 1
  const inkH = y1 - y0 + 1
  const mask = new Uint8Array(inkW * inkH)
  for (let y = 0; y < inkH; y++) {
    for (let x = 0; x < inkW; x++) mask[y * inkW + x] = alpha[(y + y0) * w + (x + x0)]
  }
  const bboxCx = inkW / 2, bboxCy = inkH / 2
  const massCx = sx / n - x0, massCy = sy / n - y0
  return {
    mask, inkW, inkH,
    ink: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
    opticalCx: (bboxCx + massCx) / 2,
    opticalCy: (bboxCy + massCy) / 2,
  }
}

/* ────────────────────────── main ────────────────────────── */

function main() {
  const geom = analyzeLogo(decodePng(readFileSync(path.join(PUBLIC, 'logo.png'))))
  const loops = marchingSquares(geom.mask, geom.inkW, geom.inkH)
    .map((l) => chaikin(smoothLoop(l, CONTOUR_SIGMA), CHAIKIN_ITERATIONS))
  const shape = { ...geom, loops }
  console.log(`   מתאר: ${loops.length} לולאות, ${loops.reduce((n, l) => n + l.length, 0)} נקודות`)
  mkdirSync(path.join(PUBLIC, 'icons', 'splash'), { recursive: true })

  const write = (rel, img) => {
    const buf = encodePng(img)
    writeFileSync(path.join(PUBLIC, rel), buf)
    console.log(`✓ ${rel.padEnd(42)} ${img.width}×${img.height}  ${(buf.length / 1024).toFixed(1)}KB`)
  }
  const square = (size, markH) => render(shape, size, size, markH)

  /*
   * גובה הסימן כשבר מצלע הקנבס. הסימן גבוה מרוחבו (140×170), ולכן הגובה
   * הוא האילוץ הנכון — התאמה לפי "התיבה הכוללת" הקטינה אותו מיותר והוא
   * נראה אבוד בתוך הקרם.
   *   0.70 — אייקוני "any" ו-apple-touch-icon: נוכח ומלא, עם שוליים
   *          ששורדים את הפינות המעוגלות של iOS.
   *   0.52 — maskable: חצי-האלכסון יוצא 0.34 מהצלע, בתוך מעגל הבטיחות
   *          של 0.4 שאנדרואיד עשוי לחתוך אליו, עם מרווח.
   */
  write('icons/icon-192.png', square(192, 0.70))
  write('icons/icon-512.png', square(512, 0.70))
  write('icons/icon-maskable-192.png', square(192, 0.52))
  write('icons/icon-maskable-512.png', square(512, 0.52))
  // iOS Add to Home Screen — חייב להיות אטום (iOS לא מכבד שקיפות)
  write('apple-touch-icon.png', square(180, 0.70))

  for (const { w, h } of APPLE_SPLASH) {
    write(`icons/splash/apple-splash-${w}x${h}.png`, render(shape, w, h, 0.30))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
