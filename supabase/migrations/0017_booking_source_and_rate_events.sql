-- ============================================================================
-- 0017 — מקור הבקשה + טבלת אירועי הגבלת קצב
--
-- ⚠️ תלוי ב-0016 שכבר רץ ו-commit (ראה ההסבר שם). הקובץ הזה **אינו** משתמש
-- בערך 'rejected' — התלות היא סדר הרצה בלבד, לא שימוש.
--
-- אין כאן שום ALTER/DROP על מה שנוצר ב-0001–0015. רק:
--   • טיפוס חדש booking_source
--   • עמודה חדשה, nullable, על appointments
--   • טבלה חדשה booking_rate_events
--
-- ⚠️ אין נגיעה ב-appointments_no_overlap. ההגנה מפני חפיפה נשארת בדיוק
-- כפי שהיא — שינוי ה-constraint נדחה במלואו לשלב 15E.
-- ============================================================================

-- ─── מקור הבקשה ────────────────────────────────────────────────────────────
--
-- טיפוס *חדש* (CREATE TYPE), ולכן מותר להשתמש בו מיד באותה טרנזקציה —
-- בניגוד ל-ALTER TYPE ADD VALUE. אותו שיקול בדיוק כמו calendar_sync_operation
-- ב-0005.
-- ⚠️ מוסמך ל-public במפורש, בדיוק כמו ב-0016. ה-search_path של ה-SQL
-- Editor אינו כולל public, ו-CREATE TYPE לא מוסמך היה יוצר את הטיפוס
-- ב-pg_catalog **בלי לזרוק שגיאה** — סכמה שגויה בשקט.
create type public.booking_source as enum (
  'public_booking',  -- הטופס הציבורי ב-/booking, ללא התחברות
  'personal_area',   -- האזור האישי של לקוחה מחוברת (נכנס לשימוש ב-15D)
  'admin_manual'     -- תור שהמנהלת יצרה מתוך מערכת הניהול
);

-- ⚠️ nullable **ובלי DEFAULT**, בכוונה.
--
-- DEFAULT 'public_booking' היה מתייג בשקט כל תור שנוצר במסלול שאינו מעדכן
-- את העמודה — כולל תורים ידניים של המנהלת — בתווית שגויה. עמודה ריקה
-- אומרת "לא נרשם", וזו האמת לגבי כל מה שנוצר לפני 0017. תווית שגויה
-- גרועה מהיעדר תווית.
--
-- כל מסלול יצירה מציב את הערך במפורש: המסלול הציבורי ב-0018, התור הידני
-- ב-create_manual_appointment (מוחלף ב-0018), והאזור האישי ב-15D.
alter table public.appointments
  add column booking_source public.booking_source;

comment on column public.appointments.booking_source is
  'מאיזה מסלול הגיעה הבקשה. null = נוצר לפני 0017 ולא נרשם. אין backfill — אי אפשר לדעת בדיעבד.';

create index appointments_booking_source_idx
  on public.appointments (booking_source)
  where booking_source is not null;


-- ============================================================================
-- אירועי הגבלת קצב להזמנה ציבורית
--
-- ═══ למה טבלה נפרדת ולא otp_attempts ═══
--
--   1. **תקציב משותף.** otp_attempts מזינה מגבלת IP של 15/שעה (0013).
--      ספירת הזמנות באותה טבלה הייתה גורמת לתנועת הזמנות לשרוף את מכסת
--      ה-OTP ולהפך — שתי מערכות שחונקות זו את זו בלי קשר ביניהן.
--
--   2. **סמנטיקה.** אנחנו סופרים יצירות הזמנה, לא שליחות SMS.
--
--   3. **פרטיות.** הוספת ip ל-appointments הייתה קושרת כתובת IP לכרטיס
--      הלקוחה לצמיתות. הטבלה הזו מכילה **אך ורק** כתובת וזמן: אין
--      customer_id, אין טלפון, אין appointment_id, אין user agent.
--      שורה כאן אינה ניתנת לשיוך ללקוחה מסוימת.
--
-- ═══ שמירה ═══
--
-- אין Cron בפרויקט ואיננו מוסיפים אחד. הניקוי הוא **אופורטוניסטי**, בתוך
-- אותו RPC שסופר (0018): כל קריאה מוחקת שורות ישנות. הטבלה מתחזקת את
-- עצמה, וגודלה חסום בקירוב במספר ההזמנות בשעתיים.
-- ============================================================================

create table public.booking_rate_events (
  id         bigserial primary key,
  ip         inet not null,
  created_at timestamptz not null default now()
);

comment on table public.booking_rate_events is
  'ספירת יצירות הזמנה ציבוריות לפי IP, למגבלת קצב בלבד. אין כאן שום מזהה לקוחה. ניקוי אופורטוניסטי ב-0018, ללא Cron.';

-- החיפוש היחיד: כמה שורות ל-IP הזה מאז זמן מסוים.
create index booking_rate_events_ip_created_idx
  on public.booking_rate_events (ip, created_at desc);

-- לניקוי האופורטוניסטי — מחיקה לפי גיל, בלי סריקה מלאה.
create index booking_rate_events_created_idx
  on public.booking_rate_events (created_at);

-- ⚠️ RLS מופעל ו**אפס policies**, בדיוק כמו otp_attempts (0001): הטבלה
-- נגישה ל-service_role בלבד. אין כאן מה לחשוף ללקוחה ואין מה לחשוף
-- למנהלת — זו טבלה תפעולית טהורה.
alter table public.booking_rate_events enable row level security;


-- ─── אימות ─────────────────────────────────────────────────────────────────
-- נכשל בקול אם משהו לא נוצר כמצופה, במקום להשאיר סכמה חלקית בשקט.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'booking_source'
  ) then
    raise exception '0017: appointments.booking_source לא נוספה' using errcode = 'P0103';
  end if;

  if not exists (
    select 1 from pg_class where oid = 'public.booking_rate_events'::regclass and relrowsecurity
  ) then
    raise exception '0017: RLS אינו מופעל על booking_rate_events' using errcode = 'P0103';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'booking_rate_events'
  ) then
    raise exception '0017: נוספה policy ל-booking_rate_events — הטבלה אמורה להיות service_role בלבד'
      using errcode = 'P0103';
  end if;

  raise notice '0017: booking_source נוספה, booking_rate_events נוצרה עם RLS ובלי policies.';
end $$;
