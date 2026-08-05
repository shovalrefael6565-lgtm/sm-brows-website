-- ============================================================================
-- 0008 — שלב 8: סנכרון נכנס מ-Google Calendar אל Supabase
--
-- תלוי ב-0001–0007 שכבר רצו. אין כאן שום ALTER/DROP על מה שנוצר שם, פרט
-- לעמודה אחת חדשה ו-nullable ב-appointment_history (source) ולאינדקס אחד
-- על appointments — שתי תוספות שאינן משנות שום התנהגות קיימת.
--
-- ⚠️ אין כאן ALTER TYPE ... ADD VALUE, ולכן — כמו ב-0005 ובניגוד ל-0002 —
-- אין צורך לפצל את הקובץ. כל הטיפוסים למטה הם CREATE TYPE חדשים, שמותר
-- להשתמש בהם מיד באותה טרנזקציה.
--
-- ─── מה השלב הזה מוסיף ────────────────────────────────────────────────────
--
-- עד היום הסנכרון היה חד-כיווני: Supabase → Google. מכאן ואילך, כששובל
-- מזיזה או מוחקת ידנית ביומן אירוע *שהמערכת יצרה*, השינוי חוזר ל-Supabase.
--
-- שלושה גבולות שאסור לשבור, והם מקודדים בפונקציות למטה ולא רק בקוד:
--
--   1. Supabase נשאר מקור האמת. Google רשאי להשפיע על שני דברים בלבד —
--      מועד ההתחלה של תור confirmed, וביטול מצד העסק. לא על הלקוחה, לא על
--      הטיפול, לא על המחיר, לא על המקדמה, ולא על duration_min.
--
--   2. אירוע ידני של שובל אינו מיובא לעולם. אין יצירת customer ואין יצירת
--      appointment מאירוע יומן. אירוע ידני גם לא משתנה ולא נמחק על ידינו —
--      הוא ממשיך לחסום זמינות דרך getBusyRanges כפי שעשה תמיד.
--
--   3. שינוי שהמערכת עצמה ביצעה ב-Google לא חוזר אליה כשינוי חדש. מניעת
--      הלולאה נשענת על ארבע שכבות בלתי תלויות (ראה calendar_change_queue).
--
-- ─── למה durable queue ולא עיבוד ישיר ─────────────────────────────────────
--
-- המודל הנאיבי — לקרוא שינויים מ-Google, לקדם את syncToken, ואז לנסות
-- לעדכן — מאבד שינוי בכל כשל שקורה אחרי קידום הטוקן: Google כבר לא יחזיר
-- אותו שוב לעולם. לכן הקריאה והעיבוד מופרדים לחלוטין: כל שינוי נשמר
-- ב-calendar_change_queue *באותה טרנזקציה* שבה ה-cursor מתקדם, והעיבוד
-- קורה אחר כך מתוך התור. ראה record_calendar_changes.
-- ============================================================================

-- ─── טיפוסים ────────────────────────────────────────────────────────────────
--
-- כל פרמטר מצב ב-RPC למטה הוא enum ולא text, כדי ש-Postgres עצמו ידחה ערך
-- לא חוקי (22P02) לפני שהוא נכנס לגוף הפונקציה. קורא עם service_role לא
-- יכול לשמור מצב שאינו קיים ע"י העברת מחרוזת שרירותית.

create type calendar_sync_mode as enum (
  'full',        -- סריקה מלאה, ללא syncToken
  'incremental'  -- מ-syncToken קיים
);

create type calendar_sync_run_status as enum ('running', 'success', 'failed');

create type calendar_queue_status as enum (
  'pending',     -- נשמר, ממתין לעיבוד
  'processing',  -- claim פעיל עם lease
  'processed',   -- טופל (סופי)
  'failed',      -- ניסיון נכשל; ניתן ל-retry
  'ignored'      -- נבדק והוחלט שאין מה לעשות (סופי)
);

-- איך הוכחה הבעלות על האירוע. אין כאן ערך שנשען על כותרת, שם לקוחה,
-- טלפון בתיאור או תאריך — אלה לעולם אינם ראיה לבעלות.
create type calendar_event_ownership as enum (
  'extended_properties',  -- extendedProperties.private.source + appointment_id
  'deterministic_id',     -- מזהה האירוע נגזר מ-appointment.id
  'stored_event_id',      -- appointments.google_event_id מצביע עליו
  'ambiguous'             -- סימני בעלות סותרים / פגומים — לא מעובד אוטומטית
);

-- אירועי האתר תמיד חד-פעמיים עם dateTime. כל צורה אחרת היא מסלול הגנתי:
-- לא ננחש איך להמיר אותה ל-appointment.
create type calendar_event_shape as enum (
  'timed_single',
  'recurring_master',
  'recurring_instance',
  'all_day',
  'malformed'
);

create type calendar_event_status as enum ('confirmed', 'tentative', 'cancelled');

create type calendar_change_result as enum (
  'echo',                        -- Google כבר תואם ל-DB; אפס כתיבות
  'rescheduled',                 -- starts_at עודכן מ-Google
  'end_corrected',               -- רק ה-end ביומן תוקן; אין history
  'cancelled_by_google_delete',  -- מחיקה ידנית → cancelled_by_business
  'already_cancelled',           -- התור כבר סופי; אפס כתיבות
  'reverted_to_db',              -- שינוי לא חוקי; Google הוחזר למועד ה-DB
  'revert_failed',               -- ההחזרה נכשלה; נדרש טיפול ידני
  'duplicate_event',
  'orphaned_event',
  'invalid_appointment_id',
  'ambiguous_ownership',
  'restored_event_redeleted',    -- אירוע ששוחזר אחרי ביטול, נמחק שוב
  'terminal_appointment',        -- completed/no_show — ההיסטוריה לא נגעת
  'not_confirmed',               -- pending: אין לו אירוע ביומן
  'unsupported_event_shape'
);

create type calendar_sync_issue_kind as enum (
  'conflict_slot_taken',
  'new_start_invalid',
  'revert_failed',
  'duplicate_event',
  'orphaned_event',
  'invalid_appointment_id',
  'ambiguous_ownership',
  'restored_after_cancel',
  'deleted_terminal_appointment',
  'unsupported_recurring_event',
  'unsupported_all_day_event',
  'malformed_event',
  'calendar_changed'
);

