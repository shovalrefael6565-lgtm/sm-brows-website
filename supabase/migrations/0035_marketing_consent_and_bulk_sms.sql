-- ============================================================================
-- 0035 — הסכמת דיוור, הסרה מדיוור, וקמפיין SMS ללקוחות
--
-- מיישמת את מה שאושר ב-audit, ורק אותו:
--
--   1. הסכמת דיוור על customers — נפרדת לחלוטין מהסכמת הפרטיות ומהודעות
--      השירות, עם מקור מוגבל ועם עדות מי ומתי.
--   2. הסרה מדיוור: חותם (hash) של token אקראי, ותאריך הסרה.
--   3. sms_campaigns + sms_campaign_recipients — לוג הקמפיינים והמניעה
--      של שליחה כפולה.
--
-- ─── מה הקובץ הזה **אינו** עושה, במפורש ─────────────────────────────────────
--
--   • 🔴 **אינו מסמן אף לקוחה כמסכימה.** marketing_consent הוא
--     `not null default false`, ואין כאן UPDATE, אין backfill ואין ערך
--     נגזר מ-privacy_notice_acknowledged_at. הודעת הפרטיות שהלקוחות אישרו
--     מדברת על "הודעות שירות" בלבד, והיא אינה הסכמה לדיוור. חלק 6 מוודא
--     בפועל שאחרי המיגרציה אין ולו לקוחה אחת עם consent=true.
--   • אינו נוגע ב-appointment_reminders, ב-appointment_notifications ובשום
--     מסלול SMS תפעולי. הסרה מדיוור אינה יכולה לעצור תזכורת, ביטול או
--     שינוי מועד — הם אינם קוראים אף אחת מהעמודות שכאן.
--   • אינו מוסיף RPC. השליחה נשענת על שני מנגנונים שה-DB כבר אוכף בעצמו:
--     `unique (campaign_id, phone_hash)` שמונע נמען כפול, ו-UPDATE מותנה
--     ב-`status='pending'` שמונע עיבוד כפול. אין כאן מכונת מצבים חדשה.
--   • אינו נוגע ב-admin_idempotency. מניעת הגשה כפולה של קמפיין יושבת על
--     `sms_campaigns.client_request_id` ייעודי, כדי לא להרחיב CHECK של
--     טבלה ששני מסלולים עובדים כבר תלויים בה.
--   • אינו מפעיל את 019 ואינו שולח דבר.
--
-- ─── PHASE 1 מול PHASE 2 ────────────────────────────────────────────────────
--
-- עמודות ההסכמה נוצרות כאן כ**הכנה ל-PHASE 2**, ולא כשער של PHASE 1.
--
--   PHASE 1 — המנהלת בוחרת לקוחות ידנית מתוך המאגר.
--             `marketing_consent = false` **אינו** פוסל לקוחה מבחירה או
--             משליחה. אין כאן טריגר, FK או CHECK שקושר נמען להסכמה, ומסלול
--             השליחה אינו נשען על customers_marketing_eligible_idx.
--   PHASE 2 — checkbox בהזמנת התור, סטטוס ההסכמה ב-CRM, וסינון זכאות לפיו.
--             אז, ורק אז, האינדקס הזה הופך לשער.
--
-- 🔴 ההבחנה שכן נאכפת כבר ב-PHASE 1: **הסרה מדיוור חוסמת**. לקוחה שלחצה
-- "הסרה" לא תקבל דיוור נוסף, גם אם נבחרה ידנית. חוסר הסכמה אינו חסימה;
-- בקשת הסרה מפורשת כן. שתי השאלות נפרדות ונשמרות בשתי עמודות נפרדות.
-- ============================================================================


-- ============================================================================
-- חלק 1 — הסכמת דיוור והסרה ממנו, על customers
--
-- ⚠️ ההפרדה היא העיקר: `marketing_consent` אינו נגזר משום עמודה קיימת ואינו
-- משפיע על אף מסלול קיים. הסכמת הפרטיות (privacy_notice_* על appointments)
-- מתעדת שהלקוחה קראה הודעה שמדברת על הודעות שירות; היא אינה הסכמה לדיוור,
-- ולכן אין ביניהן שום קשר בסכמה.
--
-- ⚠️ `marketing_opted_out_at` **גובר תמיד** על `marketing_consent`. שדה
-- ההסכמה לא נמחק בהסרה, כדי שיישאר תיעוד ששניהם קרו ומתי. הזכאות מוגדרת
-- כאיחוד של שני התנאים, ולא כערך יחיד — ראה האינדקס בסוף החלק.
-- ============================================================================

