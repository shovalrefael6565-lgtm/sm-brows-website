-- ============================================================================
-- 0036 — מצב הכרטיס כפילטר מלא: פעילות / בארכיון / הכל
--
-- ═══ מה זה משנה, ומה לא ═════════════════════════════════════════════════════
--
-- ✅ מוסיף **ערך פילטר אחד** ל-list_crm_customers: 'all_including_archived',
--    שמציג את הלקוחות הפעילות ואת הארכיון באותה רשימה. עד כה אפשר היה לראות
--    או את אלה או את אלה, ולא את שתיהן — ולכן "הכל" במסך לא היה יכול להיות
--    אמיתי.
--
-- 🔒 **ברירת המחדל לא זזה.** כל ערך פילטר קיים ('all', 'active', 'no_show'…)
--    ממשיך להסתיר לקוחה מאורכבת, בדיוק כמו קודם. ההסתרה היא כל מהות הארכיון,
--    ורק בקשה מפורשת של המנהלת מציגה אותן.
--
-- ❌ **אינו משנה חתימה.** אותם שמונה פרמטרים, אותו jsonb. אין DROP, אין
--    overload, ואין רגע שבו האפליקציה קוראת לפונקציה שאינה קיימת — אותה
--    דוקטרינה תוספתית של 0028 חלק 6.
-- ❌ אינו נוגע ב-get_crm_customer, ב-archive_customer, ב-unarchive_customer
--    ובאף פונקציית ארכוב. הארכוב עצמו נשאר בדיוק כפי שהוא מאז 0028.
-- ❌ אינו נוגע בתורים, בתזכורות, בהסכמות דיוור, בהסרה מדיוור ובקמפיינים.
--    הפילטר הזה קורא בלבד.
--
-- ⚠️ פריסה בטוחה בשני הכיוונים: אפליקציה חדשה מול DB ישן שולחת ערך שאינו
-- מוכר, וה-CASE הקיים כבר מתרגם ערך לא מוכר ל-'all' — כלומר המסך יראה את
-- הרשימה הפעילה במקום להיכשל. אין כאן מצב שבור, רק פונקציונליות שממתינה.
-- ============================================================================

create or replace function public.list_crm_customers(
  p_search       text        default null,
  p_filter       text        default 'all',
  p_source_key   text        default null,
  p_sort         text        default 'last_activity',
  p_created_from timestamptz default null,
  p_created_to   timestamptz default null,
  p_limit        integer     default 25,
  p_offset       integer     default 0
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 1000000);
  v_sort   text    := case
                       when p_sort in ('last_activity','created_desc','created_asc',
                                       'next_appointment','name')
                       then p_sort else 'last_activity'
                     end;
  v_filter text    := case
                       when p_filter in ('all','active','inactive','has_future','no_future',
                                         'returning','no_show','cancelled','archived',
                                         'all_including_archived')
                       then p_filter else 'all'
                     end;
  v_search text    := nullif(trim(coalesce(p_search, '')), '');
  v_like   text;
  v_digits text;
  v_result jsonb;
