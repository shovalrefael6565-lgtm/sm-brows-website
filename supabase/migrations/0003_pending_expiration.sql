-- ============================================================================
-- 0003 — תפוגת בקשות pending, הגבלת תפיסת סלוטים, ביטול ע"י הלקוחה
--
-- ⚠️ תלוי ב-0002_pending_expiration_enum_values.sql שכבר רץ ו-commit
-- (ראה ההסבר שם). 0001 כבר רץ בפרויקט Supabase האמיתי — קובץ זה, כמו 0002,
-- הוא migration חדש בלבד, ואין בו שום ALTER/DROP על מה שנוצר שם.
--
-- הבעיה שקובץ זה פותר: בקשת pending חסמה סלוט ללא הגבלת זמן, וה-EXCLUDE
-- constraint שנוסף ב-0001 (appointments_no_overlap) בודק סטטוס, לא זמן —
-- כלומר בקשת pending ישנה הייתה ממשיכה לחסום INSERT חדש גם אחרי שהיא
-- אמורה הייתה "לפוג", אלא אם התפוגה עצמה משנה את הסטטוס שלה קודם, באותה
-- טרנזקציה כמו ניסיון ה-INSERT. לכן שלוש הפונקציות למטה, ולא בדיקה ב-JS.
-- ============================================================================

-- ─── מועד תפוגה לכל בקשת pending ──────────────────────────────────────────
-- null עבור שורות שנוצרו לפני 0003 (לא יפוגו אף פעם — לא ניגע בעבר).
alter table public.appointments
  add column pending_expires_at timestamptz;

create index appointments_pending_expiry_idx
  on public.appointments (pending_expires_at)
  where status = 'pending';

-- ─── הגדרות עסק חדשות ──────────────────────────────────────────────────────
-- ניתנות לשינוי בלוח הבקרה של Supabase, בלי migration נוסף.
insert into public.business_settings (key, value) values
  ('pending_expiration_hours',         '12'::jsonb),
  ('max_active_pending_per_customer',  '2'::jsonb);

-- ─── תפוגה: מסמנת pending שפג תוקפו כ-expired + היסטוריה ──────────────────
-- לא מוחקת אף שורה. אינה נוגעת בתורים confirmed — התנאי כאן הוא
-- status = 'pending' בלבד, ולכן confirmed לעולם לא יכול לפוג דרך פונקציה זו.
create or replace function public.expire_stale_pending_appointments()
returns void
language plpgsql
as $$
begin
  with expired as (
    update public.appointments
    set status = 'expired'
    where status = 'pending'
      and pending_expires_at is not null
      and pending_expires_at <= now()
    returning id
  )
  insert into public.appointment_history (appointment_id, action, from_status, to_status, actor)
  select id, 'expired', 'pending', 'expired', 'system' from expired;
end;
$$;

-- ─── יצירת בקשת pending: תפוגה ואז INSERT באותה טרנזקציה ──────────────────
-- קריאה אחת מהאפליקציה (supabase.rpc) = טרנזקציה אחת מרומזת, כך שאי אפשר
-- לקבל מצב ביניים שבו התפוגה רצה בלי שה-INSERT מנסה אחריה, או להפך.
-- ה-EXCLUDE constraint הקיים (appointments_no_overlap) עדיין נבדק ע"י
-- Postgres בזמן ה-INSERT כרגיל — הפונקציה לא עוקפת אותו, רק מוודאת
-- שבקשות שכבר פגו לא יעצרו אותו בטעות.
create or replace function public.create_pending_appointment(
  p_customer_id   uuid,
  p_service_key   text,
  p_variants      text[],
  p_price_total   integer,
  p_starts_at     timestamptz,
  p_duration_min  integer,
  p_notes         text,
  p_policy_version text
) returns public.appointments
language plpgsql
as $$
declare
  v_expiry_hours numeric;
  v_max_pending  integer;
  v_active_count integer;
  v_row          public.appointments;
begin
  perform public.expire_stale_pending_appointments();

  select (value #>> '{}')::integer into v_max_pending
    from public.business_settings where key = 'max_active_pending_per_customer';
  if v_max_pending is null then v_max_pending := 2; end if;

  select count(*) into v_active_count
    from public.appointments
    where customer_id = p_customer_id and status = 'pending';

  if v_active_count >= v_max_pending then
    raise exception 'PENDING_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  select (value #>> '{}')::numeric into v_expiry_hours
    from public.business_settings where key = 'pending_expiration_hours';
  if v_expiry_hours is null then v_expiry_hours := 12; end if;

  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status, pending_expires_at, notes, policy_version
  ) values (
    p_customer_id, p_service_key, p_variants, p_price_total,
    p_starts_at, p_duration_min, 'pending',
    now() + (v_expiry_hours * interval '1 hour'), p_notes, p_policy_version
  )
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, actor, actor_id
  ) values (
    v_row.id, 'created', null, 'pending', 'customer', p_customer_id
  );

  return v_row;
end;
$$;

-- ─── ביטול בקשת pending ע"י הלקוחה עצמה ────────────────────────────────────
-- הבעלות והסטטוס נבדקים בתוך ה-UPDATE עצמו (לא בשאילתת SELECT נפרדת
-- לפניו) — כך שאין חלון race שבו הסטטוס משתנה בין הבדיקה לעדכון.
create or replace function public.cancel_pending_appointment(
  p_appointment_id uuid,
  p_customer_id    uuid
) returns public.appointments
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  update public.appointments
  set status = 'cancelled_by_customer'
  where id = p_appointment_id
    and customer_id = p_customer_id
    and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, actor, actor_id
  ) values (
    v_row.id, 'cancelled', 'pending', 'cancelled_by_customer', 'customer', p_customer_id
  );

  return v_row;
end;
$$;

-- ─── הרשאות ────────────────────────────────────────────────────────────────
-- ברירת המחדל של Postgres: EXECUTE על פונקציה חדשה ניתן ל-PUBLIC, ו-
-- PostgREST חושף כל פונקציה כזו כ-RPC לכל תפקיד (כולל anon/authenticated).
-- שלוש הפונקציות למעלה מקבלות customer_id כפרמטר וסומכות על כך שהקורא
-- כבר אימת בעלות/סשן — לכן must be service_role בלבד, בדיוק כמו כל שאר
-- הכתיבות בפרויקט (ראה lib/supabase/admin.ts).
revoke execute on function public.expire_stale_pending_appointments() from public;
revoke execute on function public.create_pending_appointment(uuid, text, text[], integer, timestamptz, integer, text, text) from public;
revoke execute on function public.cancel_pending_appointment(uuid, uuid) from public;

grant execute on function public.expire_stale_pending_appointments() to service_role;
grant execute on function public.create_pending_appointment(uuid, text, text[], integer, timestamptz, integer, text, text) to service_role;
grant execute on function public.cancel_pending_appointment(uuid, uuid) to service_role;
