-- ============================================================================
-- 0028 — שלב 15H: ניהול כרטיס הלקוחה (עריכה · ארכיון · מחיקה בטוחה)
--
-- ═══ 🔒 מה המיגרציה הזו קובעת ═══
--
-- ⚠️ **היסטוריה עסקית לא נמחקת. נקודה.** לקוחה שיש לה ולו תור אחד — בכל
-- סטטוס, מכל שנה — אינה ניתנת למחיקה. הכלי עבורה הוא **ארכיון**: היא
-- יוצאת מהרשימה היומיומית, וכל התורים, ההיסטוריה, ההערות והמדדים נשארים
-- במקומם בדיוק.
--
-- מחיקה אמיתית שמורה למקרה אחד ויחיד: שורה שנוצרה בטעות ומעולם לא נקשר
-- אליה שום תור. שם אין מה לשמר.
--
-- 🔒 שכבת ההגנה האמיתית אינה בפונקציה למטה אלא בסכימה עצמה:
-- `appointments.customer_id ... on delete restrict` (0001:81). גם אם מישהו
-- יקרא ל-DELETE ישירות, Postgres יחסום. `delete_customer_if_safe` רק
-- הופכת את החסימה הזו להודעה שאפשר להבין.
--
-- ─── ארכיון: עמודות נפרדות ולא ערך ב-crm_status ─────────────────────────────
--
-- `crm_status` הוא **מדד שיווקי** (פעילה / לא פעילה) שהפילטרים, המיון
-- ופעילות ה-CRM כולם נשענים עליו. דחיפת 'archived' לתוכו הייתה מערבבת שתי
-- שאלות שונות לגמרי — "האם היא לקוחה פעילה?" מול "האם הכרטיס הזה בכלל
-- רלוונטי?" — ושוברת כל דוח קיים.
--
-- ─── מה שהמיגרציה הזו אינה עושה ────────────────────────────────────────────
--
-- 🔒 **אינה נוגעת ב-auth.users.** מחיקת כרטיס לקוחה אינה מוחקת חשבון
-- התחברות. אם היא תתחבר שוב עם אותו טלפון — ייווצר לה כרטיס חדש ונקי, וזו
-- ההתנהגות הנכונה: לא מחקנו משתמש, מחקנו רשומת CRM ריקה.
--
-- 🔒 **אינה מאפשרת שינוי טלפון ללקוחה עם חשבון התחברות.** ראה ההסבר המלא
-- מעל update_customer_details — זה הסעיף המסוכן ביותר בקובץ.
-- ============================================================================


-- ============================================================================
-- חלק 1 — עמודות הארכיון
-- ============================================================================

alter table public.customers
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id);

-- שני השדות תמיד יחד: "מי" בלי "מתי" (או להפך) הוא רשומת ביקורת חסרת ערך.
-- אותו דפוס בדיוק כמו customer_notes.archived_at/archived_by_admin_id (0009).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname  = 'customers_archived_pair'
  ) then
    alter table public.customers
      add constraint customers_archived_pair
      check ((archived_at is null) = (archived_by is null));
  end if;
end $$;

comment on column public.customers.archived_at is
  'לא NULL ⟹ הכרטיס בארכיון: אינו מופיע ברשימה הרגילה. התורים, ההיסטוריה וההערות נשארים כפי שהם.';
comment on column public.customers.archived_by is
  'ה-auth user של המנהלת שארכבה. נשמר יחד עם archived_at ולעולם לא לבדו.';

-- הרשימה היומיומית מבקשת תמיד את הלא-מאורכבות. אינדקס חלקי הוא בדיוק
-- הכלי לכך, והוא קטן ככל שהארכיון גדל.
create index if not exists customers_not_archived_idx
  on public.customers (created_at desc)
  where archived_at is null;


-- ============================================================================
-- חלק 2 — פעילות CRM לומדת שלוש פעולות חדשות
--
-- ⚠️ ה-CHECK ב-0009 הוא רשימה סגורה, ולכן insert עם action חדש היה נכשל.
--
-- ⚠️ **בלי `if exists` ובלי ניחוש שם** — אותו לקח מ-0010:86. השם
-- `customer_crm_activity_action_check` הוא רק ברירת המחדל של Postgres,
-- ואם הוא שונה אי פעם, DROP על שם מנוחש היה נכשל בשקט או מפיל את הקובץ.
-- מאתרים את ה-CHECK האמיתי לפי **תוכנו**.
--
-- 🔒 'name_updated' ו-'phone_updated' הן שתי פעולות נפרדות ולא אחת, כי
-- הן נרשמות אחרת לגמרי: לשינוי שם נשמרים הערכים, ולשינוי טלפון **לעולם
-- לא** — ראה ההערה על old_value ב-0009:208, "לעולם לא מספר טלפון".
-- ============================================================================

