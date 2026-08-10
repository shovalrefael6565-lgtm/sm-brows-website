-- ============================================================================
-- 0025 — שלב 15F: התראות טרנזקציוניות
--
-- ═══ 🔒 מיגרציה תוספתית בלבד ═══
--
-- אין DROP, אין ALTER TYPE ... ADD VALUE, ואין נגיעה בשום פונקציה קיימת.
-- ⚠️ בפרט: `create_public_booking_request`, `approve_pending_appointment`,
-- `approve_reschedule_request`, `reject_reschedule_request` ו-
-- `cancel_confirmed_appointment_by_customer` **אינן משתנות באף שורה**.
-- ההתראות נתלות עליהן מבחוץ, דרך טריגר.
--
-- כל הטיפוסים כאן **חדשים**, ולכן מותר להשתמש בערכיהם באותה טרנזקציה ואין
-- צורך לפצל את הקובץ (אותו שיקול שתועד ב-0022).
--
-- ─── למה טבלה חדשה ולא הרחבת appointment_reminders ─────────────────────────
--
-- `appointment_reminders` הוא מודל של **snapshot מתוזמן**: המפתח שלו הוא
-- (appointment_id, reminder_kind, appointment_starts_at), ויש בו
-- `scheduled_for` ו-`expires_at` חובה. אירוע טרנזקציוני אינו snapshot ואין
-- לו חלון תפוגה — הוא קרה, ויש להודיע עליו.
--
-- 🔒 הדחיפה של ערכי enum חדשים לשם הייתה **שוברת את ה-unique index**: שתי
-- דחיות של אותו תור מייצרות בדיוק את אותו מפתח, ולכן ההתראה השנייה הייתה
-- נבלעת בשקט. הטבלה כאן מפתחת על **שורת ההיסטוריה** ומוותרת על שדות
-- התזמון — ראה ההערה על source_history_id בחלק 2.
--
-- ─── למה הטריגר יושב על appointment_history ────────────────────────────────
--
-- 🔒 **זו ההחלטה המרכזית של הקובץ.**
--
-- טריגר על `appointments` היה צריך להסיק את סוג האירוע מהפרש הסטטוסים, ויש
-- מקרה אחד שבו ההסקה הזו **שגויה ושולחת הודעה שקרית ללקוחה**:
--
--   `cancel_confirmed_appointment_by_customer` (0022, חלק 6) סוגרת בקשת
--   שינוי מועד פתוחה ומעבירה אותה ל-'rejected' — באותה טרנזקציה שבה
--   הלקוחה ביטלה את התור המקורי שלה. `pending→rejected` על שורת בקשה נראה
--   בדיוק כמו דחייה של שובל, ולכן טריגר נאיבי היה שולח ללקוחה
--   "בקשת שינוי המועד לא אושרה" **על בקשה שהיא עצמה סגרה, שניות אחרי
--   שביטלה את התור מרצונה**.
--
-- `appointment_history` מבדילה את שני המקרים במפורש, כי היא נושאת `actor`
-- ו-`reason` כעמודות:
--
--   דחייה של שובל     → actor='admin',    reason='reschedule_rejected'
--   סגירה בעקבות ביטול → actor='customer', reason='original_cancelled'
--
-- אותה עמודה `reason` מבדילה גם את `approve_pending_appointment` (בלי
-- reason) מ-`approve_reschedule_request` (reason='reschedule_approved'),
-- ששתיהן כותבות pending→confirmed ע"י admin.
--
-- ⚠️ ההיסטוריה נכתבת **בתוך אותה טרנזקציה** של הפעולה העסקית בכל אחד מ-21
-- מקומות הכתיבה במיגרציות 0001–0022, ולכן טריגר עליה הוא אטומי עם הפעולה
-- בדיוק כמו טריגר על appointments.
--
-- ─── מה מפורשות אינו מייצר התראה ───────────────────────────────────────────
--
--   • reason='original_cancelled'  — ראה למעלה. הלקוחה יודעת; היא עשתה זאת.
--   • to_status='expired'          — תפוגה אינה הכרעה. `expire_stale_pending_
--     appointments` (0003) כותבת 'expired' ולא 'rejected', ולכן ההפרדה
--     מתקבלת בחינם. **אין נוסח מאושר לתפוגה, ואין להמציא אחד.**
--   • יצירת תור ע"י שובל (`create_manual_appointment`) — action='created'
--     עם to_status='confirmed' ו-actor='admin'. אינו "אישור בקשה": לא
--     הייתה בקשה, והלקוחה יודעת כי שובל קבעה איתה.
--   • cancelled_by_business שמקורו אינו Google — אין מסלול כזה בקוד היום.
--
-- ⚠️ הזזה שהגיעה מ-Google (`apply_google_reschedule`, 0008) **כן** מייצרת
-- התראה — `appointment_moved_by_business`. ראה חלק 5, ובפרט את הסיבה
-- שמפתח ה-idempotency הוא שורת ההיסטוריה: הזזה יכולה לחזור על אותו תור.
-- ============================================================================


-- ============================================================================
-- חלק 1 — הטיפוסים
-- ============================================================================

