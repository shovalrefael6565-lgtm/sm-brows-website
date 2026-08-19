/**
 * שלב 9 (Web App / PWA) — יצירת נכסי ה-PWA מקובץ המאסטר של האייקון.
 *
 * המקור: public/pwa-logo-master.png — 1254×1254, נכס ייעודי לאייקון
 * האפליקציה: לוקאפ SM עם הגבה המוזהבת והכיתוב SM BROWS, על כרטיס קרם
 * עם פינות מעוגלות. הוא כבר מעוצב כאייקון, ולכן הסקריפט **לא נוגע
 * בלוגו**: אין וקטוריזציה, אין שחזור, אין חידוד ואין שינוי צבע. כל מה
 * שקורה כאן הוא הקטנה איכותית לגדלים ש-Android ו-iOS דורשים.
 *
 * למה סקריפט ולא כלי חיצוני: אין ImageMagick/sharp בסביבה, ואין רצון
 * להוסיף תלות רק בשביל נכסים סטטיים שנוצרים פעם אחת. כאן יש מפענח/מקודד
 * PNG מינימלי מעל zlib של Node, ודוגם box איכותי.
 *
 * שני תיקונים כן מבוצעים, ושניהם ברקע בלבד — לא בלוגו:
 *
 *   1. השוליים הלבנים שמחוץ לפינות המעוגלות של הכרטיס מוחלפים בקרם של
 *      הכרטיס עצמו. המסכה של iOS מעגלת ברדיוס גדול מזה שאפוי בקובץ,
 *      אבל לא מספיק כדי לבלוע את כל הלבן: 655 פיקסלים לבנים שורדים
 *      אותה ומופיעים כרסיסים בהירים בפינות האייקון במסך הבית. מילוי
 *      בקרם של הכרטיס מעלים אותם ומשאיר אייקון full-bleed — וזו ממילא
 *      ההמלצה של אפל, שהפינות יהיו של מערכת ההפעלה ולא של הנכס.
 *
 *   2. ל-maskable הכרטיס מוקטן. הדיו של הלוקאפ מגיע עד 41.5% מהצלע
 *      מהמרכז, ואנדרואיד עשוי לחתוך אייקון maskable למעגל ברדיוס 40% —
 *      כלומר הכיתוב SM BROWS היה נחתך. ההקטנה מחושבת מהמדידה בפועל של
 *      הדיו, לא מקבוע.
 *
 * מה נוצר (הכל תחת public/):
 *   icons/icon-192.png, icons/icon-512.png            — purpose "any"
 *   icons/icon-maskable-192.png, -512.png             — purpose "maskable"
 *   apple-touch-icon.png (180×180)                    — iOS Add to Home Screen
 *   icons/splash/apple-splash-<w>x<h>.png             — מסכי פתיחה ל-iOS
 *
 * הרצה:  npm run gen:pwa
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { deflateSync, inflateSync } from 'zlib'
import path from 'path'
import { fileURLToPath } from 'url'
import { APPLE_SPLASH } from '../lib/pwa'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = path.join(ROOT, 'public')
const MASTER = 'pwa-logo-master.png'

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

/**
 * מקודד PNG. שתי אופטימיזציות שנדרשו כשהמאסטר הפך מקו-מתאר שטוח לאיור
 * עשיר עם מעברי גוון:
 *
 *   1. כל הנכסים כאן אטומים לגמרי (iOS ממילא לא מכבד שקיפות באייקון),
 *      ולכן הם נכתבים כ-truecolor בלי ערוץ אלפא — רבע פחות בייטים גולמיים
 *      לפני הדחיסה.
 *   2. בחירת פילטר לכל שורה בנפרד לפי היוריסטיקת
 *      minimum-sum-of-absolute-differences, כמו שספריות PNG עושות
 *      כברירת מחדל. פילטר Sub קבוע התאים לרקע שטוח, אבל לא לשערות הגבה
 *      ולמעברי הגוון של הכרטיס.
 */
