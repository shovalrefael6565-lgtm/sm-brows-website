-- ============================================================================
-- 0031 — שלב 8: תיעוד אישור מדיניות הפרטיות על שורת התור
--
-- ⚠️ זו מדיניות **פרטיות** — מה קורה עם המידע האישי — ולא מדיניות תורים/
-- ביטולים. `appointments.policy_version` הקיימת (0001) שייכת למדיניות
-- ההזמנה/ביטולים (lib/bookingPolicy.ts, POLICY_VERSION) ואינה נדרסת ואינה
-- ממוחזרת כאן. שתי העמודות נשמרות זו לצד זו, בנפרד לגמרי.
--
-- ─── מה הקובץ הזה מוסיף ────────────────────────────────────────────────────
--
--   1. appointments.privacy_notice_version         (text, nullable)
--   2. appointments.privacy_notice_acknowledged_at (timestamptz, nullable)
--   3. עדכון create_public_booking_request ו-create_personal_area_booking_request
--      כך שידרשו אישור ויכתבו את שתי העמודות.
--
-- ⚠️ שני השדות **nullable ובלי default** — במכוון. אין backfill לרשומות
-- קיימות: תור שנוצר לפני 0031 לא "אישר" שום דבר, וזיוף ערך היה שקר בנתונים.
-- מאותה סיבה, create_manual_appointment (תור ידני שאדמין יוצר) **אינה
-- נוגעת** כאן: תור כזה תמיד ישאיר את שני השדות null — אין אישור בשם
-- הלקוחה כשהמנהלת היא שקובעת את התור.
--
-- ⚠️ **זמן האישור נקבע בשרת (`now()` בתוך ה-RPC), לעולם לא לפי מה
-- שהדפדפן שולח.** אין פרמטר p_privacy_notice_acknowledged_at — רק
-- p_privacy_notice_acknowledged (boolean) ו-p_privacy_notice_version (text).
-- ה-RPC הוא שמחליט מתי "עכשיו".
--
-- ⚠️ **האכיפה היא כאן, ב-DB, ולא רק ב-route.** בקשה חסרת אישור, עם
-- p_privacy_notice_acknowledged=false, או עם p_privacy_notice_version ריק/null
-- נדחית בחריגה PRIVACY_NOT_ACKNOWLEDGED — כך שגם קורא שקורא ל-RPC ישירות
-- (ולא רק דרך ה-route) חייב לספק אישור ולא רק את קריאת ה-route. זו הגנת
-- עומק על **חוזה זרימת ההזמנה הרגילה בלבד** — היא אינה טוענת להגן מפני
-- מקרה שבו מפתח service_role עצמו דלף או נוצל לרעה: מי שמחזיק מפתח כזה
-- יכול לכתוב ישירות לטבלה ולעקוף את ה-RPC כולו. אימות **הגרסה עצמה** מול
-- הקבוע הנוכחי (PRIVACY_NOTICE_VERSION) נשאר באחריות ה-route
-- (lib/privacyNotice.ts) — ה-RPC אינו מכיר מחרוזות גרסה ספציפיות, בדיוק
-- כמו שהוא לא מכיר את POLICY_VERSION.
--
-- ─── למה DROP + CREATE ולא CREATE OR REPLACE ───────────────────────────────
--
-- הוספת פרמטרים חדשים משנה את חתימת הפונקציה (name + arg types הם מה
-- שמזהה אותה ב-Postgres). CREATE OR REPLACE עם רשימת פרמטרים שונה אינו
-- מחליף את הקיימת — הוא יוצר **עוד** overload, ומשאיר את הישנה (בלי אכיפת
-- פרטיות) חיה וניתנת לקריאה. DROP מפורש הוא הדרך היחידה להבטיח שרק הגרסה
-- החדשה, האוכפת, קיימת אחרי המיגרציה. זו מיגרציה מקומית בלבד (ר' checkpoint
-- שלב 7) ואין כאן דרישת zero-downtime כמו ב-0018/0020/0021 — קוד ומיגרציה
-- מתעדכנים יחד באותו commit.
-- ============================================================================


