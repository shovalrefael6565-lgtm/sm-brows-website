-- ============================================================================
-- 0005 — שלב 7: שינוי מועד וביטול תור מאושר ע"י הלקוחה מתוך האזור האישי
--
-- תלוי ב-0001–0004 שכבר רצו. אין כאן שום ALTER/DROP על מה שנוצר שם —
-- רק טיפוס חדש, עמודה חדשה, ושלוש פונקציות חדשות. שתי פונקציות קיימות
-- מוגדרות מחדש ב-create or replace (claim_calendar_sync,
-- approve_pending_appointment) בלי לשנות חתימה.
--
-- ⚠️ אין כאן ALTER TYPE ... ADD VALUE — ולכן, בניגוד ל-0002/0003, אין צורך
-- לפצל את הקובץ. הערכים הדרושים כבר קיימים: history_action מכיל
-- 'rescheduled' ו-'cancelled' מ-0001, ו-appointment_status מכיל
-- 'cancelled_by_customer' מ-0001. calendar_sync_operation למטה הוא טיפוס
-- *חדש* (CREATE TYPE), שמותר להשתמש בו מיד באותה טרנזקציה.
--
-- שני עקרונות שחוזרים בכל הפונקציות כאן:
--   • הבעלות, הסטטוס והמדיניות נבדקים בתוך אותה טרנזקציה כמו הכתיבה,
--     אחרי SELECT ... FOR UPDATE — אין חלון race בין בדיקה לעדכון.
--   • המדיניות נקראת מ-business_settings, לא מקבועים בקוד. key חסר או
--     ערך לא תקין נופל לברירת מחדל *לאותו key בלבד* (זהה ל-DEFAULT_POLICY
--     ב-lib/appointmentPolicy.ts). כשל בעצם הקריאה לטבלה מפיל את
--     הטרנזקציה — fail-closed, לא "מדיניות ברירת מחדל בשקט".
-- ============================================================================

-- ─── פעולת הסנכרון הנדרשת ליומן ─────────────────────────────────────────────
-- calendar_sync_status אומר *באיזה שלב* הסנכרון נמצא; הטיפוס הזה אומר *מה*
-- צריך לעשות. בלעדיו, retry ניהולי היה צריך לנחש לפי status של התור — וזה
-- שביר: 'cancelled_by_customer' יכול להגיע גם ממסלול pending שמעולם לא היה
-- לו אירוע ביומן. calendar_sync_operation הוא מקור האמת לפעולה.
create type calendar_sync_operation as enum (
  'upsert',  -- ליצור או לעדכן את אירוע היומן
  'delete'   -- למחוק את אירוע היומן
);

alter table public.appointments
  add column calendar_sync_operation calendar_sync_operation not null default 'upsert';

comment on column public.appointments.calendar_sync_operation is
  'מה הסנכרון הבא אמור לעשות ביומן. מקור האמת לפעולה — אין לנחש אותה מתוך status של התור.';

-- ─── קריאת מדיניות מ-business_settings ──────────────────────────────────────
-- עוזר פנימי: מחזיר ערך numeric מ-business_settings, או את ברירת המחדל אם
-- ה-key חסר או שהערך אינו ניתן להמרה. ברירת המחדל חלה על אותו key בלבד.
create or replace function public.setting_numeric(
  p_key     text,
  p_default numeric
) returns numeric
language plpgsql
stable
as $$
declare
  v_text text;
begin
  select value #>> '{}' into v_text from public.business_settings where key = p_key;
  if v_text is null then return p_default; end if;
  begin
    return v_text::numeric;
  exception when others then
    return p_default;
  end;
end;
$$;

create or replace function public.setting_boolean(
  p_key     text,
  p_default boolean
) returns boolean
language plpgsql
stable
as $$
declare
  v_text text;
begin
  select value #>> '{}' into v_text from public.business_settings where key = p_key;
  if v_text is null then return p_default; end if;
  begin
    return v_text::boolean;
  exception when others then
    return p_default;
  end;
end;
$$;

