-- ============================================================================
-- 0027 — שלב 15H: ביטול תור מאושר ע"י המנהלת
--
-- ═══ 🔒 מיגרציה תוספתית בלבד ═══
--
-- אין כאן DROP, אין ALTER TABLE, אין ALTER TYPE ואין נגיעה בנתונים קיימים.
-- שתי פונקציות בלבד: אחת חדשה, ואחת שמורחבת בצירוף אחד.
--
-- ─── הפער שהמיגרציה הזו סוגרת ──────────────────────────────────────────────
--
-- עד היום היה במערכת **מסלול אחד בלבד** לביטול תור מאושר: הלקוחה עצמה,
-- דרך `/account`, עד 6 שעות לפני המועד. שובל לא יכלה לבטל תור בשום דרך.
--
-- ⚠️ ההערה ב-0025:64 מתעדת את זה מפורשות: "cancelled_by_business שמקורו
-- אינו Google — אין מסלול כזה בקוד היום". הדרך היחידה להגיע לסטטוס הזה
-- הייתה למחוק את האירוע ידנית מיומן Google ולהמתין לסנכרון הנכנס — כלומר
-- להסתמך על מנגנון עקיף, אסינכרוני, שאינו רץ מתוזמן.
--
-- ─── מה שובל מקבלת כאן ─────────────────────────────────────────────────────
--
--   confirmed  ⟶  cancelled_by_business        (טרנזקציה אחת)
--   השעה משתחררת מיידית — 'cancelled_by_business' אינו נמנה
--   ב-appointments_no_overlap ולכן ה-EXCLUDE מפסיק לחול עליו ברגע ה-COMMIT
--   בקשת שינוי מועד פתוחה נסגרת באותה טרנזקציה
--   שורת היסטוריה עם actor='admin' והמזהה האמיתי של המנהלת
--   האירוע ביומן מסומן למחיקה (calendar_sync_operation='delete')
--   SMS ללקוחה — **אוטומטית**, דרך הטריגר של 0025
--
-- ═══ 🔒 ההתראה ללקוחה אינה נכתבת כאן, ואסור שתהיה ═══
--
-- הטריגר `appointment_history_enqueue_notifications` (0025) יושב על
-- `appointment_history` ומזהה בדיוק את הצירוף שנכתב למטה:
--   action='cancelled' · from_status='confirmed' · to_status='cancelled_by_business'
-- ⟹ `booking_cancelled` לנמען `customer`, בנוסח המאושר "תורך בוטל".
--
-- ⚠️ **רק ללקוחה.** שובל היא זו שביצעה את הפעולה, ואין טעם להודיע לה על
-- מה שהיא עצמה עשתה לפני שנייה — 0025:435.
--
-- ⚠️ מכאן נובע כלל שאסור לשבור: **שורת היסטוריה אחת = הודעה אחת.** מפתח
-- ה-idempotency של 0025 הוא `source_history_id`, ולכן כל שורת היסטוריה
-- נוספת על אותו ביטול הייתה SMS נוסף ללקוחה. זו הסיבה ש-'already_cancelled'
-- למטה יוצא **לפני** כתיבת ההיסטוריה ולא אחריה.
--
-- ─── מה שהמיגרציה הזו אינה עושה ────────────────────────────────────────────
--
-- 🔒 **אין cutoff של 6 שעות.** `cancel_cutoff_hours` הוא מדיניות של ביטול
-- **עצמי** של הלקוחה. שובל חייבת להיות מסוגלת לבטל גם חצי שעה לפני, כי זה
-- בדיוק המצב שבו ביטול עסקי קורה בעולם האמיתי — מחלה, תקלה, חירום.
--
-- 🔒 **אבל כן חסום ביטול רטרואקטיבי.** תור שכבר התחיל אינו מבוטל אלא
-- מסומן completed או no_show. ביטול למפרע היה מוחק אירוע שכבר קרה, משנה
-- היסטוריה עסקית, ושולח ללקוחה "תורך בוטל" על תור שהיא כבר הגיעה אליו.
--
-- 🔒 אין נגיעה ב-reschedule_count של הלקוחה, אין נגיעה במקדמה ואין החזר
-- כספי — אלה החלטות עסקיות שאינן קורות במסד.
-- ============================================================================


