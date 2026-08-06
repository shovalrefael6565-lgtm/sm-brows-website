-- ============================================================================
-- 0010 — שלב 10: לקוחות ידניות ותור ידני ממערכת הניהול
--
-- תלוי ב-0001–0009 שכבר רצו. זו המיגרציה הראשונה בפרויקט שמשנה מבנה
-- קיים באופן מהותי, ולכן היא כתובה כך שתיכשל ברעש במקום להצליח בשקט על
-- סכמה שאינה מה שציפינו לה.
--
-- ─── השינוי הארכיטקטוני ───────────────────────────────────────────────────
--
-- עד היום:  customers.id = auth.users.id  (FK ישיר), ולקוחה בלי חשבון
--           התחברות פשוט לא יכלה להתקיים.
--
-- מעכשיו:   customer היא ישות עסקית עצמאית. auth user הוא קישור *אופציונלי*
--           דרך customers.auth_user_id. לקוחה ידנית קיימת בלי חשבון, וכשהיא
--           תתחבר בעתיד עם OTP — החשבון ייקשר לשורה הקיימת לפי הטלפון,
--           בלי כפילות ובלי לאבד היסטוריה.
--
-- ⚠️ מזהי ה-customers הקיימים **אינם משתנים**. אין העברת appointments,
-- notes, activity או CRM profiles לשום id חדש. ה-backfill רק ממלא את
-- auth_user_id בעמודה החדשה.
--
-- ─── חמישה גבולות שמקודדים כאן ולא רק בקוד ────────────────────────────────
--
--   1. מחיקת auth user לעולם לא תמחק customer, appointments או היסטוריה.
--      ה-FK החדש הוא ON DELETE SET NULL — מחיקת חשבון התחברות מסירה את
--      יכולת הכניסה בלבד. אין לחזור ל-CASCADE לעולם.
--
--   2. לקוחה ניגשת לנתונים שלה אך ורק דרך customers.auth_user_id = auth.uid().
--      לקוחה ידנית (auth_user_id IS NULL) אינה נגישה לאף תפקיד API — כי
--      auth.uid() הוא NULL עבור anon, ו-NULL = NULL אינו TRUE.
--
--   3. **customers_update_own מוסרת וההרשאה נשללת.** ראה הנימוק המלא שם:
--      RLS מגבילה שורות, לא עמודות, ולכן ה-policy הישנה איפשרה ללקוחה
--      מחוברת לשנות is_blocked, admin_notes ו-phone_e164 של עצמה דרך
--      PostgREST. זו הייתה חשיפה אמיתית והיא נסגרת כאן.
--
--   4. אף פונקציה כאן **אינה קוראת את auth.users**. Supabase אינה מאפשרת
--      לתפקידי ה-API גישה לסכמת auth, וקריאה כזו הייתה עוברת ב-PGlite
--      ונכשלת רק אחרי ההתקנה. אימות הטלפון של ה-auth user מתבצע בשרת דרך
--      Auth Admin API (lib/auth/adminUserResolver.ts) *לפני* קריאת ה-RPC,
--      וקיום ה-user נאכף ע"י ה-FK. ראה ההערה על link_or_create למטה.
--
--   5. יצירה ידנית (לקוחה או תור) לעולם אינה יוצרת auth user, אינה שולחת
--      OTP/SMS/WhatsApp ואינה יוצרת תשלום או מקדמה.
--
-- ─── מה השלב הזה במפורש אינו עושה ─────────────────────────────────────────
--
-- אין עריכת שם או טלפון, אין מיזוג לקוחות, אין מחיקת לקוחה, אין העברת
-- חשבון auth בין לקוחות, אין יצירת auth user ידנית, אין שליחת OTP מה-CRM,
-- אין import, אין תזכורות ואין תשלומים.
-- ============================================================================


-- ============================================================================
-- חלק 1 — הפרדת customer מ-auth user
-- ============================================================================

-- id הופך למזהה עסקי עצמאי. עד היום הוא תמיד הגיע מ-auth.users ולכן לא היה
-- לו default; לקוחה ידנית צריכה לקבל מזהה משלה.
alter table public.customers
  alter column id set default gen_random_uuid();

alter table public.customers
  add column auth_user_id uuid;

comment on column public.customers.auth_user_id is
  'קישור אופציונלי לחשבון ההתחברות. NULL = לקוחה ידנית ללא חשבון. זהו השדה היחיד שמכריע בעלות מול auth.uid() — customers.id אינו auth id יותר.';


-- ─── Backfill ──────────────────────────────────────────────────────────────
--
-- ⚠️ התנאי `exists (auth.users)` אינו קישוט. בלעדיו, הרצה חוזרת (או הרצה
-- בסביבת בדיקה שכבר יש בה לקוחה ידנית) הייתה מנסה לקשר auth_user_id = id
-- גם ללקוחה ידנית שאין לה auth user כלל — וה-FK שנוסף מיד אחריה היה נכשל,
-- או גרוע מכך, היה עובר על סכמה שבה ה-FK עדיין לא קיים ומשאיר נתון שקרי.
--
-- עם התנאי, ה-UPDATE הוא no-op מוחלט על לקוחות ידניות ובטוח להרצה חוזרת.
update public.customers c
set auth_user_id = c.id
where c.auth_user_id is null
  and exists (select 1 from auth.users u where u.id = c.id);


-- ─── הסרת ה-FK הישן ────────────────────────────────────────────────────────
--
-- ⚠️ בלי `if exists` ובלי ניחוש שם. השם `customers_id_fkey` הוא רק ברירת
-- המחדל של Postgres ואין שום ערובה שהוא מה שקיים בפרודקשן. הבלוק מאתר את
-- ה-FK לפי *המבנה* שלו (customers.id → auth.users), ודורש שיימצא בדיוק
-- אחד. אם יימצאו אפס — הסכמה אינה מה שחשבנו והמיגרציה חייבת ליפול, לא
-- להמשיך בשקט. אם יימצאו כמה — אין למחוק אותם בשקט.
do $$
declare
  v_names text[];
  v_id_attnum smallint;
