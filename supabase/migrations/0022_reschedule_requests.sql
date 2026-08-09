-- ============================================================================
-- 0022 — שלב 15E: בקשת שינוי מועד כשורה שנייה, והאחדת כלל 6 השעות
--
-- ═══ 🔒 מיגרציה **תוספתית בלבד** ═══
--
-- ⚠️ אין כאן שום DROP. בפרט, reschedule_appointment_by_customer (0005)
-- **נשארת חיה** — בדיוק מאותו שיקול סדר-פריסה שתועד ב-0020:
--
--   0022 בלבד  ⟶ הישנה והחדשה חיות יחד. deployment ישן (שקורא לישנה)
--                 ו-deployment חדש (שקורא לחדשות) שניהם עובדים.
--   0023 אחרי  ⟶ הישנה נמחקת, כשכבר אין בעולם קוד שקורא לה.
--
-- **0023 אינה אופציונלית**, ואסור להריץ אותה לפני שהקוד החדש נפרס
-- ו-QA-E עבר בפרודקשן.
--
-- ─── החזון שהמיגרציה הזו מממשת ──────────────────────────────────────────────
--
-- לקוחה מבקשת מועד חדש. **התור המקורי נשאר confirmed וחוסם את שעתו** עד
-- שהמועד החדש מאושר. אין רגע שבו שני המקומות משוחררים.
--
--   בקשה נוצרה  ⟶ מקורית confirmed (לא נגעו) · בקשה pending
--                  שתי השעות חסומות
--   אושרה       ⟶ מקורית 'rescheduled' · בקשה confirmed   (טרנזקציה אחת)
--                  השעה הישנה משתחררת, החדשה נשארת תפוסה
--   נדחתה       ⟶ מקורית ללא שינוי · בקשה 'rejected'
--                  היעד משתחרר, המקורית ממשיכה כרגיל
--   פגה         ⟶ זהה לדחייה, דרך expire_stale_pending_appointments
--
-- ─── למה שורה שנייה ולא טבלה נפרדת ─────────────────────────────────────────
--
-- 🔒 Postgres **אינו תומך ב-EXCLUDE constraint חוצה-טבלאות.** טבלת
-- reschedule_requests נפרדת הייתה מחייבת מימוש מחדש של "היעד חסום" בקוד
-- האפליקציה — כלומר בדיוק ה-race condition ש-appointments_no_overlap קיים
-- כדי למנוע. שורה שנייה בטבלת appointments מקבלת את החסימה **בחינם**:
-- 'pending' כבר נמנה ב-constraint מ-0001.
--
-- באותה מידה מתקבלים בחינם גם:
--   • expire_stale_pending_appointments (0003) — תפוגת הבקשה, אטומית
--   • כלל התפוגה של 15B (3 שעות / גלגול ל-11:00) — אותו p_expires_at
--   • מזהה אירוע יומן דטרמיניסטי נפרד לכל שורה (deterministicEventId
--     נגזר מ-appointment.id), ולכן שני סנכרונים בלתי תלויים
--
-- 🔒 מה שהמיגרציה הזו **אינה** עושה:
--   • **אין DROP** — ראה למעלה.
--   • **אין ALTER TYPE ... ADD VALUE.** 'rescheduled', 'rejected' ו-'expired'
--     כבר קיימים ב-appointment_status ועשו COMMIT (0001/0002/0016), ולכן
--     מותר להשתמש בהם כאן מיד ואין צורך לפצל את הקובץ. גם booking_source
--     לא מקבל ערך חדש — שורת הבקשה יורשת את המקור, והסימן שהיא בקשת
--     שינוי הוא reschedule_of_appointment_id בלבד.
--   • **אין שינוי ב-appointments_no_overlap.** הוא כבר עושה בדיוק את
--     הנדרש: מונה pending+confirmed, ו-'rescheduled'/'rejected'/'expired'
--     אינם ביניהם. (0019 ציינה "שינוי ה-constraint נשאר ב-15E" — נבדק,
--     ואין מה לשנות.)
--   • אין backfill. שורות קיימות מקבלות reschedule_of_appointment_id = null.
--   • אין נגיעה ב-create_public_booking_request, ב-
--     create_personal_area_booking_request או ב-create_manual_appointment.
--
-- ─── שתי אינווריאנטות שנאכפות ב-DB ולא רק בשרת ─────────────────────────────
--
-- 1. **שרשרת הזזות עד max_reschedules.** תור שנוצר משינוי מועד קודם הוא
--    confirmed רגיל לכל דבר ויכול להוליד בקשה נוספת. הסימן
--    reschedule_of_appointment_id הוא תיעוד מוצא בלבד ואינו חוסם —
--    המונה reschedule_count הוא מה שעוצר, ב-MAX_RESCHEDULES.
--
-- 2. **בקשה אינה שורדת את המועדים שהיא נוגעת בהם.**
--    pending_expires_at = least(עסקי, original.starts_at, target.starts_at).
--    בלי זה כלל הגלגול ל-11:00 (15B) היה יכול להשאיר בקשה pending אחרי
--    שהתור המקורי כבר התחיל — ואישור שלה היה מזיז תור שכבר קרה.
--
-- 3. **אין ghost pending.** ביטול עצמי של התור המקורי סוגר באותה
--    טרנזקציה גם בקשת שינוי פתוחה ומשחרר את שעת היעד. בלי זה נשארה
--    בקשה שאי אפשר לאשר (ORIGINAL_NOT_CONFIRMED) אבל שממשיכה לחסום
--    שעה ביומן עד התפוגה.
--
-- ─── סדר נעילה אחיד — מה שהופך את המרוצים לבטוחים ──────────────────────────
--
-- 🔒 **כל** ארבע הפונקציות שנוגעות בזוג (מקור, בקשה) נועלות את **המקור
-- ראשון**: create / approve / reject / cancel. מכאן:
--   • cancel מנצח ⟹ approve חוסם על הנעילה, ואז רואה
--     cancelled_by_customer ⟹ ORIGINAL_NOT_CONFIRMED
--   • approve מנצח ⟹ cancel חוסם על הנעילה, ואז רואה 'rescheduled'
--     ⟹ NOT_CANCELLABLE
-- בשני הכיוונים אין deadlock ואין מצב ביניים גלוי.
-- ============================================================================


