-- ============================================================================
-- 0039 — ניהול ההרשמות לעדכון מוצר ושליחת הודעת ההשקה
--
-- ═══ מה זה כן ═══
--
-- שתי פונקציות מעבר-סטטוס על `product_interest_requests` (0038), ותו לא.
--
-- ═══ 🔒 ההפרדה שבלב המיגרציה הזו ═══
--
-- `notified` אינו סטטוס שמישהו "מסמן". הוא **עובדה על העולם**: הודעה
-- יצאה ללקוחה. לכן הוא מופרד לפונקציה משלו:
--
--   set_product_interest_status      — ידנית, open ⇄ closed בלבד.
--                                      🔴 **דוחה 'notified' במפורש.**
--   mark_product_interest_notified   — נקראת אך ורק אחרי שליחה מוצלחת,
--                                      ועוברת רק מ-'open'.
--
-- ⚠️ אילו השתיים היו פונקציה אחת, לחיצה במסך הניהול הייתה יכולה להצהיר
-- שהודעה נשלחה כשהיא לא — כלומר למחוק לקוחה מרשימת הנמענות בלי שקיבלה
-- כלום. זה בדיוק הכשל שאי אפשר לגלות בדיעבד.
--
-- ═══ 🔒 מה זה **אינו** עושה ═══
--
--   ❌ אינו נוגע ב-`customers` ואינו יוצר לקוחה.
--   ❌ אינו נוגע ב-marketing_consent / marketing_opted_out_at / sms_campaigns
--      ובאף חלק ממערכת הדיוור (0035).
--   ❌ אינו נוגע ב-appointments, בתזכורות, בהתראות וביומן.
--   ❌ אינו מוסיף טריגרים.
-- ============================================================================


-- ============================================================================
-- חלק 1 — שינוי סטטוס ידני (מסך הניהול)
--
-- 🔴 open ⇄ closed בלבד. 'notified' אינו ערך קביל כאן, ואין דרך לעקוף זאת
-- דרך ה-API: ה-route מעביר את הערך כפי שהתקבל, והפונקציה היא זו שדוחה.
-- ============================================================================

create or replace function public.set_product_interest_status(
  p_request_id uuid,
  p_status     text
) returns public.product_interest_requests
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row public.product_interest_requests;
begin
  /*
   * 🔴 'notified' נדחה **במפורש ובנפרד** משאר הערכים הלא-חוקיים, עם קוד
   * שגיאה משלו, כדי שהניסיון יהיה גלוי בלוג ולא ייראה כמו טעות הקלדה.
   * סימון ידני של "נשלחה הודעה" הוא הצהרה שקרית על העולם.
   */
  if p_status = 'notified' then
    raise exception 'NOTIFIED_IS_NOT_MANUAL' using errcode = 'P0406';
  end if;

  if p_status is null or p_status not in ('open', 'closed') then
    raise exception 'BAD_STATUS' using errcode = '22023';
  end if;

  /*
   * ⚠️ שורה שכבר 'notified' אינה חוזרת ל-'open' דרך כאן. ההודעה כבר יצאה,
   * והחזרתה למצב "ממתינה" הייתה מכניסה אותה שוב לרשימת הנמענות של ריצה
   * עתידית — כלומר הודעה שנייה למי שכבר קיבלה. סגירה שלה מותרת.
   *
   * ═══ 🔒 שתי החותמות ═══
   *
   *   → closed : closed_at = now(). זו נקודת הייחוס ל-retention (0040),
   *              ולכן היא חייבת להיקבע **כאן** ובזמן השרת.
   *   → open   : closed_at = null. השורה חזרה להיות פעילה, ואסור שתישא
   *              חותמת סגירה שתגרום למחיקתה בעוד 90 יום.
   *
   * 🔴 **`notified_at` אינו נגזר כאן לעולם.** שורה שקיבלה הודעה ועוברת
   * ל-closed שומרת את החותמת: היא העדות שההודעה יצאה, ואיבודה היה הופך
   * את השורה למועמדת לשליחה חוזרת אם אי-פעם תיפתח מחדש.
   */
  update public.product_interest_requests
  set status     = p_status,
      closed_at  = case when p_status = 'closed' then now() else null end,
      updated_at = now()
  where id = p_request_id
    and (status <> 'notified' or p_status = 'closed')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_FOUND_OR_LOCKED' using errcode = 'P0404';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.set_product_interest_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_product_interest_status(uuid, text)
  to service_role;


