-- ============================================================================
-- 0015 — שלב 14: ביטול session בצד השרת (revocation)
--
-- תלוי ב-0001 (auth.users קיים) בלבד. **אינו נוגע ב-0002–0014**: אין כאן
-- ALTER על טבלה קיימת, אין עמודה חדשה בטבלה קיימת, אין שינוי RLS קיים,
-- אין נגיעה ב-OTP, ואין נגיעה במערכת התזכורות.
--
-- ─── מה נשבר לפני המיגרציה הזו ─────────────────────────────────────────────
--
-- ה-session היה JWT חתום ותו לא. `destroySession` מחקה את ה-cookie
-- מהדפדפן — וזו הפעולה **היחידה** שהתרחשה בהתנתקות.
--
-- ⚠️ המשמעות: מי שהעתיק את ערך ה-cookie לפני ההתנתקות המשיך להיות מחובר
-- עד 30 יום. ה-token נשאר חתום כדין, `sub` שלו הצביע על auth user קיים,
-- ו-`isAdmin()` המשיכה להחזיר true עבורו — ולכן הוא עבר את **כל** שערי
-- הגישה, כולל `/admin`. logout לא היה אירוע אבטחה, אלא ניקוי מקומי בלבד.
--
-- ⚠️ שום בדיקה קיימת לא כיסתה את זה, כי כולן שואלות "מי אתה" (admins,
-- customers.auth_user_id) ואף אחת לא שאלה "האם ה-session הזה עדיין חי".
--
-- ─── מה הטבלה הזו מוסיפה ───────────────────────────────────────────────────
--
-- לכל JWT מונפק כעת מזהה ייחודי (`jti`), ולו רשומה מקבילה כאן. אימות
-- session דורש מעכשיו **שני** תנאים בלתי תלויים: חתימה תקפה *וגם* רשומה
-- חיה. logout מסמן `revoked_at`, והעותק שנגנב מפסיק לעבוד באותו רגע —
-- בלי קשר לכמה זמן נותר ל-JWT.
--
-- ─── למה לא tokenVersion / סוד מתחלף ───────────────────────────────────────
--
-- שתי חלופות נשקלו ונדחו:
--
--   • עמודת "דור" על המשתמש שעולה בכל logout — הייתה מנתקת את *כל*
--     המכשירים של אותה משתמשת בכל התנתקות. שורה לכל session שומרת על
--     הפרדת מכשירים: התנתקות בטלפון אינה מפילה את הדפדפן בבית.
--
--   • החלפת SESSION_SECRET בכל logout — הייתה מנתקת את **כל המשתמשות
--     במערכת** בכל התנתקות של מישהי. הסוד מוחלף פעם אחת בלבד, במעבר
--     לשלב 14, כדי להרוג לצמיתות את ה-JWT-ים שהונפקו לפני ה-jti.
--
-- ─── אין כאן RPC, ובכוונה ──────────────────────────────────────────────────
--
-- 0013 הצדיקה RPC אטומי כי שם היה read-then-write אמיתי (בדיקת מגבלות ואז
-- הכנסה) ששתי בקשות מקבילות שברו. כאן אין דבר כזה: כל פעולה היא משפט SQL
-- יחיד — INSERT אחד בכניסה, SELECT אחד באימות, UPDATE אחד בהתנתקות.
-- משפט יחיד הוא ממילא אטומי, ונעילה מפורשת לא הייתה מוסיפה שום הבטחה.
-- ============================================================================


-- ─── הטבלה ──────────────────────────────────────────────────────────────────

create table public.app_sessions (
  -- ה-jti של ה-JWT. לא נגזר משום דבר ולא ניתן לניחוש — crypto.randomUUID().
  --
  -- ⚠️ נשמר גלוי ולא מגובב, **בכוונה**: הערך הזה אינו סוד בפני עצמו.
  -- מי שמחזיק jti בלבד אינו יכול לבנות ממנו token — הוא היה צריך גם את
  -- SESSION_SECRET כדי לחתום. זה בדיוק ההפך מ-otp_attempts.code_hash,
  -- ששם הערך עצמו הוא מה שמוכיח זהות ולכן חייב להיות מגובב.
  id            uuid primary key,

  -- ⚠️ auth.users, לא customers. ה-session מזוהה מול חשבון ההתחברות
  -- (JWT.sub), ומאז שלב 10 זה מזהה שונה ממזהה הלקוחה.
  --
  -- CASCADE ולא SET NULL — כאן זה הפוך מ-customers.auth_user_id (0010):
  -- שם המחיקה אסור שתפגע בישות עסקית והיסטוריה, וכאן אין ישות עסקית —
  -- מחיקת חשבון ההתחברות *חייבת* להרוג את כל ה-sessions שלו מיד.
  auth_user_id  uuid not null references auth.users(id) on delete cascade,

  -- רמז לניתוב שנחתם ב-JWT, נשמר כאן כדי שאפשר יהיה להצליב. אם ה-token
  -- אומר 'admin' והשורה אומרת 'customer' — ה-session נדחה. הגנה לעומק
  -- בלבד: ההרשאה עצמה תמיד נבדקת מול טבלת admins (lib/auth/adminGuard.ts).
  role          text not null check (role in ('customer', 'admin')),

  created_at    timestamptz not null default now(),

  -- ⚠️ אמור להיות זהה ל-exp של ה-JWT. אינו מחליף אותו — jose דוחה token
  -- שפג תוקפו עוד לפני שמגיעים לכאן. זו הגנה שנייה, למקרה שהשעונים או
  -- הקוד ייפרדו: session פג תוקף נדחה גם אם החתימה מתקבלת.
  expires_at    timestamptz not null,

  -- NULL = חי. ההתנתקות ממלאת אותו. אין כאן מחיקת שורה: השורה המבוטלת
  -- היא הראיה שהביטול קרה, והיא נמחקת רק אחרי שפג התוקף ממילא.
  revoked_at    timestamptz,

  constraint app_sessions_expiry_after_creation check (expires_at > created_at)
);

