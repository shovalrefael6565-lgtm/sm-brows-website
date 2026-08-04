/**
 * בדיקת session יתום מול פרויקט Supabase האמיתי + שרת dev שרץ מקומית
 * (npx next dev, פורט 3000) — מוודאת ש-middleware.ts + app/login/page.tsx
 * מונעים את לולאת ה-/login⇄/account שמתרחשת כש-cookie חתום כדין מצביע
 * לזהות שנמחקה מה-DB.
 *
 * יוצרת זהות בדיקה מזוהה בבירור (טלפון +972500000097, "TEST — session תקין"),
 * ומוחקת אותה + כל מה שהיא יצרה בסיום — גם אם בדיקה כלשהי נכשלת.
 *
 * דורש שרת dev פעיל בפורט 3000:  npx next dev
 * הרצה:  node scripts/test-orphaned-session-live.mjs
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { SignJWT } from 'jose'

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
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const BASE_URL = 'http://localhost:3000'
const results = []
const chk = (name, ok, extra = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`)
}

const secret = new TextEncoder().encode(env.SESSION_SECRET)
const sign = (sub, phone, role) =>
  new SignJWT({ phone, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret)

const PHONE = '+972500000097'
const NAME = 'TEST — session תקין (orphaned-session live check)'
let testUserId = null

try {
  // בדיקת חיבור לשרת dev לפני שממשיכים
  try {
    await fetch(BASE_URL)
  } catch {
    console.log(`✗ אין שרת dev זמין ב-${BASE_URL}. יש להריץ קודם: npx next dev`)
    process.exit(1)
  }

  // ── session יתום: userId חתום כדין שלא קיים בכלל ב-auth.users ───────────
  const orphanToken = await sign('00000000-0000-0000-0000-000000000000', '+972500000000', 'customer')

  {
    const res = await fetch(`${BASE_URL}/login`, {
      headers: { Cookie: `sm_session=${orphanToken}` },
      redirect: 'manual',
    })
    chk('session יתום ב-/login: מציג את מסך הכניסה (200, לא redirect)', res.status === 200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    chk('session יתום ב-/login: ה-cookie נמחק (Set-Cookie עם תוקף שפג)',
      /sm_session=;.*Expires=/.test(setCookie) || /sm_session=;.*Max-Age=0/.test(setCookie))
  }

  {
    // דמיון לגלישה אמיתית: cookie jar שמכבד Set-Cookie על פני הפניה
    let cookie = `sm_session=${orphanToken}`
    const res1 = await fetch(`${BASE_URL}/account`, { headers: { Cookie: cookie }, redirect: 'manual' })
    chk('session יתום ב-/account: הפניה בודדת ל-/login (307)',
      res1.status === 307 && res1.headers.get('location') === '/login')

    const setCookie = res1.headers.get('set-cookie')
    // /account לא ב-matcher של ה-middleware — הניקוי קורה ב-/login שבו נוחתים
    const nextCookie = setCookie?.includes('sm_session=;') ? '' : cookie
    const res2 = await fetch(`${BASE_URL}/login`, { headers: { Cookie: nextCookie }, redirect: 'manual' })
    chk('...וממשיך לעצור שם (200, לא עוד הפניה חזרה ל-/account) — אין לולאה',
      res2.status === 200)
  }

  // ── ניקוי לפני יצירת המשתמש התקין, למקרה של שאריות מהרצה קודמת ─────────
  const { data: existingUsers } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
  const stale = existingUsers.users.find(u => u.phone === PHONE.replace('+', ''))
  if (stale) {
    await db.from('admins').delete().eq('user_id', stale.id)
    await db.from('customers').delete().eq('id', stale.id)
    await db.auth.admin.deleteUser(stale.id)
  }

  // ── session תקין: לא נפגע ────────────────────────────────────────────────
  const { data: authUser, error: authErr } = await db.auth.admin.createUser({
    phone: PHONE.replace('+', ''),
    phone_confirm: true,
  })
  if (authErr) { console.log('✗ יצירת משתמש בדיקה נכשלה:', authErr.message); process.exit(1) }
  testUserId = authUser.user.id

  const { error: custErr } = await db.from('customers').insert({
    id: testUserId, phone_e164: PHONE, full_name: NAME,
  })
  if (custErr) { console.log('✗ יצירת customer נכשלה:', custErr.message); process.exit(1) }

  const validToken = await sign(testUserId, PHONE, 'customer')
  const res = await fetch(`${BASE_URL}/login`, {
    headers: { Cookie: `sm_session=${validToken}` },
    redirect: 'manual',
  })
  chk('session תקין (לקוחה קיימת) ב-/login: מפנה ל-/account, לא ל-/login',
    res.status === 307 && res.headers.get('location') === '/account')
  chk('session תקין: ה-cookie לא נמחק', !(res.headers.get('set-cookie') ?? '').includes('sm_session=;'))

  const failed = results.filter(r => !r).length
  console.log('\n' + '═'.repeat(60))
  console.log(failed === 0 ? `✓ כל ${results.length} הבדיקות עברו` : `✗ ${failed} בדיקות נכשלו`)
  process.exitCode = failed === 0 ? 0 : 1
} finally {
  if (testUserId) {
    await db.from('admins').delete().eq('user_id', testUserId)
    await db.from('customers').delete().eq('id', testUserId)
    await db.auth.admin.deleteUser(testUserId)
    console.log('✓ נתוני הבדיקה נוקו')
  }
}