begin
  if v_search is not null then
    v_search := left(v_search, 100);
    v_like   := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := ltrim(regexp_replace(v_search, '[^0-9]', '', 'g'), '0');
    v_digits := nullif(v_digits, '');
  end if;

  with filtered as (
    select
      c.id, c.full_name, c.phone_e164, c.created_at,
      (c.auth_user_id is not null)      as has_login_account,
      c.archived_at,
      coalesce(p.crm_status, 'active')  as crm_status,
      coalesce(p.source_key, 'unknown') as source_key,
      m.completed_count, m.no_show_count,
      m.cancelled_by_customer_count, m.cancelled_by_business_count,
      m.active_pending_count, m.self_reschedule_total, m.all_reschedule_events,
      m.first_completed_at, m.last_completed_at,
      m.next_confirmed_starts_at, m.next_confirmed_service_key, m.next_confirmed_variants,
      m.open_notes_count, m.last_activity_at
    from public.customers c
    left join public.customer_crm_profiles p on p.customer_id = c.id
    join      public.customer_crm_metrics  m on m.customer_id = c.id
    where
      not (c.auth_user_id is not null
           and exists (select 1 from public.admins ad where ad.user_id = c.auth_user_id))
      /*
       * 🔒 15H, מורחב — שלושה מצבים, ולא שניים:
       *   'archived'               → הארכיון בלבד
       *   'all_including_archived' → שתי הקבוצות יחד
       *   כל שאר הערכים            → הפעילות בלבד (הארכיון מוסתר, כברירת מחדל)
       *
       * ⚠️ ברירת המחדל לא זזה: כל פילטר קיים ממשיך להסתיר את הארכיון,
       * בדיוק כמו לפני המיגרציה הזו. רק ערך חדש ומפורש מציג את שתיהן.
       */
      and (case v_filter
             when 'archived'               then c.archived_at is not null
             when 'all_including_archived' then true
             else                               c.archived_at is null
           end)
      and (v_search is null
           or c.full_name ilike v_like
           or (v_digits is not null and c.phone_e164 like '%' || v_digits || '%'))
      and (p_source_key is null or coalesce(p.source_key, 'unknown') = p_source_key)
      and (p_created_from is null or c.created_at >= p_created_from)
      and (p_created_to   is null or c.created_at <= p_created_to)
      and case v_filter
            when 'active'     then coalesce(p.crm_status, 'active') = 'active'
            when 'inactive'   then coalesce(p.crm_status, 'active') = 'inactive'
            when 'has_future' then m.next_confirmed_starts_at is not null
            when 'no_future'  then m.next_confirmed_starts_at is null
            when 'returning'  then m.completed_count > 1
            when 'no_show'    then m.no_show_count > 0
            when 'cancelled'  then (m.cancelled_by_customer_count + m.cancelled_by_business_count) > 0
            else true
          end
  ),
  page as (
    select f.*,
           row_number() over (
             order by
               case when v_sort = 'name'             then f.full_name                end asc,
               case when v_sort = 'created_asc'      then f.created_at               end asc,
               case when v_sort = 'created_desc'     then f.created_at               end desc,
               case when v_sort = 'next_appointment' then f.next_confirmed_starts_at end asc nulls last,
               case when v_sort = 'last_activity'    then f.last_activity_at         end desc,
               f.created_at desc
           ) as rn
    from filtered f
    order by rn
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total_count', (select count(*) from filtered),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(pg) - 'rn' order by pg.rn) from page pg),
      '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ─── אימות עצמי ─────────────────────────────────────────────────────────────
do $verify$
begin
  -- החתימה נשארה זהה: בדיוק פונקציה אחת בשם הזה, עם שמונה פרמטרים.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'list_crm_customers') <> 1 then
    raise exception '0036: list_crm_customers אינה יחידה — נוצר overload' using errcode = 'P0106';
  end if;

  if (select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'list_crm_customers') <> 8 then
    raise exception '0036: חתימת list_crm_customers השתנתה' using errcode = 'P0106';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_crm_customers'
      and pg_get_functiondef(p.oid) like '%all_including_archived%'
  ) then
    raise exception '0036: ערך הפילטר החדש לא נכנס לפונקציה' using errcode = 'P0106';
  end if;

  -- 🔒 הארכוב עצמו לא נגע: שתי הפונקציות עדיין קיימות כפי שהיו.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'archive_customer')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'unarchive_customer') then
    raise exception '0036: פונקציות הארכוב חסרות' using errcode = 'P0106';
  end if;
end
$verify$;

comment on function public.list_crm_customers(text, text, text, text, timestamptz, timestamptz, integer, integer) is
  'רשימת ה-CRM. מצב הכרטיס הוא שלושה ערכים: ברירת מחדל = פעילות בלבד, ''archived'' = הארכיון בלבד, ''all_including_archived'' = שתיהן.';