-- ⚠️ תזכורות (day_before / two_hours_before) **אינן כאן**. הן מסלול נפרד עם
-- חלון שליחה, snapshot ו-expires_at, והן שייכות ל-15G. ראה
-- REMINDER_SMS_V2_UNWIRED ב-lib/messageTemplates.ts.
create type notification_event as enum (
  'booking_requested',     -- לקוחה ביקשה תור          → admin
  'reschedule_requested',  -- לקוחה ביקשה מועד אחר     → admin
  'booking_approved',      -- שובל אישרה               → customer
  'booking_rejected',      -- שובל לא אישרה            → customer
  'reschedule_approved',   -- שובל אישרה מועד חדש      → customer
  'reschedule_rejected',   -- שובל לא אישרה מועד חדש   → customer
  'booking_cancelled',     -- תור מאושר בוטל           → customer + admin
  -- ⚠️ שובל גררה את האירוע ביומן Google → התור זז. ראה חלק 5.
  -- 🔒 האירוע היחיד כאן שיכול **לחזור על אותו תור**, ולכן הוא זה שקבע
  -- שמפתח ה-idempotency יהיה שורת ההיסטוריה ולא (תור, אירוע, נמען).
  'appointment_moved_by_business'
);

create type notification_recipient_role as enum ('admin', 'customer');

-- ⚠️ אין כאן 'scheduled': להתראה טרנזקציונית אין מועד עתידי. היא נולדת
-- queued ומנוקזת מיד.
create type notification_status as enum (
  'queued',            -- נוצרה ע"י הטריגר, טרם נתפסה
  'sending',           -- יש lease פעיל
  'retrying',          -- שגיאה זמנית; ⚠️ ממתינה לניקוז **ידני** (אין Cron ב-15F)
  'sent',              -- ספק אמיתי קיבל
  'simulated',         -- ספק שאינו אמיתי "קיבל". לא נשלח SMS.
  'failed',            -- שגיאה קבועה, או מיצוי ניסיונות
  'delivery_unknown',  -- תוצאת ספק עמומה. 🔒 סופי — לעולם אין retry אוטומטי.
  'skipped'            -- אין למי לשלוח (טלפון חסר / יעד אדמין לא הוגדר)
);

-- זהה במכוון ל-reminder_attempt_outcome: אותם ארבעה מצבי ספק, אותו חוזה,
-- אותו קוד TypeScript (ReminderDeliveryResult) שממחזר את Sms019Provider.
create type notification_attempt_outcome as enum (
  'accepted',
  'simulated',
  'retryable_error',
  'permanent_error',
  'delivery_unknown',
  'lease_expired'
);


-- ============================================================================
-- חלק 2 — appointment_notifications
--
-- ⚠️ מה שאינו נשמר כאן, ולא במקרה: גוף הודעה, שם לקוחה, מספר טלפון, תגובת
-- ספק גולמית. הנוסח סטטי וחי בקוד; הטלפון נטען רק ברגע השליחה ונזרק.
-- ============================================================================