do $$
declare
  v_names text[];
begin
  select array_agg(conname) into v_names
  from pg_constraint
  where conrelid = 'public.customer_crm_activity'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%crm_status_changed%';

  if v_names is null or array_length(v_names, 1) <> 1 then
    raise exception
      '0028: לא נמצא בדיוק CHECK אחד על customer_crm_activity.action (נמצאו %). יש לבדוק ידנית.',
      coalesce(array_length(v_names, 1), 0)
      using errcode = 'P0103';
  end if;

  execute format('alter table public.customer_crm_activity drop constraint %I', v_names[1]);

  alter table public.customer_crm_activity
    add constraint customer_crm_activity_action_check
    check (action in (
      'crm_status_changed',
      'source_changed',
      'note_created',
      'note_updated',
      'note_archived',
      -- ⚠️ **נוסף ב-0010 ולא ב-0009.** השמטתו כאן הייתה שוברת את
      -- create_manual_customer בשקט — כל יצירת לקוחה ידנית הייתה נכשלת על
      -- ה-CHECK. הרשימה למטה חייבת להיות **איחוד** של כל הערכים הקיימים
      -- ולא רק אלה שמופיעים ב-0009.
      'customer_created',
      -- ── 15H ──
      'name_updated',
      'phone_updated',
      'archived',
      'unarchived'
    ));
end $$;


-- ============================================================================
-- חלק 3 — עריכת פרטי הלקוחה
--
-- ═══ 🔴 למה שינוי טלפון חסום ללקוחה עם חשבון התחברות ═══
--
-- הטלפון אינו "עוד שדה בכרטיס" — הוא **הזיהוי הראשי** של הלקוחה, וגם
-- המפתח של חשבון ההתחברות ב-auth.users. שינוי `customers.phone_e164` לבדו
-- אינו משנה את הטלפון ב-auth, ולכן הוא **שובר את ההתחברות לשני הכיוונים**:
--
--   כניסה עם המספר החדש  ⟶ אין auth user כזה ⟹ נוצר חדש ⟹
--                           link_or_create_customer_for_auth מוצאת לקוחה
--                           עם הטלפון הזה שכבר מקושרת ל-auth אחר ⟹
--                           PHONE_LINKED_TO_OTHER_AUTH. חסום.
--   כניסה עם המספר הישן   ⟶ ה-auth user קיים ומקושר, אבל הטלפון בכרטיס
--                           שונה ⟹ AUTH_CUSTOMER_CONFLICT. חסום.
--
-- כלומר הלקוחה מאבדת גישה לאזור האישי שלה לחלוטין, בלי שאיש ידע — ובלי
-- מסלול תיקון אוטומטי (0010:366 קובע מפורשות שאין merge ואין החלפת
-- ownership).
--
-- לכן: **שם — תמיד ניתן לעריכה. טלפון — רק ללקוחה שאין לה חשבון**, כלומר
-- לקוחה שנוצרה ידנית ב-CRM ומעולם לא התחברה. שם תיקון טעות הקלדה בטלפון
-- הוא פעולה בטוחה לגמרי.
--
-- ⚠️ תיקון טלפון ללקוחה עם חשבון הוא תהליך ידני שדורש גם שינוי ב-auth,
-- ואינו חלק מ-15H.
-- ============================================================================

create or replace function public.update_customer_details(
  p_customer_id   uuid,
  p_admin_user_id uuid,
  p_full_name     text default null,
  p_phone_e164    text default null
) returns jsonb
language plpgsql
as $$
declare
  v_row       public.customers;
  v_name      text := nullif(regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '');
  v_phone     text := nullif(trim(coalesce(p_phone_e164, '')), '');
  v_old_name  text;
  v_old_phone text;
  v_changed   text[] := '{}';
