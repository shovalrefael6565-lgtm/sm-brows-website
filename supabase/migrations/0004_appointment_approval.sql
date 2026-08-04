-- ============================================================================
-- 0004 — שלב 6: אישור ודחיית בקשות תור מתוך מערכת הניהול
--
-- תלוי ב-0001–0003 שכבר רצו. אין כאן שום ALTER/DROP על מה שנוצר שם —
-- רק עמודות חדשות ב-appointments וחמש פונקציות RPC חדשות: אישור/דחייה,
-- ושלוש לניהול ה-state machine של סנכרון היומן (claim/complete/fail).
--
-- ⚠️ google_event_id כבר קיים מ-0001 (עמודה בודדת, ללא מעקב מצב). כאן
-- מתווסף מעקב מצב מלא לסנכרון מול Google Calendar, כי בניגוד ל-DB,
-- Calendar היא מערכת חיצונית ללא transaction משותפת — צריך state machine
-- מפורש כדי שניסיון חוזר לעולם לא ייצור אירוע כפול (ראה lib/googleCalendar.ts
-- ו-lib/appointmentApproval.ts לפרטי המימוש).
-- ============================================================================

-- ─── מעקב סנכרון יומן ───────────────────────────────────────────────────────

create type calendar_sync_status as enum (
  'not_applicable',  -- pending/cancelled/expired — עוד לא אושר, אין מה לסנכרן
  'pending',         -- אושר, ממתין לניסיון סנכרון ראשון
  'syncing',         -- claim פעיל — יש lease (calendar_sync_started_at) שמונע כפילות
  'synced',          -- google_event_id תקף ונשמר
  'failed'           -- ניסיון סנכרון נכשל; ניתן לנסות שוב
);

alter table public.appointments
  add column calendar_sync_status     calendar_sync_status not null default 'not_applicable',
  add column calendar_sync_error      text,
  add column calendar_sync_started_at timestamptz,
  add column calendar_synced_at       timestamptz,
  add column calendar_sync_attempt_count integer not null default 0 check (calendar_sync_attempt_count >= 0);

comment on column public.appointments.calendar_sync_error is
  'הודעת שגיאה מסוננת בלבד (err.message, מקוצר) — לעולם לא JSON מלא של תגובת API, tokens או פרטי אימות.';
comment on column public.appointments.calendar_sync_started_at is
  'זמן תחילת ה-claim הנוכחי (''syncing''). null כשאין claim פעיל. משמש כ-lease: claim תקוע יותר מ-2 דקות נחשב לא תקף וניתן לתפוס מחדש.';

-- ─── אישור בקשת pending ─────────────────────────────────────────────────────
-- אטומי ו-idempotent: רק שורה שעדיין pending ולא פגה תיתפס. לחיצה כפולה /
-- בקשה מקבילה שנייה מקבלת אפס שורות ומטופלת באפליקציה כ-"כבר טופלה".
-- אין כאן שום אינטראקציה עם Google Calendar — זה קורה אח"כ באפליקציה
-- (ensureCalendarSynced), כדי שבדיקת ההתנגשות מול היומן תתבצע *לפני*
-- הקריאה הזו (ראה app/api/admin/appointments/[id]/approve/route.ts).
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
      calendar_sync_status = 'pending'
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

-- ─── דחיית בקשת pending ─────────────────────────────────────────────────────
-- אין enum ייעודי ל-"rejected" — cancelled_by_business הוא המתאים ביותר
-- מבין הערכים הקיימים (0001). אין כאן שום אינטראקציה עם Calendar.
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
  set status = 'cancelled_by_business'
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
    v_row.id, 'cancelled', 'pending', 'cancelled_by_business', 'admin', p_admin_id
  );

  return v_row;
end;
$$;

-- ─── סנכרון יומן: claim / complete / fail ──────────────────────────────────
-- שלוש פונקציות שמנהלות את ה-state machine של calendar_sync_status. כל אחת
-- UPDATE יחיד אטומי מטבעו ב-Postgres, אבל ה-RPC (ולא קריאה ישירה מה-JS)
-- מבטיח שתנאי ה-WHERE (כולל אריתמטיקת interval ל-lease וההגדלה של
-- attempt_count) נשארים קרובים לנתונים ובטוחים מפני race — לא string
-- filters שבירים בצד הלקוח.
--
-- claim: 'pending'/'failed' → 'syncing', או 'syncing' שה-lease שלו (2 דקות)
-- פג — כך שסנכרון שנתקע (השרת קרס, בקשה נפלה) ניתן לתפיסה מחדש בלי
-- להישאר חסום לנצח. status חייב להיות 'confirmed' — אין סנכרון יומן
-- לבקשה שעדיין pending.
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
    and status = 'confirmed'
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

-- complete/fail דורשים calendar_sync_status = 'syncing' — כלומר רק מי
-- שהחזיק את ה-claim הנוכחי יכול לסגור אותו. claim ישן שפג וכבר נתפס
-- מחדש ע"י ניסיון אחר (claim_calendar_sync) לא ייסגר בטעות ע"י התהליך הישן.
create or replace function public.complete_calendar_sync(
  p_appointment_id   uuid,
  p_google_event_id  text
) returns public.appointments
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  update public.appointments
  set calendar_sync_status = 'synced',
      calendar_synced_at = now(),
      calendar_sync_started_at = null,
      calendar_sync_error = null,
      google_event_id = p_google_event_id
  where id = p_appointment_id
    and calendar_sync_status = 'syncing'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_SYNCING' using errcode = 'P0005';
  end if;

  return v_row;
end;
$$;

create or replace function public.fail_calendar_sync(
  p_appointment_id uuid,
  p_error          text
) returns public.appointments
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  update public.appointments
  set calendar_sync_status = 'failed',
      calendar_sync_started_at = null,
      calendar_sync_error = left(p_error, 300)
  where id = p_appointment_id
    and calendar_sync_status = 'syncing'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_SYNCING' using errcode = 'P0005';
  end if;

  return v_row;
end;
$$;

-- ─── הרשאות ────────────────────────────────────────────────────────────────
-- אותו דפוס כמו 0003: PostgREST חושף כל פונקציה כ-RPC לכל תפקיד כברירת
-- מחדל. כל הפונקציות למעלה סומכות על כך שהקורא כבר עבר
-- requireAdminPage/isAdmin בשרת — must be service_role בלבד.
revoke execute on function public.approve_pending_appointment(uuid, uuid) from public;
revoke execute on function public.reject_pending_appointment(uuid, uuid) from public;
revoke execute on function public.claim_calendar_sync(uuid) from public;
revoke execute on function public.complete_calendar_sync(uuid, text) from public;
revoke execute on function public.fail_calendar_sync(uuid, text) from public;

grant execute on function public.approve_pending_appointment(uuid, uuid) to service_role;
grant execute on function public.reject_pending_appointment(uuid, uuid) to service_role;
grant execute on function public.claim_calendar_sync(uuid) to service_role;
grant execute on function public.complete_calendar_sync(uuid, text) to service_role;
grant execute on function public.fail_calendar_sync(uuid, text) to service_role;
