-- ============================================================================
-- 0034 — שלב 12: שינוי מועד ניהולי + סימון "הושלם" לתור בודד
--
-- ═══ 🔒 מיגרציה תוספתית בלבד ═══
--
-- אין DROP, אין ALTER TABLE, אין ALTER TYPE, ואין נגיעה בשום פונקציה קיימת.
-- שתי פונקציות חדשות בלבד. 'completed' ו-'rescheduled' כבר קיימים ב-
-- appointment_status מ-0001.
--
-- ─── מה קורה כאן ────────────────────────────────────────────────────────────
--
--   admin_reschedule_appointment(...)  — שובל מזיזה תור **מאושר** ישירות,
--     בלי לבטל וליצור מחדש. עד היום המסלול היחיד להזזה היה בקשה שהלקוחה
--     יוצרת (0022/0030), ולכן להזזה יזומה של שובל לא היה מסלול בכלל.
--
--   mark_appointment_completed(...)    — סימון תור בודד כהושלם. עד היום
--     היה רק ה-sweep (0029) שמסמן את **כל** מה שהסתיים, בלי שליטה פרטנית.
--
-- ─── למה הזזה ולא "ביטול + יצירה מחדש" ──────────────────────────────────────
--
-- ביטול ניהולי (0027) הוא עובדה עסקית שנרשמת בהיסטוריה, מייצרת התראת SMS
-- ללקוחה, ומוחקת את אירוע היומן. תור שהוזז בתיאום טלפוני אינו תור שבוטל:
-- הודעת "התור שלך בוטל" ואחריה תור חדש היא בדיוק ההודעה השגויה, האירוע
-- ביומן היה נמחק ונוצר מחדש במקום לזוז, וההיסטוריה הייתה מציגה שני תורים
-- נפרדים במקום תור אחד שזז.
--
-- ─── מה **לא** נעשה כאן, ולמה ────────────────────────────────────────────────
--
-- 🔒 **reschedule_count אינו גדל.** העמודה מזינה את self_reschedule_total
-- ב-customer_crm_metrics (0009), שמוגדר במפורש כ"הזזות **עצמיות** של
-- הלקוחה" והוא שנאכף מול max_reschedules במסלול השירות העצמי. הזזה שיזמה
-- שובל אינה הזזה עצמית, והגדלת המונה הייתה שורפת ללקוחה מכסה שהיא מעולם
-- לא ניצלה. אירוע ההזזה עצמו כן נספר — all_reschedule_events סופר שורות
-- appointment_history עם action='rescheduled' (0009), וכאן נכתבת בדיוק
-- שורה אחת כזו.
--
-- 🔒 **אין נגיעה בתזכורות.** הטריגר appointments_sync_reminders_update
-- (0011) יורה על `update of status, starts_at`, מסמן תזכורות של ה-snapshot
-- הישן כ-'superseded' (outcome_reason='starts_at_changed') ויוצר תזכורות
-- חדשות למועד החדש. כתיבה ידנית לתזכורות מכאן הייתה יוצרת כפילות מול
-- הטריגר.
--
-- 🔒 **אין נגיעה ביומן Google.** calendar_sync_status='pending' +
-- operation='upsert' הם בדיוק המצב שממנו ensureCalendarSynced (שלב 6)
-- ממשיך: claim → patch על **אותו** אירוע (מזהה דטרמיניסטי או המזהה השמור,
-- כולל אירוע שאומץ) → complete. אין מחיקה ואין אירוע שני.
--
-- 🔒 **אין התראות SMS משתי הפונקציות.** enqueue_notifications_from_history
-- (0025/0033) היא allowlist מפורש: אף אחד מהצירופים שנכתבים כאן —
-- (action='rescheduled', confirmed→confirmed) ו-(action='status_changed',
-- to_status='completed') — אינו תואם ענף כלשהו בה, והיא נופלת ל-return
-- null. הסימון completed שקט מטבעו בדיוק כמו no_show (0029).
--
-- ⚠️ החפיפה נאכפת ע"י appointments_no_overlap (0001) ולא ע"י בדיקה כאן:
-- ends_at נכתב מחדש ע"י הטריגר appointments_set_end, וה-EXCLUDE הוא
-- ההגנה היחידה שעמידה ב-race. בדיקה מקדימה בקוד היא נוחות, לא הגנה.
-- ============================================================================


