-- ============================================================================
-- 0013 — הנפקת OTP ואימות OTP כפעולות אטומיות
--
-- תלוי ב-0001 (public.otp_attempts) בלבד. אינו נוגע ב-0002–0012, אינו משנה
-- סכמה קיימת, אינו מוסיף עמודה ואינו נוגע במערכת התזכורות.
--
-- ─── מה נשבר לפני המיגרציה הזו ─────────────────────────────────────────────
--
-- lib/db/otpStore.ts ביצע קריאה ואז כתיבה כשתי פעולות נפרדות, בלי נעילה
-- ובלי טרנזקציה. שתי בקשות מקבילות לאותו מספר עברו שתיהן את בדיקת ה-cooldown,
-- הכניסו שתי שורות, ושלחו שני SMS.
--
-- ⚠️ הנזק אינו כפל חיוב. verifyOtp בוחר את השורה **האחרונה**: הלקוחה קיבלה
-- שני קודים, הקלידה את הראשון שהגיע, והוא נדחה. זה שבר כניסה בפועל.
--
-- ─── למה לא פתרנו את זה בקוד האפליקציה ─────────────────────────────────────
--
-- הפתרון שנשקל היה INSERT ואז קריאה חוזרת, כשבעל ה-id הנמוך שולח. **הוא
-- אינו בטוח.** nextval() אינו טרנזקציוני: המספר מוקצה בזמן ה-INSERT ומשוחרר
-- מיד, בלי קשר לסדר ה-commit. לכן:
--
--   • בקשה A מקבלת id=100 ומתעכבת לפני commit.
--   • בקשה B מקבלת id=101, עושה commit, קוראת, רואה רק את עצמה — ושולחת.
--   • A עושה commit, קוראת, רואה שהיא בעלת ה-id הנמוך — ושולחת גם היא.
--
-- שני SMS. סדר ה-id אינו סדר ה-commit, ואי אפשר לבנות עליו הכרעה.
--
-- ההכרעה היחידה שמחזיקה היא נעילה שנלקחת **לפני** הקריאה ומשוחררת ב-commit.
-- זה מה שהקובץ הזה עושה, וזה מה שהקורא אינו יכול לעקוף: אין דגל session,
-- אין GUC, ואין פרמטר שמכבה את הנעילה.
--
-- ─── SECURITY INVOKER, לא DEFINER ──────────────────────────────────────────
--
-- 🔒 שתי הפונקציות הן SECURITY INVOKER (ברירת המחדל), ויש בסוף בלוק
-- assertion שנכשל אם מישהו ישנה זאת.
--
-- otp_attempts היא טבלה עם RLS מופעל ו**אפס policies** (0001). המשמעות:
-- תפקיד שאינו עוקף RLS מקבל אפס שורות ואינו יכול להכניס שורה. עם INVOKER,
-- ההרשאה (REVOKE מ-anon/authenticated) וה-RLS הן שתי הגנות בלתי תלויות —
-- ודליפה של אחת אינה מספיקה. DEFINER היה מאחד אותן לנכס יחיד: כל דרך
-- להפעיל את הפונקציה הייתה מקבלת גם את הרשאות הבעלים.
--
-- זו בדיוק המסקנה של 0006. אין כאן שום דבר שדורש הרשאות בעלים.
-- ============================================================================


-- ============================================================================
-- חלק 1 — השוואה בזמן קבוע
--
-- ⚠️ הפונקציה סורקת **תמיד** את כל 64 התווים. `=` רגיל של Postgres הוא
-- memcmp עם יציאה מוקדמת, וזמן הריצה שלו מסגיר את מיקום התו הראשון שנבדל.
--
-- הקוד הקודם השתמש ב-timingSafeEqual של Node. העברת ההשוואה ל-SQL בלי
-- תחליף הייתה הורדה שקטה של ההגנה הזו, ולכן היא לא הועברה בלי תחליף.
--
-- ⚠️ מה שבאמת נושא את המשקל הוא תקרת 5 הניסיונות, שהפכה אטומית ב-חלק 3:
-- ערוץ זמן דורש אלפי מדידות, ואחרי חמישה ניחושים הקוד נעול. ההשוואה כאן
-- היא הגנה לעומק, לא ההגנה היחידה.
-- ============================================================================

