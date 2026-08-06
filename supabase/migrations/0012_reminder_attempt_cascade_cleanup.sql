-- ============================================================================
-- 0012 — תיקון: מחיקת cascade של רשומות ניסיון
--
-- ⚠️ זהו תיקון של **שלב 11**. מספר ה-migration אינו מספר שלב המוצר, ואין
-- כאן שום יכולת חדשה: לא ספק, לא SMS, לא Cron, לא 019.
--
-- 0001–0011 כבר רצו בפרויקט Supabase האמיתי. הקובץ הזה אינו משנה ואינו
-- מוחק דבר ממה שנוצר שם, פרט להחלפת גוף הפונקציה
-- reject_reminder_attempt_mutation. הטריגר עצמו נשאר כפי שהוא.
--
-- ─── הבאג ─────────────────────────────────────────────────────────────────
--
-- 0011 חלק 4 חסם DELETE על appointment_reminder_attempts ללא תנאי:
--
--     if tg_op = 'DELETE' then
--       raise exception 'REMINDER_ATTEMPTS_APPEND_ONLY: אין למחוק רשומת ניסיון';
--
-- הכוונה הייתה נכונה — אודיט אינו נמחק. אבל טריגר שורה נורה **גם על
-- מחיקת cascade**, ושרשרת ה-FK היא:
--
--     customers ←(restrict)— appointments ←(cascade)— appointment_reminders
--                                          ←(cascade)— appointment_reminder_attempts
--
-- ולכן רשומת ניסיון אחת הפכה את ה-reminder, את ה-appointment כולו, ובעקיפין
-- גם את ה-customer (ה-FK הוא restrict — אי אפשר למחוק לקוחה עם תורים)
-- לבלתי ניתנים למחיקה. לצמיתות. אין דרך לעקוף טריגר BEFORE DELETE שזורק.
--
-- התוצאה המעשית: אי אפשר היה להריץ ולו בדיקת dispatch חיה אחת שיוצרת
-- ניסיון אמיתי ולנקות אחריה — כל ריצה כזו הייתה משאירה בייצור תור שאי
-- אפשר למחוק.
--
-- ─── התיקון ───────────────────────────────────────────────────────────────
--
-- הטריגר מבחין בין שני סוגי מחיקה לפי **מצב העולם**, ולא לפי דגל:
--
--   ה-parent reminder עדיין קיים  → מחיקה ישירה של אודיט  → נדחה.
--   ה-parent reminder כבר אינו קיים → זו מחיקת cascade      → מותרת.
--
-- ⚠️ למה זה עובד: FK עם ON DELETE CASCADE ממומש כטריגר AFTER על טבלת האב.
-- כשהוא מריץ את מחיקת הבנים, שורת האב כבר נמחקה **באותה טרנזקציה**, ולכן
-- ה-SELECT שבתוך הטריגר אינו רואה אותה. במחיקה ישירה של רשומת ניסיון איש
-- לא נגע באב, והוא נראה — ולכן היא נדחית.
--
-- ⚠️ **אין כאן session flag, GUC, משתנה סביבה או פרמטר שה-route יכול
-- לשלוט בו.** ההבחנה נגזרת ממצב הנתונים בלבד. route שירצה למחוק אודיט
-- ייאלץ למחוק את ה-reminder עצמו — כלומר לוותר על כל השורה, לא לגזום ממנה
-- את העקבות. זו בדיוק ההבחנה שאודיט אמור לאכוף.
--
-- מה **לא** משתנה: כללי ה-UPDATE נשארים מילה במילה — ניסיון נסגר פעם אחת,
-- וזהותו אינה ניתנת לשינוי.
-- ============================================================================


