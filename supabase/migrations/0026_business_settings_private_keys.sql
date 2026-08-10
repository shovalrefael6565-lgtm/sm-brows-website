-- ============================================================================
-- 0026 — שלב 15F: סגירת business_settings בפני anon ו-authenticated
--
-- ═══ 🔴 מה נשבר, ולמה זה לא היה באג ב-0001 ═══
--
-- 0001 יצרה policy אחת:
--
--   create policy business_settings_read on public.business_settings
--     for select using (true);
--
-- עם ההערה: "קריאה פתוחה (אלה מספרי מדיניות שגם ככה מפורסמים באתר)".
-- ⚠️ **ההערה הייתה נכונה לגמרי — באותו רגע.** הטבלה החזיקה אך ורק
-- cancel_cutoff_hours, max_reschedules וכדומה, כלומר בדיוק את המספרים
-- שמופיעים בעמוד מדיניות ההזמנות.
--
-- 🔴 **15F שבר את ההנחה הזו בשקט.** 0024 הוסיפה שתי שורות שאינן ציבוריות:
--
--   admin_notification_phone  — מספר הטלפון הפרטי של שובל
--   building_entry_code       — קוד הכניסה לבניין
--
-- ו-`using (true)` חל עליהן אוטומטית. בפרודקשן, שבה Supabase מעניקה
-- `SELECT` ל-anon ול-authenticated על טבלאות ב-public כברירת מחדל, כל מי
-- שמחזיק את מפתח ה-anon — שנמצא ב-JS של הדפדפן בהגדרה — היה יכול להריץ
--
--   supabase.from('business_settings').select('*')
--
-- ולקבל את שניהם. אומת אמפירית מול PGlite עם ההרשאות של פרודקשן.
--
-- ⚠️ זהו בדיוק אותו דפוס כשל שתועד ב-scripts/test-rpc-permissions.mjs:
-- ההענקה **הישירה** של Supabase ל-anon/authenticated אינה מוסרת ע"י
-- `revoke ... from public`, ואינה נראית בקוד המיגרציה.
--
-- ─── התיקון: שתי שכבות ───────────────────────────────────────────────────
--
-- 1. **הסרת ההרשאה עצמה.** אף מסלול בקוד אינו קורא את הטבלה מהדפדפן —
--    `lib/db/businessSettings.ts` הוא 'server-only' ומשתמש ב-service_role,
--    שעוקף RLS ממילא. הקריאה מהדפדפן לא נחוצה לשום דבר.
--
-- 2. **policy לפי רשימת היתר.** גם אם מישהו יעניק SELECT מחדש בעתיד —
--    בטעות, או דרך ממשק Supabase — הסודות עדיין לא ייחשפו.
--
-- 🔒 **הנקודה החשובה ב-(2): המפתחות החדשים סגורים כברירת מחדל.** `using
-- (true)` נכשל כי הוא חל על כל מה שיתווסף אי פעם; רשימת היתר עושה את
-- ההפך — כל key חדש הוא פרטי עד שמישהו מוסיף אותו במפורש. זו ההטיה
-- הנכונה לטבלת הגדרות שממשיכה לצמוח.
--
-- ⚠️ אין כאן שינוי התנהגות באפליקציה: כל הקריאות עוברות ב-service_role.
-- ============================================================================


-- ============================================================================
-- חלק 0 — תנאי מוקדם
--
-- ⚠️ **נוסף אחרי כשל אמיתי בפרודקשן.** ההרצה הראשונה של 0026 החזירה
-- `42710: type "notification_event" already exists` — שגיאה ש-0026 אינו
-- יכול לייצר, כי אין בו `create type` והוא אינו מזכיר notification_event
-- כלל. מה שהורץ בפועל היה **0025 בשנית**, ששורתו הראשונה היא בדיוק
-- `create type notification_event`.
--
-- הבלוק הזה הופך את הבלבול הזה לשגיאה שמסבירה את עצמה: אם 0025 חסר,
-- נאמר זאת במילים במקום להיכשל בהמשך על משהו שנראה לא קשור.
-- ============================================================================