alter table public.customers
  add column if not exists marketing_consent            boolean not null default false,
  add column if not exists marketing_consent_at         timestamptz,
  add column if not exists marketing_consent_source     text,
  add column if not exists marketing_consent_by         uuid references auth.users(id) on delete set null,
  add column if not exists marketing_opted_out_at       timestamptz,
  add column if not exists marketing_opt_out_token_hash text,
  -- ⚠️ גרסת הסוד שממנה נגזר החותם השמור. הכרחית כדי שסיבוב סוד עתידי
  -- (V2) לא יהרוג קישורי הסרה קיימים: לקוחה שכבר יש לה חותם V1 תמשיך
  -- לקבל קישורי V1, כי החותם **נכתב פעם אחת ולעולם אינו נדרס**. לקוחה
  -- חדשה תקבל V2. בלי העמודה הזו אין דרך לדעת באיזה סוד להשתמש.
  add column if not exists marketing_opt_out_token_version smallint;

do $$
begin
  -- מקור ההסכמה — רשימה סגורה. NULL מותר כל עוד אין הסכמה.
  --   booking_form   — checkbox נפרד ולא מסומן מראש בטופס ההזמנה.
  --   admin_recorded — המנהלת תיעדה הסכמה שניתנה מחוץ לאתר, בפעולה מפורשת.
  --   sms_optin      — הלקוחה אישרה דרך הודעה (שמור לעתיד; אין לו עדיין מסלול).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname  = 'customers_marketing_consent_source_check'
  ) then
    alter table public.customers
      add constraint customers_marketing_consent_source_check
      check (marketing_consent_source is null
             or marketing_consent_source in ('booking_form', 'admin_recorded', 'sms_optin'));
  end if;

  -- 🔒 אין הסכמה בלי עדות. consent=true מחייב **מתי** ו**מאיזה מקור**.
  -- זה מה שהופך את העמודה לבסיס חוקי ולא לדגל שאפשר להדליק בשקט.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname  = 'customers_marketing_consent_evidence'
  ) then
    alter table public.customers
      add constraint customers_marketing_consent_evidence
      check (marketing_consent = false
             or (marketing_consent_at is not null and marketing_consent_source is not null));
  end if;

  -- ⚠️ חד-כיווני במכוון, בדיוק כמו customers_retention_hold_pair ב-0032:
  -- אפשר "מתי" בלי "מי" (הסכמה מטופס ההזמנה אין לה מנהלת; ומנהלת שנמחקת
  -- מ-auth.users מאפסת את השדה ל-NULL ב-on delete set null) — אבל לעולם
  -- לא "מי" בלי "מתי".
  --
  -- 🔴 מה שבמכוון **אינו** נאכף כאן: הדרישה ש-admin_recorded יישא תמיד
  -- marketing_consent_by. היא נכונה בזמן הכתיבה ותיאכף ב-route, אבל
  -- כ-CHECK קבוע היא הייתה חוסמת את מחיקת המנהלת מ-auth.users — ה-FK היה
  -- מנסה לאפס את השדה וה-CHECK היה מסרב. אותה מלכודת מתוארת ב-0032.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname  = 'customers_marketing_consent_actor_pair'
  ) then
    alter table public.customers
      add constraint customers_marketing_consent_actor_pair
      check (marketing_consent_by is null or marketing_consent_at is not null);
  end if;

  -- 🔒 חותם בלבד. ה-token עצמו נוצר בשרת, נכנס אל תוך ההודעה ולעולם אינו
  -- נשמר — לא כאן, לא בלוג ולא בתשובת ה-API. SHA-256 בהקסה, בדיוק כמו
  -- payload_fingerprint ב-0010 וכמו phone_hash בחלק 4.
  --
  -- ─── מבנה ה-token (נגזר בשרת, מתועד כאן כי הסכמה תלויה בו) ──────────────
  --
  --   token = base64url( HMAC-SHA256(MARKETING_OPT_OUT_SECRET_V1, customer_id) )
  --           חתוך ל-16 בתים = 128 סיביות = 22 תווי base64url.
  --
  -- 128 סיביות אנטרופיה מסוד ייעודי: לא ניתן לניחוש ולא ניתן לגזירה ממזהה
  -- הלקוחה בלי הסוד. ה-URL הוא /u/<token> ואינו נושא טלפון או customer id.
  --
  -- ⚠️ דטרמיניסטי ולכן **יציב**: אותה לקוחה מקבלת אותו token בכל קמפיין,
  -- וקישור הסרה מהודעה ישנה ממשיך לעבוד לנצח.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname  = 'customers_marketing_opt_out_token_hash_check'
  ) then
    alter table public.customers
      add constraint customers_marketing_opt_out_token_hash_check
      check (marketing_opt_out_token_hash is null
             or marketing_opt_out_token_hash ~ '^[0-9a-f]{64}$');
  end if;

  -- חותם וגרסה הם זוג: אין אחד בלי השני, ואין גרסה שאינה מוכרת.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname  = 'customers_marketing_opt_out_token_pair'
  ) then
    alter table public.customers
      add constraint customers_marketing_opt_out_token_pair
      check ((marketing_opt_out_token_hash is null) = (marketing_opt_out_token_version is null)
             and (marketing_opt_out_token_version is null or marketing_opt_out_token_version >= 1));
  end if;
