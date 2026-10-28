-- ============================================================================
-- 0040 — retention להרשמות לעדכון מוצר
--
-- ═══ המדיניות העסקית שננעלת כאן ═══
--
-- 🔴 אלה **מספרי מדיניות של העסק**, ולא תקופות שהחוק מכתיב. הם נגזרים
-- מעיקרון אחד: אין לשמור מספר טלפון מעבר לזמן שבו הוא נדרש לצורך
-- העדכון שהלקוחה ביקשה.
--
--   open     — עד 12 חודשים מ-created_at.
--              מוצר שלא הושק בתוך שנה: הטלפון כבר אינו משרת מטרה.
--   notified — 90 יום מ-notified_at.
--              ההודעה נשלחה; המטרה מוצתה. החלון נותר לבירורים.
--   closed   — 90 יום מ-closed_at.
--              הבקשה נסגרה; אותו היגיון.
--
-- **מחיקה מלאה של השורה.** אין שמירת hash, אין fragment של טלפון ואין
-- רשומת "היה כאן ליד" לצורכי analytics: שמירה חלקית היא עדיין שמירה,
-- והיא הייתה סותרת את המטרה המוצהרת ללקוחה.
--
-- ═══ 🔒 איך זה משתלב בתשתית הקיימת, ולמה לא "עוד מנגנון" ═══
--
-- 0032 כבר מגדיר את הדפוס: dry-run שסופר, execute שמוחק במנות, קריאה
-- דרך /api/internal/privacy-retention בלבד, service_role בלבד.
-- **הקובץ הזה מצטרף לדפוס הזה ואינו בונה מקביל לו.**
--
-- ⚠️ ה-dry-run כאן הוא פונקציה **נפרדת** ולא עריכה של
-- `privacy_retention_dry_run`, ובמכוון: 0032 הוא קובץ שכבר רץ בפרודקשן,
-- והדוקטרינה בפרויקט (ראה 0007→0008) היא שלא לשכתב פונקציה של מיגרציה
-- שהוחלה — אלא להוסיף לצידה ולהוכיח בבלוק משלה. שכתוב של 100 שורות
-- לוגיקה קיימת רק כדי להוסיף קטגוריה הוא בדיוק הדרך שבה שתי גרסאות של
-- אותו WHERE מתחילות לסטות. ה-route מאחד את שתי התוצאות לדוח אחד.
--
-- ═══ 🔒 מה הקובץ הזה **אינו** נוגע בו ═══
--
--   ❌ `product_launch_runs` — ריצות שליחה אינן מכילות טלפון ואינן
--      רשימת נמענות. ה-retention שלהן הוא החלטה נפרדת, ומתועד ככזה.
--   ❌ `customers` — אף שורת לקוחה אינה נמחקת ואינה משתנה.
--   ❌ `marketing_consent` / `marketing_opted_out_at` / `sms_campaigns`.
--   ❌ `appointments`, `waitlist_requests`, תזכורות, התראות ויומן.
--   ❌ אינו נוגע ב-0001–0039 ואינו משנה אף פונקציה קיימת.
-- ============================================================================


-- ============================================================================
-- חלק 1 — dry-run (ספירות בלבד, אפס mutation)
--
-- ⚠️ כל תנאי WHERE כאן **זהה מילה במילה** לזה שבפונקציית ה-execute
-- (חלק 2), כדי שהספירה לא תסטה מהמחיקה בפועל. זו אותה דרישה שמתועדת
-- ב-0032, ומאומתת בחלק 4.
-- ============================================================================