-- ============================================================================
-- חלק 1 — שינוי מועד ע"י המנהלת
--
-- ─── סדר הבדיקות, ולמה הוא כזה ─────────────────────────────────────────────
--
--   1. המנהלת אמיתית        — לפני כל נעילה, בדיוק כמו 0027/0029. זו גם
--                              ההוכחה ש-actor_id שנכתב להיסטוריה הוא מנהלת.
--   2. FOR UPDATE            — מכאן והלאה אף אחד אחר לא נוגע בשורה.
--   3. אין שינוי בפועל       — יציאה 'no_change' **לפני** כל כתיבה. לחיצה
--                              חוזרת על אותו מועד לא תייצר שורת היסטוריה
--                              שנייה, לא תסמן תזכורות superseded ולא
--                              תפעיל סנכרון יומן מיותר.
--   4. confirmed בלבד        — תור שאינו מאושר אינו "זז"; יש לו מסלול משלו.
--   5. שורת בקשה             — שורת בקשת שינוי מועד אינה תור בפני עצמו.
--   6. מועד בעבר              — לא המקור ולא היעד.
--   7. בקשת שינוי פתוחה      — ראה למטה.
--   8. סנכרון פעיל           — לא מושכים את השטיח מתחת לפעולת יומן שרצה.
--
-- 🔒 בדיקה 7 חוסמת הזזה של תור שיש לו **בקשת שינוי מועד ממתינה** של
-- הלקוחה. שתי ההכרעות נוגעות לאותו תור ולאותה שעה, והזזה בזמן שהבקשה
-- פתוחה הייתה משאירה את הלקוחה עם בקשה שממתינה למועד שכבר אינו קיים.
-- ⚠️ הבחירה כאן היא **חסימה מפורשת ולא סגירה שקטה**: סגירת הבקשה מכאן
-- הייתה החלטה על הלקוחה בלי להודיע לה, וההודעה על דחיית בקשה נשלחת רק
-- מהמסלול הייעודי (reject_reschedule_request). שובל מכריעה בבקשה קודם,
-- ואז מזיזה.
-- ============================================================================