create type calendar_sync_issue_status as enum ('open', 'resolved');

-- ─── מצב הסנכרון ────────────────────────────────────────────────────────────
--
-- שורה יחידה (singleton — ה-PK הוא boolean עם CHECK(id), כך ששורה שנייה
-- פשוט אינה אפשרית). מחזיקה את הטוקן, את ה-cursor של ריצה שנקטעה, את
-- ה-lease, ואת סטטיסטיקת הריצה האחרונה.

create table public.calendar_sync_state (
  id                       boolean primary key default true check (id),

  -- קשירה ליומן: sha256 של GOOGLE_CALENDAR_ID, לא המזהה עצמו. syncToken
  -- שייך ליומן מסוים; אם היומן המחובר יוחלף, שליחת הטוקן הישן ליומן החדש
  -- הייתה התנהגות לא מוגדרת. ה-hash מספיק כדי לזהות החלפה, ואינו חושף את
  -- המזהה עצמו בשום תצוגה או דליפת שורה.
  calendar_fingerprint     text,
  calendar_changed_count   integer not null default 0 check (calendar_changed_count >= 0),

  -- הטוקן היציב שממנו תתחיל הריצה הבאה. null → נדרש full sync.
  sync_token               text,

  -- ─── cursor של ריצה פתוחה ────────────────────────────────────────────
  -- שלושת השדות האלה קיימים כדי שריצה שנקטעה באמצע pagination תוכל
  -- להימשך מאותו עמוד. בלעדיהם, יומן גדול שבו כל ריצה נעצרת ב-timeout
  -- באותה נקודה לעולם לא היה מגיע לעמודים המאוחרים — ה-unique constraint
  -- היה מונע כפילות, אבל לא היה מקדם אותנו.
  --
  -- ⚠️ base_sync_token אינו מותרות: ב-incremental sync, *כל* בקשת עמוד
  -- המשך חייבת לשאת את אותו syncToken של העמוד הראשון בנוסף ל-pageToken.
  -- pageToken לבדו אינו מספיק שם (בשונה מ-full sync, שבו אין syncToken
  -- בכלל). לכן הטוקן שממנו התחילה הסדרה נשמר עד סופה.
  sync_mode                calendar_sync_mode,
  base_sync_token          text,
  page_token               text,
  sync_started_at          timestamptz,

  last_full_sync_at        timestamptz,
  last_incremental_sync_at timestamptz,
  last_run_at              timestamptz,
  last_run_status          calendar_sync_run_status,
  last_run_error           text,     -- מסונן בלבד (left(...,300))
  last_run_stats           jsonb,    -- ספירות בלבד — לעולם לא payload של אירועים
  token_reset_count        integer not null default 0 check (token_reset_count >= 0),

  -- lease שמונע שתי ריצות סנכרון במקביל. אותו רעיון בדיוק כמו
  -- calendar_sync_started_at ברמת התור הבודד (0004): lease שפג ניתן
  -- לתפיסה מחדש, כך שריצה שקרסה לא חוסמת את המערכת לנצח.
  lease_owner              uuid,
  lease_started_at         timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on column public.calendar_sync_state.calendar_fingerprint is
  'sha256 hex של GOOGLE_CALENDAR_ID. לא המזהה עצמו — אין להציגו ואין לשמרו כטקסט גלוי.';
comment on column public.calendar_sync_state.base_sync_token is
  'ה-syncToken שממנו התחילה סדרת ה-incremental הפתוחה. חייב להישלח בכל עמוד המשך של אותה סדרה, יחד עם pageToken.';
comment on column public.calendar_sync_state.page_token is
  'ה-nextPageToken של העמוד האחרון שנשמר בהצלחה. null = אין ריצה שנקטעה באמצע pagination.';
comment on column public.calendar_sync_state.last_run_stats is
  'ספירות בלבד (read/persisted/processed/ignored/failed/...). לעולם לא תוכן אירועים.';

insert into public.calendar_sync_state (id) values (true);

create trigger calendar_sync_state_touch before update on public.calendar_sync_state
  for each row execute function public.touch_updated_at();

-- ─── התור העמיד (durable inbox) ─────────────────────────────────────────────

create table public.calendar_change_queue (
  id               bigserial primary key,

  google_event_id  text not null,

  -- מפתח הגרסה. הזוג (google_event_id, event_version) הוא ההבטחה שכל
  -- גרסת אירוע מעובדת לכל היותר פעם אחת — גם אם אותו עמוד נקרא שוב אחרי
  -- קריסה, וגם אם 410 אילץ full sync על יומן שכבר עובד כולו.
  event_version    text not null,

  ownership        calendar_event_ownership not null,
  event_shape      calendar_event_shape not null default 'timed_single',

  -- ⚠️ בכוונה *לא* FK: אירוע יכול להצהיר על appointment_id שאינו קיים
  -- (orphaned). FK היה הופך תקלה שצריך לדווח עליה לשגיאת INSERT שמפילה
  -- את שמירת כל העמוד — כלומר מאבדת שינויים.
  appointment_id   uuid,

  event_status     calendar_event_status not null,
  event_start      timestamptz,
  event_end        timestamptz,
  event_updated    timestamptz,

  status           calendar_queue_status not null default 'pending',
  attempt_count    integer not null default 0 check (attempt_count >= 0),
  lease_owner      uuid,
  lease_started_at timestamptz,
  last_error       text,     -- מסונן בלבד
  result           calendar_change_result,
  processed_at     timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint calendar_change_queue_version_uniq unique (google_event_id, event_version)
);

comment on table public.calendar_change_queue is
  'שינויים שהתקבלו מ-Google וממתינים לעיבוד. נשמר כאן אך ורק המינימום הנדרש: מזהה, גרסה, בעלות, צורה, סטטוס וזמנים. לעולם לא summary, description, attendees, location, recurrence payload או כל תוכן אחר של אירוע — גם לא של אירוע מערכת.';
comment on column public.calendar_change_queue.event_version is
  'etag, ובהיעדרו updated, ובהיעדרו sequence, ובהיעדר כולם fingerprint של מזהה/סטטוס/זמנים בלבד.';
comment on column public.calendar_change_queue.appointment_id is
  'מתוך extendedProperties או מהמזהה הדטרמיניסטי. אינו FK בכוונה — יכול להצביע ל-appointment שאינו קיים.';

create index calendar_change_queue_claim_idx
  on public.calendar_change_queue (status, created_at)
  where status in ('pending', 'failed', 'processing');
create index calendar_change_queue_appt_idx
  on public.calendar_change_queue (appointment_id)
  where appointment_id is not null;

create trigger calendar_change_queue_touch before update on public.calendar_change_queue
  for each row execute function public.touch_updated_at();

-- ─── תקלות שדורשות עין אנושית ───────────────────────────────────────────────

create table public.calendar_sync_issues (
  id               bigserial primary key,
  kind             calendar_sync_issue_kind not null,
  status           calendar_sync_issue_status not null default 'open',

  google_event_id  text,
  appointment_id   uuid,    -- אינו FK, מאותה סיבה כמו בתור
  queue_id         bigint references public.calendar_change_queue(id) on delete cascade,

  db_starts_at     timestamptz,
  google_starts_at timestamptz,
  detail           text,    -- מסונן בלבד

  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- retry של אותו queue item לא ייצור שורה שנייה מאותו סוג. גרסת אירוע
  -- חדשה *כן* מקבלת queue item חדש, ולכן יכולה לפתוח issue חדשה — וזה
  -- הרצוי, כי זו באמת תקלה חדשה.
  -- queue_id ריק (תקלה ברמת הריצה, למשל calendar_changed) אינו מוגבל:
  -- unique ב-Postgres אינו חוסם שורות שבהן חלק מהמפתח הוא null.
  constraint calendar_sync_issues_queue_kind_uniq unique (queue_id, kind)
);

comment on column public.calendar_sync_issues.detail is
  'הודעה קצרה ומסוננת בלבד. לעולם לא raw payload, description, attendees, טלפון מלא או תוכן פרטי.';

create index calendar_sync_issues_open_idx
  on public.calendar_sync_issues (status, created_at desc);

create trigger calendar_sync_issues_touch before update on public.calendar_sync_issues
  for each row execute function public.touch_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- שלוש הטבלאות מופעלות עם RLS ובלי אף policy — בדיוק הדפוס של otp_attempts
-- ב-0001. service_role עוקף RLS; anon ו-authenticated לא רואים שום שורה.
-- ללקוחה אין שום עניין לגיטימי ב-syncToken, במצב התור או ב-Google event ID.

alter table public.calendar_sync_state   enable row level security;
alter table public.calendar_change_queue enable row level security;
alter table public.calendar_sync_issues  enable row level security;

-- ─── תוספות לסכמה הקיימת ───────────────────────────────────────────────────

-- מקור הפעולה בהיסטוריה. actor_type הקיים (customer/admin/system) נשאר
-- כפי שהוא — הזזה שהגיעה מ-Google נרשמת כ-'system' עם actor_id ריק, כי
-- Google Calendar API אינו מוכיח מי מהמשתמשים גרר את האירוע, ואין לייחס
-- את הפעולה לשובל או לרפאל בלי ראיה. source מבדיל אותה מפעולת מערכת אחרת.
alter table public.appointment_history add column source text;

comment on column public.appointment_history.source is
  'מקור הפעולה, למשל ''google_calendar''. null לפעולות שנוצרו בתוך האתר עצמו.';

-- מאפשר לזהות בעלות לפי המזהה השמור בשאילתה אחת לעמוד, במקום סריקה.
create index appointments_google_event_idx
  on public.appointments (google_event_id)
  where google_event_id is not null;

-- ============================================================================
-- RPCs
--
-- כולן SECURITY INVOKER (ברירת המחדל), כמו 13 הפונקציות הקיימות: הן
-- נקראות אך ורק ע"י service_role בשרת, שממילא עוקף RLS. SECURITY DEFINER
-- היה מוסיף הסלמת הרשאות בלי שום צורך.
-- ============================================================================

-- ─── תפיסת ריצת סנכרון ──────────────────────────────────────────────────────
--
-- תופסת את ה-lease *ומחליטה את תוכנית הריצה באותה טרנזקציה*. ההחלטה חייבת
-- להיות כאן ולא בקוד: שתי ריצות שקוראות את המצב ואז מחליטות בנפרד היו
-- יכולות לבחור תוכניות סותרות על אותו cursor.
--
-- סדר העדיפויות:
--   1. היומן המחובר השתנה  → איפוס מלא, full sync.
--   2. page_token קיים      → resume של הריצה שנקטעה, באותו מצב בדיוק.
--   3. sync_token קיים      → incremental חדש; base_sync_token נכתב *עכשיו*,
--                             כדי שגם קריסה מיד אחרי ה-claim תשאיר סדרה
--                             שניתן להמשיך.
--   4. אחרת                 → full sync.
create or replace function public.claim_calendar_sync_run(
  p_owner                uuid,
  p_lease_seconds        integer,
  p_calendar_fingerprint text
) returns jsonb
language plpgsql
as $$
declare
  v_row            public.calendar_sync_state;
  v_calendar_reset boolean := false;
  v_resumed        boolean := false;
  v_mode           calendar_sync_mode;
begin
  if p_owner is null then
    raise exception 'OWNER_REQUIRED' using errcode = 'P0200';
  end if;
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'BAD_LEASE' using errcode = 'P0200';
  end if;

  select * into v_row from public.calendar_sync_state where id = true for update;

  if v_row.lease_owner is not null
     and v_row.lease_started_at is not null
     and v_row.lease_started_at > now() - make_interval(secs => p_lease_seconds) then
    raise exception 'SYNC_RUN_LOCKED' using errcode = 'P0201';
  end if;

  -- היומן המחובר השתנה: הטוקן הישן שייך ליומן אחר ואסור לשלוח אותו.
  if v_row.calendar_fingerprint is distinct from p_calendar_fingerprint then
    v_calendar_reset := v_row.calendar_fingerprint is not null;
    v_row.sync_token      := null;
    v_row.base_sync_token := null;
    v_row.page_token      := null;
    v_row.sync_mode       := null;
  end if;

  if v_row.page_token is not null and v_row.sync_mode is not null then
    v_resumed := true;
    v_mode    := v_row.sync_mode;
  elsif v_row.sync_token is not null then
    v_mode                := 'incremental';
    v_row.base_sync_token := v_row.sync_token;
    v_row.page_token      := null;
  else
    v_mode                := 'full';
    v_row.base_sync_token := null;
    v_row.page_token      := null;
  end if;

  update public.calendar_sync_state
  set lease_owner            = p_owner,
      lease_started_at       = now(),
      last_run_at            = now(),
      last_run_status        = 'running',
      last_run_error         = null,
      calendar_fingerprint   = p_calendar_fingerprint,
      calendar_changed_count = calendar_changed_count + (case when v_calendar_reset then 1 else 0 end),
      sync_token             = v_row.sync_token,
      sync_mode              = v_mode,
      base_sync_token        = v_row.base_sync_token,
      page_token             = v_row.page_token,
      sync_started_at        = case when v_resumed then sync_started_at else now() end
  where id = true
  returning * into v_row;

  return jsonb_build_object(
    'mode',            v_row.sync_mode,
    'base_sync_token', v_row.base_sync_token,
    'page_token',      v_row.page_token,
    'resumed',         v_resumed,
    'calendar_reset',  v_calendar_reset
  );
end;
$$;

-- ─── שמירת עמוד שינויים + קידום ה-cursor ────────────────────────────────────
--
-- ⚠️ זו הפונקציה שכל עמידות שלב 8 נשענת עליה. שלושת הדברים האלה קורים
-- בטרנזקציה אחת, או שאף אחד מהם לא קורה:
--
--   1. השינויים של העמוד נשמרים בתור.
--   2. page_token מתקדם (אם יש עמוד נוסף).
--   3. sync_token מתקדם (רק בעמוד האחרון, שבו Google מחזיר nextSyncToken).
--
-- Google מחזיר nextPageToken *או* nextSyncToken, לעולם לא את שניהם: טוקן
-- הסנכרון מגיע רק בעמוד האחרון. לכן קידום הטוקן אחרי עמוד אמצעי היה
-- מאבד את כל העמודים שאחריו — Google לא יחזיר אותם שוב לעולם.
create or replace function public.record_calendar_changes(
  p_owner           uuid,
  p_changes         jsonb,
  p_next_page_token text,
  p_next_sync_token text
) returns jsonb
language plpgsql
as $$
declare
  v_row      public.calendar_sync_state;
  v_before   bigint;
  v_after    bigint;
  v_received integer;
begin
  select * into v_row from public.calendar_sync_state where id = true for update;

  if v_row.lease_owner is distinct from p_owner then
    raise exception 'LEASE_LOST' using errcode = 'P0202';
  end if;

  if p_next_page_token is not null and p_next_sync_token is not null then
    raise exception 'AMBIGUOUS_CURSOR' using errcode = 'P0203';
  end if;
  if p_next_page_token is null and p_next_sync_token is null then
    raise exception 'MISSING_CURSOR' using errcode = 'P0203';
  end if;

  v_received := jsonb_array_length(coalesce(p_changes, '[]'::jsonb));
  select count(*) into v_before from public.calendar_change_queue;

  insert into public.calendar_change_queue (
    google_event_id, event_version, ownership, event_shape,
    appointment_id, event_status, event_start, event_end, event_updated
  )
  select c.google_event_id, c.event_version, c.ownership, c.event_shape,
         c.appointment_id, c.event_status, c.event_start, c.event_end, c.event_updated
  from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as c(
    google_event_id text,
    event_version   text,
    ownership       calendar_event_ownership,
    event_shape     calendar_event_shape,
    appointment_id  uuid,
    event_status    calendar_event_status,
    event_start     timestamptz,
    event_end       timestamptz,
    event_updated   timestamptz
  )
  on conflict (google_event_id, event_version) do nothing;

  select count(*) into v_after from public.calendar_change_queue;

  if p_next_page_token is not null then
    -- עוד עמודים לפנינו: ה-cursor מתקדם, הטוקן *לא*.
    update public.calendar_sync_state
    set page_token = p_next_page_token
    where id = true;
  else
    -- העמוד האחרון: עכשיו — ורק עכשיו — הטוקן מתקדם והריצה נסגרת.
    update public.calendar_sync_state
    set sync_token               = p_next_sync_token,
        page_token               = null,
        base_sync_token          = null,
        sync_mode                = null,
        sync_started_at          = null,
        last_full_sync_at        = case when v_row.sync_mode = 'full'
                                        then now() else last_full_sync_at end,
        last_incremental_sync_at = case when v_row.sync_mode = 'incremental'
                                        then now() else last_incremental_sync_at end
    where id = true;
  end if;

  return jsonb_build_object(
    'received',  v_received,
    'inserted',  v_after - v_before,
    'duplicate', v_received - (v_after - v_before),
    'completed', p_next_sync_token is not null
  );
end;
$$;

-- ─── איפוס ה-cursor ─────────────────────────────────────────────────────────
--
-- שני מצבי איפוס שונים, ובכוונה לא אחד:
--
--   p_full_reset = true  → 410 / fullSyncRequired. הטוקן עצמו פסול, ולכן
--                          שלושת שדות ה-cursor מתאפסים ומתחיל full sync.
--   p_full_reset = false → pageToken פסול בלבד. ה-syncToken של הסדרה עדיין
--                          תקף, אז מנקים רק את page_token ומתחילים את אותה
--                          סדרת incremental מהעמוד הראשון. קפיצה ל-full
--                          sync כאן הייתה עונש מיותר על יומן שלם.
--
-- queue items קיימים לעולם לא נמחקים כאן — מפתח הגרסה מונע כפילות.
create or replace function public.reset_calendar_sync_cursor(
  p_owner      uuid,
  p_full_reset boolean,
  p_reason     text
) returns jsonb
language plpgsql
as $$
declare
  v_row public.calendar_sync_state;
begin
  select * into v_row from public.calendar_sync_state where id = true for update;

  if v_row.lease_owner is distinct from p_owner then
    raise exception 'LEASE_LOST' using errcode = 'P0202';
  end if;

  if p_full_reset then
    update public.calendar_sync_state
    set sync_token        = null,
        base_sync_token   = null,
        page_token        = null,
        sync_mode         = 'full',
        sync_started_at   = now(),
        token_reset_count = token_reset_count + 1,
        last_run_error    = left(p_reason, 300)
    where id = true
    returning * into v_row;
  else
    if v_row.base_sync_token is null then
      raise exception 'NO_BASE_TOKEN' using errcode = 'P0204';
    end if;
    update public.calendar_sync_state
    set page_token     = null,
        sync_mode      = 'incremental',
        last_run_error = left(p_reason, 300)
    where id = true
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'mode',            v_row.sync_mode,
    'base_sync_token', v_row.base_sync_token,
    'page_token',      v_row.page_token
  );
