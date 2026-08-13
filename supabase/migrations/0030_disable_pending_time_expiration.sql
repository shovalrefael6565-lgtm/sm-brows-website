-- ============================================================================
-- 0030 — ביטול תפוגת pending מבוססת-זמן
--
-- ═══ כלל עסקי חדש ═══
-- ברגע שלקוחה שולחת בקשת תור, הסלוט חייב להישאר חסום כל עוד הסטטוס
-- pending — **לא משנה כמה זמן עבר**. השחרור היחיד הוא דחייה/ביטול (ע"י
-- שובל או ע"י הלקוחה). אישור הופך את הבקשה ל-confirmed והיא ממשיכה
-- לחסום כרגיל. שום דבר לא קורה אוטומטית בגלל שעון.
--
-- הכלל חל על **כל** שורת pending בטבלה, כולל בקשות שינוי מועד (15E) —
-- הן שורת pending לכל דבר, נבדקות ע"י אותו constraint, ואין בבקשת
-- המשתמש שום סייג שמוציא אותן.
--
-- ─── שני שכבות תפוגה, ולכן שני חלקי תיקון ──────────────────────────────────
--
-- גילוי האודיט: יש שתי מנגנוני תפוגה עצמאיים, לא אחד:
--
--   1. **הטאטוא** — expire_stale_pending_appointments() (0003), שהופכת
--      pending ישן ל-expired. נקראת lazy מ-3 RPCs של יצירה ומ-4 מסלולי
--      קריאה ב-lib/db/appointments.ts. אין cron בכלל (ראה האודיט).
--   2. **השערים העצמאיים** — approve_pending_appointment (0005),
--      reject_pending_appointment (0019), approve_reschedule_request
--      ו-reject_reschedule_request (0022) **כולם** בודקים בעצמם
--      `pending_expires_at <= now()` בתוך ה-WHERE/IF שלהם — עצמאי
--      לחלוטין מהטאטוא. גם אם הטאטוא היה מנוטרל בלבד, שורת pending
--      ישנה הייתה נתקעת: לא ניתנת לאישור ולא לדחייה, כי ה-WHERE שלהן
--      מחזיר אפס שורות ברגע שה-timestamp עובר, בלי קשר לסטטוס בפועל.
--
-- ⚠️ **לכן התיקון חייב לגעת בשתי השכבות**, לא רק בטאטוא:
--   א. הטאטוא הופך ל-no-op (בטיחות: לא נוגע בשום שורה, גם ישנה).
--   ב. שלוש פונקציות היצירה (create_public_booking_request 0018,
--      create_personal_area_booking_request 0020, create_reschedule_request
--      0022) מפסיקות לכתוב מועד תפוגה אמיתי ל-pending_expires_at —
--      כותבות null. null כבר מוגדר בכל המערכת כ"לעולם לא פג" (זו הייתה
--      הכוונה המקורית ב-0003 לשורות שקדמו לה).
--   ג. ארבעת השערים העצמאיים מפסיקים לבדוק pending_expires_at בכלל —
--      כי גם שורות pending **קיימות** בפרודקשן, שכבר יש להן מועד תפוגה
--      אמיתי מלפני המיגרציה הזו (ואי אפשר "לתקן" אותן ב-UPDATE — אין
--      נגיעה בנתוני פרודקשן), חייבות להיות ניתנות לאישור/דחייה כרגיל.
--      בלי (ג), (ב) לבדו לא מספיק לשורות הישנות האלה.
--
-- ─── מה **לא** משתנה ────────────────────────────────────────────────────────
--   • appointments_no_overlap (ה-EXCLUDE constraint) — לא נוגעים. זו
--     ההגנה האמיתית מפני שתי לקוחות שתופסות אותו סלוט, והיא כבר סופרת
--     pending+confirmed בלבד, בלי תלות בזמן.
--   • cancel_pending_appointment (0003) — כבר לא בדקה pending_expires_at
--     מלכתחילה (רק status='pending'), כלומר ביטול ע"י הלקוחה כבר עובד
--     בדיוק כמו שנדרש: לא נוגעים בה.
--   • approve_reschedule_request ממשיכה לבדוק ORIGINAL_IN_PAST/
--     TARGET_IN_PAST (0022) — אלה **אינן** בדיקות תפוגה-לפי-זמן, אלא
--     תקינות: אישור לא יכול "להזיז" תור שכבר קרה. אין קשר ל-
--     pending_expires_at, ולכן אין סיבה לגעת בהן.
--   • העמודה pending_expires_at, ה-index החלקי עליה, ה-enum value
--     'expired', וכל מקום שמציג/מסנן 'expired' (תוויות מנהל/לקוחה,
--     סנכרון יומן נכנס) — נשארים. שורות expired היסטוריות ממשיכות
--     להיות תקינות; פשוט לא ייווצרו חדשות מהיום.
--   • business_settings.pending_expiration_hours — כבר מת (נקרא רק
--     ע"י create_pending_appointment הישנה, שנמחקה ב-0021). לא נוגעים.
--
-- ─── תוצאת לוואי חיובית ב-UI ────────────────────────────────────────────────
-- מסך הניהול מציג "פגה ב-..." רק כש-pending_expires_at אינו null
-- (app/admin/(protected)/page.tsx). מרגע שיצירת בקשה כותבת null, התווית
-- נעלמת מאליה לבקשות חדשות — בלי שום שינוי ב-UI. שורות pending קיימות
-- שכבר יש להן מועד תפוגה אמיתי ימשיכו להציג את התווית עד שיוכרעו
-- (אישור/דחייה/ביטול), אבל זה כבר לא אמת מטעה: השורה לא באמת תיעלם,
-- וזה בדיוק המצב הזמני שמתלווה לאי-נגיעה בנתוני פרודקשן.
-- ============================================================================


-- ============================================================================
-- חלק 1 — הטאטוא הופך ל-no-op
-- ============================================================================

create or replace function public.expire_stale_pending_appointments()
returns void
language plpgsql
as $$
begin
  -- 🔒 מכוונת: הכלל העסקי החדש הוא שאין תפוגה מבוססת-זמן בכלל.
  -- הפונקציה נשארת קיימת (לא DROP) כי כל שלוש פונקציות היצירה עדיין
  -- קוראות לה כ-perform, ו-0020/0021 מאמתות בזמן ריצה שהיא קיימת —
  -- לשמור על אלה בלי לגעת בהן, no-op עדיף על מחיקה.
  null;
end;
$$;

revoke execute on function public.expire_stale_pending_appointments()
  from public, anon, authenticated;

grant execute on function public.expire_stale_pending_appointments() to service_role;


-- ============================================================================
-- חלק 2 — יצירת בקשה ציבורית: pending_expires_at = null
--
-- שינוי יחיד מול 0018: הערך שנכתב לעמודה. p_expires_at עדיין מתקבל
-- ומאומת (BAD_EXPIRY) בדיוק כמו קודם — כדי לא לגעת בחוזה ה-RPC כלפי
-- app/api/bookings/request/route.ts, שממשיך לחשב ולשלוח אותו. פשוט
-- כבר לא נשמר בתור מועד תפוגה אמיתי.
-- ============================================================================

create or replace function public.create_public_booking_request(
  p_phone_e164          text,
  p_full_name           text,
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
  -- בהמשך. השם של לקוחה קיימת אינו נדרס (ראה חלק 1).
  v_customer := public.link_or_create_customer_by_phone(p_phone_e164, p_full_name);

  -- ── לקוחה חסומה ────────────────────────────────────────────────────────
  -- ⚠️ errcode ייעודי כדי שהשרת יוכל לרשום מה קרה. התשובה הציבורית
  -- **חייבת** להיות זהה לכשל גנרי — ראה ה-route.
  if v_customer.is_blocked then
    raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0013';
  end if;

  -- ── 🔒 נעילה 3 מתוך 3: הלקוחה (namespace 5) ────────────────────────────
  --
  -- 🔒 בלי זה הספירה למטה אינה אטומית: שתי בקשות לאותה לקוחה מ-IP שונים
  -- נועלות מפתחות IP שונים, עוברות את הספירה יחד, ושוברות את
  -- max_active_pending_per_customer. **15D חייב לאחוז באותה נעילה.**
  perform pg_advisory_xact_lock(5, hashtext(v_customer.id::text));

  -- ── תפוגת בקשות ישנות (no-op מ-0030), ואז המגבלה ללקוחה ─────────────────
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
  -- ⚠️ אם ה-EXCLUDE constraint נכשל (23P01), כל הטרנזקציה מתגלגלת לאחור —
  -- הלקוחה, ההיסטוריה ואירוע הקצב יחד. זה מה שמבטיח גם "אין partial write"
  -- וגם "נספרות הצלחות בלבד".
  --
  -- 🔒 0030: pending_expires_at = null, לא p_expires_at. הבקשה לא פגה
  -- לעולם — רק דחייה/ביטול/אישור מזיזים אותה מ-pending.
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status,
    pending_expires_at, notes, policy_version, booking_source
  ) values (
    v_customer.id, p_service_key, coalesce(p_variants, '{}'), p_price_total,
    p_starts_at, p_duration_min, 'pending',
    null, p_notes, p_policy_version, 'public_booking'
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

comment on function public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer) is
  'בקשת תור מהמסלול הציבורי: לקוחה, תור ואירוע קצב בטרנזקציה אחת. נועלת 4→3→5. מגבלת ה-IP נאכפת לפני יצירת הלקוחה. 0030: pending_expires_at תמיד null — אין תפוגה מבוססת-זמן.';

revoke execute on function public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer)
  from public, anon, authenticated;

grant execute on function public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer) to service_role;


