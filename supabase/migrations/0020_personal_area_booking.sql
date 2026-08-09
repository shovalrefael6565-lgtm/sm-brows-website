-- ============================================================================
-- 0020 — שלב 15D: קביעת תור מהאזור האישי
--
-- פעולה אחת: create_personal_area_booking_request — בקשת תור של לקוחה
-- **מאומתת**, עם ה-guards וההרשאות שלה.
--
-- ═══ 🔒 מיגרציה **תוספתית בלבד** — וזה העיקר ═══
--
-- ⚠️ המיגרציה הזו **אינה מוחקת דבר**, ובמיוחד אינה מוחקת את
-- create_pending_appointment (0003). המחיקה חיה במיגרציה נפרדת, 0021,
-- שתורץ **רק אחרי** שהקוד החדש נפרס ו-QA-D עבר בפרודקשן.
--
-- הסיבה היא סדר הפריסה. מיגרציה ופריסת קוד אינן אטומיות, ולכן תמיד יש
-- רגע שבו אחת מהן קדמה לשנייה:
--
--   0020 בלבד  ⟶ **שתי** הפונקציות חיות. הקוד הישן (שקורא לישנה) והקוד
--                 החדש (שקורא לחדשה) שניהם עובדים. אין חלון שבירה.
--   0021 אחרי  ⟶ הישנה נמחקת, כשכבר אין בעולם קוד שקורא לה.
--
-- אילו ה-DROP היה כאן, כל בקשה שהייתה מגיעה ל-deployment הישן בין הרצת
-- המיגרציה לבין סיום הפריסה הייתה מקבלת 500. החלון קצר, אבל הוא קיים —
-- ופיצול לשתי מיגרציות מבטל אותו לגמרי במקום לקוות שהוא יחלוף בשקט.
--
-- ⚠️ **0021 אינה אופציונלית.** כל עוד היא לא הורצה, create_pending_appointment
-- נשארת חיה ומוענקת ל-service_role — RPC עם כלל התפוגה הישן של 12 שעות,
-- שקוד עתידי עלול לקרוא לו בטעות ולקבל שקט מוחלט. ראה את ההסבר המלא שם.
--
-- ─── למה פונקציה חדשה ולא CREATE OR REPLACE על הישנה ──────────────────────
--
-- create_pending_appointment (0003) חישבה את התפוגה בעצמה:
--   pending_expires_at = now() + business_settings.pending_expiration_hours  (=12)
--
-- מאז 15B הכלל העסקי הוא אחר לגמרי — 3 שעות, עם גלגול ל-11:00 ביום העבודה
-- הבא כשהתוצאה נופלת בלילה או ביום סגור (lib/pendingExpiry.ts). הכלל הזה
-- **אינו ניתן לביטוי ב-SQL**: הוא נשען על isFridayOrSaturday מ-
-- lib/bookingWindow.ts, ול-Postgres אין גישה ללוגיקת ימי העבודה של הקוד.
-- לכן, בדיוק כמו ב-create_public_booking_request (0018), התפוגה מחושבת
-- בשרת ומגיעה כפרמטר — וה-RPC אוכף רק שהיא סבירה.
--
-- 🔒 שינוי הפרמטרים היה יוצר overload שני עם אותו שם — שתי גרסאות של אותה
-- פונקציה, שההבדל היחיד ביניהן הוא פרמטר, ו-PostgREST בוחר לפי מה שנשלח.
-- שם חדש הופך את המעבר למפורש, ומאפשר להריץ את שתיהן זו לצד זו בבטחה
-- לאורך הפריסה — בדיוק מה שהפיצול ל-0021 מנצל.
--
-- ─── ההבדל מול המסלול הציבורי ──────────────────────────────────────────────
--
-- create_public_booking_request מקבלת **טלפון** ויוצרת/מקשרת לקוחה, כי אין
-- שם session. כאן ההפך: p_customer_id מגיע מ-getCurrentCustomerId, שמוכיחה
-- את הבעלות מול customers.auth_user_id בכל בקשה מחדש. לכן:
--
--   ❌ אין p_phone_e164 ואין p_full_name — אין דרך לקבוע תור עבור לקוחה אחרת
--   ❌ אין p_ip ואין booking_rate_events — מגבלת הקצב לפי IP נועדה למסלול
--      אנונימי. כאן השער הוא ה-session עצמו + max_active_pending_per_customer
--   ✅ אותה נעילת לקוחה (namespace 5), אותה תפוגה עצלה, אותה מגבלת pending,
--      אותה תקרת 72 שעות, אותה שורת היסטוריה
--
-- ⚠️ **הנעילה אינה קישוט.** 0018 כותבת במפורש "15D חייב לאחוז באותה
-- נעילה". בלעדיה, שתי בקשות מקבילות של אותה לקוחה — אחת מהאזור האישי ואחת
-- מהמסלול הציבורי — סופרות יחד לפני שאף אחת מהן כתבה, ושתיהן עוברות את
-- max_active_pending_per_customer. אותו namespace (5) ואותו מפתח
-- (customer_id) הם מה שמסדר ביניהן.
--
-- 🔒 מה שהמיגרציה הזו **אינה** עושה:
--   • **אין DROP.** אין כאן מחיקה של שום דבר — ראה למעלה.
--   • אין שינוי סכימה. booking_source ו-'personal_area' נוספו ב-0017.
--   • אין נגיעה ב-create_public_booking_request, ב-create_manual_appointment
--     או ב-link_or_create_customer_by_phone — המסלול הציבורי לא זז.
--   • אין נגיעה ב-appointments_no_overlap, ב-expire_stale_pending_appointments
--     או ב-cancel_pending_appointment.
--   • אין backfill. שורות עם booking_source ריק נשארות כפי שהן.
-- ============================================================================


