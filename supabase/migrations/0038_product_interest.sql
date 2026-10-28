-- ============================================================================
-- 0038 — הרשמה לעדכון על השקת מוצר (Product Interest)
--
-- ═══ מה זה כן ═══
--
-- שתי טבלאות ופונקציה אחת שכותבת אליהן. הרשמה היא **בקשה לקבל הודעה אחת
-- כשמוצר מסוים עולה לאתר** — לא הזמנה, לא רכישה, ולא הסכמה לדיוור.
--
-- ═══ 🔒 מה זה **אינו** עושה — וזה העיקר ═══
--
--   ❌ **אינו יוצר לקוחה.** זו ההחלטה המרכזית של המיגרציה הזו. הטופס אוסף
--      טלפון בלבד ללא שם, ו-`customers.full_name` הוא `not null` עם CHECK
--      על אורך 2–80 (0001). `link_or_create_customer_by_phone` (0018) לא
--      נקראת כאן **בכלל**, ואסור לקרוא לה ממסלול הזה: שם ממלא מקום
--      ("לקוחה מהאתר", "לא ידוע") היה מזהם את ה-CRM בכרטיסים שאינם לקוחות,
--      ושובר את ההנחה שכל שורה ב-customers היא אדם שהזדהה בשמו.
--      לכן הטלפון נשמר **כאן**, על השורה, ולא דרך customers.
--   ❌ **אינו נוגע ב-`customers`.** אין עמודה חדשה ואין שינוי.
--   ❌ **אינו נוגע ב-`marketing_consent` / `marketing_opted_out_at`** ובאף
--      עמודת דיוור (0035). הרשמה לעדכון על מוצר אינה הסכמה לדיוור שוטף,
--      וחלק 6 מאמת זאת בפועל.
--   ❌ **אינו נוגע ב-`appointments`**, בתזכורות, בהתראות וביומן. אין לטבלאות
--      כאן ולו טריגר אחד, וחלק 6 מאמת גם את זה.
--   ❌ **אינו נוגע ב-`waitlist_requests`** (0037). רשימת ההמתנה היא לתורים,
--      והטבלה שלה נעולה על service_key ו-duration_min של טיפולים.
--   ❌ **אינו משתמש ב-`booking_rate_events`.** הטבלה ההיא נושאת בשמה
--      ובתיעודה סמנטיקה של הזמנות ("ספירת יצירות הזמנה ציבוריות לפי IP"),
--      ומונה משותף היה אומר שהרשמה למוצר שורפת מהמכסה של קביעת תור —
--      ולהפך. יש כאן מונה נפרד ומוגבל לעצמו.
--   ❌ אינו נוגע ב-0001–0037.
-- ============================================================================


-- ============================================================================
-- חלק 1 — מונה קצב נפרד
--
-- ⚠️ עותק מבני של booking_rate_events (0017), ובכוונה **לא** שימוש חוזר בה:
-- שתי מערכות שונות עם שתי מכסות שונות. אין כאן שום מזהה לקוחה — IP וזמן
-- בלבד — והניקוי אופורטוניסטי בתוך הפונקציה, כי אין Cron בפרויקט.
-- ============================================================================

create table if not exists public.product_interest_rate_events (
  id         bigserial primary key,
  ip         inet not null,
  created_at timestamptz not null default now()
);

comment on table public.product_interest_rate_events is
  'ספירת הרשמות לעדכון מוצר לפי IP, למגבלת קצב בלבד. אין כאן מזהה לקוחה ואין טלפון. נפרדת מ-booking_rate_events במכוון: מכסת ההזמנות ומכסת ההרשמות אינן משותפות. ניקוי אופורטוניסטי, ללא Cron.';

create index if not exists product_interest_rate_events_ip_created_idx
  on public.product_interest_rate_events (ip, created_at desc);

create index if not exists product_interest_rate_events_created_idx
  on public.product_interest_rate_events (created_at);