begin
  if p_admin_user_id is null
     or not exists (select 1 from public.admins where user_id = p_admin_user_id) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  select * into v_row from public.customers where id = p_customer_id for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 🔒 חשבון ניהול אינו כרטיס לקוחה. אותה החרגה של list_crm_customers,
  -- כאן כדי שלא ניתן יהיה לערוך את הכרטיס של שובל דרך מסך הלקוחות.
  if v_row.auth_user_id is not null
     and exists (select 1 from public.admins ad where ad.user_id = v_row.auth_user_id) then
    raise exception 'NOT_A_CUSTOMER' using errcode = '42501';
  end if;

  v_old_name  := v_row.full_name;
  v_old_phone := v_row.phone_e164;

  -- ── שם ─────────────────────────────────────────────────────────────────
  if v_name is not null and v_name is distinct from v_old_name then
    if length(v_name) < 2 or length(v_name) > 80 then
      raise exception 'BAD_NAME' using errcode = '22023';
    end if;
    update public.customers set full_name = v_name where id = p_customer_id;
    -- ⚠️ הטיפוס מפורש: `text[] || 'name'` בלי cast מפרש את המחרוזת כ-array
    -- literal ונכשל ב-"malformed array literal".
    v_changed := v_changed || 'name'::text;
  end if;

  -- ── טלפון ──────────────────────────────────────────────────────────────
  if v_phone is not null and v_phone is distinct from v_old_phone then
    if v_row.auth_user_id is not null then
      raise exception 'HAS_LOGIN_ACCOUNT' using errcode = '42501';
    end if;
    if v_phone !~ '^\+9725[0-9]{8}$' then
      raise exception 'BAD_PHONE' using errcode = '22023';
    end if;

    -- ⚠️ ה-UNIQUE על phone_e164 (0001) הוא האכיפה. בדיקה מקדימה כאן קיימת
    -- רק כדי להחזיר שגיאה מובנת במקום unique_violation גולמית; המרוץ
    -- שביניהן נתפס ע"י ה-EXCEPTION למטה.
    if exists (select 1 from public.customers where phone_e164 = v_phone and id <> p_customer_id) then
      raise exception 'PHONE_TAKEN' using errcode = '23505';
    end if;

    begin
      update public.customers set phone_e164 = v_phone where id = p_customer_id;
    exception when unique_violation then
      raise exception 'PHONE_TAKEN' using errcode = '23505';
    end;

    v_changed := v_changed || 'phone'::text;
  end if;

  if array_length(v_changed, 1) is null then
    return jsonb_build_object('outcome', 'no_change', 'customer_id', p_customer_id);
  end if;

  -- ── תיעוד ──────────────────────────────────────────────────────────────
  -- ⚠️ שתי שורות נפרדות, ובכוונה: שינוי השם נרשם **עם** הערכים (מידע
  -- שמנהלת צריכה כדי להבין מה השתנה), ושינוי הטלפון נרשם **בלי** שום ערך.
  -- העמודות old_value/new_value מוגבלות ל-64 תווים ומתועדות מפורשות
  -- כ"לעולם לא מספר טלפון" (0009:208), וזו התחייבות שנשמרת כאן ככתבה.
  if 'name' = any(v_changed) then
    insert into public.customer_crm_activity (customer_id, action, actor_admin_id, old_value, new_value)
    values (p_customer_id, 'name_updated', p_admin_user_id, left(v_old_name, 64), left(v_name, 64));
  end if;

  if 'phone' = any(v_changed) then
    insert into public.customer_crm_activity (customer_id, action, actor_admin_id)
    values (p_customer_id, 'phone_updated', p_admin_user_id);
  end if;

  select * into v_row from public.customers where id = p_customer_id;

  return jsonb_build_object(
    'outcome',   'updated',
    'changed',   to_jsonb(v_changed),
    'full_name', v_row.full_name
  );
end;
$$;

comment on function public.update_customer_details(uuid, uuid, text, text) is
  '15H: עריכת שם/טלפון של לקוחה. שינוי טלפון חסום ללקוחה עם חשבון התחברות — הוא היה מנתק אותה מהאזור האישי. הטלפון לעולם אינו נכתב ליומן הפעילות.';


-- ============================================================================
-- חלק 4 — ארכיון
--
-- ⚠️ ארכוב **אינו** מבטל תורים ואינו נוגע בהם. לכן לקוחה עם תור פעיל
-- בעתיד (pending/confirmed) אינה ניתנת לארכוב: הכרטיס היה נעלם מהרשימה
-- בעוד התור ממשיך להתקיים ביומן ולחסום שעה, והתזכורות היו ממשיכות לצאת.
-- קודם מכריעים את התור, ורק אז מארכבים.
-- ============================================================================

create or replace function public.archive_customer(
  p_customer_id   uuid,
  p_admin_user_id uuid
) returns jsonb
language plpgsql
as $$
declare
  v_row    public.customers;
  v_active integer;