begin
  select attnum into v_id_attnum
  from pg_attribute
  where attrelid = 'public.customers'::regclass and attname = 'id';

  select array_agg(con.conname order by con.conname) into v_names
  from pg_constraint con
  join pg_class     rel on rel.oid  = con.conrelid
  join pg_class     frel on frel.oid = con.confrelid
  join pg_namespace n   on n.oid    = rel.relnamespace
  join pg_namespace fn  on fn.oid   = frel.relnamespace
  where con.contype  = 'f'
    and n.nspname    = 'public'
    and rel.relname  = 'customers'
    and fn.nspname   = 'auth'
    and frel.relname = 'users'
    and con.conkey   = array[v_id_attnum];

  if v_names is null or array_length(v_names, 1) <> 1 then
    raise exception
      '0010: ציפינו בדיוק ל-FK אחד מ-customers.id ל-auth.users, נמצאו % (%)',
      coalesce(array_length(v_names, 1), 0), coalesce(array_to_string(v_names, ', '), '—')
      using errcode = 'P0104';
  end if;

  execute format('alter table public.customers drop constraint %I', v_names[1]);
end $$;


-- ─── הקישור החדש ───────────────────────────────────────────────────────────
--
-- UNIQUE רגיל ולא אינדקס חלקי: ב-Postgres ערכי NULL אינם מתנגשים זה בזה
-- ב-UNIQUE, ולכן זה *כבר* "ייחודי כשאינו NULL" — כל הלקוחות הידניות יכולות
-- להיות NULL במקביל, ושני auth users שונים לא יוכלו להצביע לאותה לקוחה.
alter table public.customers
  add constraint customers_auth_user_id_key unique (auth_user_id);

-- ⚠️ ON DELETE SET NULL, ולעולם לא CASCADE. מחיקת חשבון התחברות היא אירוע
-- טכני; היא לא אמורה למחוק את הלקוחה, את התורים שלה, את ההיסטוריה, את
-- ההערות או את פעילות ה-CRM. היא מסירה את יכולת הכניסה בלבד, והלקוחה
-- ממשיכה להתקיים כלקוחה ידנית.
alter table public.customers
  add constraint customers_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete set null;


-- ============================================================================
-- חלק 2 — RLS לפי auth_user_id
--
-- כל policy שהשוותה customer id מול auth.uid() נשענה על כך שהם אותו דבר.
-- אחרי חלק 1 ההנחה הזו שקרית, ובלי העדכון הזה לקוחה הייתה מאבדת גישה
-- לנתונים שלה — או גרוע מכך, מקבלת גישה לנתונים של לקוחה אחרת אילו id
-- כלשהו היה מתלכד עם auth id.
-- ============================================================================

drop policy customers_select_own           on public.customers;
drop policy appointments_select_own        on public.appointments;
drop policy appointment_history_select_own on public.appointment_history;

create policy customers_select_own on public.customers
  for select using (auth_user_id = auth.uid() or public.is_admin());

-- הבעלות עוברת דרך customers, ולכן היא נאכפת בנקודה אחת בלבד. לקוחה ידנית
-- (auth_user_id IS NULL) אינה מתאימה לאף auth.uid(), כולל NULL של anon.
create policy appointments_select_own on public.appointments
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.customers c
      where c.id = appointments.customer_id
        and c.auth_user_id = auth.uid()
    )
  );

create policy appointment_history_select_own on public.appointment_history
  for select using (
    public.is_admin()
    or exists (
      select 1
      from public.appointments a
      join public.customers    c on c.id = a.customer_id
      where a.id = appointment_history.appointment_id
        and c.auth_user_id = auth.uid()
    )
  );


-- ─── 🔒 סגירת UPDATE ישיר על customers ────────────────────────────────────
--
-- ⚠️ זו סגירת חשיפה קיימת, לא ניקוי סגנוני.
--
-- customers_update_own (0001) התירה ללקוחה לעדכן את *השורה* שלה. אבל RLS
-- מגבילה אילו שורות ניתן לעדכן — לא אילו עמודות. Supabase מעניקה
-- ל-authenticated הרשאת UPDATE ברמת הטבלה כברירת מחדל, ולכן לקוחה מחוברת
-- יכלה לקרוא ישירות ל-PostgREST ולשנות בשורה של עצמה:
--
--     is_blocked   → להסיר לעצמה חסימה שהעסק הטיל
--     admin_notes  → לדרוס הערות פנימיות
--     phone_e164   → להחליף את המספר המזוהה שלה
--
-- ואחרי חלק 1 היא גם הייתה יכולה לכתוב auth_user_id ולנתק או לחטוף קישור
-- חשבון. אימתנו את כל ארבעת המקרים מול הפרויקט האמיתי — כולם הצליחו.
--
-- אין היום שום פיצ'ר customer-facing שדורש UPDATE ישיר (updateCustomerName
-- ב-lib/db/customers.ts אינה נקראת מאף מקום, וממילא רצה כ-service_role).
-- לכן נסגרות שתי השכבות גם יחד: אין policy, וגם אין הרשאה.
--
-- כשתיבנה עריכת שם — היא תקבל grant update(full_name) ברמת *עמודה* בלבד,
-- לעולם לא grant ברמת טבלה, plus policy לפי auth_user_id.
drop policy customers_update_own on public.customers;

revoke update on public.customers from anon, authenticated;


