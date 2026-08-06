-- ============================================================================
-- 0011 — מערכת תזכורות לתורים
--
-- 0001–0010 כבר רצו בפרויקט Supabase האמיתי. הקובץ הזה הוא migration חדש
-- בלבד: הוא אינו משנה ואינו מוחק דבר ממה שנוצר שם, פרט לשני CHECK
-- constraints על admin_idempotency שמורחבים בחלק 8 (ומאותרים לפי התוכן
-- שלהם, לא לפי שם שניחשנו — אותו דפוס כמו חלק 4 של 0010).
--
-- ─── מה השלב הזה עושה ─────────────────────────────────────────────────────
--
--   1. שתי טבלאות: תזכורות מתוזמנות, ואודיט של כל ניסיון שליחה.
--   2. חישוב מועד התזכורת ב-SQL מול Asia/Jerusalem — לא בהחסרת 24 שעות.
--   3. טריגר יחיד על appointments שמכסה את *כל* מסלולי היצירה והשינוי.
--   4. lease, recovery, retries עם backoff, ומניעת שליחה כפולה.
--
-- ─── מה השלב הזה במפורש אינו עושה ─────────────────────────────────────────
--
-- אין חיבור ל-019, אין SMS אמיתי, אין sender, אין טוקן, אין סוד בקוד, אין
-- Vercel Cron, אין deployment, אין WhatsApp, ואין שינוי בזרימת ה-OTP.
--
-- ⚠️ שליחה אמיתית אינה רק "כבויה בקוד" — היא **בלתי אפשרית ברמת הסכמה**.
-- ראה reminders_sent_requires_live_provider בחלק 2.
-- ============================================================================


-- ============================================================================
-- חלק 1 — טיפוסים
--
-- ⚠️ אלה CREATE TYPE ולא ALTER TYPE ... ADD VALUE, ולכן אין כאן את המלכודת
-- שאילצה את פיצול 0002/0003: ערך של enum *חדש* ניתן לשימוש מיד באותה
-- טרנזקציה, כולל ב-backfill שבסוף הקובץ.
-- ============================================================================

create type reminder_kind as enum (
  'day_before',        -- אותה שעת קיר, יום קלנדרי קודם (Asia/Jerusalem)
  'two_hours_before',  -- שעתיים אמיתיות לפני התור
  'manual'             -- שליחה יזומה של מנהלת
);

create type reminder_status as enum (
  'scheduled',         -- מתוזמנת, טרם נתפסה
  'retrying',          -- ניסיון קודם נכשל זמנית; ממתינה ל-next_attempt_at
  'processing',        -- יש lease פעיל של worker
  'sent',              -- ספק *אמיתי* קיבל את ההודעה
  'simulated',         -- ספק שאינו אמיתי "קיבל" אותה. לא נשלח SMS.
  'failed',            -- שגיאה קבועה, מיצוי ניסיונות, או חלון retry שנסגר
  'delivery_unknown',  -- תוצאת ספק עמומה. סופי — אין retry אוטומטי.
  'cancelled',         -- התור אינו confirmed יותר
  'superseded',        -- starts_at השתנה; snapshot חדש תפס את מקומה
  'skipped'            -- החלון נסגר לפני שהייתה הזדמנות לשלוח
);

-- outcome של ניסיון בודד. שונה מסטטוס התזכורת בכוונה: התזכורת מתארת
-- "איפה הדבר עומד", והניסיון מתאר "מה קרה בפעם הזו".
create type reminder_attempt_outcome as enum (
  'accepted',             -- הספק קיבל (ספק אמיתי)
  'simulated',            -- הספק "קיבל" בלי לשלוח (disabled/simulated/fake)
  'retryable_error',
  'permanent_error',
  'delivery_unknown',
  'aborted_precondition', -- נבדק מחדש לפני השליחה והתנאים כבר לא התקיימו
  'lease_expired'         -- ה-worker נקטע ולא סגר את הניסיון בעצמו
);


-- ============================================================================
-- חלק 2 — appointment_reminders
--
-- שורה אחת = תזכורת אחת עבור **snapshot מסוים** של התור. ה-snapshot הוא
-- (appointment_id, reminder_kind, appointment_starts_at), והוא מה שהופך
-- הזזה לאירוע שאפשר לדבר עליו: התזכורות של המועד הישן אינן נמחקות ואינן
-- נשלחות — הן מסומנות superseded, והמועד החדש מקבל שורות משלו.
--
-- ⚠️ מה שלא נשמר כאן, ולא במקרה: גוף הודעה, שם לקוחה, מספר טלפון, תגובת
-- ספק גולמית, access token, מפתח idempotency של פעולה אחרת, Google payload.
-- ה-worker טוען את פרטי הלקוחה בנפרד ורק ברגע שהוא באמת עומד לשלוח.
-- ============================================================================

create table public.appointment_reminders (
  id                     uuid primary key default gen_random_uuid(),

  appointment_id         uuid not null
                         references public.appointments(id) on delete cascade,

  reminder_kind          reminder_kind not null,

  -- ה-snapshot. אינו נגזר מ-appointments בזמן קריאה בכוונה: אחרי הזזה
  -- הערך כאן עדיין מתאר את המועד שעבורו התזכורת הזו נקבעה.
  appointment_starts_at  timestamptz not null,

  scheduled_for          timestamptz not null,
  expires_at             timestamptz not null,

  template_version       text not null default 'v1'
                         check (template_version ~ '^v[0-9]{1,3}$'),

  status                 reminder_status not null default 'scheduled',

  attempt_count          integer not null default 0 check (attempt_count >= 0),
  next_attempt_at        timestamptz,

  processing_started_at  timestamptz,
  lease_token            uuid,
  lease_expires_at       timestamptz,

  -- ⚠️ תזכורת ב-processing אינה נחטפת מתחת ל-worker. במקום זה נרשם כאן
  -- זמן, וה-worker מאמת מחדש לפני השליחה ומפסיק בעצמו.
  cancel_requested_at    timestamptz,

  -- ⚠️ **בדיקת פורמט ולא רשימה סגורה**, ובכוונה.
  --
  -- רשימה סגורה הייתה מחייבת אחד משניים, ושניהם רעים: או להכניס ערך בדיקה
  -- קבוע לסכמת הייצור רק כדי שאפשר יהיה לזרוע אותו בבדיקות, או לשנות CHECK
  -- בשלב 12 רק כדי להכיר שם חדש. הפורמט מתיר לשלב 12 להוסיף ספק בלי שינוי
  -- סכמה, ומתיר לבדיקות לזרוע ערך משלהן בלי שהוא יופיע בקוד או בייצור.
  --
  -- ⚠️ הפורמט דורש **אות** ראשונה, ולכן '019' עצמו אינו ערך חוקי. שם הספק
  -- של שלב 12 נקבע לכן ל-'sms_019', והוא יעבור בלי שינוי סכמה. אין לשנות
  -- את ה-CHECK כדי לאפשר שם שמתחיל בספרה.
  --
  -- ההגנה האמיתית אינה ברשימת השמות אלא ב-CHECK שמתחת: 'sent' מותר רק
  -- כאשר הספק אינו אחד משלושת השמות שאינם חיים. ובנוסף — אף מסלול ריצה
  -- אינו מקבל provider מהלקוח, ו-resolveReminderProvider יודעת להחזיר רק
  -- 'disabled' או 'simulated'.
  provider               text not null default 'disabled'
                         check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),

  provider_message_id    text,

  -- קודים מסוננים בלבד. התבנית עצמה היא ההגנה: הודעת שגיאה חופשית של ספק,
  -- או טלפון, לא יכולים לעבור אותה.
  last_error_code        text check (last_error_code ~ '^[a-z0-9_]{1,60}$'),
  outcome_reason         text check (outcome_reason ~ '^[a-z0-9_]{1,60}$'),

  sent_at                timestamptz,
  cancelled_at           timestamptz,

  created_by_admin_id    uuid references auth.users(id),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint reminders_window_valid check (expires_at > scheduled_for),

  -- 🔒 הדרישה המרכזית של השלב, כ-constraint ולא כמוסכמה בקוד:
  -- אי אפשר לסמן הודעה כ-SMS אמיתי שנשלח כאשר הספק אינו אמיתי.
  -- שלושת הערכים המותרים כרגע ב-provider הם בדיוק שלושת אלה, ולכן
  -- status='sent' הוא **בלתי אפשרי** בשלב 11. שלב 12 ירחיב את ה-CHECK
  -- של provider, וזה הרגע היחיד שבו שליחה אמיתית הופכת לאפשרית.
  constraint reminders_sent_requires_live_provider
    check (status <> 'sent' or provider not in ('disabled', 'simulated', 'fake')),

  -- manual היא היחידה שיש לה יוזם אנושי, והיא חייבת אחד.
  constraint reminders_manual_has_admin
    check (
      (reminder_kind = 'manual'  and created_by_admin_id is not null)
      or
      (reminder_kind <> 'manual' and created_by_admin_id is null)
    )
);

