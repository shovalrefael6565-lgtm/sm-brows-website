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

/** דגימה בילינארית עם אלפא מוכפל-מראש (כדי שקצוות שקופים לא "ידממו" שחור) */
function resize(src, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4)
  const { width: sw, height: sh, data } = src
  // צעד לפי יחס — כולל דגימת-על (box) כשמקטינים, כדי למנוע aliasing
  const sxStep = sw / dw
  const syStep = sh / dh
  const ss = Math.max(1, Math.floor(Math.min(sxStep, syStep))) // super-sampling
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let oy = 0; oy < ss; oy++) {
        for (let ox = 0; ox < ss; ox++) {
          const fx = Math.min(sw - 1, (x + (ox + 0.5) / ss) * sxStep - 0.5)
          const fy = Math.min(sh - 1, (y + (oy + 0.5) / ss) * syStep - 0.5)
          const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy))
          const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1)
          const tx = fx - x0, ty = fy - y0
          for (const [px, py, w] of [
            [x0, y0, (1 - tx) * (1 - ty)],
            [x1, y0, tx * (1 - ty)],
            [x0, y1, (1 - tx) * ty],
            [x1, y1, tx * ty],
          ]) {
            const i = (py * sw + px) * 4
            const pa = data[i + 3] / 255
            r += data[i] * pa * w
            g += data[i + 1] * pa * w
            b += data[i + 2] * pa * w
            a += data[i + 3] * w
          }
          n++
        }
      }
      const i = (y * dw + x) * 4
      const alpha = a / n
      const pa = alpha / 255
      out[i + 0] = pa > 0 ? Math.round(Math.min(255, r / n / pa)) : 0
      out[i + 1] = pa > 0 ? Math.round(Math.min(255, g / n / pa)) : 0
      out[i + 2] = pa > 0 ? Math.round(Math.min(255, b / n / pa)) : 0
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

/** מרכיב src מעל dst ב-(dx,dy) עם source-over רגיל */
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

/**
 * מכין את הלוגו לשימוש כאייקון: מסיר את הילת-הרקע הבהירה שקיימת בקובץ
 * המקור (מלבן 204×211 בגוון 235,224,214 באלפא ~66 — בלתי נראה מעל הרקע
 * הלבן/קרם של האתר, אבל מעל קנבס אטום הוא מופיע כריבוע רפאים), ואז חותך
 * לתיבה החוסמת של המונוגרם עצמו כדי שהמרכוז יהיה מרכוז אופטי אמיתי.
 * המונוגרם עצמו לא נוגעים בו — זהו אותו לוגו, בלי הרקע הטפילי.
 */
function prepareLogo(src) {
  const { width: w, height: h, data } = src
  const cleaned = Buffer.from(data)
  for (let i = 0; i < cleaned.length; i += 4) {
    if (!cleaned[i + 3]) continue
    const lum = 0.299 * cleaned[i] + 0.587 * cleaned[i + 1] + 0.114 * cleaned[i + 2]
    if (lum > 200) cleaned[i + 3] = 0
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cleaned[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) throw new Error('logo has no visible pixels')
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const out = Buffer.alloc(cw * ch * 4)
  for (let y = 0; y < ch; y++) {
    cleaned.copy(out, y * cw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4)
  }
  return { width: cw, height: ch, data: out }
}

const CREAM = [0xfa, 0xf7, 0xf5] // brand-cream #FAF7F5

/**
 * לוגו ממורכז על ריבוע קרם.
 * @param ratio חלק מרוחב הקנבס שהלוגו תופס (safe zone ל-maskable = 0.6)
 */
function iconOnCream(logo, size, ratio) {
  const box = Math.round(size * ratio)
  const scale = Math.min(box / logo.width, box / logo.height)
  const w = Math.round(logo.width * scale)
  const h = Math.round(logo.height * scale)
  const out = canvas(size, size, CREAM)
  composite(out, resize(logo, w, h), Math.round((size - w) / 2), Math.round((size - h) / 2))
  return out
}

function splash(logo, width, height) {
  // הלוגו ברוחב ~28% מהצלע הקצרה — נוכח אבל לא דומיננטי, כמו ה-navbar
  const box = Math.round(Math.min(width, height) * 0.28)
  const scale = Math.min(box / logo.width, box / logo.height)
  const w = Math.round(logo.width * scale)
  const h = Math.round(logo.height * scale)
  const out = canvas(width, height, CREAM)
  composite(out, resize(logo, w, h), Math.round((width - w) / 2), Math.round((height - h) / 2))
  return out
}

/* ────────────────────────── main ────────────────────────── */

function main() {
  const logo = prepareLogo(decodePng(readFileSync(path.join(PUBLIC, 'logo.png'))))
  mkdirSync(path.join(PUBLIC, 'icons', 'splash'), { recursive: true })

  const write = (rel, img) => {
    const buf = encodePng(img)
    writeFileSync(path.join(PUBLIC, rel), buf)
    console.log(`✓ ${rel.padEnd(42)} ${img.width}×${img.height}  ${(buf.length / 1024).toFixed(1)}KB`)
  }

  // purpose "any" — הלוגו גדול, הקנבס כולו נראה
  write('icons/icon-192.png', iconOnCream(logo, 192, 0.68))
  write('icons/icon-512.png', iconOnCream(logo, 512, 0.68))
  // purpose "maskable" — הלוגו בתוך 60% המרכזיים כדי לשרוד חיתוך למעגל
  write('icons/icon-maskable-192.png', iconOnCream(logo, 192, 0.6))
  write('icons/icon-maskable-512.png', iconOnCream(logo, 512, 0.6))
  // iOS Add to Home Screen — חייב להיות אטום (iOS לא מכבד שקיפות)
  write('apple-touch-icon.png', iconOnCream(logo, 180, 0.72))

  for (const { w, h } of APPLE_SPLASH) {
    write(`icons/splash/apple-splash-${w}x${h}.png`, splash(logo, w, h))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