end;
$$;

-- ─── סגירת ריצת סנכרון ──────────────────────────────────────────────────────
--
-- ⚠️ ה-cursor *אינו* נגע כאן. ריצה שנכשלה על 429/5xx/400-לא-מזוהה חייבת
-- להשאיר את page_token ואת base_sync_token בדיוק כפי שהם, כדי שהריצה הבאה
-- תמשיך מאותה נקודה. איפוס הוא פעולה מפורשת ונפרדת
-- (reset_calendar_sync_cursor), ולעולם לא תופעת לוואי של כשל.
create or replace function public.finish_calendar_sync_run(
  p_owner  uuid,
  p_status calendar_sync_run_status,
  p_error  text,
  p_stats  jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_row public.calendar_sync_state;
begin
  if p_status not in ('success', 'failed') then
    raise exception 'BAD_RUN_STATUS' using errcode = 'P0205';
  end if;

  select * into v_row from public.calendar_sync_state where id = true for update;

  if v_row.lease_owner is distinct from p_owner then
    raise exception 'LEASE_LOST' using errcode = 'P0202';
  end if;

  update public.calendar_sync_state
  set lease_owner      = null,
      lease_started_at = null,
      last_run_at      = now(),
      last_run_status  = p_status,
      last_run_error   = left(p_error, 300),
      last_run_stats   = p_stats
  where id = true
  returning * into v_row;

  return to_jsonb(v_row) - 'sync_token' - 'base_sync_token' - 'calendar_fingerprint';
end;
$$;

-- ─── תפיסת שינוי לעיבוד ─────────────────────────────────────────────────────
--
-- 'processed' ו-'ignored' הם מצבים סופיים ולעולם אינם נבחרים כאן. הדרך
-- היחידה להחזיר item מוצה למחזור היא retry ידני מפורש.
create or replace function public.claim_calendar_change(
  p_owner         uuid,
  p_max_attempts  integer,
  p_lease_seconds integer
) returns jsonb
language plpgsql
as $$
declare
  v_row public.calendar_change_queue;
begin
  if p_owner is null then
    raise exception 'OWNER_REQUIRED' using errcode = 'P0200';
  end if;

  update public.calendar_change_queue q
  set status           = 'processing',
      lease_owner      = p_owner,
      lease_started_at = now(),
      attempt_count    = q.attempt_count + 1
  where q.id = (
    select c.id
    from public.calendar_change_queue c
    where (
            (c.status in ('pending', 'failed') and c.attempt_count < p_max_attempts)
            or (c.status = 'processing'
                and c.lease_started_at < now() - make_interval(secs => p_lease_seconds))
          )
    order by c.created_at, c.id
    for update skip locked
    limit 1
  )
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOTHING_TO_CLAIM' using errcode = 'P0206';
  end if;

  return to_jsonb(v_row);
end;
$$;

-- ─── סגירת שינוי ────────────────────────────────────────────────────────────
-- רק בעל ה-lease רשאי לסגור. claim ישן שפג וכבר נתפס מחדש ע"י ריצה אחרת
-- לא ייסגר בטעות ע"י התהליך הישן — בדיוק כמו complete/fail_calendar_sync.
create or replace function public.finish_calendar_change(
  p_queue_id bigint,
  p_owner    uuid,
  p_status   calendar_queue_status,
  p_result   calendar_change_result,
  p_error    text
) returns jsonb
language plpgsql
as $$
declare
  v_row public.calendar_change_queue;
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'BAD_QUEUE_STATUS' using errcode = 'P0205';
  end if;

  update public.calendar_change_queue
  set status           = p_status,
      result           = p_result,
      last_error       = left(p_error, 300),
      lease_owner      = null,
      lease_started_at = null,
      processed_at     = case when p_status in ('processed', 'ignored')
                              then now() else processed_at end
  where id = p_queue_id
    and status = 'processing'
    and lease_owner = p_owner
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_LEASE_OWNER' using errcode = 'P0207';
  end if;

  return to_jsonb(v_row);
end;
$$;

-- ─── retry ידני ─────────────────────────────────────────────────────────────
-- הפעולה היחידה שמחזירה item שמיצה את ניסיונותיו למחזור. לא ניתן להחיות
-- item שכבר processed/ignored — אלה מצבים סופיים.
create or replace function public.retry_calendar_change(
  p_queue_id bigint
) returns jsonb
language plpgsql
as $$
declare
  v_row public.calendar_change_queue;
begin
  update public.calendar_change_queue
  set status           = 'pending',
      attempt_count    = 0,
      lease_owner      = null,
      lease_started_at = null,
      last_error       = null
  where id = p_queue_id
    and (status = 'failed'
         or (status = 'processing' and lease_started_at < now() - interval '5 minutes'))
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_RETRYABLE' using errcode = 'P0208';
  end if;

  return to_jsonb(v_row);
end;
$$;

-- ─── רישום תקלה (idempotent) ────────────────────────────────────────────────
-- retry של אותו queue item מעדכן את אותה שורה במקום לייצר ערימת כפילויות.
-- resolved_at נכתב פעם אחת בלבד במעבר open→resolved.
create or replace function public.record_calendar_sync_issue(
  p_queue_id         bigint,
  p_kind             calendar_sync_issue_kind,
  p_status           calendar_sync_issue_status,
  p_google_event_id  text,
  p_appointment_id   uuid,
  p_db_starts_at     timestamptz,
  p_google_starts_at timestamptz,
  p_detail           text
) returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into public.calendar_sync_issues (
    kind, status, google_event_id, appointment_id, queue_id,
    db_starts_at, google_starts_at, detail,
    resolved_at
  ) values (
    p_kind, p_status, p_google_event_id, p_appointment_id, p_queue_id,
    p_db_starts_at, p_google_starts_at, left(p_detail, 300),
    case when p_status = 'resolved' then now() else null end
  )
  on conflict (queue_id, kind) do update
  set status           = excluded.status,
      google_event_id  = coalesce(excluded.google_event_id, public.calendar_sync_issues.google_event_id),
      appointment_id   = coalesce(excluded.appointment_id, public.calendar_sync_issues.appointment_id),
      db_starts_at     = coalesce(excluded.db_starts_at, public.calendar_sync_issues.db_starts_at),
      google_starts_at = coalesce(excluded.google_starts_at, public.calendar_sync_issues.google_starts_at),
      detail           = excluded.detail,
      resolved_at      = case
                           when excluded.status = 'resolved'
                                and public.calendar_sync_issues.resolved_at is null then now()
                           when excluded.status = 'open' then null
                           else public.calendar_sync_issues.resolved_at
                         end
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── הזזה שהגיעה מ-Google ───────────────────────────────────────────────────
--
-- שינוי ידני של שובל ביומן אינו שינוי עצמי של הלקוחה, ולכן *אינו* כפוף
-- למדיניות הלקוחה: אין כאן cancel/reschedule_cutoff_hours, אין
-- max_reschedules, אין deposit_reschedule_cutoff_hours, ואין חלון השבוע
-- של BookingForm. שובל רשאית לקבוע גם בשעה שאינה מוצגת באתר — זו חריגה
-- מנהלית מכוונת.
--
-- מה כן נאכף, ולמה:
--   • confirmed בלבד — אין הזזה של תור שכבר בוטל/הושלם.
--   • המועד החדש עתידי.
--   • אין lease סנכרון מתחרה על אותו תור.
--   • אין חפיפה — ה-EXCLUDE constraint appointments_no_overlap נבדק על
--     ה-UPDATE הזה ומחזיר 23P01. זו ההגנה האמיתית; הקורא מחזיר את Google
--     למועד שב-DB במקום לדרוס תור אחר.
--
-- reschedule_count *אינו* גדל: הוא מיועד למגבלת ההזזות העצמיות של הלקוחה,
-- והזזה של שובל אינה צורכת מהמכסה שלה.
--
-- duration_min, price_total, service_key, variants ו-has_deposit אינם
-- נגעים. ends_at נכתב מחדש ע"י הטריגר appointments_set_end מ-duration_min
-- הקיים — כלומר Google אינו יכול לשנות את משך הטיפול, גם אם שובל האריכה
-- את האירוע ביומן.
create or replace function public.apply_google_reschedule(
  p_appointment_id    uuid,
  p_google_event_id   text,
  p_new_starts_at     timestamptz,
  p_calendar_matches  boolean,
  p_queue_id          bigint
) returns jsonb
language plpgsql
as $$
declare
  v_row   public.appointments;
  v_old   timestamptz;
begin
  select * into v_row from public.appointments
    where id = p_appointment_id for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ⚠️ בדיקת ה-echo *לפני* בדיקת הסטטוס ולפני כל בדיקה אחרת. שינוי שהמערכת
  -- עצמה ביצעה (יצירה, patch של הזזת לקוחה, מחיקה, retry ניהולי, תיקון end)
  -- חוזר אלינו כשינוי לכל דבר, וכאן הוא נעצר: Google כבר תואם ל-DB, ולכן
  -- אפס כתיבות — לא history, לא reschedule_count, לא original_starts_at,
  -- לא status, ולא פעולה חדשה ב-Google.
  if v_row.starts_at = p_new_starts_at then
    return jsonb_build_object('outcome', 'echo', 'appointment', to_jsonb(v_row));
  end if;

  if v_row.status <> 'confirmed' then
    raise exception 'NOT_CONFIRMED' using errcode = 'P0006';
  end if;

  if p_new_starts_at <= now() then
    raise exception 'NEW_IN_PAST' using errcode = 'P0008';
  end if;

  if v_row.calendar_sync_status = 'syncing'
     and v_row.calendar_sync_started_at is not null
     and v_row.calendar_sync_started_at > now() - interval '2 minutes' then
    raise exception 'SYNC_IN_PROGRESS' using errcode = 'P0007';
  end if;

  v_old := v_row.starts_at;

  update public.appointments
  set starts_at                = p_new_starts_at,
      original_starts_at       = coalesce(original_starts_at, v_old),
      google_event_id          = coalesce(google_event_id, p_google_event_id),
      calendar_sync_operation  = 'upsert',
      -- p_calendar_matches: האם ה-end ביומן כבר תואם ל-duration_min. אם כן,
      -- Google והמערכת מסונכרנים ואין מה לכתוב ליומן. אם לא — נשאר pending,
      -- וה-upsert הרגיל (ensureCalendarSynced) יתקן את ה-end לזמן הקנוני.
      -- ⚠️ ה-cast מפורש: Postgres מסיק את תוצאת ה-CASE כ-text, וללא הצבעה
      -- מפורשת ההשמה לעמודה מטיפוס enum נכשלת.
      calendar_sync_status     = case when p_calendar_matches
                                      then 'synced'::calendar_sync_status
                                      else 'pending'::calendar_sync_status end,
      calendar_synced_at       = case when p_calendar_matches then now() else calendar_synced_at end,
      calendar_sync_started_at = null,
      calendar_sync_error      = null
  where id = p_appointment_id
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, to_starts_at, actor, actor_id, source
  ) values (
    v_row.id, 'rescheduled', 'confirmed', 'confirmed',
    v_old, p_new_starts_at, 'system', null, 'google_calendar'
  );

  return jsonb_build_object(
    'outcome',         'applied',
    'from_starts_at',  v_old,
    'appointment',     to_jsonb(v_row)
  );