alter table public.product_interest_rate_events enable row level security;

revoke all on public.product_interest_rate_events from anon, authenticated;
grant select, insert, delete on public.product_interest_rate_events to service_role;
grant usage, select on sequence public.product_interest_rate_events_id_seq to service_role;


-- ============================================================================
-- חלק 2 — הטבלה
-- ============================================================================

create table if not exists public.product_interest_requests (
  id           uuid primary key default gen_random_uuid(),

  -- ה-slug של המוצר כפי שהוא ב-lib/data.ts. 🔒 נגזר בשרת מול רשימה סגורה
  -- (lib/products.ts) ולעולם אינו מתקבל כפי שהוא מהדפדפן.
  product_slug text not null check (length(trim(product_slug)) between 1 and 80),

  /*
   * 🔒 **הטלפון חי כאן, ולא ב-customers.** ראה ההסבר בראש הקובץ: אין שם,
   * ולכן אי אפשר ליצור כרטיס לקוחה אמיתי. ה-CHECK זהה לזה של
   * customers.phone_e164 (0001) — אותו פורמט E.164 בדיוק, כך ששתי
   * הטבלאות לעולם לא יחזיקו את אותו מספר בשני כתיבים.
   */
  phone_e164   text not null check (phone_e164 ~ '^\+9725[0-9]{8}$'),

  -- גוון מועדף, רשות. 🔒 מאומת בשרת מול רשימת הגוונים של אותו מוצר.
  shade        text check (shade is null or length(trim(shade)) between 1 and 60),

  -- מהיכן הגיעה ההרשמה (עמוד המוצר, קמפיין וכו').
  source       text not null check (length(trim(source)) between 1 and 40),

  -- ⚠️ 'notified' = ההודעה החד-פעמית על ההשקה נשלחה. 'closed' = הבקשה
  -- נסגרה בלי לשלוח. **פעילה = open בלבד**: אחרי שנשלחה ההודעה אין סיבה
  -- לחסום הרשמה חדשה בעתיד (למשל לגרסה הבאה של המוצר).
  status       text not null default 'open'
               check (status in ('open', 'notified', 'closed')),

  -- 🔒 הודעת הפרטיות — אותה דרישה בדיוק כמו 0031/0037. זמן השרת, לא מה
  -- שהדפדפן שלח.
  privacy_notice_version      text        not null check (length(trim(privacy_notice_version)) > 0),
  privacy_acknowledged_at     timestamptz not null default now(),

  /*
   * ⚠️ nullable, ו**אינו נכתב במסלול ההרשמה**. קיים כדי שאפשר יהיה לקשר
   * ידנית לכרטיס קיים בעתיד, אם וכאשר תוחלט דרך לזהות לקוחה לפי טלפון
   * בלי ליצור כרטיס חדש. 🔴 אסור שהוא יהפוך לתירוץ ליצירת לקוחה: כתיבה
   * אליו מותרת רק עבור כרטיס שכבר קיים.
   */
  customer_id  uuid references public.customers(id) on delete set null,

  -- מתי נשלחה ההודעה בפועל. nullable עד שזה קורה.
  notified_at  timestamptz,

  /*
   * מתי השורה נסגרה.
   *
   * 🔒 **קיים כדי ש-retention יוכל להישען על חותמת סמנטית.** `updated_at`
   * אינו מתאר סגירה — הוא זז בכל שינוי, כולל כאלה שאינם קשורים (סימון
   * הודעה, תיקון עתידי). מחיקה 90 יום אחרי `updated_at` הייתה מוחקת
   * שורות לפי אירוע שאינו הסגירה, ומאריכה או מקצרת את התקופה באקראי.
   */
  closed_at    timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  /*
   * עקביות בין הסטטוס לשתי החותמות.
   *
   * ⚠️ הניסוח `(status='notified') = (notified_at is not null)` נראה נכון
   * והוא שגוי: הוא הופך **סגירה של שורה שכבר נשלחה אליה הודעה** לבלתי
   * אפשרית, כי `closed` עם `notified_at` מלא מפר אותו. כלומר אי אפשר
   * לארכב הרשמה שטופלה — בדיוק הפעולה הכי שגרתית.
   *
   * שלושת הכללים, ובהם **כל שורה נושאת בדיוק את החותמות שמתארות אותה**:
   *
   *   open     → notified_at ריק **וגם** closed_at ריק. שורה שממתינה
   *              אינה יכולה לטעון שנשלחה אליה הודעה או שנסגרה.
   *   notified → notified_at מלא **וגם** closed_at ריק. היא עדיין פעילה.
   *   closed   → closed_at מלא. notified_at יכול להיות מלא (נסגרה אחרי
   *              שליחה — החותמת נשמרת כתיעוד) או ריק (נסגרה ידנית לפני
   *              שנשלח דבר).
   *
   * 🔒 ה-CHECK הזה הוא גם מה שמבטיח ש-retention לא ימחק שורה לפי חותמת
   * שאינה קיימת: כל קטגוריה ב-0040 נשענת על חותמת שה-CHECK מחייב שתהיה.
   */
  constraint product_interest_notified_pair
    check (
      (status = 'open'     and notified_at is null     and closed_at is null)
      or (status = 'notified' and notified_at is not null and closed_at is null)
      or (status = 'closed'   and closed_at is not null)
    )
);

comment on table public.product_interest_requests is
  'הרשמות לעדכון על השקת מוצר. אינן הזמנות, אינן רכישות ואינן הסכמה לדיוור שיווקי. מחזיקות את הטלפון ישירות ואינן יוצרות כרטיס לקוחה — ראה 0038.';
comment on column public.product_interest_requests.phone_e164 is
  'הטלפון נשמר כאן ולא ב-customers: הטופס אוסף טלפון ללא שם, ו-customers.full_name הוא not null. אין ליצור כרטיס לקוחה עם שם ממלא מקום.';
comment on column public.product_interest_requests.customer_id is
  'nullable ואינו נכתב בהרשמה. לקישור ידני לכרטיס קיים בלבד — לעולם לא ליצירת כרטיס חדש.';
comment on column public.product_interest_requests.closed_at is
  'מתי השורה נסגרה. נקודת הייחוס ל-retention של closed (0040) — ובמכוון לא updated_at, שזז בכל שינוי ואינו מתאר את הסגירה.';

/*
 * 🔒 **מניעת כפילות פעילה** — אותה לקוחה לא מנפחת את ספירת הביקוש בלחיצה
 * חוזרת. partial, ולא constraint מלא: רק 'open' חוסם. אחרי שההודעה נשלחה
 * ('notified') או שהבקשה נסגרה ('closed') אפשר להירשם שוב בעתיד.
 *
 * 🔴 הפרדיקט כאן חייב להישאר זהה מילה במילה ל-`on conflict … where` בחלק 4,
 * אחרת Postgres לא יסיק את האינדקס והיצירה תיכשל.
 */
create unique index if not exists product_interest_open_unique
  on public.product_interest_requests (phone_e164, product_slug)
  where status = 'open';

-- המסך של שובל: ההרשמות הפעילות לכל מוצר, החדשות ראשונות.
create index if not exists product_interest_product_idx
  on public.product_interest_requests (product_slug, created_at desc);

-- מגבלת הקצב לפי טלפון.
create index if not exists product_interest_phone_idx
  on public.product_interest_requests (phone_e164, created_at desc);


-- ============================================================================
-- חלק 3 — RLS והרשאות
--
-- אותה דוקטרינה כמו 0017/0035/0037: RLS דלוק, **אפס policies**, גישה
-- ל-service_role בלבד.
--
-- ⚠️ כמו ב-0037: ה-GRANT אינו יכול למנוע DELETE מ-service_role, כי
-- לפרויקט יש `alter default privileges … grant all … to service_role`
-- ברמת הסכימה. ה-grant המפורש מתעד את מה שהאפליקציה משתמשת בו; הוא אינו
-- שער. 🔒 מה שה-revoke **כן** משיג ונבדק בחלק 5: ל-anon ול-authenticated
-- אין **שום** הרשאה על הטבלאות האלה.
-- ============================================================================

alter table public.product_interest_requests enable row level security;

revoke all on public.product_interest_requests from anon, authenticated;
grant select, insert, update on public.product_interest_requests to service_role;


-- ============================================================================
-- חלק 4 — יצירת הרשמה
--
-- ═══ שתי מגבלות קצב ═══
--
--   1. **IP** — product_interest_rate_events, מונה נפרד משלו.
--   2. **טלפון** — עד 5 הרשמות בשעה לאותו מספר, לכל המוצרים יחד.
--
-- ═══ 🔒 idempotent ═══
--
-- הרשמה חוזרת של אותו טלפון לאותו מוצר **אינה שגיאה**: היא מחזירה את
-- השורה הקיימת עם `already := true`. אין 500, אין 23505, ואין שורה שנייה.
-- ============================================================================

create or replace function public.create_product_interest(
  p_product_slug            text,
  p_phone_e164              text,
  p_shade                   text,
  p_source                  text,
  p_ip                      inet,
  p_max_per_ip_per_hour     integer,
  p_privacy_notice_version  text,
  p_privacy_acknowledged    boolean
) returns table (id uuid, already boolean)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  -- 🔒 תקרה קשיחה. הפרמטר יכול רק להדק, לעולם לא להרחיב.
  c_ip_max     constant integer := least(coalesce(p_max_per_ip_per_hour, 10), 10);
  c_phone_max  constant integer := 5;

  v_ip_count    integer;
  v_phone_count integer;
  v_existing    public.product_interest_requests;
  v_row         public.product_interest_requests;
begin
  -- ── ולידציה ────────────────────────────────────────────────────────────
  if p_ip is null then
    raise exception 'MISSING_IP' using errcode = '22023';
  end if;
  if p_product_slug is null or length(trim(p_product_slug)) = 0 then
    raise exception 'BAD_PRODUCT' using errcode = '22023';
  end if;
  if p_phone_e164 is null or p_phone_e164 !~ '^\+9725[0-9]{8}$' then
    raise exception 'BAD_PHONE' using errcode = '22023';
  end if;
  if p_source is null or length(trim(p_source)) = 0 then
    raise exception 'BAD_SOURCE' using errcode = '22023';
  end if;

  -- 🔒 הודעת הפרטיות — אותה בדיקה כמו 0031/0037, ולפני כל כתיבה.
  if p_privacy_acknowledged is not true
     or p_privacy_notice_version is null
     or length(trim(p_privacy_notice_version)) = 0 then
    raise exception 'PRIVACY_NOT_ACKNOWLEDGED' using errcode = 'P0400';
  end if;

  /*
   * ── 🔒 נעילות ──
   * namespace 6 ל-IP ו-7 לטלפון — **לא** 4/5, שתפוסים ע"י מסלול ההזמנות
   * ורשימת ההמתנה (0018/0037). namespace נפרד מבטיח שהרשמה למוצר אינה
   * יכולה להיתקע מאחורי נעילת הזמנה, ולהפך.
   */
  perform pg_advisory_xact_lock(6, hashtext(host(p_ip)));

  -- ניקוי אופורטוניסטי, כמו 0018/0037.
  delete from public.product_interest_rate_events
  where created_at < now() - interval '2 hours';

  -- ── מגבלה 1: IP ────────────────────────────────────────────────────────
  select count(*)::integer into v_ip_count
  from public.product_interest_rate_events
  where ip = p_ip and created_at > now() - interval '1 hour';

  if v_ip_count >= c_ip_max then
    raise exception 'RATE_LIMITED' using errcode = 'P0012';
  end if;

  perform pg_advisory_xact_lock(7, hashtext(p_phone_e164));

  /*
   * ── 🔒 idempotency ──
   * נבדק **לפני** מגבלת הטלפון, ובכוונה: לקוחה שלוחצת פעמיים על אותו
   * מוצר אינה אמורה להיחסם כאילו הציפה את המערכת. היא מקבלת את אותה
   * שורה בחזרה, ואינה נספרת שוב.
   */
  select * into v_existing
  from public.product_interest_requests
  where phone_e164 = p_phone_e164
    and product_slug = p_product_slug
    and status = 'open'
  limit 1;

  if v_existing.id is not null then
    return query select v_existing.id, true;
    return;
  end if;

  -- ── מגבלה 2: טלפון ─────────────────────────────────────────────────────
  select count(*)::integer into v_phone_count
  from public.product_interest_requests
  where phone_e164 = p_phone_e164
    and created_at > now() - interval '1 hour';

  if v_phone_count >= c_phone_max then
    raise exception 'PHONE_LIMIT' using errcode = 'P0402';
  end if;

  -- ── היצירה ─────────────────────────────────────────────────────────────
  -- ⚠️ `on conflict do nothing` + בדיקה מחדש: מרוץ בין שתי בקשות במקביל
  -- מסתיים ב"את כבר ברשימה" ולא ב-23505. הפרדיקט זהה לאינדקס (חלק 2).
  --
  -- 🔒 customer_id אינו נכתב כאן. ראה ההערה על העמודה.
  insert into public.product_interest_requests (
    product_slug, phone_e164, shade, source,
    privacy_notice_version, privacy_acknowledged_at
  )
  values (
    p_product_slug, p_phone_e164, nullif(trim(coalesce(p_shade, '')), ''), p_source,
    p_privacy_notice_version, now()
  )
  on conflict (phone_e164, product_slug) where status = 'open'
  do nothing
  returning * into v_row;

  if v_row.id is null then
    -- המרוץ נסגר בינתיים ע"י בקשה מקבילה — מחזירים את שלה.
    select * into v_existing
    from public.product_interest_requests
    where phone_e164 = p_phone_e164
      and product_slug = p_product_slug
      and status = 'open'
    limit 1;

    if v_existing.id is null then
      raise exception 'INSERT_FAILED' using errcode = 'P0500';
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  -- ⚠️ נרשם **רק בהצלחה**: בקשה שנדחתה אינה אוכלת מהמכסה, והרשמה כפולה
  -- אינה נספרת כלל (היא חוזרת למעלה).
  insert into public.product_interest_rate_events (ip) values (p_ip);

  return query select v_row.id, false;
end;
$$;

-- 🔒 תבנית 0007: PUBLIC אינו יכול להריץ. service_role בלבד.
revoke execute on function public.create_product_interest(
  text, text, text, text, inet, integer, text, boolean
) from public, anon, authenticated;

grant execute on function public.create_product_interest(
  text, text, text, text, inet, integer, text, boolean
) to service_role;


-- ============================================================================
-- חלק 5 — 🔒 אימות ההרשאות (דוקטרינת 0007/0032/0037)
--
-- נבדק בפועל מול המסד, ולא רק "נכתב REVOKE".
-- ============================================================================

do $$
declare
  v_sig text := 'public.create_product_interest(text, text, text, text, inet, integer, text, boolean)';
  v_tables text[] := array['product_interest_requests', 'product_interest_rate_events'];
  v_t text;
  v_priv text;
begin
  if has_function_privilege('anon', v_sig, 'EXECUTE') then
    raise exception 'הרשאות RPC (0038): ל-anon עדיין יש EXECUTE על %.', v_sig using errcode = 'P0100';
  end if;
  if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
    raise exception 'הרשאות RPC (0038): ל-authenticated עדיין יש EXECUTE על %.', v_sig using errcode = 'P0100';
  end if;
  if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
    raise exception 'הרשאות RPC (0038): ל-service_role חסר EXECUTE על %.', v_sig using errcode = 'P0101';
  end if;

  -- 🔒 anon/authenticated — אפס הרשאות על שתי הטבלאות.
  foreach v_t in array v_tables loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('anon', 'public.' || v_t, v_priv) then
        raise exception 'הרשאות (0038): ל-anon יש % על %.', v_priv, v_t using errcode = 'P0100';
      end if;
      if has_table_privilege('authenticated', 'public.' || v_t, v_priv) then
        raise exception 'הרשאות (0038): ל-authenticated יש % על %.', v_priv, v_t using errcode = 'P0100';
      end if;
    end loop;
  end loop;

  raise notice '0038: הרשאות אומתו: anon=0, authenticated=0, service_role=EXECUTE.';
end $$;


-- ============================================================================
-- חלק 6 — אימות ההנחות
--
-- נכשל בקול אם משהו מההנחות אינו מתקיים — ובראשן שהמסלול הזה אינו נוגע
-- בלקוחות, בדיוור, בתורים, בתזכורות וביומן.
-- ============================================================================

do $$
declare
  v_triggers integer;
  v_rls      boolean;
begin
  -- 🔴 טריגר על הטבלאות האלה = דרך שקטה להשפיע על מערכות אחרות.
  select count(*) into v_triggers
  from pg_trigger
  where tgrelid in (
      'public.product_interest_requests'::regclass,
      'public.product_interest_rate_events'::regclass)
    and not tgisinternal;
  if v_triggers > 0 then
    raise exception '0038: נמצאו % טריגרים. הטבלאות חייבות להיות פסיביות לחלוטין.', v_triggers;
  end if;

  select relrowsecurity into v_rls
  from pg_class where oid = 'public.product_interest_requests'::regclass;
  if not v_rls then
    raise exception '0038: RLS כבוי על product_interest_requests';
  end if;

  select relrowsecurity into v_rls
  from pg_class where oid = 'public.product_interest_rate_events'::regclass;
  if not v_rls then
    raise exception '0038: RLS כבוי על product_interest_rate_events';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('product_interest_requests', 'product_interest_rate_events')
  ) then
    raise exception '0038: נמצאו policies. הטבלאות נועדו ל-service_role בלבד.';
  end if;

  -- 🔒 customers לא שונתה.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers'
      and column_name like 'product_interest%'
  ) then
    raise exception '0038: customers שונתה. המיגרציה הזו אינה אמורה לגעת בה.';
  end if;

  -- 🔒 הפונקציה אינה קוראת ל-link_or_create_customer_by_phone. זו ההנחה
  -- המרכזית של המיגרציה, ולכן היא נבדקת בקוד ולא רק מתועדת.
  if exists (
    select 1 from pg_proc
    where proname = 'create_product_interest'
      and prosrc like '%link_or_create_customer_by_phone%'
  ) then
    raise exception '0038: create_product_interest קוראת ל-link_or_create_customer_by_phone. מסלול ההרשמה אינו יוצר לקוחה.';
  end if;

  -- 🔒 ואינה נוגעת בעמודות הדיוור.
  if exists (
    select 1 from pg_proc
    where proname = 'create_product_interest'
      and (prosrc like '%marketing_consent%' or prosrc like '%marketing_opted_out_at%')
  ) then
    raise exception '0038: create_product_interest נוגעת בעמודות דיוור. הרשמה לעדכון אינה הסכמה לדיוור.';
  end if;

  raise notice '0038: product_interest נוצרה, פסיבית, ואינה יוצרת לקוחה או נוגעת בדיוור.';
end $$;