comment on table public.appointment_reminders is
  'תזכורות מתוזמנות לתורים. אין בה גוף הודעה, שם, טלפון או תגובת ספק — רק מזהים, זמנים וסטטוס.';
comment on column public.appointment_reminders.appointment_starts_at is
  'snapshot של starts_at בזמן שהתזכורת נקבעה. שינוי מועד אינו מעדכן אותו — הוא מייצר שורה חדשה ומסמן את הישנה superseded.';
comment on column public.appointment_reminders.cancel_requested_at is
  'בקשת ביטול לתזכורת שכבר ב-processing. ה-worker מאמת מחדש ומפסיק בעצמו; אין חטיפה של lease פעיל.';
comment on column public.appointment_reminders.provider is
  'הספק שטיפל בניסיון האחרון. disabled = לא נשלח כלום. שלב 12 ירחיב את ה-CHECK.';
comment on column public.appointment_reminders.last_error_code is
  'קוד מסונן בלבד ([a-z0-9_]). לעולם לא הודעת שגיאה חופשית של ספק ולא תגובה גולמית.';

-- ─── אינדקסים ──────────────────────────────────────────────────────────────

-- 🔒 מפתח ה-idempotency של היצירה. אותו update שמגיע פעמיים אינו יוצר
-- שורה שנייה, ואותו snapshot אינו יכול להתקיים פעמיים.
-- manual מוחרגת: מנהלת רשאית לשלוח ידנית יותר מפעם אחת.
create unique index appointment_reminders_snapshot_uniq
  on public.appointment_reminders (appointment_id, reminder_kind, appointment_starts_at)
  where reminder_kind <> 'manual';

-- ⚠️ coalesce(next_attempt_at, scheduled_for) הוא IMMUTABLE (שתי העמודות
-- כבר timestamptz), ולכן מותר בביטוי של אינדקס. זה בדיוק הביטוי שבשאילתת
-- ה-claim, כדי שהיא לא תיפול ל-seq scan כשיצטברו תזכורות.
create index appointment_reminders_due_idx
  on public.appointment_reminders (coalesce(next_attempt_at, scheduled_for))
  where status in ('scheduled', 'retrying');

create index appointment_reminders_lease_idx
  on public.appointment_reminders (lease_expires_at)
  where status = 'processing';

create index appointment_reminders_appt_idx
  on public.appointment_reminders (appointment_id, scheduled_for);

create trigger appointment_reminders_touch
  before update on public.appointment_reminders
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- חלק 3 — appointment_reminder_attempts
--
-- אודיט של כל ניסיון שליחה.
--
-- ⚠️ שורה נפתחת ב-started_at ונסגרת בעדכון יחיד. **לא** שורה אחת בסוף:
-- worker שקרס באמצע ניסיון לא היה משאיר שום עקבה — וזה בדיוק המקרה שבגללו
-- האודיט קיים. הטריגר בחלק 4 אוכף שהמעבר הזה קורה לכל היותר פעם אחת.
-- ============================================================================

create table public.appointment_reminder_attempts (
  id                   bigserial primary key,

  reminder_id          uuid not null
                       references public.appointment_reminders(id) on delete cascade,

  attempt_number       integer not null check (attempt_number >= 1),

  -- בדיקת פורמט — ראה ההערה על אותה עמודה ב-appointment_reminders.
  provider             text not null
                       check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),

  -- ה-lease token של ה-worker שביצע. זהו מזהה ההרצה, לא מזהה משתמש.
  worker_id            uuid,

  started_at           timestamptz not null default now(),
  finished_at          timestamptz,

  outcome              reminder_attempt_outcome,

  error_code           text check (error_code ~ '^[a-z0-9_]{1,60}$'),
  provider_message_id  text,

  created_at           timestamptz not null default now(),

  constraint reminder_attempts_number_uniq unique (reminder_id, attempt_number),

  -- סגירה היא הכול-או-כלום: או ששני השדות ריקים (ניסיון פתוח), או ששניהם
  -- מלאים (ניסיון סגור). אין מצב ביניים שמשקר על מה שקרה.
  constraint reminder_attempts_closed_together
    check ((finished_at is null) = (outcome is null))
);

comment on table public.appointment_reminder_attempts is
  'אודיט לכל ניסיון שליחה. אין בה טלפון, שם, תוכן הודעה, raw error, תגובת ספק גולמית או סודות.';
comment on column public.appointment_reminder_attempts.worker_id is
  'ה-lease token של ההרצה שביצעה את הניסיון. מזהה הרצה, לא מזהה אדם.';

create index appointment_reminder_attempts_reminder_idx
  on public.appointment_reminder_attempts (reminder_id, attempt_number);


-- ============================================================================
-- חלק 4 — שמירת האודיט
--
-- ⚠️ אין כאן EXCEPTION WHEN OTHERS ואין בליעת שגיאות. הפרה של הכללים
-- מפילה את הטרנזקציה — אודיט ששותק על שינוי אסור אינו אודיט.
-- ============================================================================

create or replace function public.reject_reminder_attempt_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'REMINDER_ATTEMPTS_APPEND_ONLY: אין למחוק רשומת ניסיון'
      using errcode = 'P0301';
  end if;

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

create trigger reminder_attempts_close_once
  before update or delete on public.appointment_reminder_attempts
  for each row execute function public.reject_reminder_attempt_mutation();


-- ============================================================================
-- חלק 5 — חישוב זמנים
--
-- ⚠️ STABLE ולא IMMUTABLE: `at time zone` תלוי במסד נתוני אזורי הזמן, ולכן
-- אינו IMMUTABLE לפי Postgres. זה גם מדוע הערכים נכתבים לעמודות בזמן
-- היצירה ולא מחושבים כעמודה מחושבת — בדיוק מאותו טעם שבגללו ends_at נכתב
-- ע"י טריגר ב-0001 ולא כ-generated column.
-- ============================================================================

-- ─── מתי לשלוח ─────────────────────────────────────────────────────────────
--
-- day_before = **אותה שעת קיר, יום קלנדרי קודם בישראל**, ולא החסרת 24 שעות.
-- ההבדל אינו תיאורטי. תור ביום א׳ 25.10.2026 בשעה 10:00 (שעון חורף):
--   נכון  — ((ts at time zone IL) - interval '1 day') at time zone IL
--           → שבת 24.10 בשעה 10:00 בישראל  (25 שעות אמיתיות לפני)
--   שגוי  — ts - interval '24 hours'
--           → שבת 24.10 בשעה 09:00 בישראל
--
-- שעה שאינה קיימת במעבר לשעון קיץ (02:00–03:00, לילה אחד בשנה) נפתרת ע"י
-- Postgres דטרמיניסטית ואינה זורקת. רלוונטי רק לתור ידני מחוץ לשעות
-- הפעילות; במקרה כזה התזכורת תצא בהיסט של שעה, ולעולם לא תיכשל ולא תוכפל.
create or replace function public.reminder_scheduled_for(
  p_kind       reminder_kind,
  p_starts_at  timestamptz,
  p_created_at timestamptz
) returns timestamptz
language sql
stable
as $$
  select case p_kind
    when 'day_before' then
      ((p_starts_at at time zone 'Asia/Jerusalem') - interval '1 day')
        at time zone 'Asia/Jerusalem'
    when 'two_hours_before' then
      p_starts_at - interval '2 hours'
    when 'manual' then
      p_created_at
  end;