end $$;

-- ⚠️ unique חלקי: החותם הוא מפתח החיפוש של עמוד ההסרה (/u/<token>), וחייב
-- להצביע על לקוחה אחת לכל היותר. NULL אינו ייחודי ולכן רוב הלקוחות פטורות.
create unique index if not exists customers_marketing_opt_out_token_hash_idx
  on public.customers (marketing_opt_out_token_hash)
  where marketing_opt_out_token_hash is not null;

-- ⚠️ **הכנה ל-PHASE 2 בלבד.** הקבוצה הזכאית לפי הסכמה, כהגדרה אחת שאי אפשר
-- לסטות ממנה בשאילתה מזדמנת. ב-PHASE 1 האינדקס קיים ואינו בשימוש: מסלול
-- השליחה אינו פוסל לקוחה בגלל marketing_consent=false.
create index if not exists customers_marketing_eligible_idx
  on public.customers (id)
  where marketing_consent
    and marketing_opted_out_at is null
    and archived_at is null
    and is_blocked = false;


-- ============================================================================
-- חלק 2 — שלוש פעולות אודיט חדשות ב-customer_crm_activity
--
-- אותו דפוס בדיוק כמו 0010/0028/0032: איתור ה-CHECK לפי תוכן ולא לפי שם
-- מנוחש, ורשימה מלאה (איחוד כל הערכים הקודמים + החדשים) ולא רק ה-diff.
--
-- ⚠️ old_value/new_value נשארים 'true'/'false' או שם המקור — אין כאן ערוץ
-- טקסט חופשי חדש, ואין טלפון ואין תוכן הודעה.
-- ============================================================================

do $$
declare
  v_names text[];
begin
  select array_agg(conname) into v_names
  from pg_constraint
  where conrelid = 'public.customer_crm_activity'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%crm_status_changed%';

  if v_names is null or array_length(v_names, 1) <> 1 then
    raise exception
      '0035: לא נמצא בדיוק CHECK אחד על customer_crm_activity.action (נמצאו %). יש לבדוק ידנית.',
      coalesce(array_length(v_names, 1), 0)
      using errcode = 'P0103';
  end if;

  execute format('alter table public.customer_crm_activity drop constraint %I', v_names[1]);

  alter table public.customer_crm_activity
    add constraint customer_crm_activity_action_check
    check (action in (
      'crm_status_changed',
      'source_changed',
      'note_created',
      'note_updated',
      'note_archived',
      'customer_created',
      'name_updated',
      'phone_updated',
      'archived',
      'unarchived',
      -- ── 9B ──
      'retention_hold_changed',
      -- ── 0035 ──
      'marketing_consent_granted',   -- ניתנה הסכמה (טופס או תיעוד מנהלת)
      'marketing_consent_revoked',   -- המנהלת ביטלה תיעוד הסכמה
      'marketing_opted_out'          -- הלקוחה הסירה את עצמה דרך /u/<token>
    ));
end $$;


