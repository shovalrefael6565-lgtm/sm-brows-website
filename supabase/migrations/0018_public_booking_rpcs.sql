-- ============================================================================
-- 0018 — המסלול הציבורי: לקוחה לפי טלפון, בקשת תור, והגבלת קצב אטומית
--
-- ⚠️ תלוי ב-0016 ו-0017 שכבר רצו ו-commit. אין כאן שום ALTER/DROP על מה
-- שנוצר ב-0001–0017.
--
-- ─── מה הקובץ הזה מוסיף ────────────────────────────────────────────────────
--
--   1. link_or_create_customer_by_phone — לקוחה לפי טלפון מנורמל, בלי OTP.
--   2. create_public_pending_appointment — בקשה ציבורית + הגבלת קצב, הכול
--      בטרנזקציה אחת.
--   3. create_manual_appointment — מוחלפת בשינוי של שתי שורות בלבד, כדי
--      שתסמן booking_source = 'admin_manual'. אין שינוי התנהגות.
--
-- ─── 🔒 למה הגבלת הקצב חיה כאן ולא באפליקציה ──────────────────────────────
--
-- משלב 15B המסלול הציבורי אינו דורש OTP, ולכן מגבלת ה-IP היא אחת משתי
-- ההגנות היחידות מפני תפיסת סלוטים המונית. "לספור ואז ליצור" כשתי קריאות
-- נפרדות הוא בדיוק ה-race שהיה ב-OTP לפני 0013: חמש בקשות מקבילות עוברות
-- כולן את הספירה ואז יוצרות חמש הזמנות מעבר למכסה.
--
-- הספירה, ההחלטה, היצירה ורישום האירוע קורים כאן בטרנזקציה אחת, מאחורי
-- pg_advisory_xact_lock על ה-IP. אין דרך לעקוף את זה מהאפליקציה.
--
-- ⚠️ **נספרות יצירות מוצלחות בלבד.** רישום האירוע מתבצע *אחרי* ה-INSERT
-- של התור. בקשה שנפלה על ה-EXCLUDE constraint (השעה נתפסה) מגלגלת את כל
-- הטרנזקציה לאחור, כולל רישום האירוע — ולכן לקוחה אמיתית שנתקלה בשעה
-- תפוסה אינה שורפת את המכסה שלה. זו ההחלטה שאושרה ב-B3.
--
-- ─── סדר הנעילות ──────────────────────────────────────────────────────────
--
-- 🔒 מרחבי מפתח נפרדים לחלוטין מ-0013 (שמשתמש ב-1=טלפון, 2=IP):
--       3 = טלפון עבור link_or_create_customer_by_phone
--       4 = IP     עבור create_public_pending_appointment
--
-- שתי הפונקציות נקראות ברצף מה-route (קודם לקוחה, אחר כך תור), אך כל אחת
-- נועלת מרחב אחר ומשחררת ב-commit של הטרנזקציה שלה. אין מסלול שבו אחת
-- מחזיקה נעילה ומחכה לשנייה.
--
-- ─── SECURITY INVOKER ─────────────────────────────────────────────────────
--
-- 🔒 כל הפונקציות כאן INVOKER (ברירת המחדל), כמו כל 30+ הפונקציות בפרויקט.
-- הן נקראות אך ורק ע"י service_role בשרת, שעוקף RLS ממילא. ראה את הנימוק
-- המלא ב-0006 וב-0013.
-- ============================================================================


-- ============================================================================
-- חלק 1 — לקוחה לפי טלפון, בלי חשבון התחברות
--
-- זו הפונקציה שמאפשרת לסעיף 2 בחזון להתקיים: **כל בקשה מתועדת, גם של
-- לקוחה שלא התחברה.**
--
-- ⚠️ **השם לעולם אינו נדרס.** לקוחה קיימת מוחזרת כפי שהיא. שם שנקבע ידנית
-- ב-CRM, או שם של לקוחה רשומה, אינו משתנה בגלל מה שמישהו הקליד בטופס
-- הציבורי — בדיוק אותו כלל כמו ב-link_or_create_customer_for_auth (0010).
--
-- ⚠️ **אין כאן בדיקת admin.** בדיקה כזו הייתה מחייבת את ה-API להתנהג אחרת
-- למספר של מנהלת, וזה בדיוק ערוץ הדליפה ש-/api/auth/otp/send נמנע ממנו
-- במפורש. מנהלת שתמלא את הטופס הציבורי תקבל בקשה רגילה.
--
-- ⚠️ auth_user_id נשאר null. הפונקציה **אינה** יוצרת חשבון התחברות, אינה
-- שולחת OTP ואינה נוגעת ב-auth. אם אותה לקוחה תתחבר בעתיד עם אותו מספר,
-- link_or_create_customer_for_auth תקשר את החשבון לשורה הזו ותקבל את כל
-- ההיסטוריה — זה בדיוק מה שהמודל של 0010 נבנה בשבילו.
-- ============================================================================