end;
$$;

-- ─── תיקון end בלבד ─────────────────────────────────────────────────────────
--
-- כששובל האריכה או קיצרה ידנית אירוע בלי להזיז אותו: ה-start זהה, ולכן זו
-- *אינה* הזזה — אין history, אין שינוי מועד, ו-duration_min נשאר מקור האמת.
-- מה שצריך לקרות הוא תיקון ה-end ביומן לזמן הקנוני.
--
-- ⚠️ למה נדרש RPC ולא סתם קריאה ל-retry: ensureCalendarSynced מחזירה הצלחה
-- idempotent מיידית כשה-calendar_sync_status הוא 'synced' — כלומר בדיוק
-- במצב שבו התור נמצא אחרי סנכרון תקין, ואז ה-end השגוי היה נשאר ביומן.
-- הפונקציה הזו מחזירה את התור למצב 'pending' באופן אטומי, כדי שה-upsert
-- הרגיל *באמת* יבצע patch.
create or replace function public.mark_calendar_correction_required(
  p_appointment_id  uuid,
  p_google_event_id text
) returns jsonb
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  select * into v_row from public.appointments
    where id = p_appointment_id for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.status <> 'confirmed' then
    raise exception 'NOT_CONFIRMED' using errcode = 'P0006';
  end if;

  -- בעלות: המזהה השמור חייב להתאים. אירוע שאינו הקנוני של התור לא מזכה
  -- אותו בתיקון אוטומטי — ראה הטיפול ב-duplicate בקוד הקורא.
  if v_row.google_event_id is not null
     and v_row.google_event_id <> p_google_event_id then
    raise exception 'NOT_CANONICAL' using errcode = 'P0209';
  end if;

  if v_row.calendar_sync_status = 'syncing'
     and v_row.calendar_sync_started_at is not null
     and v_row.calendar_sync_started_at > now() - interval '2 minutes' then
    raise exception 'SYNC_IN_PROGRESS' using errcode = 'P0007';
  end if;

  -- starts_at, ends_at, status, original_starts_at, reschedule_count,
  -- duration_min, price_total — כולם ללא נגיעה. appointment_history — לא נכתב.
  update public.appointments
  set calendar_sync_operation  = 'upsert',
      calendar_sync_status     = 'pending',
      calendar_sync_error      = null,
      calendar_sync_started_at = null,
      google_event_id          = coalesce(google_event_id, p_google_event_id)
  where id = p_appointment_id
  returning * into v_row;

  return jsonb_build_object('outcome', 'marked', 'appointment', to_jsonb(v_row));