-- ============================================================================
-- חלק 3 — בקשת תור מהאזור האישי: pending_expires_at = null
--
-- אותו שינוי יחיד מול 0020.
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

  -- ── תפוגת בקשות ישנות (no-op מ-0030), ואז המגבלה ללקוחה ─────────────────
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
  --
  -- 🔒 0030: pending_expires_at = null, לא p_expires_at — ראה חלק 2.
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status,
    pending_expires_at, notes, policy_version, booking_source
  ) values (
    p_customer_id, p_service_key, coalesce(p_variants, '{}'), p_price_total,
    p_starts_at, p_duration_min, 'pending',
    null, p_notes, p_policy_version, 'personal_area'
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
  'בקשת תור של לקוחה מאומתת מהאזור האישי. customer_id מה-session בלבד; נועלת namespace 5 כמו המסלול הציבורי; booking_source=personal_area. 0030: pending_expires_at תמיד null.';

revoke execute on function public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz) to service_role;


-- ============================================================================
-- חלק 4 — בקשת שינוי מועד: pending_expires_at = null
--
-- שינוי מול 0022: הסרת v_expires_at := least(p_expires_at, orig.starts_at,
-- new.starts_at) — החיתוך היה מגן מפני אישור בקשה אחרי שהמקור/היעד כבר
-- חלפו, אבל approve_reschedule_request (חלק 6 למטה) כבר עושה בדיוק את
-- זה בעצמה, ישירות, בלי תלות ב-pending_expires_at (ORIGINAL_IN_PAST /
-- TARGET_IN_PAST) — ולכן החיתוך פה מיותר לגמרי להגנה, ורק היה מפעיל
-- תפוגה-לפי-זמן שהכלל העסקי החדש אוסר. p_expires_at עדיין מתקבל
-- ומאומת (BAD_EXPIRY) כדי לא לגעת בחוזה כלפי הקוד שקורא לפונקציה הזו.
-- ============================================================================

