-- ============================================================================
-- 0021 — שלב 15D: הסרת create_pending_appointment (0003)
--
-- ⚠️ **מיגרציה מינימלית במכוון.** היא עושה דבר אחד: DROP לפונקציה אחת.
-- אין כאן שינוי סכימה, אין פונקציה חדשה, אין נגיעה בנתונים ואין backfill.
--
-- ═══ 🔒 מתי מריצים אותה — ולא לפני ═══
--
-- זהו החלק השני של פריסה דו-שלבית שנועדה **לבטל לגמרי** את חלון השבירה:
--
--   1. 0020 בפרודקשן          — שתי הפונקציות חיות זו לצד זו
--   2. פריסת הקוד של 15D      — הקוד עובר לקרוא רק ל-RPC החדש
--   3. QA-D בפרודקשן          — מאמת שהמסלול החדש עובד מקצה לקצה
--   4. **0021 (הקובץ הזה)**   — רק עכשיו, כשאין בעולם קוד שקורא לישנה
--
-- ⚠️ הרצה של הקובץ הזה **לפני** שלב 3 מחזירה בדיוק את הבעיה שהפיצול נועד
-- למנוע: deployment ישן שעדיין קורא ל-create_pending_appointment יקבל 500
-- על כל בקשת תור מהאזור האישי. 0020 אף אוכפת את זה מצידה — בלוק ה-DO שלה
-- נכשל אם הפונקציה כבר נעלמה, כדי לתפוס הרצה בסדר הפוך.
--
-- ═══ למה בכלל למחוק ═══
--
-- create_pending_appointment חישבה את התפוגה בעצמה:
--   pending_expires_at = now() + business_settings.pending_expiration_hours  (=12)
--
-- הכלל הזה בוטל ב-15B והוחלף ב-3 שעות עם גלגול ל-11:00 ביום העבודה הבא
-- (lib/pendingExpiry.ts). הפונקציה נשארה מוענקת ל-service_role, כלומר כל
-- קוד עתידי שיקרא לה יקבל שקט מוחלט ותור שמחזיק סלוט פי ארבעה מהמותר.
-- **RPC חי עם כלל עסקי מת הוא מלכודת, לא גיבוי.**
--
-- ═══ מה אומת לפני המחיקה ═══
--
-- 🔒 חיפוש מלא בכל הפרויקט: הקורא היחיד ב-runtime היה
-- lib/db/appointments.ts → createPendingAppointment, שנקרא אך ורק מ-
-- app/api/appointments/route.ts — אותו route שעבר ב-15D לפונקציה החדשה.
-- כל שאר ההופעות הן קבצי מיגרציה היסטוריים, תיעוד וסקריפטי בדיקה.
--
-- ⚠️ **cancel_pending_appointment ו-expire_stale_pending_appointments אינן
-- נמחקות.** שתיהן בשימוש פעיל — ביטול בקשה מהאזור האישי, ותפוגה עצלה
-- שנקראת משלושה מסלולים שונים — ואין להן שום קשר לכלל התפוגה שהוחלף.
-- בלוק האימות למטה מוודא במפורש שהן שרדו.
--
-- ⚠️ 0003 עצמה אינה משתנה. היא רצה בפרודקשן, ואין לגעת בקובץ שכבר הותקן —
-- המחיקה מוצהרת כאן, במיגרציה חדשה, בדיוק כמו כל שינוי אחר בפרויקט.
--
-- ⚠️ scripts/test-rpc-permissions.mjs ממשיך למנות את החתימה ברשימת ההגנה
-- שלו. זו אינה שכחה: הבדיקה קוראת את *קבצי המיגרציה*, ופקודת ה-CREATE
-- ב-0003 תישאר שם לנצח. מה שמוכיח שהפונקציה באמת מתה הוא בלוק ה-DO כאן
-- ו-scripts/test-personal-area-db.mjs, ששניהם בודקים את pg_proc בפועל.
-- ============================================================================