-- ============================================================================
-- חלק 1 — הפונקציה
--
-- ⚠️ create or replace על הפונקציה הקיימת. הטריגר reminder_attempts_close_once
-- מצביע עליה בשם ולכן ממשיך לעבוד — אין DROP ואין CREATE TRIGGER, וכך אין
-- חלון זמן שבו הטבלה חשופה בלי הגנה.
--
-- ⚠️ אין כאן EXCEPTION WHEN OTHERS ואין בליעת שגיאות, בדיוק כמו ב-0011.
-- ============================================================================

create or replace function public.reject_reminder_attempt_mutation()
returns trigger
language plpgsql
-- 🔒 SECURITY DEFINER — נדרש, ולא נוחות.
--
-- ⚠️ RLS מופעל על appointment_reminders ואין עליה ולו policy אחת. לכן
-- תפקיד שאינו עוקף RLS מקבל **אפס שורות** מה-SELECT שלמטה, גם כשהאב קיים
-- בפועל — והטריגר היה מסיק "זו מחיקת cascade" ומתיר מחיקה ישירה של אודיט.
-- ההגנה כולה הייתה נשמטת בשקט.
--
-- בייצור ל-service_role יש BYPASSRLS ולכן הוא היה נחסם כראוי, אבל הגנה
-- שנשענת על תכונה של תפקיד מסוים אינה הגנה. עם SECURITY DEFINER הבדיקה רצה
-- תמיד כבעלת הטבלה, שעוקפת RLS (לא הופעל FORCE ROW LEVEL SECURITY), ולכן
-- התוצאה זהה לכל תפקיד קורא.
--
-- ⚠️ הפונקציה אינה מקבלת קלט משתמש ואינה בונה SQL דינמי; search_path ננעל
-- כדי שלא ניתן יהיה להחליף את המשמעות של appointment_reminders.
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- ⚠️ ההבחנה כולה. ראה ההסבר בראש הקובץ.
    --
    -- קיים אב  = מישהו מוחק אודיט ומשאיר את התזכורת → אסור.
    -- אין אב   = ה-FK מנקה אחרי מחיקת התזכורת/התור   → מותר.
    if exists (
      select 1 from public.appointment_reminders where id = old.reminder_id
    ) then
      raise exception
        'REMINDER_ATTEMPTS_APPEND_ONLY: אין למחוק רשומת ניסיון כל עוד התזכורת קיימת'
        using errcode = 'P0301';
    end if;

    return old;
  end if;

  -- ── מכאן ומטה: UPDATE. זהה ל-0011, ובכוונה. ────────────────────────────

  -- ניסיון שכבר נסגר הוא סופי. worker ישן שחזר מאוחר נעצר כאן.
  if old.finished_at is not null then
    raise exception 'REMINDER_ATTEMPTS_APPEND_ONLY: ניסיון % של תזכורת % כבר נסגר',
      old.attempt_number, old.reminder_id using errcode = 'P0301';
  end if;

  -- זהות הניסיון אינה ניתנת לשינוי — רק סגירתו.
  if new.reminder_id    is distinct from old.reminder_id
     or new.attempt_number is distinct from old.attempt_number
     or new.provider       is distinct from old.provider
     or new.started_at     is distinct from old.started_at
     or new.worker_id      is distinct from old.worker_id
     or new.created_at     is distinct from old.created_at then
    raise exception 'REMINDER_ATTEMPTS_APPEND_ONLY: אין לשנות את זהות הניסיון'
      using errcode = 'P0301';
  end if;

  -- העדכון היחיד המותר הוא סגירה בפועל.
  if new.finished_at is null or new.outcome is null then
    raise exception 'REMINDER_ATTEMPTS_APPEND_ONLY: העדכון היחיד המותר הוא סגירת הניסיון'
      using errcode = 'P0301';
  end if;

  return new;
end;
$$;

comment on function public.reject_reminder_attempt_mutation() is
  'אודיט append-only: ניסיון נסגר פעם אחת בלבד, וזהותו אינה משתנה. מחיקה ישירה נדחית; מחיקת cascade (אחרי שהתזכורת נמחקה) מותרת, אחרת ניסיון אחד היה הופך תור שלם לבלתי ניתן למחיקה.';