begin
  if p_admin_user_id is null
     or not exists (select 1 from public.admins where user_id = p_admin_user_id) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  select * into v_row from public.customers where id = p_customer_id for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.auth_user_id is not null
     and exists (select 1 from public.admins ad where ad.user_id = v_row.auth_user_id) then
    raise exception 'NOT_A_CUSTOMER' using errcode = '42501';
  end if;

  -- idempotent: ארכוב חוזר אינו משנה את חותמת הזמן ואינו כותב פעילות שנייה.
  if v_row.archived_at is not null then
    return jsonb_build_object('outcome', 'already_archived', 'archived_at', v_row.archived_at);
  end if;

  select count(*) into v_active
  from public.appointments
  where customer_id = p_customer_id
    and status in ('pending', 'confirmed')
    and starts_at > now();

  if v_active > 0 then
    return jsonb_build_object('outcome', 'blocked_active_appointments', 'active_count', v_active);
  end if;

  update public.customers
  set archived_at = now(), archived_by = p_admin_user_id
  where id = p_customer_id
  returning * into v_row;

  insert into public.customer_crm_activity (customer_id, action, actor_admin_id)
  values (p_customer_id, 'archived', p_admin_user_id);

  return jsonb_build_object('outcome', 'archived', 'archived_at', v_row.archived_at);
end;
$$;

create or replace function public.unarchive_customer(
  p_customer_id   uuid,
  p_admin_user_id uuid
) returns jsonb
language plpgsql
as $$
declare
  v_row public.customers;
begin
  if p_admin_user_id is null
     or not exists (select 1 from public.admins where user_id = p_admin_user_id) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  select * into v_row from public.customers where id = p_customer_id for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.archived_at is null then
    return jsonb_build_object('outcome', 'not_archived');
  end if;

  update public.customers
  set archived_at = null, archived_by = null
  where id = p_customer_id;

  insert into public.customer_crm_activity (customer_id, action, actor_admin_id)
  values (p_customer_id, 'unarchived', p_admin_user_id);

  return jsonb_build_object('outcome', 'unarchived');
end;
$$;

comment on function public.archive_customer(uuid, uuid) is
  '15H: הוצאת כרטיס לקוחה מהרשימה הפעילה. אינה מוחקת דבר, וחסומה כשיש תור פעיל בעתיד.';


-- ============================================================================
-- חלק 5 — מחיקה, רק כשהיא באמת בטוחה
--
-- ═══ מה בדיוק נמחק, ומה לא ═══
--
-- הפונקציה מוחקת אך ורק לקוחה שמקיימת **את שני התנאים**:
--   1. אין לה אף שורת appointments.
--   2. אין לה חשבון התחברות (auth_user_id is null).
--
-- מה שנמחק איתה ב-cascade: פרופיל ה-CRM, ההערות ויומן הפעילות שלה. כולם
-- מטא-דאטה של הכרטיס עצמו, ואין להם משמעות בלעדיו.
--
-- ═══ 🔴 תנאי 2 — למה חשבון התחברות חוסם מחיקה לחלוטין ═══
--
-- זהו התיקון החשוב ביותר בקובץ, ובלעדיו המחיקה משאירה **שלוש** שאריות:
--
--   1. **auth user יתום.** מחיקת שורת ה-customer אינה נוגעת ב-auth.users:
--      ה-FK הוא `on delete set null` (0010:138) ובכיוון ההפוך בלבד. נשארת
--      זהות התחברות מלאה שאינה מצביעה על אף לקוחה.
--
--   2. **sessions חיים.** `app_sessions.auth_user_id` מצביע ל-auth.users
--      עם `on delete cascade` (0015:66) — כלומר ה-sessions קשורים לחשבון
--      ההתחברות ו**לא** ללקוחה. מחיקת הלקוחה אינה מוחקת אותם: ה-cookie
--      נשאר חתום ותקף, ו-getCurrentCustomerId מחזירה null בכל בקשה. מבחינת
--      הלקוחה — היא "מחוברת" ומועפת החוצה שוב ושוב בלי הסבר.
--
--   3. **לקוחה חדשה בשקט.** בהתחברות הבאה findAuthUserIdByPhone מוצאת את
--      ה-auth user היתום, ו-link_or_create_customer_for_auth (מצב 6) יוצרת
--      לה כרטיס **חדש לגמרי** בשם 'לקוחה'. אותה אישה, אותו מספר, כרטיס
--      אחר — בלי שאיש ידע שקרתה כאן מחיקה.
--
-- ⚠️ **ולמה לא פשוט למחוק גם את ה-auth user?** מפני שאי אפשר לעשות זאת
-- אטומית. auth.users שייכת ל-GoTrue, ומחיקה תקינה שלה עוברת ב-Auth Admin
-- API — מערכת אחרת, שאינה חולקת טרנזקציה עם ה-DB. כל סדר נכשל אחרת:
--
--   קודם הלקוחה, אחר כך ה-auth  ⟶ כשל בשלב השני = **בדיוק ה-orphan**
--                                   שאסור להשאיר, ואין מי שיתקן.
--   קודם ה-auth, אחר כך הלקוחה  ⟶ כשל בשלב השני = מחקנו זהות התחברות של
--                                   לקוחה שעדיין קיימת. הרסני יותר.
--
-- לכן הכלל: **חשבון התחברות ⟹ ארכיון, לעולם לא מחיקה.** ה-orphan אינו
-- "מנוקה" — הוא פשוט לא נוצר. זו בדיוק ההנחיה "או cleanup מלא ובטוח, או
-- archive אם אי אפשר אטומית".
--
-- ⚠️ הכיוון ההפוך של אותו orphan — auth user שקיים עם הטלפון של הלקוחה
-- אך **אינו מקושר** אליה (auth_user_id is null) — אינו נראה מכאן כלל:
-- auth.users אינה ניתנת לשאילתה אמינה לפי טלפון מתוך plpgsql (GoTrue שומר
-- אותו בלי '+'). הוא נחסם בשכבת ה-route דרך findAuthUserIdByPhone, לפני
-- הקריאה לכאן. ראה app/api/admin/customers/[id]/route.ts.
--
-- 🔒 ארבע שכבות, מהחזקה לחלשה:
--   1. `on delete restrict` על appointments.customer_id — אכיפת הסכימה.
--      עובדת גם מול DELETE ידני בעורך ה-SQL.
--   2. שני התנאים כאן, בתוך אותה טרנזקציה עם `FOR UPDATE` על השורה.
--   3. בדיקת ה-auth-by-phone ב-route (fail-closed).
--   4. הקלדת שם הלקוחה כאישור ב-UI.
--
-- ⚠️ המרוץ התיאורטי — תור שנוצר בין הספירה למחיקה — נתפס ע"י שכבה 1
-- ומתורגם ל-'blocked' במקום להתפוצץ כשגיאת FK.
-- ============================================================================