create or replace function public.link_or_create_customer_by_phone(
  p_phone_e164 text,
  p_full_name  text
) returns public.customers
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_customer public.customers;
  v_name     text := trim(coalesce(p_full_name, ''));
begin
  if p_phone_e164 is null or p_phone_e164 !~ '^\+9725[0-9]{8}$' then
    raise exception 'BAD_PHONE' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'BAD_NAME' using errcode = '22023';
  end if;

  -- 🔒 נעילה לפני הקריאה. שתי בקשות מקבילות מאותו מספר: השנייה ממתינה,
  -- ואז רואה את הלקוחה שהראשונה יצרה במקום ליצור כפילות.
  perform pg_advisory_xact_lock(3, hashtext(p_phone_e164));

  select * into v_customer
  from public.customers
  where phone_e164 = p_phone_e164;

  if v_customer.id is not null then
    return v_customer;
  end if;

  /*
   * ⚠️ ה-EXCEPTION אינו קישוט. הנעילה למעלה מסדרת בין קריאות *לפונקציה
   * הזו*, אבל מסלול ההתחברות (link_or_create_customer_for_auth, 0010)
   * נועל אחרת לגמרי — הוא משתמש ב-FOR UPDATE על השורה. לקוחה שמתחברת
   * ובו-זמנית שולחת בקשה ציבורית מאותו מספר יכולה להגיע לשני המסלולים
   * במקביל, ואז ה-UNIQUE על phone_e164 הוא מה שמכריע.
   *
   * הכשל הזה אינו שגיאה — הוא בדיוק התוצאה הרצויה (לקוחה אחת). קוראים
   * מחדש ומחזירים אותה.
   */
  begin
    insert into public.customers (phone_e164, full_name, auth_user_id)
    values (p_phone_e164, v_name, null)
    returning * into v_customer;
  exception when unique_violation then
    select * into v_customer
    from public.customers
    where phone_e164 = p_phone_e164;

    if v_customer.id is null then
      -- ה-UNIQUE נשבר על משהו אחר, או שהשורה נעלמה. לא בולעים בשקט.
      raise exception 'CUSTOMER_RESOLVE_FAILED' using errcode = 'P0104';
    end if;
  end;

  return v_customer;
end;
$$;

comment on function public.link_or_create_customer_by_phone(text, text) is
  'לקוחה לפי טלפון מנורמל, למסלול ההזמנה הציבורי ללא OTP. אינה דורסת שם קיים ואינה יוצרת auth user.';


-- ============================================================================
-- חלק 2 — בקשת תור ציבורית + הגבלת קצב, בטרנזקציה אחת
--
-- ⚠️ **התקרה מהודקת כאן ואינה ניתנת להרפיה.** קורא שיעביר
-- p_max_per_ip_per_hour = 1000000 יקבל 5. אותו דפוס כמו ב-issue_otp_atomic:
-- המספר ב-lib/bookingRateLimit.ts הוא ההגדרה, והמספר כאן הוא מה שמחזיק
-- גם מול קורא שגוי או פרוץ.
--
-- ⚠️ p_expires_at מחושב באפליקציה (lib/pendingExpiry.ts) ולא כאן — כלל
-- "יום העבודה הבא" נשען על אותה לוגיקת שישי/שבת שמשמשת את חלון 7 הימים,
-- והיא חיה ב-TypeScript. שכפול הכלל ב-SQL היה יוצר בדיוק את הבאג שהתגלה
-- ב-15A (90 דקות בשני קבצים שהתבדרו). ה-RPC **אוכף שהערך סביר** אך אינו
-- משכפל את הלוגיקה העסקית.
-- ============================================================================