-- ============================================================================
-- חלק 2 — assertions מבניות
-- ============================================================================

do $$
begin
  -- 🔒 בלי SECURITY DEFINER בדיקת קיום האב נשמטת תחת RLS, וההגנה על האודיט
  -- נעלמת בשקט. ראה ההערה על הפונקציה.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'reject_reminder_attempt_mutation'
      and p.prosecdef
  ) then
    raise exception '0012: reject_reminder_attempt_mutation אינה SECURITY DEFINER'
      using errcode = 'P0102';
  end if;

  -- הטריגר עדיין קיים, ועדיין מכסה גם UPDATE וגם DELETE
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointment_reminder_attempts'::regclass
      and tgname = 'reminder_attempts_close_once'
      and not tgisinternal
  ) then
    raise exception '0012: טריגר reminder_attempts_close_once אינו קיים'
      using errcode = 'P0104';
  end if;

  -- ה-FK עדיין ON DELETE CASCADE — התיקון מסתמך עליו
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointment_reminder_attempts'::regclass
      and contype = 'f' and confdeltype = 'c'
  ) then
    raise exception '0012: ה-FK של appointment_reminder_attempts אינו ON DELETE CASCADE'
      using errcode = 'P0104';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointment_reminders'::regclass
      and contype = 'f' and confdeltype = 'c'
  ) then
    raise exception '0012: ה-FK של appointment_reminders אינו ON DELETE CASCADE'
      using errcode = 'P0104';
  end if;
end $$;


-- ============================================================================
-- חלק 3 — assertion התנהגותית
--
-- ⚠️ בונה שרשרת נתונים אמיתית, מוכיח את ארבע ההתנהגויות, ואז **מגלגל את
-- הכול לאחור** ע"י raise בתוך תת-טרנזקציה. אחרי החלק הזה לא נשארת ולו שורה
-- אחת ממנו בבסיס הנתונים.
--
-- ⚠️ ערכי המשתנים ב-plpgsql אינם טרנזקציוניים — הם שורדים את הגלגול לאחור,
-- ולכן אפשר לבדוק אותם אחרי שהנתונים כבר נעלמו. זה מה שהופך את הבדיקה
-- לאפשרית בלי להשאיר זבל.
--
-- ⚠️ שנת 2099 ו-status='pending' נבחרו כדי לא להתנגש ב-appointments_no_overlap
-- ובכוונה לא להפעיל את הטריגר שיוצר תזכורות — התזכורת כאן נוצרת ידנית, כי
-- הנבדק הוא מחיקה ולא יצירה.
-- ============================================================================

do $$
declare
  v_cust    uuid := gen_random_uuid();
  v_appt    uuid;
  v_rem     uuid;
  v_direct_blocked boolean := false;
  v_cascade_rem    boolean := false;
  v_cascade_appt   boolean := false;
  v_cust_deleted   boolean := false;
  v_left     integer;