create or replace function public.admin_reschedule_appointment(
  p_appointment_id  uuid,
  p_starts_at       timestamptz,
  p_duration_min    integer,
  p_admin_user_id   uuid
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row        public.appointments;
  v_old_start  timestamptz;
  v_old_dur    integer;
  v_duration   integer;
begin
  -- ── 1. המנהלת אמיתית ────────────────────────────────────────────────────
  if p_admin_user_id is null then
    raise exception 'ADMIN_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admins where user_id = p_admin_user_id) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  if p_starts_at is null then
    raise exception 'INVALID_SLOT' using errcode = '22023';
  end if;

  -- ── 2. נעילה ────────────────────────────────────────────────────────────
  select * into v_row
    from public.appointments
    where id = p_appointment_id
    for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- משך שלא נשלח = המשך הקיים נשאר. אותם גבולות בדיוק כמו
  -- create_manual_appointment (0010), כדי שלא ייווצרו שתי הגדרות ל"משך חוקי".
  v_duration := coalesce(p_duration_min, v_row.duration_min);
  if v_duration < 5 or v_duration > 480 then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  v_old_start := v_row.starts_at;
  v_old_dur   := v_row.duration_min;

  -- ── 3. אין שינוי בפועל ──────────────────────────────────────────────────
  if v_old_start = p_starts_at and v_old_dur = v_duration then
    return jsonb_build_object('outcome', 'no_change', 'appointment', to_jsonb(v_row));
  end if;

  -- ── 4. confirmed בלבד ───────────────────────────────────────────────────
  if v_row.status <> 'confirmed' then
    return jsonb_build_object(
      'outcome',        'not_confirmed',
      'current_status', v_row.status,
      'appointment',    to_jsonb(v_row)
    );
  end if;

  -- ── 5. שורת בקשת שינוי מועד אינה תור ────────────────────────────────────
  if v_row.reschedule_of_appointment_id is not null then
    return jsonb_build_object('outcome', 'is_request_row', 'appointment', to_jsonb(v_row));
  end if;

  -- ── 6. עבר ──────────────────────────────────────────────────────────────
  -- ⚠️ שני הכיוונים: אין להזיז תור שכבר התחיל (הזזה רטרואקטיבית), ואין
  -- להזיז אל מועד שכבר עבר.
  if v_old_start <= now() then
    return jsonb_build_object('outcome', 'in_past', 'appointment', to_jsonb(v_row));
  end if;
  if p_starts_at <= now() then
    return jsonb_build_object('outcome', 'target_in_past', 'appointment', to_jsonb(v_row));
  end if;

  -- ── 7. בקשת שינוי מועד פתוחה של הלקוחה ──────────────────────────────────
  if exists (
    select 1 from public.appointments r
    where r.reschedule_of_appointment_id = p_appointment_id
      and r.status = 'pending'
  ) then
    return jsonb_build_object('outcome', 'open_reschedule_request', 'appointment', to_jsonb(v_row));
  end if;

  -- ── 8. סנכרון יומן פעיל ─────────────────────────────────────────────────
  -- אותו lease של 2 דקות שכל שאר המסלולים מכבדים (0004/0027).
  if v_row.calendar_sync_status = 'syncing'
     and v_row.calendar_sync_started_at is not null
     and v_row.calendar_sync_started_at > now() - interval '2 minutes' then
    return jsonb_build_object('outcome', 'sync_in_progress', 'appointment', to_jsonb(v_row));
  end if;

  -- ── ההזזה עצמה ──────────────────────────────────────────────────────────
  --
  -- ⚠️ ends_at אינו נכתב כאן — הטריגר appointments_set_end (0001) מחשב
  -- אותו מחדש מ-starts_at + duration_min, וזה גם מה שה-EXCLUDE בודק.
  --
  -- original_starts_at שומר את המועד המקורי **הראשון** בשרשרת ולכן נכתב
  -- רק אם הוא עדיין ריק, בדיוק כמו ב-approve_reschedule_request.
  --
  -- ⚠️ reschedule_count **אינו** גדל — ראה הנימוק בכותרת הקובץ.
  --
  -- calendar_sync_status='pending' + operation='upsert' מחזירים את השורה
  -- למסלול הסנכרון הקיים: patch על אותו אירוע, בלי מחיקה ובלי אירוע שני.
  update public.appointments
  set starts_at                = p_starts_at,
      duration_min             = v_duration,
      original_starts_at       = coalesce(original_starts_at, v_old_start),
      calendar_sync_operation  = 'upsert',
      calendar_sync_status     = 'pending',
      calendar_sync_started_at = null,
      calendar_sync_error      = null
  where id = p_appointment_id
  returning * into v_row;

  -- שורת היסטוריה **אחת**. action='rescheduled' הוא מה שנספר ב-
  -- all_reschedule_events, וה-from/to מתעדים את שתי השעות.
  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, to_starts_at, actor, actor_id, source
  ) values (
    p_appointment_id, 'rescheduled', 'confirmed', 'confirmed',
    v_old_start, v_row.starts_at, 'admin', p_admin_user_id, 'admin_dashboard'
  );

  return jsonb_build_object(
    'outcome',        'applied',
    'from_starts_at', v_old_start,
    'appointment',    to_jsonb(v_row)
  );
end;
$$;

comment on function public.admin_reschedule_appointment(uuid, timestamptz, integer, uuid) is
  '0034: שובל מזיזה תור confirmed ישירות. מעדכנת starts_at/duration_min, שומרת original_starts_at הראשון, מחזירה את השורה למסלול סנכרון upsert, וכותבת שורת היסטוריה אחת (rescheduled). אינה מגדילה reschedule_count (מכסת ההזזות העצמיות של הלקוחה), אינה נוגעת בתזכורות (טריגר 0011) ואינה מייצרת SMS. חסומה כשיש בקשת שינוי מועד ממתינה, כשהתור כבר התחיל, כשהיעד בעבר, וכשיש lease סנכרון פעיל.';