create or replace function public.delete_customer_if_safe(
  p_customer_id   uuid,
  p_admin_user_id uuid
) returns jsonb
language plpgsql
as $$
declare
  v_row   public.customers;
  v_appts integer;
begin
  if p_admin_user_id is null
     or not exists (select 1 from public.admins where user_id = p_admin_user_id) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  select * into v_row from public.customers where id = p_customer_id for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 🔒 חשבון ניהול אינו נמחק מכאן בשום מצב.
  if v_row.auth_user_id is not null
     and exists (select 1 from public.admins ad where ad.user_id = v_row.auth_user_id) then
    raise exception 'NOT_A_CUSTOMER' using errcode = '42501';
  end if;

  select count(*) into v_appts
  from public.appointments
  where customer_id = p_customer_id;

  if v_appts > 0 then
    return jsonb_build_object(
      'outcome',           'blocked_has_appointments',
      'appointment_count', v_appts
    );
  end if;

  /*
   * 🔴 חשבון התחברות — החסימה שאין לה עוקף.
   *
   * ⚠️ **אחרי** ספירת התורים בכוונה: ללקוחה עם היסטוריה, "יש לה תורים"
   * הוא הנימוק המדויק והמועיל יותר, וההמלצה (ארכיון) זהה בשני המקרים.
   *
   * ⚠️ אין כאן שום ניסיון לנקות את auth.users, ואסור שיהיה — ראה ההסבר
   * המלא בכותרת החלק. מחיקה חלקית גרועה בהרבה מאי-מחיקה.
   */
  if v_row.auth_user_id is not null then
    return jsonb_build_object('outcome', 'blocked_has_login_account');
  end if;

  begin
    delete from public.customers where id = p_customer_id;
  exception when foreign_key_violation then
    -- תור נוצר בדיוק בין הספירה למחיקה. שכבה 1 עצרה אותו.
    return jsonb_build_object('outcome', 'blocked_has_appointments', 'appointment_count', null);
  end;

  -- ⚠️ אין כאן שורת פעילות: יומן הפעילות של הלקוחה נמחק איתה ב-cascade,
  -- ואין טבלה שבה רשומה כזו הייתה שורדת. זה מקובל **רק** משום שמחיקה
  -- מותרת אך ורק על כרטיס נטול היסטוריה עסקית.
  return jsonb_build_object('outcome', 'deleted');
end;
$$;