create table public.appointment_notifications (
  id                   uuid primary key default gen_random_uuid(),

  /**
   * 🔒 **האירוע העסקי שיצר את ההתראה — ומפתח ה-idempotency.**
   *
   * ⚠️ הגרסה הראשונה של הקובץ מפתחה על (appointment_id, event,
   * recipient_role), וזה **שגוי** עבור אירוע שיכול לחזור על אותו תור.
   * `appointment_moved_by_business` הוא בדיוק כזה: שובל יכולה לגרור את
   * אותו אירוע ביומן שלוש פעמים בשבוע, וכל גרירה היא מועד חדש שהלקוחה
   * חייבת לדעת עליו. מפתח לפי (תור, אירוע, נמען) היה רושם את הראשונה
   * ובולע את כל השאר ב-`on conflict do nothing` — הלקוחה הייתה מקבלת
   * הודעה על ההזזה הראשונה בלבד ומגיעה למועד שאינו נכון.
   *
   * שורת היסטוריה היא **עובדה חד-פעמית**: היא נוצרת פעם אחת לכל אירוע
   * עסקי שקרה בפועל. מפתוח עליה נותן בדיוק את שתי התכונות הנדרשות:
   *
   *   retry של אותה פעולה  ⟶ אין שורת היסטוריה שנייה (ה-RPCs מותנים ב-
   *                          `where status = 'pending'` וכדומה), ולכן אין
   *                          התראה שנייה.
   *   הזזה **נוספת**       ⟶ שורת היסטוריה חדשה ⟶ התראה חדשה. ✅
   *
   * ⚠️ `on delete cascade` תואם ל-appointment_history עצמה, שכבר עושה
   * cascade ממחיקת התור.
   */
  source_history_id    bigint not null
                       references public.appointment_history(id) on delete cascade,

  /**
   * ⚠️ נשמר למרות שהוא נגזר מ-source_history_id, ובכוונה: ה-dispatcher
   * מנקז לפי תור (`dispatchNow(appointmentId)`) וטוען לפיו את הנמען.
   * join ל-appointment_history בכל ניקוז היה מחיר מיותר על מסלול חם.
   */
  appointment_id       uuid not null
                       references public.appointments(id) on delete cascade,

  event                notification_event not null,
  recipient_role       notification_recipient_role not null,

  status               notification_status not null default 'queued',

  attempt_count        integer not null default 0 check (attempt_count >= 0),

  lease_token          uuid,
  lease_expires_at     timestamptz,

  -- ראה ההערה המלאה על אותה עמודה ב-0011: בדיקת פורמט ולא רשימה סגורה,
  -- והפורמט דורש אות ראשונה — ולכן '019' פסול ושם הספק הוא 'sms_019'.
  provider             text not null default 'disabled'
                       check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),

  provider_message_id  text,

  -- קודים מסוננים בלבד. הודעת שגיאה חופשית של ספק אינה יכולה לעבור.
  last_error_code      text check (last_error_code ~ '^[a-z0-9_]{1,60}$'),

  sent_at              timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- 🔒 **הגנת ה-idempotency, ברמת ה-DB ולא באפליקציה.**
  --
  -- ⚠️ המפתח הוא (שורת ההיסטוריה, הנמען) — **לא** (תור, אירוע, נמען).
  -- ראה את הנימוק המלא על העמודה source_history_id: אירוע שיכול לחזור על
  -- אותו תור (גרירה חוזרת ביומן) חייב לייצר התראה חדשה בכל פעם, בזמן
  -- ש-retry של אותה פעולה אינו מייצר כלום.
  --
  -- לחיצה כפולה על "אשר" אינה מגיעה לכאן בכלל: ה-RPC השנייה מתנה
  -- ב-`status = 'pending'`, מקבלת אפס שורות ונופלת ל-NOT_PENDING — ולכן
  -- לא נכתבת שורת היסטוריה שנייה ואין מה לרשום.
  --
  -- ⚠️ `recipient_role` הוא חלק מהמפתח בדיוק כדי ש-booking_cancelled יוכל
  -- ליצור שתי שורות מאותה שורת היסטוריה — ללקוחה ולשובל — ועדיין לחסום
  -- כפילות בכל אחת מהן בנפרד.
  constraint appointment_notifications_uniq
    unique (source_history_id, recipient_role),

  -- אותה הבטחה כמו reminders_sent_requires_live_provider ב-0011: אי אפשר
  -- לסמן SMS אמיתי כשנשלח כשהספק אינו אמיתי.
  constraint notifications_sent_requires_live_provider
    check (status <> 'sent' or provider not in ('disabled', 'simulated', 'fake'))
);

comment on table public.appointment_notifications is
  'התראות טרנזקציוניות (15F). אין בה גוף הודעה, שם, טלפון או תגובת ספק — רק מזהים וסטטוס. אין scheduled_for/expires_at: אירוע אינו snapshot.';
comment on column public.appointment_notifications.recipient_role is
  'חלק ממפתח ה-idempotency. booking_cancelled הוא האירוע היחיד שמייצר שתי שורות — customer ו-admin.';
comment on column public.appointment_notifications.status is
  'retrying = ממתינה לניקוז ידני (אין Cron ב-15F). delivery_unknown = סופי, לעולם ללא retry אוטומטי.';

-- ניקוז: מה שממתין לשליחה, לפי סדר היווצרות.
create index appointment_notifications_pending_idx
  on public.appointment_notifications (created_at)
  where status in ('queued', 'retrying', 'sending');

-- ה-dispatcher מנקז לפי תור (ראה dispatchNow(appointmentId)).
create index appointment_notifications_appointment_idx
  on public.appointment_notifications (appointment_id, status);


-- ============================================================================
-- חלק 3 — appointment_notification_attempts
--
-- אודיט. שורה נפתחת ב-started_at ונסגרת בעדכון יחיד — לא שורה אחת בסוף,
-- כי worker שקרס באמצע ניסיון לא היה משאיר עקבה, וזה בדיוק המקרה שבגללו
-- האודיט קיים.
-- ============================================================================

create table public.appointment_notification_attempts (
  id                   bigserial primary key,

  notification_id      uuid not null
                       references public.appointment_notifications(id) on delete cascade,

  attempt_number       integer not null check (attempt_number >= 1),

  provider             text not null check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),

  -- ה-lease token של ההרצה. מזהה הרצה, לא מזהה אדם.
  worker_id            uuid,

  started_at           timestamptz not null default now(),
  finished_at          timestamptz,

  outcome              notification_attempt_outcome,

  error_code           text check (error_code ~ '^[a-z0-9_]{1,60}$'),
  provider_message_id  text,

  created_at           timestamptz not null default now(),

  constraint notification_attempts_number_uniq unique (notification_id, attempt_number),

  -- הכול-או-כלום: או ששני השדות ריקים (ניסיון פתוח) או ששניהם מלאים.
  constraint notification_attempts_closed_together
    check ((finished_at is null) = (outcome is null))
);

comment on table public.appointment_notification_attempts is
  'אודיט לכל ניסיון שליחה של התראה. אין בה טלפון, שם, תוכן הודעה או תגובת ספק גולמית.';

create index appointment_notification_attempts_notification_idx
  on public.appointment_notification_attempts (notification_id, attempt_number);


