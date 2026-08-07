-- ============================================================================
-- 0014 — ביטול הנפקה שנדחתה בוודאות: הסרת החסימה על attempts > 0
--
-- תלוי ב-0013 בלבד. ⚠️ **0013 אינה משתנה** — היא כבר רצה בפרודקשן.
-- הקובץ הזה מחליף גוף של פונקציה אחת ב-CREATE OR REPLACE. אין כאן שינוי
-- סכמה, אין עמודה חדשה, אין טבלה חדשה, ואין נגיעה בתזכורות.
--
-- ─── הבאג שנסגר ────────────────────────────────────────────────────────────
--
-- 0013 סירבה למחוק שורה שכבר הוקלדו מולה ניסיונות, בנימוק "מישהו מחזיק
-- אותה". הנימוק הזה שגוי כאשר הוכח שההודעה לא נמסרה, והוא מבטל בדיוק את
-- המטרה שלשמה נבנה הניקוי:
--
--   1. קוד A נשלח והגיע ללקוחה.
--   2. מונפק קוד B.
--   3. 019 מחזירה כשל ודאי עבור B — B מעולם לא יצאה.
--   4. במקביל הלקוחה מקלידה את A.
--   5. verify בוחר את B (היא האחרונה), הקוד לא תואם → attempts(B) = 1.
--   6. discard מסרב: 'attempted'.
--   7. B — שלעולם לא נשלחה — נשארת האחרונה ומבטלת את A.
--
-- הלקוחה נשארת בלי קוד שמיש: A מוצל ע"י B, ו-B אינה בידי אף אחד.
--
-- ─── למה attempts אינו ראיה ─────────────────────────────────────────────────
--
-- ⚠️ הקוד של B **לא נמסר לאיש**. לכן כל ניסיון שנרשם מולה הוא אחד משניים:
--   • ניחוש — סיכוי 1 ל-10^6, ותקרת חמישה ניסיונות חוסמת אותו ממילא.
--   • הקלדה של קוד ישן (A) שנפלה על B כי היא האחרונה.
--
-- בשני המקרים מחיקת B היא הדבר הנכון: היא מחזירה את A להיות האחרונה.
-- שימור B "כי מישהו נגע בה" שומר בדיוק את השורה שאיש אינו יכול להשתמש בה.
--
-- 🔒 **consumed_at נשאר החוסם היחיד.** שורה שנוצלה היא ראיה לאימות שהצליח,
-- ומחיקתה הייתה מוחקת את הראיה הזו. הסירוב הזה אינו משתנה.
--
-- 🔒 גם superseded נשאר: שורה חדשה יותר פירושה ששלנו אינה האחרונה בלאו הכי.
--
-- ─── מה נשמר מ-0013, מילה במילה ─────────────────────────────────────────────
--
--   • אותה חתימה: discard_otp_issue_atomic(bigint, text, text)
--   • אותה advisory lock, באותו namespace (1, hashtext(phone))
--   • SECURITY INVOKER (ברירת המחדל) — לא DEFINER
--   • set search_path = pg_catalog, public
--   • התאמת otp_id **וגם** phone_e164 **וגם** purpose
--   • מחיקה לפי id יחיד ומדויק, לעולם לא לפי טלפון
--   • הקוד הגלוי אינו פרמטר
--
-- ⚠️ CREATE OR REPLACE משמר ACL, אך ה-REVOKE/GRANT חוזרים כאן במפורש —
-- הסתמכות על שימור שקט היא בדיוק הדפוס שנכשל ב-0003–0005 (ראה 0006).
-- ============================================================================

create or replace function public.discard_otp_issue_atomic(
  p_otp_id     bigint,
  p_phone_e164 text,
  p_purpose    text
) returns jsonb
language plpgsql
-- 🔒 נעול, כמו ב-0013. אפשרויות פונקציה נכתבות מחדש ב-CREATE OR REPLACE,
-- ולכן השמטת השורה הזו הייתה מבטלת את הנעילה בשקט.
set search_path = pg_catalog, public
as $$
declare
  v_row   public.otp_attempts;
  v_newer boolean;