create or replace function public.otp_hash_equals(
  p_left  text,
  p_right text
) returns boolean
language sql
immutable
-- 🔒 search_path נעול: pg_catalog ואז public בלבד. אין pg_temp, ולכן טבלה
-- זמנית בשם public.otp_attempts אינה יכולה להיכנס לתמונה.
set search_path = pg_catalog, public
as $$
  select p_left is not null
     and p_right is not null
     and length(p_left) = length(p_right)
     and 0 = (
       select count(*)
       from generate_series(1, length(p_left)) as i
       where substr(p_left, i, 1) <> substr(p_right, i, 1)
     );
$$;

comment on function public.otp_hash_equals(text, text) is
  'השוואת גיבובים בזמן קבוע — סורקת את כל האורך תמיד, בלי יציאה מוקדמת.';


-- ============================================================================
-- חלק 2 — הנפקת OTP אטומית
--
-- 🔒 סדר קבוע של הנעילות: **טלפון ואז IP. לעולם לא הפוך.**
--
-- שתי בקשות שנועלות שני משאבים בסדר הפוך נתקעות ב-deadlock. הסדר כאן קבוע
-- בקוד ואינו תלוי בקלט, ולכן שתי קריאות במקביל תמיד נועלות באותו סדר:
--
--   בקשה 1: (טלפון A, IP X) → נועלת A, אחר כך X
--   בקשה 2: (טלפון B, IP X) → נועלת B, אחר כך X
--
-- אין מסלול שבו אחת מחזיקה את X ומחכה ל-A בעוד השנייה מחזיקה את A ומחכה ל-X.
--
-- ⚠️ pg_advisory_xact_lock ולא pg_advisory_lock: הנעילה משוחררת ב-commit או
-- ב-rollback, אוטומטית. נעילת session הייתה נשארת תלויה על חיבור מה-pool
-- אחרי כשל, ומקפיאה את המספר הזה לכל בקשה עתידית.
--
-- ⚠️ hashtext מחזיר int4, ולכן שני מספרים שונים *יכולים* להתנגש ולהינעל
-- זה על זה. זה חסר משמעות כאן: התנגשות גורמת לסריאליזציה מיותרת של שתי
-- בקשות למשך מילישניות ספורות, ולעולם אינה מתירה שליחה כפולה. הכיוון
-- המסוכן — שתי בקשות לאותו מספר שאינן נועלות זו את זו — בלתי אפשרי,
-- כי אותו קלט נותן תמיד אותו hash.
--
-- ─── התקרות ────────────────────────────────────────────────────────────────
--
-- ⚠️ הפרמטרים **מהודקים כאן ואינם יכולים להרפות את המגבלה** — רק להדק אותה.
-- קורא שיעביר p_max_per_hour = 1000000 יקבל 5. זו הסיבה שהתקרות הקשיחות
-- יושבות ב-SQL ולא רק ב-lib/otp.ts: הן חייבות להחזיק גם מול קורא שגוי.
--
-- ⚠️ הערכים כאן חייבים להישאר תואמים ל-lib/otp.ts. scripts/test-otp-atomic.mjs
-- קורא את שני הקבצים ונכשל אם הם נפרדו.
-- ============================================================================

create or replace function public.issue_otp_atomic(
  p_phone_e164          text,
  p_purpose             text,
  p_code_hash           text,
  p_ip                  inet,
  p_ttl_seconds         integer,
  p_cooldown_seconds    integer,
  p_max_per_hour        integer,
  p_max_per_day         integer,
  p_max_per_ip_per_hour integer
) returns jsonb
language plpgsql
-- 🔒 search_path נעול (ראה otp_hash_equals). כל שמות הטבלאות והפונקציות
-- שלנו גם schema-qualified במפורש — שתי ההגנות יחד, לא אחת מהן.
set search_path = pg_catalog, public
as $$
declare
  -- 🔒 תקרות קשיחות. הפרמטר יכול רק להדק.
  c_ttl      constant integer := least(coalesce(p_ttl_seconds, 300), 900);
  c_cooldown constant integer := greatest(coalesce(p_cooldown_seconds, 60), 60);
  c_hour     constant integer := least(coalesce(p_max_per_hour, 5), 5);
  c_day      constant integer := least(coalesce(p_max_per_day, 10), 10);
  c_ip       constant integer := least(coalesce(p_max_per_ip_per_hour, 15), 15);

  v_ip_count  integer;
  v_last      timestamptz;
  v_hour      integer;
  v_day       integer;
  v_retry     integer;
  v_id        bigint;
  v_expires   timestamptz;