-- ============================================================================
-- חלק 3 — טבלת ה-idempotency של פעולות הניהול
--
-- מגנה על יצירת לקוחה ויצירת תור מפני לחיצה כפולה, retry אחרי timeout,
-- תגובה שאבדה אחרי commit, ושתי בקשות מקבילות. disabled על הכפתור אינו
-- הגנה — הכתיבה כבר קרתה.
--
-- ⚠️ ה-PK כולל actor_admin_id בכוונה: idempotency שייכת למנהל שביצע את
-- הפעולה, ושני מנהלים אינם חולקים namespace אם אותו UUID נשלח בטעות משני
-- מכשירים.
--
-- ⚠️ result_code נדרש כדי ש-retry יחזיר את *אותה תשובה* גם אם מצב ה-DB
-- השתנה בינתיים. בלעדיו, retry על 'admin_phone_exists' היה עלול להחזיר
-- תשובה אחרת לגמרי רק משום שמישהו שינה נתונים בין הבקשות.
--
-- ⚠️ אין כאן raw request body ואין טלפון בטקסט גלוי — רק טביעת אצבע.
-- ה-SHA-256 מחושב בשרת (lib/adminIdempotency.ts) ולא כאן: pgcrypto אינה
-- זמינה ב-PGlite, וחישוב בשרת גם מבטיח canonicalization *אחת* לשני ה-routes.
-- ============================================================================

create table public.admin_idempotency (
  scope               text not null check (scope in ('customer_create', 'appointment_create')),
  actor_admin_id      uuid not null references auth.users(id),
  client_request_id   uuid not null,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  target_id           uuid,
  result_code         text check (result_code in (
                        'customer_created', 'existing_customer',
                        'admin_phone_exists', 'appointment_created'
                      )),
  created_at          timestamptz not null default now(),

  primary key (scope, actor_admin_id, client_request_id)
);

comment on table public.admin_idempotency is
  'מפתחות idempotency לפעולות ניהול. אין בה גוף בקשה ואין טלפון — רק SHA-256 של payload קנוני שחושב בשרת.';
comment on column public.admin_idempotency.result_code is
  'התוצאה שהוחזרה בפעם הראשונה. retry מחזיר אותה כפי שהיא, גם אם ה-DB השתנה מאז.';
comment on column public.admin_idempotency.target_id is
  'ה-customer/appointment שנוצר או אותר. ללא FK — הוא מצביע לשתי טבלאות שונות לפי scope, ולכן ניקוי נתוני בדיקה חייב למחוק כאן במפורש.';

-- ⚠️ אין כאן שום FK ל-customers/appointments דרך target_id, ולכן אין
-- ON DELETE CASCADE. ניקוי נתוני TEST *חייב* למחוק את השורות האלה במפורש.

alter table public.admin_idempotency enable row level security;

-- RLS מופעל ואין אף policy → הטבלה חסומה לכל תפקיד שאינו עוקף RLS.
-- ה-REVOKE הוא השכבה השנייה: Supabase מעניקה הרשאות טבלה לתפקידי ה-API
-- כברירת מחדל (בדיוק המנגנון שיצר את החשיפה ב-customers למעלה), ואנחנו
-- לא מסתמכים על כך שאין policy.
revoke all on public.admin_idempotency from anon, authenticated;
grant select, insert, update, delete on public.admin_idempotency to service_role;


-- ============================================================================
-- חלק 4 — customer_created ב-activity
--
-- ⚠️ מאתרים את ה-CHECK לפי התוכן שלו ולא לפי שם שניחשנו. השם שנוצר
-- אוטומטית ב-0009 הוא ברירת מחדל של Postgres, ואם הוא אינו מה שציפינו לו
-- עדיף ליפול מאשר "להצליח" ולהשאיר את ה-CHECK הישן במקומו.
-- ============================================================================

do $$
declare v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel     on rel.oid = con.conrelid
  join pg_namespace n   on n.oid   = rel.relnamespace
  where con.contype = 'c'
    and n.nspname   = 'public'
    and rel.relname = 'customer_crm_activity'
    and pg_get_constraintdef(con.oid) like '%note_archived%';

  if v_name is null then
    raise exception '0010: לא נמצא ה-CHECK של customer_crm_activity.action'
      using errcode = 'P0104';
  end if;

  execute format('alter table public.customer_crm_activity drop constraint %I', v_name);
end $$;

alter table public.customer_crm_activity
  add constraint customer_crm_activity_action_check
  check (action in (
    'crm_status_changed',
    'source_changed',
    'note_created',
    'note_updated',
    'note_archived',
    'customer_created'
  ));

-- ⚠️ אין backfill של customer_created. לקוחות שנוצרו דרך OTP לא נוצרו ע"י
-- מנהל, ורישום אודיט מזויף בדיעבד גרוע מהיעדר רישום.


-- ============================================================================
-- חלק 5 — RPCs
--
-- כולן SECURITY INVOKER (ברירת המחדל), כמו 32 הפונקציות הקיימות: הן
-- נקראות אך ורק ע"י service_role בשרת, שממילא עוקף RLS.
--
-- כל RPC שמשנה מצב פותח באימות שה-actor הוא מנהל בפועל. p_admin_id לעולם
-- אינו מגיע מגוף הבקשה — הוא נלקח מה-session המאומת בשרת (requireAdminApi).
-- ============================================================================