create or replace function public.create_reschedule_request(
  p_appointment_id uuid,
  p_customer_id    uuid,
  p_new_starts_at  timestamptz,
  p_expires_at     timestamptz
) returns public.appointments
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  -- אותה תקרת ביטחון כמו 0018/0020 ו-PENDING_EXPIRY_MAX_HOURS
  c_expiry_max   constant interval := interval '72 hours';

  v_orig         public.appointments;
  v_row          public.appointments;
  v_customer     public.customers;
  v_cutoff_hours numeric;
  v_max_resched  integer;
  v_new_ends_at  timestamptz;
begin
  -- ── ולידציה ────────────────────────────────────────────────────────────
  if p_customer_id is null then
    raise exception 'MISSING_CUSTOMER' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + c_expiry_max then
    raise exception 'BAD_EXPIRY' using errcode = '22023';
  end if;
  if p_new_starts_at is null or p_new_starts_at <= now() then
    raise exception 'NEW_IN_PAST' using errcode = '22023';
  end if;

  -- ── 🔒 הנעילה (namespace 5) — אותו מפתח בדיוק כמו ב-0018/0020 ───────────
  --
  -- 🔒 בלי זה שתי פעולות מקבילות של אותה לקוחה (בקשת שינוי כאן + בקשת תור
  -- רגילה מהמסלול הציבורי) לא היו רואות זו את זו.
  perform pg_advisory_xact_lock(5, hashtext(p_customer_id::text));

  -- ── הלקוחה קיימת ואינה חסומה ───────────────────────────────────────────
  select * into v_customer from public.customers where id = p_customer_id;
  if v_customer.id is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_customer.is_blocked then
    raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0013';
  end if;

  -- ── התור המקורי, נעול ─────────────────────────────────────────────────
  --
  -- 🔒 סדר הנעילה בכל שלוש הפונקציות של 15E זהה: **המקור תמיד ראשון**,
  -- ורק אחריו הבקשה. סדר קבוע = אין deadlock בין create/approve/reject.
  select * into v_orig
    from public.appointments
    where id = p_appointment_id and customer_id = p_customer_id
    for update;

  if v_orig.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 🔒 **רק תור confirmed ניתן להזזה — וזו כל הבדיקה הנדרשת.**
  if v_orig.status <> 'confirmed' then
    raise exception 'NOT_RESCHEDULABLE' using errcode = 'P0006';
  end if;

  -- פעולת סנכרון פעילה (lease חי) — לא נוגעים בתור תחתיה
  if v_orig.calendar_sync_status = 'syncing'
     and v_orig.calendar_sync_started_at is not null
     and v_orig.calendar_sync_started_at > now() - interval '2 minutes' then
    raise exception 'SYNC_IN_PROGRESS' using errcode = 'P0007';
  end if;

  if v_orig.starts_at <= now() then
    raise exception 'IN_PAST' using errcode = 'P0008';
  end if;

  -- ── המועד המבוקש זהה לקיים ────────────────────────────────────────────
  if v_orig.starts_at = p_new_starts_at then
    raise exception 'NO_CHANGE' using errcode = 'P0014';
  end if;

  -- ── 🔒 חפיפה עצמית ─────────────────────────────────────────────────────
  --
  -- ends_at של הבקשה עדיין לא קיים (הטריגר יכתוב אותו ב-INSERT), ולכן
  -- הוא מחושב כאן מאותו duration_min של התור המקורי.
  v_new_ends_at := p_new_starts_at + make_interval(mins => v_orig.duration_min);
  if tstzrange(p_new_starts_at, v_new_ends_at) && tstzrange(v_orig.starts_at, v_orig.ends_at) then
    raise exception 'SELF_OVERLAP' using errcode = 'P0015';
  end if;

  -- ── מדיניות ────────────────────────────────────────────────────────────
  v_max_resched := public.setting_numeric('max_reschedules', 2)::integer;
  if v_orig.reschedule_count >= v_max_resched then
    raise exception 'MAX_RESCHEDULES' using errcode = 'P0009';
  end if;

  v_cutoff_hours := public.setting_numeric('reschedule_cutoff_hours', 6);
  if v_orig.starts_at < now() + (v_cutoff_hours * interval '1 hour') then
    raise exception 'TOO_LATE' using errcode = 'P0011';
  end if;

  -- ── תפוגת בקשות ישנות (no-op מ-0030) לפני בדיקת הכפילות ──────────────────
  perform public.expire_stale_pending_appointments();

  -- ⚠️ הבדיקה הזו היא לנוסח ההודעה בלבד. ההגנה האמיתית מפני שתי בקשות
  -- מקבילות היא appointments_one_open_reschedule_per_appt.
  if exists (
    select 1 from public.appointments
    where reschedule_of_appointment_id = p_appointment_id and status = 'pending'
  ) then
    raise exception 'REQUEST_EXISTS' using errcode = 'P0016';
  end if;

  -- ── יצירת שורת הבקשה ───────────────────────────────────────────────────
  --
  -- ⚠️ הטיפול, המחיר, המשך והמקדמה מועתקים מהתור המקורי ולא מתקבלים
  -- מהדפדפן — שינוי טיפול אינו בהיקף השלב, ובקשה אינה יכולה להוזיל תור.
  -- booking_source יורש את המקור: אין ערך enum חדש (ראה הכותרת).
  -- ends_at נכתב ע"י הטריגר set_appointment_end.
  -- ⚠️ כשל 23P01 (היעד תפוס) מגלגל לאחור את כל הטרנזקציה, כולל ההיסטוריה.
  --
  -- 🔒 0030: pending_expires_at = null. ראה header של המיגרציה — החיתוך
  -- מול starts_at של המקור/היעד כבר לא צריך לעבור דרך העמודה הזו,
  -- approve_reschedule_request בודקת את זה ישירות.
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status, pending_expires_at,
    notes, policy_version, booking_source, has_deposit,
    reschedule_of_appointment_id
  ) values (
    v_orig.customer_id, v_orig.service_key, v_orig.variants, v_orig.price_total,
    p_new_starts_at, v_orig.duration_min, 'pending', null,
    v_orig.notes, v_orig.policy_version, v_orig.booking_source, v_orig.has_deposit,
    p_appointment_id
  )
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, to_starts_at, actor, actor_id, reason
  ) values (
    v_row.id, 'created', null, 'pending',
    v_orig.starts_at, p_new_starts_at, 'customer', p_customer_id,
    'reschedule_request'
  );

  return v_row;