function encodePng({ width, height, data }) {
  // אלפא אחיד ומלא → כותבים RGB (colorType 2) במקום RGBA (6)
  let opaque = true
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break }
  const ch = opaque ? 3 : 4
  const stride = width * ch
  const pix = Buffer.alloc(stride * height)
  for (let i = 0, o = 0; i < width * height; i++) {
    pix[o++] = data[i * 4]
    pix[o++] = data[i * 4 + 1]
    pix[o++] = data[i * 4 + 2]
    if (!opaque) pix[o++] = data[i * 4 + 3]
  }

  const raw = Buffer.alloc((stride + 1) * height)
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride))
  const zero = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const cur = pix.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pix.subarray((y - 1) * stride, y * stride) : zero
    let best = 0, bestScore = Infinity
    for (let f = 0; f < 5; f++) {
      const buf = cand[f]
      let score = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? cur[i - ch] : 0
        const b = prev[i]
        const c = i >= ch ? prev[i - ch] : 0
        let v
        if (f === 0) v = cur[i]
        else if (f === 1) v = cur[i] - a
        else if (f === 2) v = cur[i] - b
        else if (f === 3) v = cur[i] - ((a + b) >> 1)
        else {
          const pp = a + b - c
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
          v = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        }
        buf[i] = v & 0xff
        score += buf[i] < 128 ? buf[i] : 256 - buf[i]
      }
      if (score < bestScore) { bestScore = score; best = f }
    }
    raw[y * (stride + 1)] = best
    cand[best].copy(raw, y * (stride + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = opaque ? 2 : 6
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ────────────────────────── resampling ────────────────────────── */

/**
 * הקטנה בשקלול שטח (box filter) עם כיסוי חלקי מדויק בקצוות.
 *
 * זו הדגימה הנכונה להקטנה גדולה — 1254→180 הוא פי 7 — כי כל פיקסל יעד
 * הוא בדיוק הממוצע של השטח שהוא מכסה במקור. בילינארי היה דוגם 4
 * פיקסלים מתוך 49 ומאבד פרטים (הכיתוב SM BROWS והשערות של הגבה),
 * ו-Lanczos היה מוסיף ringing סביב הקצוות הכהים על הקרם. אין כאן חידוד
 * ואין שינוי גוונים — רק ממוצע.
 */
function resampleBox(src, dw, dh) {
  const { width: sw, height: sh, data } = src
  const out = Buffer.alloc(dw * dh * 4)
  const sx = sw / dw
  const sy = sh / dh
  for (let y = 0; y < dh; y++) {
    const fy0 = y * sy
    const fy1 = (y + 1) * sy
    const iy0 = Math.floor(fy0)
    const iy1 = Math.min(sh - 1, Math.ceil(fy1) - 1)
    for (let x = 0; x < dw; x++) {
      const fx0 = x * sx
      const fx1 = (x + 1) * sx
      const ix0 = Math.floor(fx0)
      const ix1 = Math.min(sw - 1, Math.ceil(fx1) - 1)
      let r = 0, g = 0, b = 0, a = 0, wsum = 0
      for (let py = iy0; py <= iy1; py++) {
        const wy = Math.min(py + 1, fy1) - Math.max(py, fy0)
        if (wy <= 0) continue
        for (let px = ix0; px <= ix1; px++) {
          const wx = Math.min(px + 1, fx1) - Math.max(px, fx0)
          if (wx <= 0) continue
          const w = wx * wy
          const i = (py * sw + px) * 4
          const pa = data[i + 3] / 255
          r += data[i] * pa * w
          g += data[i + 1] * pa * w
          b += data[i + 2] * pa * w
          a += data[i + 3] * w
          wsum += w
        }
      }
      const i = (y * dw + x) * 4
      const alpha = a / wsum
      const pa = alpha / 255
      out[i + 0] = pa > 0 ? Math.round(Math.min(255, r / wsum / pa)) : 0
      out[i + 1] = pa > 0 ? Math.round(Math.min(255, g / wsum / pa)) : 0
      out[i + 2] = pa > 0 ? Math.round(Math.min(255, b / wsum / pa)) : 0
      out[i + 3] = Math.round(alpha)
    }
  }
  return { width: dw, height: dh, data: out }
}

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

/** מרכיב src מעל dst ב-(dx,dy) */
function composite(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x
      if (tx < 0 || tx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const di = (ty * dst.width + tx) * 4
      const sa = src.data[si + 3] / 255
      if (sa === 0) continue
      for (let c = 0; c < 3; c++) {
        dst.data[di + c] = Math.round(src.data[si + c] * sa + dst.data[di + c] * (1 - sa))
      }
      dst.data[di + 3] = 255
    }
  }
}

/* ────────────────────────── master analysis ────────────────────────── */

/**
 * קורא את המאסטר ומודד ממנו את מה שהגדלים תלויים בו:
 *   cream     — צבע הרקע של הכרטיס (הגוון השכיח ביותר בתמונה)
 *   ink       — התיבה החוסמת של הלוקאפ עצמו (כל מה שכהה מהקרם)
 *   inkRadius — המרחק הגדול ביותר מהמרכז לפינת הדיו, כשבר מהצלע
 *
 * הכול נמדד ולא מקובע, כדי שהחלפת המאסטר בעתיד לא תדרוש כיול ידני.
 */
function analyzeMaster(img) {
  const { width: W, height: H, data } = img
  const hist = new Map()
  for (let i = 0; i < W * H; i++) {
    const k = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]
    hist.set(k, (hist.get(k) ?? 0) + 1)
  }
  let bestKey = 0, bestN = -1
  for (const [k, n] of hist) if (n > bestN) { bestN = n; bestKey = k }
  const cream = [(bestKey >> 16) & 255, (bestKey >> 8) & 255, bestKey & 255]

  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (lum >= 215) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  const inkRadius = Math.max(
    ...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - W / 2, y - H / 2)),
  ) / W
  return { cream, ink: { x0, y0, x1, y1 }, inkRadius }
}