-- ============================================================================
-- חלק 1 — הקישור בין הבקשה למקור
-- ============================================================================

alter table public.appointments
  add column reschedule_of_appointment_id uuid
    references public.appointments(id) on delete restrict;

comment on column public.appointments.reschedule_of_appointment_id is
  'שורת בקשת שינוי מועד: מצביעה על התור המקורי שנשאר confirmed וחוסם את שעתו עד ההכרעה. null = תור רגיל.';

-- ⚠️ on delete restrict ולא cascade: מחיקת התור המקורי אסורה כל עוד יש
-- אליו בקשה. אין בקוד מסלול מחיקה של appointments בכלל (ביטול = שינוי
-- status), ולכן זו חגורת בטיחות מול מחיקה ידנית ב-SQL Editor.

-- 🔒 בקשה אינה יכולה להצביע על עצמה.
alter table public.appointments
  add constraint appointments_reschedule_not_self
  check (reschedule_of_appointment_id is null or reschedule_of_appointment_id <> id);

-- 🔒 **בקשה פתוחה אחת בלבד לכל תור.** זו ההגנה האטומית מפני שתי בקשות
-- מקבילות על אותו תור — לא בדיקה באפליקציה. חלקי על status='pending'
-- בכוונה: אחרי דחייה/תפוגה מותר לבקש שוב.
create unique index appointments_one_open_reschedule_per_appt
  on public.appointments (reschedule_of_appointment_id)
  where reschedule_of_appointment_id is not null and status = 'pending';

-- חיפוש הבקשה של תור נתון, ולתצוגת הניהול
create index appointments_reschedule_of_idx
  on public.appointments (reschedule_of_appointment_id)
  where reschedule_of_appointment_id is not null;


-- ============================================================================
-- חלק 2 — יצירת בקשת שינוי מועד
--
-- מחזירה את שורת הבקשה. הבעלות, הסטטוס והמדיניות נבדקים כאן, בתוך אותה
-- טרנזקציה שכותבת — אחרי SELECT ... FOR UPDATE על התור המקורי.
--
-- ⚠️ **התור המקורי אינו משתנה כאן בשום שדה.** זו כל הנקודה של השלב.
-- ============================================================================

create or replace function public.create_reschedule_request(
  p_appointment_id uuid,
  p_customer_id    uuid,
  p_new_starts_at  timestamptz,
  p_expires_at     timestamptz
) returns public.appointments
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  -- אותה תקרת ביטחון כמו 0018/0020 ו-PENDING_EXPIRY_MAX_HOURS
  c_expiry_max   constant interval := interval '72 hours';

  v_orig         public.appointments;
  v_row          public.appointments;
  v_customer     public.customers;
  v_cutoff_hours numeric;
  v_max_resched  integer;
  v_new_ends_at  timestamptz;
  v_expires_at   timestamptz;