comment on table public.app_sessions is
  'שלב 14 — רשומת session בצד השרת. logout מסמן revoked_at, וכך JWT שהועתק לפני ההתנתקות מפסיק לעבוד מיד ולא ממתין לפקיעת התוקף.';
comment on column public.app_sessions.id is
  'ה-jti של ה-JWT. אינו סוד: בלי SESSION_SECRET אי אפשר לחתום token סביבו.';
comment on column public.app_sessions.revoked_at is
  'NULL = session חי. מתמלא ב-logout ולעולם אינו חוזר ל-NULL.';

-- לניקוי ה-opportunistic (מחיקת שורות שפג תוקפן) — הוא סורק לפי העמודה הזו
create index app_sessions_expires_at_idx on public.app_sessions (expires_at);

-- ⚠️ אינו משרת את מסלול האימות (שהוא lookup לפי מפתח ראשי), אלא את
-- היכולת לנתק משתמשת אחת מכל מכשיריה — צעד תגובה לחשד לדליפה, שבלי
-- האינדקס הזה היה סריקה מלאה.
create index app_sessions_auth_user_id_idx on public.app_sessions (auth_user_id);


-- ─── הרשאות ─────────────────────────────────────────────────────────────────
--
-- 🔒 RLS מופעל ויש **אפס policies** — בדיוק כמו otp_attempts ב-0001.
-- תפקיד שאינו עוקף RLS מקבל אפס שורות ואינו יכול לכתוב, גם אם איכשהו
-- קיבל הרשאת טבלה.
--
-- ⚠️ ה-REVOKE המפורש מ-anon ומ-authenticated אינו מיותר, וזה בדיוק הלקח
-- של 0006: בפרויקט Supabase קיימות default privileges שמעניקות הרשאות על
-- אובייקטים חדשים בסכמה public **ישירות** לתפקידים האלה. בלי השורה הזו
-- הטבלה הייתה נגישה דרך מפתח ה-anon שממילא נשלח לדפדפן, ו-RLS היה הנכס
-- היחיד שמגן עליה. שתי שכבות בלתי תלויות, לא אחת.

alter table public.app_sessions enable row level security;

revoke all on table public.app_sessions from public;
revoke all on table public.app_sessions from anon;
revoke all on table public.app_sessions from authenticated;

grant select, insert, update, delete on table public.app_sessions to service_role;


-- ─── assertion ──────────────────────────────────────────────────────────────
--
-- נכשל ברעש אם מישהו יפרוס את המיגרציה על סכמה שאינה מה שציפינו לה, או
-- ישנה בעתיד את אחת ההנחות שהאבטחה כאן נשענת עליהן.

do $$
begin
  if not exists (
    select 1 from pg_class
    where oid = 'public.app_sessions'::regclass and relrowsecurity
  ) then
    raise exception '0015: RLS אינו מופעל על app_sessions';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_sessions') then
    raise exception '0015: נמצאה policy על app_sessions — הטבלה אמורה להיות סגורה לחלוטין לתפקידי ה-API';
  end if;

  if has_table_privilege('anon', 'public.app_sessions', 'select')
     or has_table_privilege('anon', 'public.app_sessions', 'insert')
     or has_table_privilege('anon', 'public.app_sessions', 'update')
     or has_table_privilege('anon', 'public.app_sessions', 'delete') then
    raise exception '0015: ל-anon יש הרשאה על app_sessions';
  end if;

  if has_table_privilege('authenticated', 'public.app_sessions', 'select')
     or has_table_privilege('authenticated', 'public.app_sessions', 'insert')
     or has_table_privilege('authenticated', 'public.app_sessions', 'update')
     or has_table_privilege('authenticated', 'public.app_sessions', 'delete') then
    raise exception '0015: ל-authenticated יש הרשאה על app_sessions';
  end if;

  if not has_table_privilege('service_role', 'public.app_sessions', 'insert')
     or not has_table_privilege('service_role', 'public.app_sessions', 'select')
     or not has_table_privilege('service_role', 'public.app_sessions', 'update')
     or not has_table_privilege('service_role', 'public.app_sessions', 'delete') then
    raise exception '0015: ל-service_role חסרה הרשאה על app_sessions';
  end if;
end $$;
