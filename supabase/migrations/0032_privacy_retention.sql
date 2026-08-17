-- ============================================================================
-- 0032 — שלב 9B: retention hold + ניקוי נתונים בטוח (ליבה בלבד)
--
-- מיישמת את מה שאושר בתכנון 9A המתוקן, ורק אותו:
--
--   1. retention_hold על customers + RPC לשינוי, עם audit ב-customer_crm_activity.
--   2. ארבע פונקציות retention: dry-run + שלוש execute "בטוחות" (ללא PII
--      בתוכן, תואמות להחלטת בעלים קיימת): OTP+sessions, ניסיוני התראה
--      סגורים, ואיפוס notes ישנות.
--   3. get_crm_customer חושפת את retention_hold לכרטיס הלקוחה.
--
-- ⚠️ 9B.2 — תוקן: ניקוי ניסיוני התראה נקבע כעת לפי **מצב ה-notification
-- ההורה** (notification_is_terminal, חלק 4), לא לפי outcome של הניסיון
-- הבודד. גרסה קודמת החריגה לצמיתות כל attempt עם outcome='retryable_error'
-- — גם אחרי שההורה כבר הגיע למצב סופי אמיתי (sent/failed/וכו'), מה שלא
-- היה מוצדק.
--
-- ⚠️ מה שהקובץ הזה **אינו** עושה, במפורש:
--
--   • אין חיבור ל-scheduler (לא Vercel Cron, לא QStash) — routes בלבד,
--     מוכנים לתזמון עתידי. אין vercel.json.
--   • אין שינוי ב-Google Calendar היסטורי.
--   • אין מחיקה/אנונימיזציה של בקשות rejected — הן נשארות במסלול הרשומה
--     המינימלית (7 שנים, זמני), ורק ה-notes שלהן מתנקה בכלל הכללי.
--   • אין ניקוי ל-appointment_reminder_attempts. הטריגר append-only שלה
--     (0011/0012) חוסם DELETE ישיר ללא תנאי כל עוד ההורה קיים, ואין כאן
--     שינוי לטריגר ההגנתי הזה — זה ידרוש בדיקת אבטחה נפרדת משלו. attempts
--     של תזכורות פשוט לא מנוקות ב-v1; ראה docs/data-retention-policy.md.
--   • אין מחיקה של appointment_reminders/appointment_notifications (השורות
--     הראשיות) — רק ה-attempts הסגורים שלהן.
--   • אין חיבור ל-production ואין נתוני לקוחות אמיתיים בקובץ הזה.
-- ============================================================================


-- ============================================================================
-- חלק 1 — retention_hold על customers
--
-- ⚠️ ה-constraint מתיר במפורש את המצב שבו admin נמחק מ-auth.users:
-- retention_hold_updated_by מתאפס ל-NULL (on delete set null), אבל
-- retention_hold_updated_at **נשאר** — זו עדות שהערך שונה אי-פעם, גם אם
-- מי ששינה אותו כבר לא קיים. הכלל היחיד שנאכף: אי אפשר "מי" בלי "מתי".
-- (בניגוד ל-customers_archived_pair של 0028, ששני צדדיה תמיד יחד — כאן
-- זה חד-כיווני, כי updated_by לבדו יכול להתאפס אחרי העובדה.)
-- ============================================================================

alter table public.customers
  add column if not exists retention_hold            boolean not null default false,
  add column if not exists retention_hold_updated_at timestamptz,
  add column if not exists retention_hold_updated_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname  = 'customers_retention_hold_pair'
  ) then
    alter table public.customers
      add constraint customers_retention_hold_pair
      check (retention_hold_updated_by is null or retention_hold_updated_at is not null);
  end if;
end $$;

comment on column public.customers.retention_hold is
  '9B.1: true = חוסמת אך ורק את איפוס appointments.notes (privacy_retention_reset_old_notes) עבור לקוחה זו. אינה חוסמת ניקוי OTP/sessions/notification_attempts (טכניים גרידא, ללא קשר אמין ללקוחה), ואינה מסתירה אותה מדוחות ה-report-only ב-privacy_retention_dry_run (hold מסמן צורך בבדיקה, ואסור שיסתיר את הלקוחה מדוח שאמור להראות בדיוק אותה).';