-- ─── קישור auth user ל-customer ────────────────────────────────────────────
--
-- זו הפונקציה שמאפשרת ללקוחה שנוצרה ידנית ב-CRM להתחבר בעתיד עם OTP
-- ולקבל את ההיסטוריה שלה — במקום לקבל כרטיס חדש וריק.
--
-- ⚠️ **אינה קוראת את auth.users.** Supabase חוסמת את סכמת auth לתפקידי
-- ה-API (אימתנו: schema('auth').from('users') מחזיר "Invalid schema: auth"),
-- ולכן SELECT כזה היה עובר ב-PGlite ונכשל רק אחרי ההתקנה בפרודקשן.
-- שתי הדרישות שהיו נשענות עליו מסופקות אחרת:
--   • ה-auth user קיים   → נאכף ע"י ה-FK של auth_user_id
--   • הטלפון תואם        → נבדק בשרת ב-verifyAuthUserPhone() דרך Auth Admin
--                           API, *לפני* הקריאה לכאן
--
-- ⚠️ p_full_name נקרא **אך ורק** ביצירת לקוחה חדשה לגמרי. שם שנקבע ידנית
-- ע"י המנהלת ב-CRM לעולם אינו נדרס ע"י מה שהלקוחה הקלידה בטופס ההתחברות,
-- ואין activity על שם. עריכת שם אינה חלק משלב 10.
--
-- הנעילות (FOR UPDATE) הן מה שמונע ששתי התחברויות מקבילות ייצרו כפילות:
-- השנייה נחסמת עד ה-commit של הראשונה ואז רואה את המצב המעודכן.
create or replace function public.link_or_create_customer_for_auth(
  p_auth_user_id uuid,
  p_phone_e164   text,
  p_full_name    text
)
returns jsonb
language plpgsql
as $$
declare
  v_by_auth  public.customers;
  v_by_phone public.customers;
  v_name     text := nullif(regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '');
  v_row      public.customers;
begin
  if p_auth_user_id is null then
    raise exception 'MISSING_AUTH_USER' using errcode = '22023';
  end if;
  if p_phone_e164 is null or p_phone_e164 !~ '^\+9725[0-9]{8}$' then
    raise exception 'INVALID_PHONE' using errcode = '22023';
  end if;

  -- ── מצבים 1/3/5: ה-auth user כבר מקושר למישהי ──────────────────────────
  select * into v_by_auth
  from public.customers
  where auth_user_id = p_auth_user_id
  for update;

  if v_by_auth.id is not null then
    if v_by_auth.phone_e164 <> p_phone_e164 then
      -- מצב 5: ה-auth user מקושר ללקוחה עם טלפון אחר. אין merge אוטומטי,
      -- אין החלפת customer ואין מחיקה — זה טיפול ידני שאינו בשלב 10.
      raise exception 'AUTH_CUSTOMER_CONFLICT' using errcode = '42501';
    end if;
    -- מצבים 1 ו-3: idempotent לחלוטין. אין שורה נוספת, אין שינוי שם.
    return jsonb_build_object(
      'customer_id', v_by_auth.id,
      'phone_e164',  v_by_auth.phone_e164,
      'full_name',   v_by_auth.full_name,
      'is_blocked',  v_by_auth.is_blocked,
      'created',     false,
      'linked',      false
    );
  end if;

  -- ── מצבים 2/4: קיימת לקוחה עם הטלפון הזה ───────────────────────────────
  select * into v_by_phone
  from public.customers
  where phone_e164 = p_phone_e164
  for update;

  if v_by_phone.id is not null then
    if v_by_phone.auth_user_id is not null then
      -- מצב 4: הטלפון שייך ללקוחה שכבר מקושרת ל-auth user *אחר*. לא
      -- מעבירים ownership, לא מנתקים את הקודם, לא יוצרים כפילות.
      raise exception 'PHONE_LINKED_TO_OTHER_AUTH' using errcode = '42501';
    end if;

    -- מצב 2: לקוחה ידנית מתחברת לראשונה. אותו customer.id נשמר, ולכן כל
    -- ה-appointments, ההיסטוריה, ההערות ופעילות ה-CRM נשארים מחוברים.
    update public.customers
    set auth_user_id = p_auth_user_id
    where id = v_by_phone.id
    returning * into v_row;

    return jsonb_build_object(
      'customer_id', v_row.id,
      'phone_e164',  v_row.phone_e164,
      'full_name',   v_row.full_name,   -- ← השם הידני נשאר
      'is_blocked',  v_row.is_blocked,
      'created',     false,
      'linked',      true
    );
  end if;

  -- ── מצב 6: לקוחה חדשה לגמרי ────────────────────────────────────────────
  -- הטריגר customers_create_crm_profile יוצר פרופיל CRM עם active/unknown.
  -- אין activity של customer_created — היא שמורה ליצירה ידנית ע"י מנהל.
  insert into public.customers (phone_e164, full_name, auth_user_id)
  values (p_phone_e164, coalesce(v_name, 'לקוחה'), p_auth_user_id)
  returning * into v_row;

  return jsonb_build_object(
    'customer_id', v_row.id,
    'phone_e164',  v_row.phone_e164,
    'full_name',   v_row.full_name,
    'is_blocked',  v_row.is_blocked,
    'created',     true,
    'linked',      true
  );
end;
$$;