-- ============================================================================
-- חלק 3 — sms_campaigns
--
-- ⚠️ `created_by` הוא nullable ו-`on delete set null`: מחיקת חשבון מנהלת
-- בעתיד לא תיחסם בגלל היסטוריית קמפיינים. `created_at` נשאר תמיד, ולכן
-- גם כשה"מי" מתאפס ה"מתי" והתוכן נשמרים — אותו כלל של 0032.
--
-- ⚠️ `client_request_id` — הגנה מפני הגשה כפולה. unique על העמודה **לבדה**
-- ולא על (created_by, client_request_id): מרגע ש-created_by יכול להתאפס
-- ל-NULL, מפתח מורכב שכולל אותו מפסיק להיות ייחודי בדיוק בשורות שהתאפסו
-- (NULL אינו שווה ל-NULL). המזהה הוא UUID v4 מהדפדפן, כלומר ייחודי גלובלית
-- בפני עצמו, ולכן unique יחיד הוא גם פשוט יותר וגם חזק יותר.
-- **אינו** ב-admin_idempotency במכוון: הרחבת ה-CHECK של scope/result_code
-- שם הייתה נוגעת בטבלה ששני מסלולים עובדים (יצירת לקוחה ויצירת תור)
-- תלויים בה.
--
-- ═══ `body` הוא התבנית, לא ההודעה ═══════════════════════════════════════
--
-- 🔴 `body` הוא **טקסט הקמפיין שהמנהלת הקלידה**, ולא הטקסט שיצא לנמענת.
-- לכל נמענת יש קישור הסרה משלה, ולכן ה-SMS הסופי שונה בין נמענת לנמענת:
--
--   final = זיהוי העסק + body + קישור ההסרה של אותה לקוחה
--
-- ⚠️ `segments` נספר על ה-**final** ולא על body: ה-token באורך קבוע (22
-- תווי base64url), וזיהוי העסק קבוע, ולכן האורך הסופי זהה לכל הנמענות
-- וניתן לחישוב דטרמיניסטי בזמן היצירה. אותו חישוב מזין את המונה ואת
-- ה-preview במסך — אין מסך שמראה מספר אחד ושליחה שמייצרת אחר.
-- ============================================================================

create table if not exists public.sms_campaigns (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  -- ⚠️ nullable: מחיקת מנהלת מאפסת את השדה ואינה נחסמת, ואינה מוחקת
  -- את הקמפיין.
  created_by        uuid references auth.users(id) on delete set null,
  client_request_id uuid not null,

  -- טקסט הקמפיין כפי שהוקלד. אינו ההודעה הסופית — ראה ההערה למעלה.
  body              text not null check (length(body) between 1 and 1005),
  -- יחידות ה-SMS של ה-**הודעה הסופית** (זיהוי + body + קישור הסרה),
  -- כפי שחושבו בשרת בזמן היצירה.
  segments          integer not null check (segments between 1 and 15),
  provider          text not null check (length(provider) between 1 and 32),

  status            text not null default 'draft'
                    check (status in ('draft', 'sending', 'completed', 'failed')),

  recipient_count   integer not null default 0 check (recipient_count >= 0),
  sent_count        integer not null default 0 check (sent_count >= 0),
  failed_count      integer not null default 0 check (failed_count >= 0),
  skipped_count     integer not null default 0 check (skipped_count >= 0),

  started_at        timestamptz,
  completed_at      timestamptz,

  constraint sms_campaigns_request_unique unique (client_request_id)
);

create index if not exists sms_campaigns_created_at_idx
  on public.sms_campaigns (created_at desc);


-- ============================================================================
-- חלק 4 — sms_campaign_recipients
--
-- 🔒 **זו השורה שמונעת שליחה כפולה:** `unique (campaign_id, phone_hash)`.
-- הטלפון מנורמל ל-E.164 בשרת (lib/phone.ts) **לפני** החישוב, ולכן
-- '0521234567' ו-'+972521234567' מייצרים את אותו חותם ואת אותה שורה. ניסיון
-- שני לשלוח לאותו מספר באותו קמפיין נופל על האינדקס, לא על תנאי בקוד.
--
-- 🔒 **אין כאן מספר טלפון.** phone_hash הוא SHA-256 עם pepper מהסביבה, והוא
-- משמש רק כמפתח השוואה. מי שצריכה לדעת למי נשלח עוברת דרך customer_id
-- ולכרטיס הלקוחה — הלוג עצמו אינו נושא PII.
--
-- ⚠️ `customer_id` הוא `on delete set null`: מחיקת לקוחה אינה מוחקת את
-- ההיסטוריה ואינה משנה את המונים של קמפיין שכבר יצא.
--
-- 🔴 **מספר שהשתנה בין היצירה לשליחה.** phone_hash מוקפא בזמן בניית
-- הרשימה. לפני כל שליחה — כולל retry — החותם מחושב **מחדש** מהמספר הנוכחי
-- של הלקוחה ומושווה לחותם השמור. אם הם אינם זהים, המספר שונה מאז, ואז:
-- לא שולחים, `status='skipped'`, `skip_reason='phone_changed'`. ההודעה
-- **אינה** נשלחת אוטומטית למספר החדש — קמפיין שאושר על רשימה מסוימת לא
-- יזלוג למספר שאיש לא אישר. אם המנהלת רוצה לפנות למספר החדש, זה קמפיין
-- חדש עם רשימה חדשה.
--
-- ⚠️ `error_code` הוא קוד מקוטלג ולא הודעה חופשית מהספק, באותו כלל שכבר
-- נאכף ב-0011/0025: גוף התשובה הגולמי של 019 לעולם אינו נשמר.
-- ============================================================================

