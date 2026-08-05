-- ============================================================================
-- 0007 — הרשאות RPC: החלה מחדש, עם אימות אמיתי בסוף
--
-- תלוי ב-0001–0006 שכבר רצו. אין כאן שינוי בלוגיקה, ב-RLS, ב-SECURITY
-- INVOKER, בבעלות על פונקציות או בסכמה — אך ורק הרשאות EXECUTE, ובדיקה.
--
-- ─── למה קובץ שני על אותו נושא ───────────────────────────────────────────
--
-- 0006 הכילה בדיוק את אותן 13 פקודות REVOKE ו-13 פקודות GRANT, בחתימות
-- תקינות, בלי BEGIN/ROLLBACK ובלי תנאים. היא דווחה כ-Success, אך בבדיקה
-- שלאחריה anon עדיין הצליח להריץ את כל 13 הפונקציות — כולל
-- setting_numeric, שהחזירה לו ערך אמיתי.
--
-- REVOKE ידני על approve_pending_appointment, שהורץ בנפרד, כן עבד: אחריו
-- anon=false, authenticated=false, service_role=true. הפונקציות בבעלות
-- postgres וההרשאות ניתנו ישירות ע"י postgres, כלומר לתפקיד שמריץ את
-- המיגרציה יש סמכות מלאה לשלול אותן.
--
-- כלומר התחביר תקין והסמכות קיימת — מה שלא קרה הוא שהפקודות האלה הורצו
-- בפועל במלואן. הסיבה המדויקת אינה ניתנת להוכחה בדיעבד.
--
-- המסקנה המעשית: "Success" בעורך ה-SQL אינו ראיה לכך שההרשאות השתנו.
-- לכן הקובץ הזה לא מסתפק בביצוע — הוא *בודק את התוצאה* בבלוק DO בסופו,
-- ונכשל כולו אם אפילו פונקציה אחת נשארה במצב שגוי. אם ההרצה תדווח
-- Success, המשמעות תהיה שכל 13 הפונקציות אומתו בפועל.
--
-- ⚠️ יש להריץ את הקובץ *כולו*. עורך ה-SQL של Supabase מריץ רק את הטקסט
-- המסומן כאשר קיימת בחירה — יש לוודא שאין בחירה חלקית לפני Run.
--
-- ─── idempotent ──────────────────────────────────────────────────────────
--
-- REVOKE ו-GRANT הן פעולות מצב, לא פעולות דלתא: הרצה חוזרת מגיעה לאותה
-- תוצאה בדיוק. הקובץ בטוח להרצה גם אם פונקציה אחת כבר תוקנה ידנית, גם אם
-- חלק מההרשאות כבר הוסרו, וגם אם service_role כבר מחזיק EXECUTE.
--
-- ─── מה *לא* נעשה כאן, בכוונה ────────────────────────────────────────────
--
-- • אין REVOKE גורף על כל הפונקציות בסכמה — רק 13 חתימות מפורשות.
-- • אין ALTER DEFAULT PRIVILEGES — כלל גורף על פונקציות עתידיות היה גורם
--   לפונקציה ציבורית עתידית לאבד גישה בשקט. האכיפה לעתיד היא
--   scripts/test-rpc-permissions.mjs, שרץ בכל npm test.
-- • is_admin() לא נוגעים בה: מדיניות ה-RLS קוראות לה, והן מוערכות
--   בהרשאות התפקיד השואל. שלילה מ-authenticated הייתה שוברת כל קריאה של
--   לקוחה מחוברת.
-- • set_appointment_end() ו-touch_updated_at() לא נוגעים בהן: פונקציות
--   טריגר, נבדקות בזמן יצירת הטריגר ולא בזמן ירי, ואינן נגישות כ-RPC.
-- ============================================================================

-- ─── 0003: מחזור החיים של בקשות pending ─────────────────────────────────────

revoke execute on function public.expire_stale_pending_appointments()
  from public, anon, authenticated;
grant execute on function public.expire_stale_pending_appointments()
  to service_role;