-- ============================================================================
-- חלק 1 — claim_calendar_sync לומדת את הביטול העסקי
--
-- ⚠️ **בלי החלק הזה 15H שבור בשקט, בדיוק כמו ש-15E היה שבור בלי חלק 5
-- של 0022.**
--
-- הגרסה הנוכחית (0022) מתירה claim לשלושה צירופים בלבד:
--   (confirmed, upsert) · (cancelled_by_customer, delete) · (rescheduled, delete)
--
-- תור שבוטל ע"י שובל מקבל (cancelled_by_business, delete) — צירוף שאינו
-- ברשימה. התוצאה הייתה: התור מבוטל במערכת והשעה משתחררת, אבל **האירוע
-- נשאר ביומן Google לנצח**. שובל הייתה רואה ביומן שלה תור שכבר אינו קיים,
-- בלי שגיאה, בלי הופעה במסך "דורש טיפול", ובלי שום רמז לכך שמשהו נכשל.
--
-- ⚠️ ההרחבה אינה משפיעה על המסלול הנכנס מ-Google (0008): שם
-- `apply_google_cancellation` מסמנת `calendar_sync_status='synced'` כי
-- האירוע כבר נמחק בפועל ע"י שובל, ו-'synced' אינו claimable מלכתחילה.
-- כלומר מחיקה שמקורה ב-Google לא תיצור פתאום ניסיון מחיקה שני.
--
-- שאר ההתנהגות — ה-lease של 2 דקות ומונה הניסיונות — נשארת מילה במילה.
-- ============================================================================

create or replace function public.claim_calendar_sync(
  p_appointment_id uuid
) returns public.appointments
language plpgsql
as $$
declare
  v_row public.appointments;
begin
  update public.appointments
  set calendar_sync_status = 'syncing',
      calendar_sync_started_at = now(),
      calendar_sync_attempt_count = calendar_sync_attempt_count + 1
  where id = p_appointment_id
    and (
      (status = 'confirmed' and calendar_sync_operation = 'upsert')
      or (status = 'cancelled_by_customer' and calendar_sync_operation = 'delete')
      or (status = 'rescheduled' and calendar_sync_operation = 'delete')
      or (status = 'cancelled_by_business' and calendar_sync_operation = 'delete')
    )
    and (
      calendar_sync_status in ('pending', 'failed')
      or (calendar_sync_status = 'syncing' and calendar_sync_started_at < now() - interval '2 minutes')
    )
  returning * into v_row;

  if v_row.id is null then
    raise exception 'NOT_CLAIMABLE' using errcode = 'P0004';
  end if;

  return v_row;
end;
$$;

comment on function public.claim_calendar_sync(uuid) is
  '15H: ארבעה צירופים (status, operation) ניתנים ל-claim. cancelled_by_business+delete נוסף כדי שביטול ניהולי באמת ימחק את האירוע מהיומן.';