end;
$$;

-- ─── ביטול שהגיע ממחיקה ב-Google ────────────────────────────────────────────
--
-- כששובל מוחקת ידנית אירוע מערכת, זהו ביטול מצד העסק. התור *לא* נמחק —
-- רק הסטטוס משתנה, והסלוט משתחרר מיד כי ה-EXCLUDE constraint חל רק על
-- pending/confirmed.
--
-- ⚠️ calendar_sync_status נקבע ל-'synced' ולא ל-'pending': האירוע כבר
-- נמחק ב-Google בפועל, ולכן outbound delete נוסף היה קריאה מיותרת ל-API
-- על אירוע שאינו קיים. calendar_sync_operation נשמר כ-'delete' כתיעוד
-- נאמן של מה שהתרחש.
--
-- הטבלה המלאה מול appointment_status האמיתי (8 ערכים, 0001 + 0002):
--   confirmed                                    → cancelled_by_business + history
--   cancelled_by_customer/_business/expired/
--     rescheduled                                → already_cancelled, אפס כתיבות
--   completed / no_show                          → terminal, אפס כתיבות (הקורא פותח issue)
--   pending                                      → not_confirmed, אפס כתיבות
create or replace function public.apply_google_cancellation(
  p_appointment_id  uuid,
  p_google_event_id text,
  p_queue_id        bigint
) returns jsonb
language plpgsql
as $$
declare
  v_row public.appointments;
  v_old timestamptz;
