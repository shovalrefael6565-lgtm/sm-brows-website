-- 0033 — התראה לשובל כשלקוחה מבטלת בקשת תור שעדיין ממתינה
--
-- ⚠️ סוגרת את TODO(pending-cancel) שתועד ב-
-- app/api/appointments/[id]/cancel/route.ts. עד כאן: לקוחה שביטלה בקשה
-- במצב pending גרמה להיעלמותה ממסך הניהול **בלי שום התראה** — ושובל
-- המשיכה להחזיק את הסלוט בראשה. ביטול של תור confirmed כן עבד.
--
-- 🔒 שני שינויים בלבד, שניהם additive:
--   1. ערך enum חדש ל-notification_event.
--   2. ענף חדש ב-enqueue_notifications_from_history.
--
-- ⚠️ **אפס DROP, אפס UPDATE/DELETE, אפס backfill.** הפונקציה מוחלפת ב-
-- create or replace על גוף שנשלף מהפרודקשן עצמו ואומת כזהה ל-0025, כך
-- שאף ענף קיים אינו משתנה — הענף החדש נוסף **לפני** ענף ה-confirmed
-- ואינו יכול לחטוף ממנו: התנאים זרים (pending מול confirmed).
--
-- ⚠️ **ALTER TYPE ADD VALUE ו-שימוש בערך אינם יכולים לחיות באותה
-- טרנזקציה** ב-PostgreSQL. לכן הקובץ מחולק לשני חלקים המופרדים בשורת
-- ה-SPLIT למטה, וכל חלק מורץ בטרנזקציה נפרדת. אין להריץ את הקובץ כמקשה
-- אחת. ראה docs/privacy-production-rollout.md סעיף 2א.2.

-- ─── חלק 1 (טרנזקציה נפרדת) ────────────────────────────────────────────────
--
-- ⚠️ `if not exists` הופך את החלק הזה ל-idempotent: הרצה חוזרת אינה שגיאה.
alter type public.notification_event add value if not exists 'pending_request_cancelled';

-- ═══════════════════════ SPLIT ═══════════════════════

-- ─── חלק 2 (טרנזקציה נפרדת) ────────────────────────────────────────────────
create or replace function public.enqueue_notifications_from_history()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $BODY$

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

  -- ══ ביטול של בקשה שעדיין ממתינה לאישור ═══════════════════════════════════
  --
  -- ⚠️ הענף הזה סוגר את הפער שתועד כ-TODO(pending-cancel) ב-
  -- app/api/appointments/[id]/cancel/route.ts: cancel_pending_appointment
  -- (0003) כותבת ('cancelled', 'pending', 'cancelled_by_customer'), ואף אחד
  -- מארבעת הענפים של 0025 לא תפס את הצירוף — ענף הביטול דרש
  -- from_status='confirmed'. התוצאה: בקשה נעלמה ממסך הניהול בלי ששובל ידעה.
  --
  -- 🔒 **admin בלבד, ובכוונה.** הלקוחה היא זו שביטלה לפני שנייה, ואין טעם
  -- ליידע אותה על מעשה שלה — אותו שיקול בדיוק כמו ב-reschedule_requested.
  --
  -- 🔒 אירוע נפרד ולא שימוש חוזר ב-booking_cancelled: הנוסח שונה ("ביטלה
  -- בקשת תור" ולא "התור בוטל"), ובקשה ממתינה אינה תור. מיזוגם היה מטשטש
  -- בדיוק את ההבחנה שעליה נבנה שלב 15F.
  --
  -- 🔒 idempotency: המפתח של 0025 הוא (source_history_id, recipient_role).
  -- ביטול אחד = שורת היסטוריה אחת = התראה אחת. ביטול חוזר של אותה בקשה
  -- אינו אפשרי (cancel_pending_appointment דורשת status='pending').
  if new.action = 'cancelled' and new.from_status = 'pending' then
    if new.to_status = 'cancelled_by_customer' then
      perform public.enqueue_appointment_notification(
        new.id, new.appointment_id, 'pending_request_cancelled', 'admin');
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
$BODY$;

comment on function public.enqueue_notifications_from_history() is
  'ממפה שורת appointment_history להתראות. 0033 הוסיפה את הענף של ביטול בקשה '
  'ממתינה (pending -> cancelled_by_customer) שנשלח ל-admin בלבד.';

-- ─── אימות ─────────────────────────────────────────────────────────────────
do $VERIFY$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_event' and e.enumlabel = 'pending_request_cancelled'
  ) then
    raise exception '0033: ערך ה-enum pending_request_cancelled חסר' using errcode = 'P0103';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_notifications_from_history'
      and p.prosrc like '%pending_request_cancelled%'
  ) then
    raise exception '0033: הטריגר אינו מכיל את הענף החדש' using errcode = 'P0103';
  end if;

  -- 🔒 הענפים הקיימים שרדו — אם אחד מהם נעלם, ההחלפה דרסה התנהגות עובדת.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_notifications_from_history'
      and p.prosrc like '%from_status = ''confirmed''%'
      and p.prosrc like '%booking_cancelled%'
      and p.prosrc like '%appointment_moved_by_business%'
      and p.prosrc like '%booking_requested%'
  ) then
    raise exception '0033: ענף קיים נעלם מהטריגר' using errcode = 'P0103';
  end if;

  -- 🔒 הטריגר עצמו עדיין מחובר.
  if not exists (
    select 1 from pg_trigger tg
    join pg_proc p on p.oid = tg.tgfoid
    where p.proname = 'enqueue_notifications_from_history' and not tg.tgisinternal
  ) then
    raise exception '0033: הטריגר אינו מחובר לטבלה' using errcode = 'P0103';
  end if;
end $VERIFY$;