$$;

-- ─── עד מתי זה עדיין הגיוני לשלוח ──────────────────────────────────────────
--
-- day_before: שש שעות אחרי המועד. תזכורת "ליום לפני" שיוצאת חצי יום באיחור
--   עדיין שימושית; כזו שיוצאת שעה לפני התור כבר מטעה. שש שעות אחרי המועד
--   הן תמיד לפחות ~18 שעות לפני התור, ולכן אין שום חפיפה עם תזכורת השעתיים.
--
-- two_hours_before: עד רבע שעה לפני התור. "בעוד שעתיים" שמגיע בעשר דקות
--   לפני הוא פשוט לא נכון.
--
-- manual: עד תחילת התור. מנהלת שולחת ידנית, והיא זו שבוחרת מתי — אין
--   סיבה שהמערכת תצמצם לה את החלון מעבר לתור עצמו.
create or replace function public.reminder_expires_at(
  p_kind          reminder_kind,
  p_starts_at     timestamptz,
  p_scheduled_for timestamptz
) returns timestamptz
language sql
-- ⚠️ STABLE ולא IMMUTABLE, למרות שהחישוב נראה טהור: האופרטור
-- `timestamptz + interval` עצמו הוא STABLE ב-Postgres (interval עם
-- חודשים/ימים תלוי באזור הזמן של הסשן). הצהרת IMMUTABLE הייתה עוברת בשקט —
-- Postgres אינו מאמת אותה — ומשקרת למתכנן. אין כאן צורך ב-IMMUTABLE:
-- הפונקציה אינה משמשת בשום אינדקס או constraint.
stable
as $$
  select case p_kind
    when 'day_before'       then p_scheduled_for + interval '6 hours'
    when 'two_hours_before' then p_starts_at - interval '15 minutes'
    when 'manual'           then p_starts_at
  end;
$$;