end;
$$;

comment on function public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz) is
  'בקשת שינוי מועד כשורת pending נפרדת. התור המקורי נשאר confirmed וחוסם את שעתו. כלל 6 השעות מ-business_settings, בלי ענף מקדמה. 0030: pending_expires_at תמיד null — אין תפוגה מבוססת-זמן; אישור/דחייה מוגנים ישירות.';

revoke execute on function public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

grant execute on function public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz) to service_role;


-- ============================================================================
-- חלק 5 — אישור/דחייה: הסרת השער העצמאי על pending_expires_at
--
-- ⚠️ קריטי: בלי החלק הזה, שורת pending **קיימת** בפרודקשן (עם מועד
-- תפוגה אמיתי מלפני המיגרציה) הייתה נתקעת ברגע שהמועד עובר — לא ניתנת
-- לאישור וגם לא לדחייה, כי ה-WHERE שלהן היה ממשיך להחזיר אפס שורות.
-- זה קורה בלי קשר לחלק 1 (הטאטוא), כי הבדיקה כאן עצמאית לגמרי ממנו.
-- ============================================================================

create or replace function public.approve_pending_appointment(
  p_appointment_id uuid,
  p_admin_id       uuid
) returns public.appointments
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  update public.appointments
  set status = 'confirmed',
      calendar_sync_status = 'pending',
      calendar_sync_operation = 'upsert'
  where id = p_appointment_id
    and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_PENDING' using errcode = 'P0003';
  end if;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, actor, actor_id
  ) values (
    v_row.id, 'status_changed', 'pending', 'confirmed', 'admin', p_admin_id
  );

  return v_row;