begin
  -- ── ולידציה ────────────────────────────────────────────────────────────
  -- ⚠️ הודעות החריגה קבועות ואינן משכפלות את הקלט. הודעת שגיאה שמכילה את
  -- הגיבוב או את המספר נוחתת בלוגי Postgres, שאינם במודל האיומים שלנו.
  if p_phone_e164 is null or p_phone_e164 !~ '^\+9725[0-9]{8}$' then
    raise exception 'OTP_BAD_PHONE' using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('login', 'booking') then
    raise exception 'OTP_BAD_PURPOSE' using errcode = '22023';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'OTP_BAD_CODE_HASH' using errcode = '22023';
  end if;

  -- ── 🔒 הנעילות. לפני כל קריאה, בסדר קבוע ──────────────────────────────
  perform pg_advisory_xact_lock(1, hashtext(p_phone_e164));
  if p_ip is not null then
    perform pg_advisory_xact_lock(2, hashtext(host(p_ip)));
  end if;

  -- ── מגבלת IP ───────────────────────────────────────────────────────────
  -- ⚠️ נבדקת ראשונה, בדיוק כמו ב-checkOtpRateLimit. סריקה על פני מספרים
  -- רבים היא התקיפה שהמגבלה הזו קיימת בשבילה, ובדיקה שלה אחרי ה-cooldown
  -- הייתה מאפשרת מספר חדש בכל בקשה לעקוף אותה לגמרי.
  if p_ip is not null then
    select count(*)::integer into v_ip_count
    from public.otp_attempts
    where ip = p_ip
      and created_at > now() - interval '1 hour';

    if v_ip_count >= c_ip then
      return jsonb_build_object('allowed', false, 'reason', 'ip_limit',
                                'retry_after_sec', 3600);
    end if;
  end if;

  -- ── cooldown ───────────────────────────────────────────────────────────
  -- ⚠️ max(created_at) על כל ההיסטוריה של המספר, בלי חלון. שורה שנוצרה
  -- לפני שנייה חוסמת גם אם כל שאר החלונות ריקים — וזו בדיוק השורה שבקשה
  -- מקבילה הכניסה רגע לפני שהנעילה עברה אלינו.
  select max(created_at) into v_last
  from public.otp_attempts
  where phone_e164 = p_phone_e164;

  if v_last is not null and v_last > now() - make_interval(secs => c_cooldown) then
    v_retry := ceil(extract(epoch from
      (v_last + make_interval(secs => c_cooldown) - now())))::integer;
    return jsonb_build_object('allowed', false, 'reason', 'cooldown',
                              'retry_after_sec', greatest(v_retry, 1));
  end if;

  -- ── תקרות שעה ויום למספר ───────────────────────────────────────────────
  select
    count(*) filter (where created_at > now() - interval '1 hour')::integer,
    count(*) filter (where created_at > now() - interval '1 day')::integer
  into v_hour, v_day
  from public.otp_attempts
  where phone_e164 = p_phone_e164;

  if v_hour >= c_hour then
    return jsonb_build_object('allowed', false, 'reason', 'hourly_limit',
                              'retry_after_sec', 3600);
  end if;
  if v_day >= c_day then
    return jsonb_build_object('allowed', false, 'reason', 'daily_limit',
                              'retry_after_sec', 86400);
  end if;

  -- ── השורה היחידה ───────────────────────────────────────────────────────
  insert into public.otp_attempts (phone_e164, code_hash, purpose, expires_at, ip)
  values (p_phone_e164, p_code_hash, p_purpose,
          now() + make_interval(secs => c_ttl), p_ip)
  returning id, expires_at into v_id, v_expires;

  -- ⚠️ מזהה וזמן תפוגה בלבד. אין טלפון, אין גיבוב, אין IP, ואין הקוד.
  return jsonb_build_object('allowed', true, 'otp_id', v_id, 'expires_at', v_expires);