-- ============================================================================
-- חלק 6 — היצירה והביטול: טריגר אחד שמכסה את כל המסלולים
--
-- ⚠️ למה טריגר ולא קריאות מפוזרות ב-TS: יש **שבעה** מסלולים שמגיעים לאותו
-- מצב — אישור בקשה, תור ידני, הזזה ע"י לקוחה, ביטול ע"י לקוחה, הזזה
-- מ-Google, ביטול מ-Google, ותפוגת pending. כולם, בלי יוצא מן הכלל,
-- מסתיימים ב-INSERT או UPDATE על appointments. נקודה אחת מכסה את כולם,
-- ומכסה גם את ה-backfill ואת כל מסלול עתידי.
--
-- ⚠️ **אין כאן EXCEPTION WHEN OTHERS.** הפונקציה רצה בתוך הטרנזקציה של
-- פעולות עסקיות (reschedule_appointment_by_customer וכו'), ולכן היא בנויה
-- לא לזרוק על מצבים *צפויים* — התנגשות snapshot נפתרת ב-ON CONFLICT,
-- ומעבר סטטוס שכבר בוצע הוא no-op. אבל שגיאת סכמה, constraint לא צפוי או
-- corruption **חייבים** להפיל את הטרנזקציה. תור confirmed שנשאר בשקט בלי
-- תזכורות גרוע מפעולה שנכשלה בקול.
--
-- Google echo אינו מגיע לכאן כלל: מסלול ה-echo ב-apply_google_reschedule
-- מבצע אפס כתיבות על appointments, ולכן הטריגר אינו נורה.
-- ============================================================================

create or replace function public.sync_appointment_reminders(
  p_appointment_id uuid
) returns void
language plpgsql
as $$
declare
  v_appt      public.appointments;
  v_kind      reminder_kind;
  v_sched     timestamptz;
  v_expires   timestamptz;
  v_status    reminder_status;
  v_reason    text;
  v_now       timestamptz := now();
begin
  select * into v_appt from public.appointments where id = p_appointment_id;
  if v_appt.id is null then
    -- השורה נמחקה בין הטריגר לקריאה. אין מה לסנכרן, וזה אינו מצב שגיאה.
    return;
  end if;

  -- ── התור אינו confirmed ────────────────────────────────────────────────
  --
  -- ⚠️ הרשימה אינה מומצאת ואינה מונה סטטוסים בשם. הכלל נגזר ישירות
  -- מה-enum appointment_status: **כל מה שאינו confirmed מבטל**. כך גם ערך
  -- שיתווסף ל-enum בעתיד מכוסה אוטומטית, ואי אפשר לפספס אחד.
  -- (למען הסר ספק: אין ערך 'rejected' ב-enum — דחיית בקשה נרשמת
  --  כ-cancelled_by_business, ראה reject_pending_appointment ב-0004.)
  if v_appt.status <> 'confirmed' then
    v_reason := case v_appt.status
      when 'cancelled_by_customer' then 'appointment_cancelled_by_customer'
      when 'cancelled_by_business' then 'appointment_cancelled_by_business'
      when 'completed'             then 'appointment_completed'
      when 'no_show'               then 'appointment_no_show'
      when 'expired'               then 'appointment_expired'
      when 'rescheduled'           then 'appointment_rescheduled'
      when 'pending'               then 'appointment_not_confirmed'
      else 'appointment_not_confirmed'
    end;

    -- תזכורת שכבר ב-processing אינה נחטפת: נרשמת בקשת ביטול, וה-worker
    -- מאמת מחדש ומפסיק בעצמו לפני הקריאה לספק.
    update public.appointment_reminders
    set cancel_requested_at = coalesce(cancel_requested_at, v_now),
        outcome_reason      = coalesce(outcome_reason, v_reason)
    where appointment_id = p_appointment_id
      and status = 'processing';

    update public.appointment_reminders
    set status         = 'cancelled',
        cancelled_at   = v_now,
        outcome_reason = v_reason,
        next_attempt_at = null,
        lease_token     = null,
        lease_expires_at = null
    where appointment_id = p_appointment_id
      and status in ('scheduled', 'retrying');

    return;
  end if;

  -- ── התור confirmed: snapshot ישן יורד מהמסלול ──────────────────────────
  update public.appointment_reminders
  set cancel_requested_at = coalesce(cancel_requested_at, v_now),
      outcome_reason      = coalesce(outcome_reason, 'starts_at_changed')
  where appointment_id = p_appointment_id
    and appointment_starts_at <> v_appt.starts_at
    and status = 'processing';

  update public.appointment_reminders
  set status          = 'superseded',
      cancelled_at    = v_now,
      outcome_reason  = 'starts_at_changed',
      next_attempt_at = null,
      lease_token     = null,
      lease_expires_at = null
  where appointment_id = p_appointment_id
    and appointment_starts_at <> v_appt.starts_at
    and status in ('scheduled', 'retrying');

  -- ── שתי התזכורות של ה-snapshot הנוכחי ──────────────────────────────────
  foreach v_kind in array array['day_before', 'two_hours_before']::reminder_kind[] loop
    v_sched   := public.reminder_scheduled_for(v_kind, v_appt.starts_at, v_now);
    v_expires := public.reminder_expires_at(v_kind, v_appt.starts_at, v_sched);

    -- החלון כבר נסגר כשהתור נוצר/אושר: השורה נוצרת, ולעולם לא נשלחת.
    -- התזכורת השנייה עדיין יכולה להיות פעילה — כל אחת נבחנת לחוד.
    if v_expires <= v_now then
      v_status := 'skipped';
      v_reason := 'window_passed_at_creation';
    else
      v_status := 'scheduled';
      v_reason := null;
    end if;

    insert into public.appointment_reminders (
      appointment_id, reminder_kind, appointment_starts_at,
      scheduled_for, expires_at, status, outcome_reason
    ) values (
      p_appointment_id, v_kind, v_appt.starts_at,
      v_sched, v_expires, v_status, v_reason
    )
    on conflict (appointment_id, reminder_kind, appointment_starts_at)
      where reminder_kind <> 'manual'
    do update set
      status           = excluded.status,
      scheduled_for    = excluded.scheduled_for,
      expires_at       = excluded.expires_at,
      outcome_reason   = excluded.outcome_reason,
      next_attempt_at  = null,
      cancel_requested_at = null,
      cancelled_at     = null,
      last_error_code  = null,
      lease_token      = null,
      lease_expires_at = null,
      processing_started_at = null
    -- ⚠️ החייאה של snapshot שכבר קיים (A→B→A) — הכללים, ולמה:
    --
    --   • superseded / cancelled בלבד. שתיהן מצבים שבהם ההודעה **לא יצאה**
    --     והתזכורת ירדה מהמסלול בגלל שינוי בתור. חזרה למועד המקורי מחזירה
    --     בדיוק את המצב שבו היא נקבעה מלכתחילה.
    --
    --   • sent_at is null — חגורה שנייה מעל אותה בדיקה.
    --
    --   • החלון המחושב-מחדש עדיין פתוח. אין להחיות לתוך שליחה מיידית של
    --     תזכורת שזמנה עבר.
    --
    -- מה שלא מוחייה בכוונה, ואין לו שליחה אוטומטית נוספת לאותו snapshot:
    --   sent · simulated       — כבר יצאה הודעה. שנייה = שליחה כפולה.
    --   delivery_unknown       — ייתכן שיצאה. אין להמר.
    --   failed                 — מיצוי ניסיונות או שגיאה קבועה.
    --   skipped                — החלון נסגר, בין אם ביצירה ובין אם לפני שליחה.
    --   processing             — יש worker פעיל; לא נוגעים מתחתיו.
    --   scheduled / retrying   — כבר פעילה על אותו snapshot; ה-WHERE הופך
    --                            את ה-upsert ל-no-op, וזה בדיוק ה-idempotency
    --                            שנדרש כשאותו update מגיע פעמיים.
    --
    -- attempt_count **אינו** מאופס: היסטוריית הניסיונות נשמרת, ומספור
    -- הניסיונות ממשיך (unique(reminder_id, attempt_number) נשאר תקף).
    -- snapshot שכבר מיצה את ניסיונותיו לא מוחייה ללולאה אינסופית.
    --
    -- מנהלת עדיין יכולה ליצור manual reminder במפורש בכל אחד מהמקרים האלה.
    where appointment_reminders.status in ('superseded', 'cancelled')
      and appointment_reminders.sent_at is null
      and excluded.expires_at > v_now;
  end loop;
end;
$$;

create or replace function public.tg_sync_appointment_reminders()
returns trigger
language plpgsql
as $$
begin
  perform public.sync_appointment_reminders(new.id);
  return null;  -- AFTER trigger: ערך ההחזרה אינו בשימוש
end;
$$;

-- ⚠️ AFTER ולא BEFORE: הפונקציה קוראת את השורה מ-appointments, ולכן היא
-- חייבת לרוץ אחרי שהיא נכתבה (כולל ends_at שנכתב ע"י appointments_set_end).
-- ⚠️ `of status, starts_at` — הטריגר אינו נורה על עדכוני
-- calendar_sync_status, updated_at וכו'. ל-INSERT אין רשימת עמודות
-- (Postgres אינו מתיר), ולכן כל INSERT מפעיל אותו; זה נכון — תור ידני
-- נוצר confirmed מיד וצריך תזכורות, ובקשת pending פשוט לא מייצרת שורות.
create trigger appointments_sync_reminders
  after insert on public.appointments
  for each row execute function public.tg_sync_appointment_reminders();

create trigger appointments_sync_reminders_update
  after update of status, starts_at on public.appointments
  for each row execute function public.tg_sync_appointment_reminders();


-- ============================================================================
-- חלק 7 — sweep: חלונות שנסגרו
--
-- נקרא בתחילת כל ריצת dispatch, בדיוק בדפוס expire_stale_pending_appointments
-- מ-0003. ⚠️ הוא רץ **בלי קשר** לספק ולדגל: תזכורת שחלונה נסגר לא תישלח
-- לעולם, ואין טעם להשאיר אותה scheduled ולהעמיד פנים.
-- ============================================================================

create or replace function public.sweep_expired_reminders()
returns jsonb
language plpgsql
as $$
declare
  v_expired   integer;
  v_cancelled integer;
begin
  with done as (
    update public.appointment_reminders
    set status         = 'skipped',
        outcome_reason = 'expired_before_send',
        next_attempt_at = null,
        lease_token     = null,
        lease_expires_at = null
    where status in ('scheduled', 'retrying')
      and expires_at <= now()
    returning id
  )
  select count(*)::integer into v_expired from done;

  -- בקשת ביטול שנרשמה על תזכורת ב-processing, וה-worker שלה כבר איננו.
  -- ה-lease חייב להיות פג — worker חי סוגר את הניסיון בעצמו.
  with done as (
    update public.appointment_reminders
    set status       = 'cancelled',
        cancelled_at = now(),
        lease_token  = null,
        lease_expires_at = null
    where status = 'processing'
      and cancel_requested_at is not null
      and lease_expires_at < now()
    returning id
  )
  select count(*)::integer into v_cancelled from done;

  return jsonb_build_object('expired', v_expired, 'cancelled', v_cancelled);
end;
$$;


-- ============================================================================
-- חלק 8 — admin_idempotency: scope לשליחה ידנית
--
-- ⚠️ שני ה-CHECK מאותרים לפי **התוכן** שלהם ולא לפי שם שניחשנו — אותו דפוס
-- בדיוק כמו חלק 4 של 0010, ומאותו טעם: השם הוא ברירת מחדל של Postgres, ואם
-- הוא אינו מה שציפינו עדיף ליפול מאשר "להצליח" ולהשאיר את הישן במקומו.
-- ============================================================================

do $$
declare v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel   on rel.oid = con.conrelid
  join pg_namespace n on n.oid   = rel.relnamespace
  where con.contype = 'c' and n.nspname = 'public'
    and rel.relname = 'admin_idempotency'
    and pg_get_constraintdef(con.oid) like '%appointment_create%'
    and pg_get_constraintdef(con.oid) not like '%result_code%'
    and pg_get_constraintdef(con.oid) like '%scope%';

  if v_name is null then
    raise exception '0011: לא נמצא ה-CHECK של admin_idempotency.scope'
      using errcode = 'P0104';
  end if;

  execute format('alter table public.admin_idempotency drop constraint %I', v_name);
end $$;

alter table public.admin_idempotency
  add constraint admin_idempotency_scope_check
  check (scope in ('customer_create', 'appointment_create', 'manual_reminder_send'));

do $$
declare v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel   on rel.oid = con.conrelid
  join pg_namespace n on n.oid   = rel.relnamespace
  where con.contype = 'c' and n.nspname = 'public'
    and rel.relname = 'admin_idempotency'
    and pg_get_constraintdef(con.oid) like '%appointment_created%';

  if v_name is null then
    raise exception '0011: לא נמצא ה-CHECK של admin_idempotency.result_code'
      using errcode = 'P0104';
  end if;

  execute format('alter table public.admin_idempotency drop constraint %I', v_name);
end $$;

alter table public.admin_idempotency
  add constraint admin_idempotency_result_code_check
  check (result_code in (
    'customer_created', 'existing_customer',
    'admin_phone_exists', 'appointment_created',
    'manual_reminder_created'
  ));


-- ============================================================================
-- חלק 9 — תזכורת ידנית
--
-- scheduled_for = now(), expires_at = מועד התור עצמו, וה-snapshot נלקח
-- בזמן היצירה — כך שהזזה או ביטול לפני השליחה מורידים גם אותה מהמסלול,
-- בדיוק כמו את האוטומטיות.
--
-- ⚠️ ה-idempotency זהה לזו של 0010 (לחיצה כפולה, retry אחרי timeout, תגובה
-- שאבדה אחרי commit, שתי בקשות מקבילות). אותו request id ואותו payload
-- מחזירים את **אותה** תזכורת, בלי שורה שנייה ובלי ניסיון כפול.
-- ============================================================================

create or replace function public.create_manual_reminder(
  p_appointment_id      uuid,
  p_admin_id            uuid,
  p_client_request_id   uuid,
  p_payload_fingerprint text,
  p_template_version    text
) returns jsonb
language plpgsql
as $$
declare
  v_claimed boolean;
  v_prev    public.admin_idempotency;
  v_appt    public.appointments;
  v_row     public.appointment_reminders;
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  if p_client_request_id is null then
    raise exception 'MISSING_REQUEST_ID' using errcode = '22023';
  end if;
  if p_payload_fingerprint is null or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'BAD_FINGERPRINT' using errcode = '22023';
  end if;
  if p_template_version is null or p_template_version !~ '^v[0-9]{1,3}$' then
    raise exception 'BAD_TEMPLATE_VERSION' using errcode = '22023';
  end if;

  insert into public.admin_idempotency
    (scope, actor_admin_id, client_request_id, payload_fingerprint)
  values
    ('manual_reminder_send', p_admin_id, p_client_request_id, p_payload_fingerprint)
  on conflict do nothing
  returning true into v_claimed;

  if v_claimed is null then
    select * into v_prev
    from public.admin_idempotency
    where scope = 'manual_reminder_send'
      and actor_admin_id = p_admin_id
      and client_request_id = p_client_request_id;

    if v_prev.payload_fingerprint <> p_payload_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    if v_prev.result_code is null then
      raise exception 'IDEMPOTENCY_INCOMPLETE' using errcode = 'P0104';
    end if;

    return jsonb_build_object(
      'result', v_prev.result_code, 'reminder_id', v_prev.target_id, 'replayed', true
    );
  end if;

  select * into v_appt from public.appointments
    where id = p_appointment_id for update;

  if v_appt.id is null then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_appt.status <> 'confirmed' then
    raise exception 'NOT_CONFIRMED' using errcode = 'P0006';
  end if;
  -- expires_at = starts_at, ולכן תור שכבר התחיל היה מייצר חלון ריק או שלילי
  -- ונופל על reminders_window_valid. עדיף שגיאה מפורשת.
  if v_appt.starts_at <= now() then
    raise exception 'APPOINTMENT_IN_PAST' using errcode = 'P0008';
  end if;

  insert into public.appointment_reminders (
    appointment_id, reminder_kind, appointment_starts_at,
    scheduled_for, expires_at, template_version, status, created_by_admin_id
  ) values (
    p_appointment_id, 'manual', v_appt.starts_at,
    public.reminder_scheduled_for('manual', v_appt.starts_at, now()),
    public.reminder_expires_at('manual', v_appt.starts_at, now()),
    p_template_version, 'scheduled', p_admin_id
  )
  returning * into v_row;

  update public.admin_idempotency
  set result_code = 'manual_reminder_created', target_id = v_row.id
  where scope = 'manual_reminder_send'
    and actor_admin_id = p_admin_id
    and client_request_id = p_client_request_id;

  return jsonb_build_object(
    'result', 'manual_reminder_created', 'reminder_id', v_row.id, 'replayed', false
  );
end;
$$;


-- ============================================================================
-- חלק 10 — claim
--
-- אותו דפוס בדיוק כמו claim_calendar_change ב-0008: for update skip locked,
-- שורה אחת, lease, ו-recovery מובנה של worker שנקטע.
--
-- ⚠️ ה-claim **פותח בעצמו** את רשומת הניסיון. כך לכל תפיסה יש עקבה, גם אם
-- ה-worker ימות מיד אחריה — וזו בדיוק הסיבה שהאודיט נפתח בהתחלה ולא בסוף.
--
-- ⚠️ ה-claim לעולם אינו נקרא כשהמערכת כבויה או כשהספק disabled. זה נאכף
-- בשרת (lib/reminders/dispatch.ts), ולכן תזכורות נשארות scheduled/retrying
-- ולא מסומנות בטעות — כדי ששלב 12 יוכל להתחיל לעבד את מה שעדיין תקף.
-- ============================================================================

create or replace function public.claim_due_reminder(
  p_lease_token   uuid,
  p_lease_seconds integer,
  p_max_attempts  integer,
  p_provider      text
) returns jsonb
language plpgsql
as $$
declare
  v_row  public.appointment_reminders;
  v_appt public.appointments;
begin
  if p_lease_token is null then
    raise exception 'LEASE_TOKEN_REQUIRED' using errcode = 'P0300';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 then
    raise exception 'BAD_LEASE_SECONDS' using errcode = '22023';
  end if;
  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'BAD_MAX_ATTEMPTS' using errcode = '22023';
  end if;
  if p_provider is null then
    raise exception 'PROVIDER_REQUIRED' using errcode = '22023';
  end if;

  update public.appointment_reminders r
  set status                = 'processing',
      lease_token           = p_lease_token,
      lease_expires_at      = now() + make_interval(secs => p_lease_seconds),
      processing_started_at = now(),
      attempt_count         = r.attempt_count + 1,
      provider              = p_provider
  where r.id = (
    select c.id
    from public.appointment_reminders c
    where (
            (c.status in ('scheduled', 'retrying')
             and coalesce(c.next_attempt_at, c.scheduled_for) <= now()
             and c.expires_at > now()
             and c.attempt_count < p_max_attempts
             and c.cancel_requested_at is null)
            -- recovery: worker שנקטע. ה-lease פג, והשורה חוזרת למחזור.
            or (c.status = 'processing' and c.lease_expires_at < now())
          )
    order by coalesce(c.next_attempt_at, c.scheduled_for), c.id
    for update skip locked
    limit 1
  )
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- ניסיון של worker שנקטע נסגר **פעם אחת**, לפני שנפתח החדש. הטריגר
  -- בחלק 4 מוודא שזו אכן סגירה יחידה, ושה-worker הישן לא יוכל לגעת בו שוב.
  update public.appointment_reminder_attempts
  set finished_at = now(),
      outcome     = 'lease_expired',
      error_code  = 'lease_expired'
  where reminder_id = v_row.id
    and finished_at is null;

  insert into public.appointment_reminder_attempts (
    reminder_id, attempt_number, provider, worker_id, started_at
  ) values (
    v_row.id, v_row.attempt_count, p_provider, p_lease_token, now()
  );

  select * into v_appt from public.appointments where id = v_row.appointment_id;

  -- ⚠️ ההקשר המוחזר הוא מזהים וזמנים בלבד. שם, טלפון וגוף הודעה אינם
  -- עוברים כאן — ה-worker טוען אותם בנפרד ורק ברגע שהוא עומד לשלוח.
  return jsonb_build_object(
    'claimed',                true,
    'reminder',               to_jsonb(v_row),
    'appointment_status',     v_appt.status,
    'appointment_starts_at',  v_appt.starts_at,
    'appointment_duration_min', v_appt.duration_min
  );
end;
$$;


-- ============================================================================
-- חלק 11 — אימות מחדש ממש לפני השליחה
--
-- זהו השער שמונע שליחת תזכורת לתור שבוטל או הוזז בזמן שהיא כבר ב-processing.
--
-- ⚠️ הוא אינו סוגר את החלון לגמרי, ואין טעם להעמיד פנים שכן: בין הבדיקה
-- הזו לקריאה לספק נותרות מילישניות. אם ההודעה כבר יצאה — התוצאה האמיתית
-- נרשמת, המערכת אינה משקרת שהיא בוטלה, ומסך הניהול מציג זאת במפורש
-- (ראה p_appointment_changed ב-finish_reminder_attempt).
-- ============================================================================

create or replace function public.reminder_precheck(
  p_reminder_id uuid,
  p_lease_token uuid
) returns jsonb
language plpgsql
as $$
declare
  v_row  public.appointment_reminders;
  v_appt public.appointments;
begin
  select * into v_row from public.appointment_reminders where id = p_reminder_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'reminder_not_found');
  end if;
  if v_row.status <> 'processing' or v_row.lease_token is distinct from p_lease_token then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost');
  end if;
  if v_row.cancel_requested_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'cancel_requested');
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired_before_send');
  end if;

  select * into v_appt from public.appointments where id = v_row.appointment_id;
  if v_appt.id is null then
    return jsonb_build_object('ok', false, 'reason', 'appointment_missing');
  end if;
  if v_appt.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'reason', 'appointment_not_confirmed');
  end if;
  -- ה-snapshot חייב להתאים. חל גם על manual: תזכורת ידנית שנוצרה למועד
  -- מסוים אינה נשלחת אחרי שהתור הוזז.
  if v_appt.starts_at <> v_row.appointment_starts_at then
    return jsonb_build_object('ok', false, 'reason', 'starts_at_changed');
  end if;
  -- manual יכולה להיות תקפה עד תחילת התור ממש; אחריה אין מה לתזכר.
  if v_appt.starts_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'appointment_started');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================================