-- ─── יצירת לקוחה ידנית ─────────────────────────────────────────────────────
--
-- לקוחה שנוצרת כאן: אין לה auth user, לא נשלח אליה OTP, לא נשלח SMS ולא
-- נפתח WhatsApp. auth_user_id נשאר NULL עד שהיא תתחבר בעצמה.
--
-- ⚠️ טלפון קיים אינו שגיאת שרת ואינו הזדמנות לעדכן את הלקוחה הקיימת:
-- אין שינוי שם, אין שינוי source, אין שינוי crm_status ואין קישור auth —
-- גם כשמגיע request id חדש. המנהלת מקבלת הפניה לפרופיל הקיים.
--
-- ⚠️ אם הטלפון שייך לחשבון מנהל, לא מחזירים customer_id ולא שם: רק
-- הודעה מסוננת שהמספר כבר קיים במערכת.
create or replace function public.create_manual_customer(
  p_full_name           text,
  p_phone_e164          text,
  p_source_key          text,
  p_crm_status          text,
  p_admin_id            uuid,
  p_client_request_id   uuid,
  p_payload_fingerprint text
)
returns jsonb
language plpgsql
as $$
declare
  v_name     text := nullif(regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '');
  v_status   text := coalesce(nullif(trim(coalesce(p_crm_status, '')), ''), 'active');
  v_source   text := coalesce(nullif(trim(coalesce(p_source_key, '')), ''), 'unknown');
  v_claimed  boolean;
  v_prev     public.admin_idempotency;
  v_existing public.customers;
  v_row      public.customers;
  v_result   text;
  v_target   uuid;
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  if p_client_request_id is null then
    raise exception 'MISSING_REQUEST_ID' using errcode = '22023';
  end if;
  if p_payload_fingerprint is null or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'BAD_FINGERPRINT' using errcode = '22023';
  end if;

  -- ── תפיסת מפתח ה-idempotency ───────────────────────────────────────────
  -- ON CONFLICT DO NOTHING ממתין לטרנזקציה מקבילה שכבר החזיקה את המפתח,
  -- ולכן אחרי השורה הזו המצב תמיד מוכרע: או שאנחנו הבעלים, או שהשורה
  -- השנייה כבר commit-ה ואפשר לקרוא את התוצאה שלה.
  insert into public.admin_idempotency
    (scope, actor_admin_id, client_request_id, payload_fingerprint)
  values
    ('customer_create', p_admin_id, p_client_request_id, p_payload_fingerprint)
  on conflict do nothing
  returning true into v_claimed;

  if v_claimed is null then
    select * into v_prev
    from public.admin_idempotency
    where scope = 'customer_create'
      and actor_admin_id = p_admin_id
      and client_request_id = p_client_request_id;

    if v_prev.payload_fingerprint <> p_payload_fingerprint then
      -- אותו מפתח עם נתונים שונים: לא מחזירים הצלחה על תוכן שלא נשמר,
      -- ולא נוגעים בלקוחה המקורית.
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    if v_prev.result_code is null then
      raise exception 'IDEMPOTENCY_INCOMPLETE' using errcode = 'P0104';
    end if;

    -- retry: מחזירים בדיוק את מה שהוחזר בפעם הראשונה.
    return jsonb_build_object(
      'result',      v_prev.result_code,
      'customer_id', v_prev.target_id,
      'replayed',    true
    );
  end if;

  -- ── ולידציה ────────────────────────────────────────────────────────────
  if v_name is null or length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  if p_phone_e164 is null or p_phone_e164 !~ '^\+9725[0-9]{8}$' then
    raise exception 'INVALID_PHONE' using errcode = '22023';
  end if;
  if v_status not in ('active', 'inactive') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customer_sources where key = v_source) then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customer_sources where key = v_source and is_active) then
    raise exception 'SOURCE_INACTIVE' using errcode = '22023';
  end if;

  -- ── טלפון קיים ─────────────────────────────────────────────────────────
  insert into public.customers (phone_e164, full_name)
  values (p_phone_e164, v_name)
  on conflict (phone_e164) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_existing from public.customers where phone_e164 = p_phone_e164;

    if v_existing.auth_user_id is not null
       and exists (select 1 from public.admins a where a.user_id = v_existing.auth_user_id) then
      -- חשבון מנהל: לא חושפים מזהה ולא שם.
      v_result := 'admin_phone_exists';
      v_target := null;
    else
      v_result := 'existing_customer';
      v_target := v_existing.id;
    end if;
  else
    -- לקוחה חדשה. הטריגר כבר יצר פרופיל CRM עם ברירות המחדל; כאן מיישרים
    -- אותו לבחירת המנהלת, באותה טרנזקציה. אם השורה הזו או ה-activity
    -- ייכשלו — כל היצירה מתגלגלת לאחור ולא נשארת לקוחה חלקית.
    update public.customer_crm_profiles
    set crm_status = v_status,
        source_key = v_source
    where customer_id = v_row.id;

    -- אודיט: מי יצר את הלקוחה. ללא טלפון, ללא שם, ללא request id.
    insert into public.customer_crm_activity
      (customer_id, action, actor_admin_id, old_value, new_value)
    values
      (v_row.id, 'customer_created', p_admin_id, null, v_source);

    v_result := 'customer_created';
    v_target := v_row.id;
  end if;

  update public.admin_idempotency
  set result_code = v_result, target_id = v_target
  where scope = 'customer_create'
    and actor_admin_id = p_admin_id
    and client_request_id = p_client_request_id;

  return jsonb_build_object(
    'result',      v_result,
    'customer_id', v_target,
    'replayed',    false
  );
end;
$$;


-- ─── יצירת תור ידני ────────────────────────────────────────────────────────
--
-- תור שמנהלת קובעת נוצר confirmed מיד — הוא לא pending ולא דורש אישור
-- נוסף. אין pending_expires_at, אין מקדמה, אין תשלום ואין הודעה אוטומטית.
--
-- ⚠️ duration_min, price_total, service_key, variants ו-policy_version
-- מגיעים כפרמטרים אבל **לא מהדפדפן**: השרת טוען מחדש את הגדרת השירות
-- מ-lib/services.ts ומחשב אותם בעצמו (ראה lib/adminBooking.ts). הפרמטרים
-- כאן הם התוצאה של החישוב הזה.
--
-- ⚠️ אין כאן בדיקת חפיפה ידנית לפני ה-INSERT. ההגנה היא ה-EXCLUDE
-- constraint appointments_no_overlap מ-0001, שהוא היחיד שעמיד ב-race.
create or replace function public.create_manual_appointment(
  p_customer_id         uuid,
  p_service_key         text,
  p_variants            text[],
  p_price_total         integer,
  p_starts_at           timestamptz,
  p_duration_min        integer,
  p_policy_version      text,
  p_admin_id            uuid,
  p_client_request_id   uuid,
  p_payload_fingerprint text
)
returns jsonb
language plpgsql
as $$
declare
  v_claimed  boolean;
  v_prev     public.admin_idempotency;
  v_customer public.customers;
  v_row      public.appointments;
