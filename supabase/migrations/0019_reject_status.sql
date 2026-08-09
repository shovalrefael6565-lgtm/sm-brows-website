-- ============================================================================
-- 0019 — שלב 15C: דחיית בקשה נרשמת כ-'rejected' ולא כ-'cancelled_by_business'
--
-- ⚠️ **מיגרציה מינימלית במכוון.** היא נוגעת ב-*פונקציה אחת* ותו לא:
-- CREATE OR REPLACE על reject_pending_appointment. אין כאן שינוי סכימה,
-- אין טבלה חדשה, אין עמודה חדשה.
--
-- 🔒 מה שהמיגרציה הזו **אינה** עושה, במפורש:
--   • אין ALTER TYPE — 'rejected' כבר נוסף ל-appointment_status ב-0016
--     ועשה COMMIT בפרודקשן, ולכן מותר להשתמש בו כאן מיד. אין כאן שוב את
--     מלכודת גבול-הטרנזקציה של 0002/0003.
--   • אין נגיעה ב-approve_pending_appointment. אומת ש-
--     expire_stale_pending_appointments (0003) מסננת status = 'pending'
--     בלבד, ולכן תור confirmed אינו יכול לפוג — אין באג לתקן.
--   • אין נגיעה ב-appointments_no_overlap. ה-constraint מונה 'pending'
--     ו-'confirmed' במפורש; 'rejected' אינו ביניהם, ולכן הסלוט משתחרר
--     מיידית בלי לגעת ב-constraint בכלל. שינוי ה-constraint נשאר ב-15E.
--   • אין נגיעה ב-create_manual_appointment וב-create_public_booking_request.
--   • אין נגיעה ב-state machine של סנכרון היומן (claim/complete/fail).
--   • **אין backfill.** שורות 'cancelled_by_business' קיימות נשארות כפי
--     שהן — אי אפשר לדעת בדיעבד אילו מהן היו דחיית בקשה ואילו ביטול של
--     תור מאושר, וניחוש בדיעבד גרוע מהיעדר נתון.
--
-- ─── למה 'rejected' ולא 'cancelled_by_business' ────────────────────────────
--
-- 0004 בחרה ב-'cancelled_by_business' כי לא היה ערך מתאים אחר. התוצאה:
-- ערך אחד נושא שתי עובדות עסקיות שונות לחלוטין —
--   • "דחיתי בקשה שמעולם לא אושרה"  — אינה פוגעת בלקוחה, לא היה תור
--   • "ביטלתי תור מאושר"            — פוגעת בלקוחה, היה תור
-- ואי אפשר להבחין ביניהן בשאילתה. ראה סעיף 6.2 בדוח 15A.
--
-- מ-0019 ואילך:
--   rejected              = דחיית בקשה שלא אושרה  (reject_pending_appointment)
--   cancelled_by_business = ביטול תור שכבר אושר   (apply_google_cancellation, 0008)
--
-- ⚠️ השלכה גלויה: customer_crm_metrics (0009) סופרת
-- cancelled_by_business_count. מ-0019 ואילך דחיות **אינן** נספרות שם —
-- וזו המטרה. מונה ייעודי לדחיות שייך ל-15I ואינו נוסף כאן.
--
-- ─── היסטוריה ──────────────────────────────────────────────────────────────
--
-- action = 'status_changed' ולא ערך חדש ב-history_action, מאותו שיקול
-- בדיוק: הוספת ערך ל-enum הייתה מחייבת מיגרציה נפרדת + COMMIT + מיגרציה
-- שלישית שמשתמשת בו. האמת כבר נשמרת ב-to_status = 'rejected', ו-
-- 'status_changed' הוא בדיוק מה ש-approve_pending_appointment רושמת
-- למעבר pending→confirmed. אותו דפוס, אותו enum.
-- ============================================================================

-- ─── דחיית בקשת pending ─────────────────────────────────────────────────────
--
-- ⚠️ ה-WHERE זהה מילה במילה ל-0004. הוא ההגנה האטומית היחידה, והוא לא
-- משתנה כאן:
--   • status = 'pending'                 — פעולה על תור שכבר עבר למצב אחר
--                                          מקבלת אפס שורות
--   • pending_expires_at > now()         — אי אפשר לדחות בקשה שכבר פגה
-- זהו UPDATE יחיד עם RETURNING, כלומר אטומי עם נעילת שורה — לא
-- check-then-update. לחיצה כפולה, או Approve ו-Reject במקביל, מקבלים
-- אפס שורות בפעולה השנייה ונופלים ל-NOT_PENDING. אין צורך ב-
-- admin_idempotency: ה-status עצמו הוא מפתח ה-idempotency.
--
-- אין כאן שום אינטראקציה עם Google Calendar — בקשת pending מעולם לא
-- קיבלה אירוע ביומן, ולכן אין מה למחוק.
create or replace function public.reject_pending_appointment(
  p_appointment_id uuid,
  p_admin_id       uuid
) returns public.appointments
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  update public.appointments
  set status = 'rejected'
  where id = p_appointment_id
    and status = 'pending'
    and (pending_expires_at is null or pending_expires_at > now())
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_PENDING' using errcode = 'P0003';
  end if;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, actor, actor_id
  ) values (
    v_row.id, 'status_changed', 'pending', 'rejected', 'admin', p_admin_id
  );

  return v_row;