-- ─── שינוי מועד ע"י הלקוחה ──────────────────────────────────────────────────
--
-- מחזירה jsonb ולא public.appointments (בשונה מ-0003/0004), כי חוץ מהשורה
-- צריך להחזיר גם *מה קרה*: הצלחה אמיתית, "לא נבחר מועד חדש", או התאוששות
-- מבקשה קודמת שכבר הצליחה. שלושת המצבים נראים זהים בשורה עצמה, ורק
-- ההבחנה ביניהם מאפשרת גם idempotency אמיתי וגם הודעה נכונה ללקוחה.
--
-- outcome:
--   'applied'         — המועד הוזז עכשיו (היחיד שכותב היסטוריה ומגדיל מונה)
--   'no_change'       — הלקוחה בחרה בדיוק את המועד הקיים; אפס כתיבות
--   'already_applied' — התור כבר במועד המבוקש מבקשה קודמת שהצליחה; אפס כתיבות
--
-- p_expected_starts_at הוא המועד שהלקוחה ראתה על המסך כשפתחה את הדיאלוג.
-- הוא משמש *אך ורק* כדי להבחין בין שני המקרים חסרי-הכתיבה — לעולם לא
-- כהרשאה ולא כמקור לנתוני התור. כל שדות התור נטענים כאן מה-DB.
create or replace function public.reschedule_appointment_by_customer(
  p_appointment_id     uuid,
  p_customer_id        uuid,
  p_new_starts_at      timestamptz,
  p_expected_starts_at timestamptz default null
) returns jsonb
language plpgsql
as $$
declare
  v_row            public.appointments;
  v_old_starts_at  timestamptz;
  v_cutoff_hours   numeric;
  v_max_reschedule integer;
begin
  select * into v_row
    from public.appointments
    where id = p_appointment_id and customer_id = p_customer_id
    for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- התור כבר במועד המבוקש: אפס כתיבות בכל מקרה. ההבחנה היא רק בנוסח —
  -- reschedule_count>0 יחד עם מועד-מוצג ששונה מהיעד מעידים שהבקשה
  -- הקודמת של אותה לקוחה כבר הצליחה (timeout / לחיצה כפולה).
  if v_row.starts_at = p_new_starts_at then
    if v_row.reschedule_count > 0
       and p_expected_starts_at is not null
       and p_expected_starts_at <> p_new_starts_at then
      return jsonb_build_object('outcome', 'already_applied', 'appointment', to_jsonb(v_row));
    end if;
    return jsonb_build_object('outcome', 'no_change', 'appointment', to_jsonb(v_row));
  end if;

  if v_row.status <> 'confirmed' then
    raise exception 'NOT_RESCHEDULABLE' using errcode = 'P0006';
  end if;

  -- פעולת סנכרון פעילה (lease חי) — לא נוגעים בתור תחתיה
  if v_row.calendar_sync_status = 'syncing'
     and v_row.calendar_sync_started_at is not null
     and v_row.calendar_sync_started_at > now() - interval '2 minutes' then
    raise exception 'SYNC_IN_PROGRESS' using errcode = 'P0007';
  end if;

  if v_row.starts_at <= now() then
    raise exception 'IN_PAST' using errcode = 'P0008';
  end if;

  if p_new_starts_at <= now() then
    raise exception 'NEW_IN_PAST' using errcode = 'P0008';
  end if;

  v_max_reschedule := public.setting_numeric('max_reschedules', 2)::integer;
  if v_row.reschedule_count >= v_max_reschedule then
    raise exception 'MAX_RESCHEDULES' using errcode = 'P0009';
  end if;

  if v_row.has_deposit then
    if not public.setting_boolean('allow_reschedule_with_deposit', true) then
      raise exception 'DEPOSIT_LOCKED' using errcode = 'P0010';
    end if;
    v_cutoff_hours := public.setting_numeric('deposit_reschedule_cutoff_hours', 48);
  else
    v_cutoff_hours := public.setting_numeric('reschedule_cutoff_hours', 24);
  end if;

  if v_row.starts_at < now() + (v_cutoff_hours * interval '1 hour') then
    raise exception 'TOO_LATE' using errcode = 'P0011';
  end if;

  v_old_starts_at := v_row.starts_at;

  -- ends_at נכתב מחדש ע"י הטריגר appointments_set_end (BEFORE UPDATE),
  -- ולכן ה-EXCLUDE constraint appointments_no_overlap נבדק על הטווח החדש
  -- ומחזיר 23P01 אם לקוחה אחרת תפסה את הסלוט בינתיים. זו ההגנה האמיתית
  -- מפני התנגשות — לא בדיקה מוקדמת באפליקציה.
  --
  -- הטיפול, המחיר והמשך לא נגועים בכוונה: שינוי טיפול אינו בהיקף השלב.
  update public.appointments
  set starts_at                = p_new_starts_at,
      reschedule_count         = reschedule_count + 1,
      original_starts_at       = coalesce(original_starts_at, v_old_starts_at),
      calendar_sync_operation  = 'upsert',
      calendar_sync_status     = 'pending',
      calendar_sync_started_at = null
  where id = p_appointment_id
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, to_starts_at, actor, actor_id
  ) values (
    v_row.id, 'rescheduled', 'confirmed', 'confirmed',
    v_old_starts_at, p_new_starts_at, 'customer', p_customer_id
  );

  return jsonb_build_object('outcome', 'applied', 'appointment', to_jsonb(v_row));