begin
  -- ── ולידציה ────────────────────────────────────────────────────────────
  if p_customer_id is null then
    raise exception 'MISSING_CUSTOMER' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + c_expiry_max then
    raise exception 'BAD_EXPIRY' using errcode = '22023';
  end if;
  if p_new_starts_at is null or p_new_starts_at <= now() then
    raise exception 'NEW_IN_PAST' using errcode = '22023';
  end if;

  -- ── 🔒 הנעילה (namespace 5) — אותו מפתח בדיוק כמו ב-0018/0020 ───────────
  --
  -- ⚠️ חובה, ולפני כל ספירה או כתיבה. בלעדיה שתי פעולות מקבילות של אותה
  -- לקוחה (בקשת שינוי כאן + בקשת תור רגילה מהמסלול הציבורי) לא היו רואות
  -- זו את זו.
  perform pg_advisory_xact_lock(5, hashtext(p_customer_id::text));

  -- ── הלקוחה קיימת ואינה חסומה ───────────────────────────────────────────
  select * into v_customer from public.customers where id = p_customer_id;
  if v_customer.id is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_customer.is_blocked then
    raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0013';
  end if;

  -- ── התור המקורי, נעול ─────────────────────────────────────────────────
  --
  -- 🔒 סדר הנעילה בכל שלוש הפונקציות של 15E זהה: **המקור תמיד ראשון**,
  -- ורק אחריו הבקשה. סדר קבוע = אין deadlock בין create/approve/reject.
  select * into v_orig
    from public.appointments
    where id = p_appointment_id and customer_id = p_customer_id
    for update;

  if v_orig.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 🔒 **רק תור confirmed ניתן להזזה — וזו כל הבדיקה הנדרשת.**
  --
  -- ⚠️ כאן ישבה קודם בדיקה **נוספת**, שדחתה כל תור שעמודת הקישור שלו
  -- אינה ריקה — והיא הייתה באג.
  -- שורת בקשה שאושרה הופכת ל-confirmed אבל **שומרת** את
  -- reschedule_of_appointment_id לתמיד — הוא התיעוד של מאיפה היא באה.
  -- לכן הבדיקה ההיא חסמה לצמיתות שינוי מועד **שני** על התור הפעיל, והפכה
  -- את max_reschedules=2 לבלתי ניתן להשגה: כל תור יכול היה לזוז פעם אחת
  -- בלבד, בסתירה ישירה להחלטה שהמונה עובר לאורך השרשרת.
  --
  -- הכוונה המקורית הייתה "אי אפשר לבקש שינוי מתוך בקשה שממתינה לאישור",
  -- וזה מובטח לחלוטין ע"י בדיקת ה-status כאן: בקשה שממתינה היא pending,
  -- ובקשה שנדחתה/פגה היא rejected/expired — אף אחת מהן אינה confirmed.
  --
  -- השרשרת הנתמכת: מקור(rc=0) → אושר → פעיל(rc=1) → אושר → פעיל(rc=2)
  --                 → הבקשה הבאה נחסמת ב-MAX_RESCHEDULES למטה.
  if v_orig.status <> 'confirmed' then
    raise exception 'NOT_RESCHEDULABLE' using errcode = 'P0006';
  end if;

  -- פעולת סנכרון פעילה (lease חי) — לא נוגעים בתור תחתיה
  if v_orig.calendar_sync_status = 'syncing'
     and v_orig.calendar_sync_started_at is not null
     and v_orig.calendar_sync_started_at > now() - interval '2 minutes' then
    raise exception 'SYNC_IN_PROGRESS' using errcode = 'P0007';
  end if;

  if v_orig.starts_at <= now() then
    raise exception 'IN_PAST' using errcode = 'P0008';
  end if;

  -- ── המועד המבוקש זהה לקיים ────────────────────────────────────────────
  if v_orig.starts_at = p_new_starts_at then
    raise exception 'NO_CHANGE' using errcode = 'P0014';
  end if;

  -- ── 🔒 חפיפה עצמית ─────────────────────────────────────────────────────
  --
  -- ⚠️ החלטה מפורשת של 15E: יעד שחופף בזמן לתור המקורי **אסור**.
  -- הסיבה אינה אסתטית — היא נובעת ישירות מהמודל: התור המקורי נשאר
  -- confirmed וחוסם את שעתו, ולכן appointments_no_overlap היה דוחה את
  -- ה-INSERT עם 23P01 והלקוחה הייתה מקבלת "המועד נתפס" ע"י התור של
  -- עצמה. עדיף לומר את האמת מראש מאשר לשלוח אותה להתנגשות.
  --
  -- ends_at של הבקשה עדיין לא קיים (הטריגר יכתוב אותו ב-INSERT), ולכן
  -- הוא מחושב כאן מאותו duration_min של התור המקורי.
  v_new_ends_at := p_new_starts_at + make_interval(mins => v_orig.duration_min);
  if tstzrange(p_new_starts_at, v_new_ends_at) && tstzrange(v_orig.starts_at, v_orig.ends_at) then
    raise exception 'SELF_OVERLAP' using errcode = 'P0015';
  end if;

  -- ── מדיניות ────────────────────────────────────────────────────────────
  v_max_resched := public.setting_numeric('max_reschedules', 2)::integer;
  if v_orig.reschedule_count >= v_max_resched then
    raise exception 'MAX_RESCHEDULES' using errcode = 'P0009';
  end if;

  -- ⚠️ **אין כאן ענף has_deposit.** החלטת 15E: כלל אחד — 6 שעות —
  -- לכל לקוחה, מ-business_settings. מסלול 24/48 המקביל שהיה ב-0005
  -- אינו קיים כאן, ו-deposit_reschedule_cutoff_hours אינו נקרא.
  v_cutoff_hours := public.setting_numeric('reschedule_cutoff_hours', 6);
  if v_orig.starts_at < now() + (v_cutoff_hours * interval '1 hour') then
    raise exception 'TOO_LATE' using errcode = 'P0011';
  end if;

  -- ── 🔒 חיתוך התפוגה: בקשה לא שורדת את המועדים שהיא נוגעת בהם ──────────
  --
  -- ⚠️ כלל התפוגה העסקי (15B) מגלגל ל-11:00 ביום העבודה הבא, ולכן
  -- computePendingExpiresAt יכול להחזיר מועד **מאוחר יותר** מהתור עצמו.
  -- דוגמה אמיתית: בקשה נוצרת בחמישי בערב ומתגלגלת לראשון 11:00, בזמן
  -- שהתור המקורי (או היעד) הוא ראשון ב-09:00.
  --
  -- שתי תוצאות אסורות שנמנעות כאן:
  --   1. בקשה שעדיין pending **אחרי** שהתור המקורי כבר התחיל — אישור
  --      שלה היה מזיז תור שכבר קרה.
  --   2. בקשה שעדיין pending **אחרי** שהיעד כבר חלף — אישור שלה היה
  --      יוצר תור מאושר בעבר.
  -- ובנוסף: היעד היה נשאר חסום לשווא אחרי שאיבד כל משמעות.
  --
  -- 🔒 הכלל: expiry = המוקדם מבין (עסקי, מועד המקור, מועד היעד).
  -- שוויון מספיק — ברגע שאחד המועדים מגיע, pending_expires_at <= now()
  -- והבקשה מפסיקה להיות approvable ונאספת ע"י התפוגה.
  --
  -- ⚠️ נאכף **כאן ב-DB** ולא רק בשרת: זו אינווריאנטה של הנתונים, וקורא
  -- עתידי שישלח p_expires_at גדול מדי לא יוכל לעקוף אותה.
  v_expires_at := least(p_expires_at, v_orig.starts_at, p_new_starts_at);

  -- ── תפוגת בקשות ישנות לפני בדיקת הכפילות ──────────────────────────────
  -- בקשת שינוי שכבר פגה לא תחסום בקשה חדשה ולא תמשיך להחזיק את היעד.
  perform public.expire_stale_pending_appointments();

  -- ⚠️ הבדיקה הזו היא לנוסח ההודעה בלבד. ההגנה האמיתית מפני שתי בקשות
  -- מקבילות היא appointments_one_open_reschedule_per_appt.
  if exists (
    select 1 from public.appointments
    where reschedule_of_appointment_id = p_appointment_id and status = 'pending'
  ) then
    raise exception 'REQUEST_EXISTS' using errcode = 'P0016';
  end if;

  -- ── יצירת שורת הבקשה ───────────────────────────────────────────────────
  --
  -- ⚠️ הטיפול, המחיר, המשך והמקדמה מועתקים מהתור המקורי ולא מתקבלים
  -- מהדפדפן — שינוי טיפול אינו בהיקף השלב, ובקשה אינה יכולה להוזיל תור.
  -- booking_source יורש את המקור: אין ערך enum חדש (ראה הכותרת).
  -- ends_at נכתב ע"י הטריגר set_appointment_end.
  -- ⚠️ כשל 23P01 (היעד תפוס) מגלגל לאחור את כל הטרנזקציה, כולל ההיסטוריה.
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status, pending_expires_at,
    notes, policy_version, booking_source, has_deposit,
    reschedule_of_appointment_id
  ) values (
    v_orig.customer_id, v_orig.service_key, v_orig.variants, v_orig.price_total,
    p_new_starts_at, v_orig.duration_min, 'pending', v_expires_at,
    v_orig.notes, v_orig.policy_version, v_orig.booking_source, v_orig.has_deposit,
    p_appointment_id
  )
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, to_starts_at, actor, actor_id, reason
  ) values (
    v_row.id, 'created', null, 'pending',
    v_orig.starts_at, p_new_starts_at, 'customer', p_customer_id,
    'reschedule_request'
  );

  return v_row;
