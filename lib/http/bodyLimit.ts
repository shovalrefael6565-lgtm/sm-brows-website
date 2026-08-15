import 'server-only'

/**
 * שלב 3 (הקשחת API) — קורא גוף בקשה עם תקרת גודל אמיתית, **לפני** JSON.parse.
 *
 * ⚠️ למה לא להסתמך על Content-Length בלבד: הכותרת היא הצהרה של הקורא ואינה
 * מחייבת אותו — בקשה עם body גדול וכותרת שקרית (או בלי הכותרת בכלל, כמו
 * ב-chunked transfer) הייתה עוקפת בדיקה שסומכת רק עליה. Content-Length
 * משמש כאן רק לדחייה **מוקדמת וזולה** כשהוא קיים וכבר חורג; המדידה
 * המחייבת היא ספירת הבייטים בפועל תוך כדי קריאת ה-stream, שנעצרת ברגע
 * שחוצה את התקרה בלי להמשיך לקרוא (ואינה מצטברת ל-JSON.parse על קלט ענק).
 */

/**
 * תקרה גנרית למסלולים ציבוריים עם payload קטן וידוע מראש (טלפון, קוד,
 * שם, הערה עד 1000 תו) — נדיבה בכוונה ביחס לתוכן האמיתי, כדי שלא תיגע
 * בקלט חוקי, אבל רחוקה בסדרי גודל מ-body של מגה-בייטים.
 */
export const DEFAULT_MAX_JSON_BYTES = 10_000

export type BodyLimitResult<T> =
  | { ok: true; body: T }
  | { ok: false; status: 413 }
  | { ok: false; status: 400 }

export async function readJsonWithLimit<T = unknown>(
  req: Request,
  maxBytes: number,
): Promise<BodyLimitResult<T>> {
  const declared = req.headers.get('content-length')
  if (declared !== null) {
    const declaredBytes = Number(declared)
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return { ok: false, status: 413 }
    }
  }

  if (!req.body) {
    return { ok: false, status: 400 }
  }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return { ok: false, status: 413 }
      }
      chunks.push(value)
    }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, status: 400 }
  }

  try {
    return { ok: true, body: JSON.parse(text) as T }
  } catch {
    return { ok: false, status: 400 }
  }
}