begin
  if p_otp_id is null then
    raise exception 'OTP_BAD_ID' using errcode = '22023';
  end if;
  if p_phone_e164 is null or p_phone_e164 !~ '^\+9725[0-9]{8}$' then
    raise exception 'OTP_BAD_PHONE' using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('login', 'booking') then
    raise exception 'OTP_BAD_PURPOSE' using errcode = '22023';
  end if;

  -- ⚠️ אותה נעילה ובאותו namespace כמו בהנפקה ובאימות.
  perform pg_advisory_xact_lock(1, hashtext(p_phone_e164));

  -- 🔒 מזהה מדויק **וגם** התאמת מספר ו-purpose.
  select * into v_row
  from public.otp_attempts
  where id = p_otp_id
    and phone_e164 = p_phone_e164
    and purpose    = p_purpose
  for update;

  if v_row.id is null then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- 🔒 החוסם היחיד שנשאר. שורה שנוצלה היא ראיה לאימות שהצליח.
  if v_row.consumed_at is not null then
    return jsonb_build_object('result', 'consumed');
  end if;

  /*
   * ⚠️ כאן ישבה ב-0013 הבדיקה `if v_row.attempts > 0 then return 'attempted'`.
   * היא **הוסרה במכוון** — ראה את הנימוק המלא בראש הקובץ. ניסיונות מול קוד
   * שלא נמסר אינם ראיה לכלום, והשארת השורה בגללם היא בדיוק התקיעה שהניקוי
   * נועד למנוע.
   *
   * ⚠️ attempts אינו נבדק כאן יותר בשום צורה. מי שיחזיר את התנאי יחזיר את
   * הבאג.
   */

  select exists (
    select 1
    from public.otp_attempts n
    where n.phone_e164 = p_phone_e164
      and n.purpose    = p_purpose
      and n.id        <> v_row.id
      and n.consumed_at is null
      and (n.created_at, n.id) > (v_row.created_at, v_row.id)
  ) into v_newer;

  if v_newer then
    return jsonb_build_object('result', 'superseded');
  end if;

  delete from public.otp_attempts where id = v_row.id;

  -- ⚠️ קוד תוצאה בלבד. אין כאן מספר, גיבוב, IP או מזהה.
  return jsonb_build_object('result', 'discarded');
end;
$$;

comment on function public.discard_otp_issue_atomic(bigint, text, text) is
  'ביטול שורת הנפקה שהשליחה שלה נדחתה בוודאות. מוחקת שורה אחת לפי מזהה מדויק '
  'כל עוד היא לא נוצלה ואינה מוחלפת בשורה חדשה יותר. ניסיונות (attempts) אינם '
  'חוסמים: קוד שלא נמסר אינו יכול להיות בידי הלקוחה.';


-- ============================================================================
-- הרשאות — חוזרות במפורש
-- ============================================================================

revoke execute on function public.discard_otp_issue_atomic(bigint, text, text)
  from public, anon, authenticated;
grant  execute on function public.discard_otp_issue_atomic(bigint, text, text)
  to service_role;


-- ============================================================================
-- assertions
-- ============================================================================