-- ============================================================================
-- חלק 2 — הביטול הניהולי
--
-- ─── סדר הבדיקות, ולמה הוא כזה ─────────────────────────────────────────────
--
--   1. המנהלת אמיתית      — לפני כל נעילה. אין טעם לנעול שורה בשביל קורא
--                            שאינו מורשה, וזו גם ההוכחה ש-actor_id שנכתב
--                            להיסטוריה הוא מזהה של מנהלת ולא ערך שרירותי.
--   2. FOR UPDATE          — מכאן והלאה אף אחד אחר לא נוגע בשורה.
--   3. כבר מבוטל עסקית     — יציאה **לפני** כל כתיבה. אין היסטוריה שנייה,
--                            ולכן אין SMS שני.
--   4. סופי / לא confirmed  — לא נוגעים בהיסטוריה עסקית.
--   5. כבר התחיל           — הגנה מפני ביטול רטרואקטיבי.
--   6. סנכרון פעיל         — לא מושכים את השטיח מתחת לפעולת יומן שרצה כרגע.
--
-- ⚠️ בדיקה 3 לפני בדיקה 5 בכוונה: תור שכבר בוטל ועבר מאז — לחיצה חוזרת
-- עליו חייבת להחזיר 'already_cancelled' ולא 'in_past'. השנייה הייתה
-- מציגה לשובל שגיאה על פעולה שהצליחה במלואה.
-- ============================================================================

create or replace function public.cancel_confirmed_appointment_by_admin(
  p_appointment_id uuid,
  p_admin_user_id  uuid
) returns jsonb
language plpgsql
as $$
declare
  v_row        public.appointments;
  v_old_starts timestamptz;
  v_req_id     uuid;
  v_req_starts timestamptz;