comment on column public.customers.retention_hold_updated_at is
  'זמן השינוי האחרון, נקבע בשרת (now() בתוך ה-RPC). נשאר גם אם retention_hold_updated_by מתאפס.';
comment on column public.customers.retention_hold_updated_by is
  'ה-auth user של המנהלת ששינתה לאחרונה. on delete set null: מחיקת חשבון המנהלת אינה חוסמת ואינה משנה את ה-hold עצמו.';


-- ============================================================================
-- חלק 2 — customer_crm_activity לומדת 'retention_hold_changed'
--
-- אותו דפוס בדיוק כמו 0010/0028: איתור ה-CHECK לפי תוכן, לא לפי שם מנוחש,
-- ורשימה מלאה (איחוד כל הערכים הקודמים + החדש) ולא רק ה-diff.
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
      '0032: לא נמצא בדיוק CHECK אחד על customer_crm_activity.action (נמצאו %). יש לבדוק ידנית.',
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
      'customer_created',
      'name_updated',
      'phone_updated',
      'archived',
      'unarchived',
      -- ── 9B ──
      'retention_hold_changed'
    ));
end $$;


-- ============================================================================
-- חלק 3 — set_customer_retention_hold
--
-- ⚠️ idempotent: ערך זהה לקיים מוחזר כ-'unchanged' בלי UPDATE ובלי שורת
-- activity — בדיוק כמו archive_customer/unarchive_customer ב-0028.
-- ⚠️ אין שדה סיבה חופשי, במכוון: old_value/new_value הם 'true'/'false'
-- בלבד, כדי לא ליצור ערוץ טקסט חופשי נוסף שעלול לשאת מידע רגיש.
-- ============================================================================

