'use client'

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, AlertCircle, AlertTriangle, CheckCircle2, Send, MessageSquare, BellOff,
} from 'lucide-react'
import { formatPhoneForDisplay } from '@/lib/phone'
import {
  evaluateMarketingBody, UCS2_SINGLE_MAX, PROVIDER_MAX_CHARS,
} from '@/lib/marketing/message'

/**
 * בחירת נמענות + חיבור הודעת דיוור + preview + שליחה.
 *
 * ═══ מונה אחד, מקור אחד ═════════════════════════════════════════════════
 *
 * 🔒 המונה כאן קורא ל-`evaluateMarketingBody` — **אותה פונקציה בדיוק**
 * שהשרת מריץ לפני היצירה ולפני השליחה. אין כאן חישוב מקומי של אורך או של
 * יחידות, ולכן אי אפשר להגיע למצב שהמסך מבטיח יחידה אחת והחיוב הוא על
 * שתיים. הספירה היא על ה-**הודעה הסופית** — זיהוי העסק + הטקסט + קישור
 * ההסרה — ולא על מה שהוקלד בתיבה.
 *
 * ⚠️ הטקסט לעולם אינו נחתך אוטומטית. חריגה = אזהרה, והמנהלת מקצרת.
 *
 * ═══ PHASE 1 ═════════════════════════════════════════════════════════════
 *
 * 🔓 `marketing_consent = false` אינו חוסם בחירה או שליחה. המנהלת בוחרת
 * ידנית מי מקבלת.
 * 🔴 `הסירה את עצמה מדיוור` **כן** חוסם: ה-checkbox מושבת, והשרת בודק
 * זאת שוב בבנייה ושוב ברגע השליחה.
 */

export interface Candidate {
  id: string
  full_name: string
  phone_e164: string
  opted_out: boolean
  has_consent: boolean
}

interface Progress {
  processed: number; sent: number; failed: number; skipped: number
  remaining: number; status: string
}

