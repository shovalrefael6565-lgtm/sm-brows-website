-- ============================================================================
-- 0024 — שלב 15F: יעד ההתראות של בעלת העסק
--
-- ═══ 🔒 מיגרציה תוספתית בלבד ═══
--
-- אין כאן DROP, אין ALTER על טבלה קיימת, ואין נגיעה במיגרציות 0001–0023.
-- נוספים: שורת הגדרה אחת ופונקציית קריאה אחת.
--
-- ─── למה key ייעודי ולא מספר בקוד ──────────────────────────────────────────
--
-- 🔒 **אין לגזור את יעד ההתראות מ-`PHONE_RAW` שב-lib/utils.ts.**
--
-- `PHONE_RAW` ('0552932813') הוא מספר **תצוגה ציבורי**: הוא נשלח לדפדפן
-- בכל עמוד, מופיע בכפתור "התקשרי אלינו" ובקישור ה-WhatsApp. העובדה ששני
-- המספרים זהים היום היא צירוף מקרים תפעולי ולא אינווריאנטה — ברגע ששובל
-- תחליף מספר תצוגה, מספר שיווקי או מספר עסקי, ההתראות היו הולכות בשקט
-- למקום הלא נכון. יעד התראות ומספר תצוגה הם שתי עובדות שונות, ולכן שתי
-- הגדרות שונות.
--
-- ⚠️ גם env var אינו המקום: החלפת יעד ההתראות הייתה מצריכה פריסה מחדש,
-- בדיוק כמו שמדיניות הביטול לא הושארה בקוד (ראה lib/db/businessSettings.ts).
--
-- ─── למה הערך נשאר ריק כאן ──────────────────────────────────────────────────
--
-- 🔒 המיגרציה **אינה מנחשת מספר**. היא יוצרת את השורה כדי שהיא תהיה גלויה
-- וניתנת לעריכה, ומשאירה אותה `null`. הערך האמיתי נקבע ידנית בפרודקשן.
--
-- ⚠️ המשמעות: עד שהערך ייקבע, כל התראה שיעדה admin תיכשל **בקול** —
-- `admin_phone_unset`, שורה במצב failed שרואים במסך הניהול. זו התנהגות
-- מכוונת. השתקה של יעד חסר הייתה מייצרת מערכת שנראית עובדת ושותקת בדיוק
-- כשבקשת תור חדשה מגיעה.
-- ============================================================================


-- ============================================================================
-- חלק 1 — ההגדרה
-- ============================================================================

-- ⚠️ on conflict do nothing: הרצה חוזרת של המיגרציה לא תדרוס מספר שכבר
-- הוגדר בפרודקשן. מיגרציה שמוחקת הגדרה חיה בהרצה שנייה היא רגל אחת בתוך
-- תקלה שקטה.
insert into public.business_settings (key, value)
values ('admin_notification_phone', 'null'::jsonb)
on conflict (key) do nothing;


-- ============================================================================
-- חלק 1ב — 🔒 מתג ההפעלה
--
-- ⚠️ **false, ובכוונה — וההשלכה שלו אינה "לא שולחים" אלא "לא רושמים".**
--
-- ה-enqueue ב-0025 מותנה במתג הזה, ולא רק ה-dispatch. ההבדל מהותי:
--
--   גייטינג ב-dispatch  ⟶ הטריגר ממשיך לרשום שורות, ונערם backlog של
--                         התראות על אירועים ישנים. ברגע ההפעלה כולן
--                         היו נשלחות בבת אחת — הצפה של לקוחות בהודעות על
--                         תורים שכבר קרו, אושרו או בוטלו לפני שבועות.
--   גייטינג ב-enqueue   ⟶ אין שורה, אין backlog, אין מה לנקז. ההפעלה
--                         מתחילה מ**האירוע הבא**.
--
-- ⚠️ המשמעות שיש לקבל במודע: אירועים שקורים בזמן שהמתג כבוי **אינם
-- מיודעים לעולם**, ואין להם עקבה בטבלת ההתראות. זו ההתנהגות הרצויה —
-- המצב הזה זהה בדיוק למה שקורה היום, לפני 15F.
--
-- ⚠️ המתג אינו תלוי ב-`NOTIFICATIONS_ENABLED` שבסביבה והם אינם כפילות:
-- זה כאן הוא הברז ברמת ה-DB (משנים בלי פריסה, ועוצר גם את הרישום), וזה
-- שבסביבה עוצר את שכבת השליחה. שניהם חייבים להיות דלוקים כדי שייצא SMS.
-- ============================================================================

insert into public.business_settings (key, value)
values ('notifications_enabled', 'false'::jsonb)
on conflict (key) do nothing;


-- ============================================================================
-- חלק 1ג — קוד הכניסה לבניין
--
-- ⚠️ **אינו נשמר בקוד המקור, ולכן אינו נכנס ל-git.**
--
-- הקוד נמסר לכל לקוחה בהודעת האישור, ולכן אינו סוד מבצעי — הוא כבר נמצא
-- בטלפון של כל מי שקבעה תור. הסיבה להוציא אותו מהקוד היא אחרת: מרגע
-- שמחרוזת נכנסת ל-git היא שם **לתמיד**, גם אחרי שהקוד בבניין יוחלף, וגם
-- בכל fork, clone או גיבוי של הריפו. ההיסטוריה אינה נמחקת.
--
-- ⚠️ הערך נקבע ידנית בפרודקשן, בדיוק כמו admin_notification_phone. עד אז
-- הודעת האישור **לא תיבנה כלל** — ראה approvalWhatsAppUrl. זו התנהגות
-- מכוונת: הודעת אישור בלי קוד כניסה שולחת לקוחה לבניין שאינה יכולה
-- להיכנס אליו.
-- ============================================================================