end;
$$;

comment on function public.reject_pending_appointment(uuid, uuid) is
  'דחיית בקשת pending → rejected (15C). rejected = בקשה שלא אושרה; cancelled_by_business נשאר לביטול תור מאושר. הסלוט משתחרר מיידית כי appointments_no_overlap מונה pending/confirmed בלבד.';


-- ============================================================================
-- הרשאות
--
-- ⚠️ `from public, anon, authenticated` — ולא `from public` בלבד. זו הטעות
-- ש-0006 בא לתקן ב-0003–0005: REVOKE מ-public אינו מסיר את ההרשאה הישירה
-- ש-Supabase נותנת ל-anon ול-authenticated, ו-PostgREST ממשיך לחשוף את
-- הפונקציה לכל מי שמחזיק את מפתח ה-anon.
--
-- ⚠️ הפונקציה מקבלת p_admin_id כפרמטר וסומכת על כך שהקורא כבר אימת
-- session של מנהלת. חשיפה ל-anon הייתה מאפשרת לכל אחד לדחות כל בקשה
-- ולזייף את זהות המנהלת בהיסטוריה.
--
-- CREATE OR REPLACE משמר ACL, ולכן ההרשאות מ-0006/0007 שרדו — אבל הצהרה
-- מפורשת עדיפה על הסתמכות. אותו דפוס בדיוק כמו create_manual_appointment
-- ב-0018 ו-list_crm_customers ב-0010.
-- ============================================================================

revoke execute on function public.reject_pending_appointment(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.reject_pending_appointment(uuid, uuid) to service_role;


-- ─── אימות ─────────────────────────────────────────────────────────────────
-- נכשל בקול אם משהו אינו כמצופה, במקום להשאיר מצב חלקי בשקט.
do $$
begin
  -- ── הפונקציה קיימת ─────────────────────────────────────────────────────
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reject_pending_appointment'
  ) then
    raise exception '0019: reject_pending_appointment לא נוצרה' using errcode = 'P0104';
  end if;

  -- 🔒 חייבת להישאר SECURITY INVOKER. prosecdef = true מסמן DEFINER.
  -- ל-appointments יש RLS, ו-DEFINER היה מאחד את ההרשאה ואת ה-RLS לנכס
  -- יחיד במקום שתי הגנות בלתי תלויות.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reject_pending_appointment'
      and p.prosecdef
  ) then
    raise exception '0019: reject_pending_appointment הוגדרה כ-SECURITY DEFINER'
      using errcode = 'P0104';
  end if;

  -- ── 🔒 ההרשאות בפועל, לא רק טקסט ה-REVOKE ──────────────────────────────
  -- רק has_function_privilege מוכיח שהדלת באמת סגורה.
  if has_function_privilege('anon',
       'public.reject_pending_appointment(uuid, uuid)', 'execute')
  then raise exception '0019: anon יכול להפעיל את reject_pending_appointment'
    using errcode = 'P0104'; end if;

  if has_function_privilege('authenticated',
       'public.reject_pending_appointment(uuid, uuid)', 'execute')
  then raise exception '0019: authenticated יכול להפעיל את reject_pending_appointment'
    using errcode = 'P0104'; end if;

  -- ⚠️ הכיוון ההפוך: ההרשאה של service_role חייבת *להישמר*. בדיקה שרק
  -- מוודאת ש-anon חסום הייתה עוברת גם אם REVOKE סגר את כולם.
  if not has_function_privilege('service_role',
       'public.reject_pending_appointment(uuid, uuid)', 'execute')
  then raise exception '0019: service_role איבד את reject_pending_appointment'
    using errcode = 'P0104'; end if;

  -- ── הערך שהפונקציה כותבת קיים ב-enum ───────────────────────────────────
  -- אם 0016 לא רצה, עדיף ליפול כאן מאשר בזמן הדחייה הראשונה בפרודקשן.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'appointment_status' and e.enumlabel = 'rejected'
  ) then
    raise exception '0019: הערך rejected אינו קיים ב-appointment_status — 0016 לא רצה'
      using errcode = 'P0104';
  end if;

  raise notice '0019: reject_pending_appointment כותבת rejected, INVOKER, סגורה ל-anon/authenticated.';
end $$;