/**
 * מחליף את השוליים הלבנים שמחוץ לפינות המעוגלות של הכרטיס בקרם שלו.
 *
 * ⚠️ המימוש הוא מילוי גלישה (flood fill) מארבע הפינות, ולא נוסחה
 * גיאומטרית, כי שתי גישות פשוטות יותר נכשלו על הקובץ הזה:
 *
 *   • זיהוי לפי בהירות בלבד תפס 557,863 פיקסלים — 35% מהתמונה — כי הקרם
 *     של הכרטיס עצמו אינו אחיד ונע סביב (254,245,232±2).
 *   • מודל של קשת מעגלית ברדיוס שנמדד מהשורה העליונה השאיר טבעת בהירה
 *     דקה, שנראתה בבירור באייקון ה-maskable: הפינה של הכרטיס אינה מעגל
 *     אלא squircle, שנכנס פנימה יותר מהמעגל באזור האלכסון.
 *
 * גלישה מהפינות אינה מניחה שום צורה — היא לוקחת בדיוק את מה שלבן ומחובר
 * לפינה. היצירה מופרדת ממנה ע"י כל רוחב הכרטיס, ולכן אין דרך שהמילוי
 * ידלוף אליה. ההרחבה בשני פיקסלים בולעת את פיקסלי ההחלקה של קשת הכרטיס,
 * שהם מעורבבים עם הלבן ולכן היו נשארים כטבעת.
 *
 * למה בכלל: המסכה של iOS מעגלת ברדיוס גדול מזה שאפוי בקובץ, אבל לא
 * מספיק — 655 פיקסלים לבנים שרדו אותה והופיעו כרסיסים בהירים בפינות
 * האייקון במסך הבית.
 */