-- ============================================================================
-- חלק 1 — בקשת תור מהאזור האישי
-- ============================================================================

create or replace function public.create_personal_area_booking_request(
  p_customer_id    uuid,
  p_service_key    text,
  p_variants       text[],
  p_price_total    integer,
  p_starts_at      timestamptz,
  p_duration_min   integer,
  p_notes          text,
  p_policy_version text,
  p_expires_at     timestamptz
) returns public.appointments
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  -- חגורת בטיחות על התפוגה, זהה ל-0018 ול-PENDING_EXPIRY_MAX_HOURS:
  -- המקרה הלגיטימי הארוך ביותר (חמישי בערב → ראשון 11:00) הוא כ-66 שעות.
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

  -- ── 🔒 הנעילה (namespace 5) — אותו מפתח בדיוק כמו ב-0018 ───────────────
  --
  -- ⚠️ לפני הספירה ולפני ה-INSERT. בקשה מקבילה של אותה לקוחה — מכאן או
  -- מהמסלול הציבורי — ממתינה כאן ורואה את המצב אחרי ה-commit של הראשונה.
  perform pg_advisory_xact_lock(5, hashtext(p_customer_id::text));

  -- ── הלקוחה קיימת ואינה חסומה ───────────────────────────────────────────
  --
  -- ⚠️ הבדיקה כאן אינה מיותרת למרות ש-getCurrentCustomerId כבר אימתה את
  -- ה-session: בין הקריאה ההיא לכאן הלקוחה יכולה להיחסם, וה-RPC הוא
  -- הנקודה האחרונה שרואה את המצב בתוך הטרנזקציה שכותבת בפועל.
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
  -- אותו סדר בדיוק כמו ב-0003 וב-0018: בקשה שכבר פגה לא תחסום בקשה חדשה
  -- ולא תחזיק סלוט, וה-EXCLUDE constraint עדיין נבדק כרגיל ב-INSERT.
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
  -- ⚠️ כשל של ה-EXCLUDE constraint (23P01) מגלגל לאחור את כל הטרנזקציה,
  -- כולל שורת ההיסטוריה. אין partial write.
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status,
    pending_expires_at, notes, policy_version, booking_source
  ) values (
    p_customer_id, p_service_key, coalesce(p_variants, '{}'), p_price_total,
    p_starts_at, p_duration_min, 'pending',
    p_expires_at, p_notes, p_policy_version, 'personal_area'
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

comment on function public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz) is
  'בקשת תור של לקוחה מאומתת מהאזור האישי. customer_id מה-session בלבד; נועלת namespace 5 כמו המסלול הציבורי; booking_source=personal_area.';