create or replace function public.privacy_retention_product_interest_dry_run(
  p_now         timestamptz default now(),
  p_batch_limit integer     default 1000
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_open     integer;
  v_notified integer;
  v_closed   integer;
begin
  -- אותה ולידציית פרמטרים בדיוק כמו 0032.
  if p_now is null then
    raise exception 'P_NOW_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit is null then
    raise exception 'P_BATCH_LIMIT_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit < 1 or p_batch_limit > 5000 then
    raise exception 'P_BATCH_LIMIT_OUT_OF_RANGE' using errcode = '22023';
  end if;

  select count(*) into v_open
  from public.product_interest_requests
  where status = 'open' and created_at < p_now - interval '12 months';

  select count(*) into v_notified
  from public.product_interest_requests
  where status = 'notified' and notified_at < p_now - interval '90 days';

  select count(*) into v_closed
  from public.product_interest_requests
  where status = 'closed' and closed_at < p_now - interval '90 days';

  return jsonb_build_object(
    'product_interest_open', jsonb_build_object(
      'total_eligible', v_open, 'next_batch_count', least(v_open, p_batch_limit)),
    'product_interest_notified', jsonb_build_object(
      'total_eligible', v_notified, 'next_batch_count', least(v_notified, p_batch_limit)),
    'product_interest_closed', jsonb_build_object(
      'total_eligible', v_closed, 'next_batch_count', least(v_closed, p_batch_limit))
  );
end;
$$;

comment on function public.privacy_retention_product_interest_dry_run(timestamptz, integer) is
  '0040: ספירות retention להרשמות מוצר. open>12 חודשים, notified>90 יום, closed>90 יום. אפס mutation.';

revoke execute on function public.privacy_retention_product_interest_dry_run(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.privacy_retention_product_interest_dry_run(timestamptz, integer)
  to service_role;


-- ============================================================================
-- חלק 2 — execute
--
-- 🔒 שלוש מחיקות נפרדות, כל אחת במנה משלה ועם `for update skip locked` —
-- אותו דפוס בדיוק של 0032, כדי ששתי ריצות במקביל לא ייתקעו זו על זו.
--
-- ⚠️ `p_batch_limit` חל על **כל קטגוריה בנפרד**, בדיוק כמו ב-0032.
-- ============================================================================

create or replace function public.privacy_retention_purge_product_interest(
  p_now         timestamptz default now(),
  p_batch_limit integer     default 1000
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_open     integer;
  v_notified integer;
  v_closed   integer;
begin
  if p_now is null then
    raise exception 'P_NOW_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit is null then
    raise exception 'P_BATCH_LIMIT_REQUIRED' using errcode = '22023';
  end if;
  if p_batch_limit < 1 or p_batch_limit > 5000 then
    raise exception 'P_BATCH_LIMIT_OUT_OF_RANGE' using errcode = '22023';
  end if;

  -- ── A. open בן 12+ חודשים ────────────────────────────────────────────────
  delete from public.product_interest_requests
  where id in (
    select id from public.product_interest_requests
    where status = 'open' and created_at < p_now - interval '12 months'
    order by created_at, id
    limit p_batch_limit
    for update skip locked
  );
  get diagnostics v_open = row_count;

  -- ── B. notified שההודעה בו יצאה לפני 90+ יום ─────────────────────────────
  delete from public.product_interest_requests
  where id in (
    select id from public.product_interest_requests
    where status = 'notified' and notified_at < p_now - interval '90 days'
    order by notified_at, id
    limit p_batch_limit
    for update skip locked
  );
  get diagnostics v_notified = row_count;

  -- ── C. closed שנסגר לפני 90+ יום ─────────────────────────────────────────
  -- 🔒 `closed_at` ולא `updated_at`: ראה הנימוק על העמודה ב-0038.
  delete from public.product_interest_requests
  where id in (
    select id from public.product_interest_requests
    where status = 'closed' and closed_at < p_now - interval '90 days'
    order by closed_at, id
    limit p_batch_limit
    for update skip locked
  );
  get diagnostics v_closed = row_count;

  return jsonb_build_object(
    'product_interest_open_deleted',     v_open,
    'product_interest_notified_deleted', v_notified,
    'product_interest_closed_deleted',   v_closed
  );
end;
$$;

comment on function public.privacy_retention_purge_product_interest(timestamptz, integer) is
  '0040: מחיקה מלאה של הרשמות מוצר שעברו את תקופת השמירה. אינה נוגעת ב-product_launch_runs, ב-customers ובעמודות דיוור.';

revoke execute on function public.privacy_retention_purge_product_interest(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.privacy_retention_purge_product_interest(timestamptz, integer)
  to service_role;


-- ============================================================================
-- חלק 3 — 🔒 אימות ההרשאות (דוקטרינת 0007/0032/0037/0038/0039)
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.privacy_retention_product_interest_dry_run(timestamptz, integer)',
    'public.privacy_retention_purge_product_interest(timestamptz, integer)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_signatures loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0040): % — ל-anon עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0040): % — ל-authenticated עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0040): % — ל-service_role חסר EXECUTE.', v_sig using errcode = 'P0101';
    end if;
  end loop;

  raise notice '0040: הרשאות RPC אומתו: anon=false, authenticated=false, service_role=true.';
end $$;


-- ============================================================================
-- חלק 4 — אימות ההנחות
-- ============================================================================

do $$
declare
  v_dry   text;
  v_purge text;
begin
  select prosrc into v_dry   from pg_proc where proname = 'privacy_retention_product_interest_dry_run';
  select prosrc into v_purge from pg_proc where proname = 'privacy_retention_purge_product_interest';

  -- 🔒 ה-dry-run אינו מוחק. זו עצם ההגדרה שלו.
  if v_dry ~* '\mdelete\M' or v_dry ~* '\mupdate\M' or v_dry ~* '\minsert\M' then
    raise exception '0040: ה-dry-run מכיל DML. הוא חייב לספור בלבד.';
  end if;

  -- 🔒 שלוש התקופות מופיעות בשתי הפונקציות — אחרת הספירה והמחיקה סוטות.
  if v_dry not like '%12 months%' or v_purge not like '%12 months%' then
    raise exception '0040: תקופת ה-12 חודשים אינה זהה בין dry-run ל-execute.';
  end if;
  if v_dry not like '%90 days%' or v_purge not like '%90 days%' then
    raise exception '0040: תקופת ה-90 יום אינה זהה בין dry-run ל-execute.';
  end if;

  -- 🔒 closed נמחק לפי closed_at ולא לפי updated_at.
  if v_purge like '%updated_at <%' then
    raise exception '0040: המחיקה נשענת על updated_at. היא חייבת להישען על closed_at.';
  end if;
  if v_purge not like '%closed_at <%' then
    raise exception '0040: המחיקה אינה משתמשת ב-closed_at.';
  end if;

  -- 🔴 מה שאסור שייגע: ריצות שליחה, לקוחות, דיוור, תורים.
  if v_purge like '%product_launch_runs%' then
    raise exception '0040: ה-purge נוגע ב-product_launch_runs. ה-retention שלהן הוא החלטה נפרדת.';
  end if;
  if v_purge like '%customers%'
     or v_purge like '%marketing_consent%'
     or v_purge like '%marketing_opted_out_at%'
     or v_purge like '%sms_campaigns%'
     or v_purge like '%appointments%'
     or v_purge like '%waitlist_requests%' then
    raise exception '0040: ה-purge נוגע בטבלה שאינה product_interest_requests.';
  end if;

  raise notice '0040: retention להרשמות מוצר — מבודד, סופר לפני שמוחק, ואינו נוגע בשום דבר אחר.';
end $$;