begin
  perform public.assert_crm_actor_is_admin(p_admin_id);

  if p_client_request_id is null then
    raise exception 'MISSING_REQUEST_ID' using errcode = '22023';
  end if;
  if p_payload_fingerprint is null or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'BAD_FINGERPRINT' using errcode = '22023';
  end if;

  insert into public.admin_idempotency
    (scope, actor_admin_id, client_request_id, payload_fingerprint)
  values
    ('appointment_create', p_admin_id, p_client_request_id, p_payload_fingerprint)
  on conflict do nothing
  returning true into v_claimed;

  if v_claimed is null then
    select * into v_prev
    from public.admin_idempotency
    where scope = 'appointment_create'
      and actor_admin_id = p_admin_id
      and client_request_id = p_client_request_id;

    if v_prev.payload_fingerprint <> p_payload_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    if v_prev.result_code is null then
      raise exception 'IDEMPOTENCY_INCOMPLETE' using errcode = 'P0104';
    end if;

    -- retry שהגיע במקביל לבקשה שכבר יצרה: אותו תור, בלי INSERT נוסף
    -- ובלי appointment_history נוספת.
    return jsonb_build_object(
      'result',         v_prev.result_code,
      'appointment_id', v_prev.target_id,
      'replayed',       true
    );
  end if;

  -- ── הלקוחה ─────────────────────────────────────────────────────────────
  select * into v_customer from public.customers where id = p_customer_id;
  if v_customer.id is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- חשבון מנהל אינו לקוחה. שובל ורפאל מוחרגות מה-CRM, ואסור שייקבע להן תור.
  if v_customer.auth_user_id is not null
     and exists (select 1 from public.admins a where a.user_id = v_customer.auth_user_id) then
    raise exception 'CUSTOMER_IS_ADMIN' using errcode = '42501';
  end if;

  -- ── המועד ──────────────────────────────────────────────────────────────
  -- חריגה משעות הפעילות מותרת למנהלת (זו כל הנקודה בתור ידני), אבל מועד
  -- בעבר אינו חריגה ניהולית — הוא טעות.
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'START_IN_PAST' using errcode = '22023';
  end if;
  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 480 then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  -- ── היצירה ─────────────────────────────────────────────────────────────
  -- ends_at נכתב ע"י הטריגר set_appointment_end ולכן אינו נשלח כאן.
  insert into public.appointments (
    customer_id, service_key, variants, price_total,
    starts_at, duration_min, status,
    pending_expires_at, original_starts_at, reschedule_count, has_deposit,
    calendar_sync_status, calendar_sync_operation, policy_version
  ) values (
    p_customer_id, p_service_key, coalesce(p_variants, '{}'), p_price_total,
    p_starts_at, p_duration_min, 'confirmed',
    null, null, 0, false,
    'pending', 'upsert', p_policy_version
  )
  returning * into v_row;

  -- שורת היסטוריה **אחת**. retry לא מגיע לכאן בכלל (הוא נעצר למעלה).
  insert into public.appointment_history (
    appointment_id, action, from_status, to_status, to_starts_at,
    actor, actor_id, source
  ) values (
    v_row.id, 'created', null, 'confirmed', v_row.starts_at,
    'admin', p_admin_id, 'admin_dashboard'
  );

  update public.admin_idempotency
  set result_code = 'appointment_created', target_id = v_row.id
  where scope = 'appointment_create'
    and actor_admin_id = p_admin_id
    and client_request_id = p_client_request_id;

  return jsonb_build_object(
    'result',         'appointment_created',
    'appointment_id', v_row.id,
    'starts_at',      v_row.starts_at,
    'ends_at',        v_row.ends_at,
    'replayed',       false
  );
end;
$$;


-- ============================================================================
-- חלק 6 — עדכון ה-CRM למודל החדש
--
-- שתי הפונקציות מוחלפות (create or replace) ולא משוכתבות ב-0009 — 0009
-- כבר רצה בפרודקשן ואין לגעת בה.
--
-- שני שינויים בלבד בכל אחת:
--   1. החרגת המנהלות עוברת מ-c.id ל-c.auth_user_id. בלי זה, שובל ורפאל היו
--      חוזרות להופיע כלקוחות ברגע שהמזהה העסקי שלהן מפסיק להיות ה-auth id.
--   2. has_login_account — האינדיקציה שהייתה קשיחה ב-UI הופכת לאמיתית.
--      auth_user_id עצמו לא נחשף; רק הבוליאני.
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
                                         'returning','no_show','cancelled')
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
      -- ההחרגה היא מול טבלת admins בפועל, דרך הקישור החדש — לא לפי טלפון
      -- ולא לפי UUID קשיח. לקוחה ידנית (auth_user_id IS NULL) לעולם אינה
      -- מנהלת, ולכן היא נכללת כרגיל.
      not (c.auth_user_id is not null
           and exists (select 1 from public.admins ad where ad.user_id = c.auth_user_id))
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


create or replace function public.get_crm_customer(p_customer_id uuid)
returns jsonb
language sql
stable
as $$
  select to_jsonb(x) from (
    select
      c.id, c.full_name, c.phone_e164, c.created_at,
      (c.auth_user_id is not null)      as has_login_account,
      coalesce(p.crm_status, 'active')  as crm_status,
      p.crm_status_changed_at,
      coalesce(p.source_key, 'unknown') as source_key,
      p.source_changed_at,
      m.completed_count, m.no_show_count,
      m.cancelled_by_customer_count, m.cancelled_by_business_count,
      m.active_pending_count, m.self_reschedule_total, m.all_reschedule_events,
      m.first_completed_at, m.last_completed_at,
      m.next_confirmed_starts_at, m.next_confirmed_service_key, m.next_confirmed_variants,
      m.open_notes_count, m.last_activity_at
    from public.customers c
    left join public.customer_crm_profiles p on p.customer_id = c.id
    join      public.customer_crm_metrics  m on m.customer_id = c.id
    where c.id = p_customer_id
      and not (c.auth_user_id is not null
               and exists (select 1 from public.admins ad where ad.user_id = c.auth_user_id))
  ) x;
