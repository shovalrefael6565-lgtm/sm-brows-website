-- ============================================================================
-- 0037 — רשימת המתנה (Waitlist), שלב 1
--
-- ═══ מה זה כן ═══
--
-- טבלה אחת, `waitlist_requests`, ופונקציה אחת שכותבת אליה. בקשת המתנה היא
-- **הבעת עניין בשעה שאינה מוצגת כרגע** — לא תור, ולא החזקה של זמן.
--
-- ═══ 🔒 מה זה **אינו** עושה — וזה העיקר ═══
--
--   ❌ **אינו נוגע ב-`appointments`.** אין עמודה חדשה, אין סטטוס חדש, אין
--      שינוי ב-`appointments_no_overlap`. בקשת המתנה אינה יכולה לחסום זמן,
--      כי היא אינה יושבת בטבלה שה-EXCLUDE constraint מגן עליה.
--   ❌ **אינו משפיע על הזמינות.** `get_db_busy_ranges` בצד האפליקציה
--      (lib/db/appointments.ts) קורא אך ורק מ-`appointments`. טבלה חדשה
--      בלתי-נראית לו לחלוטין.
--   ❌ **אינו יוצר תזכורות ואינו יוצר אירוע ביומן.** כל טריגרי התזכורות,
--      ההתראות והסנכרון ליומן יושבים על `appointments` / `appointment_history`.
--      לטבלה כאן **אין ולו טריגר אחד**, וחלק 5 מאמת זאת בפועל.
--   ❌ אינו נוגע ב-`marketing_consent`, ב-`marketing_opted_out_at` ובאף
--      עמודת דיוור. הצטרפות לרשימת המתנה אינה הסכמה לשיווק.
--   ❌ אינו מוסיף אחסון IP חדש. מגבלת הקצב לפי IP נשענת על
--      `booking_rate_events` הקיימת (0017), שכבר מנוקה אופורטוניסטית
--      ואינה נושאת שום מזהה לקוחה.
--   ❌ אינו נוגע ב-0001–0036.
--
-- ═══ PII ═══
--
-- 🔒 **אין כאן שם ואין כאן טלפון.** הזיהוי הוא `customer_id` בלבד, דרך
-- `link_or_create_customer_by_phone` — אותה פונקציה שהמסלול הציבורי כבר
-- משתמש בה (0018), עם אותו טלפון מנורמל ובלי ליצור כרטיס כפול.
-- ============================================================================


-- ============================================================================
-- חלק 1 — הטבלה
-- ============================================================================

create table if not exists public.waitlist_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  -- 🔒 אין PII כפול: השם והטלפון חיים ב-customers בלבד.
  customer_id  uuid not null references public.customers(id) on delete cascade,

  -- הטיפול, כפי שנגזר **בשרת** מ-lib/services.ts. הרשימה סגורה בכוונה:
  -- טיפול שאין לו יומן אינו יכול להיכנס לרשימת המתנה.
  service_key  text    not null check (service_key in ('עיצוב גבות טבעיות', 'הרמת גבות')),
  variants     text[]  not null default '{}',

  -- ⚠️ נגזר בשרת מהגדרת השירות ולעולם לא מתקבל מהדפדפן. ה-CHECK כאן הוא
  -- החגורה השנייה: גם קריאה ישירה ל-RPC לא תוכל לשתול משך שרירותי.
  duration_min integer not null check (duration_min in (20, 40)),

  -- המועד המבוקש — אותו מבנה בדיוק כמו `appointments.starts_at`.
  requested_at timestamptz not null,

  -- ⚠️ **פעילה = open או contacted.** 'contacted' אינו סוף הדרך: שובל
  -- יצרה קשר, והשיחה עדיין פתוחה. רק 'closed' משחרר את המועד לבקשה
  -- חדשה בעתיד. שתי המגבלות (unique + תקרת הפעילות) סופרות את שניהם.
  status       text not null default 'open'
               check (status in ('open', 'contacted', 'closed')),

  -- 🔒 הודעת הפרטיות — אותה דרישה בדיוק כמו במסלול ההזמנה (0031). המסלול
  -- הזה אינו עוקף אותה. ה-timestamp הוא **זמן השרת**, לא מה שהדפדפן שלח.
  privacy_notice_version         text        not null check (length(trim(privacy_notice_version)) > 0),
  privacy_notice_acknowledged_at timestamptz not null default now()
);

comment on table public.waitlist_requests is
  'בקשות רשימת המתנה. אינן תורים: אינן חוסמות זמן, אינן מסונכרנות ליומן ואינן מייצרות תזכורות. אין כאן שם או טלפון — רק customer_id.';