-- ============================================================================
-- חלק 4 — ההוספה לתור, מנקודה אחת
--
-- ⚠️ `on conflict do nothing` ולא `do update`: התראה שכבר נוצרה עבור אותו
-- (תור, אירוע, נמען) **לא תיווצר שוב ולא תאופס**. אילו הייתה מתאפסת,
-- לחיצה כפולה על "אשר" הייתה מחזירה שורה שכבר נשלחה למצב queued ושולחת
-- SMS שני ללקוחה — כלומר בדיוק מה שה-unique נועד למנוע.
-- ============================================================================

create or replace function public.enqueue_appointment_notification(
  p_source_history_id bigint,
  p_appointment_id    uuid,
  p_event             notification_event,
  p_recipient_role    notification_recipient_role
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- 🔒 **מתג ההפעלה נבדק כאן, בכניסה לרישום — לא בשליחה.**
  --
  -- ⚠️ אילו הגייטינג היה בשכבת ה-dispatch, הטריגר היה ממשיך לרשום שורות
  -- לאורך כל תקופת הכיבוי, ורגע ההפעלה היה משחרר backlog שלם: הודעות על
  -- תורים שכבר אושרו, בוטלו או קרו לפני שבועות, כולן בבת אחת, ללקוחות
  -- אמיתיות. גייטינג ברישום פירושו שאין מה לשחרר — ההפעלה מתחילה
  -- מהאירוע הבא.
  --
  -- ⚠️ ברירת המחדל של setting_boolean היא false, ולכן key חסר, ערך פסול
  -- או ערך שאינו בוליאני **מכבים** את ההתראות ולא מדליקים אותן. זו
  -- ההטיה הנכונה: מצב לא-ידוע אינו סיבה לשלוח SMS על חשבון העסק.
  if not public.setting_boolean('notifications_enabled', false) then
    return;
  end if;

  insert into public.appointment_notifications
    (source_history_id, appointment_id, event, recipient_role)
  values (p_source_history_id, p_appointment_id, p_event, p_recipient_role)
  on conflict (source_history_id, recipient_role) do nothing;
end;
$$;

comment on function public.enqueue_appointment_notification(bigint, uuid, notification_event, notification_recipient_role) is
  'הוספת התראה לאירוע היסטוריה. אידמפוטנטית לפי (source_history_id, recipient_role), וכבויה לחלוטין כש-notifications_enabled=false.';


-- ============================================================================
-- חלק 5 — 🔒 הטריגר
--
-- AFTER INSERT על appointment_history. רץ בתוך הטרנזקציה של הפעולה
-- העסקית, ולכן: או שהפעולה וההתראה נרשמו יחד, או שאף אחת מהן.
--
-- ⚠️ הטריגר **אינו שולח כלום ואינו יוצא לרשת.** הוא כותב שורה בטבלה, וזהו.
-- השליחה קורית אחרי ה-COMMIT, ב-dispatchNow. זו ההפרדה שמקיימת את ההבטחה
-- "כשל SMS לעולם לא מבטל פעולה עסקית שכבר הצליחה": ברגע שהטריגר סיים,
-- שום דבר שיקרה מול 019 אינו יכול להחזיר את הטרנזקציה אחורה.
--
-- ⚠️ אין כאן EXCEPTION WHEN OTHERS. טריגר שבולע שגיאות היה מייצר תורים
-- שנוצרו בלי התראה, בשקט.
-- ============================================================================

create or replace function public.enqueue_notifications_from_history()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_is_request boolean;
begin
  -- האם השורה שההיסטוריה מתארת היא **בקשת שינוי מועד** ולא תור רגיל.
  -- זהו הדיסקרימינטור המבני; `reason` הוא הדיסקרימינטור של הכוונה. שניהם
  -- נבדקים, כי כל אחד לבדו מותיר מקרה פתוח.
  select (a.reschedule_of_appointment_id is not null) into v_is_request
    from public.appointments a
    where a.id = new.appointment_id;

  if v_is_request is null then
    -- שורת היסטוריה על תור שאינו קיים אינה אפשרית (FK), אבל אם הגענו לכאן
    -- אין על מה להודיע.
    return null;
  end if;

  -- ══ בקשה חדשה → שובל ═════════════════════════════════════════════════════
  --
  -- ⚠️ מכסה את **שני** מסלולי הבקשה — הציבורי (0018) והאזור האישי (0020) —
  -- כי שניהם כותבים בדיוק את אותה שורת היסטוריה. אין צורך בשני חיווטים.
  --
  -- ⚠️ `to_status='pending'` הוא מה שמוציא מכאן את `create_manual_appointment`
  -- (0018), שכותבת action='created' עם to_status='confirmed': שובל קבעה את
  -- התור בעצמה, אין בקשה, ואין למי להודיע.
  if new.action = 'created' and new.to_status = 'pending' then
    if v_is_request then
      perform public.enqueue_appointment_notification(
        new.id, new.appointment_id, 'reschedule_requested', 'admin');
    else
      perform public.enqueue_appointment_notification(
        new.id, new.appointment_id, 'booking_requested', 'admin');
    end if;
    return null;
  end if;

  -- ══ הכרעה של שובל → הלקוחה ═══════════════════════════════════════════════
  if new.action = 'status_changed' and new.from_status = 'pending' then

    -- אושר
    if new.to_status = 'confirmed' then
      if v_is_request then
        perform public.enqueue_appointment_notification(
          new.id, new.appointment_id, 'reschedule_approved', 'customer');
      else
        perform public.enqueue_appointment_notification(
          new.id, new.appointment_id, 'booking_approved', 'customer');
      end if;
      return null;
    end if;

    -- נדחה
    if new.to_status = 'rejected' then
      -- 🔒 **החריג היחיד, והסיבה שהטריגר יושב על ההיסטוריה.**
      --
      -- הלקוחה ביטלה את התור המקורי, ו-0022 סגרה בעקבות זאת את בקשת שינוי
      -- המועד הפתוחה שלה. הבקשה אכן עברה ל-'rejected', אבל שובל לא דחתה
      -- כלום — הלקוחה סגרה את זה בעצמה, שניות קודם. "בקשת שינוי המועד לא
      -- אושרה" כאן היה שקר, והוא היה מגיע ללקוחה שכרגע ביטלה מרצונה.
      --
      -- ⚠️ הלקוחה **כן** מקבלת התראה על הפעולה שכן קרתה: הביטול עצמו
      -- מייצר booking_cancelled בענף שלמטה.
      if new.reason = 'original_cancelled' then
        return null;
      end if;

      if v_is_request then
        perform public.enqueue_appointment_notification(
          new.id, new.appointment_id, 'reschedule_rejected', 'customer');
      else
        perform public.enqueue_appointment_notification(
          new.id, new.appointment_id, 'booking_rejected', 'customer');
      end if;
      return null;
    end if;

    return null;
  end if;

  -- ══ ביטול של תור מאושר ═══════════════════════════════════════════════════
  if new.action = 'cancelled' and new.from_status = 'confirmed' then

    -- הלקוחה ביטלה → שניהם צריכים לדעת.
    if new.to_status = 'cancelled_by_customer' then
      perform public.enqueue_appointment_notification(
        new.id, new.appointment_id, 'booking_cancelled', 'customer');
      perform public.enqueue_appointment_notification(
        new.id, new.appointment_id, 'booking_cancelled', 'admin');
      return null;
    end if;

    -- ══ 🔒 העסק ביטל → **הלקוחה בלבד** ═════════════════════════════════════
    --
    -- ⚠️ הענף הזה סוגר פער שהיה קיים עד 15F: כששובל מוחקת אירוע מיומן
    -- Google, `apply_google_cancellation` (0008) מעבירה את התור ל-
    -- cancelled_by_business — **והלקוחה לא ידעה על כך דבר**. היא הייתה
    -- מגיעה לתור שכבר אינו קיים.
    --
    -- ⚠️ רק 'customer'. שובל היא זו שביצעה את הפעולה, ואין טעם ליידע אותה
    -- על מה שהיא עצמה עשתה לפני שנייה.
    --
    -- הנוסח `תורך בוטל. לפרטים: .../account` אינו אומר מי ביטל, ולכן הוא
    -- נכון בשני הכיוונים ואין צורך בנוסח נוסף.
    if new.to_status = 'cancelled_by_business' then
      perform public.enqueue_appointment_notification(
        new.id, new.appointment_id, 'booking_cancelled', 'customer');
      return null;
    end if;

    return null;
  end if;

  -- ══ 🔒 שובל גררה את האירוע ביומן → התור זז ═══════════════════════════════
  --
  -- ⚠️ `apply_google_reschedule` (0008) כותבת confirmed→confirmed עם
  -- starts_at חדש. זהו **המקרה היחיד שבו מועד התור של הלקוחה משתנה בלי
  -- שהיא ביקשה ובלי שהיא אישרה**, והיא אינה מיודעת עליו כלל היום.
  --
  -- ההבחנה מ-`approve_reschedule_request`: שם ה-from_status הוא 'pending'
  -- (שורת בקשה שאושרה), וכאן הוא 'confirmed' — תור חי שזז תחתיו.
  -- action='rescheduled' + source='google_calendar' מזהים אותו חד-משמעית.
  --
  -- 🔒 **גרירה חוזרת מייצרת התראה חוזרת, וזו הנקודה.** שובל יכולה לגרור
  -- את אותו אירוע שלוש פעמים בשבוע, וכל גרירה היא מועד חדש שהלקוחה חייבת
  -- לדעת עליו. מפתח לפי (תור, אירוע, נמען) היה בולע את השנייה והשלישית
  -- ומשאיר את הלקוחה עם המועד הראשון — ראה source_history_id בחלק 2.
  if new.action = 'rescheduled'
     and new.from_status = 'confirmed'
     and new.to_status   = 'confirmed'
     and new.source      = 'google_calendar'
  then
    perform public.enqueue_appointment_notification(
      new.id, new.appointment_id, 'appointment_moved_by_business', 'customer');
    return null;
  end if;

  -- ⚠️ כל השאר — 'rescheduled' עם to_status='rescheduled' (התור המקורי
  -- שהוזז, שאינו אירוע בפני עצמו), 'expired', וסימון completed/no_show —
  -- אינם מייצרים התראה. אין להם נוסח מאושר, ואין להמציא אחד.
  return null;
end;
$$;

comment on function public.enqueue_notifications_from_history() is
  '15F: ממפה שורת appointment_history לשורות התראה. reason=original_cancelled מוחרג במפורש — ראה ההערה בגוף הפונקציה.';

create trigger appointment_history_enqueue_notifications
  after insert on public.appointment_history
  for each row
  execute function public.enqueue_notifications_from_history();


-- ============================================================================
-- חלק 6 — updated_at
-- ============================================================================

create trigger appointment_notifications_touch_updated_at
  before update on public.appointment_notifications
  for each row
  execute function public.touch_updated_at();


-- ============================================================================
-- חלק 7 — תפיסה לשליחה
--
-- 🔒 מנקזת **תור אחד**, בהתאם ל-dispatchNow(appointmentId): ה-route יודע
-- באיזה תור הוא נגע, ואינו יודע — ואינו צריך לדעת — את מזהה ההתראה
-- שהטריגר יצר.
--
-- ⚠️ `for update skip locked`: שתי בקשות מקבילות על אותו תור לא ייקחו את
-- אותה שורה, והשנייה לא תיחסם בהמתנה.
-- ============================================================================

create or replace function public.claim_appointment_notification(
  p_appointment_id uuid,
  p_lease_token    uuid,
  p_lease_seconds  integer,
  p_max_attempts   integer,
  p_provider       text
) returns public.appointment_notifications
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row public.appointment_notifications;
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

  update public.appointment_notifications n
  set status           = 'sending',
      lease_token      = p_lease_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count    = n.attempt_count + 1,
      provider         = p_provider
  where n.id = (
    select c.id
    from public.appointment_notifications c
    where c.appointment_id = p_appointment_id
      and (
            (c.status in ('queued', 'retrying') and c.attempt_count < p_max_attempts)
            -- recovery: worker שנקטע. ה-lease פג, והשורה חוזרת למחזור.
            or (c.status = 'sending' and c.lease_expires_at < now())
          )
    order by c.created_at, c.id
    for update skip locked
    limit 1
  )
  returning * into v_row;

  -- ניסיון של worker שנקטע נסגר פעם אחת, לפני שנפתח החדש.
  update public.appointment_notification_attempts
  set finished_at = now(), outcome = 'lease_expired'
  where notification_id = v_row.id
    and finished_at is null
    and attempt_number < v_row.attempt_count;

  if v_row.id is not null then
    insert into public.appointment_notification_attempts
      (notification_id, attempt_number, provider, worker_id)
    values (v_row.id, v_row.attempt_count, p_provider, p_lease_token);
  end if;

  return v_row;
end;
$$;

comment on function public.claim_appointment_notification(uuid, uuid, integer, integer, text) is
  'תופסת התראה אחת של תור נתון עם lease. skip locked — בקשות מקבילות אינן נחסמות ואינן תופסות את אותה שורה.';


-- ============================================================================
-- חלק 8 — סגירת ניסיון
--
-- ⚠️ מיפוי outcome → status, במקום אחד:
--
--   accepted         → sent (ספק אמיתי) / simulated (ספק שאינו אמיתי)
--   retryable_error  → retrying, כל עוד לא מוצו הניסיונות; אחרת failed
--   permanent_error  → failed
--   delivery_unknown → delivery_unknown  🔒 **סופי. לעולם לא retrying.**
--
-- 🔒 delivery_unknown אינו שגיאה — הבקשה יצאה ואיננו יודעים מה עלה בגורלה.
-- retry עליו אינו "ניסיון" אלא הימור על SMS שני ללקוחה, על חשבונה. ל-019
-- אין idempotency מוכחת (external_id הוא client reference ל-DLR בלבד),
-- ולכן אין דרך לדעת שההודעה לא כבר נשלחה. אותו כלל בדיוק כמו ב-0011.
-- ============================================================================

create or replace function public.finish_notification_attempt(
  p_notification_id     uuid,
  p_lease_token         uuid,
  p_outcome             notification_attempt_outcome,
  p_error_code          text,
  p_provider_message_id text,
  p_provider            text,
  p_max_attempts        integer
) returns public.appointment_notifications
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row    public.appointment_notifications;
  v_live   boolean;
  v_status notification_status;
begin
  -- 🔒 רק מי שמחזיק את ה-lease רשאי לסגור. worker שה-lease שלו פג ומישהו
  -- כבר תפס את השורה אחריו אינו יכול לדרוס את התוצאה החדשה בישנה.
  select * into v_row
    from public.appointment_notifications
    where id = p_notification_id and lease_token = p_lease_token
    for update;

  if v_row.id is null then
    return null;
  end if;

  v_live := p_provider not in ('disabled', 'simulated', 'fake');

  v_status := case
    when p_outcome = 'accepted' and v_live then 'sent'
    when p_outcome in ('accepted', 'simulated')  then 'simulated'
    when p_outcome = 'delivery_unknown'          then 'delivery_unknown'
    when p_outcome = 'permanent_error'           then 'failed'
    when p_outcome = 'retryable_error' then
      case when v_row.attempt_count >= p_max_attempts then 'failed' else 'retrying' end
    else 'failed'
  end;

  update public.appointment_notifications
  set status              = v_status,
      provider            = p_provider,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      last_error_code     = case when p_outcome = 'accepted' then null else p_error_code end,
      sent_at             = case when v_status = 'sent' then now() else sent_at end,
      lease_token         = null,
      lease_expires_at    = null
  where id = p_notification_id
  returning * into v_row;

  update public.appointment_notification_attempts
  set finished_at         = now(),
      outcome             = p_outcome,
      error_code          = case when p_outcome = 'accepted' then null else p_error_code end,
      provider_message_id = p_provider_message_id
  where notification_id = p_notification_id
    and attempt_number  = v_row.attempt_count
    and finished_at is null;

  return v_row;
end;
$$;

comment on function public.finish_notification_attempt(uuid, uuid, notification_attempt_outcome, text, text, text, integer) is
  'סוגרת ניסיון ומכריעה סטטוס. delivery_unknown הוא סופי ולעולם אינו הופך ל-retrying.';


-- ============================================================================
-- חלק 9 — הפסקה לפני שליחה
--
-- אין למי לשלוח: לקוחה בלי טלפון, או יעד אדמין שטרם הוגדר (0024).
-- ⚠️ 'skipped' ולא 'failed': לא הייתה תקלה, פשוט אין נמען. ההפרדה חשובה
-- כדי שמסך "דורש טיפול" יראה את שתי הבעיות השונות בנפרד.
-- ============================================================================

create or replace function public.skip_notification(
  p_notification_id uuid,
  p_lease_token     uuid,
  p_reason          text
) returns public.appointment_notifications
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row public.appointment_notifications;
begin
  update public.appointment_notifications
  set status           = 'skipped',
      last_error_code  = p_reason,
      lease_token      = null,
      lease_expires_at = null
  where id = p_notification_id and lease_token = p_lease_token
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  update public.appointment_notification_attempts
  set finished_at = now(), outcome = 'permanent_error', error_code = p_reason
  where notification_id = p_notification_id
    and attempt_number  = v_row.attempt_count
    and finished_at is null;

  return v_row;
end;
$$;

comment on function public.skip_notification(uuid, uuid, text) is
  'סימון התראה כ-skipped כשאין נמען (טלפון חסר / admin_notification_phone לא הוגדר). לא תקלה — אין למי לשלוח.';


-- ============================================================================
-- חלק 10 — טעינת הנמען
--
-- 🔒 **מחזירה מספר טלפון בלבד.**
--
-- ⚠️ בניגוד ל-loadReminderRecipient הקיימת, שטוענת גם service_key ו-
-- variants כדי לבנות את שם הטיפול: נוסחי ה-SMS של 15F סטטיים לחלוטין ואינם
-- נושאים PII. אין להם שם, טיפול, תאריך או מחיר, ולכן שאילתה שמביאה את
-- הנתונים האלה הייתה חושפת מידע שאיש לא ביקש — SMS אינו מוצפן.
-- ============================================================================

create or replace function public.notification_recipient_phone(
  p_appointment_id uuid,
  p_recipient_role notification_recipient_role
) returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_phone text;
begin
  if p_recipient_role = 'admin' then
    return public.admin_notification_phone();
  end if;

  select c.phone_e164 into v_phone
    from public.appointments a
    join public.customers c on c.id = a.customer_id
    where a.id = p_appointment_id;

  return v_phone;
end;
$$;

comment on function public.notification_recipient_phone(uuid, notification_recipient_role) is
  'מספר הטלפון של הנמען, ותו לא. אינו מחזיר שם, טיפול, מועד או מחיר — נוסחי ה-SMS של 15F אינם נושאים PII.';


-- ============================================================================
-- חלק 11 — RLS והרשאות
--
-- שתי הטבלאות נגישות ל-service_role בלבד. הן מכילות מתי הודענו למי על מה,
-- ואין שום מסלול שבו דפדפן צריך לקרוא אותן.
-- ============================================================================

alter table public.appointment_notifications         enable row level security;
alter table public.appointment_notification_attempts enable row level security;

revoke all on public.appointment_notifications         from anon, authenticated;
revoke all on public.appointment_notification_attempts from anon, authenticated;

grant select, insert, update, delete on public.appointment_notifications         to service_role;
grant select, insert, update, delete on public.appointment_notification_attempts to service_role;
grant usage, select on sequence public.appointment_notification_attempts_id_seq  to service_role;

-- ⚠️ בסכמה public כל פונקציה נחשפת כ-RPC לכל תפקיד כברירת מחדל, ולכן
-- revoke מפורש לפני grant. ראה את אותה הערה ב-0011 ו-0006.
revoke execute on function public.enqueue_appointment_notification(bigint, uuid, notification_event, notification_recipient_role) from public, anon, authenticated;
revoke execute on function public.claim_appointment_notification(uuid, uuid, integer, integer, text)                      from public, anon, authenticated;
revoke execute on function public.finish_notification_attempt(uuid, uuid, notification_attempt_outcome, text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.skip_notification(uuid, uuid, text)                                                     from public, anon, authenticated;
revoke execute on function public.notification_recipient_phone(uuid, notification_recipient_role)                         from public, anon, authenticated;

grant execute on function public.enqueue_appointment_notification(bigint, uuid, notification_event, notification_recipient_role) to service_role;
grant execute on function public.claim_appointment_notification(uuid, uuid, integer, integer, text)                      to service_role;
grant execute on function public.finish_notification_attempt(uuid, uuid, notification_attempt_outcome, text, text, text, integer) to service_role;
grant execute on function public.skip_notification(uuid, uuid, text)                                                     to service_role;
grant execute on function public.notification_recipient_phone(uuid, notification_recipient_role)                         to service_role;


-- ============================================================================
-- אימות עצמי
-- ============================================================================

do $$
begin
  if to_regclass('public.appointment_notifications') is null
     or to_regclass('public.appointment_notification_attempts') is null then
    raise exception '0025: הטבלאות לא נוצרו.' using errcode = 'P0105';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'appointment_history_enqueue_notifications'
      and tgrelid = 'public.appointment_history'::regclass
  ) then
    raise exception '0025: הטריגר על appointment_history לא נוצר.' using errcode = 'P0105';
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'appointment_notifications_uniq'
  ) then
    raise exception '0025: מפתח ה-idempotency לא נוצר.' using errcode = 'P0105';
  end if;

  -- ── 🔒 ההרשאות בפועל, לא רק הצהרת ה-REVOKE ──────────────────────────────
  --
  -- ⚠️ `revoke ... from public` אינו מסיר את ההענקה הישירה ש-Supabase נותנת
  -- ל-anon ול-authenticated. ראה 0003–0005 ו-scripts/test-rpc-permissions.mjs.
  if has_function_privilege('anon',
       'public.enqueue_appointment_notification(bigint, uuid, notification_event, notification_recipient_role)', 'execute')
  then raise exception '0025: anon יכול להפעיל את enqueue_appointment_notification'; end if;
  if has_function_privilege('authenticated',
       'public.enqueue_appointment_notification(bigint, uuid, notification_event, notification_recipient_role)', 'execute')
  then raise exception '0025: authenticated יכול להפעיל את enqueue_appointment_notification'; end if;

  if has_function_privilege('anon',
       'public.claim_appointment_notification(uuid, uuid, integer, integer, text)', 'execute')
  then raise exception '0025: anon יכול להפעיל את claim_appointment_notification'; end if;
  if has_function_privilege('authenticated',
       'public.claim_appointment_notification(uuid, uuid, integer, integer, text)', 'execute')
  then raise exception '0025: authenticated יכול להפעיל את claim_appointment_notification'; end if;

  if has_function_privilege('anon',
       'public.finish_notification_attempt(uuid, uuid, notification_attempt_outcome, text, text, text, integer)', 'execute')
  then raise exception '0025: anon יכול להפעיל את finish_notification_attempt'; end if;
  if has_function_privilege('authenticated',
       'public.finish_notification_attempt(uuid, uuid, notification_attempt_outcome, text, text, text, integer)', 'execute')
  then raise exception '0025: authenticated יכול להפעיל את finish_notification_attempt'; end if;

  if has_function_privilege('anon', 'public.skip_notification(uuid, uuid, text)', 'execute')
  then raise exception '0025: anon יכול להפעיל את skip_notification'; end if;
  if has_function_privilege('authenticated', 'public.skip_notification(uuid, uuid, text)', 'execute')
  then raise exception '0025: authenticated יכול להפעיל את skip_notification'; end if;

  -- ⚠️ הרגישה מכולן: היא מחזירה מספר טלפון של לקוחה. חשיפה ל-anon הייתה
  -- הופכת אותה לאורקל שמחזיר טלפון עבור כל מזהה תור שמישהו ינחש.
  if has_function_privilege('anon',
       'public.notification_recipient_phone(uuid, notification_recipient_role)', 'execute')
  then raise exception '0025: anon יכול להפעיל את notification_recipient_phone'; end if;
  if has_function_privilege('authenticated',
       'public.notification_recipient_phone(uuid, notification_recipient_role)', 'execute')
  then raise exception '0025: authenticated יכול להפעיל את notification_recipient_phone'; end if;

  -- ⚠️ הכיוון ההפוך: ההרשאות של service_role חייבות *להישמר*.
  if not has_function_privilege('service_role',
       'public.enqueue_appointment_notification(bigint, uuid, notification_event, notification_recipient_role)', 'execute')
  then raise exception '0025: service_role איבד את enqueue_appointment_notification'; end if;
  if not has_function_privilege('service_role',
       'public.claim_appointment_notification(uuid, uuid, integer, integer, text)', 'execute')
  then raise exception '0025: service_role איבד את claim_appointment_notification'; end if;
  if not has_function_privilege('service_role',
       'public.finish_notification_attempt(uuid, uuid, notification_attempt_outcome, text, text, text, integer)', 'execute')
  then raise exception '0025: service_role איבד את finish_notification_attempt'; end if;
  if not has_function_privilege('service_role', 'public.skip_notification(uuid, uuid, text)', 'execute')
  then raise exception '0025: service_role איבד את skip_notification'; end if;
  if not has_function_privilege('service_role',
       'public.notification_recipient_phone(uuid, notification_recipient_role)', 'execute')
  then raise exception '0025: service_role איבד את notification_recipient_phone'; end if;

  raise notice '0025: appointment_notifications + טריגר + 5 פונקציות נוצרו.';
end;
$$;