begin
  -- ── 1. המנהלת אמיתית ────────────────────────────────────────────────────
  -- 🔒 שכבה שנייה, לא ראשונה: ה-route כבר עבר requireAdminApi. הבדיקה כאן
  -- מבטיחה שגם קריאה עתידית ממקום אחר בשרת לא תוכל לכתוב actor='admin' עם
  -- מזהה שאינו של מנהלת בפועל.
  if p_admin_user_id is null then
    raise exception 'ADMIN_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admins where user_id = p_admin_user_id) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  -- ── 2. נעילה ────────────────────────────────────────────────────────────
  -- 🔒 סדר נעילה עקבי עם 15E: **המקור ראשון**, בקשת שינוי המועד אחריו.
  -- זה מה שהופך את המרוץ מול approve/reject של בקשת שינוי מועד לבטוח.
  select * into v_row
    from public.appointments
    where id = p_appointment_id
    for update;

  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- ── 3. כבר בוטל ע"י העסק ────────────────────────────────────────────────
  -- לחיצה כפולה, retry אחרי timeout, שתי לשוניות פתוחות, או מחיקה שהגיעה
  -- קודם מ-Google. אפס כתיבות, ובפרט **אפס שורות היסטוריה** — ולכן אפס
  -- הודעות SMS נוספות ללקוחה.
  if v_row.status = 'cancelled_by_business' then
    return jsonb_build_object('outcome', 'already_cancelled', 'appointment', to_jsonb(v_row));
  end if;

  -- ── 4. מצב שאינו ניתן לביטול ────────────────────────────────────────────
  -- completed/no_show הם היסטוריה עסקית ואינם נמחקים.
  -- cancelled_by_customer/expired/rejected/rescheduled כבר סופיים.
  -- pending אינו תור מאושר — לבקשה כזו יש reject_pending_appointment.
  if v_row.status <> 'confirmed' then
    return jsonb_build_object(
      'outcome',        'not_cancellable',
      'current_status', v_row.status,
      'appointment',    to_jsonb(v_row)
    );
  end if;

  -- ── 5. ביטול רטרואקטיבי חסום ────────────────────────────────────────────
  -- 🔒 אין כאן cutoff_hours: שובל רשאית לבטל גם דקה לפני. מה שחסום הוא
  -- תור ש**כבר התחיל** — שם הפעולה הנכונה היא סימון completed או no_show,
  -- ולא ביטול שמייצר SMS "תורך בוטל" אחרי שהלקוחה כבר הגיעה.
  if v_row.starts_at <= now() then
    return jsonb_build_object(
      'outcome',     'in_past',
      'starts_at',   v_row.starts_at,
      'appointment', to_jsonb(v_row)
    );
  end if;

  -- ── 6. סנכרון יומן פעיל ─────────────────────────────────────────────────
  -- אותו lease של שתי דקות שכל המערכת עובדת לפיו.
  if v_row.calendar_sync_status = 'syncing'
     and v_row.calendar_sync_started_at is not null
     and v_row.calendar_sync_started_at > now() - interval '2 minutes' then
    raise exception 'SYNC_IN_PROGRESS' using errcode = 'P0007';
  end if;

  v_old_starts := v_row.starts_at;

  -- ── הביטול עצמו ─────────────────────────────────────────────────────────
  -- ⚠️ calendar_sync_status='pending' ו**לא** 'synced': בשונה מהמסלול
  -- הנכנס מ-Google, כאן האירוע עדיין קיים ביומן ויש למחוק אותו בפועל.
  -- ה-'pending' הוא מה שהופך את התור ל-claimable ע"י claim_calendar_sync
  -- (חלק 1) ומכניס אותו גם לרשימת "דורש טיפול" אם המחיקה תיכשל.
  update public.appointments
  set status                   = 'cancelled_by_business',
      calendar_sync_operation  = 'delete',
      calendar_sync_status     = 'pending',
      calendar_sync_started_at = null,
      calendar_sync_error      = null
  where id = p_appointment_id
  returning * into v_row;

  -- 🔒 שורת ההיסטוריה הזו היא **גם** מנגנון ההתראה. ראה הכותרת.
  insert into public.appointment_history (
    appointment_id, action, from_status, to_status,
    from_starts_at, actor, actor_id, source
  ) values (
    v_row.id, 'cancelled', 'confirmed', 'cancelled_by_business',
    v_old_starts, 'admin', p_admin_user_id, 'admin'
  );

  -- ══ סגירת בקשת שינוי מועד פתוחה ═══════════════════════════════════════
  --
  -- ⚠️ **ghost pending** — אותו באג בדיוק ש-15E תיקן במסלול הלקוחה, ואם
  -- לא ייסגר גם כאן הוא חוזר: שובל מבטלת את התור, שורת הבקשה נשארת
  -- pending, וממשיכה לחסום את **שעת היעד** ביומן עד לתפוגה — שעה שאיש
  -- כבר לא יכול לקבל, ושאישורה ממילא היה נכשל ב-ORIGINAL_NOT_CONFIRMED.
  --
  -- 🔒 אטומי עם הביטול: או ששניהם קרו או שאף אחד. שעת היעד משתחררת באותו
  -- COMMIT, כי 'rejected' אינו נמנה ב-appointments_no_overlap.
  --
  -- ⚠️ reason='original_cancelled' אינו קישוט: 0025:399 **מחריגה** אותו
  -- במפורש מהתראות. בלעדיו הלקוחה הייתה מקבלת "בקשת שינוי המועד לא
  -- אושרה" בנוסף ל"תורך בוטל" — שתי הודעות על אותו אירוע, כשהשנייה
  -- מתארת החלטה ששובל מעולם לא קיבלה.
  --
  -- ⚠️ אין כאן שום נגיעה ב-Google: לשורת בקשה שממתינה לאישור מעולם לא
  -- נוצר אירוע ביומן.
  update public.appointments
  set status             = 'rejected',
      pending_expires_at = null
  where reschedule_of_appointment_id = p_appointment_id
    and status = 'pending'
  returning id, starts_at into v_req_id, v_req_starts;

  if v_req_id is not null then
    insert into public.appointment_history (
      appointment_id, action, from_status, to_status,
      to_starts_at, actor, actor_id, reason
    ) values (
      v_req_id, 'status_changed', 'pending', 'rejected',
      v_req_starts, 'admin', p_admin_user_id, 'original_cancelled'
    );
  end if;

  return jsonb_build_object(
    'outcome',              'applied',
    'from_starts_at',       v_old_starts,
    'appointment',          to_jsonb(v_row),
    -- מזהה בקשת שינוי המועד שנסגרה יחד עם הביטול, או null. אין לה עבודת
    -- יומן פתוחה ואין מה לעשות איתו.
    'cancelled_request_id', v_req_id
  );