begin
  select * into v_row from public.appointments
    where id = p_appointment_id for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- מחיקה היסטורית אינה מוחקת היסטוריה עסקית.
  if v_row.status in ('completed', 'no_show') then
    return jsonb_build_object('outcome', 'terminal', 'appointment', to_jsonb(v_row));
  end if;

  -- כבר סופי: echo של המחיקה שהמערכת עצמה ביצעה, או מחיקה חוזרת. אפס
  -- כתיבות, ובפרט אין history שני.
  if v_row.status in ('cancelled_by_customer', 'cancelled_by_business',
                      'expired', 'rescheduled') then
    return jsonb_build_object('outcome', 'already_cancelled', 'appointment', to_jsonb(v_row));
  end if;

  -- בקשה שלא אושרה מעולם לא קיבלה אירוע ביומן.
  if v_row.status <> 'confirmed' then
    return jsonb_build_object('outcome', 'not_confirmed', 'appointment', to_jsonb(v_row));
  end if;

  v_old := v_row.starts_at;

  update public.appointments
  set status                   = 'cancelled_by_business',
      calendar_sync_operation  = 'delete',
      calendar_sync_status     = 'synced',
      calendar_synced_at       = now(),
      calendar_sync_started_at = null,
      calendar_sync_error      = null,
      google_event_id          = coalesce(google_event_id, p_google_event_id)
  where id = p_appointment_id
  returning * into v_row;

  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, actor, actor_id, source
  ) values (
    v_row.id, 'cancelled', 'confirmed', 'cancelled_by_business',
    v_old, 'system', null, 'google_calendar'
  );

  return jsonb_build_object(
    'outcome',        'applied',
    'from_starts_at', v_old,
    'appointment',    to_jsonb(v_row)
  );