create or replace function public.create_public_pending_appointment(
  p_customer_id         uuid,
  p_service_key         text,
  p_variants            text[],
  p_price_total         integer,
  p_starts_at           timestamptz,
  p_duration_min        integer,
  p_notes               text,
  p_policy_version      text,
  p_expires_at          timestamptz,
  p_ip                  inet,
  p_max_per_ip_per_hour integer
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
  v_max_pending  integer;
  v_active_count integer;
  v_row          public.appointments;
begin
  -- ── ולידציה ────────────────────────────────────────────────────────────
  if p_ip is null then
    raise exception 'MISSING_IP' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + c_expiry_max then
    raise exception 'BAD_EXPIRY' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'START_IN_PAST' using errcode = '22023';
  end if;

  -- ── 🔒 נעילה על ה-IP, לפני הספירה ──────────────────────────────────────
  perform pg_advisory_xact_lock(4, hashtext(host(p_ip)));

  -- ── ניקוי אופורטוניסטי ─────────────────────────────────────────────────
  -- אין Cron. חלון הספירה הוא שעה; מוחקים מעל שעתיים כדי להשאיר מרווח
  -- ולא למחוק שורה שעדיין נספרת.
  delete from public.booking_rate_events
  where created_at < now() - interval '2 hours';

  -- ── מגבלת הקצב ─────────────────────────────────────────────────────────
  select count(*)::integer into v_ip_count
  from public.booking_rate_events
  where ip = p_ip
    and created_at > now() - interval '1 hour';

  if v_ip_count >= c_ip_max then
    raise exception 'RATE_LIMITED' using errcode = 'P0012';
  end if;

  -- ── תפוגת בקשות ישנות, ואז המגבלה ללקוחה ───────────────────────────────
  -- אותו סדר בדיוק כמו create_pending_appointment (0003): בקשה שכבר פגה
  -- לא תחסום בקשה חדשה, וה-EXCLUDE constraint עדיין נבדק כרגיל.
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
  -- ends_at נכתב ע"י הטריגר set_appointment_end ולכן אינו נשלח כאן.
  -- ⚠️ אם ה-EXCLUDE constraint נכשל (23P01), כל הטרנזקציה מתגלגלת לאחור —
  -- כולל רישום אירוע הקצב שלמטה. זה בדיוק מה שמבטיח "נספרות הצלחות בלבד".
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status,
    pending_expires_at, notes, policy_version, booking_source
  ) values (
    p_customer_id, p_service_key, coalesce(p_variants, '{}'), p_price_total,
    p_starts_at, p_duration_min, 'pending',
    p_expires_at, p_notes, p_policy_version, 'public_booking'
  )
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, to_starts_at, actor, actor_id
  ) values (
    v_row.id, 'created', null, 'pending', v_row.starts_at, 'customer', p_customer_id
  );

  -- ── רישום אירוע הקצב, אחרון ────────────────────────────────────────────
  insert into public.booking_rate_events (ip) values (p_ip);

  return v_row;
end;
$$;

comment on function public.create_public_pending_appointment(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer) is
  'בקשת תור מהמסלול הציבורי. סופרת ואוכפת מגבלת IP באותה טרנזקציה, ורושמת אירוע קצב רק על יצירה שהצליחה.';


-- ============================================================================
-- חלק 3 — תיוג התור הידני
--
-- ⚠️ שינוי של **שתי שורות בלבד** מול הגרסה ב-0010: booking_source נוסף
-- לרשימת העמודות ו-'admin_manual' לרשימת הערכים. כל השאר — ה-idempotency,
-- בדיקת המנהלת, בדיקת המועד, ההיסטוריה — מילה במילה כפי שהיה.
--
-- בלי זה, כל תור ידני שייווצר מכאן והלאה היה נשאר עם booking_source ריק,
-- והעמודה החדשה הייתה חסרת משמעות מהיום הראשון.
-- ============================================================================