end;
$$;

comment on function public.approve_pending_appointment(uuid, uuid) is
  'אישור בקשת pending → confirmed. 0030: אינה בודקת pending_expires_at עוד — אין תפוגה מבוססת-זמן, רק status=pending קובע.';

revoke execute on function public.approve_pending_appointment(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.approve_pending_appointment(uuid, uuid) to service_role;


create or replace function public.reject_pending_appointment(
  p_appointment_id uuid,
  p_admin_id       uuid
) returns public.appointments
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  update public.appointments
  set status = 'rejected'
  where id = p_appointment_id
    and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_PENDING' using errcode = 'P0003';
  end if;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, actor, actor_id
  ) values (
    v_row.id, 'status_changed', 'pending', 'rejected', 'admin', p_admin_id
  );

  return v_row;
end;
$$;

comment on function public.reject_pending_appointment(uuid, uuid) is
  'דחיית בקשת pending → rejected (15C). rejected = בקשה שלא אושרה; cancelled_by_business נשאר לביטול תור מאושר. הסלוט משתחרר מיידית כי appointments_no_overlap מונה pending/confirmed בלבד. 0030: אינה בודקת pending_expires_at עוד.';

revoke execute on function public.reject_pending_appointment(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.reject_pending_appointment(uuid, uuid) to service_role;


-- ============================================================================
-- חלק 6 — אישור/דחייה של בקשת שינוי מועד: אותה הסרה
--
-- ⚠️ approve_reschedule_request ממשיכה לבדוק ORIGINAL_IN_PAST ו-
-- TARGET_IN_PAST בעצמה, ישירות על starts_at — אלה נשארות בדיוק כפי שהיו.
-- מה שמוסר כאן הוא **רק** הענף שבדק את pending_expires_at.
-- ============================================================================

create or replace function public.approve_reschedule_request(
  p_request_id uuid,
  p_admin_id   uuid
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_orig_id  uuid;
  v_orig     public.appointments;
  v_req      public.appointments;
  v_old_start timestamptz;
begin
  -- קריאה לא-נועלת רק כדי לדעת את מזהה המקור, כך שאפשר יהיה לנעול
  -- **קודם את המקור** ואחר כך את הבקשה — אותו סדר בדיוק כמו ב-
  -- create_reschedule_request וב-reject_reschedule_request.
  select reschedule_of_appointment_id into v_orig_id
    from public.appointments where id = p_request_id;

  if v_orig_id is null then
    raise exception 'NOT_A_REQUEST' using errcode = 'P0017';
  end if;

  select * into v_orig from public.appointments where id = v_orig_id for update;
  select * into v_req  from public.appointments where id = p_request_id for update;

  if v_req.id is null or v_orig.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 🔒 0030: רק status קובע. אין יותר תפוגה מבוססת-זמן על pending_expires_at.
  if v_req.status <> 'pending' then
    raise exception 'NOT_PENDING' using errcode = 'P0003';
  end if;

  -- 🔒 המקור חייב להיות עדיין confirmed. אם שובל ביטלה אותו בינתיים, אין
  -- מה "להעביר" — והשארת הבקשה pending היא התשובה הנכונה, לא אישור שקט.
  if v_orig.status <> 'confirmed' then
    raise exception 'ORIGINAL_NOT_CONFIRMED' using errcode = 'P0018';
  end if;

  -- ── 🔒 שני המועדים חייבים להיות עדיין בעתיד ────────────────────────────
  --
  -- ⚠️ אלה **אינן** בדיקות תפוגה-לפי-זמן — אין קשר ל-pending_expires_at.
  -- זו תקינות: אישור תור לשעה שכבר עברה הוא בדיוק סוג הכשל שאין ממנו
  -- חזרה, הוא משחרר את השעה הישנה ויוצר אירוע ביומן בעבר. נשארות בדיוק
  -- כפי שהיו לפני 0030.
  if v_orig.starts_at <= now() then
    raise exception 'ORIGINAL_IN_PAST' using errcode = 'P0008';
  end if;

  if v_req.starts_at <= now() then
    raise exception 'TARGET_IN_PAST' using errcode = 'P0008';
  end if;

  -- lease סנכרון פעיל על אחת מהשתיים — לא נוגעים תחתיו
  if (v_orig.calendar_sync_status = 'syncing'
      and v_orig.calendar_sync_started_at is not null
      and v_orig.calendar_sync_started_at > now() - interval '2 minutes')
     or (v_req.calendar_sync_status = 'syncing'
      and v_req.calendar_sync_started_at is not null
      and v_req.calendar_sync_started_at > now() - interval '2 minutes') then
    raise exception 'SYNC_IN_PROGRESS' using errcode = 'P0007';
  end if;

  v_old_start := v_orig.starts_at;

  -- ── הבקשה הופכת לתור הפעיל ─────────────────────────────────────────────
  --
  -- reschedule_count עובר מהמקור +1 — כך שמגבלת max_reschedules נשמרת
  -- לאורך כל השרשרת ולא מתאפסת בכל בקשה (החלטת 15E).
  -- original_starts_at שומר את המועד המקורי **הראשון** בשרשרת.
  update public.appointments
  set status                   = 'confirmed',
      pending_expires_at       = null,
      reschedule_count         = v_orig.reschedule_count + 1,
      original_starts_at       = coalesce(v_orig.original_starts_at, v_old_start),
      calendar_sync_operation  = 'upsert',
      calendar_sync_status     = 'pending',
      calendar_sync_started_at = null
  where id = p_request_id
  returning * into v_req;

  -- ── התור המקורי עובר לארכיון ומשחרר את שעתו ────────────────────────────
  --
  -- 'rescheduled' אינו נמנה ב-appointments_no_overlap, ולכן השעה הישנה
  -- משתחררת ברגע ה-COMMIT — לא לפניו.
  -- calendar_sync_operation='delete' הוא מה שיגרום ל-ensureCalendarSynced
  -- למחוק את האירוע הישן. בלעדיו האירוע היה נשאר ביומן וממשיך לחסום שעה
  -- שכבר התפנתה.
  update public.appointments
  set status                   = 'rescheduled',
      calendar_sync_operation  = 'delete',
      calendar_sync_status     = 'pending',
      calendar_sync_started_at = null
  where id = v_orig_id
  returning * into v_orig;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, to_starts_at, actor, actor_id, reason
  ) values (
    v_orig_id, 'rescheduled', 'confirmed', 'rescheduled',
    v_old_start, v_req.starts_at, 'admin', p_admin_id,
    'reschedule_approved'
  );

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, to_starts_at, actor, actor_id, reason
  ) values (
    p_request_id, 'status_changed', 'pending', 'confirmed',
    v_old_start, v_req.starts_at, 'admin', p_admin_id,
    'reschedule_approved'
  );

  return jsonb_build_object(
    'request',  to_jsonb(v_req),
    'original', to_jsonb(v_orig)
  );