-- חלק 12 — סגירת ניסיון
--
-- ⚠️ רק בעל ה-lease סוגר, בדיוק כמו finish_calendar_change ב-0008 וכמו
-- complete/fail_calendar_sync ב-0004. worker ישן שחזר מאוחר אחרי שה-lease
-- שלו פג וה-item נתפס מחדש — נדחה כאן.
-- ============================================================================

create or replace function public.finish_reminder_attempt(
  p_reminder_id         uuid,
  p_lease_token         uuid,
  p_outcome             text,
  p_error_code          text,
  p_provider_message_id text,
  p_provider            text,
  p_max_attempts        integer,
  p_appointment_changed boolean
) returns jsonb
language plpgsql
as $$
declare
  v_row      public.appointment_reminders;
  v_live     boolean;
  v_attempt  reminder_attempt_outcome;
  v_status   reminder_status;
  v_reason   text;
  v_next     timestamptz;
begin
  if p_outcome not in ('accepted', 'retryable_error', 'permanent_error', 'delivery_unknown') then
    raise exception 'BAD_OUTCOME' using errcode = 'P0302';
  end if;
  if p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,60}$' then
    raise exception 'BAD_ERROR_CODE' using errcode = '22023';
  end if;

  select * into v_row from public.appointment_reminders
    where id = p_reminder_id for update;

  if v_row.id is null
     or v_row.status <> 'processing'
     or v_row.lease_token is distinct from p_lease_token then
    raise exception 'NOT_LEASE_OWNER' using errcode = 'P0303';
  end if;

  -- ⚠️ "אמיתי" נקבע כאן ורק כאן, מתוך רשימת הספקים שאינם אמיתיים.
  -- ה-CHECK על הטבלה הוא החגורה השנייה: גם אם השורה הזו תשתבש בעתיד,
  -- status='sent' עם ספק לא אמיתי פשוט לא ייכתב.
  v_live := p_provider not in ('disabled', 'simulated', 'fake');

  if p_outcome = 'accepted' then
    v_attempt := case when v_live then 'accepted'::reminder_attempt_outcome
                      else 'simulated'::reminder_attempt_outcome end;
    v_status  := case when v_live then 'sent'::reminder_status
                      else 'simulated'::reminder_status end;
    -- ההודעה יצאה אחרי שהתור השתנה, ולא היה אפשר לעצור אותה. נרשם כפי
    -- שקרה — לא מסומן כבוטל, ולא נמחק.
    v_reason  := case when p_appointment_changed then 'sent_after_appointment_change' else null end;

  elsif p_outcome = 'delivery_unknown' then
    -- סופי. retry אוטומטי על תוצאה עמומה הוא שליחה כפולה בהסתברות גבוהה.
    v_attempt := 'delivery_unknown';
    v_status  := 'delivery_unknown';
    v_reason  := null;

  elsif p_outcome = 'permanent_error' then
    v_attempt := 'permanent_error';
    v_status  := 'failed';
    v_reason  := 'permanent_error';

  else  -- retryable_error
    v_attempt := 'retryable_error';
    -- backoff מעריכי: 3, 9, 27 דקות.
    v_next := now() + make_interval(mins => power(3, v_row.attempt_count)::integer);

    if v_row.attempt_count >= p_max_attempts then
      v_status := 'failed';
      v_reason := 'max_attempts_exhausted';
    elsif v_next >= v_row.expires_at then
      -- ⚠️ לא משאירים retrying שזמן הניסיון הבא שלו כבר מעבר לתוקף ההודעה.
      -- retry בלתי אפשרי הוא שקר במסך הניהול.
      v_status := 'failed';
      v_reason := 'retry_window_expired';
    else
      v_status := 'retrying';
      v_reason := null;
    end if;
  end if;

  update public.appointment_reminder_attempts
  set finished_at         = now(),
      outcome             = v_attempt,
      error_code          = p_error_code,
      provider_message_id = p_provider_message_id
  where reminder_id = p_reminder_id
    and attempt_number = v_row.attempt_count
    and finished_at is null;

  update public.appointment_reminders
  set status              = v_status,
      outcome_reason      = v_reason,
      last_error_code     = p_error_code,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      sent_at             = case when v_status in ('sent', 'simulated') then now() else sent_at end,
      next_attempt_at     = case when v_status = 'retrying' then v_next else null end,
      lease_token         = null,
      lease_expires_at    = null,
      processing_started_at = null
  where id = p_reminder_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;