end;
$$;

comment on function public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz) is
  'בקשת שינוי מועד כשורת pending נפרדת. התור המקורי נשאר confirmed וחוסם את שעתו. כלל 6 השעות מ-business_settings, בלי ענף מקדמה.';


-- ============================================================================
-- חלק 3 — אישור בקשת שינוי מועד
--
-- 🔒 **הפעולה הקריטית של 15E.** שתי השורות מתעדכנות ב-UPDATE אחד כל אחת,
-- בתוך טרנזקציה אחת. אין רגע שבו שתי השעות משוחררות ואין רגע שבו התור
-- העסקי אינו קיים: או ששתי הכתיבות עברו, או שאף אחת לא.
--
-- מחזירה jsonb כי צריך להחזיר את **שתי** השורות — החדשה לסנכרון upsert,
-- הישנה לסנכרון delete.
-- ============================================================================

create or replace function public.approve_reschedule_request(
  p_request_id uuid,
  p_admin_id   uuid
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_orig_id  uuid;
  v_orig     public.appointments;
  v_req      public.appointments;
  v_old_start timestamptz;
begin
  -- קריאה לא-נועלת רק כדי לדעת את מזהה המקור, כך שאפשר יהיה לנעול
  -- **קודם את המקור** ואחר כך את הבקשה — אותו סדר בדיוק כמו ב-
  -- create_reschedule_request וב-reject_reschedule_request.
  select reschedule_of_appointment_id into v_orig_id
    from public.appointments where id = p_request_id;

  if v_orig_id is null then
    raise exception 'NOT_A_REQUEST' using errcode = 'P0017';
  end if;

  select * into v_orig from public.appointments where id = v_orig_id for update;
  select * into v_req  from public.appointments where id = p_request_id for update;

  if v_req.id is null or v_orig.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ⚠️ תפוגה נבדקת כאן, בתוך הנעילה, בדיוק כמו ב-approve_pending_appointment.
  -- בלי זה אישור ותפוגה מקבילים היו יכולים שניהם "להצליח".
  if v_req.status <> 'pending'
     or (v_req.pending_expires_at is not null and v_req.pending_expires_at <= now()) then
    raise exception 'NOT_PENDING' using errcode = 'P0003';
  end if;

  -- 🔒 המקור חייב להיות עדיין confirmed. אם שובל ביטלה אותו בינתיים, אין
  -- מה "להעביר" — והשארת הבקשה pending היא התשובה הנכונה, לא אישור שקט.
  if v_orig.status <> 'confirmed' then
    raise exception 'ORIGINAL_NOT_CONFIRMED' using errcode = 'P0018';
  end if;

  -- ── 🔒 שני המועדים חייבים להיות עדיין בעתיד ────────────────────────────
  --
  -- ⚠️ חגורה שנייה מעל חיתוך התפוגה ב-create_reschedule_request. אחרי
  -- החיתוך pending_expires_at <= least(original, target), ולכן בדיקת
  -- ה-NOT_PENDING שלמעלה כבר חוסמת את המקרה — אבל רק עבור שורות שנוצרו
  -- **אחרי** שהחיתוך קיים. הבדיקות כאן מגנות גם על שורה ישנה, על שעון
  -- שקפץ, ועל קורא שיכתוב p_expires_at ידנית ב-SQL Editor.
  --
  -- אישור תור לשעה שכבר עברה הוא בדיוק סוג הכשל שאין ממנו חזרה: הוא
  -- משחרר את השעה הישנה ויוצר אירוע ביומן בעבר.
  if v_orig.starts_at <= now() then
    raise exception 'ORIGINAL_IN_PAST' using errcode = 'P0008';
  end if;

  if v_req.starts_at <= now() then
    raise exception 'TARGET_IN_PAST' using errcode = 'P0008';
  end if;

  -- lease סנכרון פעיל על אחת מהשתיים — לא נוגעים תחתיו
  if (v_orig.calendar_sync_status = 'syncing'
      and v_orig.calendar_sync_started_at is not null
      and v_orig.calendar_sync_started_at > now() - interval '2 minutes')
     or (v_req.calendar_sync_status = 'syncing'
      and v_req.calendar_sync_started_at is not null
      and v_req.calendar_sync_started_at > now() - interval '2 minutes') then
    raise exception 'SYNC_IN_PROGRESS' using errcode = 'P0007';
  end if;

  v_old_start := v_orig.starts_at;

  -- ── הבקשה הופכת לתור הפעיל ─────────────────────────────────────────────
  --
  -- reschedule_count עובר מהמקור +1 — כך שמגבלת max_reschedules נשמרת
  -- לאורך כל השרשרת ולא מתאפסת בכל בקשה (החלטת 15E).
  -- original_starts_at שומר את המועד המקורי **הראשון** בשרשרת.
  update public.appointments
  set status                   = 'confirmed',
      pending_expires_at       = null,
      reschedule_count         = v_orig.reschedule_count + 1,
      original_starts_at       = coalesce(v_orig.original_starts_at, v_old_start),
      calendar_sync_operation  = 'upsert',
      calendar_sync_status     = 'pending',
      calendar_sync_started_at = null
  where id = p_request_id
  returning * into v_req;

  -- ── התור המקורי עובר לארכיון ומשחרר את שעתו ────────────────────────────
  --
  -- 'rescheduled' אינו נמנה ב-appointments_no_overlap, ולכן השעה הישנה
  -- משתחררת ברגע ה-COMMIT — לא לפניו.
  -- calendar_sync_operation='delete' הוא מה שיגרום ל-ensureCalendarSynced
  -- למחוק את האירוע הישן. בלעדיו האירוע היה נשאר ביומן וממשיך לחסום שעה
  -- שכבר התפנתה.
  update public.appointments
  set status                   = 'rescheduled',
      calendar_sync_operation  = 'delete',
      calendar_sync_status     = 'pending',
      calendar_sync_started_at = null
  where id = v_orig_id
  returning * into v_orig;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, to_starts_at, actor, actor_id, reason
  ) values (
    v_orig_id, 'rescheduled', 'confirmed', 'rescheduled',
    v_old_start, v_req.starts_at, 'admin', p_admin_id,
    'reschedule_approved'
  );

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, to_starts_at, actor, actor_id, reason
  ) values (
    p_request_id, 'status_changed', 'pending', 'confirmed',
    v_old_start, v_req.starts_at, 'admin', p_admin_id,
    'reschedule_approved'
  );

  return jsonb_build_object(
    'request',  to_jsonb(v_req),
    'original', to_jsonb(v_orig)
  );