$$;


-- ============================================================================
-- חלק 7 — אינדקסים
--
-- ⚠️ אין כאן אף אינדקס חדש, וזו החלטה ולא השמטה.
--
--   • customers.auth_user_id — ה-UNIQUE constraint שנוסף בחלק 1 יוצר אינדקס
--     btree מאחורי הקלעים, וזה בדיוק האינדקס שכל ה-policies החדשות ו-
--     getCurrentCustomerId משתמשים בו (חיפוש שוויון על עמודה ייחודית).
--     אינדקס נוסף היה כפילות.
--   • customers.phone_e164 — כבר UNIQUE מ-0001.
--   • admin_idempotency — ה-PK המורכב (scope, actor_admin_id,
--     client_request_id) הוא בדיוק המפתח שנשאל בכל lookup.
--   • חיפוש לקוחות — כבר טופל בשלב 9; אין pg_trgm בשלב הזה.
-- ============================================================================


-- ============================================================================
-- חלק 8 — הרשאות
--
-- PostgREST חושף כל פונקציה ב-public כ-RPC לכל תפקיד כברירת מחדל. שלוש
-- הפונקציות החדשות מקבלות customer_id / admin_id כפרמטרים וסומכות על כך
-- שהקורא כבר אימת session והרשאה — service_role בלבד.
--
-- שתי הפונקציות המוחלפות: CREATE OR REPLACE משמר ACL קיים, אבל ההרשאות
-- נרשמות כאן שוב במפורש כדי שהקובץ הזה יתאר את המצב המלא בעצמו ולא
-- יסתמך על מה ש-0009 עשתה.
-- ============================================================================