-- ============================================================================
-- חלק 2 — סימון "נשלחה הודעה"
--
-- 🔒 **נקראת אך ורק אחרי שהספק אישר קבלה.** המעבר מותנה ב-status='open'
-- ברמת ה-UPDATE עצמו, ולכן שתי ריצות מקבילות אינן יכולות לסמן את אותה
-- שורה פעמיים: השנייה לא תמצא שורה לעדכן ותחזיר NULL.
--
-- ⚠️ `notified_at` נקבע ב-`now()` של השרת ואינו מתקבל כפרמטר.
-- ============================================================================

create or replace function public.mark_product_interest_notified(
  p_request_id uuid
) returns public.product_interest_requests
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row public.product_interest_requests;
begin
  update public.product_interest_requests
  set status = 'notified',
      notified_at = now(),
      updated_at = now()
  where id = p_request_id
    and status = 'open'     -- 🔒 המעבר היחיד המותר, ובדיקה אטומית
  returning * into v_row;

  -- ⚠️ NULL אינו שגיאה בהכרח: ייתכן שריצה מקבילה כבר סימנה. הקורא מחליט.
  return v_row;
end;
$$;

revoke execute on function public.mark_product_interest_notified(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_product_interest_notified(uuid)
  to service_role;


-- ============================================================================
-- חלק 2ב — ריצות שליחה (product_launch_runs)
--
-- ═══ 🔴 הבעיה שהטבלה הזו פותרת ═══
--
-- המעבר האטומי `open → notified` בחלק 2 מונע **סימון** כפול. הוא **אינו**
-- מונע **שליחה** כפולה:
--
--   בקשה A קוראת את השורה כ-open  ─┐
--   בקשה B קוראת את השורה כ-open  ─┤ שתיהן רואות open
--   A שולחת SMS                     │
--   B שולחת SMS                     │ ← הלקוחה כבר קיבלה שתי הודעות
--   A מסמנת notified                │
--   B לא מוצאת שורה לסמן           ─┘ ← "נמנעה כפילות" — אבל מאוחר מדי
--
-- כלומר הנעילה הקודמת עבדה בדיוק צעד אחד אחרי הנקודה שבה היא נחוצה.
-- הטבלה הזו מעבירה את הנעילה **לפני** קריאת הנמענות: ריצה אחת פעילה
-- לכל מוצר, והיא נתפסת אטומית לפני ששולפים ולו שורה אחת.
--
-- ⚠️ `started_by` הוא `auth.users` אמיתי — `requireAdminApi` מחזיר
-- `userId` מאומת. `on delete set null` באותו דפוס של
-- `customers.retention_hold_updated_by` (0032): מחיקת חשבון המנהלת אינה
-- מוחקת את עדות הריצה.
-- ============================================================================

create table if not exists public.product_launch_runs (
  id           uuid primary key default gen_random_uuid(),
  product_slug text not null check (length(trim(product_slug)) between 1 and 80),

  /*
   * running      — ריצה פעילה. חוסמת ריצה נוספת לאותו מוצר.
   * completed    — הסתיימה, וכל תוצאה בה ודאית.
   * needs_review — ⚠️ הסתיימה עם לפחות מצב עמום אחד. חוסמת ריצה חדשה
   *                עד שאדם יבדוק. ראה חלק 2ג.
   * cancelled    — נסגרה ידנית אחרי בדיקה. **אין כרגע API שמייצר אותה**,
   *                במכוון: שחרור חסימה בלי בדיקה הוא בדיוק resend עיוור.
   */
  status       text not null default 'running'
               check (status in ('running', 'completed', 'needs_review', 'cancelled')),

  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  started_by   uuid references auth.users(id) on delete set null,

  successful_count       integer not null default 0 check (successful_count >= 0),
  failed_count           integer not null default 0 check (failed_count >= 0),
  skipped_count          integer not null default 0 check (skipped_count >= 0),
  mark_failed_count      integer not null default 0 check (mark_failed_count >= 0),
  delivery_unknown_count integer not null default 0 check (delivery_unknown_count >= 0),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- ריצה שרצה אין לה סיום; ריצה שהסתיימה חייבת סיום.
  constraint product_launch_runs_finished_pair
    check ((status = 'running') = (finished_at is null))
);

comment on table public.product_launch_runs is
  'ריצות שליחה של הודעת השקה. הנעילה שמונעת SMS כפול: ריצה פעילה אחת לכל מוצר, נתפסת לפני שליפת הנמענות. needs_review חוסמת ריצה חדשה עד בדיקה אנושית.';

/*
 * 🔒 **הלב של ההגנה.** partial unique: לכל מוצר לכל היותר ריצה אחת
 * במצב 'running'. ניסיון מקביל נכשל ברמת האינדקס — לא ברמת קוד
 * אפליקציה שקורא-ואז-כותב.
 */
create unique index if not exists product_launch_runs_running_unique
  on public.product_launch_runs (product_slug)
  where status = 'running';

create index if not exists product_launch_runs_product_idx
  on public.product_launch_runs (product_slug, started_at desc);

alter table public.product_launch_runs enable row level security;
revoke all on public.product_launch_runs from anon, authenticated;
grant select, insert, update on public.product_launch_runs to service_role;


-- ============================================================================
-- חלק 2ג — פתיחת ריצה
--
-- 🔴 **חייבת להיקרא לפני ששולפים ולו נמען אחד.** זו כל התכלית.
--
-- שתי חסימות נפרדות, עם שני קודי שגיאה שונים:
--
--   LAUNCH_ALREADY_RUNNING — יש ריצה פעילה כרגע. מישהו אחר באמצע.
--   LAUNCH_NEEDS_REVIEW    — ריצה קודמת הסתיימה במצב עמום. ⚠️ אסור
--                            להתחיל חדשה: ייתכן שהודעות כבר יצאו ולא
--                            נרשמו, וריצה נוספת תשלח אותן שוב.
-- ============================================================================

create or replace function public.begin_product_launch_run(
  p_product_slug text,
  p_started_by   uuid
) returns public.product_launch_runs
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row public.product_launch_runs;
begin
  if p_product_slug is null or length(trim(p_product_slug)) = 0 then
    raise exception 'BAD_PRODUCT' using errcode = '22023';
  end if;

  /*
   * 🔒 נעילה מייעצת על המוצר, namespace 8 (לא 4/5/6/7 שתפוסים ע"י
   * ההזמנות, רשימת ההמתנה וההרשמות). היא מסדרת שתי בקשות מקבילות כך
   * שהשנייה רואה את מצב הראשונה במקום להתנגש באינדקס.
   */
  perform pg_advisory_xact_lock(8, hashtext(p_product_slug));

  if exists (
    select 1 from public.product_launch_runs
    where product_slug = p_product_slug and status = 'running'
  ) then
    raise exception 'LAUNCH_ALREADY_RUNNING' using errcode = 'P0407';
  end if;

  -- ⚠️ נבדק **אחרי** 'running' ולפני היצירה: ריצה עמומה חוסמת לצמיתות
  -- עד שאדם יסגור אותה ידנית.
  if exists (
    select 1 from public.product_launch_runs
    where product_slug = p_product_slug and status = 'needs_review'
  ) then
    raise exception 'LAUNCH_NEEDS_REVIEW' using errcode = 'P0408';
  end if;

  insert into public.product_launch_runs (product_slug, started_by)
  values (p_product_slug, p_started_by)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.begin_product_launch_run(text, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_product_launch_run(text, uuid)
  to service_role;


-- ============================================================================
-- חלק 2ד — סגירת ריצה
--
-- 🔴 `completed` מותר **רק** כששני המונים העמומים אפס. הפונקציה אינה
-- בוטחת בקורא: היא מחשבת את המצב בעצמה מהמונים שהתקבלו, ומשדרגת
-- ל-needs_review גם אם הקורא ביקש completed.
-- ============================================================================

create or replace function public.finish_product_launch_run(
  p_run_id                 uuid,
  p_successful_count       integer,
  p_failed_count           integer,
  p_skipped_count          integer,
  p_mark_failed_count      integer,
  p_delivery_unknown_count integer
) returns public.product_launch_runs
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_row    public.product_launch_runs;
  v_status text;
begin
  /*
   * 🔴 ההחלטה היחידה, ובמקום אחד: מצב עמום ⇒ needs_review.
   *
   *   delivery_unknown — הבקשה יצאה ואיננו יודעים אם ההודעה הגיעה.
   *   mark_failed      — ההודעה יצאה בוודאות, והסימון ב-DB נכשל.
   *
   * בשני המקרים ריצה נוספת עלולה לשלוח שוב למי שכבר קיבלה. לכן הריצה
   * אינה נסגרת כ-completed, והמוצר נחסם עד בדיקה אנושית.
   */
  if coalesce(p_delivery_unknown_count, 0) > 0 or coalesce(p_mark_failed_count, 0) > 0 then
    v_status := 'needs_review';
  else
    v_status := 'completed';
  end if;

  update public.product_launch_runs
  set status                 = v_status,
      finished_at            = now(),
      successful_count       = coalesce(p_successful_count, 0),
      failed_count           = coalesce(p_failed_count, 0),
      skipped_count          = coalesce(p_skipped_count, 0),
      mark_failed_count      = coalesce(p_mark_failed_count, 0),
      delivery_unknown_count = coalesce(p_delivery_unknown_count, 0),
      updated_at             = now()
  where id = p_run_id
    and status = 'running'   -- 🔒 רק ריצה פעילה נסגרת, ורק פעם אחת
  returning * into v_row;

  if v_row.id is null then
    raise exception 'RUN_NOT_RUNNING' using errcode = 'P0409';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.finish_product_launch_run(uuid, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.finish_product_launch_run(uuid, integer, integer, integer, integer, integer)
  to service_role;


-- ============================================================================
-- חלק 3 — 🔒 אימות ההרשאות (דוקטרינת 0007/0032/0037/0038)
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.set_product_interest_status(uuid, text)',
    'public.mark_product_interest_notified(uuid)',
    'public.begin_product_launch_run(text, uuid)',
    'public.finish_product_launch_run(uuid, integer, integer, integer, integer, integer)'
  ];
  v_sig text;
  v_priv text;
begin
  -- 🔒 anon/authenticated — אפס הרשאות על טבלת הריצות.
  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('anon', 'public.product_launch_runs', v_priv) then
      raise exception 'הרשאות (0039): ל-anon יש % על product_launch_runs.', v_priv using errcode = 'P0100';
    end if;
    if has_table_privilege('authenticated', 'public.product_launch_runs', v_priv) then
      raise exception 'הרשאות (0039): ל-authenticated יש % על product_launch_runs.', v_priv using errcode = 'P0100';
    end if;
  end loop;

  foreach v_sig in array v_signatures loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0039): % — ל-anon עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0039): % — ל-authenticated עדיין יש EXECUTE.', v_sig using errcode = 'P0100';
    end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0039): % — ל-service_role חסר EXECUTE.', v_sig using errcode = 'P0101';
    end if;
  end loop;

  raise notice '0039: הרשאות RPC אומתו: anon=false, authenticated=false, service_role=true.';
