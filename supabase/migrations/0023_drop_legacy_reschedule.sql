-- ============================================================================
-- 0023 — שלב 15E: הסרת reschedule_appointment_by_customer (0005)
--
-- ⚠️ **מיגרציה מינימלית במכוון.** היא עושה דבר אחד: DROP לפונקציה אחת.
-- אין כאן שינוי סכימה, אין פונקציה חדשה, אין נגיעה בנתונים ואין backfill.
--
-- ═══ 🔒 מתי מריצים אותה — ולא לפני ═══
--
-- אותה פריסה דו-שלבית בדיוק כמו 0020→0021 ב-15D:
--
--   1. 0022 בפרודקשן        — שלוש פונקציות 15E חיות לצד הישנה
--   2. פריסת הקוד של 15E    — הקוד עובר למסלול הבקשה (commit 6632ad0)
--   3. QA-E בפרודקשן        — A/B/C + ביטול עם בקשה פתוחה, מקצה לקצה
--   4. ניקוי נתוני QA-E     — .handoff/STAGE-15E-QA-CLEANUP.sql
--   5. **0023 (הקובץ הזה)** — רק עכשיו, כשאין בעולם קוד שקורא לישנה
--
-- ═══ למה בכלל למחוק ═══
--
-- reschedule_appointment_by_customer הזיזה תור **מיידית**: UPDATE ישיר על
-- starts_at של השורה הקיימת, בלי אישור ובלי שלב ביניים. 15E החליף את
-- המודל לחלוטין — שינוי מועד הוא **בקשה** שאינה משחררת את התור המקורי עד
-- ששובל מכריעה.
--
-- 🔴 השארתה חיה ומוענקת ל-service_role פירושה שתי דרכים סותרות להזיז תור:
-- אחת שמכבדת את מודל האישור, ואחת שעוקפת אותו בשקט ומזיזה תור של לקוחה
-- בלי ששובל ראתה בקשה. **RPC חי עם מודל עסקי מת הוא מלכודת, לא גיבוי.**
--
-- ובנוסף: היא מחזיקה עותק משלה של כלל ה-6 שעות ושל max_reschedules, כולל
-- ענף המקדמה ש-15E ביטל. שני עותקים של אותה מדיניות = שניים שיתבדרו.
--
-- ═══ מה אומת לפני המחיקה ═══
--
-- 🔒 חיפוש מלא בכל הפרויקט: הקורא היחיד ב-runtime היה
-- lib/db/appointments.ts → rescheduleAppointmentByCustomer, ול-**פונקציה
-- הזו אין אף קורא** ב-lib/app/components מאז 15E. כל שאר ההופעות הן קבצי
-- מיגרציה היסטוריים, תיעוד וסקריפטי בדיקה.
--
-- ⚠️ **cancel_confirmed_appointment_by_customer אינה נמחקת.** היא מ-0005
-- כמו הישנה, אבל היא בשימוש פעיל — ביטול עצמי מהאזור האישי — ו-15E דווקא
-- *שיפר* אותה (הסרת ענף המקדמה + סגירת בקשה פתוחה). בלוק האימות למטה
-- מוודא במפורש שהיא שרדה, יחד עם setting_numeric/setting_boolean,
-- complete_calendar_delete, claim_calendar_sync ו-approve_pending_appointment
-- — כל שאר תוצרי 0005.
--
-- ⚠️ 0005 עצמה אינה משתנה. היא רצה בפרודקשן, ואין לגעת בקובץ שכבר הותקן.
--
-- ⚠️ scripts/test-rpc-permissions.mjs ממשיך למנות את החתימה ברשימת ההגנה
-- שלו. זו אינה שכחה: הבדיקה קוראת את *קבצי המיגרציה*, ופקודת ה-CREATE
-- ב-0005 תישאר שם לנצח. מה שמוכיח שהפונקציה באמת מתה הוא בלוק ה-DO כאן.
-- ============================================================================


-- ─── המחיקה ────────────────────────────────────────────────────────────────
--
-- ⚠️ החתימה המלאה ולא רק השם. אין overload נוסף היום, אבל DROP לפי שם בלבד
-- אינו חוקי ב-Postgres כשקיימת יותר מגרסה אחת, ומפורש עדיף על מרומז.
--
-- ⚠️ הפרמטר הרביעי הוא `default null` ב-0005, אבל ל-DROP אין משמעות
-- לברירות מחדל — החתימה היא ארבעת הטיפוסים.
--
-- IF EXISTS כדי שהרצה חוזרת לא תיכשל. הבדיקה שהפונקציה באמת איננה נמצאת
-- בבלוק האימות למטה, ולכן ה-IF EXISTS אינו מסתיר כישלון.

drop function if exists public.reschedule_appointment_by_customer(
  uuid, uuid, timestamptz, timestamptz
);