-- ⚠️ **partial** unique index, ולא constraint קבוע: שתי בקשות *פעילות*
-- (open או contacted) לאותה לקוחה/מועד/טיפול נחסמות, אבל בקשה שנסגרה
-- ('closed') אינה חוסמת בקשה חדשה לאותו מועד בעתיד. constraint מלא היה
-- נועל את המועד לצמיתות אחרי הטיפול הראשון בו.
--
-- 🔴 הפרדיקט כאן חייב להישאר זהה מילה במילה ל-`on conflict … where` שב-RPC
-- (חלק 3), אחרת Postgres לא יוכל להסיק את האינדקס והיצירה תיכשל.
create unique index if not exists waitlist_requests_active_unique
  on public.waitlist_requests (customer_id, requested_at, service_key)
  where status in ('open', 'contacted');

-- המסך של שובל: הבקשות הפעילות לפי מועד.
create index if not exists waitlist_requests_active_idx
  on public.waitlist_requests (requested_at)
  where status in ('open', 'contacted');

-- ספירת הבקשות של לקוחה (שתי מגבלות הקצב בחלק 3).
create index if not exists waitlist_requests_customer_idx
  on public.waitlist_requests (customer_id, created_at desc);


-- ============================================================================
-- חלק 2 — RLS והרשאות
--
-- אותה דוקטרינה כמו 0017/0035: RLS דלוק, **אפס policies**, גישה ל-service_role
-- בלבד. בקשה נסגרת ע"י `status`, ולא נמחקת.
--
-- ⚠️ **ה-GRANT כאן אינו יכול למנוע DELETE, וזו עובדה על Supabase ולא
-- החלטה שלנו.** לפרויקט יש `alter default privileges … grant all on tables
-- to service_role` ברמת הסכימה, ולכן service_role מקבל את מלוא ההרשאות על
-- **כל** טבלה חדשה ב-public — כפי שאומת בפרודקשן על appointments,
-- sms_campaigns, app_sessions ו-booking_rate_events באותה מידה. ה-`grant`
-- המפורש להלן מתעד את מה שהאפליקציה משתמשת בו; הוא אינו שער.
--
-- 🔒 מה שה-`revoke` כאן **כן** משיג, ומה שנבדק: `anon` ו-`authenticated`
-- מקבלים **אפס** הרשאות על הטבלה — בניגוד ל-appointments, שעליה הם עדיין
-- מחזיקים grants ונחסמים ע"י RLS בלבד.
--
-- 🔒 מניעת המחיקה נאכפת בשכבת האפליקציה: אין ב-lib/db/waitlist.ts שום
-- מסלול delete, ו-`set_waitlist_request_status` היא פונקציית השינוי
-- היחידה — היא מעדכנת `status` ואינה מוחקת.
-- ============================================================================

alter table public.waitlist_requests enable row level security;

revoke all on public.waitlist_requests from anon, authenticated;
grant select, insert, update on public.waitlist_requests to service_role;


-- ============================================================================
-- חלק 3 — יצירת בקשת המתנה
--
-- ═══ סדר הנעילות — זהה ל-0018, ובכוונה ═══
--
-- קודם IP (namespace 4), אחר כך הלקוחה (namespace 5). אותו סדר בדיוק
-- שבו `create_public_booking_request` נועלת, ולכן שני המסלולים אינם
-- יכולים להיכנס ל-deadlock זה עם זה.
--
-- ═══ שלוש מגבלות, ולא אחת ═══
--
--   1. **IP** — `booking_rate_events` הקיימת. ⚠️ המונה **משותף** עם
--      ההזמנות הציבוריות: מי שמייצר 5 פעולות ציבוריות בשעה נחסם בשני
--      המסלולים. זו החמרה מכוונת — אין תקציב נפרד לניצול לרעה.
--   2. **בקשות פעילות ללקוחה** — עד 5. פעילה = open **או** contacted.
--   3. **קצב ליצירה ללקוחה** — עד 10 בשעה.
--
-- 🔴 מה ש**אין** כאן: בדיקת פנויות. ה-RPC אינו יודע מה תפוס — Google
-- Calendar אינו נגיש מ-Postgres. ה-revalidation מול היומן ומול
-- `appointments` נעשה ב-route (app/api/waitlist/route.ts) **מיד לפני**
-- הקריאה הזו, על נתונים טריים ולא מהמטמון.
-- ============================================================================

create or replace function public.create_waitlist_request(
  p_phone_e164              text,
  p_full_name               text,
  p_service_key             text,
  p_variants                text[],
  p_duration_min            integer,
  p_requested_at            timestamptz,
  p_ip                      inet,
  p_max_per_ip_per_hour     integer,
  p_privacy_notice_version  text,
  p_privacy_notice_acknowledged boolean
) returns public.waitlist_requests
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  -- 🔒 תקרה קשיחה, זהה ל-0018. הפרמטר יכול רק להדק.
  c_ip_max        constant integer := least(coalesce(p_max_per_ip_per_hour, 5), 5);
  -- תקרת הבקשות ה**פעילות** (open + contacted) ללקוחה
  c_active_max    constant integer := 5;
  c_hourly_max    constant integer := 10;

  v_ip_count      integer;
  v_active_count  integer;
  v_hourly_count  integer;
  v_customer      public.customers;
  v_row           public.waitlist_requests;
