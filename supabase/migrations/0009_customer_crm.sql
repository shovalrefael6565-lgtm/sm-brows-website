-- ============================================================================
-- 0009 — שלב 9: CRM ופרופיל לקוחה מלא
--
-- תלוי ב-0001–0008 שכבר רצו. אין כאן שום ALTER/DROP על מה שנוצר שם, פרט
-- ל-COMMENT אחד על customers.admin_notes (שאינו משנה התנהגות) ולטריגר
-- AFTER INSERT אחד על customers שיוצר פרופיל CRM ריק. אף עמודה קיימת לא
-- משתנה, אף נתון קיים לא נמחק.
--
-- ⚠️ אין כאן ALTER TYPE ... ADD VALUE, ולכן — כמו ב-0005 וב-0008 ובניגוד
-- ל-0002 — אין צורך לפצל את הקובץ.
--
-- ─── מה השלב הזה מוסיף ────────────────────────────────────────────────────
--
-- ארבע טבלאות CRM, view אחד למדדים, ושבעה RPCs. ה-CRM מציג אך ורק לקוחות
-- שקיימות ב-Supabase; אין ייבוא מ-Google Calendar ואין יצירת לקוחה.
--
-- ─── ארבעה גבולות שמקודדים כאן ולא רק בקוד ────────────────────────────────
--
--   1. סטטוס CRM (active/inactive) אינו חוסם דבר. הוא לא נקרא בשום מקום
--      מלבד תצוגה וסינון. is_blocked הקיים מ-0001 הוא החסימה האמיתית והוא
--      נשאר נפרד ממנו לחלוטין — אל תאחד ביניהם לעולם.
--
--   2. מקור הגעה לעולם אינו מוסק. לא משם, לא מ-Google Calendar, לא
--      מ-appointment ולא מזרימת ה-OTP. ברירת המחדל היא 'unknown', והיא
--      משתנה אך ורק בבחירה ידנית של מנהל.
--
--   3. שובל ורפאל קיימות ב-customers רק כדי להתחבר כמנהלות. הן מוחרגות
--      מה-CRM דרך טבלת admins בפועל — לא לפי טלפון ולא לפי UUID קשיח.
--
--   4. customer_crm_activity היא append-only: טריגר חוסם UPDATE, ואין
--      route או RPC שמוחק ממנה. DELETE נשאר מותר *רק* כדי ש-ON DELETE
--      CASCADE ימשיך לעבוד בניקוי נתוני בדיקה — ראה ההסבר שם.
--
-- ─── מה השלב הזה במפורש אינו עושה ─────────────────────────────────────────
--
-- אין יצירת לקוחה ידנית, אין יצירת תור ידני, אין מיזוג, אין מחיקה, אין
-- ייבוא, אין תזכורות, אין consent, ואין שום הצגה של כסף: אין הכנסה, אין
-- LTV, ו-price_total אינו מוצג כסכום ששולם — אין במערכת מקור אמת לתשלום.
-- ============================================================================


-- ============================================================================
-- טבלאות
-- ============================================================================

-- ─── מקורות הגעה: lookup ולא enum ──────────────────────────────────────────
--
-- lookup table ולא enum משתי סיבות. הראשונה מתועדת ב-0002: הוספת ערך
-- ל-enum דורשת מיגרציה מבודדת משלה בגלל התנהגות הטרנזקציה של
-- ALTER TYPE ... ADD VALUE. השנייה עסקית: בעתיד נרצה לנהל מקורות מתוך
-- Settings, והוספת מקור צריכה לעלות INSERT אחד — לא migration.
--
-- is_active מכין את ההרחבה הזו כבר עכשיו: מקור שיוצא משימוש נכבה ולא
-- נמחק, כדי שלקוחות שכבר משויכות אליו ימשיכו להציג אותו נכון בהיסטוריה.

create table public.customer_sources (
  key         text primary key check (key ~ '^[a-z_]{2,32}$'),
  label_he    text not null check (length(trim(label_he)) between 1 and 40),
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),

  -- 'unknown' הוא ברירת המחדל של כל לקוחה חדשה ושל כל שורת backfill.
  -- כיבוי שלו היה משאיר לקוחות עם מקור שאי אפשר לבחור מחדש.
  constraint customer_sources_unknown_stays_active
    check (key <> 'unknown' or is_active)
);

comment on table public.customer_sources is
  'מקורות הגעה. הוספת מקור = INSERT, לא migration. אין מחיקה — משתמשים ב-is_active.';

insert into public.customer_sources (key, label_he, sort_order) values
  ('website',           'האתר',            10),
  ('instagram',         'אינסטגרם',        20),
  ('facebook',          'פייסבוק',         30),
  ('tiktok',            'טיקטוק',          40),
  ('google',            'גוגל',            50),
  ('whatsapp',          'וואטסאפ',         60),
  ('referral',          'המלצה',           70),
  ('existing_customer', 'לקוחה קיימת',     80),
  ('other',             'אחר',             90),
  ('unknown',           'לא ידוע',        999);