-- ============================================================================
-- חלק 13 — הפסקה לפני השליחה
--
-- מגיעים לכאן כשה-precheck נכשל: **לא בוצעה שום קריאה לספק**. הניסיון
-- נסגר כ-aborted_precondition, והתזכורת מקבלת את הסטטוס שמתאים לסיבה.
-- ============================================================================

create or replace function public.abort_reminder_attempt(
  p_reminder_id uuid,
  p_lease_token uuid,
  p_reason      text
) returns jsonb
language plpgsql
as $$
declare
  v_row    public.appointment_reminders;
  v_status reminder_status;
begin
  if p_reason is null or p_reason !~ '^[a-z0-9_]{1,60}$' then
    raise exception 'BAD_REASON' using errcode = '22023';
  end if;

  select * into v_row from public.appointment_reminders
    where id = p_reminder_id for update;

  if v_row.id is null
     or v_row.status <> 'processing'
     or v_row.lease_token is distinct from p_lease_token then
    raise exception 'NOT_LEASE_OWNER' using errcode = 'P0303';
  end if;

  v_status := case p_reason
    when 'starts_at_changed'         then 'superseded'
    when 'cancel_requested'          then 'cancelled'
    when 'appointment_not_confirmed' then 'cancelled'
    when 'appointment_missing'       then 'cancelled'
    when 'expired_before_send'       then 'skipped'
    when 'appointment_started'       then 'skipped'
    else 'skipped'
  end;

  update public.appointment_reminder_attempts
  set finished_at = now(),
      outcome     = 'aborted_precondition',
      error_code  = p_reason
  where reminder_id = p_reminder_id
    and attempt_number = v_row.attempt_count
    and finished_at is null;

  update public.appointment_reminders
  set status         = v_status,
      outcome_reason = p_reason,
      cancelled_at   = case when v_status in ('cancelled', 'superseded') then now() else cancelled_at end,
      next_attempt_at = null,
      lease_token     = null,
      lease_expires_at = null,
      processing_started_at = null
  where id = p_reminder_id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;