end;
$$;

comment on function public.issue_otp_atomic(text, text, text, inet, integer, integer, integer, integer, integer) is
  'הנפקת OTP אטומית: נעילת טלפון ואז IP, בדיקת כל המגבלות, ושורה אחת בלבד. '
  'שתי בקשות מקבילות לאותו מספר → שורה אחת ו-SMS אחד.';


-- ============================================================================
-- חלק 3 — אימות OTP אטומי
--
-- 🔒 `for update` על השורה **לפני** כל החלטה. זה מה שהופך את מונה הניסיונות
-- לאמין: הקוד הקודם קרא attempts, חישב attempts+1 וכתב — ולכן חמישה ניחושים
-- מקבילים קראו כולם 0 וכתבו כולם 1. תקרת חמשת הניסיונות הייתה ניתנת
-- להרחבה בהרצה מקבילה.
--
-- ⚠️ ב-READ COMMITTED, כאשר `for update` משחררת המתנה היא מעריכה מחדש את
-- תנאי ה-WHERE מול גרסת השורה החדשה. שורה שנצרכה בינתיים כבר לא מקיימת
-- `consumed_at is null`, נשמטת, וה-LIMIT מחזיר אפס שורות. זה בדיוק מה
-- שמונע משני אימותים נכונים מקבילים להצליח שניהם — השני מקבל no_code.
--
-- ⚠️ אין פרמטר `now`. הזמן נלקח מ-now() של השרת בלבד: תוקף שהקורא יכול
-- להעביר הוא תוקף שאפשר לזייף, וקוד שפג היה חוזר לתוקף בבקשה אחת.
--
-- ⚠️ הקוד הגלוי אינו מגיע לכאן לעולם. מה שמתקבל הוא גיבוב שחושב בשרת עם
-- OTP_PEPPER, שאינו קיים בבסיס הנתונים.
-- ============================================================================

create or replace function public.verify_otp_atomic(
  p_phone_e164     text,
  p_purpose        text,
  p_candidate_hash text,
  p_max_attempts   integer
) returns jsonb
language plpgsql
-- 🔒 search_path נעול (ראה otp_hash_equals). כל שמות הטבלאות והפונקציות
-- שלנו גם schema-qualified במפורש — שתי ההגנות יחד, לא אחת מהן.
set search_path = pg_catalog, public
as $$
declare
  -- 🔒 גם כאן הפרמטר יכול רק להדק.
  c_max constant integer := least(coalesce(p_max_attempts, 5), 5);
  v_row      public.otp_attempts;
  v_attempts integer;
begin
  if p_phone_e164 is null or p_phone_e164 !~ '^\+9725[0-9]{8}$' then
    raise exception 'OTP_BAD_PHONE' using errcode = '22023';
  end if;
  if p_purpose is null or p_purpose not in ('login', 'booking') then
    raise exception 'OTP_BAD_PURPOSE' using errcode = '22023';
  end if;
  if p_candidate_hash is null or p_candidate_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'OTP_BAD_CODE_HASH' using errcode = '22023';
  end if;

  -- ⚠️ אותה נעילה ובאותו namespace כמו בהנפקה. אימות שרץ במקביל להנפקה
  -- לא יכול לקרוא שורה חצי-כתובה, ולא יכול להצמיד ניסיון לשורה שעומדת
  -- להיות מוחלפת.
  perform pg_advisory_xact_lock(1, hashtext(p_phone_e164));

  select * into v_row
  from public.otp_attempts
  where phone_e164 = p_phone_e164
    and purpose    = p_purpose
    and consumed_at is null
  order by created_at desc, id desc
  limit 1
  for update;

  if v_row.id is null then
    return jsonb_build_object('result', 'no_code');
  end if;

  if v_row.expires_at <= now() then
    return jsonb_build_object('result', 'expired');
  end if;

  if v_row.attempts >= c_max then
    return jsonb_build_object('result', 'too_many');
  end if;

  if public.otp_hash_equals(v_row.code_hash, p_candidate_hash) then
    -- השריפה קורית באותה טרנזקציה שהחזיקה את הנעילה. אין חלון שבו הקוד
    -- אומת אך עדיין פנוי לאימות שני.
    update public.otp_attempts
    set consumed_at = now()
    where id = v_row.id;

    return jsonb_build_object('result', 'ok');
  end if;

  -- ⚠️ attempts + 1 מחושב על העמודה, לא על ערך שנקרא קודם. השורה נעולה
  -- מאז ה-for update, ולכן אין כאן read-modify-write.
  update public.otp_attempts
  set attempts = attempts + 1
  where id = v_row.id
  returning attempts into v_attempts;

  return jsonb_build_object(
    'result', case when v_attempts >= c_max then 'too_many' else 'wrong' end
  );