-- ============================================================================
-- חלק 1 — עמודות חדשות ב-appointments
-- ============================================================================

alter table public.appointments
  add column privacy_notice_version         text,
  add column privacy_notice_acknowledged_at timestamptz;

comment on column public.appointments.privacy_notice_version is
  'גרסת מדיניות הפרטיות (lib/privacyNotice.ts, PRIVACY_NOTICE_VERSION) שהלקוחה אישרה. null = תור ידני של אדמין, ללא אישור בשם הלקוחה.';
comment on column public.appointments.privacy_notice_acknowledged_at is
  'זמן האישור, נקבע בשרת (now() בתוך ה-RPC) — לעולם לא לפי הדפדפן. null = תור ידני של אדמין.';


-- ============================================================================
-- חלק 2 — המסלול הציבורי: create_public_booking_request
-- ============================================================================

drop function if exists public.create_public_booking_request(
  text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer
);

create function public.create_public_booking_request(
  p_phone_e164              text,
  p_full_name               text,
  p_service_key             text,
  p_variants                text[],
  p_price_total             integer,
  p_starts_at               timestamptz,
  p_duration_min            integer,
  p_notes                   text,
  p_policy_version          text,
  p_expires_at              timestamptz,
  p_ip                      inet,
  p_max_per_ip_per_hour     integer,
  p_privacy_notice_version  text,
  p_privacy_notice_acknowledged    boolean
) returns public.appointments
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  -- 🔒 תקרה קשיחה. הפרמטר יכול רק להדק.
  c_ip_max       constant integer := least(coalesce(p_max_per_ip_per_hour, 5), 5);
  -- חגורת בטיחות על התפוגה: המקרה הלגיטימי הארוך ביותר (חמישי בערב →
  -- ראשון 11:00) הוא כ-66 שעות. תואם ל-PENDING_EXPIRY_MAX_HOURS.
  c_expiry_max   constant interval := interval '72 hours';

  v_ip_count     integer;
  v_customer     public.customers;
  v_max_pending  integer;
  v_active_count integer;
  v_row          public.appointments;
