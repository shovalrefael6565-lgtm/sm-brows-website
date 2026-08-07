/**
 * שלב 12B — ריצה **מקבילה אמיתית** של ה-RPCs האטומיים, מול Supabase.
 *
 * ═══ למה הקובץ הזה קיים בנפרד ═══
 *
 * ⚠️ ל-PGlite יש חיבור אחד. אי אפשר להריץ בו שתי טרנזקציות שנחתכות זו בזו,
 * ולכן scripts/test-otp-atomic.mjs בודק את המנגנון ואת האינווריאנטות אבל
 * **אינו יכול להוכיח** שהנעילה עובדת תחת מקביליות. זה מה שנבדק כאן, מול
 * Postgres אמיתי עם חיבורים נפרדים ו-Promise.all.
 *
 * זו הבדיקה שמפילה את הפתרון שנדחה — "בעל ה-id הנמוך שולח". nextval() אינו
 * טרנזקציוני, ולכן id נמוך יכול לעשות commit אחרי id גבוה, ואז שתי הבקשות
 * רואות את עצמן כמנצחות ושולחות שתיהן.
 *
 * 🔒 **הקובץ הזה אינו שולח SMS.** הוא אינו מייבא ספק, אינו מייבא את lib/sms,
 * ואינו פותח שום חיבור מלבד Supabase. הוא קורא ל-RPCs בלבד.
 *
 * ⚠️ יוצר שורות otp_attempts עם מספרי בדיקה ומוחק את כולן בסיום, גם אם
 * בדיקה נכשלת. אינו נוגע בלקוחות, בתורים, ב-admins או בתזכורות.
 *
 * הרצה:  npm run test:live:otp-atomic
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const ENV_PATH = new URL('../.env.local', import.meta.url)
if (!existsSync(ENV_PATH)) {
  console.log('✗ לא נמצא קובץ .env.local')
  process.exit(1)
}
const env = {}
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const opts = { auth: { autoRefreshToken: false, persistSession: false } }

const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, opts)
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts)

const results = []
const chk = (name, ok = true, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}
const section = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 50 - t.length))}`)

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

/**
 * ⚠️ טווח ייעודי לבדיקה. הניקוי בסוף מוחק לפי הקידומת הזו בלבד, כדי
 * שלעולם לא תימחק שורה של מספר אמיתי.
 */
const TEST_PREFIX = '+97255510'
let seq = 0
const nextPhone = () => TEST_PREFIX + String(1000 + seq++).slice(-4)
const usedPhones = []
const phone = () => { const p = nextPhone(); usedPhones.push(p); return p }

const TEST_IPS = ['203.0.113.201', '203.0.113.202']

const issue = (p, o = {}) => svc.rpc('issue_otp_atomic', {
  p_phone_e164: p,
  p_purpose: o.purpose ?? 'login',
  p_code_hash: o.hash ?? HASH_A,
  p_ip: o.ip ?? null,
  p_ttl_seconds: 300,
  p_cooldown_seconds: 60,
  p_max_per_hour: 5,
  p_max_per_day: 10,
  p_max_per_ip_per_hour: 15,
})

const verify = (p, hash, o = {}) => svc.rpc('verify_otp_atomic', {
  p_phone_e164: p,
  p_purpose: o.purpose ?? 'login',
  p_candidate_hash: hash,
  p_max_attempts: 5,
})

const rowsFor = async p => {
  const { data } = await svc.from('otp_attempts').select('*')
    .eq('phone_e164', p).order('id')
  return data ?? []
}

async function cleanup() {
  section('ניקוי')
  let deleted = 0
  for (const p of usedPhones) {
    const { count } = await svc.from('otp_attempts')
      .delete({ count: 'exact' }).eq('phone_e164', p)
    deleted += count ?? 0
  }
  for (const ip of TEST_IPS) {
    const { count } = await svc.from('otp_attempts')
      .delete({ count: 'exact' }).eq('ip', ip).like('phone_e164', `${TEST_PREFIX}%`)
    deleted += count ?? 0
  }
  const { count: left } = await svc.from('otp_attempts')
    .select('id', { count: 'exact', head: true }).like('phone_e164', `${TEST_PREFIX}%`)
  chk('כל שורות הבדיקה נמחקו', (left ?? 0) === 0, `נמחקו ${deleted}, נותרו ${left ?? 0}`)
}