end;
$$;

comment on function public.verify_otp_atomic(text, text, text, integer) is
  'אימות OTP אטומי: for update על השורה, מונה ניסיונות אמין, ושריפה חד-פעמית. '
  'שני אימותים נכונים מקבילים → רק אחד מצליח.';


-- ============================================================================
-- חלק 4 — ביטול הנפקה שהשליחה שלה נדחתה בוודאות
--
-- ═══ הפער שהפונקציה הזו סוגרת ═══
--
-- issue_otp_atomic יוצרת את השורה **לפני** הקריאה ל-019, כי הקוד חייב
-- להיות שמור לפני שהוא יוצא החוצה. אבל אם 019 דוחה את הבקשה בוודאות,
-- השורה החדשה נשארת "הקוד האחרון" — ואז:
--
--   • הקוד הקודם, שאולי **כן** הגיע ללקוחה, מפסיק להיות תקף.
--   • מופעל cooldown של 60 שניות על כשל שאינו באשמתה.
--   • השורה נספרת במכסת השעה ובמכסת היום.
--
-- כלומר הלקוחה מחזיקה SMS עם קוד, מקלידה אותו, נדחית — ונחסמת מלבקש חדש.
--
-- ═══ 🔒 מתי מותר למחוק, ומתי אסור ═══
--
-- ⚠️ המחיקה מותרת **אך ורק** כאשר הוכח שההודעה לא התקבלה למשלוח:
-- permanent_error, או retryable_error שהמיפוי מוכיח שנדחה. תוצאה עמומה
-- (delivery_unknown) **אינה** עילה למחיקה — שם ייתכן מאוד שההודעה בדרך,
-- ומחיקת השורה הייתה משאירה את הלקוחה עם קוד שהמערכת כבר לא מכירה.
--
-- ⚠️ הפונקציה מסרבת בארבעה מצבים, וכל אחד מהם הוא הגנה נפרדת:
--   consumed   — הקוד כבר נוצל. מחיקה הייתה מוחקת ראיה.
--   attempted  — כבר הוקלדו ניסיונות מולו, כלומר מישהו מחזיק אותו.
--   superseded — קיימת שורה חדשה יותר. שלנו כבר אינה "האחרונה", ואין
--                צורך למחוק אותה — וניסיון כזה מסכן שורה תקינה.
--   not_found  — מזהה שאינו שייך למספר ול-purpose שנמסרו.
--
-- 🔒 הקוד הגלוי אינו מגיע לכאן, ואין פרמטר שמאפשר למחוק "את השורה
-- האחרונה" — רק שורה אחת, לפי מזהה מדויק, ששייכת למספר שנמסר.
-- ============================================================================