insert into public.business_settings (key, value)
values ('building_entry_code', 'null'::jsonb)
on conflict (key) do nothing;

comment on table public.business_settings is
  'הגדרות עסק הניתנות לשינוי בלי פריסת קוד. admin_notification_phone = יעד התראות ה-SMS של בעלת העסק (15F); אינו מספר התצוגה הציבורי.';


-- ============================================================================
-- חלק 2 — קריאת היעד, במקום אחד
--
-- מחזירה E.164 תקין, או null. **אינה זורקת ואינה ממציאה ברירת מחדל.**
--
-- ⚠️ הפרדה מכוונת בין שני סוגי "אין מספר":
--
--   key חסר / null / מחרוזת ריקה  → null. היעד פשוט טרם הוגדר.
--   ערך קיים אך בפורמט פסול       → null **וגם** warning בלוג השרת.
--
-- בשני המקרים התוצאה זהה — לא שולחים — אבל השני הוא שגיאת הקלדה שמישהו
-- צריך לתקן, ולכן הוא מרעיש. מה שאסור הוא להחזיר מספר שגוי: SMS שנשלח
-- למספר של אדם אחר אינו ניתן לביטול.
--
-- ⚠️ ה-warning מכיל את **אורך** הערך ולא את הערך. מספר טלפון פסול הוא עדיין
-- מספר טלפון של מישהו, ואין לו מקום בלוג.
-- ============================================================================

create or replace function public.admin_notification_phone()
returns text
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_raw  jsonb;
  v_text text;
begin
  select value into v_raw
    from public.business_settings
    where key = 'admin_notification_phone';

  if v_raw is null or jsonb_typeof(v_raw) = 'null' then
    return null;
  end if;

  -- ⚠️ הערך נשמר כ-jsonb. #>>'{}' מחלץ את המחרוזת בלי המרכאות; to_jsonb
  -- על טקסט היה מחזיר '"+9725..."' עם מרכאות, וזה לא היה עובר את ה-regex.
  v_text := btrim(v_raw #>> '{}');

  if v_text is null or v_text = '' then
    return null;
  end if;

  -- אותו פורמט בדיוק כמו customers.phone_e164 (0001): נייד ישראלי ב-E.164.
  if v_text !~ '^\+9725[0-9]{8}$' then
    raise warning 'admin_notification_phone אינו E.164 תקין (אורך %) — התראות לאדמין ייכשלו', length(v_text);
    return null;
  end if;

  return v_text;
end;
$$;

comment on function public.admin_notification_phone() is
  'יעד התראות ה-SMS של בעלת העסק מ-business_settings, או null אם לא הוגדר או פסול. אינו זורק ואינו נופל למספר ברירת מחדל.';

-- ⚠️ בסכמה public כל פונקציה נחשפת כ-RPC לכל תפקיד כברירת מחדל. היעד
-- אינו סוד גדול, אבל אין שום סיבה שהדפדפן יוכל לשאול אותו.
revoke execute on function public.admin_notification_phone() from public, anon, authenticated;
grant  execute on function public.admin_notification_phone() to service_role;


-- ============================================================================
-- אימות עצמי
-- ============================================================================

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.business_settings where key = 'admin_notification_phone';
  if v_count <> 1 then
    raise exception '0024: שורת admin_notification_phone לא נוצרה.' using errcode = 'P0104';
  end if;

  -- 🔒 המתג חייב להיות **כבוי** בסיום המיגרציה. מיגרציה שמדליקה התראות
  -- על מסד קיים היא בדיוק התרחיש שהמתג נועד למנוע.
  if public.setting_boolean('notifications_enabled', false) then
    raise exception '0024: notifications_enabled דלוק בסיום המיגרציה.' using errcode = 'P0104';
  end if;

  if to_regprocedure('public.admin_notification_phone()') is null then
    raise exception '0024: admin_notification_phone() לא נוצרה.' using errcode = 'P0104';
  end if;

  -- ── 🔒 ההרשאות בפועל, לא רק הצהרת ה-REVOKE ──────────────────────────────
  --
  -- ⚠️ הצהרת `revoke ... from public` **אינה מספיקה**: Supabase מעניקה
  -- הרשאה *ישירה* ל-anon ול-authenticated, ו-revoke מ-PUBLIC אינו נוגע בה.
  -- זו בדיוק הטעות שנתפסה ב-0003–0005 ושבגללה קיים
  -- scripts/test-rpc-permissions.mjs.
  if has_function_privilege('anon', 'public.admin_notification_phone()', 'execute')
  then raise exception '0024: anon יכול להפעיל את admin_notification_phone'; end if;
  if has_function_privilege('authenticated', 'public.admin_notification_phone()', 'execute')
  then raise exception '0024: authenticated יכול להפעיל את admin_notification_phone'; end if;

  -- ⚠️ הכיוון ההפוך: ההרשאה של service_role חייבת *להישמר*.
  if not has_function_privilege('service_role', 'public.admin_notification_phone()', 'execute')
  then raise exception '0024: service_role איבד את admin_notification_phone'; end if;

  raise notice '0024: admin_notification_phone קיים (ערך טרם נקבע — נדרש עדכון ידני בפרודקשן).';
end;
$$;