-- ============================================================================
-- חלק 14 — retry ידני של מנהלת
--
-- ⚠️ transition אטומי על **אותה שורה**. אינו יוצר תזכורת חדשה, ולכן לחיצה
-- כפולה אינה יכולה לייצר שליחה כפולה: הראשונה משנה סטטוס, והשנייה כבר לא
-- מוצאת שורה במצב שניתן ל-retry ומחזירה את המצב הקיים כ-idempotent.
-- ============================================================================

create or replace function public.retry_reminder(
  p_reminder_id            uuid,
  p_admin_id               uuid,
  p_confirm_duplicate_risk boolean
) returns jsonb
language plpgsql
as $$
declare
  v_row    public.appointment_reminders;
  v_appt   public.appointments;
  v_now    timestamptz := now();
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  select * into v_row from public.appointment_reminders
    where id = p_reminder_id for update;

  if v_row.id is null then
    raise exception 'REMINDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 🔒 האישור נדרש **בשרת**. modal בדפדפן אינו הגנה — הוא רק ממשק.
  if v_row.status = 'delivery_unknown' and p_confirm_duplicate_risk is not true then
    raise exception 'DUPLICATE_RISK_NOT_CONFIRMED' using errcode = 'P0304';
  end if;

  -- worker פעיל אינו נגזל ממנהלת. רק lease שפג ניתן ל-retry.
  if v_row.status = 'processing' and v_row.lease_expires_at >= v_now then
    raise exception 'LEASE_ACTIVE' using errcode = 'P0305';
  end if;

  if v_row.status not in ('failed', 'delivery_unknown', 'processing') then
    -- לחיצה שנייה, או retry על מצב שאינו ניתן ל-retry. אפס כתיבות.
    return jsonb_build_object('result', 'not_retryable', 'status', v_row.status);
  end if;

  select * into v_appt from public.appointments where id = v_row.appointment_id;
  if v_appt.id is null or v_appt.status <> 'confirmed' then
    raise exception 'APPOINTMENT_NOT_CONFIRMED' using errcode = 'P0006';
  end if;
  if v_appt.starts_at <> v_row.appointment_starts_at then
    raise exception 'SNAPSHOT_STALE' using errcode = 'P0306';
  end if;
  if v_row.expires_at <= v_now then
    raise exception 'WINDOW_CLOSED' using errcode = 'P0307';
  end if;

  -- ניסיון פתוח של worker מת נסגר לפני שהשורה חוזרת למחזור.
  update public.appointment_reminder_attempts
  set finished_at = v_now, outcome = 'lease_expired', error_code = 'lease_expired'
  where reminder_id = p_reminder_id and finished_at is null;

  -- attempt_count אינו מאופס: ה-retry הידני הוא ניסיון נוסף, לא מחיקת
  -- ההיסטוריה. מכסת הניסיונות מורחבת ע"י p_max_attempts של ה-dispatch.
  update public.appointment_reminders
  set status          = 'scheduled',
      next_attempt_at = v_now,
      last_error_code = null,
      outcome_reason  = null,
      cancel_requested_at = null,
      lease_token     = null,
      lease_expires_at = null,
      processing_started_at = null
  where id = p_reminder_id
  returning * into v_row;

  return jsonb_build_object('result', 'requeued', 'status', v_row.status,
                            'attempt_count', v_row.attempt_count);
end;
$$;


-- ============================================================================
-- חלק 15 — Row Level Security
--
-- שתי הטבלאות נגישות ל-service_role בלבד, כמו otp_attempts ו-
-- admin_idempotency. אין policy, וגם ההרשאות נשללות במפורש — לא סומכים
-- על כך שהיעדר policy מספיק (בדיוק המנגנון שיצר את החשיפה שנסגרה ב-0010).
--
-- מסך הניהול קורא דרך השרת עם service_role, אחרי requireAdminApi.
-- ============================================================================

alter table public.appointment_reminders         enable row level security;
alter table public.appointment_reminder_attempts enable row level security;

revoke all on public.appointment_reminders         from anon, authenticated;
revoke all on public.appointment_reminder_attempts from anon, authenticated;

grant select, insert, update, delete on public.appointment_reminders         to service_role;
grant select, insert, update, delete on public.appointment_reminder_attempts to service_role;
grant usage, select on sequence public.appointment_reminder_attempts_id_seq  to service_role;


-- ============================================================================
-- חלק 16 — backfill
--
-- ⚠️ יוצר **שורות תזכורת בלבד**. אין שליחה, אין claim, אין ניסיון, אין
-- קריאה לספק ואין לוג ספק. אינו נוגע ב-appointment_history, ב-Google
-- Calendar, ב-appointments או בכל טבלה קיימת אחרת.
--
-- ⚠️ idempotent מלא: ההרצה עוברת דרך אותו sync_appointment_reminders, ולכן
-- ה-ON CONFLICT שלו הוא שמגן. תזכורת sent/simulated/delivery_unknown/failed
-- קיימת לא תשתנה, ואף ניסיון קיים לא ייגע. הרצה חוזרת של הקובץ (או של
-- הפונקציה) היא no-op על כל מה שכבר טופל.
--
-- רק תורים confirmed עתידיים: תור שעבר אינו זקוק לתזכורת, ויצירת ערימת
-- שורות skipped היסטוריות הייתה רעש בלבד.
-- ============================================================================

do $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.appointments
    where status = 'confirmed' and starts_at > now()
    order by starts_at
  loop
    perform public.sync_appointment_reminders(v_id);
    v_count := v_count + 1;
  end loop;

  raise notice '0011: backfill עבר על % תורים confirmed עתידיים', v_count;
end $$;


-- ============================================================================
-- חלק 17 — הרשאות ה-RPCs
--
-- אותו דפוס בדיוק כמו 0007–0010, ומאותה סיבה: PostgREST חושף כל פונקציה
-- בסכמה public כ-RPC לכל תפקיד כברירת מחדל, ו-`revoke ... from public`
-- לבדו אינו מסיר את ההענקה הישירה ש-Supabase נותנת ל-anon ול-authenticated
-- (התקלה שתוקנה ב-0006/0007). לכן שלושת התפקידים מפורשים בכל REVOKE.
--
-- פונקציות הטריגר (tg_sync_appointment_reminders,
-- reject_reminder_attempt_mutation) אינן נגישות כ-RPC ואינן דורשות REVOKE.
-- ============================================================================

revoke execute on function public.reminder_scheduled_for(reminder_kind,timestamptz,timestamptz)              from public, anon, authenticated;
revoke execute on function public.reminder_expires_at(reminder_kind,timestamptz,timestamptz)                 from public, anon, authenticated;
revoke execute on function public.sync_appointment_reminders(uuid)                                           from public, anon, authenticated;
revoke execute on function public.sweep_expired_reminders()                                                  from public, anon, authenticated;
revoke execute on function public.create_manual_reminder(uuid,uuid,uuid,text,text)                           from public, anon, authenticated;
revoke execute on function public.claim_due_reminder(uuid,integer,integer,text)                              from public, anon, authenticated;
revoke execute on function public.reminder_precheck(uuid,uuid)                                               from public, anon, authenticated;
revoke execute on function public.finish_reminder_attempt(uuid,uuid,text,text,text,text,integer,boolean)     from public, anon, authenticated;
revoke execute on function public.abort_reminder_attempt(uuid,uuid,text)                                     from public, anon, authenticated;
revoke execute on function public.retry_reminder(uuid,uuid,boolean)                                          from public, anon, authenticated;

grant execute on function public.reminder_scheduled_for(reminder_kind,timestamptz,timestamptz)               to service_role;
grant execute on function public.reminder_expires_at(reminder_kind,timestamptz,timestamptz)                  to service_role;
grant execute on function public.sync_appointment_reminders(uuid)                                            to service_role;
grant execute on function public.sweep_expired_reminders()                                                   to service_role;
grant execute on function public.create_manual_reminder(uuid,uuid,uuid,text,text)                            to service_role;
grant execute on function public.claim_due_reminder(uuid,integer,integer,text)                               to service_role;
grant execute on function public.reminder_precheck(uuid,uuid)                                                to service_role;
grant execute on function public.finish_reminder_attempt(uuid,uuid,text,text,text,text,integer,boolean)      to service_role;
grant execute on function public.abort_reminder_attempt(uuid,uuid,text)                                      to service_role;
grant execute on function public.retry_reminder(uuid,uuid,boolean)                                           to service_role;