-- ─── המחיקה ────────────────────────────────────────────────────────────────
--
-- ⚠️ החתימה המלאה ולא רק השם. אין overload נוסף היום, אבל DROP לפי שם בלבד
-- אינו חוקי ב-Postgres כשקיימת יותר מגרסה אחת, ומפורש עדיף על מרומז.
--
-- IF EXISTS כדי שהרצה חוזרת של המיגרציה לא תיכשל. הבדיקה שהפונקציה באמת
-- איננה נמצאת בבלוק האימות למטה, ולכן ה-IF EXISTS אינו מסתיר כישלון.

drop function if exists public.create_pending_appointment(
  uuid, text, text[], integer, timestamptz, integer, text, text
);


-- ─── אימות ─────────────────────────────────────────────────────────────────
do $$
begin
  -- 🔒 1. הפונקציה באמת נעלמה. בלי הבדיקה הזו, DROP שלא תפס (חתימה שונה
  --       ממה שקיים בפועל) היה עובר בשקט בזכות ה-IF EXISTS, ומשאיר שתי
  --       דרכים ליצור בקשה — אחת מהן עם כלל התפוגה שבוטל.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_pending_appointment'
  ) then
    raise exception '0021: create_pending_appointment עדיין קיימת' using errcode = 'P0103';
  end if;

  -- 🔒 2. המחליפה קיימת. מחיקת הישנה בלי שהחדשה הותקנה משאירה את האזור
  --       האישי בלי שום דרך ליצור בקשה — כלומר 0020 לא רצה, והסדר הופר.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_personal_area_booking_request'
  ) then
    raise exception
      '0021: create_personal_area_booking_request חסרה — 0020 לא הותקנה'
      using errcode = 'P0103';
  end if;

  -- 🔒 3. שתי הפונקציות הנוספות מ-0003 שרדו את המחיקה.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cancel_pending_appointment'
  ) then
    raise exception '0021: cancel_pending_appointment נמחקה בטעות' using errcode = 'P0103';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'expire_stale_pending_appointments'
  ) then
    raise exception '0021: expire_stale_pending_appointments נמחקה בטעות' using errcode = 'P0103';
  end if;

  /*
   * ── 🔒 4. ההרשאות של המחליפה לא נפגעו מה-DROP ──────────────────────────
   *
   * ⚠️ DROP על פונקציה אחרת אינו אמור לגעת ב-ACL של פונקציה אחרת, ובכל זאת
   * הבדיקה כאן ולא ב-0020 בלבד: זו המיגרציה האחרונה בשרשרת 15D, והמצב
   * שהיא מותירה הוא המצב שיישאר בפרודקשן. בדיקה על טקסט REVOKE אינה
   * מספיקה — רק has_function_privilege מוכיח שהדלת באמת סגורה (זו הטעות
   * ש-0006 בא לתקן).
   */
  if has_function_privilege('anon',
       'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz)', 'execute')
  then raise exception '0021: anon יכול להפעיל את create_personal_area_booking_request'; end if;

  if has_function_privilege('authenticated',
       'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz)', 'execute')
  then raise exception '0021: authenticated יכול להפעיל את create_personal_area_booking_request'; end if;

  -- ⚠️ הכיוון ההפוך: ההרשאה של service_role חייבת *להישמר*. בדיקה שרק
  -- מוודאת ש-anon חסום הייתה עוברת גם אם הכול נסגר.
  if not has_function_privilege('service_role',
       'public.create_personal_area_booking_request(uuid, text, text[], integer, timestamptz, integer, text, text, timestamptz)', 'execute')
  then raise exception '0021: service_role איבד את create_personal_area_booking_request'; end if;

  -- 🔒 5. גם שתי הפונקציות ששרדו נשארו מוענקות ל-service_role בלבד.
  if not has_function_privilege('service_role',
       'public.cancel_pending_appointment(uuid, uuid)', 'execute')
  then raise exception '0021: service_role איבד את cancel_pending_appointment'; end if;

  if not has_function_privilege('service_role',
       'public.expire_stale_pending_appointments()', 'execute')
  then raise exception '0021: service_role איבד את expire_stale_pending_appointments'; end if;

  raise notice '0021: create_pending_appointment הוסרה. נשארה בדיוק דרך אחת ליצור בקשה מהאזור האישי, עם כלל התפוגה של 15B.';
end $$;