comment on function public.delete_customer_if_safe(uuid, uuid) is
  '15H: מחיקת כרטיס לקוחה — אך ורק כשאין לה אף תור **ואין לה חשבון התחברות**. חשבון התחברות חוסם לצמיתות: מחיקתו אינה אטומית מול auth.users, והייתה משאירה auth יתום, sessions חיים וכרטיס חדש בהתחברות הבאה. הפתרון הוא ארכיון.';


-- ============================================================================
-- חלק 6 — הרשימה והכרטיס לומדים על הארכיון
--
-- ⚠️ שתי הפונקציות מוחלפות (create or replace) עם **אותה חתימה בדיוק**.
-- שתיהן מחזירות jsonb ולא `returns table`, ולכן הוספת שדה לתוצאה אינה
-- דורשת DROP — וזו בדיוק הסיבה שהמיגרציה הזו נשארת תוספתית.
--
-- שני שינויים בכל אחת, ותו לא:
--   1. `archived_at` נחשף בתוצאה.
--   2. ברשימה: לקוחה מאורכבת **מוסתרת כברירת מחדל**, ומופיעה רק תחת
--      הפילטר החדש 'archived'.
--
-- ⚠️ ההסתרה היא בדיוק מטרת הארכיון. בלעדיה הכרטיס היה ממשיך להופיע בכל
-- חיפוש ובכל ספירה, ו"ארכוב" היה מסתכם בתווית.
--
-- 🔒 הכרטיס הבודד (get_crm_customer) **אינו** מסתיר לקוחה מאורכבת: קישור
-- ישיר אליה חייב להמשיך לעבוד, אחרת אי אפשר יהיה להוציא אותה מהארכיון.
-- ============================================================================