begin
  -- ── ולידציה ────────────────────────────────────────────────────────────
  -- הטלפון והשם נבדקים בתוך link_or_create_customer_by_phone, אך רק אחרי
  -- מגבלת הקצב — כדי שקלט פסול לא יעקוף אותה.
  if p_ip is null then
    raise exception 'MISSING_IP' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + c_expiry_max then
    raise exception 'BAD_EXPIRY' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'START_IN_PAST' using errcode = '22023';
  end if;
  -- 🔒 שלב 8 — אין בקשת תור בלי אישור מדיניות פרטיות מתועד. הבדיקה הזו
  -- לפני כל נעילה או כתיבה, מאותה סיבה שוולידציית הקלט האחרת נמצאת כאן.
  if p_privacy_notice_acknowledged is not true
     or p_privacy_notice_version is null
     or length(trim(p_privacy_notice_version)) = 0 then
    raise exception 'PRIVACY_NOT_ACKNOWLEDGED' using errcode = '22023';
  end if;

  -- ── 🔒 נעילה 1 מתוך 3: IP (namespace 4) ────────────────────────────────
  perform pg_advisory_xact_lock(4, hashtext(host(p_ip)));

  -- ── ניקוי אופורטוניסטי ─────────────────────────────────────────────────
  -- אין Cron. חלון הספירה הוא שעה; מוחקים מעל שעתיים כדי להשאיר מרווח
  -- ולא למחוק שורה שעדיין נספרת.
  delete from public.booking_rate_events
  where created_at < now() - interval '2 hours';

  -- ── מגבלת הקצב ─────────────────────────────────────────────────────────
  --
  -- 🔒 **לפני יצירת הלקוחה, ובכוונה.** זה מה שמונע מתוקף לייצר שורת
  -- customers על כל בקשה חסומה. הבדיקה הזו היא השער הראשון שכל בקשה
  -- ציבורית פוגשת אחרי הוולידציה.
  select count(*)::integer into v_ip_count
  from public.booking_rate_events
  where ip = p_ip
    and created_at > now() - interval '1 hour';

  if v_ip_count >= c_ip_max then
    raise exception 'RATE_LIMITED' using errcode = 'P0012';
  end if;

  -- ── 🔒 נעילה 2 מתוך 3: טלפון (namespace 3, בתוך הפונקציה הנקראת) ───────
  -- אותה טרנזקציה, ולכן לקוחה שנוצרת כאן מתגלגלת לאחור יחד עם כל כישלון
  -- בהמשך. השם של לקוחה קיימת אינו נדרס (ראה 0018 חלק 1).
  v_customer := public.link_or_create_customer_by_phone(p_phone_e164, p_full_name);

  -- ── לקוחה חסומה ────────────────────────────────────────────────────────
  -- ⚠️ errcode ייעודי כדי שהשרת יוכל לרשום מה קרה. התשובה הציבורית
  -- **חייבת** להיות זהה לכשל גנרי — ראה ה-route.
  if v_customer.is_blocked then
    raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0013';
  end if;

  -- ── 🔒 נעילה 3 מתוך 3: הלקוחה (namespace 5) ────────────────────────────
  perform pg_advisory_xact_lock(5, hashtext(v_customer.id::text));

  -- ── תפוגת בקשות ישנות, ואז המגבלה ללקוחה ───────────────────────────────
  perform public.expire_stale_pending_appointments();

  select (value #>> '{}')::integer into v_max_pending
    from public.business_settings where key = 'max_active_pending_per_customer';
  if v_max_pending is null then v_max_pending := 2; end if;

  select count(*)::integer into v_active_count
    from public.appointments
    where customer_id = v_customer.id and status = 'pending';

  if v_active_count >= v_max_pending then
    raise exception 'PENDING_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  -- ── היצירה ─────────────────────────────────────────────────────────────
  -- ends_at נכתב ע"י הטריגר set_appointment_end ולכן אינו נשלח כאן.
  -- privacy_notice_acknowledged_at = now() — זמן השרת, לא זמן שהדפדפן שלח.
  -- 🔒 0030: pending_expires_at = null, לא p_expires_at — אין תפוגה
  -- מבוססת-זמן. p_expires_at עדיין מתקבל ומאומת (BAD_EXPIRY) כדי לא
  -- לגעת בחוזה כלפי הקוד הקורא — ראה 0030 חלק 2.
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status,
    pending_expires_at, notes, policy_version, booking_source,
    privacy_notice_version, privacy_notice_acknowledged_at
  ) values (
    v_customer.id, p_service_key, coalesce(p_variants, '{}'), p_price_total,
    p_starts_at, p_duration_min, 'pending',
    null, p_notes, p_policy_version, 'public_booking',
    p_privacy_notice_version, now()
  )
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, to_starts_at, actor, actor_id
  ) values (
    v_row.id, 'created', null, 'pending', v_row.starts_at, 'customer', v_customer.id
  );

  -- ── רישום אירוע הקצב, אחרון ────────────────────────────────────────────
  insert into public.booking_rate_events (ip) values (p_ip);

  return v_row;
end;
$$;

comment on function public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer, text, boolean) is
  'בקשת תור מהמסלול הציבורי: לקוחה, תור ואירוע קצב בטרנזקציה אחת. דוחה בקשה בלי אישור מדיניות פרטיות תקף (PRIVACY_NOT_ACKNOWLEDGED).';


-- ============================================================================
-- חלק 3 — האזור האישי: create_personal_area_booking_request
-- ============================================================================

drop function if exists public.create_personal_area_booking_request(
  uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz
);