-- ─── פרופיל CRM ────────────────────────────────────────────────────────────
--
-- ⚠️ טבלה נפרדת ולא עמודות על customers — וזו החלטת אבטחה, לא סגנון.
-- ל-customers יש מדיניות customers_select_own (0001), שמאפשרת ללקוחה
-- מחוברת לקרוא את השורה שלה דרך המפתח ה-anon. אילו crm_status ו-source_key
-- היו יושבים שם, הלקוחה הייתה רואה אותם. כאן RLS מופעל בלי אף policy,
-- ולכן הטבלה נגישה ל-service_role בלבד.
--
-- crm_status הוא text+CHECK ולא enum: יש בו שני ערכים בלבד, וחלק 16 של
-- אפיון השלב אוסר במפורש להרחיב אותו ל-blocked/do_not_contact. CHECK גם
-- נמנע מבעיית ALTER TYPE המתועדת ב-0002.

create table public.customer_crm_profiles (
  customer_id            uuid primary key references public.customers(id) on delete cascade,

  crm_status             text not null default 'active'
                         check (crm_status in ('active', 'inactive')),
  crm_status_changed_at  timestamptz,
  crm_status_changed_by  uuid references auth.users(id),

  source_key             text not null default 'unknown'
                         references public.customer_sources(key),
  source_changed_at      timestamptz,
  source_changed_by      uuid references auth.users(id),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on column public.customer_crm_profiles.crm_status is
  'סטטוס ניהולי ידני בלבד. אינו חוסם התחברות, קביעת תור או תורים קיימים, ואינו משתנה אוטומטית לפי חוסר פעילות.';
comment on column public.customer_crm_profiles.source_key is
  'מקור הגעה. לעולם אינו מוסק — ברירת המחדל unknown, ושינוי הוא בחירה ידנית של מנהל.';

-- ⚠️ אין כאן אינדקס על crm_status, בכוונה ואחרי מדידה.
--
-- list_crm_customers אינה מסננת על העמודה עצמה אלא על
-- `coalesce(p.crm_status, 'active')`, מעל LEFT JOIN ובתוך CASE. COALESCE
-- הוא ביטוי, ואינדקס btree רגיל אינו שמיש עבורו — EXPLAIN ANALYZE על
-- 5,000 לקוחות עם 10% inactive הראה Seq Scan עם
-- `Filter: (COALESCE(p.crm_status, 'active') = 'inactive')`, בזמן
-- שאותה שאילתה על העמודה החשופה כן בחרה Index Scan. כלומר האינדקס לא
-- היה נבחר לעולם בשאילתה שאנחנו באמת מריצים.
--
-- ה-COALESCE אינו מיותר: הוא מה שמאפשר ללקוחה ללא שורת פרופיל להופיע
-- ברשימה עם ברירת המחדל 'active' במקום להיעלם.


-- ─── הערות פנימיות ─────────────────────────────────────────────────────────
--
-- מחליפות את customers.admin_notes מ-0001, שמעולם לא נכתב אליו בקוד.
-- ההערה נשמרת כטקסט פשוט בלבד: אין HTML, אין Markdown פעיל, וההצגה
-- עוברת דרך escaping רגיל של React.
--
-- אין hard delete בשום מקום — מחיקה היא archive. אין RPC למחיקה ואין route.
--
-- client_request_id הוא מפתח ה-idempotency: הוא נוצר פעם אחת בדפדפן לכל
-- ניסיון יצירה ונשלח שוב בכל retry. בלעדיו, תגובה שאבדה אחרי שה-DB כבר
-- כתב הייתה יוצרת הערה כפולה בלחיצה החוזרת — ו-disabled על הכפתור אינו
-- מגן על כך, כי הכתיבה כבר קרתה.

create table public.customer_notes (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references public.customers(id) on delete cascade,
  body                 text not null check (length(trim(body)) between 1 and 2000),
  client_request_id    uuid not null,
  created_by_admin_id  uuid not null references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  archived_at          timestamptz,
  archived_by_admin_id uuid references auth.users(id),

  constraint customer_notes_idempotent unique (customer_id, client_request_id),
  constraint customer_notes_archive_consistent
    check ((archived_at is null) = (archived_by_admin_id is null))
);

comment on column public.customer_notes.body is
  'טקסט פשוט בלבד. לא מוצג ללקוחה, לא נשלח ל-Google Calendar/WhatsApp/SMS, ולא נכנס ל-activity או ללוגים.';
comment on column public.customer_notes.client_request_id is
  'מפתח idempotency פנימי. אינו מוצג למשתמש ואינו נכנס ל-activity.';

create index customer_notes_customer_idx
  on public.customer_notes (customer_id, created_at desc)
  where archived_at is null;


-- ─── פעילות CRM (append-only) ──────────────────────────────────────────────
--
-- למה הטבלה נדרשת ולא מספיק updated_at: השדות *_changed_at בפרופיל שומרים
-- רק את השינוי *האחרון*. הם לא יכולים לייצג ש-active→inactive וגם
-- inactive→active קרו, ולא לתעד create/edit/archive של הערות. זו היסטוריה,
-- ושדה יחיד אינו היסטוריה.
--
-- ⚠️ related_note_id הוא ON DELETE CASCADE ולא SET NULL — בכוונה. SET NULL
-- הוא UPDATE על הטבלה הזו, והוא היה מתנגש עם הטריגר החוסם UPDATE למטה
-- ומפוצץ כל מחיקת הערה או ניקוי נתוני בדיקה.
--
-- ⚠️ הטריגר חוסם UPDATE בלבד, לא DELETE. חסימת DELETE הייתה שוברת את
-- ON DELETE CASCADE של customer_id, כלומר מחיקת לקוחת בדיקה בניקוי הייתה
-- נכשלת. ההגנה על append-only היא: אין route, אין RPC, ואין הרשאה
-- ל-anon/authenticated. DELETE מתרחש אך ורק כ-cascade ממחיקת customer
-- או note — ואז מחיקת ה-activity היא ההתנהגות הנכונה, ולא נשארות יתומות.

create table public.customer_crm_activity (
  id              bigserial primary key,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  action          text not null check (action in (
                    'crm_status_changed',
                    'source_changed',
                    'note_created',
                    'note_updated',
                    'note_archived'
                  )),
  actor_admin_id  uuid not null references auth.users(id),
  old_value       text check (length(old_value) <= 64),
  new_value       text check (length(new_value) <= 64),
  related_note_id uuid references public.customer_notes(id) on delete cascade,
  created_at      timestamptz not null default now()
);

comment on table public.customer_crm_activity is
  'Append-only. אין UPDATE (טריגר חוסם), ואין route/RPC למחיקה. DELETE מותר רק כ-cascade.';
comment on column public.customer_crm_activity.old_value is
  'ערך קצר בלבד (סטטוס/מקור). לעולם לא גוף הערה ולא מספר טלפון.';

-- actor_admin_id מפנה ל-auth.users ולא ל-admins בכוונה: אילו הוא הצביע
-- על admins, הסרת מנהלת מהטבלה בעתיד הייתה מוחקת את רשומות האודיט שלה
-- (או חוסמת את ההסרה). אודיט חייב לשרוד שינוי הרשאות. החברות ב-admins
-- נאכפת בזמן הכתיבה בתוך כל RPC, לא דרך FK.

create index customer_crm_activity_customer_idx
  on public.customer_crm_activity (customer_id, created_at desc);


-- ─── תיעוד העמודה המוחלפת ──────────────────────────────────────────────────
-- COMMENT בלבד. אין DROP COLUMN, אין backfill ממנה, והיא אינה מוצגת ב-CRM.

comment on column public.customers.admin_notes is
  'Deprecated: internal CRM notes are stored in public.customer_notes';


-- ============================================================================
-- טריגרים
-- ============================================================================

-- כל לקוחה חדשה מקבלת פרופיל CRM עם active + unknown. כך דרישת ברירת
-- המחדל מובטחת ב-DB ולא תלויה בכך שקוד היצירה ייזכר לקרוא לפונקציה.
create or replace function public.create_crm_profile_for_customer()
returns trigger
language plpgsql
as $$
begin
  insert into public.customer_crm_profiles (customer_id)
  values (new.id)
  on conflict (customer_id) do nothing;
  return new;
end;
$$;

create trigger customers_create_crm_profile
  after insert on public.customers
  for each row execute function public.create_crm_profile_for_customer();

-- append-only: כל UPDATE נדחה, כולל ע"י service_role.
create or replace function public.reject_crm_activity_update()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'customer_crm_activity היא append-only — UPDATE אינו מותר (שורה %).', old.id
    using errcode = 'P0103';
end;
$$;

create trigger customer_crm_activity_no_update
  before update on public.customer_crm_activity
  for each row execute function public.reject_crm_activity_update();

create trigger customer_crm_profiles_touch
  before update on public.customer_crm_profiles
  for each row execute function public.touch_updated_at();

create trigger customer_notes_touch
  before update on public.customer_notes
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- Backfill
--
-- אידמפוטנטי: הרצה חוזרת של הקובץ לא יוצרת כפילות.
--
-- source_key נשאר 'unknown' (ברירת המחדל) ולא 'website': העובדה שהשורה
-- נוצרה דרך זרימת ה-OTP מוכיחה איפה נפתח החשבון, לא מאיפה הלקוחה הגיעה.
-- לקוחה יכולה להכיר את העסק באינסטגרם או מהמלצה ואז להירשם באתר.
--
-- crm_status_changed_at/by נשארים NULL — אף מנהל לא ביצע פעולה, ולכן
-- ה-backfill גם אינו כותב אף שורת activity.
-- ============================================================================

insert into public.customer_crm_profiles (customer_id)
select c.id from public.customers c
on conflict (customer_id) do nothing;


-- ============================================================================
-- אינדקס נוסף על appointments
--
-- משרת את ה-LATERAL של "התור הבא" ואת המיון לפיו. האינדקס הקיים
-- appointments_customer_starts_idx הוא (customer_id, starts_at desc) ללא
-- סינון סטטוס, ולכן הוא סורק גם תורים שבוטלו.
--
-- לא מתווספים אינדקסים על customers.created_at או על source_key: בטבלה
-- בסדר גודל של עשרות עד מאות שורות, seq scan מהיר מקפיצת אינדקס, והם היו
-- נופלים להגדרת "אינדקס מיותר".
-- ============================================================================

create index appointments_customer_next_idx
  on public.appointments (customer_id, starts_at)
  where status = 'confirmed';


-- ============================================================================
-- View: מדדי CRM לכל לקוחה
--
-- מקור אמת יחיד לכל המדדים, כדי שרשימת הלקוחות והפרופיל לא יוכלו להתפצל
-- בהגדרה של "התור הבא" או "בקשה ממתינה". שניהם קוראים מכאן.
--
-- ⚠️ security_invoker = true הוא קריטי: בלעדיו view רץ בהרשאות הבעלים
-- ועוקף RLS של הטבלאות שמתחתיו עבור כל מי שיכול לקרוא אותו. בנוסף,
-- ה-SELECT נשלל במפורש מ-anon ומ-authenticated למטה.
--
-- אין כאן שום שדה כספי. price_total אינו מסוכם ואינו מוצג כסכום ששולם —
-- אין במערכת מקור אמת לתשלום.
-- ============================================================================

create view public.customer_crm_metrics with (security_invoker = true) as
with appt as (
  select
    a.customer_id,
    count(*) filter (where a.status = 'completed')::integer               as completed_count,
    count(*) filter (where a.status = 'no_show')::integer                 as no_show_count,
    count(*) filter (where a.status = 'cancelled_by_customer')::integer   as cancelled_by_customer_count,
    count(*) filter (where a.status = 'cancelled_by_business')::integer   as cancelled_by_business_count,
    -- "בקשה ממתינה פעילה" — אותו תנאי בדיוק שכבר בשימוש ב-0004 וב-0005,
    -- כך ש-pending שפג תוקפו ועוד לא עודכן ע"י ה-job אינו נספר.
    count(*) filter (where a.status = 'pending'
                       and (a.pending_expires_at is null
                            or a.pending_expires_at > now()))::integer    as active_pending_count,
    -- הזזות עצמיות של הלקוחה — זה מה שמזין את מדיניות max_reschedules.
    coalesce(sum(a.reschedule_count), 0)::integer                         as self_reschedule_total,
    min(a.starts_at) filter (where a.status = 'completed')                as first_completed_at,
    max(a.starts_at) filter (where a.status = 'completed')                as last_completed_at,
    max(a.created_at)                                                     as last_appointment_created_at
  from public.appointments a
  group by a.customer_id
),
hist as (
  select
    a.customer_id,
    max(h.created_at)                                        as last_history_at,
    -- כלל אירועי ההזזה, כולל מנהליים וכאלה שהגיעו מ-Google Calendar.
    -- מספר אחר לגמרי מ-self_reschedule_total, ואין להציג אותם כאותו דבר.
    count(*) filter (where h.action = 'rescheduled')::integer as all_reschedule_events
  from public.appointment_history h
  join public.appointments a on a.id = h.appointment_id
  group by a.customer_id
),
act as (
  select customer_id, max(created_at) as last_crm_activity_at
  from public.customer_crm_activity
  group by customer_id
),
notes as (
  select customer_id, count(*)::integer as open_notes_count
  from public.customer_notes
  where archived_at is null
  group by customer_id
)
select
  c.id                                                as customer_id,
  coalesce(appt.completed_count, 0)                   as completed_count,
  coalesce(appt.no_show_count, 0)                     as no_show_count,
  coalesce(appt.cancelled_by_customer_count, 0)       as cancelled_by_customer_count,
  coalesce(appt.cancelled_by_business_count, 0)       as cancelled_by_business_count,
  coalesce(appt.active_pending_count, 0)              as active_pending_count,
  coalesce(appt.self_reschedule_total, 0)             as self_reschedule_total,
  coalesce(hist.all_reschedule_events, 0)             as all_reschedule_events,
  appt.first_completed_at,
  appt.last_completed_at,
  nxt.starts_at                                       as next_confirmed_starts_at,
  nxt.service_key                                     as next_confirmed_service_key,
  nxt.variants                                        as next_confirmed_variants,
  coalesce(notes.open_notes_count, 0)                 as open_notes_count,
  -- פעילות אחרונה: המאוחר מבין יצירת תור, היסטוריית תור, ופעילות CRM.
  -- הערות, שינויי סטטוס ושינויי מקור כולם כותבים ל-customer_crm_activity,
  -- ולכן שלושה מקורות מכסים את כל חמשת סוגי האירועים.
  greatest(
    c.created_at,
    coalesce(appt.last_appointment_created_at, c.created_at),
    coalesce(hist.last_history_at,             c.created_at),
    coalesce(act.last_crm_activity_at,         c.created_at)
  )                                                   as last_activity_at
from public.customers c
left join appt  on appt.customer_id  = c.id
left join hist  on hist.customer_id  = c.id
left join act   on act.customer_id   = c.id
left join notes on notes.customer_id = c.id
left join lateral (
  -- התור הבא = confirmed עתידי בלבד. pending לעולם אינו תור מאושר.
  select a.starts_at, a.service_key, a.variants
  from public.appointments a
  where a.customer_id = c.id
    and a.status      = 'confirmed'
    and a.starts_at   > now()
  order by a.starts_at
  limit 1
) nxt on true;

comment on view public.customer_crm_metrics is
  'מקור האמת היחיד למדדי CRM. הרשימה והפרופיל קוראים ממנו כדי שההגדרות לא יתפצלו.';


-- ============================================================================
-- RPCs
--
-- כולן SECURITY INVOKER (ברירת המחדל), כמו 24 הפונקציות הקיימות: הן
-- נקראות אך ורק ע"י service_role בשרת, שממילא עוקף RLS. SECURITY DEFINER
-- היה מוסיף הסלמת הרשאות בלי שום צורך.
--
-- כל RPC שמשנה מצב פותח באימות שה-actor הוא מנהל *בפועל*. p_admin_id
-- לעולם אינו מגיע מגוף הבקשה — הוא נלקח מה-session המאומת בשרת. הבדיקה
-- כאן היא שכבה שנייה: גם אם ה-route ייפרץ, ה-DB דוחה.
-- ============================================================================

create or replace function public.assert_crm_actor_is_admin(p_admin_id uuid)
returns void
language plpgsql
as $$
begin
  if p_admin_id is null
     or not exists (select 1 from public.admins where user_id = p_admin_id) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
end;
$$;


-- ─── רשימת ה-CRM ───────────────────────────────────────────────────────────
--
-- מחזירה jsonb יחיד: { items: [...], total_count: N }.
--
-- ⚠️ total_count נגזר מה-CTE המסונן ולא משורות העמוד. count(*) over() היה
-- נעלם כשעמוד מחוץ לטווח מחזיר אפס שורות (page=99 מתוך 30 לקוחות), ואז
-- הממשק לא היה יודע שקיימות לקוחות בעמודים קודמים.
--
-- CTE מסונן אחד מזין גם את ה-count וגם את ה-items, ולכן אין שום דרך
-- שפילטר יחול על אחד ולא על השני.
--
-- אין dynamic SQL ואין ORDER BY מטקסט: המיון הוא CASE סגור, וכל ערך לא
-- מוכר נופל לברירת מחדל בטוחה. limit ו-offset נחתכים כאן ב-DB, לא רק ב-TS.
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
                                         'returning','no_show','cancelled')
                       then p_filter else 'all'
                     end;
  -- מנוקה מ-wildcards של ilike כדי שחיפוש לא ישנה את תנאי השאילתה עצמה
  v_search text    := nullif(trim(coalesce(p_search, '')), '');
  v_like   text;
  v_digits text;
  v_result jsonb;