end;
$$;

comment on function public.cancel_confirmed_appointment_by_admin(uuid, uuid) is
  '15H: ביטול תור מאושר ע"י המנהלת. ללא cutoff, אך חסום על תור שכבר התחיל. idempotent, סוגר בקשת שינוי מועד פתוחה, ומייצר SMS ללקוחה דרך הטריגר של 0025.';


-- ============================================================================
-- הרשאות
--
-- אותו דפוס בדיוק כמו 0006/0007/0008, ומאותה סיבה: PostgREST חושף כל
-- פונקציה בסכמה public כ-RPC לכל תפקיד כברירת מחדל, ו-`revoke ... from
-- public` לבדו אינו מסיר את ההענקה הישירה ש-Supabase נותנת ל-anon
-- ול-authenticated. לכן שלושת התפקידים מפורשים.
--
-- 🔴 הפונקציה הזו מבטלת תורים ומייצרת SMS. ללקוחה מחוברת (authenticated)
-- אסור להריץ אותה בשום מצב.
-- ============================================================================

revoke execute on function public.cancel_confirmed_appointment_by_admin(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.claim_calendar_sync(uuid)
  from public, anon, authenticated;

grant execute on function public.cancel_confirmed_appointment_by_admin(uuid, uuid) to service_role;
grant execute on function public.claim_calendar_sync(uuid) to service_role;


-- ============================================================================
-- אימות בפועל
--
-- אותו לקח של 0006: "Success" בעורך ה-SQL אינו ראיה. הקובץ בודק את
-- התוצאה ונכשל אם משהו לא נכנס כפי שנדרש.
--
-- ⚠️ יש להריץ את הקובץ *כולו*. עורך ה-SQL של Supabase מריץ רק את הטקסט
-- המסומן כאשר קיימת בחירה.
-- ============================================================================

do $$
declare
  v_signatures text[] := array[
    'public.cancel_confirmed_appointment_by_admin(uuid, uuid)',
    'public.claim_calendar_sync(uuid)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_signatures loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0027): % — ל-anon עדיין יש EXECUTE.', v_sig
        using errcode = 'P0100';
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0027): % — ל-authenticated עדיין יש EXECUTE.', v_sig
        using errcode = 'P0100';
    end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'הרשאות RPC (0027): % — ל-service_role חסר EXECUTE.', v_sig
        using errcode = 'P0101';
    end if;
  end loop;

  raise notice 'הרשאות RPC של 0027 אומתו: anon=false, authenticated=false, service_role=true.';
end $$;

do $$
declare
  v_src text;
begin
  -- 🔒 הבדיקה החשובה ביותר בקובץ: בלי הצירוף הזה האירוע לא יימחק מהיומן,
  -- והכשל שקט לחלוטין.
  select prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_calendar_sync';

  if v_src is null then
    raise exception '0027: claim_calendar_sync אינה קיימת.' using errcode = 'P0103';
  end if;
  if v_src not like '%cancelled_by_business%' then
    raise exception
      '0027: claim_calendar_sync אינה מכירה את הצירוף (cancelled_by_business, delete) — ביטול ניהולי לא ימחק את האירוע מהיומן.'
      using errcode = 'P0103';
  end if;

  -- שלושת הצירופים הקודמים חייבים לשרוד. הרחבה שמאבדת אחד מהם הייתה
  -- שוברת את 15E או את הביטול העצמי.
  if v_src not like '%rescheduled%' or v_src not like '%cancelled_by_customer%' then
    raise exception '0027: claim_calendar_sync איבדה צירוף קיים.' using errcode = 'P0103';
  end if;

  raise notice '0027: claim_calendar_sync מכירה את ארבעת הצירופים.';
end $$;