end $$;


-- ============================================================================
-- חלק 4 — אימות ההנחות
-- ============================================================================

do $$
begin
  -- 🔴 ההפרדה עצמה: הפונקציה הידנית חייבת לדחות 'notified'.
  if not exists (
    select 1 from pg_proc
    where proname = 'set_product_interest_status'
      and prosrc like '%NOTIFIED_IS_NOT_MANUAL%'
  ) then
    raise exception '0039: set_product_interest_status אינה דוחה סימון ידני של notified.';
  end if;

  -- 🔒 הסימון מותנה ב-open, אחרת שתי ריצות ישלחו פעמיים.
  if not exists (
    select 1 from pg_proc
    where proname = 'mark_product_interest_notified'
      and prosrc like '%status = ''open''%'
  ) then
    raise exception '0039: mark_product_interest_notified אינה מותנית ב-status=open.';
  end if;

  -- 🔒 אף אחת מהפונקציות אינה נוגעת בדיוור או בלקוחות.
  if exists (
    select 1 from pg_proc
    where proname in ('set_product_interest_status', 'mark_product_interest_notified',
                      'begin_product_launch_run', 'finish_product_launch_run')
      and (prosrc like '%marketing_consent%'
        or prosrc like '%marketing_opted_out_at%'
        or prosrc like '%sms_campaigns%'
        or prosrc like '%link_or_create_customer%')
  ) then
    raise exception '0039: פונקציה נוגעת בדיוור או ביצירת לקוחה. אין לה שום עסק עם אלה.';
  end if;

  -- 🔒 הנעילה שמונעת SMS כפול: אינדקס ייחודי חלקי על ריצה פעילה.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'product_launch_runs_running_unique'
  ) then
    raise exception '0039: product_launch_runs_running_unique חסר — אין מה שמונע שתי ריצות מקבילות.';
  end if;

  -- 🔴 מצב עמום חייב להוביל ל-needs_review, אחרת כל ההגנה חסרת משמעות.
  if not exists (
    select 1 from pg_proc
    where proname = 'finish_product_launch_run'
      and prosrc like '%needs_review%'
      and prosrc like '%p_delivery_unknown_count%'
      and prosrc like '%p_mark_failed_count%'
  ) then
    raise exception '0039: finish_product_launch_run אינה מסמנת needs_review על מצב עמום.';
  end if;

  -- 🔒 פתיחת ריצה חוסמת גם ריצה פעילה וגם ריצה עמומה.
  if not exists (
    select 1 from pg_proc
    where proname = 'begin_product_launch_run'
      and prosrc like '%LAUNCH_ALREADY_RUNNING%'
      and prosrc like '%LAUNCH_NEEDS_REVIEW%'
  ) then
    raise exception '0039: begin_product_launch_run אינה חוסמת את שני המצבים.';
  end if;

  raise notice '0039: הפרדת notified, נעילת הריצה וחסימת needs_review אומתו.';
end $$;