end;
$$;

comment on function public.approve_reschedule_request(uuid, uuid) is
  'אישור בקשת שינוי מועד. הבקשה→confirmed(upsert) והמקור→rescheduled(delete) בטרנזקציה אחת. reschedule_count עובר לשרשרת.';


-- ============================================================================
-- חלק 4 — דחיית בקשת שינוי מועד
--
-- 🔒 **התור המקורי אינו נגוע כאן באף שדה.** זו כל ההבטחה של הדחייה.
-- ============================================================================

create or replace function public.reject_reschedule_request(
  p_request_id uuid,
  p_admin_id   uuid
) returns public.appointments
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_orig_id uuid;
  v_row     public.appointments;
begin
  select reschedule_of_appointment_id into v_orig_id
    from public.appointments where id = p_request_id;

  if v_orig_id is null then
    raise exception 'NOT_A_REQUEST' using errcode = 'P0017';
  end if;

  -- אותו סדר נעילה: המקור ראשון. הוא אינו משתנה — הנעילה כאן היא רק
  -- כדי שלא ייווצר סדר הפוך מול approve/create ובעקבותיו deadlock.
  perform 1 from public.appointments where id = v_orig_id for update;

  -- ה-WHERE הוא מפתח ה-idempotency, בדיוק כמו ב-reject_pending_appointment
  -- (0019): לחיצה כפולה, או Approve ו-Reject במקביל, מקבלים אפס שורות
  -- בפעולה השנייה ונופלים ל-NOT_PENDING.
  update public.appointments
  set status = 'rejected'
  where id = p_request_id
    and status = 'pending'
    and reschedule_of_appointment_id is not null
    and (pending_expires_at is null or pending_expires_at > now())
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_PENDING' using errcode = 'P0003';
  end if;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, to_starts_at, actor, actor_id, reason
  ) values (
    v_row.id, 'status_changed', 'pending', 'rejected', v_row.starts_at, 'admin', p_admin_id,
    'reschedule_rejected'
  );

  return v_row;