begin
  if v_search is not null then
    v_search := left(v_search, 100);
    v_like   := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    -- ספרות בלבד, בלי אפס מוביל: '052-123-4567' → '521234567', שהוא
    -- תת-מחרוזת של '+972521234567'. כך מספר מלא בכל פורמט ישראלי וגם
    -- ספרות חלקיות מוצאים את אותה לקוחה.
    v_digits := ltrim(regexp_replace(v_search, '[^0-9]', '', 'g'), '0');
    v_digits := nullif(v_digits, '');
  end if;

  with filtered as (
    select
      c.id, c.full_name, c.phone_e164, c.created_at,
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
      -- שובל ורפאל קיימות ב-customers רק כדי להתחבר. ההחרגה היא מול
      -- טבלת admins בפועל — לא לפי טלפון ולא לפי UUID קשיח — והיא יושבת
      -- כאן, ב-CTE שמזין גם את ה-count וגם את ה-items.
      not exists (select 1 from public.admins ad where ad.user_id = c.id)
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


-- ─── פרופיל לקוחה יחידה ────────────────────────────────────────────────────
--
-- קורא מאותו view של הרשימה, כדי שההגדרות לעולם לא יתפצלו.
-- מחזיר null כשהמזהה אינו קיים *או* כשהוא מקושר ל-admins — ה-route מתרגם
-- את שניהם ל-404 זהה, בלי להסגיר שחשבון מנהל קיים.
create or replace function public.get_crm_customer(p_customer_id uuid)
returns jsonb
language sql
stable
as $$
  select to_jsonb(x) from (
    select
      c.id, c.full_name, c.phone_e164, c.created_at,
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
      and not exists (select 1 from public.admins ad where ad.user_id = c.id)
  ) x;
$$;


-- ─── שינוי סטטוס CRM ───────────────────────────────────────────────────────
--
-- אידמפוטנטי: active→active אינו כותב שורת activity נוספת. ההשוואה
-- והכתיבה באותה טרנזקציה, כדי ששתי לחיצות מקבילות לא ייצרו שתי רשומות.
--
-- upsert ולא update: אם הפרופיל חסר משום מה, הפעולה יוצרת אותו במקום
-- להשפיע על אפס שורות בשקט.
create or replace function public.set_customer_crm_status(
  p_customer_id uuid,
  p_status      text,
  p_admin_id    uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_old text;
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select crm_status into v_old
  from public.customer_crm_profiles
  where customer_id = p_customer_id
  for update;

  if v_old is not distinct from p_status then
    return jsonb_build_object('changed', false, 'crm_status', p_status);
  end if;

  insert into public.customer_crm_profiles
    (customer_id, crm_status, crm_status_changed_at, crm_status_changed_by)
  values
    (p_customer_id, p_status, now(), p_admin_id)
  on conflict (customer_id) do update
    set crm_status            = excluded.crm_status,
        crm_status_changed_at = excluded.crm_status_changed_at,
        crm_status_changed_by = excluded.crm_status_changed_by;

  insert into public.customer_crm_activity
    (customer_id, action, actor_admin_id, old_value, new_value)
  values
    (p_customer_id, 'crm_status_changed', p_admin_id, v_old, p_status);

  return jsonb_build_object('changed', true, 'crm_status', p_status);
end;
$$;


-- ─── שינוי מקור הגעה ───────────────────────────────────────────────────────
--
-- מקור inactive: שמירה על אותו מקור היא no-op מותר (הלקוחה כבר משויכת
-- אליו), אבל *מעבר* אליו נדחה — אחרת מקור שהוצא משימוש היה חוזר לשירות.
create or replace function public.set_customer_source(
  p_customer_id uuid,
  p_source_key  text,
  p_admin_id    uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_old       text;
  v_is_active boolean;
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  select is_active into v_is_active
  from public.customer_sources where key = p_source_key;

  if v_is_active is null then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select source_key into v_old
  from public.customer_crm_profiles
  where customer_id = p_customer_id
  for update;

  if v_old is not distinct from p_source_key then
    return jsonb_build_object('changed', false, 'source_key', p_source_key);
  end if;

  if not v_is_active then
    raise exception 'SOURCE_INACTIVE' using errcode = '22023';
  end if;

  insert into public.customer_crm_profiles
    (customer_id, source_key, source_changed_at, source_changed_by)
  values
    (p_customer_id, p_source_key, now(), p_admin_id)
  on conflict (customer_id) do update
    set source_key        = excluded.source_key,
        source_changed_at = excluded.source_changed_at,
        source_changed_by = excluded.source_changed_by;

  insert into public.customer_crm_activity
    (customer_id, action, actor_admin_id, old_value, new_value)
  values
    (p_customer_id, 'source_changed', p_admin_id, v_old, p_source_key);

  return jsonb_build_object('changed', true, 'source_key', p_source_key);
end;
$$;


-- ─── יצירת הערה ────────────────────────────────────────────────────────────
--
-- זרימת ה-idempotency:
--   התנגשות על (customer_id, client_request_id) + אותו body → retry, מחזיר
--   את אותה הערה בלי activity נוספת.
--   התנגשות + body שונה → IDEMPOTENCY_KEY_REUSED. אסור להחזיר הצלחה
--   כאילו התוכן החדש נשמר, ואסור לדרוס את הקיים.
create or replace function public.create_customer_note(
  p_customer_id       uuid,
  p_body              text,
  p_admin_id          uuid,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_body     text := trim(coalesce(p_body, ''));
  v_note_id  uuid;
  v_existing record;
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  if p_client_request_id is null then
    raise exception 'MISSING_REQUEST_ID' using errcode = '22023';
  end if;

  if length(v_body) = 0 then
    raise exception 'NOTE_EMPTY' using errcode = '22023';
  end if;

  if length(v_body) > 2000 then
    raise exception 'NOTE_TOO_LONG' using errcode = '22023';
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.customer_notes
    (customer_id, body, client_request_id, created_by_admin_id)
  values
    (p_customer_id, v_body, p_client_request_id, p_admin_id)
  on conflict (customer_id, client_request_id) do nothing
  returning id into v_note_id;

  if v_note_id is not null then
    insert into public.customer_crm_activity
      (customer_id, action, actor_admin_id, related_note_id)
    values
      (p_customer_id, 'note_created', p_admin_id, v_note_id);

    return jsonb_build_object('note_id', v_note_id, 'created', true);
  end if;

  select id, body into v_existing
  from public.customer_notes
  where customer_id = p_customer_id
    and client_request_id = p_client_request_id;

  if v_existing.body is distinct from v_body then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
  end if;

  return jsonb_build_object('note_id', v_existing.id, 'created', false);
end;
$$;


-- ─── עריכת הערה ────────────────────────────────────────────────────────────
--
-- ⚠️ p_customer_id בחתימה בכוונה, וה-WHERE דורש התאמה של שניהם: זה מה
-- שחוסם עדכון הערה של לקוחה אחת דרך המזהה של לקוחה אחרת.
--
-- אידמפוטנטי: body זהה אחרי trim → אין UPDATE, updated_at לא זז, אין
-- activity. הערה מאורכבת אינה ניתנת לעריכה.
create or replace function public.update_customer_note(
  p_note_id     uuid,
  p_customer_id uuid,
  p_body        text,
  p_admin_id    uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_body text := trim(coalesce(p_body, ''));
  v_cur  record;
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  if length(v_body) = 0 then
    raise exception 'NOTE_EMPTY' using errcode = '22023';
  end if;

  if length(v_body) > 2000 then
    raise exception 'NOTE_TOO_LONG' using errcode = '22023';
  end if;

  select id, body, archived_at into v_cur
  from public.customer_notes
  where id = p_note_id and customer_id = p_customer_id
  for update;

  if v_cur.id is null then
    raise exception 'NOTE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_cur.archived_at is not null then
    raise exception 'NOTE_ARCHIVED' using errcode = '22023';
  end if;

  if v_cur.body is not distinct from v_body then
    return jsonb_build_object('changed', false, 'note_id', p_note_id);
  end if;

  update public.customer_notes
  set body = v_body
  where id = p_note_id and customer_id = p_customer_id;

  -- גוף ההערה לא נכנס ל-activity, לא הישן ולא החדש.
  insert into public.customer_crm_activity
    (customer_id, action, actor_admin_id, related_note_id)
  values
    (p_customer_id, 'note_updated', p_admin_id, p_note_id);

  return jsonb_build_object('changed', true, 'note_id', p_note_id);
end;
$$;


-- ─── ארכוב הערה ────────────────────────────────────────────────────────────
--
-- אין hard delete בשום מקום. archive אינו מוחק את body.
-- אידמפוטנטי: הערה שכבר מאורכבת → אין כתיבה ואין activity נוספת.
create or replace function public.archive_customer_note(
  p_note_id     uuid,
  p_customer_id uuid,
  p_admin_id    uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_cur record;
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  select id, archived_at into v_cur
  from public.customer_notes
  where id = p_note_id and customer_id = p_customer_id
  for update;

  if v_cur.id is null then
    raise exception 'NOTE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_cur.archived_at is not null then
    return jsonb_build_object('changed', false, 'note_id', p_note_id);
  end if;

  update public.customer_notes
  set archived_at = now(), archived_by_admin_id = p_admin_id
  where id = p_note_id and customer_id = p_customer_id;

  insert into public.customer_crm_activity
    (customer_id, action, actor_admin_id, related_note_id)
  values
    (p_customer_id, 'note_archived', p_admin_id, p_note_id);

  return jsonb_build_object('changed', true, 'note_id', p_note_id);
end;
$$;


-- ============================================================================
-- Row Level Security
--
-- כל ארבע הטבלאות: RLS מופעל ואף policy אחד לא נוצר → anon ו-authenticated
-- חסומים מוחלטות, כולל מ-customer_sources. רשימת המקורות נטענת בקוד
-- ניהולי בשרת דרך service_role, ולא ישירות מהדפדפן.
-- ============================================================================

alter table public.customer_sources        enable row level security;
alter table public.customer_crm_profiles   enable row level security;
alter table public.customer_notes          enable row level security;
alter table public.customer_crm_activity   enable row level security;


-- ============================================================================
-- הרשאות
-- ============================================================================

-- ה-view: בלי השלילה הזו, security_invoker לבדו לא היה מספיק — anon היה
-- יכול לקרוא ממנו את המדדים של כל הלקוחות.
revoke all    on public.customer_crm_metrics from public, anon, authenticated;
grant  select on public.customer_crm_metrics to service_role;

revoke execute on function public.assert_crm_actor_is_admin(uuid)                                                        from public, anon, authenticated;
revoke execute on function public.list_crm_customers(text,text,text,text,timestamptz,timestamptz,integer,integer)         from public, anon, authenticated;
revoke execute on function public.get_crm_customer(uuid)                                                                 from public, anon, authenticated;
revoke execute on function public.set_customer_crm_status(uuid,text,uuid)                                                from public, anon, authenticated;
revoke execute on function public.set_customer_source(uuid,text,uuid)                                                    from public, anon, authenticated;
revoke execute on function public.create_customer_note(uuid,text,uuid,uuid)                                              from public, anon, authenticated;
revoke execute on function public.update_customer_note(uuid,uuid,text,uuid)                                              from public, anon, authenticated;
revoke execute on function public.archive_customer_note(uuid,uuid,uuid)                                                  from public, anon, authenticated;

grant execute on function public.assert_crm_actor_is_admin(uuid)                                                         to service_role;
grant execute on function public.list_crm_customers(text,text,text,text,timestamptz,timestamptz,integer,integer)         to service_role;
grant execute on function public.get_crm_customer(uuid)                                                                  to service_role;
grant execute on function public.set_customer_crm_status(uuid,text,uuid)                                                 to service_role;
grant execute on function public.set_customer_source(uuid,text,uuid)                                                     to service_role;
grant execute on function public.create_customer_note(uuid,text,uuid,uuid)                                               to service_role;
grant execute on function public.update_customer_note(uuid,uuid,text,uuid)                                               to service_role;
grant execute on function public.archive_customer_note(uuid,uuid,uuid)                                                   to service_role;


-- ============================================================================
-- אימות ההרשאות — המיגרציה נכשלת אם המצב אינו נכון.
-- אותו דפוס בדיוק כמו 0007 ו-0008: לא להסתמך על "Success" של ה-SQL Editor.
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.assert_crm_actor_is_admin(uuid)',
    'public.list_crm_customers(text, text, text, text, timestamptz, timestamptz, integer, integer)',
    'public.get_crm_customer(uuid)',
    'public.set_customer_crm_status(uuid, text, uuid)',
    'public.set_customer_source(uuid, text, uuid)',
    'public.create_customer_note(uuid, text, uuid, uuid)',
    'public.update_customer_note(uuid, uuid, text, uuid)',
    'public.archive_customer_note(uuid, uuid, uuid)'
  ];
  v_sig      text;
  v_verified integer := 0;
begin
  foreach v_sig in array v_signatures loop

    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception
        'הרשאות RPC (0009): % — לתפקיד anon עדיין יש EXECUTE. ההרשאה הזו אמורה להישלל.',
        v_sig
        using errcode = 'P0100';
    end if;

    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception
        'הרשאות RPC (0009): % — לתפקיד authenticated עדיין יש EXECUTE. ההרשאה הזו אמורה להישלל.',
        v_sig
        using errcode = 'P0100';
    end if;

    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception
        'הרשאות RPC (0009): % — לתפקיד service_role חסר EXECUTE. ההרשאה הזו אמורה להישמר.',
        v_sig
        using errcode = 'P0101';
    end if;

    v_verified := v_verified + 1;
  end loop;

  if v_verified <> array_length(v_signatures, 1) then
    raise exception
      'הרשאות RPC (0009): אומתו % מתוך % פונקציות — הבדיקה לא הושלמה.',
      v_verified, array_length(v_signatures, 1)
      using errcode = 'P0102';
  end if;

  -- ה-view נבדק בנפרד: הוא אינו פונקציה, ולכן שומר ה-RPC אינו מכסה אותו.
  if has_table_privilege('anon', 'public.customer_crm_metrics', 'SELECT')
     or has_table_privilege('authenticated', 'public.customer_crm_metrics', 'SELECT') then
    raise exception
      'הרשאות (0009): customer_crm_metrics עדיין קריא ל-anon או ל-authenticated.'
      using errcode = 'P0100';
  end if;

  if not has_table_privilege('service_role', 'public.customer_crm_metrics', 'SELECT') then
    raise exception
      'הרשאות (0009): ל-service_role חסר SELECT על customer_crm_metrics.'
      using errcode = 'P0101';
  end if;

  raise notice
    'הרשאות 0009 אומתו: % פונקציות + view אחד. anon=false, authenticated=false, service_role=true.',
    v_verified;
end $$;


-- ============================================================================
-- אימות שהסכמה אכן נבנתה
-- ============================================================================

do $$
declare
  v_tables    integer;
  v_rls       integer;
  v_policies  integer;
  v_sources   integer;
  v_profiles  integer;
  v_customers integer;
  v_orphans   integer;
begin
  select count(*) into v_tables
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('customer_sources','customer_crm_profiles',
                       'customer_notes','customer_crm_activity');
  if v_tables <> 4 then
    raise exception '0009: נוצרו % מתוך 4 טבלאות ה-CRM.', v_tables using errcode = 'P0104';
  end if;

  select count(*) into v_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('customer_sources','customer_crm_profiles',
                      'customer_notes','customer_crm_activity')
    and c.relrowsecurity;
  if v_rls <> 4 then
    raise exception '0009: RLS מופעל על % מתוך 4 טבלאות ה-CRM.', v_rls using errcode = 'P0104';
  end if;

  -- אף policy ל-anon/authenticated. הטבלאות נגישות ל-service_role בלבד.
  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public'
    and tablename in ('customer_sources','customer_crm_profiles',
                      'customer_notes','customer_crm_activity');
  if v_policies <> 0 then
    raise exception '0009: נמצאו % policies על טבלאות ה-CRM — אמורות להיות אפס.',
      v_policies using errcode = 'P0104';
  end if;

  select count(*) into v_sources from public.customer_sources;
  if v_sources <> 10 then
    raise exception '0009: נטענו % מתוך 10 שורות customer_sources.', v_sources using errcode = 'P0104';
  end if;

  if not exists (select 1 from public.customer_sources where key = 'unknown' and is_active) then
    raise exception '0009: המקור unknown חסר או אינו active.' using errcode = 'P0104';
  end if;

  -- ה-backfill: לכל customer קיים יש בדיוק פרופיל CRM אחד.
  select count(*) into v_customers from public.customers;
  select count(*) into v_profiles  from public.customer_crm_profiles;
  if v_profiles <> v_customers then
    raise exception '0009: % פרופילי CRM מול % לקוחות — ה-backfill לא הושלם.',
      v_profiles, v_customers using errcode = 'P0104';
  end if;

  -- ה-backfill אינו מזייף פעולה ניהולית: אין activity ואין actor.
  select count(*) into v_orphans
  from public.customer_crm_profiles
  where crm_status_changed_by is not null or source_changed_by is not null;
  if v_orphans <> 0 then
    raise exception '0009: % פרופילים נושאים actor אף שאיש לא ביצע שינוי ידני.',
      v_orphans using errcode = 'P0104';
  end if;

  if exists (select 1 from public.customer_crm_profiles where source_key <> 'unknown') then
    raise exception '0009: ה-backfill קבע מקור הגעה שאינו unknown.' using errcode = 'P0104';
  end if;

  raise notice
    '0009 אומתה: 4 טבלאות + view, RLS מופעל, 0 policies, 10 מקורות, % פרופילים ב-backfill.',
    v_profiles;
end $$;