create or replace function public.create_manual_appointment(
  p_customer_id         uuid,
  p_service_key         text,
  p_variants            text[],
  p_price_total         integer,
  p_starts_at           timestamptz,
  p_duration_min        integer,
  p_policy_version      text,
  p_admin_id            uuid,
  p_client_request_id   uuid,
  p_payload_fingerprint text
)
returns jsonb
language plpgsql
as $$
declare
  v_claimed  boolean;
  v_prev     public.admin_idempotency;
  v_customer public.customers;
  v_row      public.appointments;
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  if p_client_request_id is null then
    raise exception 'MISSING_REQUEST_ID' using errcode = '22023';
  end if;
  if p_payload_fingerprint is null or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'BAD_FINGERPRINT' using errcode = '22023';
  end if;

  insert into public.admin_idempotency
    (scope, actor_admin_id, client_request_id, payload_fingerprint)
  values
    ('appointment_create', p_admin_id, p_client_request_id, p_payload_fingerprint)
  on conflict do nothing
  returning true into v_claimed;

  if v_claimed is null then
    select * into v_prev
    from public.admin_idempotency
    where scope = 'appointment_create'
      and actor_admin_id = p_admin_id
      and client_request_id = p_client_request_id;

    if v_prev.payload_fingerprint <> p_payload_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    if v_prev.result_code is null then
      raise exception 'IDEMPOTENCY_INCOMPLETE' using errcode = 'P0104';
    end if;

    -- retry שהגיע במקביל לבקשה שכבר יצרה: אותו תור, בלי INSERT נוסף
    -- ובלי appointment_history נוספת.
    return jsonb_build_object(
      'result',         v_prev.result_code,
      'appointment_id', v_prev.target_id,
      'replayed',       true
    );
  end if;

  -- ── הלקוחה ─────────────────────────────────────────────────────────────
  select * into v_customer from public.customers where id = p_customer_id;
  if v_customer.id is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- חשבון מנהל אינו לקוחה. שובל ורפאל מוחרגות מה-CRM, ואסור שייקבע להן תור.
  if v_customer.auth_user_id is not null
     and exists (select 1 from public.admins a where a.user_id = v_customer.auth_user_id) then
    raise exception 'CUSTOMER_IS_ADMIN' using errcode = '42501';
  end if;

  -- ── המועד ──────────────────────────────────────────────────────────────
  -- חריגה משעות הפעילות מותרת למנהלת (זו כל הנקודה בתור ידני), אבל מועד
  -- בעבר אינו חריגה ניהולית — הוא טעות.
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'START_IN_PAST' using errcode = '22023';
  end if;
  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 480 then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  -- ── היצירה ─────────────────────────────────────────────────────────────
  -- ends_at נכתב ע"י הטריגר set_appointment_end ולכן אינו נשלח כאן.
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status,
    pending_expires_at, original_starts_at, reschedule_count, has_deposit,
    calendar_sync_status, calendar_sync_operation, policy_version,
    booking_source
  ) values (
    p_customer_id, p_service_key, coalesce(p_variants, '{}'), p_price_total,
    p_starts_at, p_duration_min, 'confirmed',
    null, null, 0, false,
    'pending', 'upsert', p_policy_version,
    'admin_manual'
  )
  returning * into v_row;

  -- שורת היסטוריה **אחת**. retry לא מגיע לכאן בכלל (הוא נעצר למעלה).
  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, to_starts_at,
    actor, actor_id, source
  ) values (
    v_row.id, 'created', null, 'confirmed', v_row.starts_at,
    'admin', p_admin_id, 'admin_dashboard'
  );

  update public.admin_idempotency
  set result_code = 'appointment_created', target_id = v_row.id
  where scope = 'appointment_create'
    and actor_admin_id = p_admin_id
    and client_request_id = p_client_request_id;

  return jsonb_build_object(
    'result',         'appointment_created',
    'appointment_id', v_row.id,
    'starts_at',      v_row.starts_at,
    'ends_at',        v_row.ends_at,
    'replayed',       false
  );
end;
$$;


-- ============================================================================
-- הרשאות
--
-- ⚠️ **`from public, anon, authenticated` — ולא `from public` בלבד.**
--
-- זו בדיוק הטעות ש-0006 בא לתקן ב-0003–0005: `revoke ... from public` נראה
-- נכון אבל אינו מסיר את ההרשאה הישירה ש-Supabase נותנת ל-anon ול-
-- authenticated, ו-PostgREST ממשיך לחשוף את הפונקציה לכל מי שמחזיק את
-- מפתח ה-anon.
--
-- ⚠️ כאן זה חמור במיוחד: create_public_pending_appointment מקבלת
-- customer_id ו-expires_at כפרמטרים וסומכת על כך שהקורא כבר אימת אותם.
-- חשיפה ל-anon הייתה מאפשרת ליצור בקשות עבור **כל** לקוחה, לעקוף את כל
-- הוולידציה ב-route, ולדלג על חלון הזמינות כולו.
--
-- scripts/test-rpc-permissions.mjs אוכף את זה על כל RPC רגיש בפרויקט.
--
-- ⚠️ create_manual_appointment מקבלת REVOKE ו-GRANT מחדש למרות שהיא כבר
-- קיימת: CREATE OR REPLACE משמר הרשאות, אבל הצהרה מפורשת עדיפה על
-- הסתמכות על כך.
-- ============================================================================