end;
$$;

comment on function public.reject_reschedule_request(uuid, uuid) is
  'דחיית בקשת שינוי מועד → rejected. היעד משתחרר; התור המקורי נשאר בדיוק כפי שהיה.';


-- ============================================================================
-- חלק 5 — claim_calendar_sync לומדת את המקור שהוזז
--
-- ⚠️ **בלי החלק הזה 15E שבור בשקט.** הגרסה מ-0005 מתירה claim רק ל-
-- (confirmed, upsert) ול-(cancelled_by_customer, delete). תור מקורי שעבר
-- ל-(rescheduled, delete) לא היה claimable, האירוע הישן לעולם לא היה
-- נמחק מהיומן, והוא היה ממשיך לחסום שעה שכבר התפנתה — בלי שגיאה ובלי
-- הופעה במסך הניהול.
--
-- שאר ההתנהגות — ה-lease של 2 דקות ומונה הניסיונות — נשארת מילה במילה.
--
-- ⚠️ 'rejected' ו-'expired' **אינם** כאן בכוונה: שורת בקשה שנדחתה או פגה
-- מעולם לא הייתה confirmed, ולכן מעולם לא נוצר לה אירוע ביומן ואין מה
-- למחוק.
-- ============================================================================

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
      or (status = 'rescheduled' and calendar_sync_operation = 'delete')
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