export default function BulkSmsComposer({ candidates }: { candidates: Candidate[] }) {
  const router = useRouter()

  const selectable = useMemo(() => candidates.filter(c => !c.opted_out), [candidates])
  const optedOut = useMemo(() => candidates.filter(c => c.opted_out), [candidates])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [done, setDone] = useState(false)

  // ⚠️ נוצר פעם אחת לכל קמפיין ונשלח שוב בכל retry — זו ההגנה מפני הגשה
  // כפולה. `disabled` על הכפתור אינו הגנה: תשובה יכולה ללכת לאיבוד אחרי
  // שה-DB כבר כתב.
  const requestId = useRef(crypto.randomUUID())

  const stats = evaluateMarketingBody(body)
  const overOneUnit = stats.chars > UCS2_SINGLE_MAX
  const overProvider = stats.chars > PROVIDER_MAX_CHARS

  const selectedList = useMemo(
    () => selectable.filter(c => selected.has(c.id)), [selectable, selected])

  // ── Preview: מספרים ייחודיים, כפולים, ולא תקינים ─────────────────────────
  const preview = useMemo(() => {
    const seen = new Set<string>()
    let duplicates = 0, invalid = 0, valid = 0
    for (const c of selectedList) {
      const digits = (c.phone_e164 ?? '').replace(/\D/g, '')
      if (!/^9725\d{8}$/.test(digits)) { invalid++; continue }
      if (seen.has(digits)) { duplicates++; continue }
      seen.add(digits); valid++
    }
    return { valid, duplicates, invalid }
  }, [selectedList])

  const estimatedUnits = preview.valid * stats.segments

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  // ⚠️ "בחירת הכול" בוחרת רק את מי שמותר לבחור — לקוחה שהסירה את עצמה
  // לעולם אינה נכנסת לבחירה, גם לא דרך הקיצור הזה.
  const selectAll = () => setSelected(new Set(selectable.map(c => c.id)))
  const clearAll = () => setSelected(new Set())

  async function sendTest() {
    setTestResult(null); setError(null); setBusy(true)
    try {
      const res = await fetch('/api/admin/campaigns/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const data = await res.json()
      setTestResult(data.message ?? 'נשלח.')
    } catch {
      setError('שליחת הבדיקה נכשלה.')
    } finally { setBusy(false) }
  }

  async function runCampaign() {
    if (busy) return
    setBusy(true); setError(null); setConfirming(false)
    try {
      const created = await fetch('/api/admin/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body, customerIds: [...selected], client_request_id: requestId.current,
        }),
      })
      const c = await created.json()
      if (!created.ok) { setError(c.message ?? 'יצירת הקמפיין נכשלה.'); return }

      // ── אצווה אחר אצווה, סדרתית. בלי מאות בקשות במקביל. ──
      let guard = 0
      for (;;) {
        const res = await fetch(`/api/admin/campaigns/${c.campaignId}/send`, { method: 'POST' })
        const p = await res.json()
        if (!res.ok) { setError(p.message ?? 'השליחה נכשלה.'); return }
        setProgress(p)
        if (p.remaining === 0 || ++guard > 200) break
      }
      setDone(true)
      // מפתח חדש: הקמפיין הבא אינו retry של זה.
      requestId.current = crypto.randomUUID()
      router.refresh()
    } catch {
      setError('החיבור נכשל.')
    } finally { setBusy(false) }
  }

  const canSend = selected.size > 0 && !stats.error && !busy

  if (done) {
    return (
      <div className="bg-white border border-brand-linen-dark rounded-2xl p-5 space-y-3">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="text-sm text-brand-dark">
            <p className="font-medium mb-1">הקמפיין הסתיים.</p>
            {progress && (
              <p className="text-brand-muted">
                נשלחו {progress.sent} · נכשלו {progress.failed} · דולגו {progress.skipped}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setDone(false); setProgress(null); setBody(''); clearAll() }}
          className="inline-flex items-center justify-center h-11 px-4 rounded-xl border
                     border-brand-linen-dark text-sm font-medium text-brand-muted
                     hover:bg-brand-cream/50 transition-colors"
        >
          קמפיין נוסף
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── בחירת נמענות ── */}
      <section className="bg-white border border-brand-linen-dark rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-medium text-brand-dark">
            נמענות · נבחרו <span className="tabular-nums">{selected.size}</span> מתוך {selectable.length}
          </h2>
          <div className="flex gap-2">
            <button type="button" onClick={selectAll}
              className="h-9 px-3 rounded-lg border border-brand-linen-dark text-xs font-medium
                         text-brand-dark hover:bg-brand-cream/50 transition-colors">
              בחירת הכול
            </button>
            <button type="button" onClick={clearAll}
              className="h-9 px-3 rounded-lg border border-brand-linen-dark text-xs font-medium
                         text-brand-muted hover:bg-brand-cream/50 transition-colors">
              ניקוי הבחירה
            </button>
          </div>
        </div>

        <ul className="max-h-80 overflow-y-auto border border-brand-linen-dark rounded-xl
                       divide-y divide-brand-linen-dark">
          {candidates.map((c, i) => (
            <li key={c.id}>
              <label className={`flex items-center gap-2.5 p-3 transition-colors ${
                c.opted_out ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-brand-cream/30'}`}>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  disabled={c.opted_out}
                  onChange={() => toggle(c.id)}
                  className="w-4 h-4 accent-brand-rose shrink-0 disabled:cursor-not-allowed"
                />
                <span className="text-brand-muted tabular-nums text-xs w-7 shrink-0">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm text-brand-dark block truncate">{c.full_name}</span>
                  <span className="text-xs text-brand-muted" dir="ltr">
                    {formatPhoneForDisplay(c.phone_e164)}
                  </span>
                </span>
                {c.opted_out && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-brand-gold-text">
                    <BellOff className="w-3 h-3" aria-hidden="true" />
                    הסירה את עצמה מדיוור
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
        {optedOut.length > 0 && (
          <p className="text-xs text-brand-muted mt-2">
            {optedOut.length} לקוחות הסירו את עצמן מדיוור ואי אפשר לבחור אותן. הודעות על תור
            שקבעו ממשיכות להישלח אליהן כרגיל.
          </p>
        )}
      </section>

      {/* ── ההודעה ── */}
      <section className="bg-white border border-brand-linen-dark rounded-2xl p-5 space-y-3">
        <label htmlFor="campaignBody" className="block text-sm font-medium text-brand-dark">
          תוכן ההודעה
        </label>
        <textarea
          id="campaignBody"
          rows={4}
          value={body}
          onChange={e => setBody(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border border-brand-linen-dark bg-white
                     text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-rose/40"
        />

        <div className="flex items-center justify-between gap-3">
          <span className={`text-sm tabular-nums font-medium ${
            overProvider ? 'text-rose-700' : overOneUnit ? 'text-brand-gold-text' : 'text-brand-dark'}`}>
            {stats.chars} / {UCS2_SINGLE_MAX}
          </span>
          <span className="text-xs text-brand-muted">
            {stats.segments === 0 ? 'אין הודעה' : `${stats.segments} יחידות SMS לנמענת`}
          </span>
        </div>

        {/* ⚠️ אזהרה, לא חסימה. הטקסט אינו נחתך. */}
        {overOneUnit && !overProvider && (
          <div className="flex items-start gap-2 bg-brand-cream/60 border border-brand-cream-dark
                          rounded-xl p-3 text-sm text-brand-dark">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-brand-gold-text" aria-hidden="true" />
            <span>ההודעה חורגת מ-70 תווים ותישלח ביותר מיחידת SMS אחת.</span>
          </div>
        )}
        {overProvider && (
          <div role="alert" className="flex items-start gap-2 bg-rose-50 border border-rose-200
                                       rounded-xl p-3 text-sm text-rose-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              ההודעה הסופית היא {stats.chars} תווים וחורגת מהמקסימום של הספק
              ({PROVIDER_MAX_CHARS}). יש לקצר — הטקסט לא ייחתך אוטומטית.
            </span>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-brand-muted mb-1">
            כך תיראה ההודעה שתישלח (הקישור שונה לכל נמענת, באותו אורך):
          </p>
          <pre className="text-xs text-brand-dark bg-brand-cream/40 border border-brand-cream-dark
                          rounded-xl p-3 whitespace-pre-wrap break-words font-sans">
            {stats.preview}
          </pre>
        </div>
      </section>

      {/* ── Preview ── */}
      <section className="bg-white border border-brand-linen-dark rounded-2xl p-5">
        <h2 className="text-sm font-medium text-brand-dark mb-3">לפני שליחה</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-2 text-sm">
          <Stat label="סה״כ לקוחות" value={candidates.length} />
          <Stat label="נבחרו" value={selected.size} />
          <Stat label="מספרים תקינים וייחודיים" value={preview.valid} />
          <Stat label="הסירו את עצמן (מדולגות)" value={optedOut.length} />
          <Stat label="מספרים לא תקינים" value={preview.invalid} />
          <Stat label="כפולים" value={preview.duplicates} />
          <Stat label="תווים" value={stats.chars} />
          <Stat label="יחידות לנמענת" value={stats.segments} />
          <Stat label="סה״כ יחידות SMS משוער" value={estimatedUnits} emphasis />
        </dl>
      </section>

      {/* ── שליחה ── */}
      <section className="bg-white border border-brand-linen-dark rounded-2xl p-5 space-y-4">
        {testResult && (
          <div className="flex items-start gap-2 bg-brand-cream/60 border border-brand-cream-dark
                          rounded-xl p-3 text-sm text-brand-dark">
            <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{testResult}</span>
          </div>
        )}
        {error && (
          <div role="alert" className="flex items-start gap-2 bg-rose-50 border border-rose-200
                                       rounded-xl p-3 text-sm text-rose-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {progress && !done && (
          <p className="text-sm text-brand-muted tabular-nums">
            נשלחו {progress.sent} · נכשלו {progress.failed} · דולגו {progress.skipped} ·
            נותרו {progress.remaining}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button" onClick={sendTest} disabled={busy || Boolean(stats.error)}
            className="inline-flex items-center justify-center gap-2 h-12 px-4 rounded-xl border
                       border-brand-linen-dark text-sm font-medium text-brand-dark
                       hover:bg-brand-cream/50 transition-colors disabled:opacity-60"
          >
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
            שליחת הודעת בדיקה
          </button>

          {!confirming ? (
            <button
              type="button" onClick={() => setConfirming(true)} disabled={!canSend}
              className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl
                         bg-brand-dark text-white text-sm font-medium hover:bg-brand-dark/90
                         transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
              שליחה ל-{preview.valid} לקוחות
            </button>
          ) : (
            <div className="w-full bg-brand-cream/60 border border-brand-cream-dark rounded-xl p-3.5">
              <p className="text-sm text-brand-dark mb-3">
                לשלוח את ההודעה ל-<strong>{preview.valid}</strong> לקוחות?
                סה״כ כ-<strong>{estimatedUnits}</strong> יחידות SMS. הפעולה אינה הפיכה.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button" onClick={runCampaign} disabled={busy}
                  className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl
                             bg-brand-dark text-white text-sm font-medium disabled:opacity-60"
                >
                  {busy
                    ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />שולחת…</>
                    : 'כן, לשלוח'}
                </button>
                <button
                  type="button" onClick={() => setConfirming(false)} disabled={busy}
                  className="inline-flex items-center justify-center h-11 px-4 rounded-xl border
                             border-brand-linen-dark text-sm font-medium text-brand-muted"
                >
                  ביטול
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-brand-muted">
          כל הודעה כוללת את שם העסק וקישור הסרה אישי. לקוחה שתסיר את עצמה לא תקבל דיוור
          נוסף — והודעות על תור שקבעה ימשיכו להישלח אליה כרגיל.
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-brand-muted">{label}</dt>
      <dd className={`tabular-nums ${emphasis ? 'text-brand-dark font-semibold' : 'text-brand-dark'}`}>
        {value}
      </dd>
    </div>
  )
}