create or replace function public.list_crm_customers(
  p_search       text        default null,
  p_filter       text        default 'all',
  p_source_key   text        default null,
  p_sort         text        default 'last_activity',
  p_created_from timestamptz default null,
  p_created_to   timestamptz default null,
  p_limit        integer     default 25,
  p_offset       integer     default 0
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_sort   text    := case
                       when p_sort in ('last_activity','created_desc','created_asc',
                                       'next_appointment','name')
                       then p_sort else 'last_activity'
                     end;
  v_filter text    := case
                       when p_filter in ('all','active','inactive','has_future','no_future',
                                         'returning','no_show','cancelled','archived')
                       then p_filter else 'all'
                     end;
  v_search text    := nullif(trim(coalesce(p_search, '')), '');
  v_like   text;
  v_digits text;
  v_result jsonb;
begin
  if v_search is not null then
    v_search := left(v_search, 100);
    v_like   := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := ltrim(regexp_replace(v_search, '[^0-9]', '', 'g'), '0');
    v_digits := nullif(v_digits, '');
  end if;

  with filtered as (
    select
      c.id, c.full_name, c.phone_e164, c.created_at,
      (c.auth_user_id is not null)      as has_login_account,
      c.archived_at,
      coalesce(p.crm_status, 'active')  as crm_status,
      coalesce(p.source_key, 'unknown') as source_key,
      m.completed_count, m.no_show_count,
      m.cancelled_by_customer_count, m.cancelled_by_business_count,
      m.active_pending_count, m.self_reschedule_total, m.all_reschedule_events,
      m.first_completed_at, m.last_completed_at,
      m.next_confirmed_starts_at, m.next_confirmed_service_key, m.next_confirmed_variants,
      m.open_notes_count, m.last_activity_at
    from public.customers c
    left join public.customer_crm_profiles p on p.customer_id = c.id
    join      public.customer_crm_metrics  m on m.customer_id = c.id
    where
      not (c.auth_user_id is not null
           and exists (select 1 from public.admins ad where ad.user_id = c.auth_user_id))
      -- 🔒 15H — הארכיון מוסתר, אלא אם ביקשו אותו במפורש.
      and (case when v_filter = 'archived'
                then c.archived_at is not null
                else c.archived_at is null
           end)
      and (v_search is null
           or c.full_name ilike v_like
           or (v_digits is not null and c.phone_e164 like '%' || v_digits || '%'))
      and (p_source_key is null or coalesce(p.source_key, 'unknown') = p_source_key)
      and (p_created_from is null or c.created_at >= p_created_from)
      and (p_created_to   is null or c.created_at <= p_created_to)
      and case v_filter
            when 'active'     then coalesce(p.crm_status, 'active') = 'active'
            when 'inactive'   then coalesce(p.crm_status, 'active') = 'inactive'
            when 'has_future' then m.next_confirmed_starts_at is not null
            when 'no_future'  then m.next_confirmed_starts_at is null
            when 'returning'  then m.completed_count > 1
            when 'no_show'    then m.no_show_count > 0
            when 'cancelled'  then (m.cancelled_by_customer_count + m.cancelled_by_business_count) > 0
            else true
          end
  ),
  page as (
    select f.*,
           row_number() over (
             order by
               case when v_sort = 'name'             then f.full_name                end asc,
               case when v_sort = 'created_asc'      then f.created_at               end asc,
               case when v_sort = 'created_desc'     then f.created_at               end desc,
               case when v_sort = 'next_appointment' then f.next_confirmed_starts_at end asc nulls last,
               case when v_sort = 'last_activity'    then f.last_activity_at         end desc,
               f.created_at desc
           ) as rn
    from filtered f
    order by rn
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total_count', (select count(*) from filtered),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(pg) - 'rn' order by pg.rn) from page pg),
      '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;


create or replace function public.get_crm_customer(p_customer_id uuid)
returns jsonb
language sql
stable
as $$
  select to_jsonb(x) from (
    select
      c.id, c.full_name, c.phone_e164, c.created_at,
      (c.auth_user_id is not null)      as has_login_account,
      c.archived_at,
      coalesce(p.crm_status, 'active')  as crm_status,
      p.crm_status_changed_at,
      coalesce(p.source_key, 'unknown') as source_key,
      p.source_changed_at,
      m.completed_count, m.no_show_count,
      m.cancelled_by_customer_count, m.cancelled_by_business_count,
      m.active_pending_count, m.self_reschedule_total, m.all_reschedule_events,
      m.first_completed_at, m.last_completed_at,
      m.next_confirmed_starts_at, m.next_confirmed_service_key, m.next_confirmed_variants,
      m.open_notes_count, m.last_activity_at
    from public.customers c
    left join public.customer_crm_profiles p on p.customer_id = c.id
    join      public.customer_crm_metrics  m on m.customer_id = c.id
    where c.id = p_customer_id
      and not (c.auth_user_id is not null
               and exists (select 1 from public.admins ad where ad.user_id = c.auth_user_id))
  ) x;
$$;


-- ============================================================================
-- הרשאות
--
-- אותו דפוס של 0006/0007/0008/0027, ומאותה סיבה.
--
-- 🔴 ארבע הפונקציות החדשות מוחקות, מארכבות ומשנות זהות לקוחה. הן מקבלות
-- admin_user_id כפרמטר ומאמתות אותו מול טבלת admins — אבל זה אינו תחליף
-- ל-service_role בלבד: לקוחה מחוברת שיכולה לקרוא להן הייתה יכולה לנחש
-- מזהה מנהלת ולנסות.
-- ============================================================================

revoke execute on function public.update_customer_details(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.archive_customer(uuid, uuid)      from public, anon, authenticated;
revoke execute on function public.unarchive_customer(uuid, uuid)    from public, anon, authenticated;
revoke execute on function public.delete_customer_if_safe(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.list_crm_customers(text, text, text, text, timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.get_crm_customer(uuid) from public, anon, authenticated;

grant execute on function public.update_customer_details(uuid, uuid, text, text) to service_role;
grant execute on function public.archive_customer(uuid, uuid)        to service_role;
grant execute on function public.unarchive_customer(uuid, uuid)      to service_role;
grant execute on function public.delete_customer_if_safe(uuid, uuid) to service_role;
grant execute on function public.list_crm_customers(text, text, text, text, timestamptz, timestamptz, integer, integer)
  to service_role;
grant execute on function public.get_crm_customer(uuid) to service_role;


-- ============================================================================
-- אימות בפועל
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.update_customer_details(uuid, uuid, text, text)',
    'public.archive_customer(uuid, uuid)',
    'public.unarchive_customer(uuid, uuid)',
    'public.delete_customer_if_safe(uuid, uuid)',
    'public.list_crm_customers(text, text, text, text, timestamptz, timestamptz, integer, integer)',
    'public.get_crm_customer(uuid)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_signatures loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0028): % — ל-anon עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0028): % — ל-authenticated עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0028): % — ל-service_role חסר EXECUTE.', v_sig using errcode = 'P0101';
    end if;
  end loop;

  raise notice 'הרשאות RPC של 0028 אומתו: anon=false, authenticated=false, service_role=true.';
end $$;

do $$
declare
  v_cols  integer;
  v_check integer;
  v_idx   integer;
begin
  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'customers'
    and column_name in ('archived_at', 'archived_by');
  if v_cols <> 2 then
    raise exception '0028: נוספו % מתוך 2 עמודות הארכיון.', v_cols using errcode = 'P0103';
  end if;

  /*
   * ⚠️ כל **ששת** הערכים הישנים נבדקים במפורש, ולא רק אחד מהם.
   *
   * ה-CHECK הזה נבנה בשני שלבים (0009 ואז 0010), והחלפתו כאן מסתמכת על
   * כתיבת הרשימה מחדש — כלומר על כך שלא נשכח ערך. השכחה היחידה שקרתה
   * בפועל בפיתוח הייתה 'customer_created' (שנוסף ב-0010), והיא שברה את
   * יצירת הלקוחה הידנית בשקט מוחלט: ה-CHECK דוחה, והשגיאה מופיעה רק
   * כשמנהלת מנסה ליצור לקוחה. הבדיקה הזו הופכת שכחה כזו לכשל מיגרציה.
   */
  select count(*) into v_check
  from pg_constraint
  where conrelid = 'public.customer_crm_activity'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%crm_status_changed%'
    and pg_get_constraintdef(oid) like '%source_changed%'
    and pg_get_constraintdef(oid) like '%note_created%'
    and pg_get_constraintdef(oid) like '%note_updated%'
    and pg_get_constraintdef(oid) like '%note_archived%'
    and pg_get_constraintdef(oid) like '%customer_created%'
    and pg_get_constraintdef(oid) like '%name_updated%'
    and pg_get_constraintdef(oid) like '%phone_updated%'
    and pg_get_constraintdef(oid) like '%unarchived%';
  if v_check <> 1 then
    raise exception
      '0028: ה-CHECK על customer_crm_activity.action אינו מכיל את כל הערכים — ערך ישן נמחק או ערך חדש לא נוסף.'
      using errcode = 'P0103';
  end if;

  select count(*) into v_idx
  from pg_indexes where schemaname = 'public' and indexname = 'customers_not_archived_idx';
  if v_idx <> 1 then
    raise exception '0028: האינדקס החלקי customers_not_archived_idx לא נוצר.' using errcode = 'P0103';
  end if;

  -- 🔒 ההגנה האמיתית על ההיסטוריה. אם ה-FK הזה יאבד את restrict, מחיקת
  -- לקוחה תמחק איתה תורים — וזה בדיוק מה שאסור.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and contype = 'f'
      and confrelid = 'public.customers'::regclass
      and confdeltype = 'r'
  ) then
    raise exception
      '0028: appointments.customer_id אינו on delete restrict — מחיקת לקוחה עלולה למחוק היסטוריה עסקית.'
      using errcode = 'P0103';
  end if;

  /*
   * 🔴 שתי ההנחות שעליהן נשענת חסימת המחיקה ללקוחה עם חשבון. אם אחת מהן
   * תשתנה אי פעם, ההיגיון של החסימה משתנה איתה — ועדיף שהמיגרציה תיפול
   * מאשר שהקוד ימשיך לפעול לפי הנחה שכבר אינה נכונה.
   */
  -- ⚠️ הסינון לפי שם העמודה חובה: מ-customers יוצאים **שני** FK ל-auth.users
  -- — auth_user_id (SET NULL) ו-archived_by שנוסף בחלק 1 (NO ACTION, כמו
  -- created_by_admin_id ב-0009). בלי הסינון הבדיקה בודקת FK אקראי.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (auth\_user\_id)%'
      and confdeltype = 'n'   -- SET NULL
  ) then
    raise exception
      '0028: customers.auth_user_id אינו on delete set null — הנחת היסוד של חסימת המחיקה השתנתה.'
      using errcode = 'P0103';
  end if;

  -- ⚠️ ה-cascade הזה הוא הסיבה ש-sessions **אינם** נמחקים עם הלקוחה: הם
  -- תלויים ב-auth user, לא בכרטיס. זו אחת משלוש השאריות שהחסימה מונעת.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_sessions'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and confdeltype = 'c'   -- CASCADE
  ) then
    raise exception
      '0028: app_sessions.auth_user_id אינו on delete cascade — הנחת היסוד של חסימת המחיקה השתנתה.'
      using errcode = 'P0103';
  end if;

  -- 🔴 החסימה עצמה חייבת להיות בקוד הפונקציה. בלעדיה המחיקה משאירה
  -- auth יתום, sessions חיים, וכרטיס חדש בהתחברות הבאה.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'delete_customer_if_safe')
     not like '%blocked_has_login_account%' then
    raise exception
      '0028: delete_customer_if_safe אינה חוסמת לקוחה עם חשבון התחברות — מחיקה תשאיר auth user יתום.'
      using errcode = 'P0103';
  end if;

  raise notice '0028: עמודות הארכיון, ה-CHECK, האינדקס, שלושת ה-FK וחסימת ה-auth — כולם תקינים.';
end $$;