do $$
begin
  if has_function_privilege('anon',
       'public.discard_otp_issue_atomic(bigint, text, text)', 'execute')
  then raise exception '0014: anon יכול להפעיל את discard_otp_issue_atomic'; end if;

  if has_function_privilege('authenticated',
       'public.discard_otp_issue_atomic(bigint, text, text)', 'execute')
  then raise exception '0014: authenticated יכול להפעיל את discard_otp_issue_atomic'; end if;

  if not has_function_privilege('service_role',
       'public.discard_otp_issue_atomic(bigint, text, text)', 'execute')
  then raise exception '0014: service_role איבד את discard_otp_issue_atomic'; end if;

  -- 🔒 לא הפכה ל-DEFINER בהחלפה
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'discard_otp_issue_atomic'
      and p.prosecdef
  ) then
    raise exception '0014: discard_otp_issue_atomic סומנה SECURITY DEFINER';
  end if;

  -- 🔒 search_path נשאר נעול אחרי ההחלפה
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'discard_otp_issue_atomic'
      and p.proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception '0014: search_path אינו נעול על discard_otp_issue_atomic';
  end if;

  -- ⚠️ שלוש האחיות לא נגעו. 0014 מחליפה פונקציה אחת בלבד.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('issue_otp_atomic', 'verify_otp_atomic', 'otp_hash_equals')
      and p.prosecdef
  ) then
    raise exception '0014: פונקציית OTP אחרת השתנתה ל-SECURITY DEFINER';
  end if;

  -- 🔒 RLS ומודל ההרשאות של הטבלה לא זזו
  if not exists (
    select 1 from pg_class
    where oid = 'public.otp_attempts'::regclass and relrowsecurity
  ) then
    raise exception '0014: RLS כבוי על otp_attempts';
  end if;

  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'otp_attempts')
  then raise exception '0014: נוספה policy ל-otp_attempts'; end if;
end $$;

-- ── ההתנהגות החדשה, מוכחת על נתונים אמיתיים ────────────────────────────────
--
-- ⚠️ הבלוק הזה יוצר שורות, בודק, ומנקה אחריו במלואו. הוא רץ בטרנזקציה של
-- המיגרציה, ומפיל אותה אם ההתנהגות אינה כמצופה.
do $$
declare
  v_phone constant text := '+972500000001';   -- ⚠️ מספר סינתטי, נמחק בסוף
  v_a bigint;
  v_b bigint;
  v_res text;
begin
  delete from public.otp_attempts where phone_e164 = v_phone;

  -- קוד A — ישן יותר
  insert into public.otp_attempts (phone_e164, code_hash, purpose, expires_at, created_at)
  values (v_phone, repeat('a', 64), 'login', now() + interval '5 min', now() - interval '2 min')
  returning id into v_a;

  -- קוד B — חדש יותר, ועם ניסיון שנרשם מולו
  insert into public.otp_attempts (phone_e164, code_hash, purpose, expires_at, attempts)
  values (v_phone, repeat('b', 64), 'login', now() + interval '5 min', 3)
  returning id into v_b;

  -- 🔒 העיקר: attempts > 0 כבר אינו חוסם
  select (public.discard_otp_issue_atomic(v_b, v_phone, 'login'))->>'result' into v_res;
  if v_res <> 'discarded' then
    raise exception '0014: שורה עם attempts>0 לא נמחקה (התקבל %)', v_res;
  end if;
  if exists (select 1 from public.otp_attempts where id = v_b) then
    raise exception '0014: שורת B נותרה במסד אחרי discarded';
  end if;

  -- ⚠️ ו-A חזרה להיות האחרונה
  if not exists (
    select 1 from public.otp_attempts
    where id = v_a and consumed_at is null and expires_at > now()
  ) then
    raise exception '0014: שורת A לא שרדה את הניקוי של B';
  end if;

  -- 🔒 consumed עדיין חוסם
  update public.otp_attempts set consumed_at = now() where id = v_a;
  select (public.discard_otp_issue_atomic(v_a, v_phone, 'login'))->>'result' into v_res;
  if v_res <> 'consumed' then
    raise exception '0014: שורה שנוצלה לא הוגנה (התקבל %)', v_res;
  end if;

  delete from public.otp_attempts where phone_e164 = v_phone;
  if exists (select 1 from public.otp_attempts where phone_e164 = v_phone) then
    raise exception '0014: ניקוי בדיקת המיגרציה נכשל';
  end if;
end $$;