-- ============================================================================
-- חלק 18 — assertions
--
-- המיגרציה חייבת ליפול אם משהו כאן לא התקיים בפועל. מיגרציה שמדווחת
-- Success על סכמה שגויה גרועה ממיגרציה שנכשלת.
-- ============================================================================

-- ─── הרשאות ה-RPCs ─────────────────────────────────────────────────────────
do $$
declare
  v_fn  text;
  v_fns text[] := array[
    'public.reminder_scheduled_for(reminder_kind, timestamptz, timestamptz)',
    'public.reminder_expires_at(reminder_kind, timestamptz, timestamptz)',
    'public.sync_appointment_reminders(uuid)',
    'public.sweep_expired_reminders()',
    'public.create_manual_reminder(uuid, uuid, uuid, text, text)',
    'public.claim_due_reminder(uuid, integer, integer, text)',
    'public.reminder_precheck(uuid, uuid)',
    'public.finish_reminder_attempt(uuid, uuid, text, text, text, text, integer, boolean)',
    'public.abort_reminder_attempt(uuid, uuid, text)',
    'public.retry_reminder(uuid, uuid, boolean)'
  ];
begin
  foreach v_fn in array v_fns loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0011: % עדיין פתוחה ל-anon', v_fn using errcode = 'P0102';
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0011: % עדיין פתוחה ל-authenticated', v_fn using errcode = 'P0102';
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0011: % אינה זמינה ל-service_role', v_fn using errcode = 'P0102';
    end if;
  end loop;
end $$;

-- ─── הסכמה ──────────────────────────────────────────────────────────────────
do $$
declare v_count integer;
begin
  -- RLS על שתי הטבלאות, ואפס policies (service_role בלבד)
  select count(*) into v_count
  from pg_class rel join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
    and rel.relname in ('appointment_reminders', 'appointment_reminder_attempts')
    and rel.relrowsecurity;
  if v_count <> 2 then
    raise exception '0011: RLS אינו מופעל על שתי טבלאות התזכורות (נמצאו %)', v_count
      using errcode = 'P0102';
  end if;

  select count(*) into v_count from pg_policies
  where schemaname = 'public'
    and tablename in ('appointment_reminders', 'appointment_reminder_attempts');
  if v_count <> 0 then
    raise exception '0011: טבלאות התזכורות אינן אמורות להחזיק policies (נמצאו %)', v_count
      using errcode = 'P0102';
  end if;

  if has_table_privilege('anon', 'public.appointment_reminders', 'select')
     or has_table_privilege('authenticated', 'public.appointment_reminders', 'select')
     or has_table_privilege('anon', 'public.appointment_reminder_attempts', 'select')
     or has_table_privilege('authenticated', 'public.appointment_reminder_attempts', 'select') then
    raise exception '0011: טבלאות התזכורות נגישות ל-anon/authenticated' using errcode = 'P0102';
  end if;

  -- ⚠️ provider הוא בדיקת פורמט ולא רשימה סגורה — כדי ששלב 12 יוכל להוסיף
  -- ספק בלי שינוי סכמה, ובלי שערך בדיקה כלשהו יישב בסכמת הייצור.
  for v_count in
    select 1
    from unnest(array['appointment_reminders', 'appointment_reminder_attempts']) t(name)
    where not exists (
      select 1 from pg_constraint con
      join pg_class rel   on rel.oid = con.conrelid
      join pg_namespace n on n.oid   = rel.relnamespace
      where con.contype = 'c' and n.nspname = 'public' and rel.relname = t.name
        and pg_get_constraintdef(con.oid) like '%provider%'
        and pg_get_constraintdef(con.oid) like '%a-z0-9\_%'
    )
  loop
    raise exception '0011: אין CHECK של פורמט על provider באחת מטבלאות התזכורות'
      using errcode = 'P0104';
  end loop;

  -- ואין רשימה סגורה של שמות ספקים על אף אחת מהן
  for v_count in
    select 1 from pg_constraint con
    join pg_class rel   on rel.oid = con.conrelid
    join pg_namespace n on n.oid   = rel.relnamespace
    where con.contype = 'c' and n.nspname = 'public'
      and rel.relname in ('appointment_reminders', 'appointment_reminder_attempts')
      and pg_get_constraintdef(con.oid) like '%provider%'
      and pg_get_constraintdef(con.oid) like '%''simulated''%'
      and pg_get_constraintdef(con.oid) not like '%status%'
  loop
    raise exception '0011: provider עדיין מוגבל לרשימת שמות סגורה'
      using errcode = 'P0104';
  end loop;

  -- 🔒 ה-constraint שהופך שליחה אמיתית לבלתי אפשרית בשלב 11
  if not exists (
    select 1 from pg_constraint con
    join pg_class rel   on rel.oid = con.conrelid
    join pg_namespace n on n.oid   = rel.relnamespace
    where con.contype = 'c' and n.nspname = 'public'
      and rel.relname = 'appointment_reminders'
      and con.conname = 'reminders_sent_requires_live_provider'
  ) then
    raise exception '0011: reminders_sent_requires_live_provider אינו קיים'
      using errcode = 'P0104';
  end if;

  -- מפתח ה-snapshot חייב להיות UNIQUE וחלקי (manual מוחרגת)
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'appointment_reminders_snapshot_uniq'
      and indexdef like '%UNIQUE%'
      and indexdef like '%manual%'
  ) then
    raise exception '0011: אינדקס ה-snapshot אינו UNIQUE חלקי' using errcode = 'P0104';
  end if;

  -- שני הטריגרים על appointments קיימים
  select count(*) into v_count from pg_trigger
  where tgrelid = 'public.appointments'::regclass
    and tgname in ('appointments_sync_reminders', 'appointments_sync_reminders_update');
  if v_count <> 2 then
    raise exception '0011: ציפינו ל-2 טריגרים של תזכורות על appointments, נמצאו %', v_count
      using errcode = 'P0104';
  end if;

  -- טריגר שמירת האודיט קיים
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointment_reminder_attempts'::regclass
      and tgname = 'reminder_attempts_close_once'
  ) then
    raise exception '0011: טריגר שמירת האודיט אינו קיים' using errcode = 'P0104';
  end if;

  -- ה-scope החדש התקבל ב-admin_idempotency
  if not exists (
    select 1 from pg_constraint con
    join pg_class rel   on rel.oid = con.conrelid
    join pg_namespace n on n.oid   = rel.relnamespace
    where con.contype = 'c' and n.nspname = 'public'
      and rel.relname = 'admin_idempotency'
      and pg_get_constraintdef(con.oid) like '%manual_reminder_send%'
  ) then
    raise exception '0011: manual_reminder_send אינו מותר ב-admin_idempotency.scope'
      using errcode = 'P0104';
  end if;

  -- 🔒 אף תזכורת לא יכולה להיות 'sent' בשלב הזה, בשום נתון קיים
  select count(*) into v_count from public.appointment_reminders where status = 'sent';
  if v_count <> 0 then
    raise exception '0011: נמצאו % תזכורות בסטטוס sent — בלתי אפשרי בשלב 11', v_count
      using errcode = 'P0104';
  end if;

  -- ה-backfill לא יצר ולו ניסיון שליחה אחד
  select count(*) into v_count from public.appointment_reminder_attempts;
  if v_count <> 0 then
    raise exception '0011: ה-backfill יצר % רשומות ניסיון — הוא אמור ליצור שורות תזכורת בלבד', v_count
      using errcode = 'P0104';
  end if;
end $$;