do $$
begin
  if to_regtype('public.notification_event') is null
     or to_regclass('public.appointment_notifications') is null then
    raise exception
      '0026 דורשת ש-0025 תותקן קודם (appointment_notifications חסרה). ⚠️ אם קיבלת "type notification_event already exists" — הורץ 0025 בשנית, לא 0026.'
      using errcode = 'P0107';
  end if;

  if not exists (
    select 1 from public.business_settings where key = 'building_entry_code'
  ) then
    raise exception '0026 דורשת ש-0024 תותקן קודם (building_entry_code חסר).'
      using errcode = 'P0107';
  end if;
end;
$$;


-- ============================================================================
-- חלק 1 — הסרת ההרשאה הישירה
-- ============================================================================

revoke all on public.business_settings from anon, authenticated;


-- ============================================================================
-- חלק 2 — policy לפי רשימת היתר
--
-- ⚠️ הרשימה מונה אך ורק ערכים שכבר מוצגים ללקוחה בעמוד מדיניות ההזמנות,
-- ב-FAQ ובאזור האישי. הם אינם סוד, וחשיפתם אינה מוסיפה מידע.
--
-- 🔒 **מה שאינו ברשימה — פרטי.** בפרט: admin_notification_phone,
-- building_entry_code, notifications_enabled, וכל key עתידי.
-- ============================================================================

drop policy if exists business_settings_read on public.business_settings;

-- ⚠️ **גם על ה-policy החדש**, כדי ש-0026 תהיה ניתנת להרצה חוזרת.
-- בלי זה הרצה שנייה נופלת על 42710 — בדיוק סוג השגיאה שגרם לבלבול
-- בהרצה הראשונה. מיגרציה שנכשלת באמצע צריכה להיות בטוחה להרצה מחדש.
drop policy if exists business_settings_read_public on public.business_settings;

create policy business_settings_read_public on public.business_settings
  for select
  using (key in (
    'cancel_cutoff_hours',
    'reschedule_cutoff_hours',
    'max_reschedules',
    'pending_expiration_hours',
    'max_active_pending_per_customer',
    -- ⚠️ שלושת אלה אינם נקראים יותר ע"י הקוד (15E הסיר אותם מ-
    -- AppointmentPolicy), אבל השורות נשארו בטבלה. הם נשארים ברשימה כי הם
    -- מספרי מדיניות מפורסמים, ולא בגלל שמישהו קורא אותם.
    'allow_cancel_with_deposit',
    'allow_reschedule_with_deposit',
    'deposit_reschedule_cutoff_hours'
  ));

comment on policy business_settings_read_public on public.business_settings is
  '🔒 רשימת היתר. key שאינו כאן אינו נראה ל-anon/authenticated — כולל כל key שיתווסף בעתיד. ראה 0026.';


-- ============================================================================
-- אימות עצמי
-- ============================================================================

do $$
declare
  v_qual text;
begin
  -- 🔒 ההרשאה הישירה הוסרה בפועל, ולא רק הוצהרה.
  if has_table_privilege('anon', 'public.business_settings', 'select') then
    raise exception '0026: ל-anon עדיין יש SELECT על business_settings' using errcode = 'P0106';
  end if;
  if has_table_privilege('authenticated', 'public.business_settings', 'select') then
    raise exception '0026: ל-authenticated עדיין יש SELECT על business_settings' using errcode = 'P0106';
  end if;

  -- 🔒 ה-policy הישן, זה שאמר `true`, אינו קיים יותר.
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.business_settings'::regclass and polname = 'business_settings_read'
  ) then
    raise exception '0026: business_settings_read (using true) עדיין קיים' using errcode = 'P0106';
  end if;

  select pg_get_expr(polqual, polrelid) into v_qual
    from pg_policy
    where polrelid = 'public.business_settings'::regclass
      and polname = 'business_settings_read_public';

  if v_qual is null then
    raise exception '0026: policy רשימת ההיתר לא נוצר' using errcode = 'P0106';
  end if;

  -- 🔒 השורות הרגישות אינן ברשימה. בדיקה על הביטוי עצמו, כדי שהוספה
  -- עתידית שלהן לרשימה תיפול כאן ולא תתגלה בדליפה.
  if v_qual like '%admin_notification_phone%'
     or v_qual like '%building_entry_code%' then
    raise exception '0026: מפתח רגיש נכלל ברשימת ההיתר' using errcode = 'P0106';
  end if;

  raise notice '0026: business_settings סגורה ל-anon/authenticated; רשימת היתר פעילה.';
end;
$$;
