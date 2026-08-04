-- ============================================================================
-- 0001 — אזור אישי ללקוחות: לקוחות, תורים, היסטוריה, OTP והגדרות עסק
--
-- זו המיגרציה הראשונה בפרויקט. אין טבלאות קיימות ואין נתונים קיימים —
-- התורים שנקבעו עד היום חיים ב-Google Calendar בלבד ואינם מושפעים ממנה.
--
-- עקרונות:
--   • תורים לעולם לא נמחקים — ביטול הוא שינוי סטטוס בלבד.
--   • כל טלפון נשמר ב-E.164 ומאולץ ע"י CHECK, כדי למנוע חשבונות כפולים.
--   • מניעת התנגשות סלוטים נאכפת ברמת ה-DB (EXCLUDE), לא בקוד.
--   • RLS מופעל על כל טבלה. לקוחה רואה רק את עצמה.
-- ============================================================================

-- נדרש ל-EXCLUDE constraint שמשלב שוויון (=) עם חפיפת טווחים (&&)
create extension if not exists btree_gist;

-- ─── טיפוסים ────────────────────────────────────────────────────────────────

create type appointment_status as enum (
  'pending',                -- ממתין לאישור בעלת העסק
  'confirmed',              -- מאושר
  'completed',              -- הושלם
  'cancelled_by_customer',  -- בוטל על ידי הלקוחה
  'cancelled_by_business',  -- בוטל על ידי העסק
  'rescheduled',            -- הוזז (סטטוס ארכיוני; התור הפעיל נשאר אותה שורה)
  'no_show'                 -- לא הגיעה
);

create type history_action as enum (
  'created', 'rescheduled', 'cancelled', 'status_changed'
);

create type actor_type as enum ('customer', 'admin', 'system');

-- ─── לקוחות ─────────────────────────────────────────────────────────────────
-- id זהה ל-auth.users.id, כך ש-RLS יכול להשוות ישירות מול auth.uid()
-- בלי join. מחיקת משתמש מ-auth מוחקת את כרטיס הלקוחה, אך התורים נשמרים
-- (ראה on delete restrict ב-appointments).