end;
$$;

-- ─── ביטול תור confirmed ע"י הלקוחה ─────────────────────────────────────────
--
-- outcome: 'applied' | 'already_cancelled' (השני = לחיצה חוזרת; אפס כתיבות).
--
-- ⚠️ calendar_sync_status נקבע ל-'pending' תמיד, גם כש-google_event_id ריק.
-- ערך ריק אינו מוכיח שאין אירוע ביומן: ייתכן שהאירוע נוצר בהצלחה עם המזהה
-- הדטרמיניסטי ורק שמירת המזהה ב-Supabase נכשלה (ראה תרחיש 1 בשלב 6).
-- deleteAppointmentEvent מחפש גם לפי המזהה הדטרמיניסטי ומאמת בעלות.
create or replace function public.cancel_confirmed_appointment_by_customer(
  p_appointment_id uuid,
  p_customer_id    uuid
) returns jsonb
language plpgsql
as $$
declare
  v_row          public.appointments;
  v_cutoff_hours numeric;
begin
  select * into v_row
    from public.appointments
    where id = p_appointment_id and customer_id = p_customer_id
    for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- לחיצה חוזרת / בקשה שאבדה: הסטטוס כבר סופי. לא כותבים היסטוריה שנייה,
  -- והקורא ממשיך למסלול הסנכרון (המחיקה עצמה idempotent).
  if v_row.status = 'cancelled_by_customer' then
    return jsonb_build_object('outcome', 'already_cancelled', 'appointment', to_jsonb(v_row));
  end if;

  if v_row.status <> 'confirmed' then
    raise exception 'NOT_CANCELLABLE' using errcode = 'P0006';
  end if;

  if v_row.calendar_sync_status = 'syncing'
     and v_row.calendar_sync_started_at is not null
     and v_row.calendar_sync_started_at > now() - interval '2 minutes' then
    raise exception 'SYNC_IN_PROGRESS' using errcode = 'P0007';
  end if;

  if v_row.starts_at <= now() then
    raise exception 'IN_PAST' using errcode = 'P0008';
  end if;

  if v_row.has_deposit and not public.setting_boolean('allow_cancel_with_deposit', false) then
    raise exception 'DEPOSIT_LOCKED' using errcode = 'P0010';
  end if;

  v_cutoff_hours := public.setting_numeric('cancel_cutoff_hours', 24);
  if v_row.starts_at < now() + (v_cutoff_hours * interval '1 hour') then
    raise exception 'TOO_LATE' using errcode = 'P0011';
  end if;

  -- התור לא נמחק — רק משנה סטטוס. הסלוט משתחרר מיד, כי ה-EXCLUDE
  -- constraint חל רק על status in ('pending','confirmed').
  update public.appointments
  set status                   = 'cancelled_by_customer',
      calendar_sync_operation  = 'delete',
      calendar_sync_status     = 'pending',
      calendar_sync_started_at = null
  where id = p_appointment_id
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, actor, actor_id
  ) values (
    v_row.id, 'cancelled', 'confirmed', 'cancelled_by_customer',
    v_row.starts_at, 'customer', p_customer_id
  );

  return jsonb_build_object('outcome', 'applied', 'appointment', to_jsonb(v_row));