create table if not exists public.sms_campaign_recipients (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.sms_campaigns(id) on delete cascade,
  customer_id         uuid references public.customers(id) on delete set null,

  phone_hash          text not null check (phone_hash ~ '^[0-9a-f]{64}$'),

  status              text not null default 'pending'
                      check (status in ('pending', 'sent', 'failed', 'skipped')),
  -- מדוע דולגה — קטגוריה סגורה, לא טקסט חופשי.
  --   no_consent      — PHASE 2 בלבד. ב-PHASE 1 אינו נוצר.
  --   opted_out       — הלקוחה הסירה את עצמה. חוסם כבר ב-PHASE 1.
  --   archived        — הכרטיס בארכיון.
  --   blocked         — is_blocked.
  --   duplicate_phone — אותו מספר כבר ברשימת הקמפיין.
  --   invalid_phone   — המספר אינו עובר נירמול ל-E.164 תקין.
  --   phone_changed   — ראה ההערה על phone_hash למטה.
  skip_reason         text check (skip_reason is null or skip_reason in (
                        'no_consent', 'opted_out', 'archived', 'blocked',
                        'duplicate_phone', 'invalid_phone', 'phone_changed'
                      )),

  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 128),
  error_code          text check (error_code is null or length(error_code) <= 64),
  attempted_at        timestamptz,
  created_at          timestamptz not null default now(),

  constraint sms_campaign_recipients_no_duplicate unique (campaign_id, phone_hash)
);

-- התור לעיבוד: רק מה שעדיין ממתין, לכל קמפיין.
create index if not exists sms_campaign_recipients_pending_idx
  on public.sms_campaign_recipients (campaign_id)
  where status = 'pending';

create index if not exists sms_campaign_recipients_customer_idx
  on public.sms_campaign_recipients (customer_id);


-- ============================================================================
-- חלק 5 — הרשאות
--
-- ⚠️ RLS מופעל ו**אין policies**: service_role עוקף RLS, וכל השאר אינם
-- מקבלים דבר. עמוד ההסרה (/u/<token>) עובד ללא התחברות — הוא route בשרת
-- שרץ עם service_role, ולכן אינו זקוק ל-policy ל-anon. אין כאן שום פתח
-- קריאה ציבורי לקמפיינים או לנמענים.
-- ============================================================================

alter table public.sms_campaigns           enable row level security;
alter table public.sms_campaign_recipients enable row level security;

revoke all on public.sms_campaigns           from anon, authenticated;
revoke all on public.sms_campaign_recipients from anon, authenticated;

grant select, insert, update, delete on public.sms_campaigns           to service_role;
grant select, insert, update, delete on public.sms_campaign_recipients to service_role;


-- ============================================================================
-- חלק 6 — אימות
--
-- נכשל בקול אם משהו מההנחות אינו מתקיים, כולל ההנחה החשובה מכולן:
-- שאיש לא סומן כמסכים לדיוור.
-- ============================================================================

do $$
declare
  v_consenting integer;
  v_leaked     integer;