revoke execute on function public.link_or_create_customer_by_phone(text, text)
  from public, anon, authenticated;
revoke execute on function public.create_public_pending_appointment(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer)
  from public, anon, authenticated;
revoke execute on function public.create_manual_appointment(uuid, text, text[], integer, timestamptz, integer, text, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.link_or_create_customer_by_phone(text, text) to service_role;
grant execute on function public.create_public_pending_appointment(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer) to service_role;
grant execute on function public.create_manual_appointment(uuid, text, text[], integer, timestamptz, integer, text, uuid, uuid, text) to service_role;


-- ─── אימות ─────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'link_or_create_customer_by_phone'
  ) then
    raise exception '0018: link_or_create_customer_by_phone לא נוצרה' using errcode = 'P0103';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_public_pending_appointment'
  ) then
    raise exception '0018: create_public_pending_appointment לא נוצרה' using errcode = 'P0103';
  end if;

  -- 🔒 שתיהן חייבות להישאר INVOKER. prosecdef = true מסמן DEFINER.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('link_or_create_customer_by_phone', 'create_public_pending_appointment')
      and p.prosecdef
  ) then
    raise exception '0018: פונקציה הוגדרה כ-SECURITY DEFINER' using errcode = 'P0103';
  end if;

  -- ── 🔒 ההרשאות בפועל, לא רק הצהרת ה-REVOKE ───────────────────────────
  --
  -- ⚠️ הבדיקה היא על ההרשאה האפקטיבית ולא על טקסט המיגרציה. `revoke ...
  -- from public` לבדו נראה נכון ואינו מסיר את ההרשאה הישירה של anon/
  -- authenticated — זו בדיוק הטעות ש-0006 בא לתקן. רק has_function_privilege
  -- מוכיח שהדלת באמת סגורה.
  if has_function_privilege('anon',
       'public.link_or_create_customer_by_phone(text, text)', 'execute')
  then raise exception '0018: anon יכול להפעיל את link_or_create_customer_by_phone'; end if;

  if has_function_privilege('authenticated',
       'public.link_or_create_customer_by_phone(text, text)', 'execute')
  then raise exception '0018: authenticated יכול להפעיל את link_or_create_customer_by_phone'; end if;

  if has_function_privilege('anon',
       'public.create_public_pending_appointment(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer)', 'execute')
  then raise exception '0018: anon יכול להפעיל את create_public_pending_appointment'; end if;

  if has_function_privilege('authenticated',
       'public.create_public_pending_appointment(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer)', 'execute')
  then raise exception '0018: authenticated יכול להפעיל את create_public_pending_appointment'; end if;

  -- ⚠️ הכיוון ההפוך: ההרשאה של service_role חייבת *להישמר*. בדיקה שרק
  -- מוודאת ש-anon חסום הייתה עוברת גם אם REVOKE סגר את כולם.
  if not has_function_privilege('service_role',
       'public.link_or_create_customer_by_phone(text, text)', 'execute')
  then raise exception '0018: service_role איבד את link_or_create_customer_by_phone'; end if;

  if not has_function_privilege('service_role',
       'public.create_public_pending_appointment(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer)', 'execute')
  then raise exception '0018: service_role איבד את create_public_pending_appointment'; end if;

  if not has_function_privilege('service_role',
       'public.create_manual_appointment(uuid, text, text[], integer, timestamptz, integer, text, uuid, uuid, text)', 'execute')
  then raise exception '0018: service_role איבד את create_manual_appointment'; end if;

  -- ── 🔒 RLS על booking_rate_events עדיין מופעל ואין policies ───────────
  if not exists (
    select 1 from pg_class where oid = 'public.booking_rate_events'::regclass and relrowsecurity
  ) then
    raise exception '0018: RLS כבוי על booking_rate_events';
  end if;

  raise notice '0018: שתי פונקציות חדשות נוצרו כ-INVOKER וסגורות ל-anon/authenticated.';
end $$;
