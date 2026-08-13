-- ============================================================================
-- 0029 — סיום תור אוטומטי + סימון אי-הגעה ע"י המנהלת
--
-- ═══ 🔒 מיגרציה תוספתית בלבד ═══
--
-- אין DROP, אין ALTER TYPE, אין ALTER TABLE ואין נגיעה בפונקציה קיימת.
-- שתי פונקציות חדשות בלבד. 'completed' ו-'no_show' כבר קיימים ב-
-- appointment_status מ-0001 — מעולם לא נכתבו בפועל עד כה.
--
-- ─── מה קורה כאן ────────────────────────────────────────────────────────────
--
--   complete_past_confirmed_appointments()  — confirmed שה-ends_at שלו עבר
--     הופך ל-completed. נקראת כ-sweep, בדיוק כמו expire_stale_pending_
--     appointments (0003): בלי cron משלה, נתלית על טריגר חיצוני קיים.
--
--   mark_appointment_no_show(appointment_id, admin_user_id) — המנהלת מסמנת
--     שהלקוחה לא הגיעה. עובד משני מצבים:
--       completed                              → no_show
--       confirmed וה-ends_at שלו עבר            → no_show (ישיר, בלי לעבור
--                                                 דרך completed — ה-sweep
--                                                 עלול פשוט לא הגיע לשורה
--                                                 הזו עדיין)
--     🔒 חסום כשה-ends_at עדיין בעתיד: אי-הגעה היא עובדה שאפשר לקבוע רק
--     אחרי שהתור אמור היה להתקיים.
--
-- ─── למה אין כאן שום התראה ──────────────────────────────────────────────────
--
-- enqueue_notifications_from_history (0025) היא allowlist מפורש שנופל
-- ל-`return null` על כל מה שאינו ברשימה שלו — וה-fallthrough הזה כבר
-- מתעד explicitly "וסימון completed/no_show — אינם מייצרים התראה" (0025,
-- סוף הפונקציה). שתי הפעולות כאן כותבות action='status_changed' עם
-- to_status ב-('completed','no_show'), צירוף שאינו תואם שום ענף בטריגר.
-- אין צורך בשום שינוי ב-0025 כדי להבטיח שקט — הוא כבר שקט מטבעו.
--
-- ─── actor='system' ──────────────────────────────────────────────────────────
--
-- ה-sweep כותב actor='system', actor_id=null — בדיוק כמו expire_stale_
-- pending_appointments. הסימון הידני של המנהלת כותב actor='admin' עם
-- ה-actor_id האמיתי, לאחר אימות מול admins (אותו דפוס בדיוק כמו 0027).
-- ============================================================================


-- ============================================================================
-- חלק 1 — סיום אוטומטי
--
-- ⚠️ לא מוחקת שום דבר ולא נוגעת בביטול/דחייה/תפוגה — התנאי היחיד הוא
-- status='confirmed' and ends_at<=now(), ולכן שאר הסטטוסים אינם נגועים.
--
-- 🔒 idempotent מעצם ה-WHERE: לאחר שהריצה הראשונה הופכת שורה ל-completed,
-- היא כבר לא תואמת status='confirmed' ולא תיתפס בריצה השנייה.
-- ============================================================================

create or replace function public.complete_past_confirmed_appointments()
returns void
language plpgsql
as $$
begin
  with done as (
    update public.appointments
    set status = 'completed'
    where status = 'confirmed'
      and ends_at <= now()
    returning id
  )
  insert into public.appointment_history (appointment_id, action, from_status, to_status, actor)
  select id, 'status_changed', 'confirmed', 'completed', 'system' from done;
end;
$$;

comment on function public.complete_past_confirmed_appointments() is
  '0029: confirmed שה-ends_at שלו עבר → completed. sweep, לא cron — נקראת מ-endpoint חיצוני קיים (ראה app/api/internal/reminders/route.ts) ומנקודות קריאה נוספות, בדיוק כמו expire_stale_pending_appointments.';