-- ─── אימות ─────────────────────────────────────────────────────────────────
do $$
declare
  -- כל תוצרי 0005 חוץ מהנמחקת — כולם חייבים לשרוד.
  c_survivors constant text[] := array[
    'setting_numeric',
    'setting_boolean',
    'cancel_confirmed_appointment_by_customer',
    'complete_calendar_delete',
    'claim_calendar_sync',
    'approve_pending_appointment'
  ];
  -- שלוש המחליפות מ-0022.
  c_replacements constant text[] := array[
    'create_reschedule_request',
    'approve_reschedule_request',
    'reject_reschedule_request'
  ];
  v_name text;
begin
  -- 🔒 1. הפונקציה באמת נעלמה. בלי הבדיקה הזו, DROP שלא תפס (חתימה שונה
  --       ממה שקיים בפועל) היה עובר בשקט בזכות ה-IF EXISTS, ומשאיר שתי
  --       דרכים להזיז תור — אחת מהן עוקפת את מודל האישור של 15E.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reschedule_appointment_by_customer'
  ) then
    raise exception '0023: reschedule_appointment_by_customer עדיין קיימת' using errcode = 'P0103';
  end if;

  -- 🔒 2. שלוש המחליפות קיימות. מחיקת הישנה בלי ש-0022 הותקנה משאירה את
  --       האזור האישי בלי שום דרך לבקש שינוי מועד — כלומר הסדר הופר.
  foreach v_name in array c_replacements loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    ) then
      raise exception '0023: % חסרה — 0022 לא הותקנה', v_name using errcode = 'P0103';
    end if;
  end loop;

  -- 🔒 3. כל שאר תוצרי 0005 שרדו את המחיקה.
  foreach v_name in array c_survivors loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    ) then
      raise exception '0023: % נמחקה בטעות', v_name using errcode = 'P0103';
    end if;
  end loop;

  /*
   * ── 🔒 4. ההרשאות של המחליפות לא נפגעו ─────────────────────────────────
   *
   * ⚠️ DROP על פונקציה אחרת אינו אמור לגעת ב-ACL של פונקציה אחרת, ובכל זאת
   * הבדיקה כאן: זו המיגרציה האחרונה בשרשרת 15E, והמצב שהיא מותירה הוא
   * המצב שיישאר בפרודקשן. בדיקה על טקסט REVOKE אינה מספיקה — רק
   * has_function_privilege מוכיח שהדלת באמת סגורה (זו הטעות ש-0006 בא לתקן).
   */
  if has_function_privilege('anon',
       'public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz)', 'execute')
  then raise exception '0023: anon יכול להפעיל את create_reschedule_request'; end if;

  if has_function_privilege('authenticated',
       'public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz)', 'execute')
  then raise exception '0023: authenticated יכול להפעיל את create_reschedule_request'; end if;

  if has_function_privilege('anon',
       'public.approve_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0023: anon יכול להפעיל את approve_reschedule_request'; end if;

  if has_function_privilege('authenticated',
       'public.approve_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0023: authenticated יכול להפעיל את approve_reschedule_request'; end if;

  if has_function_privilege('anon',
       'public.reject_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0023: anon יכול להפעיל את reject_reschedule_request'; end if;

  if has_function_privilege('authenticated',
       'public.reject_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0023: authenticated יכול להפעיל את reject_reschedule_request'; end if;

  -- ⚠️ הכיוון ההפוך: ההרשאה של service_role חייבת *להישמר*. בדיקה שרק
  -- מוודאת ש-anon חסום הייתה עוברת גם אם הכול נסגר.
  if not has_function_privilege('service_role',
       'public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz)', 'execute')
  then raise exception '0023: service_role איבד את create_reschedule_request'; end if;

  if not has_function_privilege('service_role',
       'public.approve_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0023: service_role איבד את approve_reschedule_request'; end if;

  if not has_function_privilege('service_role',
       'public.reject_reschedule_request(uuid, uuid)', 'execute')
  then raise exception '0023: service_role איבד את reject_reschedule_request'; end if;

  -- 🔒 5. הביטול העצמי — הפונקציה הרגישה ביותר ששרדה — נשארה מוענקת
  --       ל-service_role בלבד. היא נוגעת גם בבקשות שינוי פתוחות (15E),
  --       ולכן דלת פתוחה אליה חמורה במיוחד.
  if has_function_privilege('anon',
       'public.cancel_confirmed_appointment_by_customer(uuid, uuid)', 'execute')
  then raise exception '0023: anon יכול להפעיל את cancel_confirmed_appointment_by_customer'; end if;

  if has_function_privilege('authenticated',
       'public.cancel_confirmed_appointment_by_customer(uuid, uuid)', 'execute')
  then raise exception '0023: authenticated יכול להפעיל את cancel_confirmed_appointment_by_customer'; end if;

  if not has_function_privilege('service_role',
       'public.cancel_confirmed_appointment_by_customer(uuid, uuid)', 'execute')
  then raise exception '0023: service_role איבד את cancel_confirmed_appointment_by_customer'; end if;

  raise notice '0023: reschedule_appointment_by_customer הוסרה. נשארה בדיוק דרך אחת להזיז תור — בקשה שמצריכה אישור.';
end $$;