revoke execute on function public.create_pending_appointment(
  uuid, text, text[], integer, timestamptz, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.create_pending_appointment(
  uuid, text, text[], integer, timestamptz, integer, text, text)
  to service_role;

revoke execute on function public.cancel_pending_appointment(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_pending_appointment(uuid, uuid)
  to service_role;

-- ─── 0004: אישור/דחייה + state machine של סנכרון היומן ─────────────────────

revoke execute on function public.approve_pending_appointment(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.approve_pending_appointment(uuid, uuid)
  to service_role;

revoke execute on function public.reject_pending_appointment(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reject_pending_appointment(uuid, uuid)
  to service_role;

revoke execute on function public.claim_calendar_sync(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_calendar_sync(uuid)
  to service_role;

revoke execute on function public.complete_calendar_sync(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_calendar_sync(uuid, text)
  to service_role;

revoke execute on function public.fail_calendar_sync(uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_calendar_sync(uuid, text)
  to service_role;

-- ─── 0005: שינוי מועד וביטול ע"י הלקוחה ─────────────────────────────────────

revoke execute on function public.setting_numeric(text, numeric)
  from public, anon, authenticated;
grant execute on function public.setting_numeric(text, numeric)
  to service_role;

revoke execute on function public.setting_boolean(text, boolean)
  from public, anon, authenticated;
grant execute on function public.setting_boolean(text, boolean)
  to service_role;

-- ⚠️ ארבעה ארגומנטים. p_expected_starts_at הוא DEFAULT null, אך החתימה
-- לצורך REVOKE/GRANT כוללת אותו — אחרת נשאר overload לא מוגן.
revoke execute on function public.reschedule_appointment_by_customer(
  uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reschedule_appointment_by_customer(
  uuid, uuid, timestamptz, timestamptz)
  to service_role;

revoke execute on function public.cancel_confirmed_appointment_by_customer(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_confirmed_appointment_by_customer(uuid, uuid)
  to service_role;

revoke execute on function public.complete_calendar_delete(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_calendar_delete(uuid)
  to service_role;

-- ============================================================================
-- אימות המצב בפועל
--
-- כאן הקובץ מפסיק להאמין לעצמו. has_function_privilege נבדק לכל אחת מ-13
-- החתימות, לשלושת התפקידים, והמיגרציה נופלת כולה על הפרה ראשונה.
--
-- הערה: הרשאה שניתנה ל-PUBLIC מתגלה כאן ממילא — has_function_privilege
-- עבור anon מחזיר true גם כשההרשאה מגיעה מ-PUBLIC ולא ישירות.
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.expire_stale_pending_appointments()',
    'public.create_pending_appointment(uuid, text, text[], integer, timestamptz, integer, text, text)',
    'public.cancel_pending_appointment(uuid, uuid)',
    'public.approve_pending_appointment(uuid, uuid)',
    'public.reject_pending_appointment(uuid, uuid)',
    'public.claim_calendar_sync(uuid)',
    'public.complete_calendar_sync(uuid, text)',
    'public.fail_calendar_sync(uuid, text)',
    'public.setting_numeric(text, numeric)',
    'public.setting_boolean(text, boolean)',
    'public.reschedule_appointment_by_customer(uuid, uuid, timestamptz, timestamptz)',
    'public.cancel_confirmed_appointment_by_customer(uuid, uuid)',
    'public.complete_calendar_delete(uuid)'
  ];
  v_sig      text;
  v_verified integer := 0;
begin
  foreach v_sig in array v_signatures loop

    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception
        'הרשאות RPC: % — לתפקיד anon עדיין יש EXECUTE. ההרשאה הזו אמורה להישלל.',
        v_sig
        using errcode = 'P0100';
    end if;

    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception
        'הרשאות RPC: % — לתפקיד authenticated עדיין יש EXECUTE. ההרשאה הזו אמורה להישלל.',
        v_sig
        using errcode = 'P0100';
    end if;

    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception
        'הרשאות RPC: % — לתפקיד service_role חסר EXECUTE. ההרשאה הזו אמורה להישמר.',
        v_sig
        using errcode = 'P0101';
    end if;

    v_verified := v_verified + 1;
  end loop;

  if v_verified <> array_length(v_signatures, 1) then
    raise exception
      'הרשאות RPC: אומתו % מתוך % פונקציות — הבדיקה לא הושלמה.',
      v_verified, array_length(v_signatures, 1)
      using errcode = 'P0102';
  end if;

  raise notice
    'הרשאות RPC אומתו: % פונקציות. anon=false, authenticated=false, service_role=true.',
    v_verified;
end $$;

-- ============================================================================
-- שאילתת sanity לקריאה בלבד — להרצה *אחרי* המיגרציה, כדי לראות את ה-ACL
-- בפועל. אינה חלק מהמיגרציה (בהערה בכוונה) ואינה משנה דבר.
--
-- select
--   n.nspname || '.' || p.proname || '(' ||
--     pg_get_function_identity_arguments(p.oid) || ')'      as function_signature,
--   pg_get_userbyid(p.proowner)                             as function_owner,
--   coalesce(a.grantee::regrole::text, '-')                 as grantee,
--   coalesce(a.grantor::regrole::text, '-')                 as grantor,
--   coalesce(a.privilege_type, '-')                         as privilege_type,
--   has_function_privilege('anon',         p.oid, 'EXECUTE') as anon_can_execute,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
--   has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- left join lateral aclexplode(p.proacl) a on true
-- where n.nspname = 'public'
--   and (n.nspname || '.' || p.proname || '(' ||
--        pg_get_function_identity_arguments(p.oid) || ')') in (
--     'public.expire_stale_pending_appointments()',
--     'public.create_pending_appointment(uuid, text, text[], integer, timestamp with time zone, integer, text, text)',
--     'public.cancel_pending_appointment(uuid, uuid)',
--     'public.approve_pending_appointment(uuid, uuid)',
--     'public.reject_pending_appointment(uuid, uuid)',
--     'public.claim_calendar_sync(uuid)',
--     'public.complete_calendar_sync(uuid, text)',
--     'public.fail_calendar_sync(uuid, text)',
--     'public.setting_numeric(text, numeric)',
--     'public.setting_boolean(text, boolean)',
--     'public.reschedule_appointment_by_customer(uuid, uuid, timestamp with time zone, timestamp with time zone)',
--     'public.cancel_confirmed_appointment_by_customer(uuid, uuid)',
--     'public.complete_calendar_delete(uuid)'
--   )
-- order by function_signature, grantee;
--
-- המצב הרצוי: anon_can_execute=false, authenticated_can_execute=false,
-- service_role_can_execute=true. אין שורות grantee עבור PUBLIC (מופיע
-- כ-'-'), anon או authenticated. שורת postgres כבעלים היא תקינה.
-- ============================================================================