begin
  -- ── ולידציה ────────────────────────────────────────────────────────────
  if p_ip is null then
    raise exception 'MISSING_IP' using errcode = '22023';
  end if;
  if p_requested_at is null or p_requested_at <= now() then
    raise exception 'START_IN_PAST' using errcode = '22023';
  end if;
  if p_service_key is null or p_service_key not in ('עיצוב גבות טבעיות', 'הרמת גבות') then
    raise exception 'BAD_SERVICE' using errcode = '22023';
  end if;
  if p_duration_min is null or p_duration_min not in (20, 40) then
    raise exception 'BAD_DURATION' using errcode = '22023';
  end if;

  -- 🔒 הודעת הפרטיות — אותה בדיקה בדיוק כמו ב-0031, ובאותו מקום בסדר:
  -- לפני שנוצרת לקוחה, כדי שמסלול שעוקף את ההודעה לא יוכל להשאיר עקבות.
  if p_privacy_notice_acknowledged is not true
     or p_privacy_notice_version is null
     or length(trim(p_privacy_notice_version)) = 0 then
    raise exception 'PRIVACY_NOT_ACKNOWLEDGED' using errcode = 'P0400';
  end if;

  -- ── 🔒 נעילה 1 מתוך 2: IP (namespace 4, כמו 0018) ──────────────────────
  perform pg_advisory_xact_lock(4, hashtext(host(p_ip)));

  -- ניקוי אופורטוניסטי, בדיוק כמו 0018 — אין Cron בפרויקט.
  delete from public.booking_rate_events
  where created_at < now() - interval '2 hours';

  -- ── מגבלה 1: IP. לפני יצירת הלקוחה, ובכוונה ────────────────────────────
  select count(*)::integer into v_ip_count
  from public.booking_rate_events
  where ip = p_ip
    and created_at > now() - interval '1 hour';

  if v_ip_count >= c_ip_max then
    raise exception 'RATE_LIMITED' using errcode = 'P0012';
  end if;

  -- ── זיהוי הלקוחה ───────────────────────────────────────────────────────
  -- 🔒 אותה פונקציה שהמסלול הציבורי משתמש בה: טלפון מנורמל, כרטיס קיים
  -- מוחזר כמות שהוא, שם של לקוחה קיימת אינו נדרס, ואין כרטיס כפול.
  -- ⚠️ אינה נוגעת ב-marketing_consent ובאף עמודת דיוור.
  v_customer := public.link_or_create_customer_by_phone(p_phone_e164, p_full_name);

  if v_customer.is_blocked then
    raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0013';
  end if;

  -- ── 🔒 נעילה 2 מתוך 2: הלקוחה (namespace 5, כמו 0018) ──────────────────
  perform pg_advisory_xact_lock(5, hashtext(v_customer.id::text));

  -- ── מגבלה 2: בקשות **פעילות** ──────────────────────────────────────────
  -- ⚠️ open + contacted. בקשה שכבר יצרנו עליה קשר עדיין תופסת מקום
  -- במכסה; רק סגירה מפנה אותו.
  select count(*)::integer into v_active_count
  from public.waitlist_requests
  where customer_id = v_customer.id and status in ('open', 'contacted');

  if v_active_count >= c_active_max then
    raise exception 'WAITLIST_OPEN_LIMIT' using errcode = 'P0401';
  end if;

  -- ── מגבלה 3: קצב יצירה ללקוחה ──────────────────────────────────────────
  select count(*)::integer into v_hourly_count
  from public.waitlist_requests
  where customer_id = v_customer.id
    and created_at > now() - interval '1 hour';

  if v_hourly_count >= c_hourly_max then
    raise exception 'WAITLIST_HOURLY_LIMIT' using errcode = 'P0402';
  end if;

  -- ── היצירה ─────────────────────────────────────────────────────────────
  -- ⚠️ ה-partial unique index הוא שמונע בקשה **פעילה** כפולה. `on conflict
  -- do nothing` הופך את המרוץ לתשובה שקטה במקום ל-23505, וההיעדר מזוהה
  -- למטה. הפרדיקט זהה מילה במילה לזה של האינדקס — ראה חלק 1.
  insert into public.waitlist_requests (
    customer_id, service_key, variants, duration_min, requested_at,
    privacy_notice_version, privacy_notice_acknowledged_at
  )
  values (
    v_customer.id, p_service_key, coalesce(p_variants, '{}'), p_duration_min, p_requested_at,
    -- 🔒 זמן השרת. לא מה שהדפדפן שלח.
    p_privacy_notice_version, now()
  )
  on conflict (customer_id, requested_at, service_key) where status in ('open', 'contacted')
  do nothing
  returning * into v_row;

  if v_row.id is null then
    raise exception 'WAITLIST_DUPLICATE' using errcode = 'P0403';
  end if;

  -- ⚠️ נרשם **רק בהצלחה**, ובאותה טרנזקציה: בקשה שנדחתה אינה אוכלת מהמכסה.
  insert into public.booking_rate_events (ip) values (p_ip);

  return v_row;