create or replace function public.discard_otp_issue_atomic(
  p_otp_id     bigint,
  p_phone_e164 text,
  p_purpose    text
) returns jsonb
language plpgsql
-- 🔒 search_path נעול (ראה otp_hash_equals). כל שמות הטבלאות והפונקציות
-- שלנו גם schema-qualified במפורש — שתי ההגנות יחד, לא אחת מהן.
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

  -- ⚠️ אותה נעילה ובאותו namespace כמו בהנפקה ובאימות. בלעדיה, ניקוי שרץ
  -- במקביל להנפקה חדשה היה יכול למחוק שורה בדיוק ברגע שנקבע שהיא האחרונה.
  perform pg_advisory_xact_lock(1, hashtext(p_phone_e164));

  -- 🔒 מזהה מדויק **וגם** התאמת מספר ו-purpose. מזהה לבדו היה מאפשר
  -- למחוק שורה של מספר אחר.
  select * into v_row
  from public.otp_attempts
  where id = p_otp_id
    and phone_e164 = p_phone_e164
    and purpose    = p_purpose
  for update;

  if v_row.id is null then
    return jsonb_build_object('result', 'not_found');
  end if;

  if v_row.consumed_at is not null then
    return jsonb_build_object('result', 'consumed');
  end if;

  if v_row.attempts > 0 then
    return jsonb_build_object('result', 'attempted');
  end if;

  /*
   * ⚠️ ההשוואה היא (created_at, id) ולא id לבדו.
   *
   * סדר ה-id אינו סדר ה-commit — זו בדיוק הסיבה שהמרוץ לא נפתר בקוד
   * האפליקציה. כאן הוא משמש רק כשובר-שוויון אחרי created_at, ובכיוון
   * השמרני: אם קיימת שורה חדשה יותר, הפונקציה **מסרבת** למחוק. סירוב
   * שגוי עולה שורה מיותרת אחת; מחיקה שגויה עולה את הקוד שביד הלקוחה.
   *
   * ⚠️ הסינון על consumed_at חיוני: שורה ישנה שלא נוצלה מעולם אינה
   * "חדשה יותר", והתעלמות ממנה היא שמאפשרת ניקוי אחרי מחזור קודם.
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
  'ביטול שורת הנפקה שהשליחה שלה נדחתה בוודאות. מוחקת שורה אחת לפי מזהה מדויק, '
  'ורק אם היא טרם נוצלה, טרם נוסתה, ואינה מוחלפת בשורה חדשה יותר.';


-- ============================================================================
-- חלק 5 — הרשאות
--
-- ⚠️ REVOKE מ-public בלבד אינו מספיק. ל-Supabase יש default privileges
-- שמעניקות EXECUTE על פונקציה חדשה בסכמה public ישירות ל-anon
-- ול-authenticated, ו-REVOKE ... FROM PUBLIC אינו נוגע בהענקה ישירה.
-- זו הטעות שתועדה ב-0006 ואין לחזור עליה.
-- ============================================================================

revoke execute on function public.otp_hash_equals(text, text)
  from public, anon, authenticated;
grant  execute on function public.otp_hash_equals(text, text)
  to service_role;

revoke execute on function public.issue_otp_atomic(
  text, text, text, inet, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant  execute on function public.issue_otp_atomic(
  text, text, text, inet, integer, integer, integer, integer, integer)
  to service_role;

revoke execute on function public.verify_otp_atomic(text, text, text, integer)
  from public, anon, authenticated;
grant  execute on function public.verify_otp_atomic(text, text, text, integer)
  to service_role;

revoke execute on function public.discard_otp_issue_atomic(bigint, text, text)
  from public, anon, authenticated;
grant  execute on function public.discard_otp_issue_atomic(bigint, text, text)
  to service_role;


-- ============================================================================
-- חלק 6 — assertions
--
-- המיגרציה מפילה את עצמה אם אחת מההנחות אינה מתקיימת. ⚠️ הבדיקות האלה
-- רצות מול המצב האמיתי שנוצר, ולא מול הכוונה שנכתבה למעלה.
-- ============================================================================

do $$
begin
  -- ── ההרשאות ──────────────────────────────────────────────────────────
  if has_function_privilege('anon',
       'public.otp_hash_equals(text, text)', 'execute')
  then raise exception '0013: anon יכול להפעיל את otp_hash_equals'; end if;

  if has_function_privilege('authenticated',
       'public.otp_hash_equals(text, text)', 'execute')
  then raise exception '0013: authenticated יכול להפעיל את otp_hash_equals'; end if;

  if has_function_privilege('anon',
       'public.issue_otp_atomic(text, text, text, inet, integer, integer, integer, integer, integer)', 'execute')
  then raise exception '0013: anon יכול להפעיל את issue_otp_atomic'; end if;

  if has_function_privilege('authenticated',
       'public.issue_otp_atomic(text, text, text, inet, integer, integer, integer, integer, integer)', 'execute')
  then raise exception '0013: authenticated יכול להפעיל את issue_otp_atomic'; end if;

  if has_function_privilege('anon',
       'public.verify_otp_atomic(text, text, text, integer)', 'execute')
  then raise exception '0013: anon יכול להפעיל את verify_otp_atomic'; end if;

  if has_function_privilege('authenticated',
       'public.verify_otp_atomic(text, text, text, integer)', 'execute')
  then raise exception '0013: authenticated יכול להפעיל את verify_otp_atomic'; end if;

  if has_function_privilege('anon',
       'public.discard_otp_issue_atomic(bigint, text, text)', 'execute')
  then raise exception '0013: anon יכול להפעיל את discard_otp_issue_atomic'; end if;

  if has_function_privilege('authenticated',
       'public.discard_otp_issue_atomic(bigint, text, text)', 'execute')
  then raise exception '0013: authenticated יכול להפעיל את discard_otp_issue_atomic'; end if;

  -- ⚠️ הכיוון ההפוך: ההרשאה של service_role חייבת *להישמר*. בדיקה שרק
  -- מוודאת ש-anon חסום הייתה עוברת גם אם REVOKE סגר את כולם.
  if not has_function_privilege('service_role',
       'public.otp_hash_equals(text, text)', 'execute')
  then raise exception '0013: service_role איבד את otp_hash_equals'; end if;

  if not has_function_privilege('service_role',
       'public.issue_otp_atomic(text, text, text, inet, integer, integer, integer, integer, integer)', 'execute')
  then raise exception '0013: service_role איבד את issue_otp_atomic'; end if;

  if not has_function_privilege('service_role',
       'public.verify_otp_atomic(text, text, text, integer)', 'execute')
  then raise exception '0013: service_role איבד את verify_otp_atomic'; end if;

  if not has_function_privilege('service_role',
       'public.discard_otp_issue_atomic(bigint, text, text)', 'execute')
  then raise exception '0013: service_role איבד את discard_otp_issue_atomic'; end if;

  -- ── 🔒 SECURITY INVOKER ──────────────────────────────────────────────
  -- שתי שכבות ההגנה (הרשאה + RLS) חייבות להישאר בלתי תלויות. הפיכת אחת
  -- מהפונקציות ל-DEFINER הייתה מאחדת אותן לנכס יחיד.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('issue_otp_atomic', 'verify_otp_atomic',
                        'otp_hash_equals', 'discard_otp_issue_atomic')
      and p.prosecdef
  ) then
    raise exception '0013: פונקציית OTP סומנה SECURITY DEFINER — ראה את הנימוק בראש הקובץ';
  end if;

  -- ── 🔒 RLS על otp_attempts עדיין מופעל ואין policies ─────────────────
  -- זו השכבה השנייה. אם היא נעלמה, SECURITY INVOKER כבר אינו מגן על כלום.
  if not exists (
    select 1 from pg_class
    where oid = 'public.otp_attempts'::regclass and relrowsecurity
  ) then
    raise exception '0013: RLS כבוי על otp_attempts';
  end if;

  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'otp_attempts')
  then raise exception '0013: נוספה policy ל-otp_attempts — היעדרן הוא מודל האבטחה'; end if;
end $$;

-- ── ההשוואה בזמן קבוע עובדת ────────────────────────────────────────────────
do $$
begin
  if not public.otp_hash_equals(repeat('a', 64), repeat('a', 64)) then
    raise exception '0013: otp_hash_equals דחה גיבובים זהים';
  end if;
  if public.otp_hash_equals(repeat('a', 64), repeat('a', 63) || 'b') then
    raise exception '0013: otp_hash_equals אישר גיבובים שונים';
  end if;
  if public.otp_hash_equals(repeat('a', 64), repeat('a', 63)) then
    raise exception '0013: otp_hash_equals אישר גיבובים באורך שונה';
  end if;
  if public.otp_hash_equals(null, repeat('a', 64)) is not false then
    raise exception '0013: otp_hash_equals לא החזיר false על null';
  end if;
end $$;