function flattenSurround(img, cream) {
  const { width: W, height: H, data } = img
  // "לבן" = בהיר בכל הערוצים ונטול גוון. הקרם הוא (254,245,232) —
  // הפרש של 22 בין הערוץ הגבוה לנמוך — ולכן לעולם לא ייכנס לקטגוריה.
  const isWhite = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    return min >= 246 && max - min <= 6
  }
  const region = new Uint8Array(W * H)
  const stack = []
  for (const [sx, sy] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) {
    const i = (sy * W + sx)
    if (isWhite(i * 4) && !region[i]) { region[i] = 1; stack.push(i) }
  }
  while (stack.length) {
    const i = stack.pop()
    const x = i % W, y = (i / W) | 0
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (region[j] || !isWhite(j * 4)) continue
      region[j] = 1
      stack.push(j)
    }
  }
  // הרחבה בשני פיקסלים — פיקסלי ההחלקה של הקשת אינם "לבן" לפי הבדיקה
  // למעלה, אבל הם מעורבבים איתו ולכן חייבים להיבלע גם הם.
  let grown = region
  for (let pass = 0; pass < 2; pass++) {
    const next = Uint8Array.from(grown)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grown[y * W + x]) continue
        if ((x > 0 && grown[y * W + x - 1]) || (x < W - 1 && grown[y * W + x + 1]) ||
            (y > 0 && grown[(y - 1) * W + x]) || (y < H - 1 && grown[(y + 1) * W + x])) {
          next[y * W + x] = 1
        }
      }
    }
    grown = next
  }

  const out = Buffer.from(data)
  let touched = 0
  for (let i = 0; i < W * H; i++) {
    if (!grown[i]) continue
    out[i * 4] = cream[0]
    out[i * 4 + 1] = cream[1]
    out[i * 4 + 2] = cream[2]
    touched++
  }
  return { img: { width: W, height: H, data: out }, touched }
}

/* ────────────────────────── main ────────────────────────── */

// רדיוס הבטיחות של אייקון maskable: אנדרואיד עשוי לחתוך למעגל ברדיוס
// 40% מהצלע. 0.375 משאיר מרווח ביטחון קטן מתחת לגבול.
const MASKABLE_SAFE_RADIUS = 0.375

function main() {
  const raw = decodePng(readFileSync(path.join(PUBLIC, MASTER)))
  const { cream, inkRadius } = analyzeMaster(raw)
  const { img: master, touched } = flattenSurround(raw, cream)
  console.log(`   מאסטר: ${raw.width}×${raw.height}, קרם rgb(${cream}), דיו עד ${(inkRadius * 100).toFixed(1)}% מהמרכז`)
  console.log(`   שוליים לבנים שהוחלפו בקרם: ${touched} פיקסלים (${(100 * touched / (raw.width * raw.height)).toFixed(1)}%)`)

  // הקטנת הכרטיס ל-maskable, כך שהדיו ייכנס למעגל הבטיחות.
  const maskableScale = Math.min(1, MASKABLE_SAFE_RADIUS / inkRadius)
  console.log(`   הקטנה ל-maskable: ${(maskableScale * 100).toFixed(1)}%`)

  mkdirSync(path.join(PUBLIC, 'icons', 'splash'), { recursive: true })
  const write = (rel, img) => {
    const buf = encodePng(img)
    writeFileSync(path.join(PUBLIC, rel), buf)
    console.log(`✓ ${rel.padEnd(42)} ${img.width}×${img.height}  ${(buf.length / 1024).toFixed(1)}KB`)
  }

  /** אייקון full-bleed: הכרטיס ממלא את כל הריבוע, כמו שהוא. */
  const full = (size) => resampleBox(master, size, size)

  /** אייקון maskable: אותו כרטיס, מוקטן וממורכז על הקרם שלו. */
  const maskable = (size) => {
    const inner = Math.round(size * maskableScale)
    const out = canvas(size, size, cream)
    const off = Math.round((size - inner) / 2)
    composite(out, resampleBox(master, inner, inner), off, off)
    return out
  }

  write('icons/icon-192.png', full(192))
  write('icons/icon-512.png', full(512))
  write('icons/icon-maskable-192.png', maskable(192))
  write('icons/icon-maskable-512.png', maskable(512))
  // iOS Add to Home Screen — אטום, בלי שקיפות, והפינות של iOS מעל.
  write('apple-touch-icon.png', full(180))

  // מסכי הפתיחה: אותו כרטיס במרכז, על הקרם שלו — בלי תפר בין הכרטיס
  // לרקע, כך שהמסך נראה כמו מסך קרם אחד עם הלוגו.
  for (const { w, h } of APPLE_SPLASH) {
    const side = Math.round(Math.min(w, h) * 0.34)
    const out = canvas(w, h, cream)
    composite(out, resampleBox(master, side, side), Math.round((w - side) / 2), Math.round((h - side) / 2))
    write(`icons/splash/apple-splash-${w}x${h}.png`, out)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