end;
$$;

-- 🔒 תבנית 0007: PUBLIC אינו יכול להריץ. service_role בלבד.
revoke execute on function public.create_waitlist_request(
  text, text, text, text[], integer, timestamptz, inet, integer, text, boolean
) from public, anon, authenticated;

grant execute on function public.create_waitlist_request(
  text, text, text, text[], integer, timestamptz, inet, integer, text, boolean
) to service_role;


-- ============================================================================
-- חלק 4 — קריאה ועדכון סטטוס למסך הניהול
--
-- 🔒 קריאה בלבד + שינוי `status` בלבד. אין כאן מחיקה, אין המרה לתור, ואין
-- שום נגיעה ב-appointments.
-- ============================================================================

create or replace function public.set_waitlist_request_status(
  p_request_id uuid,
  p_status     text
) returns public.waitlist_requests
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row public.waitlist_requests;
begin
  if p_status is null or p_status not in ('open', 'contacted', 'closed') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;

  update public.waitlist_requests
  set status = p_status
  where id = p_request_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0404';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.set_waitlist_request_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_waitlist_request_status(uuid, text)
  to service_role;


-- ============================================================================
-- חלק 5 — 🔒 אימות ההרשאות (דוקטרינת 0007/0032)
--
-- נבדק בפועל מול המסד, ולא רק "נכתב REVOKE": anon ו-authenticated אינם
-- יכולים להריץ, ול-service_role ההרשאה **נשמרה**.
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.create_waitlist_request(text, text, text, text[], integer, timestamptz, inet, integer, text, boolean)',
    'public.set_waitlist_request_status(uuid, text)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_signatures loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0037): % — ל-anon עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0037): % — ל-authenticated עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0037): % — ל-service_role חסר EXECUTE.', v_sig using errcode = 'P0101';
    end if;
  end loop;

  raise notice '0037: הרשאות RPC אומתו: anon=false, authenticated=false, service_role=true.';
end $$;


-- ============================================================================
-- חלק 6 — אימות
--
-- נכשל בקול אם משהו מההנחות אינו מתקיים — ובראשן ההנחה שהטבלה הזו אינה
-- יכולה להשפיע על תורים, על תזכורות או על היומן.
-- ============================================================================

do $$
declare
  v_triggers integer;
  v_rls      boolean;
  v_idx      integer;
begin
  -- 🔴 טריגר על הטבלה הזו = דרך שקטה להשפיע על תורים/תזכורות/יומן.
  select count(*) into v_triggers
  from pg_trigger
  where tgrelid = 'public.waitlist_requests'::regclass and not tgisinternal;
  if v_triggers > 0 then
    raise exception '0037: נמצאו % טריגרים על waitlist_requests. הטבלה חייבת להיות פסיבית לחלוטין.', v_triggers;
  end if;

  select relrowsecurity into v_rls
  from pg_class where oid = 'public.waitlist_requests'::regclass;
  if not v_rls then
    raise exception '0037: RLS כבוי על waitlist_requests';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'waitlist_requests') then
    raise exception '0037: נמצאו policies על waitlist_requests. הטבלה נועדה ל-service_role בלבד.';
  end if;

  -- ה-partial unique index — הלב של דרישת "אין כפילות פעילה, אבל סגורה
  -- לא חוסמת". נבדק גם שהפרדיקט הוא **open+contacted** ולא open בלבד.
  select count(*) into v_idx
  from pg_indexes
  where schemaname = 'public' and indexname = 'waitlist_requests_active_unique';
  if v_idx <> 1 then
    raise exception '0037: waitlist_requests_active_unique חסר';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'waitlist_requests_active_unique'
      and indexdef like '%contacted%'
  ) then
    raise exception '0037: הפרדיקט של waitlist_requests_active_unique אינו כולל contacted';
  end if;

  -- 🔒 appointments לא נגעה: אין עמודה חדשה ואין סטטוס חדש.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name like 'waitlist%'
  ) then
    raise exception '0037: appointments שונתה. המיגרציה הזו אינה אמורה לגעת בה.';
  end if;

  raise notice '0037: waitlist_requests נוצרה, פסיבית, ומוגנת ל-service_role בלבד.';
end $$;