-- ============================================================================
-- חלק 6 — ביטול עצמי: הסרת מסלול המקדמה המקביל
--
-- החלטת 15E: כלל אחד לביטול עצמי — cancel_cutoff_hours מ-business_settings
-- (6 בפרודקשן) — **לכל לקוחה, עם מקדמה או בלי**.
--
-- ⚠️ מה בדיוק השתנה מול 0005, ותו לא:
--   ❌ הוסר: `if has_deposit and not setting_boolean('allow_cancel_with_deposit')
--            then DEPOSIT_LOCKED` — חסימה מוחלטת של ביטול עצמי לתור עם מקדמה
--   ✏️ ברירת המחדל של cancel_cutoff_hours: 24 → 6, כך שמחיקת ה-key
--      בטעות לא תחזיר בשקט את הכלל הישן
-- כל השאר — ה-FOR UPDATE, ה-idempotency, בדיקת ה-lease, IN_PAST,
-- calendar_sync_operation='delete' וההיסטוריה — זהה מילה במילה ל-0005.
--
-- ⚠️ ההשפעה על נתונים קיימים היא **אפס**: נבדק בפרודקשן שאין ולו שורה
-- אחת עם has_deposit = true.
--
-- 🔒 allow_cancel_with_deposit ו-deposit_reschedule_cutoff_hours נשארים
-- בטבלה ואינם נמחקים — מיגרציה תוספתית. הם פשוט אינם נקראים יותר.
-- ============================================================================

create or replace function public.cancel_confirmed_appointment_by_customer(
  p_appointment_id uuid,
  p_customer_id    uuid
) returns jsonb
language plpgsql
as $$
declare
  v_row          public.appointments;
  v_cutoff_hours numeric;
  v_req_id       uuid;
  v_req_starts   timestamptz;
begin
  -- 🔒 סדר נעילה עקבי עם כל 15E: **המקור ראשון**, הבקשה אחריו (למטה).
  -- זה מה שהופך את המרוץ מול approve/reject לבטוח לשני הכיוונים.
  select * into v_row
    from public.appointments
    where id = p_appointment_id and customer_id = p_customer_id
    for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

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

  v_cutoff_hours := public.setting_numeric('cancel_cutoff_hours', 6);
  if v_row.starts_at < now() + (v_cutoff_hours * interval '1 hour') then
    raise exception 'TOO_LATE' using errcode = 'P0011';
  end if;

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

  -- ══ 🔒 15E — ביטול המקור סוגר גם בקשת שינוי מועד פתוחה ══════════════════
  --
  -- ⚠️ בלי החלק הזה נוצר **ghost pending**: הלקוחה מבטלת את התור המקורי,
  -- הבקשה נשארת pending, וממשיכה לחסום את שעת היעד ביומן עד התפוגה —
  -- שעה שאיש כבר לא יכול לקבל. אומת בפועל לפני התיקון: לקוחה אחרת נחסמה
  -- מהשעה הזו, בזמן ש-approve_reschedule_request ממילא כבר החזיר
  -- ORIGINAL_NOT_CONFIRMED. כלומר חסימה ללא שום תועלת.
  --
  -- למה לסגור את הבקשה ולא לחסום את הביטול: ברגע שהמקור מבוטל הבקשה
  -- חסרת משמעות — היא כבר אינה ניתנת לאישור. חסימת הביטול הייתה מענישה
  -- את הלקוחה על פעולה לגיטימית ומחזירה אותה לוואטסאפ, בדיוק מה ש-15E
  -- בא לבטל.
  --
  -- 🔒 אטומי עם ביטול המקור: או ששניהם קרו או שאף אחד. השעה משתחררת
  -- באותו COMMIT, כי 'rejected' אינו נמנה ב-appointments_no_overlap.
  --
  -- ⚠️ **אין כאן שום נגיעה ב-Google.** לבקשה שממתינה לאישור מעולם לא נוצר
  -- אירוע ביומן, ולכן אין מה למחוק. calendar_sync_* שלה נשארים כפי שהם
  -- ו-claim_calendar_sync לא תיגע בה ('rejected' אינו ברשימה שלה).
  -- התור המקורי ממשיך במסלול הרגיל: cancelled_by_customer + delete.
  --
  -- ⚠️ idempotency: ביטול חוזר יוצא מוקדם ב-'already_cancelled' שלמעלה
  -- ולעולם לא מגיע לכאן, ולכן אין שורת היסטוריה כפולה לבקשה.
  update public.appointments
  set status             = 'rejected',
      pending_expires_at = null
  where reschedule_of_appointment_id = p_appointment_id
    and status = 'pending'
  returning id, starts_at into v_req_id, v_req_starts;

  if v_req_id is not null then
    insert into public.appointment_history (
      appointment_id, action, from_status, to_status,
      to_starts_at, actor, actor_id, reason
    ) values (
      v_req_id, 'status_changed', 'pending', 'rejected',
      v_req_starts, 'customer', p_customer_id, 'original_cancelled'
    );
  end if;

  return jsonb_build_object(
    'outcome',              'applied',
    'appointment',          to_jsonb(v_row),
    -- מזהה בקשת השינוי שנסגרה יחד עם הביטול, או null. הקורא אינו חייב
    -- לעשות איתו דבר — אין לו עבודת יומן פתוחה.
    'cancelled_request_id', v_req_id
  );
end;
$$;