end;
$$;

-- ============================================================================
-- הרשאות
--
-- אותו דפוס בדיוק כמו 0007, ומאותה סיבה: PostgREST חושף כל פונקציה בסכמה
-- public כ-RPC לכל תפקיד כברירת מחדל, ו-`revoke ... from public` לבדו אינו
-- מסיר את ההענקה הישירה ש-Supabase נותנת ל-anon ול-authenticated (זו בדיוק
-- התקלה שתוקנה ב-0006/0007). לכן שלושת התפקידים מפורשים בכל REVOKE.
--
-- כל 11 הפונקציות למטה כותבות למצב המערכת וסומכות על כך שהקורא כבר עבר
-- requireAdminApi או אימות secret בשרת — service_role בלבד.
-- ============================================================================

revoke execute on function public.claim_calendar_sync_run(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.record_calendar_changes(uuid, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.reset_calendar_sync_cursor(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.finish_calendar_sync_run(uuid, calendar_sync_run_status, text, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_calendar_change(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.finish_calendar_change(bigint, uuid, calendar_queue_status, calendar_change_result, text) from public, anon, authenticated;
revoke execute on function public.retry_calendar_change(bigint) from public, anon, authenticated;
revoke execute on function public.record_calendar_sync_issue(bigint, calendar_sync_issue_kind, calendar_sync_issue_status, text, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.apply_google_reschedule(uuid, text, timestamptz, boolean, bigint) from public, anon, authenticated;
revoke execute on function public.mark_calendar_correction_required(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_google_cancellation(uuid, text, bigint) from public, anon, authenticated;

grant execute on function public.claim_calendar_sync_run(uuid, integer, text) to service_role;
grant execute on function public.record_calendar_changes(uuid, jsonb, text, text) to service_role;
grant execute on function public.reset_calendar_sync_cursor(uuid, boolean, text) to service_role;
grant execute on function public.finish_calendar_sync_run(uuid, calendar_sync_run_status, text, jsonb) to service_role;
grant execute on function public.claim_calendar_change(uuid, integer, integer) to service_role;
grant execute on function public.finish_calendar_change(bigint, uuid, calendar_queue_status, calendar_change_result, text) to service_role;
grant execute on function public.retry_calendar_change(bigint) to service_role;
grant execute on function public.record_calendar_sync_issue(bigint, calendar_sync_issue_kind, calendar_sync_issue_status, text, uuid, timestamptz, timestamptz, text) to service_role;
grant execute on function public.apply_google_reschedule(uuid, text, timestamptz, boolean, bigint) to service_role;
grant execute on function public.mark_calendar_correction_required(uuid, text) to service_role;
grant execute on function public.apply_google_cancellation(uuid, text, bigint) to service_role;

-- ============================================================================
-- אימות ההרשאות בפועל
--
-- אותו לקח של 0007, מילה במילה: "Success" בעורך ה-SQL אינו ראיה לכך
-- שההרשאות באמת השתנו. 0006 דווחה Success ואחריה anon עדיין הצליח להריץ
-- את כל 13 הפונקציות. לכן הקובץ הזה לא מסתפק בביצוע — הוא בודק את התוצאה
-- ונכשל כולו אם אפילו פונקציה אחת נשארה במצב שגוי.
--
-- ⚠️ יש להריץ את הקובץ *כולו*. עורך ה-SQL של Supabase מריץ רק את הטקסט
-- המסומן כאשר קיימת בחירה — יש לוודא שאין בחירה חלקית לפני Run.
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.claim_calendar_sync_run(uuid, integer, text)',
    'public.record_calendar_changes(uuid, jsonb, text, text)',
    'public.reset_calendar_sync_cursor(uuid, boolean, text)',
    'public.finish_calendar_sync_run(uuid, calendar_sync_run_status, text, jsonb)',
    'public.claim_calendar_change(uuid, integer, integer)',
    'public.finish_calendar_change(bigint, uuid, calendar_queue_status, calendar_change_result, text)',
    'public.retry_calendar_change(bigint)',
    'public.record_calendar_sync_issue(bigint, calendar_sync_issue_kind, calendar_sync_issue_status, text, uuid, timestamptz, timestamptz, text)',
    'public.apply_google_reschedule(uuid, text, timestamptz, boolean, bigint)',
    'public.mark_calendar_correction_required(uuid, text)',
    'public.apply_google_cancellation(uuid, text, bigint)'
  ];
  v_sig      text;
  v_verified integer := 0;
begin
  foreach v_sig in array v_signatures loop

    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception
        'הרשאות RPC (0008): % — לתפקיד anon עדיין יש EXECUTE. ההרשאה הזו אמורה להישלל.',
        v_sig
        using errcode = 'P0100';
    end if;

    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception
        'הרשאות RPC (0008): % — לתפקיד authenticated עדיין יש EXECUTE. ההרשאה הזו אמורה להישלל.',
        v_sig
        using errcode = 'P0100';
    end if;

    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception
        'הרשאות RPC (0008): % — לתפקיד service_role חסר EXECUTE. ההרשאה הזו אמורה להישמר.',
        v_sig
        using errcode = 'P0101';
    end if;

    v_verified := v_verified + 1;
  end loop;

  if v_verified <> array_length(v_signatures, 1) then
    raise exception
      'הרשאות RPC (0008): אומתו % מתוך % פונקציות — הבדיקה לא הושלמה.',
      v_verified, array_length(v_signatures, 1)
      using errcode = 'P0102';
  end if;

  raise notice
    'הרשאות RPC של 0008 אומתו: % פונקציות. anon=false, authenticated=false, service_role=true.',
    v_verified;
end $$;

-- ─── אימות שהסכמה החדשה אכן נבנתה ──────────────────────────────────────────
-- אותו עיקרון: לא להסתמך על "Success", אלא לבדוק.
do $$
declare
  v_tables integer;
  v_state  integer;
  v_rls    integer;
  v_source integer;
begin
  select count(*) into v_tables
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('calendar_sync_state', 'calendar_change_queue', 'calendar_sync_issues');
  if v_tables <> 3 then
    raise exception '0008: נוצרו % מתוך 3 הטבלאות.', v_tables using errcode = 'P0103';
  end if;

  select count(*) into v_state from public.calendar_sync_state;
  if v_state <> 1 then
    raise exception '0008: calendar_sync_state חייבת להכיל שורה אחת בדיוק, נמצאו %.', v_state
      using errcode = 'P0103';
  end if;

  select count(*) into v_rls
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in ('calendar_sync_state', 'calendar_change_queue', 'calendar_sync_issues')
    and relrowsecurity;
  if v_rls <> 3 then
    raise exception '0008: RLS מופעל רק על % מתוך 3 הטבלאות.', v_rls using errcode = 'P0103';
  end if;

  select count(*) into v_source
  from information_schema.columns
  where table_schema = 'public' and table_name = 'appointment_history' and column_name = 'source';
  if v_source <> 1 then
    raise exception '0008: appointment_history.source לא נוספה.' using errcode = 'P0103';
  end if;

  raise notice '0008: 3 טבלאות, RLS מופעל, singleton קיים, appointment_history.source נוספה.';
end $$;