end;
$$;

comment on function public.approve_reschedule_request(uuid, uuid) is
  'אישור בקשת שינוי מועד: הבקשה הופכת confirmed, המקור עובר rescheduled ומשחרר את שעתו. 0030: אין יותר בדיקת pending_expires_at — ORIGINAL_IN_PAST/TARGET_IN_PAST (בדיקת תקינות, לא תפוגה) נשארות.';

revoke execute on function public.approve_reschedule_request(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.approve_reschedule_request(uuid, uuid) to service_role;


create or replace function public.reject_reschedule_request(
  p_request_id uuid,
  p_admin_id   uuid
) returns public.appointments
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_orig_id uuid;
  v_row     public.appointments;
begin
  select reschedule_of_appointment_id into v_orig_id
    from public.appointments where id = p_request_id;

  if v_orig_id is null then
    raise exception 'NOT_A_REQUEST' using errcode = 'P0017';
  end if;

  -- אותו סדר נעילה: המקור ראשון. הוא אינו משתנה — הנעילה כאן היא רק
  -- כדי שלא ייווצר סדר הפוך מול approve/create ובעקבותיו deadlock.
  perform 1 from public.appointments where id = v_orig_id for update;

  -- ה-WHERE הוא מפתח ה-idempotency, בדיוק כמו ב-reject_pending_appointment
  -- (0019): לחיצה כפולה, או Approve ו-Reject במקביל, מקבלים אפס שורות
  -- בפעולה השנייה ונופלים ל-NOT_PENDING. 0030: הוסרה בדיקת pending_expires_at.
  update public.appointments
  set status = 'rejected'
  where id = p_request_id
    and status = 'pending'
    and reschedule_of_appointment_id is not null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_PENDING' using errcode = 'P0003';
  end if;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, to_starts_at, actor, actor_id, reason
  ) values (
    v_row.id, 'status_changed', 'pending', 'rejected', v_row.starts_at, 'admin', p_admin_id,
    'reschedule_rejected'
  );

  return v_row;