begin
  begin
    insert into public.customers (id, phone_e164, full_name)
      values (v_cust, '+972500000012', '0012 self-test');

    insert into public.appointments
      (customer_id, service_key, variants, price_total, starts_at, duration_min, status)
    values
      (v_cust, '0012-self-test', array['0012'], 0,
       timestamptz '2099-01-01 09:00:00+02', 30, 'pending')
    returning id into v_appt;

    insert into public.appointment_reminders
      (appointment_id, reminder_kind, appointment_starts_at, scheduled_for, expires_at)
    values
      (v_appt, 'day_before', timestamptz '2099-01-01 09:00:00+02',
       timestamptz '2098-12-31 09:00:00+02', timestamptz '2098-12-31 15:00:00+02')
    returning id into v_rem;

    insert into public.appointment_reminder_attempts
      (reminder_id, attempt_number, provider) values (v_rem, 1, 'disabled');

    -- ── 1. מחיקה ישירה של אודיט, כשהתזכורת קיימת → חייבת להידחות ─────────
    begin
      delete from public.appointment_reminder_attempts where reminder_id = v_rem;
      v_direct_blocked := false;
    exception when sqlstate 'P0301' then
      v_direct_blocked := true;
    end;

    -- ── 2. מחיקת התזכורת → cascade מנקה את האודיט ────────────────────────
    delete from public.appointment_reminders where id = v_rem;
    select count(*)::integer into v_left
      from public.appointment_reminder_attempts where reminder_id = v_rem;
    v_cascade_rem := (v_left = 0);

    -- ── 3. מחיקת התור → cascade מנקה תזכורות ואודיט ──────────────────────
    insert into public.appointment_reminders
      (appointment_id, reminder_kind, appointment_starts_at, scheduled_for, expires_at)
    values
      (v_appt, 'two_hours_before', timestamptz '2099-01-01 09:00:00+02',
       timestamptz '2099-01-01 07:00:00+02', timestamptz '2099-01-01 08:45:00+02')
    returning id into v_rem;

    insert into public.appointment_reminder_attempts
      (reminder_id, attempt_number, provider) values (v_rem, 1, 'disabled');

    delete from public.appointment_history where appointment_id = v_appt;
    delete from public.appointments where id = v_appt;

    select count(*)::integer into v_left
      from public.appointment_reminder_attempts where reminder_id = v_rem;
    v_cascade_appt := (v_left = 0);

    -- ── 4. מחיקת הלקוחה → שרשרת הניקוי כולה עוברת ────────────────────────
    delete from public.customers where id = v_cust;
    v_cust_deleted := not exists (select 1 from public.customers where id = v_cust);

    -- גלגול לאחור של כל מה שנוצר כאן.
    raise exception 'ROLLBACK_0012_SELF_TEST';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_0012_SELF_TEST' then
        raise;
      end if;
  end;

  if not v_direct_blocked then
    raise exception '0012: מחיקה ישירה של רשומת ניסיון לא נדחתה' using errcode = 'P0104';
  end if;
  if not v_cascade_rem then
    raise exception '0012: מחיקת תזכורת לא ניקתה את רשומות הניסיון' using errcode = 'P0104';
  end if;
  if not v_cascade_appt then
    raise exception '0012: מחיקת תור לא ניקתה תזכורות ורשומות ניסיון' using errcode = 'P0104';
  end if;
  if not v_cust_deleted then
    raise exception '0012: לא ניתן היה למחוק את הלקוחה בסוף השרשרת' using errcode = 'P0104';
  end if;

  raise notice '0012: ארבע התנהגויות המחיקה אומתו, וכל נתוני הבדיקה גולגלו לאחור';
end $$;


-- ============================================================================
-- חלק 4 — אין נתוני בדיקה שנשארו
--
-- ⚠️ החגורה השנייה מעל הגלגול לאחור: אם משום מה משהו כן נשאר, המיגרציה
-- נופלת כאן ולא מדווחת Success.
-- ============================================================================

do $$
declare v_count integer;
begin
  select count(*)::integer into v_count
    from public.customers where full_name = '0012 self-test';
  if v_count <> 0 then
    raise exception '0012: נשארו % שורות בדיקה — הגלגול לאחור לא עבד', v_count
      using errcode = 'P0104';
  end if;

  select count(*)::integer into v_count
    from public.appointments where service_key = '0012-self-test';
  if v_count <> 0 then
    raise exception '0012: נשארו % תורי בדיקה', v_count using errcode = 'P0104';
  end if;

  -- אודיט יתום אינו אפשרי (ה-FK אוכף), אבל נבדק במפורש
  select count(*)::integer into v_count
  from public.appointment_reminder_attempts a
  where not exists (select 1 from public.appointment_reminders r where r.id = a.reminder_id);
  if v_count <> 0 then
    raise exception '0012: נמצאו % רשומות ניסיון יתומות', v_count using errcode = 'P0104';
  end if;
end $$;