-- ============================================================================
-- חלק 2 — סימון "הושלם" לתור בודד
--
-- אותו דפוס בדיוק כמו mark_appointment_no_show (0029), כולל סדר הבדיקות:
-- "כבר מסומן" נבדק **לפני** הזכאות, כדי שלחיצה חוזרת תחזיר
-- 'already_completed' ולא שגיאת "לא זכאי" על פעולה שהצליחה במלואה.
--
-- 🔒 חסום כל עוד ה-ends_at בעתיד: "הושלם" הוא עובדה על טיפול שהתקיים,
-- ולא הצהרה מראש. no_show נחסם באותו תנאי בדיוק ומאותו טעם.
--
-- ⚠️ אין כאן שום התראה — ראה הנימוק בכותרת הקובץ.
-- ============================================================================

create or replace function public.mark_appointment_completed(
  p_appointment_id uuid,
  p_admin_user_id  uuid
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row public.appointments;
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
  if v_row.status = 'completed' then
    return jsonb_build_object('outcome', 'already_completed', 'appointment', to_jsonb(v_row));
  end if;

  -- ── 4. זכאות ─────────────────────────────────────────────────────────────
  if v_row.status <> 'confirmed' then
    return jsonb_build_object(
      'outcome',        'not_eligible',
      'current_status', v_row.status,
      'appointment',    to_jsonb(v_row)
    );
  end if;
  if v_row.ends_at > now() then
    return jsonb_build_object(
      'outcome',     'not_ended',
      'ends_at',     v_row.ends_at,
      'appointment', to_jsonb(v_row)
    );
  end if;

  -- ── הסימון עצמו ──────────────────────────────────────────────────────────
  update public.appointments
  set status = 'completed'
  where id = p_appointment_id
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, actor, actor_id, source
  ) values (
    v_row.id, 'status_changed', 'confirmed', 'completed', 'admin', p_admin_user_id, 'admin_dashboard'
  );

  return jsonb_build_object('outcome', 'applied', 'appointment', to_jsonb(v_row));
end;
$$;

comment on function public.mark_appointment_completed(uuid, uuid) is
  '0034: מסמנת תור confirmed שה-ends_at שלו עבר כ-completed. idempotent (already_completed), חסומה לפני סוף התור (not_ended), ואינה יוצרת התראה — אותו דפוס בדיוק כמו mark_appointment_no_show (0029).';


-- ============================================================================
-- הרשאות
--
-- אותו דפוס כמו 0003/0027/0029: PostgREST חושף כל פונקציה ב-public כ-RPC
-- לכל תפקיד כברירת מחדל. שתי הפונקציות משמשות מהשרת בלבד.
-- ============================================================================

revoke execute on function public.admin_reschedule_appointment(uuid, timestamptz, integer, uuid)
  from public, anon, authenticated;
revoke execute on function public.mark_appointment_completed(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.admin_reschedule_appointment(uuid, timestamptz, integer, uuid)
  to service_role;
grant execute on function public.mark_appointment_completed(uuid, uuid) to service_role;


-- ============================================================================
-- אימות בפועל
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.admin_reschedule_appointment(uuid, timestamptz, integer, uuid)',
    'public.mark_appointment_completed(uuid, uuid)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_signatures loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0034): % — ל-anon עדיין יש EXECUTE.', v_sig
        using errcode = 'P0100';
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0034): % — ל-authenticated עדיין יש EXECUTE.', v_sig
        using errcode = 'P0100';
    end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0034): % — ל-service_role חסר EXECUTE.', v_sig
        using errcode = 'P0101';
    end if;
  end loop;

  raise notice 'הרשאות RPC של 0034 אומתו: anon=false, authenticated=false, service_role=true.';
end $$;