end;
$$;

-- ─── סגירת claim של מחיקה ───────────────────────────────────────────────────
-- מקבילה ל-complete_calendar_sync, אבל בלי google_event_id: במחיקה אין מזהה
-- חדש לשמור. המזהה הישן *נשאר* בשורה בכוונה — הוא תיעוד של מה נמחק, והתור
-- כבר cancelled ולכן לעולם לא יסונכרן שוב כ-upsert.
create or replace function public.complete_calendar_delete(
  p_appointment_id uuid
) returns public.appointments
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  update public.appointments
  set calendar_sync_status     = 'synced',
      calendar_synced_at       = now(),
      calendar_sync_started_at = null,
      calendar_sync_error      = null
  where id = p_appointment_id
    and calendar_sync_status = 'syncing'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_SYNCING' using errcode = 'P0005';
  end if;

  return v_row;
end;
$$;

-- ─── claim: עכשיו גם למחיקה ─────────────────────────────────────────────────
-- הגרסה ב-0004 דרשה status = 'confirmed', ולכן חסמה לגמרי claim על תור
-- שבוטל וממתין למחיקת האירוע. הזוג (status, calendar_sync_operation) הוא
-- שקובע כעת מה מותר. שאר ההתנהגות — כולל ה-lease של 2 דקות ומונה
-- הניסיונות — נשארת מילה במילה כפי שהייתה.
create or replace function public.claim_calendar_sync(
  p_appointment_id uuid
) returns public.appointments
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  update public.appointments
  set calendar_sync_status = 'syncing',
      calendar_sync_started_at = now(),
      calendar_sync_attempt_count = calendar_sync_attempt_count + 1
  where id = p_appointment_id
    and (
      (status = 'confirmed' and calendar_sync_operation = 'upsert')
      or (status = 'cancelled_by_customer' and calendar_sync_operation = 'delete')
    )
    and (
      calendar_sync_status in ('pending', 'failed')
      or (calendar_sync_status = 'syncing' and calendar_sync_started_at < now() - interval '2 minutes')
    )
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_CLAIMABLE' using errcode = 'P0004';
  end if;

  return v_row;
end;
$$;

-- ─── אישור בקשה: קביעת פעולת הסנכרון במפורש ────────────────────────────────
-- זהה ל-0004 פרט לשורה אחת: calendar_sync_operation = 'upsert'. ברירת
-- המחדל של העמודה כבר נותנת את זה, אבל מוטב מפורש מאשר להישען עליה.
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
    and (pending_expires_at is null or pending_expires_at > now())
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

-- ─── הרשאות ────────────────────────────────────────────────────────────────
-- אותו דפוס כמו 0003/0004: PostgREST חושף כל פונקציה כ-RPC לכל תפקיד
-- כברירת מחדל. הפונקציות כאן מקבלות customer_id כפרמטר וסומכות על כך
-- שהקורא כבר אימת session ובעלות — must be service_role בלבד.
revoke execute on function public.setting_numeric(text, numeric) from public;
revoke execute on function public.setting_boolean(text, boolean) from public;
revoke execute on function public.reschedule_appointment_by_customer(uuid, uuid, timestamptz, timestamptz) from public;
revoke execute on function public.cancel_confirmed_appointment_by_customer(uuid, uuid) from public;
revoke execute on function public.complete_calendar_delete(uuid) from public;

grant execute on function public.setting_numeric(text, numeric) to service_role;
grant execute on function public.setting_boolean(text, boolean) to service_role;
grant execute on function public.reschedule_appointment_by_customer(uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.cancel_confirmed_appointment_by_customer(uuid, uuid) to service_role;
grant execute on function public.complete_calendar_delete(uuid) to service_role;