-- ============================================================================
-- חלק 2 — סימון אי-הגעה ע"י המנהלת
--
-- ─── סדר הבדיקות ─────────────────────────────────────────────────────────────
--
--   1. המנהלת אמיתית    — לפני נעילה, בדיוק כמו 0027.
--   2. FOR UPDATE        — מכאן והלאה אף אחד אחר לא נוגע בשורה.
--   3. כבר no_show       — יציאה idempotent לפני כל כתיבה.
--   4. completed         → זכאי.
--      confirmed + עבר   → זכאי (ישיר, ללא completed מדומה).
--      confirmed + עתיד  → 'not_ended': אסור לסמן אי-הגעה לפני שהתור הסתיים.
--      כל שאר הסטטוסים   → 'not_eligible'.
--
-- 🔒 בדיקה 3 לפני בדיקה 4 בכוונה, אותו טעם כמו ב-0027: לחיצה חוזרת על
-- תור שכבר סומן חייבת להחזיר 'already_no_show' ולא שגיאת "לא זכאי".
-- ============================================================================

create or replace function public.mark_appointment_no_show(
  p_appointment_id uuid,
  p_admin_user_id  uuid
) returns jsonb
language plpgsql
as $$
declare
  v_row        public.appointments;
  v_old_status public.appointment_status;
begin
  -- ── 1. המנהלת אמיתית ────────────────────────────────────────────────────
  if p_admin_user_id is null then
    raise exception 'ADMIN_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admins where user_id = p_admin_user_id) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  -- ── 2. נעילה ────────────────────────────────────────────────────────────
  select * into v_row
    from public.appointments
    where id = p_appointment_id
    for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ── 3. כבר מסומן ─────────────────────────────────────────────────────────
  if v_row.status = 'no_show' then
    return jsonb_build_object('outcome', 'already_no_show', 'appointment', to_jsonb(v_row));
  end if;

  -- ── 4. זכאות ─────────────────────────────────────────────────────────────
  if v_row.status = 'completed' then
    v_old_status := 'completed';
  elsif v_row.status = 'confirmed' and v_row.ends_at <= now() then
    v_old_status := 'confirmed';
  elsif v_row.status = 'confirmed' then
    -- 🔒 עדיין לא הסתיים — אי-הגעה אינה עובדה שאפשר לקבוע מראש.
    return jsonb_build_object(
      'outcome',        'not_ended',
      'ends_at',        v_row.ends_at,
      'appointment',    to_jsonb(v_row)
    );
  else
    return jsonb_build_object(
      'outcome',        'not_eligible',
      'current_status', v_row.status,
      'appointment',    to_jsonb(v_row)
    );
  end if;

  -- ── הסימון עצמו ──────────────────────────────────────────────────────────
  update public.appointments
  set status = 'no_show'
  where id = p_appointment_id
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, actor, actor_id
  ) values (
    v_row.id, 'status_changed', v_old_status, 'no_show', 'admin', p_admin_user_id
  );

  return jsonb_build_object('outcome', 'applied', 'appointment', to_jsonb(v_row));
end;
$$;

comment on function public.mark_appointment_no_show(uuid, uuid) is
  '0029: מסמנת completed, או confirmed שה-ends_at שלו עבר, כ-no_show. חסום לפני סוף התור. idempotent. אינה יוצרת התראה — ראה כותרת הקובץ.';


-- ============================================================================
-- הרשאות
--
-- אותו דפוס בדיוק כמו 0003/0027: PostgREST חושף כל פונקציה ב-public
-- כ-RPC לכל תפקיד כברירת מחדל. שתי הפונקציות משמשות מהשרת בלבד.
-- ============================================================================

revoke execute on function public.complete_past_confirmed_appointments()
  from public, anon, authenticated;
revoke execute on function public.mark_appointment_no_show(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.complete_past_confirmed_appointments() to service_role;
grant execute on function public.mark_appointment_no_show(uuid, uuid) to service_role;


-- ============================================================================
-- אימות בפועל
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.complete_past_confirmed_appointments()',
    'public.mark_appointment_no_show(uuid, uuid)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_signatures loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0029): % — ל-anon עדיין יש EXECUTE.', v_sig
        using errcode = 'P0100';
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0029): % — ל-authenticated עדיין יש EXECUTE.', v_sig
        using errcode = 'P0100';
    end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0029): % — ל-service_role חסר EXECUTE.', v_sig
        using errcode = 'P0101';
    end if;
  end loop;

  raise notice 'הרשאות RPC של 0029 אומתו: anon=false, authenticated=false, service_role=true.';
end $$;