create function public.create_personal_area_booking_request(
  p_customer_id             uuid,
  p_service_key             text,
  p_variants                text[],
  p_price_total             integer,
  p_starts_at               timestamptz,
  p_duration_min            integer,
  p_notes                   text,
  p_policy_version          text,
  p_expires_at              timestamptz,
  p_privacy_notice_version  text,
  p_privacy_notice_acknowledged    boolean
) returns public.appointments
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  c_expiry_max   constant interval := interval '72 hours';

  v_customer     public.customers;
  v_max_pending  integer;
  v_active_count integer;
  v_row          public.appointments;
begin
  -- ── ולידציה ────────────────────────────────────────────────────────────
  if p_customer_id is null then
    raise exception 'MISSING_CUSTOMER' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + c_expiry_max then
    raise exception 'BAD_EXPIRY' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'START_IN_PAST' using errcode = '22023';
  end if;
  -- 🔒 שלב 8 — אותה אכיפה בדיוק כמו במסלול הציבורי (0031 חלק 2).
  if p_privacy_notice_acknowledged is not true
     or p_privacy_notice_version is null
     or length(trim(p_privacy_notice_version)) = 0 then
    raise exception 'PRIVACY_NOT_ACKNOWLEDGED' using errcode = '22023';
  end if;

  -- ── 🔒 הנעילה (namespace 5) — אותו מפתח בדיוק כמו ב-0018 ───────────────
  perform pg_advisory_xact_lock(5, hashtext(p_customer_id::text));

  -- ── הלקוחה קיימת ואינה חסומה ───────────────────────────────────────────
  select * into v_customer
  from public.customers
  where id = p_customer_id;

  if v_customer.id is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_customer.is_blocked then
    raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0013';
  end if;

  -- ── תפוגת בקשות ישנות, ואז המגבלה ללקוחה ───────────────────────────────
  perform public.expire_stale_pending_appointments();

  select (value #>> '{}')::integer into v_max_pending
    from public.business_settings where key = 'max_active_pending_per_customer';
  if v_max_pending is null then v_max_pending := 2; end if;

  select count(*)::integer into v_active_count
    from public.appointments
    where customer_id = p_customer_id and status = 'pending';

  if v_active_count >= v_max_pending then
    raise exception 'PENDING_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  -- ── היצירה ─────────────────────────────────────────────────────────────
  -- 🔒 0030: pending_expires_at = null, לא p_expires_at — ראה ההערה
  -- המקבילה ב-create_public_booking_request למעלה.
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status,
    pending_expires_at, notes, policy_version, booking_source,
    privacy_notice_version, privacy_notice_acknowledged_at
  ) values (
    p_customer_id, p_service_key, coalesce(p_variants, '{}'), p_price_total,
    p_starts_at, p_duration_min, 'pending',
    null, p_notes, p_policy_version, 'personal_area',
    p_privacy_notice_version, now()
  )
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, to_starts_at, actor, actor_id
  ) values (
    v_row.id, 'created', null, 'pending', v_row.starts_at, 'customer', p_customer_id
  );

  return v_row;
end;
$$;

comment on function public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, text, boolean) is
  'בקשת תור של לקוחה מאומתת מהאזור האישי. דוחה בקשה בלי אישור מדיניות פרטיות תקף (PRIVACY_NOT_ACKNOWLEDGED).';


-- ============================================================================
-- חלק 4 — הרשאות
--
-- ⚠️ `revoke ... from public, anon, authenticated` — ראה 0006/0018/0020
-- לנימוק המלא. הפונקציות שהוחלפו (DROP + CREATE) חייבות הרשאה מפורשת
-- מחדש — הן לא "אותה פונקציה" מבחינת Postgres, אלא אובייקט חדש.
-- ============================================================================

revoke execute on function public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, text, boolean)
  from public, anon, authenticated;

grant execute on function public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer, text, boolean) to service_role;
grant execute on function public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, text, boolean) to service_role;


