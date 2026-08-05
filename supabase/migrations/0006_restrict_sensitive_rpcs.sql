-- ============================================================================
-- 0006 — הרשאות: סגירת ה-RPCs הרגישים ל-service_role בלבד
--
-- תלוי ב-0001–0005 שכבר רצו. אין כאן שום שינוי בלוגיקה, ב-RLS, ב-SECURITY
-- INVOKER או בסכמה — אך ורק הרשאות EXECUTE.
--
-- ─── מה התגלה ────────────────────────────────────────────────────────────
--
-- 0003, 0004 ו-0005 סיימו כולן בדפוס:
--
--     revoke execute on function public.X(...) from public;
--     grant  execute on function public.X(...) to service_role;
--
-- הכוונה הייתה "service_role בלבד". בפועל זה לא מה שקרה: בפרויקט Supabase
-- קיימות default privileges שמעניקות EXECUTE על פונקציות חדשות בסכמה
-- public ישירות ל-anon ול-authenticated. REVOKE ... FROM PUBLIC מסיר רק את
-- ההרשאה המשתמעת של PUBLIC — הוא לא נוגע בהענקה *ישירה* לתפקיד. התוצאה:
-- כל אחת מהפונקציות האלה הייתה קריאה בפועל דרך מפתח ה-anon, שממילא נשלח
-- לדפדפן.
--
-- ─── מה זה לא היה ────────────────────────────────────────────────────────
--
-- לא פרצה שניתן היה לנצל. כל הפונקציות הן SECURITY INVOKER, ולכן רצות
-- בהרשאות הקורא; ל-appointments אין policy ל-UPDATE למי שאינה מנהלת, ולכן
-- כל UPDATE בתוכן נגע ב-0 שורות והפונקציה החזירה NOT_FOUND/NOT_PENDING.
-- נבדק בפועל מול הפרויקט האמיתי: ניסיונות אישור, דחייה, ביטול, הזזה
-- והשחתת מצב סנכרון בתור anon — כולם נכשלו, ו-anon גם לא ראה שום שורה.
-- RLS הוא ההגנה שעבדה, בדיוק כפי ש-0001 תכנן.
--
-- הקובץ הזה סוגר את השכבה השנייה, כדי שההגנה לא תישען על נכס יחיד.
--
-- ─── מה *לא* נסגר כאן, בכוונה ────────────────────────────────────────────
--
-- • public.is_admin() — נקראת מתוך מדיניות ה-RLS עצמן (customers,
--   appointments, appointment_history, business_settings). מדיניות מוערכת
--   בהרשאות התפקיד השואל, ולכן שלילת EXECUTE מ-authenticated הייתה שוברת
--   כל קריאה של לקוחה מחוברת. היא SECURITY DEFINER ומחזירה בוליאני על
--   הקורא עצמו בלבד — אין בה מידע לחשוף.
--
-- • set_appointment_end() ו-touch_updated_at() — פונקציות טריגר
--   (returns trigger). PostgreSQL בודק הרשאה עליהן בזמן יצירת הטריגר, לא
--   בזמן שהוא נורה, ו-PostgREST אינו יכול לקרוא להן כ-RPC.
--
-- אין כאן REVOKE גורף על כל הפונקציות בסכמה public — רק על החתימות
-- המפורטות למטה, אחת אחת, כדי שפונקציה ציבורית עתידית לא תיסגר בטעות.
-- ============================================================================

-- ─── 0003: מחזור החיים של בקשות pending ─────────────────────────────────────

revoke execute on function public.expire_stale_pending_appointments()
  from public, anon, authenticated;
grant  execute on function public.expire_stale_pending_appointments()
  to service_role;

revoke execute on function public.create_pending_appointment(
  uuid, text, text[], integer, timestamptz, integer, text, text)
  from public, anon, authenticated;
grant  execute on function public.create_pending_appointment(
  uuid, text, text[], integer, timestamptz, integer, text, text)
  to service_role;

revoke execute on function public.cancel_pending_appointment(uuid, uuid)
  from public, anon, authenticated;
grant  execute on function public.cancel_pending_appointment(uuid, uuid)
  to service_role;

-- ─── 0004: אישור/דחייה + state machine של סנכרון היומן ─────────────────────

revoke execute on function public.approve_pending_appointment(uuid, uuid)
  from public, anon, authenticated;
grant  execute on function public.approve_pending_appointment(uuid, uuid)
  to service_role;

revoke execute on function public.reject_pending_appointment(uuid, uuid)
  from public, anon, authenticated;
grant  execute on function public.reject_pending_appointment(uuid, uuid)
  to service_role;

revoke execute on function public.claim_calendar_sync(uuid)
  from public, anon, authenticated;
grant  execute on function public.claim_calendar_sync(uuid)
  to service_role;

revoke execute on function public.complete_calendar_sync(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.complete_calendar_sync(uuid, text)
  to service_role;

revoke execute on function public.fail_calendar_sync(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.fail_calendar_sync(uuid, text)
  to service_role;

-- ─── 0005: שינוי מועד וביטול ע"י הלקוחה ─────────────────────────────────────

revoke execute on function public.setting_numeric(text, numeric)
  from public, anon, authenticated;
grant  execute on function public.setting_numeric(text, numeric)
  to service_role;

revoke execute on function public.setting_boolean(text, boolean)
  from public, anon, authenticated;
grant  execute on function public.setting_boolean(text, boolean)
  to service_role;

-- ⚠️ ארבעה ארגומנטים, כולל p_expected_starts_at שיש לו DEFAULT. החתימה
-- המלאה נדרשת כדי שלא יישאר overload לא מוגן.
revoke execute on function public.reschedule_appointment_by_customer(
  uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant  execute on function public.reschedule_appointment_by_customer(
  uuid, uuid, timestamptz, timestamptz)
  to service_role;

revoke execute on function public.cancel_confirmed_appointment_by_customer(uuid, uuid)
  from public, anon, authenticated;
grant  execute on function public.cancel_confirmed_appointment_by_customer(uuid, uuid)
  to service_role;

revoke execute on function public.complete_calendar_delete(uuid)
  from public, anon, authenticated;
grant  execute on function public.complete_calendar_delete(uuid)
  to service_role;

-- ─── מניעת חזרה של אותה טעות ────────────────────────────────────────────────
--
-- ה-default privileges של הפרויקט הן שהעניקו EXECUTE ל-anon/authenticated
-- מלכתחילה, ומתבקש לשנות אותן כאן. במכוון לא עושים זאת:
--
-- ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM anon,
-- authenticated הוא כלל *גורף* על כל פונקציה עתידית בסכמה public. פונקציה
-- שתיווצר בעתיד ושכן נועדה להיות ציבורית תאבד גישה בשקט, והכישלון יתגלה
-- רק בזמן ריצה — בדיוק סוג התקלה השקטה שהמיגרציה הזו באה לתקן, רק בכיוון
-- ההפוך.
--
-- במקומה, האכיפה היא בזמן פיתוח: scripts/test-rpc-permissions.mjs קורא את
-- קבצי המיגרציה בכל `npm test` ונכשל אם RPC חדש בסכמה public נוצר בלי
-- REVOKE מפורש מ-anon ומ-authenticated. פונקציה שאמורה להישאר פתוחה
-- נרשמת שם ב-INTENTIONALLY_OPEN עם נימוק — החלטה מודעת ומתועדת, ולא
-- ברירת מחדל שקטה לשני הכיוונים.