begin
  -- 🔴 סימון רטרואקטיבי — הדבר היחיד שאסור שיקרה כאן.
  select count(*) into v_consenting from public.customers where marketing_consent;
  if v_consenting > 0 then
    raise exception
      '0035: % לקוחות סומנו כמסכימות לדיוור מיד לאחר המיגרציה. סימון רטרואקטיבי אסור.',
      v_consenting
      using errcode = 'P0103';
  end if;

  if exists (select 1 from public.customers
             where marketing_consent_at is not null
                or marketing_consent_source is not null
                or marketing_opted_out_at is not null
                or marketing_opt_out_token_hash is not null
                or marketing_opt_out_token_version is not null) then
    raise exception '0035: עמודות הדיוור אינן ריקות אחרי המיגרציה — בוצע backfill שלא היה אמור לקרות.'
      using errcode = 'P0103';
  end if;

  -- חמשת ה-CHECK של חלק 1
  if (select count(*) from pg_constraint
      where conrelid = 'public.customers'::regclass
        and conname in ('customers_marketing_consent_source_check',
                        'customers_marketing_consent_evidence',
                        'customers_marketing_consent_actor_pair',
                        'customers_marketing_opt_out_token_hash_check',
                        'customers_marketing_opt_out_token_pair')) <> 5 then
    raise exception '0035: חסר CHECK על עמודות הדיוור ב-customers.' using errcode = 'P0103';
  end if;

  -- 🔒 מחיקת מנהלת לא תיחסם: created_by nullable ו-on delete set null.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'sms_campaigns'
               and column_name = 'created_by' and is_nullable = 'NO') then
    raise exception '0035: sms_campaigns.created_by אינו nullable — מחיקת מנהלת תיחסם.'
      using errcode = 'P0103';
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.sms_campaigns'::regclass
                   and contype = 'f' and confrelid = 'auth.users'::regclass
                   and confdeltype = 'n') then   -- 'n' = SET NULL
    raise exception '0035: sms_campaigns.created_by אינו on delete set null.'
      using errcode = 'P0103';
  end if;

  -- 🔒 מניעת הגשה כפולה חייבת להיות על client_request_id לבדו: מפתח מורכב
  -- עם created_by מפסיק להיות ייחודי ברגע שהשדה מתאפס ל-NULL.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.sms_campaigns'::regclass
                   and conname = 'sms_campaigns_request_unique'
                   and contype = 'u'
                   and array_length(conkey, 1) = 1) then
    raise exception '0035: sms_campaigns_request_unique אינו על client_request_id לבדו.'
      using errcode = 'P0103';
  end if;

  -- שתי סיבות הדילוג החדשות חייבות להתקבל.
  if pg_get_constraintdef((
       select oid from pg_constraint
       where conrelid = 'public.sms_campaign_recipients'::regclass
         and contype = 'c' and pg_get_constraintdef(oid) like '%duplicate_phone%'
     )) not like '%phone_changed%' then
    raise exception '0035: skip_reason אינו מקבל phone_changed.' using errcode = 'P0103';
  end if;

  -- 🔒 שני האינדקסים שהשליחה נשענת עליהם
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                 and indexname = 'customers_marketing_opt_out_token_hash_idx') then
    raise exception '0035: חסר האינדקס הייחודי על חותם ה-token — עמוד ההסרה אינו יכול לזהות לקוחה.'
      using errcode = 'P0103';
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.sms_campaign_recipients'::regclass
                   and conname = 'sms_campaign_recipients_no_duplicate'
                   and contype = 'u') then
    raise exception '0035: חסר unique(campaign_id, phone_hash) — אין מה שמונע שליחה כפולה לאותו מספר.'
      using errcode = 'P0103';
  end if;

  -- 🔒 שתי הטבלאות סגורות לחלוטין בפני anon/authenticated
  select count(*) into v_leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('sms_campaigns', 'sms_campaign_recipients')
    and grantee in ('anon', 'authenticated');
  if v_leaked > 0 then
    raise exception '0035: ל-anon/authenticated יש % הרשאות על טבלאות הקמפיינים.', v_leaked
      using errcode = 'P0103';
  end if;

  -- 🔒 המסלול התפעולי לא נגוע: אף עמודת דיוור לא נכנסה לטבלאות שלו.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name in ('appointment_reminders', 'appointment_notifications')
               and column_name like 'marketing%') then
    raise exception '0035: עמודת דיוור נוספה לטבלת SMS תפעולי — ההפרדה נשברה.'
      using errcode = 'P0103';
  end if;

  raise notice '0035: עמודות הדיוור, חמשת ה-CHECK, שני האינדקסים, טבלאות הקמפיין, ההרשאות וההפרדה מהתפעולי — כולם תקינים. אף לקוחה לא סומנה כמסכימה, ומחיקת מנהלת אינה נחסמת.';
end $$;