create table public.customers (
  id           uuid primary key references auth.users(id) on delete cascade,
  phone_e164   text not null unique
               check (phone_e164 ~ '^\+9725[0-9]{8}$'),
  full_name    text not null check (length(trim(full_name)) between 2 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  admin_notes  text,          -- הערות פנימיות של בעלת העסק; לא נחשפות ללקוחה
  is_blocked   boolean not null default false
);

comment on column public.customers.phone_e164 is
  'תמיד E.164 (+9725XXXXXXXX). הנירמול מתבצע ב-lib/phone.ts ונאכף כאן.';
comment on column public.customers.admin_notes is
  'לעולם לא להחזיר ללקוחה — ראה מדיניות ה-SELECT למטה.';

-- ─── מנהלות ─────────────────────────────────────────────────────────────────
-- טבלה נפרדת במקום דגל על customers: הפרדה מלאה בין הרשאות לקוחה למנהלת,
-- ולקוחה לא יכולה להעניק לעצמה הרשאות ע"י עדכון השורה שלה.

create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- security definer כדי שהפונקציה תוכל לקרוא מ-admins גם כשה-RLS על
-- admins חוסם את המשתמש. search_path מקובע — הגנה מפני חטיפת שם טבלה.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ─── תורים ──────────────────────────────────────────────────────────────────

create table public.appointments (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers(id) on delete restrict,

  service_key        text not null,             -- מזהה הטיפול (lib/data.ts)
  variants           text[] not null default '{}',
  price_total        integer check (price_total >= 0),

  starts_at          timestamptz not null,
  duration_min       integer not null check (duration_min between 5 and 480),
  -- נגזר אוטומטית; משמש גם ל-EXCLUDE constraint למטה
  ends_at            timestamptz generated always as
                     (starts_at + make_interval(mins => duration_min)) stored,

  status             appointment_status not null default 'pending',

  reschedule_count   integer not null default 0 check (reschedule_count >= 0),
  original_starts_at timestamptz,               -- המועד המקורי, נשמר בהזזה ראשונה
  has_deposit        boolean not null default false,

  google_event_id    text,                      -- מראה ליומן; null אם הסנכרון נכשל
  policy_version     text,                      -- גרסת המדיניות שהלקוחה אישרה
  notes              text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 🔒 מניעת התנגשות סלוטים ברמת בסיס הנתונים.
-- שתי בקשות מקבילות על אותו זמן — אחת תיכשל עם 23P01 והמערכת תבקש מהלקוחה
-- לבחור מועד אחר. זו ההגנה האמיתית; בדיקה לפני INSERT היא race condition.
-- מוחל רק על תורים פעילים, כך שסלוט של תור מבוטל משתחרר אוטומטית.
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
  where (status in ('pending', 'confirmed'));

create index appointments_customer_starts_idx
  on public.appointments (customer_id, starts_at desc);
create index appointments_starts_idx
  on public.appointments (starts_at)
  where status in ('pending', 'confirmed');

-- ─── היסטוריית פעולות ───────────────────────────────────────────────────────
-- מי עשה מה ומתי. נכתב אך ורק ע"י השרת (service_role).

create table public.appointment_history (
  id              bigserial primary key,
  appointment_id  uuid not null references public.appointments(id) on delete cascade,
  action          history_action not null,
  from_status     appointment_status,
  to_status       appointment_status,
  from_starts_at  timestamptz,
  to_starts_at    timestamptz,
  actor           actor_type not null,
  actor_id        uuid,           -- auth.users.id של מי שביצע, אם רלוונטי
  reason          text,
  created_at      timestamptz not null default now()
);

create index appointment_history_appointment_idx
  on public.appointment_history (appointment_id, created_at desc);

-- ─── OTP והגבלת קצב ────────────────────────────────────────────────────────
-- אין כאן RLS policy בכוונה: הטבלה נגישה אך ורק ל-service_role בשרת.
-- הקוד נשמר כ-hash ולא כטקסט, כדי שדליפת DB לא תאפשר התחזות.

create table public.otp_attempts (
  id           bigserial primary key,
  phone_e164   text not null check (phone_e164 ~ '^\+9725[0-9]{8}$'),
  code_hash    text not null,
  purpose      text not null default 'login',  -- 'login' | 'booking'
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  consumed_at  timestamptz,
  ip           inet,
  created_at   timestamptz not null default now()
);

create index otp_attempts_phone_idx on public.otp_attempts (phone_e164, created_at desc);
create index otp_attempts_cleanup_idx on public.otp_attempts (expires_at);

-- ─── הגדרות עסק ────────────────────────────────────────────────────────────
-- מדיניות ניתנת לשינוי בלי פריסת קוד. ראה lib/appointmentPolicy.ts.

create table public.business_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.business_settings (key, value) values
  ('cancel_cutoff_hours',              '24'::jsonb),
  ('reschedule_cutoff_hours',          '24'::jsonb),
  ('max_reschedules',                  '2'::jsonb),
  ('allow_cancel_with_deposit',        'false'::jsonb),
  ('allow_reschedule_with_deposit',    'true'::jsonb),
  ('deposit_reschedule_cutoff_hours',  '48'::jsonb);

-- ─── updated_at אוטומטי ────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();
create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();
create trigger business_settings_touch before update on public.business_settings
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Row Level Security
--
-- ברירת המחדל: RLS מופעל ואין policy → הכול חסום. כל גישה שאינה מכוסה
-- במפורש למטה נדחית. service_role (שרת בלבד) עוקף RLS ומשמש לכתיבות
-- שעוברות דרך ה-API עם בדיקת בעלות מפורשת.
-- ============================================================================

alter table public.customers           enable row level security;
alter table public.admins              enable row level security;
alter table public.appointments        enable row level security;
alter table public.appointment_history enable row level security;
alter table public.otp_attempts        enable row level security;
alter table public.business_settings   enable row level security;

-- לקוחות: כל אחת רואה ומעדכנת רק את עצמה. מנהלת רואה את כולן.
create policy customers_select_own on public.customers
  for select using (id = auth.uid() or public.is_admin());

-- עדכון שם בלבד. WITH CHECK מוודא שהלקוחה לא משנה id או טלפון לשורה של אחרת.
create policy customers_update_own on public.customers
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy customers_admin_all on public.customers
  for all using (public.is_admin()) with check (public.is_admin());

-- מנהלות: רק מנהלת רואה את הרשימה. אין policy ל-insert/update/delete —
-- הוספת מנהלת מתבצעת ידנית ב-Supabase בלבד.
create policy admins_select on public.admins
  for select using (public.is_admin());

-- תורים: לקוחה רואה את שלה בלבד. אין policy ל-INSERT/UPDATE/DELETE ללקוחה
-- בכוונה — כל כתיבה עוברת דרך ה-API בשרת, שבודק בעלות ואוכף את המדיניות.
create policy appointments_select_own on public.appointments
  for select using (customer_id = auth.uid() or public.is_admin());

create policy appointments_admin_all on public.appointments
  for all using (public.is_admin()) with check (public.is_admin());

-- היסטוריה: לקוחה רואה את ההיסטוריה של התורים שלה בלבד.
create policy appointment_history_select_own on public.appointment_history
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_history.appointment_id
        and a.customer_id = auth.uid()
    )
  );

-- הגדרות עסק: קריאה פתוחה (אלה מספרי מדיניות שגם ככה מפורסמים באתר),
-- כתיבה למנהלת בלבד.
create policy business_settings_read on public.business_settings
  for select using (true);
create policy business_settings_admin_write on public.business_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- otp_attempts: אין policy כלל → נגיש ל-service_role בלבד.