comment on function public.cancel_confirmed_appointment_by_customer(uuid, uuid) is
  'ביטול עצמי של תור מאושר, 6 שעות לכל לקוחה. סוגר אטומית גם בקשת שינוי מועד פתוחה (rejected) ומשחרר את שעת היעד — בלי נגיעה ביומן עבורה.';


-- ============================================================================
-- חלק 7 — הרשאות
--
-- ⚠️ `from public, anon, authenticated` — ולא `from public` בלבד. זו הטעות
-- שתוקנה ב-0006: REVOKE מ-public אינו מסיר את ההענקה הישירה ש-Supabase
-- נותנת ל-anon ול-authenticated, ו-PostgREST ממשיך לחשוף את הפונקציה לכל
-- מי שמחזיק את מפתח ה-anon.
--
-- ⚠️ חמור במיוחד כאן: create_reschedule_request מקבלת customer_id
-- כפרמטר, ו-approve/reject מקבלות admin_id. חשיפה ל-anon הייתה מאפשרת
-- לכל אחד להזיז תור של כל לקוחה, או לאשר בקשות בשם שובל.
-- ============================================================================

revoke execute on function public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.approve_reschedule_request(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.reject_reschedule_request(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.approve_reschedule_request(uuid, uuid) to service_role;
grant execute on function public.reject_reschedule_request(uuid, uuid) to service_role;


-- ============================================================================
-- אימות — נכשל בקול במקום להשאיר מצב חלקי בשקט
-- ============================================================================

do $$
declare
  v_missing text;
begin
  -- ── הסכימה ─────────────────────────────────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'reschedule_of_appointment_id'
  ) then
    raise exception '0022: reschedule_of_appointment_id לא נוספה' using errcode = 'P0103';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'appointments_one_open_reschedule_per_appt'
  ) then
    raise exception '0022: אינדקס הבקשה-הפתוחה-היחידה לא נוצר' using errcode = 'P0103';
  end if;

  -- ── שלוש הפונקציות החדשות ──────────────────────────────────────────────
  foreach v_missing in array array[
    'create_reschedule_request', 'approve_reschedule_request', 'reject_reschedule_request'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_missing
    ) then
      raise exception '0022: % לא נוצרה', v_missing using errcode = 'P0103';
    end if;

    -- 🔒 חייבות להישאר INVOKER. prosecdef = true מסמן DEFINER.
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_missing and p.prosecdef
    ) then
      raise exception '0022: % הוגדרה כ-SECURITY DEFINER', v_missing using errcode = 'P0103';
    end if;
  end loop;

  -- ── 🔒 ההרשאות בפועל, לא רק הצהרת ה-REVOKE ────────────────────────────
  if has_function_privilege('anon',
       'public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz)', 'execute')
  then raise exception '0022: anon יכול להפעיל את create_reschedule_request'; end if;
  if has_function_privilege('authenticated',
       'public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz)', 'execute')
  then raise exception '0022: authenticated יכול להפעיל את create_reschedule_request'; end if;
  if has_function_privilege('anon', 'public.approve_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0022: anon יכול להפעיל את approve_reschedule_request'; end if;
  if has_function_privilege('anon', 'public.reject_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0022: anon יכול להפעיל את reject_reschedule_request'; end if;

  -- ⚠️ הכיוון ההפוך: ההרשאה של service_role חייבת *להישמר*.
  if not has_function_privilege('service_role',
       'public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz)', 'execute')
  then raise exception '0022: service_role איבד את create_reschedule_request'; end if;
  if not has_function_privilege('service_role', 'public.approve_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0022: service_role איבד את approve_reschedule_request'; end if;
  if not has_function_privilege('service_role', 'public.reject_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0022: service_role איבד את reject_reschedule_request'; end if;

  /*
   * 🔒 ה-RPC הישן חייב **להישאר חי** אחרי המיגרציה הזו.
   *
   * ⚠️ זו אינה בדיקה הפוכה בטעות. כל עוד רק 0022 הותקנה, ייתכן שרץ
   * בפרודקשן deployment ישן שעדיין קורא ל-reschedule_appointment_by_customer.
   * אם היא נעלמה כאן — מישהו הריץ את 0023 מוקדם מדי.
   */
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reschedule_appointment_by_customer'
  ) then
    raise exception
      '0022: reschedule_appointment_by_customer כבר אינה קיימת — 0023 הורצה לפני הזמן'
      using errcode = 'P0103';
  end if;

  -- 🔒 ה-EXCLUDE constraint לא נגוע — הוא ההגנה שכל המודל נשען עליה.
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_no_overlap'
  ) then
    raise exception '0022: appointments_no_overlap נעלם' using errcode = 'P0103';
  end if;

  raise notice '0022: בקשת שינוי מועד כשורה שנייה. claim_calendar_sync לומדת (rescheduled,delete). ביטול עצמי = 6 שעות לכולן. reschedule_appointment_by_customer נשארת חיה בכוונה — 0023 מוחקת אותה אחרי הפריסה ו-QA-E.';
end $$;