-- ============================================================================
-- חלק 2 — הרשאות
--
-- ⚠️ `revoke ... from public` לבדו **אינו מספיק**. Supabase מעניקה EXECUTE
-- ישירות ל-anon ול-authenticated על כל פונקציה חדשה בסכמה public, ורק
-- שלילה מפורשת משלושתם סוגרת את הדלת. זו הטעות שתוקנה ב-0006, ו-
-- scripts/test-rpc-permissions.mjs אוכף אותה על כל RPC רגיש בפרויקט.
--
-- ⚠️ כאן זה חמור במיוחד: הפונקציה מקבלת customer_id כפרמטר וסומכת על כך
-- שהקורא כבר הוכיח בעלות. חשיפה ל-anon הייתה מאפשרת לכל מי שמחזיק את
-- מפתח ה-anon לקבוע תור **בשם כל לקוחה**, ולעקוף את חלון הזמינות כולו.
-- ============================================================================

revoke execute on function public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz) to service_role;


-- ─── אימות ─────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_personal_area_booking_request'
  ) then
    raise exception '0020: create_personal_area_booking_request לא נוצרה' using errcode = 'P0103';
  end if;

  -- 🔒 חייבת להישאר INVOKER. prosecdef = true מסמן DEFINER.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_personal_area_booking_request'
      and p.prosecdef
  ) then
    raise exception '0020: הפונקציה הוגדרה כ-SECURITY DEFINER' using errcode = 'P0103';
  end if;

  /*
   * 🔒 ה-RPC הישן חייב **להישאר חי** אחרי המיגרציה הזו.
   *
   * ⚠️ זו אינה בדיקה הפוכה בטעות. כל עוד רק 0020 הותקנה, ייתכן שרץ בפרודקשן
   * deployment ישן שעדיין קורא ל-create_pending_appointment. אם הפונקציה
   * נעלמה כאן — מישהו הריץ את 0021 מוקדם מדי, וזה בדיוק חלון השבירה
   * שהפיצול נועד למנוע. עדיף להיכשל כאן, בגלוי, מאשר בפרודקשן.
   */
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_pending_appointment'
  ) then
    raise exception
      '0020: create_pending_appointment כבר אינה קיימת — 0021 הורצה לפני הזמן'
      using errcode = 'P0103';
  end if;

  -- ── 🔒 ההרשאות בפועל, לא רק הצהרת ה-REVOKE ───────────────────────────
  if has_function_privilege('anon',
       'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz)', 'execute')
  then raise exception '0020: anon יכול להפעיל את create_personal_area_booking_request'; end if;

  if has_function_privilege('authenticated',
       'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz)', 'execute')
  then raise exception '0020: authenticated יכול להפעיל את create_personal_area_booking_request'; end if;

  -- ⚠️ הכיוון ההפוך: ההרשאה של service_role חייבת *להישמר*. בדיקה שרק
  -- מוודאת ש-anon חסום הייתה עוברת גם אם REVOKE סגר את כולם.
  if not has_function_privilege('service_role',
       'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz)', 'execute')
  then raise exception '0020: service_role איבד את create_personal_area_booking_request'; end if;

  -- 🔒 שתי הפונקציות הנוספות מ-0003 עדיין בשימוש פעיל.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cancel_pending_appointment'
  ) then
    raise exception '0020: cancel_pending_appointment נעלמה' using errcode = 'P0103';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'expire_stale_pending_appointments'
  ) then
    raise exception '0020: expire_stale_pending_appointments נעלמה' using errcode = 'P0103';
  end if;

  raise notice '0020: create_personal_area_booking_request נוצרה כ-INVOKER וסגורה ל-anon/authenticated. create_pending_appointment נשארת חיה בכוונה — 0021 מוחקת אותה אחרי הפריסה ו-QA-D.';
end $$;