-- ─── אימות ─────────────────────────────────────────────────────────────────
do $$
begin
  -- ── עמודות חדשות, nullable, בלי default ────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'privacy_notice_version' and is_nullable = 'YES'
  ) then
    raise exception '0031: privacy_notice_version חסרה או NOT NULL' using errcode = 'P0103';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'privacy_notice_acknowledged_at' and is_nullable = 'YES'
  ) then
    raise exception '0031: privacy_notice_acknowledged_at חסרה או NOT NULL' using errcode = 'P0103';
  end if;

  -- ── שתי הפונקציות עם החתימה החדשה קיימות ───────────────────────────────
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_public_booking_request'
      and pg_get_function_identity_arguments(p.oid) =
        'p_phone_e164 text, p_full_name text, p_service_key text, p_variants text[], p_price_total integer, p_starts_at timestamp with time zone, p_duration_min integer, p_notes text, p_policy_version text, p_expires_at timestamp with time zone, p_ip inet, p_max_per_ip_per_hour integer, p_privacy_notice_version text, p_privacy_notice_acknowledged boolean'
  ) then
    raise exception '0031: create_public_booking_request לא נוצרה עם החתימה החדשה' using errcode = 'P0103';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_personal_area_booking_request'
      and pg_get_function_identity_arguments(p.oid) =
        'p_customer_id uuid, p_service_key text, p_variants text[], p_price_total integer, p_starts_at timestamp with time zone, p_duration_min integer, p_notes text, p_policy_version text, p_expires_at timestamp with time zone, p_privacy_notice_version text, p_privacy_notice_acknowledged boolean'
  ) then
    raise exception '0031: create_personal_area_booking_request לא נוצרה עם החתימה החדשה' using errcode = 'P0103';
  end if;

  -- 🔒 שתיהן חייבות להישאר INVOKER.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_public_booking_request', 'create_personal_area_booking_request')
      and p.prosecdef
  ) then
    raise exception '0031: פונקציה הוגדרה כ-SECURITY DEFINER' using errcode = 'P0103';
  end if;

  -- ── ההרשאות בפועל, לא רק הצהרת ה-REVOKE ────────────────────────────────
  if has_function_privilege('anon',
       'public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer, text, boolean)', 'execute')
  then raise exception '0031: anon יכול להפעיל את create_public_booking_request'; end if;

  if has_function_privilege('authenticated',
       'public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer, text, boolean)', 'execute')
  then raise exception '0031: authenticated יכול להפעיל את create_public_booking_request'; end if;

  if not has_function_privilege('service_role',
       'public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer, text, boolean)', 'execute')
  then raise exception '0031: service_role איבד את create_public_booking_request'; end if;

  if has_function_privilege('anon',
       'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, text, boolean)', 'execute')
  then raise exception '0031: anon יכול להפעיל את create_personal_area_booking_request'; end if;

  if has_function_privilege('authenticated',
       'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, text, boolean)', 'execute')
  then raise exception '0031: authenticated יכול להפעיל את create_personal_area_booking_request'; end if;

  if not has_function_privilege('service_role',
       'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, text, boolean)', 'execute')
  then raise exception '0031: service_role איבד את create_personal_area_booking_request'; end if;

  -- ── create_manual_appointment לא נגעו בה — עדיין קיימת עם 10 הפרמטרים הישנים ──
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_manual_appointment'
      and pg_get_function_identity_arguments(p.oid) =
        'p_customer_id uuid, p_service_key text, p_variants text[], p_price_total integer, p_starts_at timestamp with time zone, p_duration_min integer, p_policy_version text, p_admin_id uuid, p_client_request_id uuid, p_payload_fingerprint text'
  ) then
    raise exception '0031: create_manual_appointment השתנתה — היא לא אמורה להיגע כאן' using errcode = 'P0103';
  end if;

  raise notice '0031: privacy_notice_version + privacy_notice_acknowledged_at נוספו ל-appointments. שתי פונקציות היצירה של הלקוחה דורשות אישור מדיניות פרטיות. create_manual_appointment לא השתנתה.';
end $$;