revoke execute on function public.link_or_create_customer_for_auth(uuid,text,text)                                       from public, anon, authenticated;
revoke execute on function public.create_manual_customer(text,text,text,text,uuid,uuid,text)                             from public, anon, authenticated;
revoke execute on function public.create_manual_appointment(uuid,text,text[],integer,timestamptz,integer,text,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.list_crm_customers(text,text,text,text,timestamptz,timestamptz,integer,integer)        from public, anon, authenticated;
revoke execute on function public.get_crm_customer(uuid)                                                                 from public, anon, authenticated;

grant execute on function public.link_or_create_customer_for_auth(uuid,text,text)                                        to service_role;
grant execute on function public.create_manual_customer(text,text,text,text,uuid,uuid,text)                              to service_role;
grant execute on function public.create_manual_appointment(uuid,text,text[],integer,timestamptz,integer,text,uuid,uuid,text)  to service_role;
grant execute on function public.list_crm_customers(text,text,text,text,timestamptz,timestamptz,integer,integer)         to service_role;
grant execute on function public.get_crm_customer(uuid)                                                                  to service_role;


-- ============================================================================
-- חלק 9 — assertions
--
-- המיגרציה חייבת ליפול אם משהו כאן לא התקיים בפועל. מיגרציה שמדווחת
-- Success על סכמה שגויה גרועה ממיגרציה שנכשלת.
-- ============================================================================

-- ─── הרשאות ה-RPCs ─────────────────────────────────────────────────────────
do $$
declare
  v_fn  text;
  v_fns text[] := array[
    'public.link_or_create_customer_for_auth(uuid, text, text)',
    'public.create_manual_customer(text, text, text, text, uuid, uuid, text)',
    'public.create_manual_appointment(uuid, text, text[], integer, timestamptz, integer, text, uuid, uuid, text)',
    'public.list_crm_customers(text, text, text, text, timestamptz, timestamptz, integer, integer)',
    'public.get_crm_customer(uuid)'
  ];
begin
  foreach v_fn in array v_fns loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0010: % עדיין פתוחה ל-anon', v_fn using errcode = 'P0102';
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0010: % עדיין פתוחה ל-authenticated', v_fn using errcode = 'P0102';
    end if;
    -- הכיוון ההפוך: ההרשאה שאנחנו דווקא *רוצים* לשמר
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0010: % אינה זמינה ל-service_role', v_fn using errcode = 'P0102';
    end if;
  end loop;
end $$;


-- ─── הסכמה החדשה ───────────────────────────────────────────────────────────
do $$
declare
  v_count  integer;
  v_delact char;
begin
  -- העמודה קיימת
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'auth_user_id'
  ) then
    raise exception '0010: customers.auth_user_id אינה קיימת' using errcode = 'P0104';
  end if;

  -- ה-FK הישן מ-customers.id ל-auth.users אינו קיים יותר
  select count(*) into v_count
  from pg_constraint con
  join pg_class rel     on rel.oid  = con.conrelid
  join pg_class frel    on frel.oid = con.confrelid
  join pg_namespace n   on n.oid    = rel.relnamespace
  join pg_namespace fn  on fn.oid   = frel.relnamespace
  where con.contype = 'f'
    and n.nspname = 'public'  and rel.relname  = 'customers'
    and fn.nspname = 'auth'   and frel.relname = 'users'
    and con.conkey = array[(select attnum from pg_attribute
                            where attrelid = 'public.customers'::regclass and attname = 'id')];
  if v_count <> 0 then
    raise exception '0010: ה-FK הישן customers.id→auth.users עדיין קיים (% נמצאו)', v_count
      using errcode = 'P0104';
  end if;

  -- ה-FK החדש קיים והוא ON DELETE SET NULL ('n')
  select con.confdeltype into v_delact
  from pg_constraint con
  join pg_class rel   on rel.oid = con.conrelid
  join pg_namespace n on n.oid   = rel.relnamespace
  where con.contype = 'f'
    and n.nspname = 'public' and rel.relname = 'customers'
    and con.conkey = array[(select attnum from pg_attribute
                            where attrelid = 'public.customers'::regclass and attname = 'auth_user_id')];
  if v_delact is null then
    raise exception '0010: אין FK על customers.auth_user_id' using errcode = 'P0104';
  end if;
  if v_delact <> 'n' then
    raise exception '0010: ה-FK של auth_user_id אינו ON DELETE SET NULL (confdeltype=%)', v_delact
      using errcode = 'P0104';
  end if;

  -- auth_user_id ייחודי
  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel   on rel.oid = con.conrelid
    join pg_namespace n on n.oid   = rel.relnamespace
    where con.contype in ('u', 'p')
      and n.nspname = 'public' and rel.relname = 'customers'
      and con.conkey = array[(select attnum from pg_attribute
                              where attrelid = 'public.customers'::regclass and attname = 'auth_user_id')]
  ) then
    raise exception '0010: auth_user_id אינו UNIQUE' using errcode = 'P0104';
  end if;

  -- ── ה-backfill ─────────────────────────────────────────────────────────
  -- ⚠️ ה-assertion **אינה** דורשת ש-auth_user_id יהיה מלא בכל השורות:
  -- לקוחה ידנית אמורה להישאר NULL, וזו כל מטרת השלב. מה שכן חייב להתקיים
  -- הוא שאף שורה במבנה הישן (כזו שיש auth user עם אותו id) לא פוספסה.
  select count(*) into v_count
  from public.customers c
  join auth.users u on u.id = c.id
  where c.auth_user_id is distinct from c.id;
  if v_count <> 0 then
    raise exception '0010: % שורות customers במבנה הישן לא קיבלו auth_user_id תקין', v_count
      using errcode = 'P0104';
  end if;

  -- שתי לקוחות לא יכולות לחלוק auth_user_id (נגזר מה-UNIQUE, נבדק ישירות)
  select count(*) into v_count from (
    select auth_user_id from public.customers
    where auth_user_id is not null
    group by auth_user_id having count(*) > 1
  ) d;
  if v_count <> 0 then
    raise exception '0010: קיימים auth_user_id כפולים ב-customers' using errcode = 'P0104';
  end if;

  -- ── ה-policies ─────────────────────────────────────────────────────────
  -- אף policy על שלוש הטבלאות אינה משווה עוד id/customer_id ל-auth.uid()
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('customers', 'appointments', 'appointment_history')
    and (
      coalesce(qual, '')       ~ '\m(id|customer_id)\M\s*=\s*auth\.uid\(\)'
      or coalesce(with_check, '') ~ '\m(id|customer_id)\M\s*=\s*auth\.uid\(\)'
    );
  if v_count <> 0 then
    raise exception '0010: % policies עדיין מסתמכות על id = auth.uid()', v_count
      using errcode = 'P0104';
  end if;

  -- שלוש ה-policies החדשות קיימות ומזכירות auth_user_id
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and policyname in ('customers_select_own', 'appointments_select_own',
                       'appointment_history_select_own')
    and coalesce(qual, '') like '%auth_user_id%';
  if v_count <> 3 then
    raise exception '0010: ציפינו ל-3 policies מבוססות auth_user_id, נמצאו %', v_count
      using errcode = 'P0104';
  end if;

  -- customers_update_own הוסרה, ואין UPDATE ל-anon/authenticated
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'customers'
      and policyname = 'customers_update_own'
  ) then
    raise exception '0010: customers_update_own עדיין קיימת' using errcode = 'P0104';
  end if;

  if has_table_privilege('authenticated', 'public.customers', 'update')
     or has_table_privilege('anon', 'public.customers', 'update') then
    raise exception '0010: עדיין קיימת הרשאת UPDATE על customers ל-anon/authenticated'
      using errcode = 'P0102';
  end if;

  -- ── admin_idempotency ──────────────────────────────────────────────────
  if not exists (
    select 1 from pg_class rel
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'admin_idempotency' and rel.relrowsecurity
  ) then
    raise exception '0010: RLS אינו מופעל על admin_idempotency' using errcode = 'P0102';
  end if;

  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename = 'admin_idempotency';
  if v_count <> 0 then
    raise exception '0010: admin_idempotency אינה אמורה להחזיק policies (נמצאו %)', v_count
      using errcode = 'P0102';
  end if;

  for v_count in
    select 1 where has_table_privilege('anon', 'public.admin_idempotency', 'select')
                or has_table_privilege('authenticated', 'public.admin_idempotency', 'select')
                or has_table_privilege('anon', 'public.admin_idempotency', 'insert')
                or has_table_privilege('authenticated', 'public.admin_idempotency', 'insert')
  loop
    raise exception '0010: admin_idempotency נגישה ל-anon/authenticated' using errcode = 'P0102';
  end loop;

  -- ── customer_created ───────────────────────────────────────────────────
  if not exists (
    select 1 from pg_constraint con
    join pg_class rel   on rel.oid = con.conrelid
    join pg_namespace n on n.oid   = rel.relnamespace
    where con.contype = 'c' and n.nspname = 'public'
      and rel.relname = 'customer_crm_activity'
      and pg_get_constraintdef(con.oid) like '%customer_created%'
  ) then
    raise exception '0010: customer_created אינו מותר ב-customer_crm_activity.action'
      using errcode = 'P0104';
  end if;

  -- ── המנהלות ────────────────────────────────────────────────────────────
  -- אין כאן assertion על מספר המנהלות: המיגרציה רצה גם ב-PGlite על סכמה
  -- ריקה. השמירה על "בדיוק שתיים" נבדקת בבדיקות החיות.
end $$;