try {
  // ══════════════════════════════════════════════════════════════════════════
  section('הפונקציות קיימות ופועלות')
  // ══════════════════════════════════════════════════════════════════════════

  {
    const p = phone()
    const { data, error } = await issue(p)
    if (error) {
      chk('issue_otp_atomic קיימת ב-Supabase', false, error.message)
      console.log('\n⛔ 0013 כנראה לא הורצה. עוצר.')
      await cleanup()
      process.exit(1)
    }
    chk('issue_otp_atomic קיימת ופועלת', data?.allowed === true)
    chk('נוצרה שורה אחת', (await rowsFor(p)).length === 1)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 שתי הנפקות מקבילות לאותו מספר')
  // ══════════════════════════════════════════════════════════════════════════

  {
    const p = phone()
    // ⚠️ Promise.all — שתי בקשות שיוצאות יחד, שני חיבורים נפרדים.
    const [a, b] = await Promise.all([issue(p), issue(p)])

    const allowed = [a, b].filter(r => r.data?.allowed === true)
    const blocked = [a, b].filter(r => r.data?.allowed === false)

    chk('🔒 בדיוק אחת הותרה', allowed.length === 1,
      `allowed=${allowed.length} blocked=${blocked.length}`)
    chk('🔒 השנייה נחסמה ב-cooldown',
      blocked.length === 1 && blocked[0].data.reason === 'cooldown',
      JSON.stringify(blocked[0]?.data))
    chk('🔒 נוצרה שורת OTP אחת בלבד', (await rowsFor(p)).length === 1)
    chk('אין שגיאות', !a.error && !b.error, a.error?.message ?? b.error?.message ?? '')
  }

  {
    // חמש בקשות מקבילות — עדיין שורה אחת
    const p = phone()
    const rs = await Promise.all(Array.from({ length: 5 }, () => issue(p)))
    const allowed = rs.filter(r => r.data?.allowed === true).length
    chk('🔒 5 בקשות מקבילות → הנפקה אחת', allowed === 1, `allowed=${allowed}`)
    chk('🔒 ושורה אחת בטבלה', (await rowsFor(p)).length === 1)
    chk('כל השאר cooldown',
      rs.filter(r => r.data?.allowed === false).every(r => r.data.reason === 'cooldown'))
  }

  {
    /**
     * ⚠️ הבדיקה שמפילה את "בעל ה-id הנמוך שולח".
     *
     * עשר בקשות מקבילות. ה-id-ים מוקצים ע"י nextval לפי סדר תחילת ה-INSERT,
     * ולא לפי סדר ה-commit. אם ההכרעה נשענה על id, לפחות באחת ההרצות שתי
     * בקשות היו רואות את עצמן כמנצחות. עם advisory lock — אחת. תמיד.
     */
    let worstCase = 0
    for (let round = 0; round < 3; round++) {
      const p = phone()
      const rs = await Promise.all(Array.from({ length: 10 }, () => issue(p)))
      const allowed = rs.filter(r => r.data?.allowed === true).length
      const rows = (await rowsFor(p)).length
      worstCase = Math.max(worstCase, allowed, rows)
      chk(`🔒 סבב ${round + 1}: 10 מקבילות → הנפקה אחת ושורה אחת`,
        allowed === 1 && rows === 1, `allowed=${allowed} rows=${rows}`)
    }
    chk('🔒 בשלושת הסבבים אף פעם לא נוצרו שתי הנפקות', worstCase === 1)
  }

  {
    // מספרים שונים אינם חוסמים זה את זה — הנעילה ממוקדת
    const p1 = phone(), p2 = phone()
    const [a, b] = await Promise.all([issue(p1), issue(p2)])
    chk('מספרים שונים במקביל — שניהם מותרים',
      a.data?.allowed === true && b.data?.allowed === true)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 תקרת ה-IP תחת מקביליות')
  // ══════════════════════════════════════════════════════════════════════════

  {
    const ip = TEST_IPS[0]
    // 15 מספרים *שונים* מאותו IP — כל אחד עובר את ה-cooldown שלו
    const phones = Array.from({ length: 15 }, () => phone())
    for (const p of phones) {
      const { data } = await issue(p, { ip })
      if (!data?.allowed) { chk('הכנת מצב ה-IP', false, JSON.stringify(data)); break }
    }

    // ⚠️ עכשיו 20 בקשות מקבילות, כל אחת ממספר חדש, מאותו IP
    const fresh = Array.from({ length: 20 }, () => phone())
    const rs = await Promise.all(fresh.map(p => issue(p, { ip })))
    const allowed = rs.filter(r => r.data?.allowed === true).length

    chk('🔒 מספרים שונים מאותו IP אינם עוקפים את תקרת ה-IP',
      allowed === 0, `הותרו ${allowed} מתוך 20`)
    chk('🔒 כולן נדחו בסיבת ip_limit',
      rs.every(r => r.data?.reason === 'ip_limit'),
      [...new Set(rs.map(r => r.data?.reason))].join(','))

    // IP אחר ממשיך לעבוד — התקרה ממוקדת ואינה גורפת
    const { data: other } = await issue(phone(), { ip: TEST_IPS[1] })
    chk('IP אחר אינו מושפע', other?.allowed === true)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 אימות תחת מקביליות')
  // ══════════════════════════════════════════════════════════════════════════

  {
    // חמישה ניחושים שגויים במקביל — חייבים להיספר כחמישה
    const p = phone()
    await issue(p, { hash: HASH_A })
    await Promise.all(Array.from({ length: 5 }, () => verify(p, HASH_B)))

    const row = (await rowsFor(p))[0]
    chk('🔒 5 ניחושים מקבילים נספרו כ-5', row.attempts === 5, `attempts=${row.attempts}`)
    chk('🔒 והקוד הנכון כבר נעול',
      (await verify(p, HASH_A)).data?.result === 'too_many')
    chk('הקוד לא נצרך בנעילה', row.consumed_at === null)
  }

  {
    // עשרה ניחושים מקבילים — הנעילה מחזיקה, המונה אינו חורג
    const p = phone()
    await issue(p, { hash: HASH_A })
    const rs = await Promise.all(Array.from({ length: 10 }, () => verify(p, HASH_B)))
    const row = (await rowsFor(p))[0]

    chk('🔒 10 ניחושים מקבילים — המונה נעצר בתקרה', row.attempts === 5,
      `attempts=${row.attempts}`)
    const tooMany = rs.filter(r => r.data?.result === 'too_many').length
    chk('🔒 חלק מהניסיונות נדחו כ-too_many', tooMany >= 5, `too_many=${tooMany}`)
    chk('🔒 אף ניסיון לא הצליח', rs.every(r => r.data?.result !== 'ok'))
  }

  {
    // 🔒 שני אימותים נכונים במקביל — רק אחד מצליח
    for (let round = 0; round < 3; round++) {
      const p = phone()
      await issue(p, { hash: HASH_A })
      const rs = await Promise.all([verify(p, HASH_A), verify(p, HASH_A)])
      const ok = rs.filter(r => r.data?.result === 'ok').length
      chk(`🔒 סבב ${round + 1}: שני אימותים נכונים מקבילים → הצלחה אחת`,
        ok === 1, `ok=${ok} results=${rs.map(r => r.data?.result).join(',')}`)
    }
  }

  {
    // עשרה אימותים נכונים במקביל
    const p = phone()
    await issue(p, { hash: HASH_A })
    const rs = await Promise.all(Array.from({ length: 10 }, () => verify(p, HASH_A)))
    const ok = rs.filter(r => r.data?.result === 'ok').length
    chk('🔒 10 אימותים נכונים מקבילים → הצלחה אחת בדיוק', ok === 1, `ok=${ok}`)
    chk('🔒 קוד שנצרך אינו ניתן לשימוש חוזר',
      (await verify(p, HASH_A)).data?.result === 'no_code')
  }

  {
    // הנפקה ואימות במקביל — אין קריאה של שורה חצי-כתובה
    const p = phone()
    await issue(p, { hash: HASH_A })
    const [v] = await Promise.all([verify(p, HASH_A), issue(p, { hash: HASH_B })])
    chk('הנפקה ואימות במקביל אינם קורסים', !v.error, v.error?.message ?? '')
    chk('הקוד הראשון אומת', v.data?.result === 'ok')
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 ביטול הנפקה תחת מקביליות')
  // ══════════════════════════════════════════════════════════════════════════

  const discard = (otpId, p, purpose = 'login') =>
    svc.rpc('discard_otp_issue_atomic', {
      p_otp_id: otpId, p_phone_e164: p, p_purpose: purpose,
    })

  {
    /**
     * ⚠️ הדרישה: שתי בקשות מקבילות, אחת נכשלת ואחת מצליחה, אינן גורמות
     * למחיקת השורה המצליחה.
     *
     * ההגנה המבנית: הבקשה שנחסמה לא יצרה שורה ולכן אין לה otp_id למחוק.
     * כאן זה נבדק תחת מקביליות אמיתית, ולא רק כטענה.
     */
    for (let round = 0; round < 3; round++) {
      const p = phone()
      const [a, b] = await Promise.all([issue(p), issue(p)])

      const winner = [a, b].find(r => r.data?.allowed === true)
      const loser = [a, b].find(r => r.data?.allowed === false)

      chk(`סבב ${round + 1}: אחת ניצחה ואחת נחסמה`,
        Boolean(winner) && Boolean(loser))
      chk(`🔒 סבב ${round + 1}: הנחסמת לא קיבלה otp_id`,
        loser?.data?.otp_id === undefined, JSON.stringify(loser?.data))

      // ⚠️ הבקשה שנכשלה מנסה לנקות. אין לה מזהה, ולכן היא לא יכולה לגעת
      // בשורה של המנצחת — גם אם הקוד היה מנסה.
      const rows = await rowsFor(p)
      chk(`🔒 סבב ${round + 1}: שורת המנצחת שרדה`,
        rows.length === 1 && String(rows[0].id) === String(winner.data.otp_id),
        `rows=${rows.length}`)
    }
  }

  {
    // ניקוי אמיתי משחרר את ה-cooldown ואת המכסות
    const p = phone()
    const { data: issued } = await issue(p)
    const { data: blocked } = await issue(p)
    chk('לפני הניקוי — cooldown', blocked?.reason === 'cooldown')

    const { data: d } = await discard(issued.otp_id, p)
    chk('🔒 הניקוי הצליח', d?.result === 'discarded', JSON.stringify(d))
    chk('🔒 השורה נמחקה', (await rowsFor(p)).length === 0)

    const { data: after } = await issue(p)
    chk('🔒 אחרי הניקוי אין cooldown ואין ספירה במכסות', after?.allowed === true)
  }

  {
    // ניקוי וניקוי מקבילים על אותה שורה — מחיקה אחת, בלי שגיאה
    const p = phone()
    const { data: issued } = await issue(p)
    const rs = await Promise.all([
      discard(issued.otp_id, p), discard(issued.otp_id, p), discard(issued.otp_id, p),
    ])
    const discarded = rs.filter(r => r.data?.result === 'discarded').length
    chk('🔒 3 ניקויים מקבילים → מחיקה אחת', discarded === 1, `discarded=${discarded}`)
    chk('🔒 השאר קיבלו not_found ולא שגיאה',
      rs.filter(r => r.data?.result === 'not_found').length === 2 && rs.every(r => !r.error))
  }

  {
    /**
     * ניקוי במקביל לאימות נכון — **מרוץ אמיתי על אותה נעילה**.
     *
     * ⚠️ אין כאן סדר מובטח, ולכן אסור לקבע אחד משני הענפים. גרסה קודמת של
     * הבדיקה הזו טענה "האימות הצליח", עברה פעם אחת במקרה, ונפלה בהרצה
     * הבאה כשה-discard תפס את הנעילה ראשון. בדיקה שתלויה בתזמון היא בדיקה
     * שתדווח על באג שאינו קיים.
     *
     * שני הענפים תקינים; מה שחייב להתקיים הוא האינווריאנטה:
     *
     *   verify ראשון  → ok      · discard מסרב (consumed) · השורה שורדת עם consumed_at
     *   discard ראשון → נמחקה   · verify מקבל no_code     · אפס שורות
     *
     * 🔒 **מה שאסור לקרות: אימות שהצליח ושורה שנמחקה בכל זאת.** זה היה
     * אומר שמחקנו קוד שהלקוחה בדיוק נכנסה איתו.
     *
     * ⚠️ בזרימה האמיתית המרוץ הזה אינו יכול לקרות בכלל: discard רץ רק כאשר
     * הוכח שה-SMS לא נמסר, ולכן הקוד הזה אינו יכול להיות בידי הלקוחה.
     * הבדיקה בונה אותו במכוון כדי לאמת שגם המצב הבלתי אפשרי הזה בטוח.
     */
    for (let round = 0; round < 3; round++) {
      const p = phone()
      const { data: issued } = await issue(p, { hash: HASH_A })
      const [v, d] = await Promise.all([verify(p, HASH_A), discard(issued.otp_id, p)])

      const verified = v.data?.result === 'ok'
      const removed = d.data?.result === 'discarded'
      const rows = await rowsFor(p)

      chk(`🔒 סבב ${round + 1}: לא ייתכן אימות שהצליח ושורה שנמחקה`,
        !(verified && removed),
        `verify=${v.data?.result} discard=${d.data?.result}`)

      if (verified) {
        chk(`   סבב ${round + 1}: verify ניצח → discard סירב, הראיה נשמרה`,
          ['consumed', 'not_found'].includes(d.data?.result) &&
          rows.length === 1 && rows[0].consumed_at !== null,
          `discard=${d.data?.result} rows=${rows.length}`)
      } else {
        chk(`   סבב ${round + 1}: discard ניצח → השורה נמחקה, verify=no_code`,
          removed && v.data?.result === 'no_code' && rows.length === 0,
          `verify=${v.data?.result} rows=${rows.length}`)
      }

      chk(`   סבב ${round + 1}: אין שגיאות משתי הקריאות`, !v.error && !d.error,
        v.error?.message ?? d.error?.message ?? '')
    }
  }

  {
    /**
     * ⚠️ 0014 — התרחיש המלא, בשני סדרי הנעילה.
     *
     *   1. קוד A בידי הלקוחה.
     *   2. מונפק קוד B; 019 מחזירה כשל ודאי.
     *   3. הלקוחה מקלידה את A **בדיוק** כשה-discard של B יוצא.
     *
     * עד 0014 הענף שבו ה-verify הקדים היה משאיר את B תקועה: ההקלדה של A
     * נפלה על B (היא האחרונה), attempts עלה, וה-discard סירב עם 'attempted'.
     * הלקוחה נשארה בלי קוד שמיש בכלל.
     *
     * 🔒 האינווריאנטה שחייבת להתקיים בשני הסדרים: **B אינה נשארת תקועה,
     * ו-A שמישה.**
     */
    for (let round = 0; round < 3; round++) {
      const p = phone()

      // קוד A — ישן יותר, בידי הלקוחה
      const { data: aRow } = await svc.from('otp_attempts').insert({
        phone_e164: p, code_hash: HASH_A, purpose: 'login',
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        created_at: new Date(Date.now() - 120_000).toISOString(),
      }).select('id').single()

      // קוד B — הונפק ולא נמסר
      const { data: b } = await issue(p, { hash: HASH_B })

      // ⚠️ המרוץ: הקלדת A מול הניקוי של B
      const [v, d] = await Promise.all([verify(p, HASH_A), discard(b.otp_id, p)])

      const rows = await rowsFor(p)
      const bGone = !rows.some(r => String(r.id) === String(b.otp_id))
      const aAlive = rows.some(r => String(r.id) === String(aRow.id) && r.consumed_at === null)

      chk(`🔒 סבב ${round + 1}: B לא נשארה תקועה`, bGone,
        `verify=${v.data?.result} discard=${d.data?.result} rows=${rows.length}`)

      // 🔒 המבחן האמיתי: אחרי ששני המסלולים הסתיימו, A שמישה
      if (aAlive) {
        const { data: after } = await verify(p, HASH_A)
        chk(`🔒 סבב ${round + 1}: **A ניתנת לאימות אחרי המרוץ**`,
          after?.result === 'ok', `result=${after?.result}`)
      } else {
        // הענף שבו ה-verify הקדים ו-A כבר נצרכה — גם הוא תקין
        chk(`🔒 סבב ${round + 1}: A נצרכה כבר במרוץ עצמו`,
          v.data?.result === 'ok', `verify=${v.data?.result}`)
      }

      chk(`   סבב ${round + 1}: אין שגיאות`, !v.error && !d.error,
        v.error?.message ?? d.error?.message ?? '')
    }
  }

  {
    // ⚠️ 2. ניסיון שגוי מגדיל attempts, ואז discard מוחק — סדרתי, בלי מרוץ
    const p = phone()
    const { data: issued } = await issue(p, { hash: HASH_A })
    await verify(p, HASH_B)
    const before = (await rowsFor(p))[0]
    chk('2. ניסיון שגוי העלה attempts', before.attempts === 1, `attempts=${before.attempts}`)

    const { data: d } = await discard(issued.otp_id, p)
    chk('🔒 2. שורה עם attempts>0 נמחקת (0014)', d?.result === 'discarded', JSON.stringify(d))
    chk('   ולא נשארה', (await rowsFor(p)).length === 0)
  }

  {
    // ⚠️ 4. discard קודם, ואז אימות של A מצליח
    const p = phone()
    const { data: aRow } = await svc.from('otp_attempts').insert({
      phone_e164: p, code_hash: HASH_A, purpose: 'login',
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      created_at: new Date(Date.now() - 120_000).toISOString(),
    }).select('id').single()
    const { data: b } = await issue(p, { hash: HASH_B })

    const { data: d } = await discard(b.otp_id, p)
    chk('4. B נמחקה', d?.result === 'discarded')
    const { data: v } = await verify(p, HASH_A)
    chk('🔒 4. אחרי הניקוי — A מאומתת בהצלחה', v?.result === 'ok', JSON.stringify(v))
    void aRow
  }

  {
    // 🔒 ניקוי של otp_id ישן אינו נוגע בשורה חדשה יותר
    const p = phone()
    const { data: older } = await issue(p)
    await svc.from('otp_attempts')
      .update({ created_at: new Date(Date.now() - 300_000).toISOString() })
      .eq('id', older.otp_id)
    const { data: newer } = await issue(p)
    chk('הונפקה שורה חדשה יותר', newer?.allowed === true)

    const { data: d } = await discard(older.otp_id, p)
    chk('🔒 ניקוי של מזהה ישן מסורב כ-superseded', d?.result === 'superseded',
      JSON.stringify(d))
    const rows = await rowsFor(p)
    chk('🔒 שתי השורות שרדו', rows.length === 2)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 anon ו-authenticated חסומים בפועל')
  // ══════════════════════════════════════════════════════════════════════════

  {
    const blocked = err => Boolean(err) && (
      err.message.includes('Could not find the function') ||
      err.message.includes('permission denied') ||
      err.code === 'PGRST202' || err.code === '42501')

    const p = phone()

    const a1 = await anon.rpc('issue_otp_atomic', {
      p_phone_e164: p, p_purpose: 'login', p_code_hash: HASH_A, p_ip: null,
      p_ttl_seconds: 300, p_cooldown_seconds: 60,
      p_max_per_hour: 5, p_max_per_day: 10, p_max_per_ip_per_hour: 15,
    })
    chk('🔒 anon אינו יכול להפעיל את issue_otp_atomic', blocked(a1.error),
      a1.error?.message ?? 'הצליח!')

    const a2 = await anon.rpc('verify_otp_atomic', {
      p_phone_e164: p, p_purpose: 'login', p_candidate_hash: HASH_A, p_max_attempts: 5,
    })
    chk('🔒 anon אינו יכול להפעיל את verify_otp_atomic', blocked(a2.error),
      a2.error?.message ?? 'הצליח!')

    const a3 = await anon.rpc('otp_hash_equals', { p_left: HASH_A, p_right: HASH_A })
    chk('🔒 anon אינו יכול להפעיל את otp_hash_equals', blocked(a3.error),
      a3.error?.message ?? 'הצליח!')

    // ⚠️ 9. פעולת הניקוי מוחקת שורות — היא הרגישה מכולן.
    const a5 = await anon.rpc('discard_otp_issue_atomic', {
      p_otp_id: 1, p_phone_e164: p, p_purpose: 'login',
    })
    chk('🔒 9. anon אינו יכול להפעיל את discard_otp_issue_atomic', blocked(a5.error),
      a5.error?.message ?? 'הצליח!')

    const a6 = await anon.from('otp_attempts').delete().eq('phone_e164', p)
    chk('🔒 anon אינו יכול למחוק שורות otp_attempts ישירות',
      Boolean(a6.error) || (await rowsFor(p)).length === 0,
      a6.error?.message ?? '')

    const a4 = await anon.from('otp_attempts').select('id').limit(1)
    chk('🔒 anon אינו רואה שורות otp_attempts',
      Boolean(a4.error) || (a4.data ?? []).length === 0,
      a4.error?.message ?? `rows=${(a4.data ?? []).length}`)

    chk('⚠️ אף אחד מהניסיונות לא יצר שורה', (await rowsFor(p)).length === 0)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('🔒 אין PII בתוצאות')
  // ══════════════════════════════════════════════════════════════════════════

  {
    const p = phone()
    const { data: issued } = await issue(p, { ip: TEST_IPS[1] })
    const { data: verified } = await verify(p, HASH_B)
    const blob = JSON.stringify(issued) + JSON.stringify(verified)

    chk('⚠️ אין מספר טלפון בתוצאות', !blob.includes(p), blob)
    chk('⚠️ אין גיבוב בתוצאות', !blob.includes(HASH_A) && !blob.includes(HASH_B))
    chk('⚠️ אין IP בתוצאות', !blob.includes(TEST_IPS[1]))
    chk('⚠️ אין שדות attempts/phone/hash', !/attempts|phone|hash|"ip"/i.test(blob), blob)
  }
} catch (err) {
  chk('הרצה ללא חריגה', false, err.message)
} finally {
  await cleanup()
}

const failed = results.filter(r => !r).length
console.log('\n' + '═'.repeat(60))
console.log(failed === 0
  ? `✓ כל ${results.length} הבדיקות עברו`
  : `✗ ${failed} מתוך ${results.length} נכשלו`)
console.log('🔒 לא נשלח SMS. הקובץ הזה אינו מייבא ספק ואינו נוגע ב-lib/sms.')
process.exit(failed === 0 ? 0 : 1)