create or replace function public.set_customer_retention_hold(
  p_customer_id   uuid,
  p_admin_user_id uuid,
  p_hold          boolean
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
  if p_hold is null then
    raise exception 'BAD_HOLD' using errcode = '22023';
  end if;

  select * into v_row from public.customers where id = p_customer_id for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 🔒 חשבון ניהול אינו כרטיס לקוחה — אותה החרגה כמו שאר פונקציות ה-CRM.
  if v_row.auth_user_id is not null
     and exists (select 1 from public.admins ad where ad.user_id = v_row.auth_user_id) then
    raise exception 'NOT_A_CUSTOMER' using errcode = '42501';
  end if;

  if v_row.retention_hold = p_hold then
    return jsonb_build_object('outcome', 'unchanged', 'retention_hold', v_row.retention_hold);
  end if;

  update public.customers
  set retention_hold            = p_hold,
      retention_hold_updated_at = now(),
      retention_hold_updated_by = p_admin_user_id
  where id = p_customer_id;

  insert into public.customer_crm_activity (customer_id, action, actor_admin_id, old_value, new_value)
  values (p_customer_id, 'retention_hold_changed', p_admin_user_id,
          v_row.retention_hold::text, p_hold::text);

  return jsonb_build_object('outcome', 'updated', 'retention_hold', p_hold);
end;
$$;

comment on function public.set_customer_retention_hold(uuid, uuid, boolean) is
  '9B.1: הפעלה/ביטול של השהיית איפוס appointments.notes ללקוחה (ראה comment על העמודה עצמה לגבי היקף מדויק — לא OTP/sessions/notification_attempts, ולא report-only). idempotent — ערך זהה אינו כותב activity ואינו נוגע ב-updated_at/_by. old_value/new_value הם true/false בלבד.';


-- ============================================================================
-- חלק 4 — פונקציות retention
--
-- ⚠️ כל ארבע הפונקציות: p_now/p_batch_limit עם DEFAULT (לא NOT NULL —
-- תחביר לא-תקין בפרמטרים), ודחיית NULL/טווח בגוף הפונקציה עצמה. סדר batch
-- דטרמיניסטי: עמודת ה-cutoff ואז id. FOR UPDATE SKIP LOCKED על השורות
-- הנבחרות בלבד. תוצאה: ספירות בלבד, אין PII/IDs/notes/phone.
-- ============================================================================

-- ─── helper: מצב סופי של appointment_notifications ─────────────────────────
--
-- 🔒 9B.2 — מקור האמת היחיד לרשימת הסטטוסים הסופיים, כדי ש-dry-run
-- ו-execute (למטה) לעולם לא יסטו זה מזה. הרשימה נגזרת ישירות מ-0025,
-- לא מנוחשת:
--
--   • notification_status (0025:97-106) — הטיפוס עצמו:
--     queued / sending / retrying / sent / simulated / failed /
--     delivery_unknown / skipped.
--   • claim_appointment_notification (0025:536-554) — claim לוקח שורות
--     במצב 'queued'/'retrying' (attempt_count<max), או 'sending' עם
--     lease שפג (recovery של worker שנקטע), ומעביר אותן ל-'sending'.
--     שלושתם — queued/sending/retrying — ממתינים לניסיון נוסף, ולכן
--     אינם סופיים.
--   • finish_notification_attempt (0025:624-632, מיפוי v_status) —
--     accepted→sent/simulated, delivery_unknown→delivery_unknown,
--     permanent_error→failed. retryable_error→'retrying' כל עוד לא
--     מוצו הניסיונות, **ורק כשמוצו** → 'failed'. כלומר retryable_error
--     כ-outcome של ניסיון בודד **אינו** קובע שההורה סופי — יש לבדוק את
--     status בפועל.
--   • skip_notification (0025:681-687) — מעבירה ל-'skipped'. סופי:
--     "לא הייתה תקלה, פשוט אין נמען" (הערת 0025).
--
-- הסופיים בפועל: sent, simulated, delivery_unknown, failed, skipped.
-- הלא-סופיים: queued, sending, retrying — לעולם לא נחשבים סופיים, לא
-- משנה כמה ה-attempts שלהם ישנים.
create or replace function public.notification_is_terminal(p_status notification_status)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_status in ('sent', 'simulated', 'delivery_unknown', 'failed', 'skipped')
$$;

comment on function public.notification_is_terminal(notification_status) is
  '9B.2: true כאשר appointment_notifications.status הוא מצב סופי (sent/simulated/delivery_unknown/failed/skipped), לא queued/sending/retrying. מקור יחיד לרשימה — בשימוש גם ב-privacy_retention_dry_run וגם ב-privacy_retention_purge_notification_attempts, כדי שלא יסטו זה מזה.';


-- ─── dry-run ─────────────────────────────────────────────────────────────────
--
-- ⚠️ כל תנאי WHERE כאן זהה מילה במילה לפונקציית ה-execute המקבילה (חלק 5),
-- כדי ש-total_eligible/next_batch_count לא יסטו מהמחיקה בפועל. שלוש
-- הקטגוריות הראשונות תואמות execute; ארבע האחרונות report-only בלבד —
-- אין להן execute מקביל ב-v1.
--
-- ⚠️ 'rejected' אינה מופיעה כאן בשום צורה — אין count למחיקתה, לפי
-- החלטת הבעלים.
create or replace function public.privacy_retention_dry_run(
  p_now         timestamptz default now(),
  p_batch_limit integer     default 1000
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_otp_total   integer;
  v_sess_total  integer;
  v_notif_total integer;
  v_notes_total integer;
  v_notes_review    integer;
  v_activity_review integer;
  v_inactive_with_appts    integer;
  v_inactive_without_appts integer;
begin
  if p_now is null then
    raise exception 'P_NOW_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit is null then
    raise exception 'P_BATCH_LIMIT_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit < 1 or p_batch_limit > 5000 then
    raise exception 'P_BATCH_LIMIT_OUT_OF_RANGE' using errcode = '22023';
  end if;

  select count(*) into v_otp_total
  from public.otp_attempts
  where created_at < p_now - interval '7 days';

  -- ⚠️ COALESCE(revoked_at, expires_at) < p_now - 30d לבדו כבר לעולם אינו
  -- מתקיים ל-session חי: session חי מוגדר expires_at > p_now (טרם פג),
  -- ולכן coalesce >= p_now > p_now-30d — אין צורך בתנאי שלילה נפרד.
  select count(*) into v_sess_total
  from public.app_sessions
  where coalesce(revoked_at, expires_at) < p_now - interval '30 days';

  -- 🔒 9B.2 — "סגור" אינו רק finished_at is not null, וגם לא הוחלט לפי
  -- outcome של הניסיון עצמו (תוקן — ר' 0032 היסטוריה): retryable_error
  -- ו-lease_expired הם מצבי ניסיון תקינים גם כשה-notification ההורה
  -- **כן** הגיע בסופו של דבר למצב סופי (למשל ניסיון ראשון נכשל זמנית,
  -- השני הצליח — ה-notification הוא 'sent', אך attempt מס' 1 עדיין נושא
  -- outcome='retryable_error' לצמיתות, כתיעוד תקין של מה שקרה בפועל).
  -- הקובע האמיתי הוא **מצב ההורה עצמו**, לא ה-outcome של השורה הבודדת —
  -- ר' notification_is_terminal למעלה למקור המדויק ברשימת הסטטוסים.
  select count(*) into v_notif_total
  from public.appointment_notification_attempts att
  where att.finished_at is not null
    and att.finished_at < p_now - interval '90 days'
    and exists (
      select 1 from public.appointment_notifications n
      where n.id = att.notification_id
        and public.notification_is_terminal(n.status)
    );

  select count(*) into v_notes_total
  from public.appointments a
  join public.customers c on c.id = a.customer_id
  where a.notes is not null
    and a.starts_at < p_now - interval '90 days'
    and c.retention_hold = false;

  -- ── report-only: להלן, אין execute מקביל ב-v1 ──────────────────────────
  --
  -- 🔒 9B.1 — **retention_hold אינו מוחל כאן, במכוון.** הוא עוצר רק מחיקה/
  -- שינוי בפועל (privacy_retention_reset_old_notes למעלה/למטה) — לא
  -- ספירות report-only שאינן מבצעות שום mutation. הסתרת לקוחה תחת hold
  -- מדוח "מועמדת לבדיקה" הייתה הפוכה מהכוונה: hold מסמן בדיוק לקוחה
  -- שדורשת תשומת לב ידנית, ואין סיבה שהיא תיעלם מהדוח שאמור להראות אותה.
  with last_appt as (
    select customer_id, max(starts_at) as last_starts_at
    from public.appointments
    group by customer_id
  )
  select count(*) into v_notes_review
  from public.customer_notes n
  join last_appt la on la.customer_id = n.customer_id
  where n.archived_at is null
    and la.last_starts_at < p_now - interval '24 months';

  with last_appt as (
    select customer_id, max(starts_at) as last_starts_at
    from public.appointments
    group by customer_id
  )
  select count(*) into v_activity_review
  from public.customer_crm_activity act
  join last_appt la on la.customer_id = act.customer_id
  where la.last_starts_at < p_now - interval '24 months';

  with last_appt as (
    select customer_id, max(starts_at) as last_starts_at
    from public.appointments
    group by customer_id
  )
  select count(*) into v_inactive_with_appts
  from public.customers c
  join last_appt la on la.customer_id = c.id
  where la.last_starts_at < p_now - interval '24 months'
    and not exists (
      select 1 from public.appointments a
      where a.customer_id = c.id
        and a.status in ('pending', 'confirmed')
        and a.starts_at > p_now
    );

  -- לקוחה שמעולם לא הזמינה תור: נקודת הייחוס היא created_at/updated_at
  -- (המאוחר מביניהם), לא תור אחרון — אין לה תור אחרון בכלל.
  select count(*) into v_inactive_without_appts
  from public.customers c
  where c.auth_user_id is null
    and not exists (select 1 from public.appointments a where a.customer_id = c.id)
    and greatest(c.created_at, c.updated_at) < p_now - interval '24 months';

  return jsonb_build_object(
    'otp_attempts',          jsonb_build_object(
      'total_eligible', v_otp_total, 'next_batch_count', least(v_otp_total, p_batch_limit)),
    'app_sessions',          jsonb_build_object(
      'total_eligible', v_sess_total, 'next_batch_count', least(v_sess_total, p_batch_limit)),
    'notification_attempts', jsonb_build_object(
      'total_eligible', v_notif_total, 'next_batch_count', least(v_notif_total, p_batch_limit)),
    'appointments_notes',    jsonb_build_object(
      'total_eligible', v_notes_total, 'next_batch_count', least(v_notes_total, p_batch_limit)),
    'customer_notes_review',                   jsonb_build_object('total_eligible', v_notes_review),
    'customer_crm_activity_review',            jsonb_build_object('total_eligible', v_activity_review),
    'inactive_customers_with_appointments',    jsonb_build_object('total_eligible', v_inactive_with_appts),
    'inactive_customers_without_appointments', jsonb_build_object('total_eligible', v_inactive_without_appts)
  );
end;
$$;

comment on function public.privacy_retention_dry_run(timestamptz, integer) is
  '9B: ספירות בלבד לכל קטגוריית retention. אין rejected_requests — אין להן פעולה מתוכננת. report-only categories אינן מבצעות mutation.';


-- ============================================================================
-- חלק 5 — שלוש פונקציות execute, "אוטומטי בטוח" בלבד
-- ============================================================================

-- ─── OTP + sessions ────────────────────────────────────────────────────────
create or replace function public.privacy_retention_purge_otp_sessions(
  p_now         timestamptz default now(),
  p_batch_limit integer     default 1000
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_otp_deleted  integer;
  v_sess_deleted integer;
begin
  if p_now is null then
    raise exception 'P_NOW_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit is null then
    raise exception 'P_BATCH_LIMIT_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit < 1 or p_batch_limit > 5000 then
    raise exception 'P_BATCH_LIMIT_OUT_OF_RANGE' using errcode = '22023';
  end if;

  delete from public.otp_attempts
  where id in (
    select id from public.otp_attempts
    where created_at < p_now - interval '7 days'
    order by created_at, id
    limit p_batch_limit
    for update skip locked
  );
  get diagnostics v_otp_deleted = row_count;

  -- 🔒 session חי לעולם לא נבחר — ר' ההערה בחלק 4.
  delete from public.app_sessions
  where id in (
    select id from public.app_sessions
    where coalesce(revoked_at, expires_at) < p_now - interval '30 days'
    order by coalesce(revoked_at, expires_at), id
    limit p_batch_limit
    for update skip locked
  );
  get diagnostics v_sess_deleted = row_count;

  return jsonb_build_object('otp_deleted', v_otp_deleted, 'sessions_deleted', v_sess_deleted);
end;
$$;

comment on function public.privacy_retention_purge_otp_sessions(timestamptz, integer) is
  '9B: מחיקת otp_attempts בני 7+ ימים ו-app_sessions שפגו/בוטלו לפני 30+ יום. session חי לעולם אינו נבחר.';

-- ─── ניסיוני התראה סגורים בלבד ────────────────────────────────────────────
--
-- 🔒 attempts בלבד. אין מחיקת appointment_notifications (ההורה), ואין
-- שום נגיעה ב-appointment_reminder_attempts — ר' הערת הכותרת.
create or replace function public.privacy_retention_purge_notification_attempts(
  p_now         timestamptz default now(),
  p_batch_limit integer     default 1000
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  if p_now is null then
    raise exception 'P_NOW_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit is null then
    raise exception 'P_BATCH_LIMIT_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit < 1 or p_batch_limit > 5000 then
    raise exception 'P_BATCH_LIMIT_OUT_OF_RANGE' using errcode = '22023';
  end if;

  -- 🔒 9B.2 — תנאי "סגור" זהה מילה במילה לזה שב-privacy_retention_dry_run
  -- (חלק 4 למעלה): finished_at is not null, finished_at < p_now-90d, **וגם**
  -- ה-notification ההורה במצב סופי אמיתי (notification_is_terminal).
  -- לא נבדק לפי outcome של הניסיון עצמו — ר' ההסבר המלא למעלה.
  --
  -- ⚠️ FOR UPDATE OF att בלבד — לא נועלים שורות appointment_notifications
  -- שנקראות רק דרך EXISTS, אותו עיקרון כמו FOR UPDATE OF a2 בפונקציית
  -- איפוס ה-notes למטה.
  delete from public.appointment_notification_attempts
  where id in (
    select att.id
    from public.appointment_notification_attempts att
    where att.finished_at is not null
      and att.finished_at < p_now - interval '90 days'
      and exists (
        select 1 from public.appointment_notifications n
        where n.id = att.notification_id
          and public.notification_is_terminal(n.status)
      )
    order by att.finished_at, att.id
    limit p_batch_limit
    for update of att skip locked
  );
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('notification_attempts_deleted', v_deleted);
end;
$$;

comment on function public.privacy_retention_purge_notification_attempts(timestamptz, integer) is
  '9B.2: מחיקת appointment_notification_attempts סגורים ובני 90+ יום, כשה-notification ההורה במצב סופי (notification_is_terminal: sent/simulated/delivery_unknown/failed/skipped). כל עוד ההורה queued/sending/retrying — אף attempt שלו לא נמחק, כולל retryable_error/lease_expired ישנים. attempt ללא finished_at (פתוח) לעולם לא נמחק. אינה נוגעת ב-appointment_notifications (ההורה) ואינה נוגעת ב-appointment_reminder_attempts.';

-- ─── איפוס notes ישנות ──────────────────────────────────────────────────────
--
-- 🔒 FOR UPDATE OF a2 בלבד — לא נועלים שורות customers שנקראות רק ל-JOIN.
create or replace function public.privacy_retention_reset_old_notes(
  p_now         timestamptz default now(),
  p_batch_limit integer     default 1000
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_reset integer;
begin
  if p_now is null then
    raise exception 'P_NOW_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit is null then
    raise exception 'P_BATCH_LIMIT_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit < 1 or p_batch_limit > 5000 then
    raise exception 'P_BATCH_LIMIT_OUT_OF_RANGE' using errcode = '22023';
  end if;

  update public.appointments a
  set notes = null
  where a.id in (
    select a2.id
    from public.appointments a2
    join public.customers c on c.id = a2.customer_id
    where a2.notes is not null
      and a2.starts_at < p_now - interval '90 days'
      and c.retention_hold = false
    order by a2.starts_at, a2.id
    limit p_batch_limit
    for update of a2 skip locked
  );
  get diagnostics v_reset = row_count;

  return jsonb_build_object('notes_reset', v_reset);
end;
$$;

comment on function public.privacy_retention_reset_old_notes(timestamptz, integer) is
  '9B: איפוס appointments.notes ל-NULL לתורים בני 90+ יום מ-starts_at, למעט לקוחות תחת retention_hold. אינה נוגעת בתור/היסטוריה/אישור מדיניות פרטיות. rejected נכללת בכלל הכללי הזה כמו כל סטטוס אחר.';


-- ============================================================================
-- חלק 6 — get_crm_customer חושפת את retention_hold
--
-- CREATE OR REPLACE עם אותה חתימה בדיוק (uuid) כמו 0009/0028 — ACL נשמר,
-- ומוצהר שוב למטה לפי אותו דפוס תיעודי.
-- ============================================================================

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
      c.retention_hold,
      c.retention_hold_updated_at,
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
-- חלק 7 — הרשאות
-- ============================================================================

revoke execute on function public.notification_is_terminal(notification_status)
  from public, anon, authenticated;
revoke execute on function public.set_customer_retention_hold(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.privacy_retention_dry_run(timestamptz, integer)
  from public, anon, authenticated;
revoke execute on function public.privacy_retention_purge_otp_sessions(timestamptz, integer)
  from public, anon, authenticated;
revoke execute on function public.privacy_retention_purge_notification_attempts(timestamptz, integer)
  from public, anon, authenticated;
revoke execute on function public.privacy_retention_reset_old_notes(timestamptz, integer)
  from public, anon, authenticated;
revoke execute on function public.get_crm_customer(uuid)
  from public, anon, authenticated;

grant execute on function public.notification_is_terminal(notification_status) to service_role;
grant execute on function public.set_customer_retention_hold(uuid, uuid, boolean) to service_role;
grant execute on function public.privacy_retention_dry_run(timestamptz, integer) to service_role;
grant execute on function public.privacy_retention_purge_otp_sessions(timestamptz, integer) to service_role;
grant execute on function public.privacy_retention_purge_notification_attempts(timestamptz, integer) to service_role;
grant execute on function public.privacy_retention_reset_old_notes(timestamptz, integer) to service_role;
grant execute on function public.get_crm_customer(uuid) to service_role;


-- ============================================================================
-- חלק 8 — אימות בפועל
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.notification_is_terminal(notification_status)',
    'public.set_customer_retention_hold(uuid, uuid, boolean)',
    'public.privacy_retention_dry_run(timestamptz, integer)',
    'public.privacy_retention_purge_otp_sessions(timestamptz, integer)',
    'public.privacy_retention_purge_notification_attempts(timestamptz, integer)',
    'public.privacy_retention_reset_old_notes(timestamptz, integer)',
    'public.get_crm_customer(uuid)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_signatures loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0032): % — ל-anon עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0032): % — ל-authenticated עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0032): % — ל-service_role חסר EXECUTE.', v_sig using errcode = 'P0101';
    end if;
  end loop;

  raise notice '0032: הרשאות RPC אומתו: anon=false, authenticated=false, service_role=true.';
end $$;

do $$
declare
  v_cols  integer;
  v_check integer;
begin
  -- ── עמודות retention_hold ────────────────────────────────────────────────
  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'customers'
    and column_name in ('retention_hold', 'retention_hold_updated_at', 'retention_hold_updated_by');
  if v_cols <> 3 then
    raise exception '0032: נוספו % מתוך 3 עמודות retention_hold.', v_cols using errcode = 'P0103';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers'
      and column_name = 'retention_hold' and is_nullable = 'NO' and column_default like '%false%'
  ) then
    raise exception '0032: customers.retention_hold אינה NOT NULL DEFAULT false' using errcode = 'P0103';
  end if;

  -- ── ה-constraint מתיר updated_by=NULL עם updated_at not null ────────────
  --
  -- ⚠️ בדיקת תוכן (ILIKE) ולא שוויון מחרוזת מדויק: הפורמט המדויק של
  -- pg_get_constraintdef (רווחים/סוגריים) אינו חוזה יציב לבנות עליו. הבדיקה
  -- מוודאת את **הכלל הסמנטי** שאושר — updated_by IS NULL OR updated_at IS
  -- NOT NULL — ובנפרד שולל את הנוסח האסור (שוויון "שניהם יחד תמיד"), שהיה
  -- מכיל את הסימן '=' ואינו מכיל אף אחד מהם.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname  = 'customers_retention_hold_pair'
      and pg_get_constraintdef(oid) ilike '%retention_hold_updated_by%is null%'
      and pg_get_constraintdef(oid) ilike '%retention_hold_updated_at%is not null%'
      and pg_get_constraintdef(oid) ilike '%or%'
      and pg_get_constraintdef(oid) not ilike '%=%'
  ) then
    raise exception
      '0032: customers_retention_hold_pair חסר, או אינו בנוסח "updated_by IS NULL OR updated_at IS NOT NULL" שאושר (לא כלל שוויון both-or-neither).'
      using errcode = 'P0103';
  end if;

  -- ── retention_hold_updated_by הוא on delete set null ─────────────────────
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (retention_hold_updated_by)%'
      and confdeltype = 'n'   -- SET NULL
  ) then
    raise exception '0032: customers.retention_hold_updated_by אינו on delete set null' using errcode = 'P0103';
  end if;

  -- ── ה-CHECK על customer_crm_activity.action כולל את כל 11 הערכים ────────
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
    and pg_get_constraintdef(oid) like '%archived%'
    and pg_get_constraintdef(oid) like '%unarchived%'
    and pg_get_constraintdef(oid) like '%retention_hold_changed%';
  if v_check <> 1 then
    raise exception
      '0032: ה-CHECK על customer_crm_activity.action אינו מכיל את כל הערכים — ערך ישן נמחק או retention_hold_changed לא נוסף.'
      using errcode = 'P0103';
  end if;

  -- 🔒 ההגנה שעליה כל שלוש עמודות ה-retention נשענות: revoke update על
  -- **כל הטבלה** מ-0010, שמכסה גם עמודות שנוספו אחריו בלי צורך בפעולה
  -- נוספת. אם הוא ייחלש אי-פעם, שלוש עמודות ה-hold נחשפות ל-UPDATE ישיר.
  if has_table_privilege('anon', 'public.customers', 'UPDATE')
     or has_table_privilege('authenticated', 'public.customers', 'UPDATE') then
    raise exception
      '0032: anon/authenticated עדיין יכולים UPDATE על customers — ההגנה על עמודות ה-retention (ומכל שאר הטבלה) נשענת על revoke זה.'
      using errcode = 'P0103';
  end if;

  -- 🔒 9B.1 — get_crm_customer מוחלפת (CREATE OR REPLACE) כדי להוסיף שני
  -- שדות לתוצאה, בלי לגעת בחתימה (uuid) או בטיפוס ההחזרה (jsonb). Postgres
  -- אוסר CREATE OR REPLACE שמשנה את טיפוס ההחזרה — ולכן אילו 0009/0010/0028
  -- היו מכריזות עליה עם טיפוס אחר, המיגרציה הזו הייתה נכשלת מיידית ברעש
  -- (לא בשקט). הבדיקה כאן מוודאת במפורש שהתוצאה עדיין jsonb.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type t      on t.oid = p.prorettype
    where n.nspname = 'public' and p.proname = 'get_crm_customer'
      and pg_get_function_identity_arguments(p.oid) = 'p_customer_id uuid'
      and t.typname = 'jsonb'
  ) then
    raise exception '0032: get_crm_customer(uuid) אינה מחזירה jsonb כמצופה' using errcode = 'P0103';
  end if;

  -- 🔒 אף פונקציה ב-0032 אינה SECURITY DEFINER. כל שש הפונקציות (חדשות +
  -- get_crm_customer שהוחלפה) רצות כ-INVOKER — service_role בלבד ממילא
  -- (ר' בלוק ההרשאות למעלה), ואין צורך ב-SECURITY DEFINER וב-SET search_path
  -- הנלווה אליו. בדיקה זו נכשלת אם מישהו יוסיף SECURITY DEFINER בעתיד בלי
  -- לחשוב מחדש על הגנת search_path.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'notification_is_terminal', 'set_customer_retention_hold',
        'privacy_retention_dry_run',
        'privacy_retention_purge_otp_sessions',
        'privacy_retention_purge_notification_attempts',
        'privacy_retention_reset_old_notes', 'get_crm_customer'
      )
      and p.prosecdef
  ) then
    raise exception '0032: פונקציה הוגדרה כ-SECURITY DEFINER ללא צורך/הגנת search_path נלווית'
      using errcode = 'P0103';
  end if;

  raise notice '0032: עמודות retention_hold, ה-CHECK המורחב, ה-FK, ה-revoke הקיים על customers, טיפוס ההחזרה של get_crm_customer, והיעדר SECURITY DEFINER — כולם תקינים.';
end $$;