end;
$$;

comment on function public.reject_reschedule_request(uuid, uuid) is
  'דחיית בקשת שינוי מועד → rejected. היעד משתחרר; התור המקורי נשאר בדיוק כפי שהיה. 0030: אין יותר בדיקת pending_expires_at.';

revoke execute on function public.reject_reschedule_request(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.reject_reschedule_request(uuid, uuid) to service_role;


-- ============================================================================
-- חלק 7 — נורמליזציית נתונים קיימים: pending_expires_at → null
--
-- ⚠️ נתונים בלבד, לא סטטוס. שורות pending שנוצרו **לפני** המיגרציה הזו
-- כבר נושאות מועד תפוגה אמיתי (מהגרסה הישנה של שלוש פונקציות היצירה,
-- לפני חלקים 2–4 למעלה). בלי השורה הזו, שובל הייתה ממשיכה לראות "פגה
-- בעוד X" על בקשות פעילות במסך הניהול, למרות שדבר לא באמת יקרה כשהזמן
-- הזה מגיע — הטאטוא no-op (חלק 1) והאישור/הדחייה כבר לא בודקים את
-- העמודה (חלקים 5–6). זו בדיוק ההטעיה שהכלל העסקי אוסר, וזו הסיבה
-- שהנורמליזציה הזו נחוצה ולא רק "נחמד שיהיה".
--
-- 🔒 היקף מדויק, בכוונה:
--   • status = 'pending' בלבד. לא expired (שורה שכבר פגה נשארת expired
--     בדיוק כפי שהיא — אין "החייאה" שלה כאן, שום UPDATE לא נוגע בה כי
--     ה-WHERE מסנן על status), ולא שום סטטוס אחר
--     (confirmed/rejected/cancelled_by_*/rescheduled/completed/no_show).
--   • רק העמודה pending_expires_at משתנה. status, starts_at, ההיסטוריה
--     וכל שאר העמודות לא נוגעות — זו לא הכרעה על הבקשה, רק הסרת מועד
--     תפוגה שכבר לא אמור לחול לפי הכלל העסקי החדש.
--   • מכסה **גם** pending "רגילה" וגם בקשת שינוי מועד pending, באותו
--     UPDATE יחיד: שתיהן שורות ב-public.appointments עם status='pending'
--     — אין טבלה נפרדת לבקשות שינוי מועד (ראה 0022, "שורה שנייה ולא
--     טבלה נפרדת"), ואין עמודת תפוגה שנייה להשוות אליה.
--   • where pending_expires_at is not null — לא נוגעים בשורות שכבר null
--     (כולל idempotency: הרצה חוזרת של החלק הזה לא כותבת דבר בפעם השנייה).
-- ============================================================================

update public.appointments
set pending_expires_at = null
where status = 'pending'
  and pending_expires_at is not null;


-- ============================================================================
-- חלק 8 — אימות
-- ============================================================================
do $$
declare
  v_sig text;
begin
  -- ── כל שבע הפונקציות קיימות ────────────────────────────────────────────
  foreach v_sig in array array[
    'expire_stale_pending_appointments',
    'create_public_booking_request',
    'create_personal_area_booking_request',
    'create_reschedule_request',
    'approve_pending_appointment',
    'reject_pending_appointment',
    'approve_reschedule_request',
    'reject_reschedule_request'
  ]
  loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_sig
    ) then
      raise exception '0030: % נעלמה' , v_sig using errcode = 'P0103';
    end if;
  end loop;

  -- ── הטאטוא רצה בלי שגיאה (התנהגות בפועל נבדקת ב-scripts/test-approval-core.mjs) ──
  perform public.expire_stale_pending_appointments();

  -- ── נורמליזציה (חלק 7): אין יותר שורת pending עם pending_expires_at לא-null ──
  if exists (
    select 1 from public.appointments
    where status = 'pending' and pending_expires_at is not null
  ) then
    raise exception '0030: נשארה שורת pending עם pending_expires_at לא-null אחרי הנורמליזציה'
      using errcode = 'P0103';
  end if;

  -- ── ההרשאות בפועל, לא רק ה-REVOKE/GRANT שלמעלה ─────────────────────────
  foreach v_sig in array array[
    'public.expire_stale_pending_appointments()',
    'public.create_public_booking_request(text, text, text, text[], integer, timestamptz, integer, text, text, timestamptz, inet, integer)',
    'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz)',
    'public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz)',
    'public.approve_pending_appointment(uuid, uuid)',
    'public.reject_pending_appointment(uuid, uuid)',
    'public.approve_reschedule_request(uuid, uuid)',
    'public.reject_reschedule_request(uuid, uuid)'
  ]
  loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0030: anon יכול להפעיל את %', v_sig;
    end if;
    if has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0030: authenticated יכול להפעיל את %', v_sig;
    end if;
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception '0030: service_role איבד את %', v_sig;
    end if;
  end loop;

  -- 🔒 שבע הפונקציות (מלבד cancel_pending_appointment, שלא נגענו בה)
  -- חייבות להישאר SECURITY INVOKER.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'expire_stale_pending_appointments', 'create_public_booking_request',
        'create_personal_area_booking_request', 'create_reschedule_request',
        'approve_pending_appointment', 'reject_pending_appointment',
        'approve_reschedule_request', 'reject_reschedule_request'
      )
      and p.prosecdef
  ) then
    raise exception '0030: פונקציה הוגדרה כ-SECURITY DEFINER' using errcode = 'P0103';
  end if;
end;
$$;
